import { generateQueryEmbedding, generateSearchEmbeddings } from './embeddings';
import { prisma } from './prisma';
import { searchPostsGlobal } from './arcticShift';
import { cosineSimilarity } from './utils';

export interface SearchFilters {
  subreddits?: string[];
  type?: 'post' | 'comment' | 'all';
  minUpvotes?: number;
  limit?: number;
  sort?: 'relevance' | 'top';
  dateRange?: 'week' | 'month' | 'year' | 'all';
}

export interface SearchResult {
  id: string;
  type: 'post' | 'comment';
  title: string | null;
  content: string | null;
  url: string;
  upvotes: number;
  author: string;
  redditCreatedAt: string;
  subreddit: string;
  similarity: number;
  isLive?: boolean; 
  embedding?: number[]; // ← NEW: Keep the vector for recycling
}

/**
 * Optimized for speed and token efficiency.
 * Truncates content to 500 chars to save 80% tokens and 2x speed.
 */
export async function fetchAndScoreLivePosts(query: string, queryVector: number[]): Promise<SearchResult[]> {
  // 40 posts × ~500-char truncation ≈ 6K tokens per live search — Safe for 4M budget
  const livePosts = await searchPostsGlobal(query, 40); 
  if (livePosts.length === 0) return [];

  const texts = livePosts.map(p => {
    // 1,000 chars provides better semantic context for long threads
    const content = p.selftext ? p.selftext.slice(0, 1000) : '';
    return `[POST] ${p.title} ${content}`.trim();
  });

  const postVectors = await generateSearchEmbeddings(texts);

  return livePosts.map((p, i) => ({
    id: p.id,
    type: 'post',
    title: p.title,
    content: p.selftext,
    url: `https://reddit.com${p.permalink}`,
    upvotes: p.score,
    author: p.author,
    subreddit: p.subreddit,
    redditCreatedAt: new Date(p.created_utc * 1000).toISOString(),
    similarity: cosineSimilarity(queryVector, postVectors[i]),
    isLive: true,
    embedding: postVectors[i] // ← RECYCLE: Store the vector
  }));
}

export async function semanticSearch(query: string, filters: SearchFilters = {}) {
  const vector = await generateQueryEmbedding(query);
  const vecStr = `[${vector.join(',')}]`;
  const limit = filters.limit ?? 20;
  const minUpvotes = filters.minUpvotes ?? 0;
  const sort = filters.sort ?? 'relevance';
  const subreddits = filters.subreddits ?? [];
  const type = filters.type ?? 'all';
  const dateRange = filters.dateRange ?? 'all';

  let dateFilter = '';
  if (dateRange !== 'all') {
    const now = new Date();
    const startDate = new Date();
    if (dateRange === 'week') startDate.setDate(now.getDate() - 7);
    else if (dateRange === 'month') startDate.setMonth(now.getMonth() - 1);
    else if (dateRange === 'year') startDate.setFullYear(now.getFullYear() - 1);
    dateFilter = `AND "redditCreatedAt" >= '${startDate.toISOString()}'`;
  }

  const subFilter = `AND (cardinality($4::text[]) = 0 OR s.name = ANY($4::text[]))`;

  const results: SearchResult[] = await prisma.$queryRawUnsafe(`
    WITH results AS (
      ${(type === 'all' || type === 'post') ? `
      (
        SELECT 
          p.id, 'post' as type, p.title, p.content, p.url, p.upvotes, p.author,
          p."redditCreatedAt", s.name as subreddit,
          1 - (p.embedding <=> $1::vector) as similarity
        FROM "Post" p
        JOIN "Subreddit" s ON p."subredditId" = s.id
        WHERE p.embedding IS NOT NULL 
          AND p.upvotes >= $2
          ${dateFilter}
          ${subFilter}
      )
      ` : ''}
      ${(type === 'all') ? 'UNION ALL' : ''}
      ${(type === 'all' || type === 'comment') ? `
      (
        SELECT 
          c.id, 'comment' as type, null as title, c.content, 
          p.url, c.upvotes, c.author,
          c."redditCreatedAt", s.name as subreddit,
          1 - (c.embedding <=> $1::vector) as similarity
        FROM "Comment" c
        JOIN "Post" p ON c."postId" = p.id
        JOIN "Subreddit" s ON p."subredditId" = s.id
        WHERE c.embedding IS NOT NULL 
          AND c.upvotes >= $2
          ${dateFilter}
          ${subFilter}
      )
      ` : ''}
    )
    SELECT * FROM results
    ORDER BY ${sort === 'relevance' ? 'similarity DESC' : 'upvotes DESC'}
    LIMIT $3
  `, vecStr, minUpvotes, limit, subreddits);

  return results;
}

export function mergeAndRank(
  dbResults:   SearchResult[],
  liveResults: SearchResult[],
  limit:       number,
  sort:        'relevance' | 'top',
  dateRange:   string = 'all'
): SearchResult[] {

  const seen = new Map<string, SearchResult>();
  
  for (const post of liveResults) {
    seen.set(post.id, post);
  }

  for (const post of dbResults) {
    if (seen.has(post.id)) {
      const existing = seen.get(post.id)!;
      seen.set(post.id, { ...existing, similarity: Math.max(existing.similarity, post.similarity) });
    } else {
      seen.set(post.id, post);
    }
  }

  const allMerged = [...seen.values()];
  
  // DYNAMIC THRESHOLD:
  // 1. If upvotes >= 100, we accept 25% similarity (Community Favorites)
  // 2. Otherwise, we require 30% similarity (Semantic Precision - Loosened for more results)
  let merged = allMerged.filter(r => {
    if (r.upvotes >= 100) return r.similarity >= 0.25;
    return r.similarity >= 0.30;
  });

  // Fallback: If nothing passes, show top 20 by relevance to avoid empty states
  if (merged.length < 20 && allMerged.length > 0) {
    const fallback = allMerged
      .sort((a, b) => b.similarity - a.similarity)
      .slice(0, 20);
    
    // Merge fallback with existing matches, removing duplicates
    const finalSet = new Map();
    merged.forEach(m => finalSet.set(m.id, m));
    fallback.forEach(f => { if (!finalSet.has(f.id)) finalSet.set(f.id, f); });
    merged = Array.from(finalSet.values());
  }


  if (dateRange === 'all') {
    // ANYTIME: Ordered by relevance or top upvotes
    if (sort === 'relevance') {
      merged.sort((a, b) => b.similarity - a.similarity);
    } else {
      merged.sort((a, b) => b.upvotes - a.upvotes);
    }
  } else {
    // RECENT: Ordered purely by recency (newest first)
    merged.sort((a, b) => new Date(b.redditCreatedAt).getTime() - new Date(a.redditCreatedAt).getTime());
  }

  return merged.slice(0, limit);
}

/**
 * Performs the DB vector search using an existing query vector.
 * Shared between search and background workers.
 */
export async function semanticSearchWithVector(
  queryVector: number[],
  filters: SearchFilters
): Promise<SearchResult[]> {
  const vecStr = `[${queryVector.join(',')}]`;
  const { limit = 20, minUpvotes = 0, subreddits = [], type = 'all', dateRange = 'all', sort = 'relevance' } = filters;

  // Disable strict SQL date cutoff to keep the same number of posts as Anytime,
  // but we will still sort them by recency in the application.
  const dateFilter = (_alias?: string) => '';

  const subFilter = `AND (cardinality($4::text[]) = 0 OR s.name = ANY($4::text[]))`;

  return await prisma.$queryRawUnsafe(`
    WITH results AS (
      ${(type === 'all' || type === 'post') ? `
      (SELECT p.id, 'post' as type, p.title, p.content, p.url, p.upvotes, p.author, p."redditCreatedAt", s.name as subreddit, 1 - (p.embedding <=> $1::vector) as similarity, false as "isLive"
       FROM "Post" p JOIN "Subreddit" s ON p."subredditId" = s.id
       WHERE p.embedding IS NOT NULL AND p.upvotes >= $2 ${dateFilter('p')} ${subFilter})` : ''}
      ${type === 'all' ? 'UNION ALL' : ''}
      ${(type === 'all' || type === 'comment') ? `
      (SELECT c.id, 'comment' as type, null as title, c.content, p.url, c.upvotes, c.author, c."redditCreatedAt", s.name as subreddit, 1 - (c.embedding <=> $1::vector) as similarity, false as "isLive"
       FROM "Comment" c JOIN "Post" p ON c."postId" = p.id JOIN "Subreddit" s ON p."subredditId" = s.id
       WHERE c.embedding IS NOT NULL AND c.upvotes >= $2 ${dateFilter('c')} ${subFilter})` : ''}
    )
    SELECT * FROM results 
    ORDER BY ${sort === 'relevance' ? 'similarity DESC' : 'upvotes DESC, "redditCreatedAt" DESC'}
    LIMIT $3
  `, vecStr, minUpvotes, limit, subreddits);
}
