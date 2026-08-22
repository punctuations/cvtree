export const CACHE_SCHEMA_VERSION = 3;

export const CACHE_TTL_MS = 6 * 60 * 60 * 1000;

export const EVICTION_BATCH = 200;

export function keyPrefix(): string {
  return `v${CACHE_SCHEMA_VERSION}:`;
}

export function isCurrent(key: string): boolean {
  return key.startsWith(keyPrefix());
}

export function isFresh(fetchedAt: number, now: number): boolean {
  return now - fetchedAt <= CACHE_TTL_MS;
}
