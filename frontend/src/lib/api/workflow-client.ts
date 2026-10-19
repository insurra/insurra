import { config } from "@/lib/config";

/**
 * Resolves full API URL with fallback to relative URL for Next.js proxy rewrite.
 */
export function getWorkflowUrl(endpoint: string): string {
  const base = config.apiBaseUrl ? config.apiBaseUrl.replace(/\/$/, "") : "";
  const cleanPath = endpoint.startsWith("/") ? endpoint : `/${endpoint}`;
  // In browser, relative URL works with Next.js rewrites; absolute works directly against backend.
  // Using absolute ensures direct connection even if rewrite fails or on server rendering.
  return `${base}${cleanPath}`;
}

/**
 * Retrieves valid authentication headers for workflow API calls.
 * Supports Authenticated Account (Bearer) and Demo Session (X-Demo-Session).
 */
export function getWorkflowHeaders(
  accountToken?: string | null,
  demoToken?: string | null
): Record<string, string> {
  const headers: Record<string, string> = {
    Accept: "application/json",
  };

  if (accountToken) {
    headers["Authorization"] = `Bearer ${accountToken}`;
    return headers;
  }

  const token =
    demoToken ||
    (typeof window !== "undefined"
      ? sessionStorage.getItem("insurra.demo-session") ||
        localStorage.getItem("insurra.demo-session") ||
        localStorage.getItem("insurra_demo_token")
      : null);

  if (token) {
    headers["X-Demo-Session"] = token;
  }

  return headers;
}

/**
 * Ensures an active demo session exists. If not, transparently creates one
 * so demo users navigating directly to /claims or /actions get populated data.
 */
export async function ensureActiveDemoSession(): Promise<string | null> {
  if (typeof window === "undefined") return null;

  const existing =
    sessionStorage.getItem("insurra.demo-session") ||
    localStorage.getItem("insurra.demo-session") ||
    localStorage.getItem("insurra_demo_token");

  if (existing) return existing;

  try {
    const res = await fetch(getWorkflowUrl("/api/v1/demo/sessions"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ persona_id: "raka" }),
    });
    if (!res.ok) return null;
    const data = await res.json();
    if (data.session_token) {
      sessionStorage.setItem("insurra.demo-session", data.session_token);
      localStorage.setItem("insurra.demo-session", data.session_token);
      localStorage.setItem("insurra_demo_token", data.session_token);
      return data.session_token as string;
    }
  } catch (err) {
    console.error("Failed to auto-bootstrap demo session:", err);
  }
  return null;
}
