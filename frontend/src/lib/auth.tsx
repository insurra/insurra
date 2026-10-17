"use client";

import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { api, ApiClientError } from "@/lib/api/client";
import type { components } from "@/lib/api/types.gen";
import { config } from "@/lib/config";

type Account = components["schemas"]["AccountSummary"];
type AuthContextValue = {
  account: Account | null;
  loading: boolean;
  error: string | null;
  googleLoginUrl: string;
  acceptToken: (token: string) => Promise<boolean>;
  logout: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);
const storageKey = "insurra.account-session";

async function loadAccount(token: string) {
  return api.request("get", "/api/v1/auth/me", {
    headers: { Authorization: `Bearer ${token}` },
  });
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [account, setAccount] = useState<Account | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const clear = useCallback(() => {
    sessionStorage.removeItem(storageKey);
    setAccount(null);
  }, []);

  useEffect(() => {
    let active = true;
    const token = sessionStorage.getItem(storageKey);
    if (!token) return;
    loadAccount(token)
      .then((value) => {
        if (active) setAccount(value);
      })
      .catch(() => {
        if (active) clear();
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [clear]);

  const acceptToken = useCallback(async (token: string) => {
    setLoading(true);
    setError(null);
    try {
      const value = await loadAccount(token);
      sessionStorage.setItem(storageKey, token);
      setAccount(value);
      return true;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Sesi Google tidak dapat dibuka.");
      return false;
    } finally {
      setLoading(false);
    }
  }, []);

  const logout = useCallback(async () => {
    const token = sessionStorage.getItem(storageKey);
    if (token) {
      try {
        await api.request("post", "/api/v1/auth/logout", {
          headers: { Authorization: `Bearer ${token}` },
        });
      } catch (cause) {
        if (!(cause instanceof ApiClientError && cause.status === 401)) throw cause;
      }
    }
    clear();
  }, [clear]);

  return (
    <AuthContext.Provider
      value={{
        account,
        loading,
        error,
        googleLoginUrl: `${config.apiBaseUrl.replace(/\/$/, "")}/auth/google`,
        acceptToken,
        logout,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error("AuthProvider is required");
  return context;
}
