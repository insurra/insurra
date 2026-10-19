/**
 * Browser-side caches that can hold persona or account specific data. They are never
 * authoritative; the server context is. Clear them on logout, account deletion and persona switch
 * so one persona or account cannot leak into the next.
 */
const PROFILE_CACHE_KEYS = ["insurra.active-profile", "insurra.demo-documents"];
const PROFILE_CACHE_PREFIXES = ["insurra.demo-doc-detail."];

function purge(storage: Storage) {
  const keys: string[] = [];
  for (let index = 0; index < storage.length; index += 1) {
    const key = storage.key(index);
    if (key) keys.push(key);
  }
  for (const key of keys) {
    if (
      PROFILE_CACHE_KEYS.includes(key) ||
      PROFILE_CACHE_PREFIXES.some((prefix) => key.startsWith(prefix))
    ) {
      storage.removeItem(key);
    }
  }
}

export function clearProfileCaches() {
  if (typeof window === "undefined") return;
  for (const storage of [window.localStorage, window.sessionStorage]) {
    try {
      purge(storage);
    } catch {
      // Storage may be unavailable in private browsing.
    }
  }
}
