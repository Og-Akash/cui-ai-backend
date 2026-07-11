/**
 * Tiny in-process TTL cache.
 *
 * Used to avoid re-hitting Postgres for hot, rarely-changing reads
 * (conversation lists, active persona, user profile). Every write path
 * must invalidate the keys it touches — see the route files.
 *
 * Single-process only by design; if the backend ever runs multiple
 * instances, swap this for Redis behind the same interface.
 */

type Entry = { value: unknown; expiresAt: number };

const store = new Map<string, Entry>();
const MAX_ENTRIES = 5000;

export function cacheGet<T>(key: string): T | undefined {
  const entry = store.get(key);
  if (!entry) return undefined;
  if (Date.now() > entry.expiresAt) {
    store.delete(key);
    return undefined;
  }
  return entry.value as T;
}

export function cacheSet(key: string, value: unknown, ttlMs: number): void {
  if (store.size >= MAX_ENTRIES) {
    // Drop the oldest entries (Map preserves insertion order)
    let dropped = 0;
    for (const k of store.keys()) {
      store.delete(k);
      if (++dropped >= 500) break;
    }
  }
  store.set(key, { value, expiresAt: Date.now() + ttlMs });
}

export function cacheDelete(key: string): void {
  store.delete(key);
}

/** Fetch-through helper: returns cached value or runs the loader and caches it. */
export async function cached<T>(key: string, ttlMs: number, loader: () => Promise<T>): Promise<T> {
  const hit = cacheGet<T>(key);
  if (hit !== undefined) return hit;
  const value = await loader();
  cacheSet(key, value, ttlMs);
  return value;
}

// ── Well-known cache keys ────────────────────────────────────────────────────
export const cacheKeys = {
  conversations: (userId: string) => `conversations:${userId}`,
  profile: (userId: string) => `profile:${userId}`,
  activePersona: (userId: string) => `persona:active:${userId}`,
  personas: (userId: string) => `personas:${userId}`,
  userProvisioned: (userId: string) => `user:provisioned:${userId}`,
};
