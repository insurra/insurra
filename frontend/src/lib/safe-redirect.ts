/**
 * Accepts only same-origin relative paths for post-login redirects. Rejects protocol-relative
 * (`//host`), absolute (`scheme:`), backslash, control-character and auth-loop targets.
 */
export function safeRedirectPath(
  value: string | null | undefined,
  fallback = "/onboarding",
): string {
  if (!value) return fallback;
  if (value.length > 512) return fallback;
  if (!value.startsWith("/") || value.startsWith("//")) return fallback;
  if (value.includes("\\")) return fallback;
  if (/[\u0000-\u001f\u007f]/.test(value)) return fallback;
  if (/^\/+[a-zA-Z][a-zA-Z0-9+.-]*:/.test(value)) return fallback;
  // Percent-encoded slashes or backslashes right after the first slash can be decoded by a
  // browser or proxy into `//` or `/\`.
  if (/^\/(%2f|%5c|%09|%0a|%0d)/i.test(value)) return fallback;
  const path = value.split(/[?#]/, 1)[0];
  if (path === "/auth" || path.startsWith("/auth/")) return fallback;
  return value;
}

/** Builds the sign-in URL that returns the visitor to `path` after authentication. */
export function signInUrl(path: string): string {
  const target = safeRedirectPath(path, "");
  return target ? `/auth?redirect=${encodeURIComponent(target)}` : "/auth";
}
