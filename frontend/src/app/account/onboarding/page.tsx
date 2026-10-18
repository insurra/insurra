"use client";

import Link from "next/link";
import Image from "next/image";
import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowRight,
  Briefcase,
  Building,
  Check,
  CheckCircle2,
  Edit2,
  FileText,
  Globe2,
  GraduationCap,
  Info,
  Plane,
  Shield,
  ShieldCheck,
  Sparkles,
  User,
  Users,
} from "lucide-react";
import { api } from "@/lib/api/client";
import { useAuth } from "@/lib/auth";
import {
  useUserContext,
  type DeclaredCoverageItem,
  type SegmentDetails,
} from "@/lib/user-context";
import "@/app/onboarding/onboarding.css";

// Supported countries with priority
const COUNTRIES = [
  { code: "CN", name: "China", flag: "🇨🇳", note: "Primary demo: Students & employees in China" },
  { code: "ID", name: "Indonesia", flag: "🇮🇩", note: "BPJS Kesehatan & domestic coverage" },
  { code: "AU", name: "Australia", flag: "🇦🇺", note: "OSHC, OVHC & private health" },
  { code: "SG", name: "Singapore", flag: "🇸🇬", note: "Integrated Shield & work passes" },
  { code: "MY", name: "Malaysia", flag: "🇲🇾", note: "Public & private medical coverage" },
  { code: "US", name: "United States", flag: "🇺🇸", note: "ACA & university health plans" },
  { code: "GB", name: "United Kingdom", flag: "🇬🇧", note: "NHS & private health insurance" },
];

const NATIONALITIES = [
  { code: "ID", name: "Indonesia", flag: "🇮🇩" },
  { code: "CN", name: "China", flag: "🇨🇳" },
  { code: "AU", name: "Australia", flag: "🇦🇺" },
  { code: "MY", name: "Malaysia", flag: "🇲🇾" },
  { code: "SG", name: "Singapore", flag: "🇸🇬" },
  { code: "IN", name: "India", flag: "🇮🇳" },
  { code: "US", name: "United States", flag: "🇺🇸" },
  { code: "GB", name: "United Kingdom", flag: "🇬🇧" },
  { code: "JP", name: "Japan", flag: "🇯🇵" },
  { code: "KR", name: "South Korea", flag: "🇰🇷" },
];

const CITY_PRESETS: Record<string, string[]> = {
  CN: ["Shenzhen", "Beijing", "Shanghai", "Guangzhou", "Hangzhou", "Chengdu", "Wuhan"],
  ID: ["Jakarta", "Surabaya", "Bandung", "Medan", "Yogyakarta", "Bali", "Semarang"],
  AU: ["Melbourne", "Sydney", "Brisbane", "Perth", "Adelaide", "Canberra"],
  SG: ["Singapore"],
  MY: ["Kuala Lumpur", "Penang", "Johor Bahru"],
};

const SITUATION_OPTIONS = [
  {
    id: "student",
    icon: GraduationCap,
    label: "Student",
    sub: "Domestic or international student",
  },
  {
    id: "employee",
    icon: Briefcase,
    label: "Employee",
    sub: "Local or overseas employee",
  },
  {
    id: "self_employed",
    icon: Building,
    label: "Self-employed",
    sub: "Business owner or freelance professional",
  },
  {
    id: "traveler",
    icon: Plane,
    label: "Traveler",
    sub: "Short or long-term travel trips",
  },
  {
    id: "family",
    icon: Users,
    label: "Family / Dependent",
    sub: "Managing household protection",
  },
  {
    id: "other",
    icon: Shield,
    label: "Other",
    sub: "Personal insurance and tailored needs",
  },
];

const COVERAGE_CATEGORIES = [
  {
    id: "public_social",
    label: "Public / Social Health",
    sub: "BPJS Kesehatan, Chinese Basic Medical Insurance (医保), Medicare",
    exampleProvider: "BPJS / China Social Medical",
  },
  {
    id: "student_insurance",
    label: "Student Insurance",
    sub: "International student or campus health scheme (e.g. Ping An Scheme in China, OSHC in AU)",
    exampleProvider: "Ping An Annuity / Allianz Care",
  },
  {
    id: "private_health",
    label: "Private Health",
    sub: "Individual hospital and medical coverage (cashless or reimbursement)",
    exampleProvider: "Prudential / AIA / Bupa",
  },
  {
    id: "employer_group",
    label: "Employer / Group",
    sub: "Corporate health benefits and employee group schemes",
    exampleProvider: "Company Group Scheme",
  },
  {
    id: "life_critical",
    label: "Life & Critical Illness",
    sub: "Term life, critical illness, and permanent disability",
    exampleProvider: "Life Insurance Provider",
  },
  {
    id: "accident",
    label: "Personal Accident",
    sub: "Accidental injury and emergency disability coverage",
    exampleProvider: "Accident Shield Provider",
  },
  {
    id: "travel",
    label: "Travel Insurance",
    sub: "Emergency medical and trip protection during travel",
    exampleProvider: "Travel Cover Provider",
  },
  {
    id: "other",
    label: "Other Protection",
    sub: "Additional insurance policy not listed above",
    exampleProvider: "Other Insurer",
  },
  {
    id: "not_sure",
    label: "Not Sure",
    sub: "Let INSURRA help identify your insurance coverage from documents",
    exampleProvider: "Unknown Provider",
  },
  {
    id: "none",
    label: "None",
    sub: "No existing insurance currently reported",
    exampleProvider: "None",
  },
];

const GOAL_OPTIONS = [
  {
    id: "understand",
    label: "Understand my insurance",
    sub: "Plain-language explanations of policy clauses, exclusions, and claim limits",
  },
  {
    id: "coverage_adequacy",
    label: "Check if I am adequately covered",
    sub: "Analyze whether current protection matches your residence and lifestyle risks",
  },
  {
    id: "find_gaps",
    label: "Find gaps in my protection",
    sub: "Identify potential coverage gaps, waiting periods, and deductible thresholds",
  },
  {
    id: "care_pathways",
    label: "Understand care options and costs",
    sub: "Find designated public hospitals, clinics, and estimated out-of-pocket expenses",
  },
  {
    id: "claims_help",
    label: "Prepare or track a claim",
    sub: "Organize medical receipts (Fapiao), doctor notes, and claim forms for submission",
  },
  {
    id: "compare_options",
    label: "Compare insurance options",
    sub: "Explore and compare top-up or alternative plans for your situation",
  },
  {
    id: "organize_docs",
    label: "Organize my insurance documents",
    sub: "Store, extract, and monitor all policy certificates and renewal dates in one vault",
  },
  {
    id: "family_group",
    label: "Manage family or employer coverage",
    sub: "Coordinate shared benefits, dependents, or team protection policies",
  },
];

const BUDGET_CURRENCIES = [
  { code: "CNY", symbol: "¥", name: "Chinese Yuan (RMB)" },
  { code: "IDR", symbol: "Rp", name: "Indonesian Rupiah" },
  { code: "USD", symbol: "$", name: "US Dollar" },
  { code: "AUD", symbol: "A$", name: "Australian Dollar" },
];

const BUDGET_RANGES: Record<string, string[]> = {
  CNY: ["No additional budget", "< ¥300 / month", "¥300 - ¥800 / month", "¥800 - ¥2,000 / month", "> ¥2,000 / month"],
  IDR: ["No additional budget", "< Rp 250,000 / month", "Rp 250,000 - Rp 750,000 / month", "Rp 750,000 - Rp 1,500,000 / month", "> Rp 1,500,000 / month"],
  AUD: ["No additional budget", "< $50 / month", "$50 - $150 / month", "$150 - $300 / month", "> $300 / month"],
  USD: ["No additional budget", "< $50 / month", "$50 - $150 / month", "$150 - $300 / month", "> $300 / month"],
};

export interface DynamicDocSuggestion {
  id: string;
  title: string;
  status: "Required" | "Recommended" | "Optional";
  statusType: "required" | "recommended" | "optional";
  description: string;
  sourceReason: string;
}

function AccountOnboardingContent() {
  const { account, token } = useAuth();
  const userCtx = useUserContext();

  // Active conversational step: 1 to 6
  const [activeStep, setActiveStep] = useState<number>(1);
  const [isTyping, setIsTyping] = useState<boolean>(false);
  const [isCompleted, setIsCompleted] = useState<boolean>(false);
  const [busy, setBusy] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  // Step 1: Location & Background
  const [nationality, setNationality] = useState<string>(userCtx.nationality || "Indonesia");
  const [nationalityCode, setNationalityCode] = useState<string>(userCtx.nationalityCode || "ID");
  const [residenceCountry, setResidenceCountry] = useState<string>(userCtx.countryCode || "CN");
  const [city, setCity] = useState<string>(userCtx.residenceCity || "Shenzhen");
  const [cityInput, setCityInput] = useState<string>("");
  const language = "English";

  // Step 2: Your Situation
  const [segment, setSegment] = useState<"student" | "employee" | "self_employed" | "traveler" | "family" | "other">(
    userCtx.userSegment || "student"
  );
  const [institutionName, setInstitutionName] = useState<string>(
    userCtx.segmentDetails?.institutionName || "Shenzhen University"
  );
  const [studyPeriod, setStudyPeriod] = useState<string>(userCtx.segmentDetails?.studyPeriod || "2024 - 2026");
  const [residencePermitExpiry, setResidencePermitExpiry] = useState<string>(
    userCtx.segmentDetails?.residencePermitExpiry || "2026-09-30"
  );
  const [employerName, setEmployerName] = useState<string>(userCtx.segmentDetails?.employerName || "");
  const [socialInsuranceStatus, setSocialInsuranceStatus] = useState<string>(
    userCtx.segmentDetails?.socialInsuranceStatus || "Enrolled in Social Medical Insurance (医保)"
  );
  const [visaType, setVisaType] = useState<string>(userCtx.segmentDetails?.visaType || "Student Visa");
  const [travelDestination, setTravelDestination] = useState<string>(userCtx.segmentDetails?.travelDestination || "");

  // Step 3: Existing Protection (Multi-select)
  const [selectedCoverages, setSelectedCoverages] = useState<DeclaredCoverageItem[]>(
    userCtx.declaredCoverages?.length
      ? userCtx.declaredCoverages
      : [
          {
            id: "student_insurance",
            category: "Student Insurance",
            label: "Comprehensive Medical Insurance for Foreigners",
            provider: "Ping An Annuity",
            policyName: "Comprehensive Medical Insurance Scheme for Foreigners",
            status: "self_reported",
          },
        ]
  );
  const [customProviderInput, setCustomProviderInput] = useState<string>("");

  // Step 4: Who Needs Coverage
  const [householdScope, setHouseholdScope] = useState<"self" | "family" | "team">(
    userCtx.householdScope || "self"
  );
  const [familyMembers, setFamilyMembers] = useState<string[]>(
    userCtx.dependents?.filter((d) => d !== "None") || []
  );
  const [familyCount, setFamilyCount] = useState<number>(userCtx.dependentCount || 1);

  // Step 5: Goals & Budget
  const [selectedGoals, setSelectedGoals] = useState<string[]>(
    userCtx.protectionGoals?.length
      ? userCtx.protectionGoals
      : ["understand", "claims_help", "organize_docs"]
  );
  const [budgetCurrency, setBudgetCurrency] = useState<string>(
    residenceCountry === "CN" ? "CNY" : residenceCountry === "ID" ? "IDR" : residenceCountry === "AU" ? "AUD" : "USD"
  );
  const [selectedBudgetRange, setSelectedBudgetRange] = useState<string>("No additional budget");

  const chatScrollRef = useRef<HTMLDivElement>(null);

  // Auto-scroll chat on step change
  useEffect(() => {
    const timer = setTimeout(() => {
      if (chatScrollRef.current) {
        chatScrollRef.current.scrollTo({
          top: chatScrollRef.current.scrollHeight,
          behavior: "smooth",
        });
      }
    }, 100);
    return () => clearTimeout(timer);
  }, [activeStep, isTyping, isCompleted]);

  // Advance step helper
  function proceedTo(nextStep: number) {
    setError(null);
    setIsTyping(true);
    setTimeout(() => {
      setIsTyping(false);
      setActiveStep(nextStep);
    }, 380);
  }

  // Handle Step 1 Submit
  function handleStep1Submit() {
    const finalCity = (cityInput || city).trim();
    if (!finalCity) {
      setError("Please specify your current city of residence.");
      return;
    }
    setCity(finalCity);
    // Update active context immediately
    userCtx.updateContext({
      nationality,
      nationalityCode,
      countryCode: residenceCountry,
      residenceCity: finalCity,
      preferredLanguage: language,
    });
    proceedTo(2);
  }

  // Handle Step 2 Submit
  function handleStep2Submit() {
    const segDetails: SegmentDetails = {
      institutionName: institutionName.trim() || undefined,
      studyPeriod: studyPeriod.trim() || undefined,
      residencePermitExpiry: residencePermitExpiry.trim() || undefined,
      employerName: employerName.trim() || undefined,
      socialInsuranceStatus: socialInsuranceStatus || undefined,
      visaType: visaType.trim() || undefined,
      travelDestination: travelDestination.trim() || undefined,
    };

    userCtx.updateContext({
      userSegment: segment,
      userSegmentLabel: SITUATION_OPTIONS.find((s) => s.id === segment)?.label || "Student",
      segmentDetails: segDetails,
    });
    proceedTo(3);
  }

  // Handle Step 3 Coverage toggle
  function toggleCoverageCategory(catId: string) {
    if (catId === "none") {
      setSelectedCoverages([
        {
          id: "none",
          category: "None",
          label: "No existing insurance reported",
          provider: "None",
          status: "self_reported",
        },
      ]);
      return;
    }

    let next = selectedCoverages.filter((c) => c.id !== "none");
    const existingIndex = next.findIndex((c) => c.id === catId);

    if (existingIndex >= 0) {
      next = next.filter((c) => c.id !== catId);
    } else {
      const match = COVERAGE_CATEGORIES.find((c) => c.id === catId);
      if (match) {
        next.push({
          id: match.id,
          category: match.label,
          label: match.label,
          provider: match.exampleProvider,
          status: "self_reported",
        });
      }
    }

    if (next.length === 0) {
      next = [
        {
          id: "not_sure",
          category: "Not Sure",
          label: "Not sure / needs identification",
          provider: "To be verified",
          status: "self_reported",
        },
      ];
    }

    setSelectedCoverages(next);
  }

  function handleStep3Submit() {
    userCtx.updateContext({
      declaredCoverages: selectedCoverages,
    });
    proceedTo(4);
  }

  // Handle Step 4 Scope toggle
  function handleStep4Submit() {
    const deps = householdScope === "family" ? familyMembers : ["None"];
    userCtx.updateContext({
      householdScope,
      dependentCount: householdScope === "family" ? familyCount : 0,
      dependents: deps,
    });
    proceedTo(5);
  }

  // Handle Step 5 Goals & Budget Submit
  async function handleStep5Submit(skipBudget = false) {
    setBusy(true);
    const budgetObj = skipBudget
      ? undefined
      : {
          range: selectedBudgetRange,
          currency: budgetCurrency,
          period: "monthly" as const,
        };

    const finalContext = {
      nationality,
      nationalityCode,
      countryCode: residenceCountry,
      residenceCity: city,
      preferredLanguage: language,
      userSegment: segment,
      userSegmentLabel: SITUATION_OPTIONS.find((s) => s.id === segment)?.label || "Student",
      segmentDetails: {
        institutionName: institutionName.trim() || undefined,
        studyPeriod: studyPeriod.trim() || undefined,
        residencePermitExpiry: residencePermitExpiry.trim() || undefined,
        employerName: employerName.trim() || undefined,
        socialInsuranceStatus: socialInsuranceStatus || undefined,
        visaType: visaType.trim() || undefined,
        travelDestination: travelDestination.trim() || undefined,
      },
      householdScope,
      dependentCount: householdScope === "family" ? familyCount : 0,
      dependents: householdScope === "family" ? familyMembers : ["None"],
      declaredCoverages: selectedCoverages,
      protectionGoals: selectedGoals,
      additionalBudget: budgetObj,
      profileSetupComplete: true,
      insuranceVerificationStatus: "not_started" as const,
    };

    userCtx.updateContext(finalContext);

    // Save to backend if authenticated
    if (token) {
      try {
        const occ =
          segment === "student" ? "STUDENT" : segment === "employee" ? "EMPLOYEE" : "OTHER";
        const cCode = (residenceCountry.toUpperCase() as "CN" | "ID" | "AU") || "CN";
        const resContext = residenceCountry === nationalityCode ? "DOMESTIC" : "ABROAD";

        await api.request("put", "/api/v1/account/profile", {
          headers: { Authorization: `Bearer ${token}` },
          body: {
            display_name: account?.display_name || "User",
            country_code: cCode,
            residence_context: resContext,
            city,
            occupation: occ,
            institution_name: institutionName || null,
            dependents: householdScope === "family" ? familyMembers : [],
            owned_coverage: selectedCoverages.map((c) => c.category),
            priorities: selectedGoals.slice(0, 2),
            budget_range: skipBudget ? null : selectedBudgetRange,
            currency: budgetCurrency,
          },
        });
      } catch {
        // Continue gracefully even if network was slow
      }
    }

    setBusy(false);
    setIsCompleted(true);
    proceedTo(6);
  }

  // Dynamic suggested documents: f(Country, User Type, Coverage, Goal)
  const dynamicSuggestedDocs = useMemo<DynamicDocSuggestion[]>(() => {
    const docs: DynamicDocSuggestion[] = [];
    const isChina = residenceCountry === "CN";
    const isIndonesia = residenceCountry === "ID";
    const isAustralia = residenceCountry === "AU";
    const isStudent = segment === "student";
    const isEmployee = segment === "employee";
    const isTraveler = segment === "traveler";

    if (isChina) {
      if (isStudent) {
        docs.push({
          id: "student_cert",
          title: "Student Insurance Certificate",
          status: "Recommended",
          statusType: "recommended",
          description: "From Ping An Annuity or lxbx.net platform confirming your comprehensive medical scheme.",
          sourceReason: "Enables verification of inpatient and accidental medical limits in mainland China.",
        });
        docs.push({
          id: "policy_terms",
          title: "Policy Terms & Benefit Booklet",
          status: "Recommended",
          statusType: "recommended",
          description: "Official policy wording defining public hospital network, deductibles, and claim exclusions.",
          sourceReason: "Clarifies RMB 650 outpatient threshold and hospital department restrictions.",
        });
        docs.push({
          id: "admission_notice",
          title: "University Admission / Study Verification",
          status: "Optional",
          statusType: "optional",
          description: "JW202 / JW201 form or campus enrollment letter from your institution.",
          sourceReason: "Helps verify institutional coverage requirements and campus clinic protocols.",
        });
      } else if (isEmployee) {
        docs.push({
          id: "employer_schedule",
          title: "Employer Benefit Schedule",
          status: "Recommended",
          statusType: "recommended",
          description: "Corporate group medical booklet outlining commercial inpatient and outpatient caps.",
          sourceReason: "Required to evaluate company medical limits and direct-billing hospital access.",
        });
        docs.push({
          id: "social_med_voucher",
          title: "Social Medical Insurance Voucher (医保)",
          status: "Optional",
          statusType: "optional",
          description: "City social security proof or electronic basic medical voucher.",
          sourceReason: "Verifies public basic medical tier before commercial top-up reimbursement.",
        });
      } else {
        docs.push({
          id: "general_policy",
          title: "Commercial Medical Policy",
          status: "Recommended",
          statusType: "recommended",
          description: "Individual private health or accident policy document.",
          sourceReason: "Enables INSURRA to map your healthcare network and benefits.",
        });
      }
    } else if (isIndonesia) {
      const hasBPJS = selectedCoverages.some((c) => c.id === "public_social" || c.category.includes("BPJS"));
      docs.push({
        id: "bpjs_digital",
        title: "BPJS Kesehatan Digital Card",
        status: hasBPJS ? "Recommended" : "Optional",
        statusType: hasBPJS ? "recommended" : "optional",
        description: "Digital card screenshot from Mobile JKN app or scanned physical JKN-KIS card.",
        sourceReason: "Verifies primary healthcare tier (FKTP) and referral chain eligibility.",
      });

      if (selectedCoverages.some((c) => c.id === "private_health" || c.id === "employer_group")) {
        docs.push({
          id: "private_policy",
          title: "Private Health Policy Booklet",
          status: "Recommended",
          statusType: "recommended",
          description: "Individual or group hospital card and table of benefits showing room limits.",
          sourceReason: "Enables coordination of benefits (CoB) between BPJS and private insurance.",
        });
      }

      docs.push({
        id: "id_benefit_sched",
        title: "Schedule of Insurance Benefits",
        status: "Optional",
        statusType: "optional",
        description: "Official summary of covered inpatient treatments, surgical limits, and waiting periods.",
        sourceReason: "Helps detect out-of-pocket medical caps.",
      });
    } else if (isAustralia) {
      if (isStudent) {
        docs.push({
          id: "oshc_cert",
          title: "OSHC Policy Certificate",
          status: "Recommended",
          statusType: "recommended",
          description: "From Medibank, Bupa, Allianz Care, NIB, or AHM confirming Overseas Student Health Cover.",
          sourceReason: "Required to verify Student Visa Condition 8501 health cover continuity.",
        });
        docs.push({
          id: "visa_grant",
          title: "Visa Grant Notice",
          status: "Optional",
          statusType: "optional",
          description: "Department of Home Affairs notification letter confirming visa start and expiry dates.",
          sourceReason: "Enables checking for potential uncovered gap periods before arrival or after study.",
        });
      } else {
        docs.push({
          id: "au_health_cert",
          title: "Private Hospital Policy Schedule",
          status: "Recommended",
          statusType: "recommended",
          description: "Australian private health or OVHC policy document.",
          sourceReason: "Clarifies Medicare Benefits Schedule (MBS) percentages and private hospital excess.",
        });
      }
    } else if (isTraveler) {
      docs.push({
        id: "travel_policy",
        title: "Travel Insurance Policy",
        status: "Recommended",
        statusType: "recommended",
        description: "Emergency medical and travel disruption policy certificate.",
        sourceReason: "Verifies emergency repatriation and international hospitalization coverage.",
      });
      docs.push({
        id: "travel_itinerary",
        title: "Flight / Travel Itinerary",
        status: "Optional",
        statusType: "optional",
        description: "Departure, transit, and return flight booking confirmation.",
        sourceReason: "Helps verify that coverage dates match your actual travel schedule.",
      });
    } else {
      docs.push({
        id: "default_policy",
        title: "Insurance Policy Certificate",
        status: "Recommended",
        statusType: "recommended",
        description: "Any insurance card, schedule, or handbook for INSURRA to inspect and verify.",
        sourceReason: "Allows the AI to extract your coverage without making assumptions.",
      });
    }

    return docs.slice(0, 4);
  }, [residenceCountry, segment, selectedCoverages]);

  const activeCountryObj = COUNTRIES.find((c) => c.code === residenceCountry) || COUNTRIES[0];
  const activeNationalityObj = NATIONALITIES.find((n) => n.name === nationality) || NATIONALITIES[0];

  return (
    <div className="onboarding-container">
      {/* ---------------- Topbar ---------------- */}
      <header className="onboarding-topbar">
        <Link href="/" className="onboarding-brand">
          <Image
            src="/Inssura%20Kangaroo%20Shield%20Logo.png"
            width={120}
            height={52}
            alt="INSURRA"
            className="onboarding-brand-logo"
            priority
          />
        </Link>

        {/* 6-step progress stepper */}
        <nav aria-label="Onboarding Progress" className="onboarding-stepper">
          {[
            { num: 1, label: "Location" },
            { num: 2, label: "Situation" },
            { num: 3, label: "Protection" },
            { num: 4, label: "Scope" },
            { num: 5, label: "Goals" },
            { num: 6, label: "Review" },
          ].map((s) => {
            const isStepActive = activeStep === s.num;
            const isStepDone = activeStep > s.num || isCompleted;
            return (
              <div
                key={s.num}
                className={`stepper-pill ${isStepActive ? "active" : isStepDone ? "completed" : ""}`}
              >
                <span className="stepper-num">
                  {isStepDone ? <Check size={11} strokeWidth={3} /> : s.num}
                </span>
                <span className="stepper-label">{s.label}</span>
              </div>
            );
          })}
        </nav>

        <Link href="/dashboard" className="onboarding-exit-btn">
          Exit to Dashboard
        </Link>
      </header>

      {/* ---------------- Main Content ---------------- */}
      <main className="onboarding-main-split">
        {/* Left Column: Conversational AI chat */}
        <section className="onboarding-chat-card" aria-label="Interactive Onboarding Chat">
          <div className="chat-header">
            <div className="chat-bot-avatar">
              <Sparkles size={18} color="#0ea58a" />
            </div>
            <div>
              <h3>INSURRA Insurance Companion</h3>
              <p>Context-aware guidance for your insurance decisions</p>
            </div>
          </div>

          <div className="chat-stream" ref={chatScrollRef}>
            {/* Step 1: Location & Background */}
            <div className="chat-turn">
              <div className="chat-assistant-bubble">
                <p>
                  Let&apos;s start with where you are. This helps me understand which insurance rules
                  and healthcare systems apply to your situation.
                </p>
              </div>

              {activeStep === 1 && (
                <div className="chat-form-interactive">
                  <div className="form-group-card">
                    <label className="field-label">Your Nationality</label>
                    <div className="country-chip-grid">
                      {NATIONALITIES.map((nat) => (
                        <button
                          key={nat.code}
                          type="button"
                          className={`country-chip ${nationality === nat.name ? "selected" : ""}`}
                          onClick={() => {
                            setNationality(nat.name);
                            setNationalityCode(nat.code);
                          }}
                        >
                          <span>{nat.flag}</span>
                          <span>{nat.name}</span>
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="form-group-card">
                    <label className="field-label">Current Residence Country</label>
                    <div className="country-select-list">
                      {COUNTRIES.slice(0, 3).map((c) => (
                        <div
                          key={c.code}
                          className={`country-option-item ${residenceCountry === c.code ? "selected" : ""}`}
                          onClick={() => {
                            setResidenceCountry(c.code);
                            const defaultCity = CITY_PRESETS[c.code]?.[0] || "";
                            setCity(defaultCity);
                            setCityInput(defaultCity);
                          }}
                        >
                          <span className="country-flag-large">{c.flag}</span>
                          <div className="country-option-info">
                            <h4>{c.name}</h4>
                            <p>{c.note}</p>
                          </div>
                          {residenceCountry === c.code && (
                            <CheckCircle2 size={18} color="#0ea58a" className="country-check" />
                          )}
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="form-group-card">
                    <label className="field-label">City / Region in {activeCountryObj.name}</label>
                    <div className="city-chip-row">
                      {(CITY_PRESETS[residenceCountry] || []).map((presetCity) => (
                        <button
                          key={presetCity}
                          type="button"
                          className={`city-pill ${city === presetCity ? "active" : ""}`}
                          onClick={() => {
                            setCity(presetCity);
                            setCityInput(presetCity);
                          }}
                        >
                          {presetCity}
                        </button>
                      ))}
                    </div>
                    <input
                      type="text"
                      className="text-input-field"
                      placeholder={`Or type custom city (e.g. ${CITY_PRESETS[residenceCountry]?.[0] || "City"})...`}
                      value={cityInput}
                      onChange={(e) => {
                        setCityInput(e.target.value);
                        setCity(e.target.value);
                      }}
                    />
                  </div>

                  <div className="guidance-notice">
                    <Info size={16} />
                    <span>
                      Insurance guidance will be tailored to your location and circumstances. Specific rules
                      will only be shown where verified information is available.
                    </span>
                  </div>

                  {error && <div className="chat-error-message">{error}</div>}

                  <button
                    type="button"
                    className="chat-primary-btn"
                    onClick={handleStep1Submit}
                  >
                    <span>Continue to Situation</span>
                    <ArrowRight size={16} />
                  </button>
                </div>
              )}

              {activeStep > 1 && (
                <div className="chat-user-bubble">
                  <span>
                    {activeNationalityObj.flag} {nationality} national residing in {city},{" "}
                    {activeCountryObj.name} {activeCountryObj.flag}
                  </span>
                  <button
                    type="button"
                    className="edit-answer-btn"
                    onClick={() => setActiveStep(1)}
                    title="Edit Location"
                  >
                    <Edit2 size={13} />
                  </button>
                </div>
              )}
            </div>

            {/* Step 2: What Describes You? */}
            {activeStep >= 2 && (
              <div className="chat-turn">
                <div className="chat-assistant-bubble">
                  <p>What best describes your current situation?</p>
                </div>

                {activeStep === 2 && (
                  <div className="chat-form-interactive">
                    <div className="situation-card-grid">
                      {SITUATION_OPTIONS.map((item) => {
                        const Icon = item.icon;
                        const isSelected = segment === item.id;
                        return (
                          <div
                            key={item.id}
                            className={`situation-card ${isSelected ? "selected" : ""}`}
                            onClick={() => setSegment(item.id as typeof segment)}
                          >
                            <div className="situation-icon-box">
                              <Icon size={20} />
                            </div>
                            <div className="situation-card-body">
                              <h4>{item.label}</h4>
                              <p>{item.sub}</p>
                            </div>
                            {isSelected && (
                              <CheckCircle2 size={16} color="#0ea58a" className="card-check-icon" />
                            )}
                          </div>
                        );
                      })}
                    </div>

                    {/* Context-driven conditional questions */}
                    {segment === "student" && residenceCountry === "CN" && (
                      <div className="conditional-group-card">
                        <span className="conditional-tag">International Student in China Context</span>
                        <div className="field-row">
                          <label className="field-label">University / Institution</label>
                          <input
                            type="text"
                            className="text-input-field"
                            placeholder="e.g. Shenzhen University, Peking University Shenzhen, Tsinghua SIGS..."
                            value={institutionName}
                            onChange={(e) => setInstitutionName(e.target.value)}
                          />
                        </div>
                        <div className="field-grid-2">
                          <div>
                            <label className="field-label">Study Duration</label>
                            <input
                              type="text"
                              className="text-input-field"
                              placeholder="e.g. 2024 - 2026"
                              value={studyPeriod}
                              onChange={(e) => setStudyPeriod(e.target.value)}
                            />
                          </div>
                          <div>
                            <label className="field-label">Residence Permit Expiry</label>
                            <input
                              type="date"
                              className="text-input-field"
                              value={residencePermitExpiry}
                              onChange={(e) => setResidencePermitExpiry(e.target.value)}
                            />
                          </div>
                        </div>
                      </div>
                    )}

                    {segment === "student" && residenceCountry === "AU" && (
                      <div className="conditional-group-card">
                        <span className="conditional-tag">International Student in Australia Context</span>
                        <div className="field-row">
                          <label className="field-label">Educational Institution</label>
                          <input
                            type="text"
                            className="text-input-field"
                            placeholder="e.g. University of Melbourne, Monash University..."
                            value={institutionName}
                            onChange={(e) => setInstitutionName(e.target.value)}
                          />
                        </div>
                        <div className="field-grid-2">
                          <div>
                            <label className="field-label">Visa Subclass</label>
                            <input
                              type="text"
                              className="text-input-field"
                              value={visaType}
                              onChange={(e) => setVisaType(e.target.value)}
                            />
                          </div>
                          <div>
                            <label className="field-label">Visa Expiry Date</label>
                            <input
                              type="date"
                              className="text-input-field"
                              value={residencePermitExpiry}
                              onChange={(e) => setResidencePermitExpiry(e.target.value)}
                            />
                          </div>
                        </div>
                      </div>
                    )}

                    {segment === "employee" && (
                      <div className="conditional-group-card">
                        <span className="conditional-tag">Employment Context</span>
                        <div className="field-row">
                          <label className="field-label">Employer / Company Name</label>
                          <input
                            type="text"
                            className="text-input-field"
                            placeholder="e.g. Tech Enterprise, Multinational, Local firm..."
                            value={employerName}
                            onChange={(e) => setEmployerName(e.target.value)}
                          />
                        </div>
                        <div className="field-row">
                          <label className="field-label">
                            {residenceCountry === "CN"
                              ? "Social Medical Insurance Status (医保)"
                              : "Social Health / Group Status"}
                          </label>
                          <select
                            className="text-input-field"
                            value={socialInsuranceStatus}
                            onChange={(e) => setSocialInsuranceStatus(e.target.value)}
                          >
                            <option value="Enrolled">Enrolled in basic public/social medical insurance</option>
                            <option value="Not enrolled">Not enrolled / Rely on commercial coverage</option>
                            <option value="Not sure">Not sure / Needs verification</option>
                          </select>
                        </div>
                      </div>
                    )}

                    {segment === "traveler" && (
                      <div className="conditional-group-card">
                        <span className="conditional-tag">Travel Context</span>
                        <div className="field-row">
                          <label className="field-label">Primary Destination</label>
                          <input
                            type="text"
                            className="text-input-field"
                            placeholder="e.g. China, Indonesia, Australia..."
                            value={travelDestination}
                            onChange={(e) => setTravelDestination(e.target.value)}
                          />
                        </div>
                      </div>
                    )}

                    <button
                      type="button"
                      className="chat-primary-btn"
                      onClick={handleStep2Submit}
                    >
                      <span>Continue to Protection</span>
                      <ArrowRight size={16} />
                    </button>
                  </div>
                )}

                {activeStep > 2 && (
                  <div className="chat-user-bubble">
                    <span>
                      {SITUATION_OPTIONS.find((s) => s.id === segment)?.label}
                      {institutionName ? ` · ${institutionName}` : ""}
                    </span>
                    <button
                      type="button"
                      className="edit-answer-btn"
                      onClick={() => setActiveStep(2)}
                      title="Edit Situation"
                    >
                      <Edit2 size={13} />
                    </button>
                  </div>
                )}
              </div>
            )}

            {/* Step 3: What Protection Do You Have? */}
            {activeStep >= 3 && (
              <div className="chat-turn">
                <div className="chat-assistant-bubble">
                  <p>What types of insurance do you currently have? Select all that apply.</p>
                </div>

                {activeStep === 3 && (
                  <div className="chat-form-interactive">
                    <div className="coverage-multi-list">
                      {COVERAGE_CATEGORIES.map((cat) => {
                        const isSelected = selectedCoverages.some((c) => c.id === cat.id);
                        return (
                          <div
                            key={cat.id}
                            className={`coverage-item-card ${isSelected ? "selected" : ""}`}
                            onClick={() => toggleCoverageCategory(cat.id)}
                          >
                            <div className="coverage-card-left">
                              <div className={`custom-checkbox ${isSelected ? "checked" : ""}`}>
                                {isSelected && <Check size={13} strokeWidth={3} />}
                              </div>
                              <div className="coverage-text">
                                <h4>{cat.label}</h4>
                                <p>{cat.sub}</p>
                              </div>
                            </div>
                            <span className="status-reported-pill">Self-Reported</span>
                          </div>
                        );
                      })}
                    </div>

                    <div className="form-group-card">
                      <label className="field-label">
                        Insurance Provider or Policy Name (Optional)
                      </label>
                      <input
                        type="text"
                        className="text-input-field"
                        placeholder="e.g. Ping An Comprehensive Scheme, BPJS Kesehatan, Allianz, Prudential..."
                        value={customProviderInput}
                        onChange={(e) => setCustomProviderInput(e.target.value)}
                      />
                    </div>

                    <div className="guidance-notice">
                      <ShieldCheck size={16} />
                      <span>
                        All declared insurance policies will be saved as self-reported until evidence documents
                        are uploaded and verified in My Documents.
                      </span>
                    </div>

                    <button
                      type="button"
                      className="chat-primary-btn"
                      onClick={handleStep3Submit}
                    >
                      <span>Continue to Coverage Scope</span>
                      <ArrowRight size={16} />
                    </button>
                  </div>
                )}

                {activeStep > 3 && (
                  <div className="chat-user-bubble">
                    <span>
                      {selectedCoverages.map((c) => c.category).join(", ")} (Self-Reported)
                    </span>
                    <button
                      type="button"
                      className="edit-answer-btn"
                      onClick={() => setActiveStep(3)}
                      title="Edit Coverage"
                    >
                      <Edit2 size={13} />
                    </button>
                  </div>
                )}
              </div>
            )}

            {/* Step 4: Who Needs Coverage? */}
            {activeStep >= 4 && (
              <div className="chat-turn">
                <div className="chat-assistant-bubble">
                  <p>Are you managing insurance just for yourself or for others too?</p>
                </div>

                {activeStep === 4 && (
                  <div className="chat-form-interactive">
                    <div className="scope-selection-grid">
                      {[
                        {
                          id: "self",
                          label: "Just myself",
                          sub: "Personal protection only. No family dependents to manage.",
                        },
                        {
                          id: "family",
                          label: "My family",
                          sub: "Partner, children, or dependent parents included in household.",
                        },
                        {
                          id: "team",
                          label: "My team",
                          sub: "Employee or corporate group health benefits management.",
                        },
                      ].map((item) => (
                        <div
                          key={item.id}
                          className={`scope-card ${householdScope === item.id ? "selected" : ""}`}
                          onClick={() => setHouseholdScope(item.id as typeof householdScope)}
                        >
                          <div className="scope-card-body">
                            <h4>{item.label}</h4>
                            <p>{item.sub}</p>
                          </div>
                          {householdScope === item.id && (
                            <CheckCircle2 size={18} color="#0ea58a" className="card-check-icon" />
                          )}
                        </div>
                      ))}
                    </div>

                    {householdScope === "family" && (
                      <div className="conditional-group-card">
                        <span className="conditional-tag">Family Members to Include</span>
                        <div className="family-checkboxes">
                          {["Spouse / Partner", "Children", "Parents"].map((relation) => {
                            const isIncluded = familyMembers.includes(relation);
                            return (
                              <label key={relation} className="checkbox-row">
                                <input
                                  type="checkbox"
                                  checked={isIncluded}
                                  onChange={() => {
                                    if (isIncluded) {
                                      const next = familyMembers.filter((m) => m !== relation);
                                      setFamilyMembers(next);
                                      setFamilyCount(next.length || 1);
                                    } else {
                                      const next = [...familyMembers, relation];
                                      setFamilyMembers(next);
                                      setFamilyCount(next.length);
                                    }
                                  }}
                                />
                                <span>{relation}</span>
                              </label>
                            );
                          })}
                        </div>
                      </div>
                    )}

                    <button
                      type="button"
                      className="chat-primary-btn"
                      onClick={handleStep4Submit}
                    >
                      <span>Continue to Goals</span>
                      <ArrowRight size={16} />
                    </button>
                  </div>
                )}

                {activeStep > 4 && (
                  <div className="chat-user-bubble">
                    <span>
                      {householdScope === "self"
                        ? "Personal protection only"
                        : householdScope === "family"
                        ? `Family (${familyMembers.join(", ") || "Dependents"})`
                        : "Team / Corporate group"}
                    </span>
                    <button
                      type="button"
                      className="edit-answer-btn"
                      onClick={() => setActiveStep(4)}
                      title="Edit Scope"
                    >
                      <Edit2 size={13} />
                    </button>
                  </div>
                )}
              </div>
            )}

            {/* Step 5: What Can We Help You With? */}
            {activeStep >= 5 && (
              <div className="chat-turn">
                <div className="chat-assistant-bubble">
                  <p>What would you like INSURRA to help you with? Select your key priorities.</p>
                </div>

                {activeStep === 5 && (
                  <div className="chat-form-interactive">
                    <div className="goals-multi-list">
                      {GOAL_OPTIONS.map((g) => {
                        const isSelected = selectedGoals.includes(g.id);
                        return (
                          <div
                            key={g.id}
                            className={`goal-item-card ${isSelected ? "selected" : ""}`}
                            onClick={() => {
                              if (isSelected) {
                                setSelectedGoals(selectedGoals.filter((id) => id !== g.id));
                              } else {
                                setSelectedGoals([...selectedGoals, g.id]);
                              }
                            }}
                          >
                            <div className={`custom-checkbox ${isSelected ? "checked" : ""}`}>
                              {isSelected && <Check size={13} strokeWidth={3} />}
                            </div>
                            <div className="goal-text">
                              <h4>{g.label}</h4>
                              <p>{g.sub}</p>
                            </div>
                          </div>
                        );
                      })}
                    </div>

                    {/* Optional Budget Section with explicit Skip */}
                    <div className="conditional-group-card optional-budget-box">
                      <span className="conditional-tag">Optional Personalization</span>
                      <h4 style={{ margin: "4px 0 6px", fontSize: 14, fontWeight: 700 }}>
                        Would you like to set a budget for additional coverage?
                      </h4>
                      <p style={{ margin: "0 0 12px", fontSize: 13, color: "#64748b" }}>
                        Helpful if you plan to compare plans or add supplementary private coverage.
                      </p>

                      <div className="budget-currency-row">
                        {BUDGET_CURRENCIES.map((cur) => (
                          <button
                            key={cur.code}
                            type="button"
                            className={`currency-pill ${budgetCurrency === cur.code ? "active" : ""}`}
                            onClick={() => setBudgetCurrency(cur.code)}
                          >
                            {cur.symbol} {cur.code}
                          </button>
                        ))}
                      </div>

                      <div className="budget-range-grid">
                        {(BUDGET_RANGES[budgetCurrency] || BUDGET_RANGES.USD).map((rng) => (
                          <button
                            key={rng}
                            type="button"
                            className={`range-pill ${selectedBudgetRange === rng ? "selected" : ""}`}
                            onClick={() => setSelectedBudgetRange(rng)}
                          >
                            {rng}
                          </button>
                        ))}
                      </div>
                    </div>

                    <div className="chat-btn-row">
                      <button
                        type="button"
                        className="chat-primary-btn"
                        disabled={busy}
                        onClick={() => handleStep5Submit(false)}
                      >
                        <span>Save & Complete Profile</span>
                        <ArrowRight size={16} />
                      </button>

                      <button
                        type="button"
                        className="chat-secondary-btn"
                        disabled={busy}
                        onClick={() => handleStep5Submit(true)}
                      >
                        Skip budget for now
                      </button>
                    </div>
                  </div>
                )}

                {activeStep > 5 && (
                  <div className="chat-user-bubble">
                    <span>
                      {selectedGoals.length} priorities selected
                      {selectedBudgetRange !== "No additional budget" ? ` · ${selectedBudgetRange}` : ""}
                    </span>
                    <button
                      type="button"
                      className="edit-answer-btn"
                      onClick={() => setActiveStep(5)}
                      title="Edit Goals"
                    >
                      <Edit2 size={13} />
                    </button>
                  </div>
                )}
              </div>
            )}

            {/* Step 6: Review & Get Started */}
            {activeStep === 6 && (
              <div className="chat-turn">
                <div className="chat-assistant-bubble finish-bubble">
                  <div className="finish-head">
                    <CheckCircle2 size={24} color="#0ea58a" />
                    <div>
                      <h3>Your Profile Is Ready</h3>
                      <p>
                        Your preferences have been saved. Let&apos;s verify your insurance information to
                        build an accurate picture of your protection.
                      </p>
                    </div>
                  </div>

                  <div className="profile-summary-review-card">
                    <div className="summary-row">
                      <span className="summary-label">Nationality</span>
                      <strong className="summary-val">
                        {activeNationalityObj.flag} {nationality}
                      </strong>
                    </div>
                    <div className="summary-row">
                      <span className="summary-label">Residence</span>
                      <strong className="summary-val">
                        {city}, {activeCountryObj.name} {activeCountryObj.flag}
                      </strong>
                    </div>
                    <div className="summary-row">
                      <span className="summary-label">Situation</span>
                      <strong className="summary-val">
                        {SITUATION_OPTIONS.find((s) => s.id === segment)?.label}
                        {institutionName ? ` · ${institutionName}` : ""}
                      </strong>
                    </div>
                    <div className="summary-row">
                      <span className="summary-label">Declared Coverage</span>
                      <strong className="summary-val">
                        {selectedCoverages.map((c) => c.category).join(", ")}
                      </strong>
                    </div>
                    <div className="summary-row">
                      <span className="summary-label">Coverage Status</span>
                      <span className="status-reported-pill">Self-Reported (Unverified)</span>
                    </div>
                  </div>

                  <div className="tailored-next-steps">
                    <h4>Suggested Next Steps</h4>
                    <div className="next-step-row">
                      <div className="step-icon-badge">1</div>
                      <div className="step-desc">
                        <h5>Upload your insurance certificate</h5>
                        <p>Help INSURRA identify your policy details, coverage limits, and valid dates.</p>
                      </div>
                    </div>
                    <div className="next-step-row">
                      <div className="step-icon-badge">2</div>
                      <div className="step-desc">
                        <h5>Check your protection details</h5>
                        <p>See what information is available and what still needs verification.</p>
                      </div>
                    </div>
                  </div>

                  <div className="chat-btn-row" style={{ marginTop: 20 }}>
                    <Link href="/documents" className="chat-primary-btn" style={{ textDecoration: "none" }}>
                      <span>Continue to My Documents</span>
                      <ArrowRight size={16} />
                    </Link>
                    <Link href="/protection" className="chat-secondary-btn" style={{ textDecoration: "none" }}>
                      <span>View My Protection</span>
                    </Link>
                  </div>
                </div>
              </div>
            )}
          </div>
        </section>

        {/* Right Column: Live Context Profile & Dynamic Suggested Docs */}
        <aside className="onboarding-live-panel" aria-label="Live Context Profile">
          <div className="live-panel-header">
            <span className="live-dot-pulse" />
            <h3>Live Context Profile</h3>
          </div>

          {/* Metric Split: Profile Setup vs Coverage Verification */}
          <div className="profile-metrics-split">
            <div className="metric-box">
              <span className="metric-title">Profile Setup</span>
              <div className="metric-val green">
                {activeStep >= 6 || isCompleted ? "100%" : `${Math.round((activeStep / 6) * 100)}%`}
              </div>
              <p className="metric-sub">
                {activeStep >= 6 || isCompleted
                  ? "All required onboarding questions answered"
                  : `Step ${activeStep} of 6 in progress`}
              </p>
            </div>

            <div className="metric-box">
              <span className="metric-title">Coverage Verification</span>
              <div className="metric-val orange">Not started</div>
              <p className="metric-sub">Upload policy documents to begin evidence checks</p>
            </div>
          </div>

          {/* Live Context Summary Cards */}
          <div className="live-context-section">
            <div className="live-context-card">
              <div className="context-card-head">
                <Globe2 size={16} color="#0ea58a" />
                <span>Location & Jurisdiction</span>
              </div>
              <div className="context-card-val">
                <span className="flag-icon">{activeCountryObj.flag}</span>
                <strong>
                  {city ? `${city}, ` : ""}
                  {activeCountryObj.name}
                </strong>
              </div>
              <span className="context-tag">Nationality: {nationality}</span>
            </div>

            <div className="live-context-card">
              <div className="context-card-head">
                <User size={16} color="#0ea58a" />
                <span>Situation & Household</span>
              </div>
              <div className="context-card-val">
                <strong>{SITUATION_OPTIONS.find((s) => s.id === segment)?.label || "Student"}</strong>
              </div>
              <span className="context-tag">
                {householdScope === "self" ? "Personal protection only" : "Household members added"}
              </span>
            </div>

            <div className="live-context-card">
              <div className="context-card-head">
                <Shield size={16} color="#0ea58a" />
                <span>Declared Protection</span>
              </div>
              <div className="coverage-badge-cloud">
                {selectedCoverages.map((c) => (
                  <span key={c.id} className="live-cov-pill">
                    {c.category} · <small>Self-Reported</small>
                  </span>
                ))}
              </div>
            </div>
          </div>

          {/* Dynamic Suggested Documents Generator: f(Country, User Type, Coverage, Goal) */}
          <div className="suggested-docs-container">
            <div className="suggested-docs-head">
              <h4>Suggested Documents</h4>
              <span className="formula-badge">
                f({activeCountryObj.code}, {segment})
              </span>
            </div>
            <p className="suggested-docs-sub">
              Tailored to your location, situation, and declared coverage categories.
            </p>

            <div className="suggested-docs-list">
              {dynamicSuggestedDocs.map((doc) => (
                <div key={doc.id} className="suggested-doc-card">
                  <div className="doc-card-top">
                    <FileText size={16} color="#0ea58a" />
                    <h5>{doc.title}</h5>
                    <span className={`doc-status-badge ${doc.statusType}`}>{doc.status}</span>
                  </div>
                  <p className="doc-desc">{doc.description}</p>
                  <span className="doc-reason">{doc.sourceReason}</span>
                </div>
              ))}
            </div>
          </div>
        </aside>
      </main>
    </div>
  );
}

export default function AccountOnboarding() {
  return (
    <Suspense
      fallback={
        <div style={{ padding: 40, textAlign: "center", color: "#64748b" }}>
          Loading interactive onboarding...
        </div>
      }
    >
      <AccountOnboardingContent />
    </Suspense>
  );
}
