// src/app/api/search/route.ts
import { semanticSearch, mergeAndRank } from '@/lib/search';
import { fetchAndScoreLivePosts } from '@/lib/liveSearch';
import { generateQueryEmbedding } from '@/lib/embeddings';
import { getCacheKey, getCachedResults, setCachedResults } from '@/lib/cache';
import { qstash } from '@/lib/qstash';
import { prisma } from '@/lib/prisma';
import { SearchFilters, SearchResult } from '@/lib/search';

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const q          = searchParams.get('q')?.trim();
  const minUpvotes = Number(searchParams.get('minUpvotes') ?? 0);
  const limit      = Math.min(Number(searchParams.get('limit') ?? 40), 100);
  const sort       = (searchParams.get('sort') as 'relevance' | 'top') || 'relevance';
  const type       = (searchParams.get('type') as 'post' | 'comment' | 'all') || 'all';
  const dateRange  = (searchParams.get('dateRange') as 'week' | 'month' | 'year' | 'all') || 'all';
  const subreddits = searchParams.get('subreddits')?.split(',').filter(Boolean) || [];

  if (!q || q.length < 2) {
    return Response.json({ error: 'Query too short' }, { status: 400 });
  }

  const filters = { minUpvotes, limit, sort, type, dateRange, subreddits };
  const cacheKey = getCacheKey(q, filters);
  const start = Date.now();

  // 1. Check Cache
  const cached = await getCachedResults(cacheKey);
  if (cached) {
    const data = typeof cached === 'string' ? JSON.parse(cached) : (cached as any);
    // data is { results: SearchResult[], queryTime: number }
    return Response.json({ 
      results: data.results, 
      cached: true, 
      queryTime: data.queryTime || (Date.now() - start) 
    });
  }

  try {
    // 2. Embed query ONCE for both lanes
    const queryVector = await generateQueryEmbedding(q);

    // 3. Run lanes in parallel
    // We skip live search if specific subreddits are requested or if searching ONLY comments
    const shouldRunLive = subreddits.length === 0 && type !== 'comment';

    const [dbResults, liveResults] = await Promise.all([
      semanticSearchWithVector(q, queryVector, filters),
      shouldRunLive ? fetchAndScoreLivePosts(q, queryVector, filters) : Promise.resolve([]),
    ]);

    // 4. Merge and Rank
    const results = mergeAndRank(dbResults, liveResults, limit, sort, dateRange);
    const queryTime = Date.now() - start;

    // 5. Cache results
    await setCachedResults(cacheKey, { results, queryTime });

    // 6. Background: Persist live results to DB via QStash
    if (shouldRunLive && liveResults.length > 0) {
      void qstash.publishJSON({
        url: `${process.env.APP_URL}/api/worker/persist-live`,
        body: {
          query: q,
          livePosts: liveResults.map(r => ({
            id: r.id,
            title: r.title,
            content: r.content,
            url: r.url,
            upvotes: r.upvotes,
            author: r.author,
            subreddit: r.subreddit,
            redditCreatedAt: r.redditCreatedAt,
            similarity: r.similarity,
            embedding: r.embedding, // ← RECYCLE: Pass the AI result
          })),
        },
      }).catch(err => console.warn('[search] QStash trigger failed:', err));
    }

    return Response.json({ results, cached: false, queryTime });
  } catch (error: any) {
    console.error('[Search API Error]:', error);
    return Response.json({ 
      error: 'Search failed', 
      details: error.message,
      results: [] 
    }, { status: 500 });
  }
}

// Helper: Performs the DB vector search using an existing query vector
async function semanticSearchWithVector(
  query: string,
  queryVector: number[],
  filters: SearchFilters
): Promise<SearchResult[]> {
  const vecStr = `[${queryVector.join(',')}]`;
  const { limit = 20, minUpvotes = 0, sort = 'relevance', subreddits = [], type = 'all', dateRange = 'all' } = filters;

  let dateFilter: (alias: string) => string;
  if (dateRange !== 'all') {
    const startDate = new Date();
    if (dateRange === 'week') startDate.setDate(new Date().getDate() - 7);
    if (dateRange === 'month') startDate.setMonth(new Date().getMonth() - 1);
    if (dateRange === 'year') startDate.setFullYear(new Date().getFullYear() - 1);
    dateFilter = (alias: string) => `AND ${alias}."redditCreatedAt" >= '${startDate.toISOString()}'`;
  } else {
    dateFilter = () => '';
  }

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
    WHERE similarity >= 0.18
    ORDER BY upvotes DESC, "redditCreatedAt" DESC, similarity DESC
    LIMIT $3
  `, vecStr, minUpvotes, limit, subreddits);
}
