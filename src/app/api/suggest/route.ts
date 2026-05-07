import { prisma } from '@/lib/prisma';
import { redis } from '@/lib/redis';

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const q = searchParams.get('q');

  if (!q || q.length < 2) {
    return Response.json({ suggestions: [] });
  }

  const cacheKey = `suggest:${q.toLowerCase()}`;

  // 1. Try cache first
  const cached = await redis.get(cacheKey);
  if (cached) {
    return Response.json({ suggestions: typeof cached === 'string' ? JSON.parse(cached) : cached, cached: true });
  }

  // 2. Query Postgres for matching titles
  // We look for titles containing the query, ordered by upvotes to get the most "important" topics
  const suggestions = await prisma.post.findMany({
    where: {
      title: {
        contains: q,
        mode: 'insensitive',
      },
    },
    select: {
      title: true,
    },
    distinct: ['title'], // Avoid duplicate suggestions
    orderBy: {
      upvotes: 'desc',
    },
    take: 6,
  });

  const suggestionList = suggestions.map((s) => s.title);

  // 3. Cache for 1 hour
  await redis.set(cacheKey, JSON.stringify(suggestionList), { ex: 3600 });

  return Response.json({ suggestions: suggestionList, cached: false });
}
