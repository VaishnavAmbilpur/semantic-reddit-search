import { redis } from './redis';
import { createHash } from 'crypto';

import { SearchFilters, SearchResult } from './search';

export function normalizeQuery(q: string): string {
  return q
    .toLowerCase()
    .trim()
    .replace(/\s+/g, ' ')        // collapse whitespace
    .replace(/[^\w\s]/g, '')     // strip punctuation
    .replace(/\b(\w+)s\b/g, '$1') // naive depluralize: "keyboards" → "keyboard"
    .slice(0, 100);
}

export function getCacheKey(query: string, filters: SearchFilters) {
  const normalized = normalizeQuery(query);
  const hash = createHash('md5').update(JSON.stringify({ query: normalized, filters })).digest('hex');
  return `search:${hash}`;
}

export async function getCachedResults(key: string) {
  return await redis.get(key);
}

export async function setCachedResults(
  key: string,
  data: { results: SearchResult[], queryTime: number },
  dateRange: string = 'all'
) {
  const ttl = dateRange === 'week' ? 1800    // 30 min — recent queries
            : dateRange === 'month' ? 7200   // 2 hours
            : 86400;                         // 24 hours for "all time" / "year"
  await redis.set(key, JSON.stringify(data), { ex: ttl });
}
