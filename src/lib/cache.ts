import { redis } from './redis';
import { createHash } from 'crypto';

import { SearchFilters, SearchResult } from './search';

export function getCacheKey(query: string, filters: SearchFilters) {
  const hash = createHash('md5').update(JSON.stringify({ query, filters })).digest('hex');
  return `search:${hash}`;
}

export async function getCachedResults(key: string) {
  return await redis.get(key);
}

export async function setCachedResults(key: string, data: { results: SearchResult[], queryTime: number }) {
  await redis.set(key, JSON.stringify(data), { ex: 300 }); // 5 min TTL
}
