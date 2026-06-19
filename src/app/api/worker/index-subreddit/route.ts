import { qstashReceiver, qstash } from '@/lib/qstash';
import { fetchPosts } from '@/lib/arcticShift';
import { generateEmbeddings } from '@/lib/embeddings';
import { upsertVectors, PineconeRecord } from '@/lib/pinecone';
import { redis } from '@/lib/redis';

export async function POST(req: Request) {
  const sig = req.headers.get('Upstash-Signature') ?? '';
  const body = await req.text();
  const isValid = await qstashReceiver.verify({ signature: sig, body });
  if (!isValid) return Response.json({ error: 'Unauthorized' }, { status: 401 });

  const { jobId, subredditName, beforeTimestamp, maxChunks = 10 } = JSON.parse(body);

  // 0. Check if job was stopped or failed
  const status = await redis.hget<string>(`job:${jobId}`, 'status');
  if (status === 'FAILED') {
    return Response.json({ message: 'Job was stopped' });
  }

  // 1. Fetch 20 posts from ArcticShift
  const posts = await fetchPosts(subredditName, beforeTimestamp, 20);

  if (posts.length > 0) {
    // 2. Prepare text for embeddings
    const postTexts = posts.map(p => {
      const content = p.selftext ? p.selftext.slice(0, 500) : '';
      return `[POST] ${p.title} ${content}`.trim();
    });
    
    // Batch generate embeddings
    const postVectors = await generateEmbeddings(postTexts);

    // 3. Save Posts to Pinecone
    const recordsToUpsert: PineconeRecord[] = [];
    for (let i = 0; i < posts.length; i++) {
      const p = posts[i];
      const vec = postVectors[i];
      if (!vec) continue;

      recordsToUpsert.push({
        id: p.id,
        values: vec,
        metadata: {
          type: 'post',
          title: p.title,
          content: p.selftext ? p.selftext.slice(0, 1000) : '',
          url: `https://reddit.com${p.permalink}`,
          upvotes: p.score,
          commentCount: p.num_comments || 0,
          author: p.author,
          subreddit: subredditName,
          redditCreatedAt: p.created_utc, // unix timestamp in seconds
          isNsfw: p.over_18 || false,
        }
      });
    }

    if (recordsToUpsert.length > 0) {
      await upsertVectors(recordsToUpsert);
      // Add to our Redis subreddits set
      await redis.sadd('subreddits', subredditName);
    }

    // 4. Update job progress in Redis
    await redis.hincrby(`job:${jobId}`, 'chunksCompleted', 1);
    await redis.hset(`job:${jobId}`, { status: 'ACTIVE' });
  }

  // 5. Chain or Finish
  const chunksCompleted = Number(await redis.hget<string>(`job:${jobId}`, 'chunksCompleted') ?? 0);
  const isAtCap = chunksCompleted >= maxChunks;
  const isLastPage = posts.length < 20 || isAtCap;

  if (!isLastPage) {
    const oldestTimestamp = Math.min(...posts.map(p => p.created_utc));
    await qstash.publishJSON({
      url: `${process.env.APP_URL}/api/worker/index-subreddit`,
      body: { jobId, subredditName, beforeTimestamp: oldestTimestamp, maxChunks },
      delay: 15, // Wait 15s to stay under Token-Per-Minute limit
    });
  } else {
    await redis.hset(`job:${jobId}`, { 
      status: 'COMPLETED', 
      completedAt: new Date().toISOString() 
    });
  }

  return Response.json({ success: true, postsProcessed: posts.length });
}
