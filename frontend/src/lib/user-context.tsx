"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
} from "react";
import { api } from "@/lib/api/client";
import type { components } from "@/lib/api/types.gen";
import { useAuth } from "@/lib/auth";

const GOAL_API_VALUES: Record<string, components["schemas"]["Goal"]> = {
  understand: "UNDERSTAND_COVERAGE",
  coverage_adequacy: "DISCOVER_GAPS",
  find_gaps: "DISCOVER_GAPS",
  care_pathways: "FIND_CARE",
  claims_help: "PREPARE_CLAIM",
  compare_options: "COMPARE_OPTIONS",
  organize_docs: "TRACK_RENEWALS",
  family_group: "MANAGE_FAMILY",
};

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
  countryCode: "CN" | "ID" | string;
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
  lifeContext?: "STUDY" | "WORK" | "LIVING" | "TRAVEL" | "OTHER";
  ageRange?: "UNDER_18" | "18_24" | "25_34" | "35_44" | "45_54" | "55_64" | "65_PLUS";
  dependentAgeGroups: string[];
  financialResponsibilities: string[];
  insuranceSources: string[];
  employerCoverageEligibility?: "YES" | "NO" | "UNKNOWN";
  additionalCoverageIntent?: "YES" | "NO" | "UNSURE";
  decisionPreference?: "LOWER_PREMIUM" | "WIDER_BENEFITS" | "FLEXIBILITY";
  additionalBudget?: {
    range?: string;
    currency?: string;
    period?: "monthly" | "annual";
  };
  profileSetupComplete: boolean;
  insuranceVerificationStatus: "not_started" | "in_progress" | "needs_review" | "verified";
  updateContext: (
    partial: Partial<SharedUserContext>,
    options?: { sync?: boolean }
  ) => void;
  resetContext: () => void;
};

const STORAGE_KEY = "insurra.active-profile";

const COUNTRY_FLAGS: Record<string, string> = {
  CN: "🇨🇳",
  ID: "🇮🇩",
  SG: "🇸🇬",
  MY: "🇲🇾",
  US: "🇺🇸",
  GB: "🇬🇧",
};

const COUNTRY_NAMES: Record<string, string> = {
  CN: "China",
  ID: "Indonesia",
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
    institutionName: "Shenzhen Demo International University (synthetic)",
    studyPeriod: "2026 - 2027",
    residencePermitExpiry: "2027-06-30",
  },
  householdScope: "self",
  dependentCount: 0,
  dependents: ["None"],
  declaredCoverages: [
    {
      id: "student_scheme",
      category: "Student Insurance",
      label: "Comprehensive Medical Insurance for Foreigners",
      provider: "Synthetic Student Health Plan (demo)",
      policyName: "Synthetic Student Health Plan (demo)",
      status: "self_reported",
    },
  ],
  protectionGoals: ["understand", "claims_help"],
  lifeContext: "STUDY",
  ageRange: undefined,
  dependentAgeGroups: [],
  financialResponsibilities: [],
  insuranceSources: ["UNIVERSITY"],
  employerCoverageEligibility: undefined,
  additionalCoverageIntent: "UNSURE",
  decisionPreference: "FLEXIBILITY",
  additionalBudget: {
    range: "¥300 - ¥800",
    currency: "CNY",
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
        const cCode = (state.countryCode.toUpperCase() as "CN" | "ID") || "CN";
        const resContext = state.countryCode === state.nationalityCode ? "DOMESTIC" : "ABROAD";

        const endpoint = state.profileSetupComplete
          ? "/api/v1/account/profile"
          : "/api/v1/account/profile/draft";

        await api.request("put", endpoint, {
          body: {
            display_name: account.display_name || "User",
            country_code: cCode,
            residence_context: resContext,
            city: state.residenceCity || (cCode === "CN" ? "Shenzhen" : "Jakarta"),
            occupation: occ,
            institution_name: state.segmentDetails.institutionName || null,
            dependents: state.dependents.filter((d) => d !== "None"),
            owned_coverage: state.declaredCoverages.map((c) => c.category),
            priorities: state.protectionGoals.slice(0, 2),
            goals: [...new Set(state.protectionGoals.map((goal) => GOAL_API_VALUES[goal]).filter(Boolean))],
            life_context: state.lifeContext || null,
            age_range: state.ageRange || null,
            has_dependents: state.householdScope === "family",
            dependent_age_groups: state.dependentAgeGroups,
            financial_responsibilities: state.financialResponsibilities,
            insurance_sources: state.insuranceSources,
            employer_coverage_eligibility: state.employerCoverageEligibility || null,
            willing_additional_coverage: state.additionalCoverageIntent || null,
            decision_preference: state.decisionPreference || null,
            budget_range: state.additionalBudget?.range || null,
            currency: state.additionalBudget?.currency || (cCode === "CN" ? "CNY" : "IDR"),
          },
          headers: { Authorization: `Bearer ${token}` },
        });
      } catch {
        // Backend synchronization error handled gracefully
      }
    }
  }, [account, token]);

  const updateContext = useCallback(
    (partial: Partial<SharedUserContext>, options?: { sync?: boolean }) => {
      setContext((prev) => {
        const code = partial.countryCode || prev.countryCode;
        const next: SharedUserContext = {
          ...prev,
          ...partial,
          countryCode: code,
          countryFlag: COUNTRY_FLAGS[code] || "🌐",
          residenceCountry: COUNTRY_NAMES[code] || partial.residenceCountry || prev.residenceCountry,
        };
        if (typeof window !== "undefined") {
          try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
          } catch {
            // storage disabled or full
          }
        }
        if (options?.sync !== false) void syncToBackend(next);
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
