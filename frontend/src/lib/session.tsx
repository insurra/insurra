"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import { api, ApiClientError } from "@/lib/api/client";
import type { components } from "@/lib/api/types.gen";

type S = components["schemas"];
type SessionData = {
  session: S["DemoSession"];
  profile: S["UserProfile"];
  record: S["UnifiedInsuranceRecord"];
  assessment: S["VisaCoverageAssessment"];
  consent: S["ConsentState"];
};
type SessionContextValue = {
  data: SessionData | null;
  loading: boolean;
  error: string | null;
  selectPersona: (id: string) => Promise<boolean>;
  setConsent: (value: boolean) => Promise<boolean>;
  getAudit: (eventType?: string) => Promise<S["AuditEvent"][]>;
  clearSession: () => void;
};
const SessionContext = createContext<SessionContextValue | null>(null);
const storageKey = "insurra.demo-session";

async function loadSession(token: string): Promise<SessionData> {
  const [session, profile, record, assessment, consent] = await Promise.all([
    api.get("/api/v1/demo/sessions/me", token),
    api.get("/api/v1/profile", token),
    api.get("/api/v1/insurance/record", token),
    api.get("/api/v1/assessments/visa-gap", token),
    api.get("/api/v1/consent", token),
  ]);
  return { session, profile, record, assessment, consent };
}
function message(error: unknown) {
  return error instanceof Error
    ? error.message
    : "Terjadi kesalahan. Coba kembali.";
}

export function SessionProvider({ children }: { children: React.ReactNode }) {
  const [data, setData] = useState<SessionData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const token = useRef<string | null>(null);
  const generation = useRef(0);

  useEffect(() => {
    let active = true;
    async function restore() {
      try {
        const saved = sessionStorage.getItem(storageKey);
        // An async boundary keeps hydration deterministic on server and browser.
        const restored = saved
          ? await loadSession(saved)
          : await Promise.resolve(null);
        if (!active) return;
        token.current = saved;
        setData(restored);
      } catch (err) {
        if (!active) return;
        sessionStorage.removeItem(storageKey);
        token.current = null;
        setError(message(err));
      } finally {
        if (active) setLoading(false);
      }
    }
    void restore();
    return () => {
      active = false;
    };
  }, []);

  const clearSession = useCallback(() => {
    generation.current += 1;
    token.current = null;
    sessionStorage.removeItem(storageKey);
    setData(null);
    setError(null);
    setLoading(false);
  }, []);

  const selectPersona = useCallback(async (id: string) => {
    const attempt = ++generation.current;
    token.current = null;
    sessionStorage.removeItem(storageKey);
    setData(null);
    setLoading(true);
    setError(null);
    try {
      const created = await api.post("/api/v1/demo/sessions", null, {
        persona_id: id,
      });
      const fresh = await loadSession(created.session_token);
      if (attempt !== generation.current) return false;
      token.current = created.session_token;
      sessionStorage.setItem(storageKey, created.session_token);
      setData(fresh);
      return true;
    } catch (err) {
      if (attempt === generation.current) setError(message(err));
      return false;
    } finally {
      if (attempt === generation.current) setLoading(false);
    }
  }, []);

  const setConsent = useCallback(async (value: boolean) => {
    if (!token.current) return false;
    const attempt = generation.current;
    setError(null);
    setLoading(true);
    try {
      const consent = await api.put("/api/v1/consent", token.current, {
        processing_consent: value,
      });
      if (attempt !== generation.current) return false;
      setData((previous) => (previous ? { ...previous, consent } : null));
      return true;
    } catch (err) {
      if (attempt === generation.current) setError(message(err));
      return false;
    } finally {
      if (attempt === generation.current) setLoading(false);
    }
  }, []);

  const getAudit = useCallback(
    async (eventType?: string) => {
      if (!token.current) return [];
      try {
        return await api.get(
          "/api/v1/audit",
          token.current,
          eventType
            ? new URLSearchParams({ event_type: eventType })
            : undefined,
        );
      } catch (err) {
        if (err instanceof ApiClientError && err.status === 401) clearSession();
        throw err;
      }
    },
    [clearSession],
  );

  return (
    <SessionContext.Provider
      value={{
        data,
        loading,
        error,
        selectPersona,
        setConsent,
        getAudit,
        clearSession,
      }}
    >
      {children}
    </SessionContext.Provider>
  );
}
export function useSession() {
  const context = useContext(SessionContext);
  if (!context) throw new Error("SessionProvider is required");
  return context;
}
