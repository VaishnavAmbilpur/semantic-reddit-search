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

  const { jobId, subredditId, subredditName, beforeTimestamp } = JSON.parse(body);

  // 0. Check if job was stopped by Admin
  const job = await prisma.indexingJob.findUnique({ where: { id: jobId } });
  if (!job || job.status === 'FAILED') {
    return Response.json({ message: 'Job was stopped' });
  }

  // 1. Fetch 50 posts
  const posts = await fetchPosts(subredditName, beforeTimestamp, 50);

  if (posts.length > 0) {
    // 2. Fetch top 5 comments for each post
    const commentsData = await Promise.all(
      posts.map(async (p) => {
        const comments = await fetchComments(p.id, 5);
        return comments.map(c => ({ ...c, internalPostId: p.id }));
      })
    );
    const allComments = commentsData.flat();

    // 3. Prepare all texts for embedding (Posts + Comments)
    const postTexts = posts.map(p => `[POST] ${p.title} ${p.selftext ?? ''}`);
    const commentTexts = allComments.map(c => `[COMMENT] ${c.body}`);
    
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
    for (let i = 0; i < allComments.length; i++) {
      const c = allComments[i];
      const vec = `[${commentVectors[i].join(',')}]`;
      
      // We need the internal DB ID of the post, so we look it up by redditId
      const post = await prisma.post.findUnique({ where: { redditId: c.internalPostId }, select: { id: true } });
      if (!post) continue;

      await prisma.$executeRawUnsafe(
        `INSERT INTO "Comment" (id, "redditId", content, upvotes, author, "postId", "redditCreatedAt", embedding)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8::vector)
        ON CONFLICT ("redditId") DO NOTHING`,
        generateId(), c.id, c.body, c.score, c.author, post.id, new Date(c.created_utc * 1000), vec
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
  const isLastPage = posts.length < 50;
  if (!isLastPage) {
    const oldestTimestamp = Math.min(...posts.map(p => p.created_utc));
    await qstash.publishJSON({
      url: `${process.env.APP_URL}/api/worker/index-subreddit`,
      body: { jobId, subredditId, subredditName, beforeTimestamp: oldestTimestamp },
    });
  } else {
    const finalCheck = await prisma.indexingJob.findUnique({ where: { id: jobId } });
    if (finalCheck?.status !== 'FAILED') {
      await prisma.indexingJob.update({
        where: { id: jobId },
        data: { status: 'COMPLETED', completedAt: new Date() },
      });
    }
  }

  return Response.json({ success: true, postsProcessed: posts.length });
}
