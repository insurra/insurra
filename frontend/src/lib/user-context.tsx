"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
} from "react";
import { api } from "@/lib/api/client";
import { useAuth } from "@/lib/auth";

export type DeclaredCoverageItem = {
  id: string;
  category: string;
  label: string;
  provider?: string;
  policyName?: string;
  status: "self_reported" | "document_uploaded" | "extracted" | "user_confirmed" | "source_verified";
};

export type SegmentDetails = {
  institutionName?: string;
  studyPeriod?: string;
  residencePermitExpiry?: string;
  employerName?: string;
  registeredBusinessName?: string;
  industry?: string;
  businessRole?: string;
  socialInsuranceStatus?: string;
  visaType?: string;
  travelDestination?: string;
  travelDates?: string;
};

export type SharedUserContext = {
  nationality: string;
  nationalityCode: string;
  residenceCountry: string;
  countryCode: "CN" | "ID" | "AU" | string;
  countryFlag: string;
  residenceCity: string;
  preferredLanguage: string;
  userSegment: "student" | "employee" | "self_employed" | "traveler" | "family" | "other";
  userSegmentLabel: string;
  segmentDetails: SegmentDetails;
  householdScope: "self" | "family" | "team";
  dependentCount: number;
  dependents: string[];
  declaredCoverages: DeclaredCoverageItem[];
  protectionGoals: string[];
  additionalBudget?: {
    range?: string;
    currency?: string;
    period?: "monthly" | "annual";
  };
  profileSetupComplete: boolean;
  insuranceVerificationStatus: "not_started" | "in_progress" | "needs_review" | "verified";
  updateContext: (partial: Partial<SharedUserContext>) => void;
  resetContext: () => void;
};

const STORAGE_KEY = "insurra.active-profile";

const COUNTRY_FLAGS: Record<string, string> = {
  CN: "🇨🇳",
  ID: "🇮🇩",
  AU: "🇦🇺",
  SG: "🇸🇬",
  MY: "🇲🇾",
  US: "🇺🇸",
  GB: "🇬🇧",
};

const COUNTRY_NAMES: Record<string, string> = {
  CN: "China",
  ID: "Indonesia",
  AU: "Australia",
  SG: "Singapore",
  MY: "Malaysia",
  US: "United States",
  GB: "United Kingdom",
};

// Default scenario: Indonesian International Student in Shenzhen, China (primary demonstration market)
export const DEFAULT_USER_CONTEXT: SharedUserContext = {
  nationality: "Indonesia",
  nationalityCode: "ID",
  residenceCountry: "China",
  countryCode: "CN",
  countryFlag: "🇨🇳",
  residenceCity: "Shenzhen",
  preferredLanguage: "English",
  userSegment: "student",
  userSegmentLabel: "International Student",
  segmentDetails: {
    institutionName: "Shenzhen University",
    studyPeriod: "2024 - 2026",
    residencePermitExpiry: "2026-09-30",
  },
  householdScope: "self",
  dependentCount: 0,
  dependents: ["None"],
  declaredCoverages: [
    {
      id: "student_scheme",
      category: "Student Insurance",
      label: "Comprehensive Medical Insurance for Foreigners",
      provider: "Ping An Annuity",
      policyName: "Foreign Student Medical Scheme",
      status: "self_reported",
    },
  ],
  protectionGoals: ["understand", "claims", "documents"],
  additionalBudget: {
    range: "$50 - $150",
    currency: "USD",
    period: "monthly",
  },
  profileSetupComplete: true,
  insuranceVerificationStatus: "not_started",
  updateContext: () => {},
  resetContext: () => {},
};

const UserContext = createContext<SharedUserContext>(DEFAULT_USER_CONTEXT);

export function UserContextProvider({ children }: { children: React.ReactNode }) {
  const { account, token } = useAuth();

  const [context, setContext] = useState<SharedUserContext>(() => {
    if (typeof window !== "undefined") {
      try {
        const stored = localStorage.getItem(STORAGE_KEY);
        if (stored) {
          const parsed = JSON.parse(stored);
          return {
            ...DEFAULT_USER_CONTEXT,
            ...parsed,
            countryFlag: COUNTRY_FLAGS[parsed.countryCode] || "🌐",
            residenceCountry: COUNTRY_NAMES[parsed.countryCode] || parsed.residenceCountry || "China",
          };
        }
      } catch {
        // Fallback to default
      }
    }
    return DEFAULT_USER_CONTEXT;
  });

  // Sync to backend if authenticated
  const syncToBackend = useCallback(async (state: SharedUserContext) => {
    if (typeof window !== "undefined") {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
      } catch {
        // storage disabled or full
      }
    }

    if (token && account) {
      try {
        const occ =
          state.userSegment === "student"
            ? "STUDENT"
            : state.userSegment === "employee"
            ? "EMPLOYEE"
            : "OTHER";
        const cCode = (state.countryCode.toUpperCase() as "CN" | "ID" | "AU") || "CN";
        const resContext = state.countryCode === state.nationalityCode ? "DOMESTIC" : "ABROAD";

        await api.request("put", "/api/v1/account/profile", {
          body: {
            display_name: account.display_name || "User",
            country_code: cCode,
            residence_context: resContext,
            city: state.residenceCity || "Shenzhen",
            occupation: occ,
            institution_name: state.segmentDetails.institutionName || null,
            dependents: state.dependents.filter((d) => d !== "None"),
            owned_coverage: state.declaredCoverages.map((c) => c.category),
            priorities: state.protectionGoals.slice(0, 2),
            budget_range: state.additionalBudget?.range || null,
            currency: state.additionalBudget?.currency || (cCode === "CN" ? "CNY" : cCode === "ID" ? "IDR" : "AUD"),
          },
          headers: { Authorization: `Bearer ${token}` },
        });
      } catch {
        // Backend synchronization error handled gracefully
      }
    }
  }, [account, token]);

  const updateContext = useCallback(
    (partial: Partial<SharedUserContext>) => {
      setContext((prev) => {
        const code = partial.countryCode || prev.countryCode;
        const next: SharedUserContext = {
          ...prev,
          ...partial,
          countryCode: code,
          countryFlag: COUNTRY_FLAGS[code] || "🌐",
          residenceCountry: COUNTRY_NAMES[code] || partial.residenceCountry || prev.residenceCountry,
        };
        void syncToBackend(next);
        return next;
      });
    },
    [syncToBackend]
  );

  const resetContext = useCallback(() => {
    setContext(DEFAULT_USER_CONTEXT);
    if (typeof window !== "undefined") {
      localStorage.removeItem(STORAGE_KEY);
    }
  }, []);

  const value = useMemo(
    () => ({
      ...context,
      updateContext,
      resetContext,
    }),
    [context, resetContext, updateContext]
  );

  return <UserContext.Provider value={value}>{children}</UserContext.Provider>;
}

export function useUserContext(): SharedUserContext {
  return useContext(UserContext);
}
