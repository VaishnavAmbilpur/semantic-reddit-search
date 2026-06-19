// src/app/api/worker/persist-live/route.ts
import { qstashReceiver } from '@/lib/qstash';
import { generateEmbeddings } from '@/lib/embeddings';
import { getPineconeIndex, upsertVectors, PineconeRecord } from '@/lib/pinecone';
import { redis } from '@/lib/redis';

interface LivePostPayload {
  id:              string;
  title:           string;
  content:         string | null;
  url:             string;
  upvotes:         number;
  author:          string;
  subreddit:       string;
  redditCreatedAt: string;
  similarity:      number;
  embedding?:      number[]; // ← Recycled from search
}

interface WorkerBody {
  query:     string;
  livePosts: LivePostPayload[];
}

export async function POST(req: Request) {
  // 1. Verify QStash Signature
  const sig  = req.headers.get('Upstash-Signature') ?? '';
  const body = await req.text();
  const isValid = await qstashReceiver.verify({ signature: sig, body });
  if (!isValid) return Response.json({ error: 'Unauthorized' }, { status: 401 });

  const { livePosts }: WorkerBody = JSON.parse(body);
  if (!livePosts || livePosts.length === 0) return Response.json({ skipped: true });

  try {
    // 2. Deduplicate (only save posts we don't already have)
    const redditIds = livePosts.map(p => p.id);
    const fetchResponse = await getPineconeIndex().fetch({ ids: redditIds });
    const existingRecords = fetchResponse.records || (fetchResponse as any).vectors || {};
    const existingIds = new Set(Object.keys(existingRecords));
    const newPosts    = livePosts.filter(p => !existingIds.has(p.id));

    if (newPosts.length === 0) return Response.json({ skipped: true, reason: 'already indexed' });

    // 3. Upsert Subreddits in Redis
    for (const post of newPosts) {
      await redis.sadd('subreddits', post.subreddit);
    }

    // 4. Get Vectors (Either from payload or re-embed)
    let vectors: number[][];
    const providedVectors = newPosts.map(p => p.embedding).filter(v => !!v) as number[][];
    
    if (providedVectors.length === newPosts.length) {
      vectors = providedVectors;
    } else {
      const texts = newPosts.map(p => `[POST] ${p.title} ${p.content ?? ''}`.trim());
      vectors = await generateEmbeddings(texts);
    }

    // Storage Protection: Hard cap on total records in Pinecone
    const stats = await getPineconeIndex().describeIndexStats();
    const recordCount = stats.totalRecordCount ?? 0;
    const POST_CAP = 25000;
    if (recordCount >= POST_CAP) {
      console.log('[persist-live] Pinecone record cap reached, skipping persist.');
      return Response.json({ skipped: true, reason: 'db_cap' });
    }

    // 5. Prepare and Upsert records to Pinecone
    const recordsToUpsert: PineconeRecord[] = [];
    for (let i = 0; i < newPosts.length; i++) {
      const post = newPosts[i];
      const vector = vectors[i];
      if (!vector) continue;

      const timestampSeconds = Math.floor(new Date(post.redditCreatedAt).getTime() / 1000);
      recordsToUpsert.push({
        id: post.id,
        values: vector,
        metadata: {
          type: 'post',
          title: post.title,
          content: post.content ? post.content.slice(0, 1000) : '',
          url: post.url,
          upvotes: post.upvotes,
          commentCount: 0,
          author: post.author,
          subreddit: post.subreddit,
          redditCreatedAt: timestampSeconds,
          isNsfw: false,
        }
      });
    }

    if (recordsToUpsert.length > 0) {
      await upsertVectors(recordsToUpsert);
    }

    return Response.json({ success: true, saved: recordsToUpsert.length });
  } catch (error: any) {
    console.error('[persist-live Worker Error]:', error);
    return Response.json({ error: 'Worker execution failed', details: error.message }, { status: 500 });
  }
}
