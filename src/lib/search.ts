import { generateQueryEmbedding } from './embeddings';
import { prisma } from './prisma';

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
  isLive?: boolean; // ← true for results fetched live from Arctic Shift
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

  // Build Date Filter
  let dateFilter = '';
  if (dateRange !== 'all') {
    const now = new Date();
    const startDate = new Date();
    if (dateRange === 'week') startDate.setDate(now.getDate() - 7);
    else if (dateRange === 'month') startDate.setMonth(now.getMonth() - 1);
    else if (dateRange === 'year') startDate.setFullYear(now.getFullYear() - 1);
    dateFilter = `AND "redditCreatedAt" >= '${startDate.toISOString()}'`;
  }

  // Build Subreddit Filter
  // Ensures $4 is always referenced in the SQL query so Postgres knows its type.
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

/**
 * Merge DB results and live results into one ranked list.
 *
 * Rules:
 * - Deduplicate by Reddit URL — DB result always wins (it may have comments)
 * - Sort by similarity DESC (relevance) or upvotes DESC (top)
 * - Trim to limit
 *
 * Both result sets have REAL cosine similarity scores (not fake numbers),
 * so sorting them together produces a genuinely meaningful ranking.
 */
export function mergeAndRank(
  dbResults:   SearchResult[],
  liveResults: SearchResult[],
  limit:       number,
  sort:        'relevance' | 'top',
  dateRange:   string = 'all'
): SearchResult[] {

  // DB results take priority — they may have associated comments indexed
  const seen = new Map<string, SearchResult>();

  for (const r of dbResults) {
    seen.set(r.url, r);
  }

  // Add live results only if not already in DB
  // Add live results only if not already in DB and above relevance threshold
  for (const r of liveResults) {
    if (!seen.has(r.url) && r.similarity >= 0.18) { // Lowered to 18% threshold
      seen.set(r.url, r);
    }
  }

  const merged = [...seen.values()].filter(r => r.similarity >= 0.18);

  // Sort
  if (dateRange !== 'all') {
    // If a time filter is active (like 'Recent'), prioritize Recency -> Similarity -> Upvotes
    merged.sort((a, b) => {
      const dateA = new Date(a.redditCreatedAt).getTime();
      const dateB = new Date(b.redditCreatedAt).getTime();
      if (dateB !== dateA) return dateB - dateA;
      
      if (Math.abs(b.similarity - a.similarity) > 0.01) return b.similarity - a.similarity;
      return b.upvotes - a.upvotes;
    });
  } else {
    // Anytime: Hybrid sort (Accuracy + Top)
    // We use a 0.05 similarity bucket to allow popular results to rise within their relevance tier
    merged.sort((a, b) => {
      const diff = b.similarity - a.similarity;
      if (Math.abs(diff) > 0.05) return diff;
      
      // Within the same 5% similarity tier, prioritize Upvotes
      if (b.upvotes !== a.upvotes) return b.upvotes - a.upvotes;
      
      // Tie-breaker: Recency
      return new Date(b.redditCreatedAt).getTime() - new Date(a.redditCreatedAt).getTime();
    });
  }

  return merged.slice(0, limit);
}
