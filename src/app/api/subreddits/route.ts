import { prisma } from '@/lib/prisma';
export const dynamic = 'force-dynamic';

export async function GET() {
  const subreddits = await prisma.subreddit.findMany({
    select: { id: true, name: true, displayName: true, lastIndexed: true },
  });
  return Response.json({ subreddits });
}
