import { config } from "@/lib/config";
import type { components } from "@/lib/api/types.gen";

export type WorkflowActionView = components["schemas"]["WorkflowActionView"];
export type WorkflowActionQueueResponse = components["schemas"]["WorkflowActionQueueResponse"];
export type WorkflowExecutionReceipt = components["schemas"]["WorkflowExecutionReceipt"];
export type WorkflowExecuteResponse = components["schemas"]["WorkflowExecuteResponse"];
export type WorkflowAuditEvent = components["schemas"]["WorkflowAuditEvent"];
export type WorkflowAuditTimelineResponse = components["schemas"]["WorkflowAuditTimelineResponse"];
export type CreateActionRequest = components["schemas"]["CreateActionRequest"];
export type ApproveActionRequest = components["schemas"]["ApproveActionRequest"];
export type EditActionRequest = components["schemas"]["EditActionRequest"];

/**
 * Resolves full API URL with fallback to relative URL for Next.js proxy rewrite.
 */
export function getWorkflowUrl(endpoint: string): string {
  const base = config.apiBaseUrl ? config.apiBaseUrl.replace(/\/$/, "") : "";
  const cleanPath = endpoint.startsWith("/") ? endpoint : `/${endpoint}`;
  return `${base}${cleanPath}`;
}

const DEMO_TOKEN_KEY = "insurra.demo-session";
// Earlier builds also copied the demo token into localStorage. Remove those copies on load.
const LEGACY_DEMO_TOKEN_KEYS = ["insurra.demo-session", "insurra_demo_token"];

/** Deletes legacy persistent copies of the demo token. Safe to call repeatedly. */
export function purgeLegacyDemoTokens(): void {
  if (typeof window === "undefined") return;
  try {
    for (const key of LEGACY_DEMO_TOKEN_KEYS) localStorage.removeItem(key);
  } catch {
    // Storage can be unavailable (private mode); there is nothing to purge then.
  }
}

if (typeof window !== "undefined") purgeLegacyDemoTokens();

/** The demo token lives only in per-tab sessionStorage. Never created implicitly. */
export function getDemoToken(): string | null {
  if (typeof window === "undefined") return null;
  return sessionStorage.getItem(DEMO_TOKEN_KEY);
}

/**
 * Retrieves valid authentication headers for workflow API calls.
 * Supports Authenticated Account (Bearer) and Demo Session (X-Demo-Session), never both.
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

  const token = demoToken || getDemoToken();
  if (token) {
    headers["X-Demo-Session"] = token;
  }

  return headers;
}

export async function createAction(
  body: CreateActionRequest,
  options?: { accountToken?: string | null; demoToken?: string | null; idempotencyKey?: string }
): Promise<WorkflowActionView> {
  const headers = getWorkflowHeaders(options?.accountToken, options?.demoToken);
  headers["Content-Type"] = "application/json";
  if (options?.idempotencyKey) {
    headers["Idempotency-Key"] = options.idempotencyKey;
  }
  const res = await fetch(getWorkflowUrl("/api/v1/workflow/actions"), {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err?.message || `Failed to prepare action (HTTP ${res.status})`);
  }
  return res.json();
}
