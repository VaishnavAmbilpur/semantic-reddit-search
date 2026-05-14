import { prisma } from '@/lib/prisma';
export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const subreddits = await prisma.subreddit.findMany({
      select: { id: true, name: true, displayName: true, lastIndexed: true },
    });
    return Response.json({ subreddits });
  } catch (error) {
    console.error('[Subreddits API Error]:', error);
    return Response.json({ subreddits: [], error: 'Failed to fetch subreddits' }, { status: 500 });
  }
}
