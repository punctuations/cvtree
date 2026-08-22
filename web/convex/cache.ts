export const CACHE_TTL_MS = 6 * 60 * 60 * 1000;

export const EVICTION_BATCH = 200;

export function isFresh(fetchedAt: number, now: number): boolean {
  return now - fetchedAt <= CACHE_TTL_MS;
}
