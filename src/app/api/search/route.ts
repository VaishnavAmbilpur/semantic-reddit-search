import { semanticSearch } from '@/lib/search';
import { getCacheKey, getCachedResults, setCachedResults } from '@/lib/cache';

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const q = searchParams.get('q');
  const minUpvotes = Number(searchParams.get('minUpvotes') ?? 0);
  const limit = Math.min(Number(searchParams.get('limit') ?? 20), 50);
  const sort = (searchParams.get('sort') as any) || 'relevance';
  const type = (searchParams.get('type') as any) || 'all';
  const dateRange = (searchParams.get('dateRange') as any) || 'all';
  const subreddits = searchParams.get('subreddits')?.split(',').filter(Boolean) || [];

  if (!q || q.length < 2) {
    return Response.json({ error: 'Query too short (min 2 chars)' }, { status: 400 });
  }

  const filters = { minUpvotes, limit, sort, type, dateRange, subreddits };
  const key = getCacheKey(q, filters);
  const start = Date.now();

  // Check cache first
  const cached = await getCachedResults(key);
  if (cached) {
    const data = typeof cached === 'string' ? JSON.parse(cached) : cached;
    return Response.json({ results: data, cached: true, queryTime: Date.now() - start });
  }

  // Run semantic search
  const results = await semanticSearch(q, filters);
  await setCachedResults(key, results);

  return Response.json({ results, cached: false, queryTime: Date.now() - start });
}
