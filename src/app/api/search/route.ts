// src/app/api/search/route.ts
import { semanticSearchWithVector, mergeAndRank } from '@/lib/search';
import { generateQueryEmbedding, generateSearchEmbeddings, rerankResults } from '@/lib/embeddings';
import { getCacheKey, getCachedResults, setCachedResults } from '@/lib/cache';
import { qstash } from '@/lib/qstash';
import { redis } from '@/lib/redis';
import { SearchResult } from '@/lib/search';
import { searchGoogleReddit } from '@/lib/googleSearch';
import { searchPostsGlobal, ArcticPost } from '@/lib/arcticShift';
import { cosineSimilarity } from '@/lib/utils';

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const q          = searchParams.get('q')?.trim();
  
  // 0. Environment & Input Validation
  if (!(process.env.HF_API_KEY || process.env.HUGGINGFACE_API_KEY) || !process.env.SERPAPI_API_KEY) {
    console.error('[Search] Deployment Error: Missing API Keys in Environment');
    return Response.json({ error: 'System Configuration Error: Missing API Keys' }, { status: 500 });
  }

  if (!q || q.length < 2) {
    return Response.json({ error: 'Query too short' }, { status: 400 });
  }

  const minUpvotes = Number(searchParams.get('minUpvotes') ?? 0);
  const limit      = Math.min(Number(searchParams.get('limit') ?? 25), 50); 
  const sort       = (searchParams.get('sort') as 'relevance' | 'top') || 'relevance';
  const type       = (searchParams.get('type') as 'post' | 'comment' | 'all') || 'all';
  const dateRange  = (searchParams.get('dateRange') as 'week' | 'month' | 'year' | 'all') || 'all';
  const subreddits = searchParams.get('subreddits')?.split(',').filter(Boolean) || [];

  const filters = { minUpvotes, limit, sort, type, dateRange, subreddits };
  const refresh = searchParams.get('refresh') === 'true';
  const cacheKey = getCacheKey(q, filters);
  const start = Date.now();

  // 1. Check Cache (Skip if refresh is requested)
  if (!refresh) {
    const cached = await getCachedResults(cacheKey);
    if (cached) {
      const data = typeof cached === 'string' ? JSON.parse(cached) : (cached as { results: SearchResult[]; queryTime: number });
      return Response.json({ 
        results: data.results, 
        cached: true, 
        queryTime: data.queryTime || (Date.now() - start) 
      });
    }
  }

  // 1.5 Global Search Limit Check
  let searchesRemaining = await redis.get<number>('global_searches_remaining');
  if (searchesRemaining === null) {
    await redis.set('global_searches_remaining', 100);
    searchesRemaining = 100;
  }
  
  if (searchesRemaining <= 0) {
    return Response.json({ 
      error: 'Global Search Limit Reached',
      details: 'The global pool of 100 searches has been exhausted. Please wait for the next reset.'
    }, { status: 403 });
  }

  // Decrement the global counter
  await redis.decr('global_searches_remaining');

  try {
    // 2. Embed query ONCE for both lanes
    console.log(`[AI] Generating query embedding for: "${q}"`);
    const queryVector = await generateQueryEmbedding(q);

    // 3. Run lanes in parallel
    const shouldRunLive = subreddits.length === 0 && type !== 'comment';

    // GOOGLE STRATEGY: Fetch from Google (via SerpApi) + Fallback to ArcticShift
    const fetchLive = async () => {
      if (!shouldRunLive) return [];
      
      console.log(`[Search] Using Google Strategy for: ${q}`);
      
      // Fetch fewer results for production speed (Vercel 10s limit)
      const [googleResults, arcticResults] = await Promise.all([
        searchGoogleReddit(q, 30),
        searchPostsGlobal(q, 15)
      ]);
      
      // Merge and Deduplicate by ID
      const seenIds = new Set<string>();
      const posts: ArcticPost[] = [];
      
      [...googleResults, ...arcticResults].forEach(p => {
        if (!seenIds.has(p.id)) {
          seenIds.add(p.id);
          posts.push(p);
        }
      });

      // Optimization: Limit to top 20 candidates for AI processing (Saves Tokens)
      const topPosts = posts.slice(0, 20);

      // Score and convert to SearchResult format
      const texts = topPosts.map((p: ArcticPost) => `${p.title} ${p.selftext || ''}`.slice(0, 600));
      
      console.log(`[AI] Generating embeddings for ${topPosts.length} live posts...`);
      const vectors = await generateSearchEmbeddings(texts);
      
      return topPosts.map((p: ArcticPost, i: number) => ({
        id: p.id,
        type: 'post' as const,
        title: p.title,
        content: p.selftext,
        url: p.permalink.startsWith('http') ? p.permalink : `https://reddit.com${p.permalink}`,
        upvotes: p.score,
        author: p.author,
        subreddit: p.subreddit,
        redditCreatedAt: typeof p.created_utc === 'number' ? new Date(p.created_utc * 1000).toISOString() : new Date().toISOString(),
        similarity: cosineSimilarity(queryVector, vectors[i]),
        isLive: true,
        embedding: vectors[i]
      }));
    };

    const [dbResults, liveResults] = await Promise.all([
      refresh ? Promise.resolve([]) : semanticSearchWithVector(queryVector, filters),
      fetchLive(),
    ]);

    // 4. Merge and Initial Rank
    let results = mergeAndRank(dbResults, liveResults, limit, sort, dateRange);

    // 5. SECOND PASS: Hugging Face Reranker (The Accuracy Booster)
    // We rerank the top candidates to ensure the best answers are at the absolute top
    if (results.length > 1) {
      const docsToRerank = results.slice(0, 10).map(r => {
        const text = `${r.title || ''} ${r.content || ''}`.trim().slice(0, 1000);
        return {
          id: r.id,
          text: text.length > 0 ? text : 'No content available'
        };
      });

      console.log(`[AI] Reranking ${docsToRerank.length} results for maximum precision...`);
      const reranked = await rerankResults(q, docsToRerank);
      
      // Update scores and re-sort
      const scoreMap = new Map(reranked.map(r => [r.id, r.score]));
      results = results.map(r => ({
        ...r,
        similarity: scoreMap.get(r.id) || r.similarity
      }));
      
      // If user chose 'relevance', the rerank score is now our primary sort
      if (sort === 'relevance') {
        results.sort((a, b) => b.similarity - a.similarity);
      }
    }

    const queryTime = Date.now() - start;

    // 6. Cache results
    await setCachedResults(cacheKey, { results, queryTime });

    // 6. Background: Persist live results to DB via QStash
    if (shouldRunLive && liveResults.length > 0) {
      void qstash.publishJSON({
        url: `${process.env.APP_URL}/api/worker/persist-live`,
        body: {
          query: q,
          livePosts: liveResults
            .filter(r => r.upvotes >= 5) // Storage Optimization: Only save quality posts to Neon
            .map((r: SearchResult) => ({
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
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('[Search API Error]:', error);
    return Response.json({ 
      error: 'Search failed', 
      details: message,
      results: [] 
    }, { status: 500 });
  }
}
