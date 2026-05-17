import { redis } from '@/lib/redis';
import { NextResponse } from 'next/server';

export const revalidate = 0; // Ensure fresh data on every request

export async function GET() {
  try {
    const remaining = await redis.get<number>('global_searches_remaining');
    
    if (remaining === null) {
      // Initialize to 100 if it doesn't exist
      await redis.set('global_searches_remaining', 100);
      return NextResponse.json({ searchesRemaining: 100 });
    }
    
    return NextResponse.json({ searchesRemaining: remaining });
  } catch (error) {
    console.error('[Stats API Error]:', error);
    return NextResponse.json({ error: 'Failed to fetch stats' }, { status: 500 });
  }
}
