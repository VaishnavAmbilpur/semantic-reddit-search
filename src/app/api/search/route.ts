// src/app/api/search/route.ts
import { vectorSearch, mergeAndRank } from '@/lib/search';
import { generateQueryEmbedding, generateSearchEmbeddings, rerankResults, generateQueryAndPostEmbeddings } from '@/lib/embeddings';
import { getCacheKey, getCachedResults, setCachedResults, normalizeQuery } from '@/lib/cache';
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

  const normalizedQ = normalizeQuery(q);

  const filters = { minUpvotes, limit, sort, type, dateRange, subreddits };
  const refresh = searchParams.get('refresh') === 'true';
  const cacheKey = getCacheKey(normalizedQ, filters);
  const start = Date.now();

  // 1. Check Cache (Skip if refresh is requested)
  if (!refresh) {
    const cached = await getCachedResults(cacheKey);
    if (cached) {
      const data = typeof cached === 'string' ? JSON.parse(cached) : (cached as { results: SearchResult[]; queryTime: number });
      

      return Response.json({ 
        results: data.results, 
        cached: true, 
        queryTime: data.queryTime || (Date.now() - start),
        timings: { cache: 0 }
      });
    }
  }

  // 1.5 Per-IP Search Limit Check (20 searches per IP per day)
  const ip = req.headers.get('x-forwarded-for') ?? 'unknown';
  const ipKey = `ratelimit:${ip}`;
  const ipCount = await redis.get<number>(ipKey) ?? 0;

  if (ipCount >= 20) {
    return Response.json({ 
      error: 'Daily limit reached for your IP',
      details: 'You have reached the daily limit of 20 searches. Please try again tomorrow.'
    }, { status: 429 });
  }

  await redis.set(ipKey, ipCount + 1, { ex: 86400 });

  try {
    const timings: Record<string, number> = {};
    const t = (label: string, startT: number) => { timings[label] = Date.now() - startT; };

    // 2. Parallelize DB search & live fetches using query embedding cache
    const shouldRunLive = subreddits.length === 0 && type !== 'comment';

    const fetchRawLivePosts = async () => {
      if (!shouldRunLive) return [];
      console.log(`[Search] Using Google Strategy for: ${q}`);
      const [googleResults, arcticResults] = await Promise.all([
        searchGoogleReddit(q, 30),
        searchPostsGlobal(q, 15)
      ]);
      
      const seenIds = new Set<string>();
      const posts: ArcticPost[] = [];
      [...googleResults, ...arcticResults].forEach(p => {
        if (!seenIds.has(p.id)) {
          seenIds.add(p.id);
          posts.push(p);
        }
      });
      return posts;
    };

    // Start live fetch immediately (no HF dependency)
    const tLiveFetchStart = Date.now();
    const livePostsPromise = fetchRawLivePosts();

    // Check query embedding cache
    const cacheKeyQueryVec = `qvec:${normalizedQ}`;
    const cachedVector = await redis.get<number[]>(cacheKeyQueryVec);

    let queryVector: number[];
    let liveResults: SearchResult[] = [];
    let dbResults: SearchResult[] = [];

    const t0 = Date.now();
    if (cachedVector) {
      console.log(`[AI] Found cached query embedding for: "${normalizedQ}"`);
      queryVector = cachedVector;
      t('embedding', t0);

      // Run DB search and wait for live fetches in parallel
      const tFetchStart = Date.now();
      const [rawPosts, dbSearchResults] = await Promise.all([
        livePostsPromise,
        refresh ? Promise.resolve([]) : vectorSearch(queryVector, filters)
      ]);
      dbResults = dbSearchResults;
      t('fetch', tFetchStart);

      if (rawPosts.length > 0) {
        // Cut to 15 candidates
        const topPosts = rawPosts.slice(0, 15);
        // Truncate post text harder (2.3)
        const texts = topPosts.map((p: ArcticPost) => {
          const body = p.selftext ? ` ${p.selftext.slice(0, 200)}` : '';
          return `${p.title}${body}`.slice(0, 400);
        });

        console.log(`[AI] Generating embeddings for ${topPosts.length} live posts...`);
        const tLiveEmbedStart = Date.now();
        const vectors = await generateSearchEmbeddings(texts);
        t('live_embedding', tLiveEmbedStart);

        liveResults = topPosts.map((p: ArcticPost, i: number) => ({
          id: p.id,
          type: 'post' as const,
          title: p.title,
          content: p.selftext,
          url: p.permalink.startsWith('http') ? p.permalink : `https://reddit.com${p.permalink}`,
          upvotes: p.score,
          commentCount: p.num_comments || 0,
          author: p.author,
          subreddit: p.subreddit,
          redditCreatedAt: typeof p.created_utc === 'number' ? new Date(p.created_utc * 1000).toISOString() : new Date().toISOString(),
          similarity: cosineSimilarity(queryVector, vectors[i]),
          isLive: true,
          embedding: vectors[i]
        }));
      }
    } else {
      // Cache miss for query embedding. Wait for live results, then batch-embed query + posts (2.1)
      console.log(`[AI] Query embedding cache miss for: "${normalizedQ}". Merging query and post embeddings.`);
      const tFetchRawStart = Date.now();
      const rawPosts = await livePostsPromise;
      t('live_fetch_raw', tFetchRawStart);

      if (rawPosts.length > 0) {
        const topPosts = rawPosts.slice(0, 15);
        const texts = topPosts.map((p: ArcticPost) => {
          const body = p.selftext ? ` ${p.selftext.slice(0, 200)}` : '';
          return `${p.title}${body}`.slice(0, 400);
        });

        // Generate query + post embeddings in ONE batch call
        const tBatchEmbedStart = Date.now();
        const { queryVector: qVec, postVectors } = await generateQueryAndPostEmbeddings(normalizedQ, texts);
        queryVector = qVec;
        t('batch_embedding', tBatchEmbedStart);

        // Run DB search with the newly obtained vector
        const tDbSearchStart = Date.now();
        dbResults = refresh ? [] : await vectorSearch(queryVector, filters);
        t('db_search', tDbSearchStart);

        liveResults = topPosts.map((p: ArcticPost, i: number) => ({
          id: p.id,
          type: 'post' as const,
          title: p.title,
          content: p.selftext,
          url: p.permalink.startsWith('http') ? p.permalink : `https://reddit.com${p.permalink}`,
          upvotes: p.score,
          commentCount: p.num_comments || 0,
          author: p.author,
          subreddit: p.subreddit,
          redditCreatedAt: typeof p.created_utc === 'number' ? new Date(p.created_utc * 1000).toISOString() : new Date().toISOString(),
          similarity: cosineSimilarity(queryVector, postVectors[i]),
          isLive: true,
          embedding: postVectors[i]
        }));
      } else {
        // No live posts fetched, generate query embedding individually
        const tQueryEmbedStart = Date.now();
        queryVector = await generateQueryEmbedding(normalizedQ);
        t('query_embedding', tQueryEmbedStart);
        
        const tDbSearchStart = Date.now();
        dbResults = refresh ? [] : await vectorSearch(queryVector, filters);
        t('db_search', tDbSearchStart);
      }
    }

    // 4. Merge and Initial Rank
    const results = mergeAndRank(dbResults, liveResults, limit, sort, dateRange);

    // 5. SECOND PASS: Hugging Face Reranker (DISABLED until DB reaches scale)
    /*
    const topSimilarity = results[0]?.similarity ?? 0;
    const shouldRerank = results.length > 3 && dbResults.length > 0 && topSimilarity < 0.75;

    if (shouldRerank) {
      const docsToRerank = results.slice(0, 10).map(r => {
        const text = `${r.title || ''} ${r.content || ''}`.trim().slice(0, 1000);
        return {
          id: r.id,
          text: text.length > 0 ? text : 'No content available'
        };
      });

      console.log(`[AI] Reranking ${docsToRerank.length} results for maximum precision (top similarity: ${topSimilarity.toFixed(4)} < 0.75)...`);
      const reranked = await rerankResults(q, docsToRerank);
      
      const scoreMap = new Map(reranked.map(r => [r.id, r.score]));
      results = results.map(r => ({
        ...r,
        similarity: scoreMap.get(r.id) || r.similarity
      }));
      
      if (sort === 'relevance') {
        results.sort((a, b) => b.similarity - a.similarity);
      }
    } else {
      console.log(`[AI] Skipped reranking. Results length: ${results.length}, dbResults length: ${dbResults.length}, topSimilarity: ${topSimilarity.toFixed(4)}`);
    }
    */

    // Sort according to date range (Anytime vs Recent)
    if (dateRange !== 'all') {
      results.sort((a, b) => new Date(b.redditCreatedAt).getTime() - new Date(a.redditCreatedAt).getTime());
    } else if (sort === 'relevance') {
      results.sort((a, b) => b.similarity - a.similarity);
    } else {
      results.sort((a, b) => b.upvotes - a.upvotes);
    }

    // Force Live results to always be at the top
    results.sort((a, b) => {
      if (a.isLive && !b.isLive) return -1;
      if (!a.isLive && b.isLive) return 1;
      return 0; // maintain relative order among live and among DB results
    });

    const queryTime = Date.now() - start;
    timings['total'] = queryTime;

    // 6. Cache results
    await setCachedResults(cacheKey, { results, queryTime });


    // 6. Background: Persist live results to DB via QStash
    if (shouldRunLive && liveResults.length > 0) {
      void qstash.publishJSON({
        url: `${process.env.APP_URL}/api/worker/persist-live`,
        body: {
          query: normalizedQ,
          livePosts: liveResults
            .filter(r => r.upvotes >= 50) // Storage Optimization: Only save quality posts to Prisma Postgres
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

    return Response.json({ results, cached: false, queryTime, timings });
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
