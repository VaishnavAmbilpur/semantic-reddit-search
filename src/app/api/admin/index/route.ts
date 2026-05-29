import { validateSubreddit } from '@/lib/arcticShift';
import { prisma } from '@/lib/prisma';
import { qstash } from '@/lib/qstash';

export async function POST(req: Request) {
  // 1. Verify Admin Secret
  const auth = req.headers.get('Authorization');
  if (auth !== `Bearer ${process.env.ADMIN_SECRET}`) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { name, maxChunks = 10 } = await req.json();

  // 2. Validate subreddit via Arctic Shift
  const meta = await validateSubreddit(name);
  if (!meta) return Response.json({ error: 'Subreddit not found' }, { status: 400 });

  // 3. Upsert Subreddit & Create Job
  const subreddit = await prisma.subreddit.upsert({
    where: { name },
    create: { name, displayName: meta.display_name ?? name },
    update: {},
  });

  const job = await prisma.indexingJob.create({
    data: { subredditId: subreddit.id, status: 'PENDING' },
  });

  // Trigger the first worker call via QStash with 1 hour delay to avoid active demo hours.
  await qstash.publishJSON({
    url: `${process.env.APP_URL}/api/worker/index-subreddit`,
    body: { jobId: job.id, subredditId: subreddit.id, subredditName: name, maxChunks },
    delay: 3600,
  });

  return Response.json({ jobId: job.id, subreddit: name }, { status: 202 });
}
