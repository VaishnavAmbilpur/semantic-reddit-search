import { prisma } from './prisma';

export async function logSearch(data: {
  query: string;
  resultCount: number;
  queryTime: number;
  cacheHit: boolean;
}) {
  try {
    await prisma.searchEvent.create({
      data: {
        query: data.query,
        resultCount: data.resultCount,
        queryTime: data.queryTime,
        cacheHit: data.cacheHit,
        hasResults: data.resultCount > 0,
      },
    });
  } catch (error) {
    // Never let analytics break the search
    console.error('[Analytics Error]: Failed to log search:', error);
  }
}
