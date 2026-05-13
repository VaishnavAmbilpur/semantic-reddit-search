import { generateEmbeddings, generateQueryEmbedding } from './embeddings';
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
  const livePosts = await searchPostsGlobal(query, 20); 
  if (livePosts.length === 0) return [];

  const texts = livePosts.map(p => {
    const content = p.selftext ? p.selftext.slice(0, 500) : '';
    return `[POST] ${p.title} ${content}`.trim();
  });

  const postVectors = await generateEmbeddings(texts);

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
  let merged = allMerged.filter(r => r.similarity >= 0.35);

  if (merged.length === 0 && allMerged.length > 0) {
    merged = allMerged.sort((a, b) => b.similarity - a.similarity).slice(0, 5);
  }

  if (dateRange === 'all') {
    merged.sort((a, b) => {
      if (Math.abs(a.upvotes - b.upvotes) > 100) {
        return b.upvotes - a.upvotes;
      }
      return b.similarity - a.similarity;
    });
  } else {
    merged.sort((a, b) => {
      const timeA = new Date(a.redditCreatedAt).getTime();
      const timeB = new Date(b.redditCreatedAt).getTime();
      if (Math.abs(timeA - timeB) > 3600000) { 
        return timeB - timeA;
      }
      return b.upvotes - a.upvotes;
    });
  }

  return merged.slice(0, limit);
}
