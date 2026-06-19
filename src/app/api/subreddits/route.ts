import { redis } from '@/lib/redis';
export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const subredditNames = await redis.smembers('subreddits');
    const subreddits = subredditNames.map(name => ({
      id: name,
      name,
      displayName: name,
      lastIndexed: new Date().toISOString(),
    }));
    return Response.json({ subreddits });
  } catch (error) {
    console.error('[Subreddits API Error]:', error);
    return Response.json({ subreddits: [], error: 'Failed to fetch subreddits' }, { status: 500 });
  }
}
