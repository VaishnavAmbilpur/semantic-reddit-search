import { prisma } from '@/lib/prisma';

export async function GET(req: Request) {
  // 1. Verify Admin Secret
  const auth = req.headers.get('Authorization');
  if (auth !== `Bearer ${process.env.ADMIN_SECRET}`) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const [total, noResults, avgTime, topQueries] = await Promise.all([
      prisma.searchEvent.count(),
      prisma.searchEvent.count({ where: { hasResults: false } }),
      prisma.searchEvent.aggregate({ _avg: { queryTime: true } }),
      prisma.searchEvent.groupBy({
        by: ['query'],
        _count: { query: true },
        orderBy: { _count: { query: 'desc' } },
        take: 20,
      }),
    ]);

    return Response.json({ 
      total, 
      noResults, 
      avgTime: Math.round(avgTime._avg.queryTime ?? 0), 
      topQueries: topQueries.map(q => ({
        query: q.query,
        count: q._count.query
      }))
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return Response.json({ error: 'Failed to fetch analytics', details: message }, { status: 500 });
  }
}
