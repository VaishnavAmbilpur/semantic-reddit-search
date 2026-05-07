import { prisma } from '@/lib/prisma';

export async function GET(
  req: Request,
  { params }: { params: Promise<{ jobId: string }> } // Change this to Promise
) {
  // 1. Await the params
  const { jobId } = await params;

  // 2. Fetch the job from the database
  const job = await prisma.indexingJob.findUnique({
    where: { id: jobId },
    include: { subreddit: true },
  });

  if (!job) {
    return Response.json({ error: 'Job not found' }, { status: 404 });
  }

  return Response.json({
    id: job.id,
    subreddit: job.subreddit.name,
    status: job.status,
    chunksCompleted: job.chunksCompleted,
  });
}
