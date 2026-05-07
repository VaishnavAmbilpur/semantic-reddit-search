import { prisma } from '@/lib/prisma';
export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const auth = req.headers.get('Authorization');
  if (auth !== `Bearer ${process.env.ADMIN_SECRET}`) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const jobs = await prisma.indexingJob.findMany({
    orderBy: { startedAt: 'desc' },
    include: { subreddit: true },
    take: 50,
  });

  return Response.json({ jobs });
}
