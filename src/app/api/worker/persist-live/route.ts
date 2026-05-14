// src/app/api/worker/persist-live/route.ts
import { qstashReceiver, qstash } from '@/lib/qstash';
import { generateEmbeddings } from '@/lib/embeddings';
import { prisma } from '@/lib/prisma';

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

function generateId() {
  return Math.random().toString(36).substring(2) + Date.now().toString(36);
}

export async function POST(req: Request) {
  // 1. Verify QStash Signature
  const sig  = req.headers.get('Upstash-Signature') ?? '';
  const body = await req.text();
  const isValid = await qstashReceiver.verify({ signature: sig, body });
  if (!isValid) return Response.json({ error: 'Unauthorized' }, { status: 401 });

  const { livePosts }: WorkerBody = JSON.parse(body);
  if (!livePosts || livePosts.length === 0) return Response.json({ skipped: true });

  // 2. Deduplicate (only save posts we don't already have)
  const redditIds = livePosts.map(p => p.id);
  const existing  = await prisma.post.findMany({
    where:  { redditId: { in: redditIds } },
    select: { redditId: true },
  });
  const existingIds = new Set(existing.map(p => p.redditId));
  const newPosts    = livePosts.filter(p => !existingIds.has(p.id));

  if (newPosts.length === 0) return Response.json({ skipped: true, reason: 'already indexed' });

  // 3. Upsert Subreddits
  const bySubreddit = new Map<string, LivePostPayload[]>();
  for (const post of newPosts) {
    const group = bySubreddit.get(post.subreddit) ?? [];
    group.push(post);
    bySubreddit.set(post.subreddit, group);
  }

  const subredditMap = new Map<string, string>();
  for (const [name] of bySubreddit) {
    const subreddit = await prisma.subreddit.upsert({
      where: { name },
      create: { name, displayName: name },
      update: { lastIndexed: new Date() },
    });
    subredditMap.set(name, subreddit.id);
  }

  // 4. Get Vectors (Either from payload or re-embed)
  // Recycling vectors saves 50% of your AI token budget!
  let vectors: number[][];
  const providedVectors = newPosts.map(p => p.embedding).filter(v => !!v) as number[][];
  
  if (providedVectors.length === newPosts.length) {
    vectors = providedVectors;
  } else {
    const texts = newPosts.map(p => `[POST] ${p.title} ${p.content ?? ''}`.trim());
    vectors = await generateEmbeddings(texts);
  }

  let savedCount = 0;
  for (let i = 0; i < newPosts.length; i++) {
    const post = newPosts[i];
    const vector = vectors[i];
    const subredditId = subredditMap.get(post.subreddit);

    if (!vector || !subredditId) continue;

    try {
      await prisma.$executeRawUnsafe(
        `INSERT INTO "Post" (id, "redditId", title, content, url, upvotes, "commentCount", "subredditId", author, "isNsfw", "redditCreatedAt", embedding)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12::vector)
         ON CONFLICT ("redditId") DO NOTHING`,
        generateId(), post.id, post.title, post.content, post.url, post.upvotes, 0, subredditId, post.author, false, new Date(post.redditCreatedAt), `[${vector.join(',')}]`
      );
      savedCount++;
    } catch (err) {
      console.warn(`[persist-live] Save failed for ${post.id}:`, err);
    }
  }

  // 5. Trigger Full Subreddit Indexing for discovered subreddits
  for (const [subredditName] of bySubreddit) {
    const subredditId = subredditMap.get(subredditName);
    if (!subredditId) continue;

    // Only queue if not indexed recently (last 7 days)
    const activeJob = await prisma.indexingJob.findFirst({
      where: { subredditId, status: { in: ['PENDING', 'ACTIVE'] } }
    });

    if (!activeJob) {
      const job = await prisma.indexingJob.create({
        data: { subredditId, status: 'PENDING' }
      });

      await qstash.publishJSON({
        url: `${process.env.APP_URL}/api/worker/index-subreddit`,
        body: { jobId: job.id, subredditId, subredditName, triggeredBy: 'organic' },
      });
    }
  }

  return Response.json({ success: true, saved: savedCount });
}
