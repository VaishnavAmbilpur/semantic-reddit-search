import { qstashReceiver, qstash } from '@/lib/qstash';
import { fetchPosts, fetchComments } from '@/lib/arcticShift';
import { generateEmbeddings } from '@/lib/embeddings';
import { prisma } from '@/lib/prisma';

function generateId() {
  return Math.random().toString(36).substring(2) + Date.now().toString(36);
}

export async function POST(req: Request) {
  const sig = req.headers.get('Upstash-Signature') ?? '';
  const body = await req.text();
  const isValid = await qstashReceiver.verify({ signature: sig, body });
  if (!isValid) return Response.json({ error: 'Unauthorized' }, { status: 401 });

  const { jobId, subredditId, subredditName, beforeTimestamp, maxChunks = 10 } = JSON.parse(body);

  // 0. Check if job was stopped by Admin
  const job = await prisma.indexingJob.findUnique({ where: { id: jobId } });
  if (!job || job.status === 'FAILED') {
    return Response.json({ message: 'Job was stopped' });
  }

  // 1. Fetch 20 posts (Reduced from 50 to save tokens)
  const posts = await fetchPosts(subredditName, beforeTimestamp, 20);

  if (posts.length > 0) {
    // Disabled: comment indexing is disabled to save free tier operations.
    const allComments: any[] = [];

    // 3. Prepare all texts for embedding (Posts + Comments)
    // TRUNCATION: Save tokens by only embedding the first 500 chars
    const postTexts = posts.map(p => {
      const content = p.selftext ? p.selftext.slice(0, 500) : '';
      return `[POST] ${p.title} ${content}`.trim();
    });
    
    const commentTexts = allComments.map(c => {
      const body = c.body ? c.body.slice(0, 500) : '';
      return `[COMMENT] ${body}`.trim();
    });
    
    // Batch generate embeddings for everything
    const allVectors = await generateEmbeddings([...postTexts, ...commentTexts]);
    
    const postVectors = allVectors.slice(0, posts.length);
    const commentVectors = allVectors.slice(posts.length);

    // 4. Save Posts
    for (let i = 0; i < posts.length; i++) {
      const p = posts[i];
      const vec = `[${postVectors[i].join(',')}]`;
      await prisma.$executeRawUnsafe(
        `INSERT INTO "Post" (id, "redditId", title, content, url, upvotes, "commentCount",
          "subredditId", author, "isNsfw", "redditCreatedAt", embedding)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12::vector)
        ON CONFLICT ("redditId") DO NOTHING`,
        generateId(), p.id, p.title, p.selftext ?? null, `https://reddit.com${p.permalink}`,
        p.score, p.num_comments, subredditId, p.author, p.over_18, new Date(p.created_utc * 1000), vec
      );
    }

    // 5. Save Comments
    // Collect all redditIds from this chunk's posts
    const redditIds = posts.map(p => p.id);
    // One query instead of 60
    const postRecords = await prisma.post.findMany({
      where: { redditId: { in: redditIds } },
      select: { id: true, redditId: true },
    });
    const postIdMap = new Map(postRecords.map(p => [p.redditId, p.id]));

    for (let i = 0; i < allComments.length; i++) {
      const c = allComments[i];
      const vec = `[${commentVectors[i].join(',')}]`;
      
      const internalPostId = postIdMap.get(c.internalPostId);
      if (!internalPostId) continue;

      await prisma.$executeRawUnsafe(
        `INSERT INTO "Comment" (id, "redditId", content, upvotes, author, "postId", "redditCreatedAt", embedding)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8::vector)
        ON CONFLICT ("redditId") DO NOTHING`,
        generateId(), c.id, c.body, c.score, c.author, internalPostId, new Date(c.created_utc * 1000), vec
      );
    }

    // 6. Update job progress only if it hasn't been stopped
    const currentJob = await prisma.indexingJob.findUnique({ where: { id: jobId } });
    if (currentJob?.status !== 'FAILED') {
      await prisma.indexingJob.update({
        where: { id: jobId },
        data: { chunksCompleted: { increment: 1 }, status: 'ACTIVE' },
      });
    }
  }

  // 7. Chain or Finish
  const finalCheck = await prisma.indexingJob.findUnique({ where: { id: jobId } });
  const isAtCap = finalCheck ? finalCheck.chunksCompleted >= maxChunks : false;
  const isLastPage = posts.length < 20 || isAtCap;

  if (!isLastPage) {
    const oldestTimestamp = Math.min(...posts.map(p => p.created_utc));
    await qstash.publishJSON({
      url: `${process.env.APP_URL}/api/worker/index-subreddit`,
      body: { jobId, subredditId, subredditName, beforeTimestamp: oldestTimestamp, maxChunks },
      delay: 15, // Wait 15s to stay under Token-Per-Minute limit
    });
  } else {
    if (finalCheck && finalCheck.status !== 'FAILED') {
      await prisma.indexingJob.update({
        where: { id: jobId },
        data: { status: 'COMPLETED', completedAt: new Date() },
      });
    }
  }

  return Response.json({ success: true, postsProcessed: posts.length });
}
