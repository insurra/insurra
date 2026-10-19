"use client";

import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { api, ApiClientError } from "@/lib/api/client";
import type { components } from "@/lib/api/types.gen";
import { config } from "@/lib/config";
import { clearProfileCaches } from "@/lib/profile-cache";

type Account = components["schemas"]["AccountSummary"];

type AuthResult = {
  success: boolean;
  message?: string;
  error?: string;
  code?: string;
  retryAfter?: number;
};

type AuthContextValue = {
  account: Account | null;
  token: string | null;
  loading: boolean;
  error: string | null;
  googleLoginUrl: string;
  acceptToken: (token: string) => Promise<boolean>;
  loginWithPassword: (email: string, password: string) => Promise<AuthResult>;
  registerWithPassword: (
    email: string,
    password: string,
    passwordConfirmation: string,
  ) => Promise<AuthResult>;
  verifyEmail: (token: string) => Promise<AuthResult>;
  resendVerification: (email: string) => Promise<AuthResult>;
  forgotPassword: (email: string) => Promise<AuthResult>;
  resetPassword: (
    token: string,
    password: string,
    passwordConfirmation: string,
  ) => Promise<AuthResult>;
  submitConsents: (decision: {
    process_documents: boolean;
    external_ai: boolean;
    retention: boolean;
    skip: boolean;
  }) => Promise<boolean>;
  logout: () => Promise<void>;
  refreshAccount: () => Promise<void>;
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
  const [token, setToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const clear = useCallback(() => {
    sessionStorage.removeItem(storageKey);
    clearProfileCaches();
    setAccount(null);
    setToken(null);
  }, []);

  const refreshAccount = useCallback(async () => {
    const currentToken = token || sessionStorage.getItem(storageKey);
    if (!currentToken) return;
    try {
      const data = await loadAccount(currentToken);
      setAccount(data);
    } catch {
      clear();
    }
  }, [clear, token]);

  useEffect(() => {
    let active = true;
    const storedToken = sessionStorage.getItem(storageKey);
    if (!storedToken) {
      queueMicrotask(() => {
        if (active) setLoading(false);
      });
      return () => {
        active = false;
      };
    }
    loadAccount(storedToken)
      .then((value) => {
        if (active) {
          setAccount(value);
          setToken(storedToken);
        }
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

  const acceptToken = useCallback(async (newToken: string) => {
    setLoading(true);
    setError(null);
    try {
      const value = await loadAccount(newToken);
      sessionStorage.setItem(storageKey, newToken);
      setAccount(value);
      setToken(newToken);
      return true;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Session could not be opened.");
      return false;
    } finally {
      setLoading(false);
    }
  }, []);

  const loginWithPassword = useCallback(
    async (email: string, password: string): Promise<AuthResult> => {
      setError(null);
      try {
        const session = await api.request("post", "/api/v1/account/auth/login", {
          body: { email, password },
        });
        sessionStorage.setItem(storageKey, session.access_token);
        setAccount(session.account);
        setToken(session.access_token);
        return { success: true };
      } catch (cause) {
        if (cause instanceof ApiClientError) {
          const details = cause.error.details as Record<string, unknown> | null;
          const retryAfter =
            typeof details?.retry_after === "number" ? details.retry_after : undefined;
          return {
            success: false,
            error: cause.error.message,
            code: cause.error.code,
            retryAfter,
          };
        }
        return {
          success: false,
          error: cause instanceof Error ? cause.message : "Failed to log in.",
        };
      }
    },
    [],
  );

  const registerWithPassword = useCallback(
    async (
      email: string,
      password: string,
      passwordConfirmation: string,
    ): Promise<AuthResult> => {
      setError(null);
      try {
        const result = await api.request("post", "/api/v1/account/auth/register", {
          body: {
            email,
            password,
            password_confirmation: passwordConfirmation,
            accepted_terms: true,
          },
        });
        return { success: true, message: result.message };
      } catch (cause) {
        if (cause instanceof ApiClientError) {
          return {
            success: false,
            error: cause.error.message,
            code: cause.error.code,
          };
        }
        return {
          success: false,
          error: cause instanceof Error ? cause.message : "Failed to register.",
        };
      }
    },
    [],
  );

  const verifyEmail = useCallback(async (verifyToken: string): Promise<AuthResult> => {
    try {
      const result = await api.request("post", "/api/v1/account/auth/verify-email", {
        body: { token: verifyToken },
      });
      return { success: true, message: result.message };
    } catch (cause) {
      if (cause instanceof ApiClientError) {
        return { success: false, error: cause.error.message, code: cause.error.code };
      }
      return {
        success: false,
        error: cause instanceof Error ? cause.message : "Failed to verify email.",
      };
    }
  }, []);

  const resendVerification = useCallback(async (email: string): Promise<AuthResult> => {
    try {
      const result = await api.request("post", "/api/v1/account/auth/resend-verification", {
        body: { email },
      });
      return { success: true, message: result.message };
    } catch (cause) {
      if (cause instanceof ApiClientError) {
        const details = cause.error.details as Record<string, unknown> | null;
        const retryAfter =
          typeof details?.retry_after === "number" ? details.retry_after : undefined;
        return {
          success: false,
          error: cause.error.message,
          code: cause.error.code,
          retryAfter,
        };
      }
      return {
        success: false,
        error: cause instanceof Error ? cause.message : "Failed to resend verification.",
      };
    }
  }, []);

  const forgotPassword = useCallback(async (email: string): Promise<AuthResult> => {
    try {
      const result = await api.request("post", "/api/v1/account/auth/forgot-password", {
        body: { email },
      });
      return { success: true, message: result.message };
    } catch (cause) {
      if (cause instanceof ApiClientError) {
        return { success: false, error: cause.error.message, code: cause.error.code };
      }
      return {
        success: false,
        error: cause instanceof Error ? cause.message : "Failed to request password reset.",
      };
    }
  }, []);

  const resetPassword = useCallback(
    async (
      resetToken: string,
      password: string,
      passwordConfirmation: string,
    ): Promise<AuthResult> => {
      try {
        const result = await api.request("post", "/api/v1/account/auth/reset-password", {
          body: {
            token: resetToken,
            password,
            password_confirmation: passwordConfirmation,
          },
        });
        return { success: true, message: result.message };
      } catch (cause) {
        if (cause instanceof ApiClientError) {
          return { success: false, error: cause.error.message, code: cause.error.code };
        }
        return {
          success: false,
          error: cause instanceof Error ? cause.message : "Failed to reset password.",
        };
      }
    },
    [],
  );

  const submitConsents = useCallback(
    async (decision: {
      process_documents: boolean;
      external_ai: boolean;
      retention: boolean;
      skip: boolean;
    }): Promise<boolean> => {
      const currentToken = token || sessionStorage.getItem(storageKey);
      if (!currentToken) return false;
      try {
        await api.request("post", "/api/v1/account/consents/bulk", {
          headers: { Authorization: `Bearer ${currentToken}` },
          body: decision,
        });
        await refreshAccount();
        return true;
      } catch {
        return false;
      }
    },
    [refreshAccount, token],
  );

  const logout = useCallback(async () => {
    const currentToken = sessionStorage.getItem(storageKey);
    if (currentToken) {
      try {
        await api.request("post", "/api/v1/auth/logout", {
          headers: { Authorization: `Bearer ${currentToken}` },
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
        token,
        loading,
        error,
        googleLoginUrl: `${config.apiBaseUrl.replace(/\/$/, "")}/auth/google`,
        acceptToken,
        loginWithPassword,
        registerWithPassword,
        verifyEmail,
        resendVerification,
        forgotPassword,
        resetPassword,
        submitConsents,
        logout,
        refreshAccount,
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
