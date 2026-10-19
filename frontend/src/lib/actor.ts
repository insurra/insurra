"use client";

import { useMemo } from "react";
import { useAuth } from "@/lib/auth";
import { useSession } from "@/lib/session";
import { api } from "@/lib/api/client";
import { safeRedirectPath } from "@/lib/safe-redirect";

const demoStorageKey = "insurra.demo-session";

export type ActorMode = "account" | "demo" | null;

/**
 * Resolves the current actor to request headers: an account Bearer token or the opaque demo
 * session header. Returns null headers when neither session exists.
 */
export function useActor() {
  const { token, account, loading: authLoading } = useAuth();
  const { data, loading: demoLoading } = useSession();
  const demoId = data?.session.id ?? null;
  const mode: ActorMode = token && account ? "account" : demoId ? "demo" : null;
  const headers = useMemo<Record<string, string> | null>(() => {
    const result: Record<string, string> = {};
    if (token && account) {
      result.Authorization = `Bearer ${token}`;
      return result;
    }
    if (demoId) {
      const demoToken = sessionStorage.getItem(demoStorageKey);
      if (demoToken) {
        result["X-Demo-Session"] = demoToken;
        return result;
      }
    }
    return null;
  }, [token, account, demoId]);
  return { mode, headers, loading: authLoading || demoLoading, account, demo: data };
}

/** Same-origin in-app paths only. Anything else is dropped. */
export function safeDeepLink(value: string | null | undefined): string | null {
  const safe = safeRedirectPath(value, "");
  return safe || null;
}

export const notificationsChangedEvent = "insurra:notifications-changed";
export function announceNotificationsChanged() {
  window.dispatchEvent(new Event(notificationsChangedEvent));
}

/** Replaces the demo session with a fresh one and reloads so every view restarts clean. */
export async function resetDemoSession(headers: Record<string, string>) {
  const created = await api.request("post", "/api/v1/demo/sessions/me/reset", { headers });
  sessionStorage.setItem(demoStorageKey, created.session_token);
  window.location.href = "/home";
}

/** Ends the demo session on the server. Callers then clear local state and leave. */
export async function endDemoSession(headers: Record<string, string>) {
  await api.request("delete", "/api/v1/demo/sessions/me", { headers });
}
