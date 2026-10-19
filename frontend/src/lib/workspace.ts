"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useAuth } from "@/lib/auth";
import { useSession } from "@/lib/session";
import { api } from "@/lib/api/client";
import type { components } from "@/lib/api/types.gen";

type Summary = components["schemas"]["HomeSummary"];

export function useWorkspace() {
  const auth = useAuth();
  const demo = useSession();
  const [summary, setSummary] = useState<Summary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(true);
  const [revision, setRevision] = useState(0);
  const accountMode = Boolean(auth.token);
  const demoId = demo.data?.session.id;
  const headers = useMemo<Record<string, string> | null>(() => {
    const result: Record<string, string> = {};
    if (auth.token) {
      result.Authorization = `Bearer ${auth.token}`;
      return result;
    }
    const token = demoId
      ? sessionStorage.getItem("insurra.demo-session")
      : null;
    if (token) {
      result["X-Demo-Session"] = token;
      return result;
    }
    return null;
  }, [auth.token, demoId]);
  const refresh = useCallback(() => setRevision((n) => n + 1), []);
  useEffect(() => {
    const controller = new AbortController();
    queueMicrotask(() => {
      if (!controller.signal.aborted) {
        setSummary(null);
        setError(null);
        setPending(Boolean(headers));
      }
    });
    if (headers) {
      api
        .request("get", "/api/v1/home/summary", {
          headers,
          signal: controller.signal,
        })
        .then((value) => {
          if (!controller.signal.aborted) setSummary(value);
        })
        .catch((cause: unknown) => {
          if (!controller.signal.aborted)
            setError(
              cause instanceof Error
                ? cause.message
                : "Ringkasan belum tersedia.",
            );
        })
        .finally(() => {
          if (!controller.signal.aborted) setPending(false);
        });
    }
    return () => controller.abort();
  }, [headers, revision]);
  useEffect(() => {
    window.addEventListener("focus", refresh);
    return () => window.removeEventListener("focus", refresh);
  }, [refresh]);
  return {
    identityKey: auth.account?.id ?? demoId ?? null,
    summary,
    headers,
    accountMode,
    refresh,
    error,
    loading: auth.loading || demo.loading || pending,
  };
}
