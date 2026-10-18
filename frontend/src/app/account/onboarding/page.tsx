"use client";

import Image from "next/image";
import Link from "next/link";
import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertCircle,
  ArrowRight,
  Briefcase,
  Check,
  Compass,
  Edit2,
  Globe2,
  Heart,
  MapPin,
  Shield,
  ShieldCheck,
  Sparkles,
  Users,
  Wallet,
} from "lucide-react";
import { api } from "@/lib/api/client";
import type { components } from "@/lib/api/types.gen";
import { useAuth } from "@/lib/auth";
import "@/app/onboarding/onboarding.css";

type ProfileData = components["schemas"]["ProfileData"];
type AccountProfileState = components["schemas"]["AccountProfileState"];
type CountryCode = "AU" | "ID";

const DEFAULT_PROFILE: ProfileData = {
  display_name: "",
  residence_context: "ABROAD",
  country_code: "AU",
  city: "Melbourne",
  occupation: "STUDENT",
  timezone: "Australia/Melbourne",
  employment_status: "",
  institution_name: "",
  dependents: ["None"],
  owned_coverage: ["OSHC"],
  priorities: ["low_cost", "speed"],
  budget_range: "$50 - $150 / month",
  currency: "AUD",
  arrival_date: "2026-02-15",
  visa_expiry_date: "2027-03-15",
};

const AUSTRALIA_CITIES = ["Melbourne", "Sydney", "Brisbane", "Perth", "Adelaide", "Canberra"];
const INDONESIA_CITIES = ["Jakarta", "Surabaya", "Bandung", "Medan", "Yogyakarta", "Bali"];

const DEPENDENT_OPTIONS = [
  { id: "None", label: "Just Myself", sub: "No additional family dependents" },
  { id: "Spouse", label: "Spouse / Partner", sub: "Husband, wife, or de facto partner" },
  { id: "Children", label: "Children", sub: "Dependent children under 18 years old" },
  { id: "Parents", label: "Parents", sub: "Dependent parents or senior family members" },
];

const COVERAGE_OPTIONS_AU = [
  { id: "OSHC", label: "OSHC (Student Health Cover)", sub: "Mandatory for Australian student visas (Condition 8501)" },
  { id: "OVHC", label: "OVHC (Visitor & Graduate Visa)", sub: "Health cover for Subclass 482/485 graduates and working visitors" },
  { id: "EMPLOYER", label: "Corporate / Employer Health", sub: "Company-sponsored group health insurance in Australia" },
  { id: "PERSONAL_HEALTH", label: "Australian Private Health", sub: "Private hospital and extras cover (Medibank, Bupa, NIB, AHM)" },
  { id: "TRAVEL", label: "International Travel Insurance", sub: "Active international emergency medical travel cover" },
  { id: "NOT_SURE", label: "Not Sure / Needs Verification", sub: "Let Insurra inspect your policy documents to determine coverage" },
];

const COVERAGE_OPTIONS_ID = [
  { id: "BPJS", label: "BPJS Kesehatan (JKN)", sub: "National mandatory health insurance program of Indonesia" },
  { id: "EMPLOYER", label: "Corporate / Employer Health", sub: "Company group inpatient and outpatient health benefits" },
  { id: "PERSONAL_HEALTH", label: "Private Health Insurance", sub: "Individual hospital cover (cashless or reimbursement plans)" },
  { id: "LIFE", label: "Life & Critical Illness Cover", sub: "Term life, critical illness, or unit link family protection" },
  { id: "TRAVEL", label: "Travel Insurance", sub: "Domestic or international journey emergency health coverage" },
  { id: "NOT_SURE", label: "Not Sure / Needs Verification", sub: "Let Insurra review your insurance documents to identify policies" },
];

const PRIORITY_OPTIONS = [
  {
    id: "low_cost",
    label: "Lower Out-of-Pocket Costs",
    sub: "Minimize excess fees, co-payments, and medical gap expenses",
  },
  {
    id: "speed",
    label: "Speed & Convenience",
    sub: "Instant hospital admission guarantees, fast digital claims, direct billing",
  },
  {
    id: "choice",
    label: "Doctor & Hospital Choice",
    sub: "Access to private hospital rooms, chosen specialists, and preferred clinics",
  },
  {
    id: "family",
    label: "Family Protection",
    sub: "Comprehensive protection and shared coverage limits for household dependents",
  },
];

const BUDGET_OPTIONS_AU = [
  { id: "none", label: "No additional budget", sub: "Rely solely on existing insurance cover" },
  { id: "low", label: "< $50 / month", sub: "Basic extras or medical gap buffer" },
  { id: "mid", label: "$50 - $150 / month", sub: "Balanced extras, dental, optical, and ambulance cover" },
  { id: "high", label: "$150 - $300 / month", sub: "Comprehensive private hospital and specialist cover" },
  { id: "top", label: "> $300 / month", sub: "Premium health cover with zero excess and top limits" },
];

const BUDGET_OPTIONS_ID = [
  { id: "none", label: "No additional budget", sub: "Rely solely on existing insurance cover" },
  { id: "low", label: "< Rp 250,000 / month", sub: "Basic supplementary outpatient protection alongside BPJS" },
  { id: "mid", label: "Rp 250,000 - Rp 750,000 / month", sub: "Standard outpatient, dental, and clinic top-up coverage" },
  { id: "high", label: "Rp 750,000 - Rp 1,500,000 / month", sub: "Regular private inpatient hospital insurance" },
  { id: "top", label: "> Rp 1,500,000 / month", sub: "VIP hospital room and high annual limit protection" },
];

interface SuggestedDocItem {
  id: string;
  kind: string;
  title: string;
  badge: "Visa Required" | "Mandatory" | "Recommended";
  badgeType: "visa-req" | "mandatory" | "recommended";
  description: string;
  sourceUrl?: string;
  sourceLabel?: string;
}

function AccountOnboardingContent() {
  const { account, token } = useAuth();

  // Profile data
  const [profile, setProfile] = useState<ProfileData>(DEFAULT_PROFILE);
  const [, setBusy] = useState(false);
  const [draftSaved, setDraftSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Conversational chat state
  // Steps: 1: Residence, 2: Location/Status/Visa, 3: Dependents, 4: Coverage, 5: Priorities, 6: Budget, 7: Finished
  const [activeStep, setActiveStep] = useState<number>(1);
  const [, setMaxCompletedStep] = useState<number>(0);
  const [isTyping, setIsTyping] = useState<boolean>(false);
  const [isCompleted, setIsCompleted] = useState<boolean>(false);

  // Temporary state for multi-input steps (Step 2, 3, 4, 5)
  const [customCity, setCustomCity] = useState<string>("");
  const [tempArrivalDate, setTempArrivalDate] = useState<string>("2026-02-15");
  const [tempVisaExpiry, setTempVisaExpiry] = useState<string>("2027-03-15");

  const chatScrollRef = useRef<HTMLDivElement>(null);

  // Load existing profile / draft on start
  useEffect(() => {
    if (!token) return;
    let active = true;

    api
      .request("get", "/api/v1/account/profile", {
        headers: { Authorization: `Bearer ${token}` },
      })
      .then((state: AccountProfileState) => {
        if (!active) return;
        const source = (state.profile ?? state.draft ?? {}) as Partial<ProfileData>;
        const isAU = (source.country_code || "AU") === "AU";
        const merged: ProfileData = {
          ...DEFAULT_PROFILE,
          ...source,
          display_name: source.display_name || account?.display_name || "",
          residence_context: source.residence_context || (isAU ? "ABROAD" : "DOMESTIC"),
          country_code: (source.country_code as CountryCode) || "AU",
          city: source.city || (isAU ? "Melbourne" : "Jakarta"),
          currency: (source.currency as "AUD" | "IDR") || (isAU ? "AUD" : "IDR"),
          arrival_date: source.arrival_date || (isAU ? "2026-02-15" : null),
          visa_expiry_date: source.visa_expiry_date || (isAU ? "2027-03-15" : null),
        };
        setProfile(merged);
        setCustomCity(merged.city || "");
        if (merged.arrival_date) setTempArrivalDate(merged.arrival_date);
        if (merged.visa_expiry_date) setTempVisaExpiry(merged.visa_expiry_date);

        if (state.completed) {
          setIsCompleted(true);
          setActiveStep(7);
          setMaxCompletedStep(6);
        }
      })
      .catch(() => {
        // Fallback default profile
      });

    return () => {
      active = false;
    };
  }, [token, account?.display_name]);

  // Auto-scroll chat to bottom
  const scrollToBottom = () => {
    setTimeout(() => {
      if (chatScrollRef.current) {
        chatScrollRef.current.scrollTo({
          top: chatScrollRef.current.scrollHeight,
          behavior: "smooth",
        });
      }
    }, 80);
  };

  useEffect(() => {
    scrollToBottom();
  }, [activeStep, isTyping, isCompleted]);

  // Autosave draft helper
  async function persistDraft(updatedData: ProfileData) {
    if (!token) return;
    try {
      await api.request("put", "/api/v1/account/profile/draft", {
        headers: { Authorization: `Bearer ${token}` },
        body: updatedData,
      });
      setDraftSaved(true);
      setTimeout(() => setDraftSaved(false), 2000);
    } catch {
      // Ignore background draft errors
    }
  }

  // Final submission of profile to complete onboarding
  async function completeOnboarding(profileToSave = profile) {
    setError(null);
    setBusy(true);

    try {
      if (token) {
        await api.request("put", "/api/v1/account/profile", {
          headers: { Authorization: `Bearer ${token}` },
          body: profileToSave,
        });
      }
      setIsCompleted(true);
      setActiveStep(7);
      setMaxCompletedStep(6);
      return true;
    } catch (cause: unknown) {
      setError(cause instanceof Error ? cause.message : "Failed to save profile. Please try again.");
      return false;
    } finally {
      setBusy(false);
    }
  }

  // Derived suggested documents list based on profile and country context
  const suggestedDocsList = useMemo<SuggestedDocItem[]>(() => {
    const list: SuggestedDocItem[] = [];
    const isAU = profile.country_code === "AU";
    const isStudent = profile.occupation === "STUDENT";
    const owned = profile.owned_coverage || [];
    const notSure = owned.includes("NOT_SURE");

    if (isAU) {
      if (isStudent || owned.includes("OSHC") || owned.includes("OVHC")) {
        list.push({
          id: "oshc_certificate",
          kind: "oshc_certificate",
          title: "OSHC / OVHC Policy Certificate",
          badge: "Visa Required",
          badgeType: "visa-req",
          description: "From your Australian health insurer (Allianz Care, Medibank, Bupa, NIB, or AHM)",
          sourceUrl: "https://immi.homeaffairs.gov.au/visas/getting-a-visa/visa-listing/student-500#Eligibility",
          sourceLabel: "Visa Condition 8501 Compliance",
        });
      }

      list.push({
        id: "visa_grant_notice",
        kind: "visa_grant_notice",
        title: "Visa Grant Notice",
        badge: "Recommended",
        badgeType: "recommended",
        description: "Official visa grant notification letter from the Australian Department of Home Affairs",
      });

      if (owned.includes("OSHC") || isStudent || owned.includes("PERSONAL_HEALTH")) {
        list.push({
          id: "policy_booklet",
          kind: "policy_booklet",
          title: "Policy Booklet & MBS Schedule",
          badge: "Recommended",
          badgeType: "recommended",
          description: "Details Medicare Benefits Schedule (MBS) coverage, hospital excess, and waiting periods",
        });
      }

      if (owned.includes("EMPLOYER")) {
        list.push({
          id: "employer_policy",
          kind: "employer_policy",
          title: "Corporate Health Policy Schedule",
          badge: "Recommended",
          badgeType: "recommended",
          description: "From your corporate HR portal or expatriate health benefits handbook",
        });
      }

      if (notSure && list.length < 3) {
        list.push({
          id: "other",
          kind: "other",
          title: "Insurance Card / Evidence Document",
          badge: "Recommended",
          badgeType: "recommended",
          description: "Any photo or policy certificate for Insurra to inspect and verify",
        });
      }
    } else {
      // Indonesia
      list.push({
        id: "bpjs_card",
        kind: "bpjs_card",
        title: "BPJS Kesehatan Digital Card",
        badge: "Mandatory",
        badgeType: "mandatory",
        description: "Digital card screenshot from Mobile JKN app or scanned physical card",
        sourceUrl: "https://bpjs-kesehatan.go.id",
        sourceLabel: "Official BPJS Kesehatan Portal",
      });

      if (owned.includes("EMPLOYER")) {
        list.push({
          id: "employer_policy",
          kind: "employer_policy",
          title: "Corporate Group Health Policy",
          badge: "Recommended",
          badgeType: "recommended",
          description: "From company HR portal or employee benefits guidebook",
        });
      }

      if (owned.includes("PERSONAL_HEALTH") || owned.includes("LIFE")) {
        list.push({
          id: "policy_booklet",
          kind: "policy_booklet",
          title: "Private Health Policy Schedule",
          badge: "Recommended",
          badgeType: "recommended",
          description: "Table of benefits from your private insurer showing room rates, limits, and exclusions",
        });
      }

      if (notSure && list.length < 3) {
        list.push({
          id: "insurance_card",
          kind: "insurance_card",
          title: "Insurance Card / Participation Proof",
          badge: "Recommended",
          badgeType: "recommended",
          description: "Any insurance card or certificate for Insurra to review and categorize",
        });
      }
    }

    return list.slice(0, 4);
  }, [profile]);

  // Transition to next chat step with typing delay
  function advanceToStep(nextStep: number, updatedProfile: ProfileData) {
    setProfile(updatedProfile);
    void persistDraft(updatedProfile);
    setMaxCompletedStep((prev) => Math.max(prev, activeStep));

    setIsTyping(true);
    setTimeout(() => {
      setIsTyping(false);
      setActiveStep(nextStep);
    }, 450);
  }

  // Handlers for interactive questions:

  // Step 1: Residence Context
  function handleSelectResidence(context: "ABROAD" | "DOMESTIC") {
    const isAbroad = context === "ABROAD";
    const targetCountry: CountryCode = isAbroad ? "AU" : "ID";
    const updated: ProfileData = {
      ...profile,
      residence_context: context,
      country_code: targetCountry,
      city: isAbroad ? "Melbourne" : "Jakarta",
      currency: isAbroad ? "AUD" : "IDR",
      timezone: isAbroad ? "Australia/Melbourne" : "Asia/Jakarta",
      owned_coverage: isAbroad ? ["OSHC"] : ["BPJS"],
      budget_range: isAbroad ? "$50 - $150 / month" : "Rp 250,000 - Rp 750,000 / month",
    };
    advanceToStep(2, updated);
  }

  // Step 2: Location & Status
  function handleSubmitStep2() {
    const finalCity = (customCity || profile.city || (profile.country_code === "AU" ? "Melbourne" : "Jakarta")).trim();
    if (!finalCity) {
      setError("Please specify your city of residence.");
      return;
    }

    if (profile.residence_context === "ABROAD" && profile.country_code === "AU") {
      if (!tempArrivalDate || !tempVisaExpiry) {
        setError("Arrival date and visa expiry date are required for Australian residence.");
        return;
      }
      if (tempVisaExpiry <= tempArrivalDate) {
        setError("Visa expiry date must be later than your arrival date.");
        return;
      }
    }

    setError(null);
    const updated: ProfileData = {
      ...profile,
      city: finalCity,
      arrival_date: profile.residence_context === "ABROAD" ? tempArrivalDate : null,
      visa_expiry_date: profile.residence_context === "ABROAD" ? tempVisaExpiry : null,
    };
    advanceToStep(3, updated);
  }

  // Step 3: Dependents
  function toggleDependent(id: string) {
    let current = [...(profile.dependents || [])];
    if (id === "None") {
      current = ["None"];
    } else {
      current = current.filter((item) => item !== "None");
      if (current.includes(id)) {
        current = current.filter((item) => item !== id);
      } else {
        current.push(id);
      }
      if (current.length === 0) current = ["None"];
    }
    setProfile({ ...profile, dependents: current });
  }

  function handleSubmitStep3() {
    if (!profile.dependents || profile.dependents.length === 0) {
      setError("Please select who should be included in your coverage.");
      return;
    }
    setError(null);
    advanceToStep(4, profile);
  }

  // Step 4: Existing Coverage
  function toggleCoverage(id: string) {
    let current = [...(profile.owned_coverage || [])];
    if (id === "NOT_SURE") {
      current = ["NOT_SURE"];
    } else {
      current = current.filter((item) => item !== "NOT_SURE");
      if (current.includes(id)) {
        current = current.filter((item) => item !== id);
      } else {
        current.push(id);
      }
      if (current.length === 0) current = ["NOT_SURE"];
    }
    setProfile({ ...profile, owned_coverage: current });
  }

  function handleSubmitStep4() {
    if (!profile.owned_coverage || profile.owned_coverage.length === 0) {
      setError("Please select your current insurance, or choose 'Not Sure / Needs Verification'.");
      return;
    }
    setError(null);
    advanceToStep(5, profile);
  }

  // Step 5: Priorities
  function togglePriority(id: string) {
    let current = [...(profile.priorities || [])];
    if (current.includes(id)) {
      current = current.filter((item) => item !== id);
    } else {
      if (current.length >= 2) {
        current = [current[1], id];
      } else {
        current.push(id);
      }
    }
    setProfile({ ...profile, priorities: current });
  }

  function handleSubmitStep5() {
    setError(null);
    advanceToStep(6, profile);
  }

  // Step 6: Budget
  async function handleSelectBudget(budgetLabel: string) {
    const updated: ProfileData = {
      ...profile,
      budget_range: budgetLabel,
    };
    setProfile(updated);
    setIsTyping(true);
    await completeOnboarding(updated);
    setIsTyping(false);
  }

  // Jump back to re-answer a step
  function jumpToStep(targetStep: number) {
    setError(null);
    setActiveStep(targetStep);
  }

  // Display Name of User
  const userName = profile.display_name || account?.display_name || "Companion Member";
  const isAU = profile.country_code === "AU";

  // Calculate live completion percentage
  const completionPct = Math.min(100, Math.round(((Math.min(activeStep, 6) - 1) / 5) * 100));

  return (
    <div className="chat-onboarding-shell">
      {/* ---------------- Topbar ---------------- */}
      <header className="chat-topbar">
        <Link href="/" style={{ display: "flex", alignItems: "center", gap: 10, textDecoration: "none" }}>
          <svg width="26" height="26" viewBox="0 0 32 32" fill="none">
            <path d="M5 7C7 16 12 23 16 26C15 19 13 12 7 7H5Z" fill="#00b074" />
            <path d="M27 7C25 16 20 23 16 26C17 19 19 12 25 7H27Z" fill="#00b074" />
          </svg>
          <span style={{ fontSize: "20px", fontWeight: 800, color: "#0f1d38", letterSpacing: "-0.01em" }}>
            INSURRA
          </span>
        </Link>

        {/* Stepper Progress Tracker */}
        <div className="chat-progress-wrap">
          <span className="chat-step-label">
            {isCompleted ? "Complete" : `Step ${Math.min(activeStep, 6)} of 6`}
          </span>
          <div className="chat-progress-track" title={`${completionPct}% Completed`}>
            <div className="chat-progress-fill" style={{ width: `${isCompleted ? 100 : Math.max(16, completionPct)}%` }} />
          </div>
          <span style={{ fontSize: "12px", fontWeight: 700, color: "#00875a" }}>
            {completionPct}%
          </span>
        </div>

        <Link href="/dashboard" className="onboarding-exit-btn">
          Skip to Dashboard
        </Link>
      </header>

      {/* ---------------- Main Content Grid ---------------- */}
      <main className="chat-main-grid">
        {/* Left Column: Interactive Chat Stream */}
        <section className="chat-stream-container">
          <div className="chat-stream-header">
            <div className="chat-stream-title">
              <Compass size={17} color="#0ea58a" />
              <span>Interactive Protection Context</span>
              <span className="badge">Conversational</span>
            </div>
            {draftSaved && <span className="autosave-pill"><Check size={12} /> Auto-saved</span>}
          </div>

          <div className="chat-messages-scroll" ref={chatScrollRef}>
            {/* ---------------- TURN 1: GREETING & RESIDENCE CONTEXT ---------------- */}
            <div className="chat-turn assistant-turn">
              <div className="assistant-message-row">
                <div className="assistant-avatar-wrap">
                  <Image src="/protection-hero-person.png" alt="Insurra AI" width={40} height={40} className="assistant-avatar-img" />
                </div>
                <div className="chat-assistant-bubble">
                  <p>
                    Hello <strong>{userName}</strong>! 👋 Great to meet you.
                  </p>
                  <p>
                    I am your personal AI insurance companion. To tailor visa rules, document requirements, and claim insights without confusion, let&apos;s map your profile through this quick chat.
                  </p>
                  <p>
                    First, <strong>where are you currently living?</strong>
                  </p>
                </div>
              </div>

              {/* Active Interactive Box for Step 1 */}
              {activeStep === 1 && (
                <div className="chat-interactive-box">
                  <div className="interactive-title">Select Your Residence Context:</div>
                  <div className="chat-options-grid">
                    <button
                      type="button"
                      className={`chat-option-card ${profile.residence_context === "ABROAD" ? "selected" : ""}`}
                      onClick={() => handleSelectResidence("ABROAD")}
                    >
                      <span className="chat-option-icon">🌏</span>
                      <div className="chat-option-text">
                        <h4>Living Abroad in Australia</h4>
                        <p>Australia (OSHC / OVHC, Visa Condition 8501, international immigration compliance)</p>
                      </div>
                    </button>
                    <button
                      type="button"
                      className={`chat-option-card ${profile.residence_context === "DOMESTIC" ? "selected" : ""}`}
                      onClick={() => handleSelectResidence("DOMESTIC")}
                    >
                      <span className="chat-option-icon">🏠</span>
                      <div className="chat-option-text">
                        <h4>Living in Indonesia</h4>
                        <p>Domestic (BPJS Kesehatan / JKN integration, Coordination of Benefits / KAPJ, private health)</p>
                      </div>
                    </button>
                  </div>
                </div>
              )}
            </div>

            {/* User Response to Step 1 */}
            {activeStep > 1 && (
              <div className="chat-turn user-turn">
                <div className="user-message-row">
                  <div className="user-bubble">
                    <span>
                      {profile.residence_context === "ABROAD" ? "🌏 Living Abroad (Australia)" : "🏠 Living in Indonesia"}
                    </span>
                    <div className="user-bubble-actions">
                      <button type="button" className="btn-edit-answer" onClick={() => jumpToStep(1)}>
                        <Edit2 size={11} /> Edit
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* ---------------- TURN 2: LOCATION, STATUS & VISA ---------------- */}
            {activeStep >= 2 && (
              <div className="chat-turn assistant-turn">
                <div className="assistant-message-row">
                  <div className="assistant-avatar-wrap">
                    <Image src="/protection-hero-person.png" alt="Insurra AI" width={40} height={40} className="assistant-avatar-img" />
                  </div>
                  <div className="chat-assistant-bubble">
                    <p>
                      {profile.residence_context === "ABROAD" ? (
                        <>Excellent! Living abroad in Australia requires close attention to visa conditions and health coverage (Condition 8501). Which city in Australia are you based in?</>
                      ) : (
                        <>Understood! For Indonesia, Insurra tailors BPJS Kesehatan integration, coordination of benefits (KAPJ), and private hospital networks. Which city are you based in?</>
                      )}
                    </p>
                    <p>Please confirm your location and occupation status below:</p>
                  </div>
                </div>

                {activeStep === 2 && (
                  <div className="chat-interactive-box">
                    <div className="interactive-title">Location &amp; Occupation Details:</div>

                    {/* Country Toggle */}
                    <div className="chat-inline-field">
                      <label>Country of Residence:</label>
                      <div className="chat-pills-row">
                        <button
                          type="button"
                          className={`chat-pill-btn ${profile.country_code === "AU" ? "active" : ""}`}
                          onClick={() => {
                            setProfile({ ...profile, country_code: "AU", currency: "AUD", city: "Melbourne" });
                            setCustomCity("Melbourne");
                          }}
                        >
                          🇦🇺 Australia (AU)
                        </button>
                        <button
                          type="button"
                          className={`chat-pill-btn ${profile.country_code === "ID" ? "active" : ""}`}
                          onClick={() => {
                            setProfile({ ...profile, country_code: "ID", currency: "IDR", city: "Jakarta" });
                            setCustomCity("Jakarta");
                          }}
                        >
                          🇮🇩 Indonesia (ID)
                        </button>
                      </div>
                    </div>

                    {/* City quick pills + Input */}
                    <div className="chat-inline-field">
                      <label>City of Residence:</label>
                      <div className="chat-pills-row">
                        {(isAU ? AUSTRALIA_CITIES : INDONESIA_CITIES).map((c) => (
                          <button
                            key={c}
                            type="button"
                            className={`chat-pill-btn ${(customCity || profile.city) === c ? "active" : ""}`}
                            onClick={() => {
                              setCustomCity(c);
                              setProfile({ ...profile, city: c });
                            }}
                          >
                            {c}
                          </button>
                        ))}
                      </div>
                      <input
                        type="text"
                        placeholder="Or type another city name..."
                        className="chat-text-input"
                        value={customCity}
                        onChange={(e) => {
                          setCustomCity(e.target.value);
                          setProfile({ ...profile, city: e.target.value });
                        }}
                      />
                    </div>

                    {/* Occupation Pills */}
                    <div className="chat-inline-field">
                      <label>Primary Status / Occupation:</label>
                      <div className="chat-pills-row">
                        {isAU ? (
                          <>
                            <button
                              type="button"
                              className={`chat-pill-btn ${profile.occupation === "STUDENT" ? "active" : ""}`}
                              onClick={() => setProfile({ ...profile, occupation: "STUDENT" })}
                            >
                              🎓 International Student (Subclass 500)
                            </button>
                            <button
                              type="button"
                              className={`chat-pill-btn ${profile.occupation === "EMPLOYEE" ? "active" : ""}`}
                              onClick={() => setProfile({ ...profile, occupation: "EMPLOYEE" })}
                            >
                              💼 Professional / Skilled Worker
                            </button>
                            <button
                              type="button"
                              className={`chat-pill-btn ${profile.occupation === "OTHER" ? "active" : ""}`}
                              onClick={() => setProfile({ ...profile, occupation: "OTHER" })}
                            >
                              🧳 Graduate (485) / Working Holiday
                            </button>
                          </>
                        ) : (
                          <>
                            <button
                              type="button"
                              className={`chat-pill-btn ${profile.occupation === "EMPLOYEE" ? "active" : ""}`}
                              onClick={() => setProfile({ ...profile, occupation: "EMPLOYEE" })}
                            >
                              💼 Corporate Employee / Professional
                            </button>
                            <button
                              type="button"
                              className={`chat-pill-btn ${profile.occupation === "STUDENT" ? "active" : ""}`}
                              onClick={() => setProfile({ ...profile, occupation: "STUDENT" })}
                            >
                              🎓 Student / Higher Education
                            </button>
                            <button
                              type="button"
                              className={`chat-pill-btn ${profile.occupation === "OTHER" ? "active" : ""}`}
                              onClick={() => setProfile({ ...profile, occupation: "OTHER" })}
                            >
                              🧳 Self-Employed / Freelancer
                            </button>
                          </>
                        )}
                      </div>
                    </div>

                    {/* Visa Dates (if Abroad in AU) */}
                    {profile.residence_context === "ABROAD" && isAU && (
                      <div style={{ background: "#f8fafb", padding: "14px", borderRadius: "14px", border: "1px solid #e5eff2", marginBottom: "16px" }}>
                        <div style={{ fontSize: "12px", fontWeight: "750", color: "#16584a", marginBottom: "8px", display: "flex", alignItems: "center", gap: "6px" }}>
                          <Shield size={14} /> Arrival &amp; Visa Validity Dates (Condition 8501 Compliance):
                        </div>
                        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px" }}>
                          <div>
                            <label style={{ fontSize: "11px", color: "#556c80" }}>Arrival Date in Australia:</label>
                            <input
                              type="date"
                              className="chat-text-input"
                              value={tempArrivalDate}
                              onChange={(e) => setTempArrivalDate(e.target.value)}
                            />
                          </div>
                          <div>
                            <label style={{ fontSize: "11px", color: "#556c80" }}>Visa Expiry Date:</label>
                            <input
                              type="date"
                              className="chat-text-input"
                              value={tempVisaExpiry}
                              onChange={(e) => setTempVisaExpiry(e.target.value)}
                            />
                          </div>
                        </div>
                      </div>
                    )}

                    {error && (
                      <div style={{ color: "#d93838", fontSize: "12.5px", marginBottom: "12px", display: "flex", alignItems: "center", gap: "6px" }}>
                        <AlertCircle size={15} /> {error}
                      </div>
                    )}

                    <button type="button" className="chat-submit-btn" onClick={handleSubmitStep2}>
                      Continue to Dependents <ArrowRight size={15} />
                    </button>
                  </div>
                )}
              </div>
            )}

            {/* User Response to Step 2 */}
            {activeStep > 2 && (
              <div className="chat-turn user-turn">
                <div className="user-message-row">
                  <div className="user-bubble">
                    <span>
                      📍 {profile.city}, {isAU ? "Australia 🇦🇺" : "Indonesia 🇮🇩"} · {profile.occupation}
                    </span>
                    {profile.residence_context === "ABROAD" && profile.visa_expiry_date && (
                      <span className="user-subtext">Visa valid until: {profile.visa_expiry_date}</span>
                    )}
                    <div className="user-bubble-actions">
                      <button type="button" className="btn-edit-answer" onClick={() => jumpToStep(2)}>
                        <Edit2 size={11} /> Edit
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* ---------------- TURN 3: DEPENDENTS ---------------- */}
            {activeStep >= 3 && (
              <div className="chat-turn assistant-turn">
                <div className="assistant-message-row">
                  <div className="assistant-avatar-wrap">
                    <Image src="/protection-hero-person.png" alt="Insurra AI" width={40} height={40} className="assistant-avatar-img" />
                  </div>
                  <div className="chat-assistant-bubble">
                    <p>
                      Noted! Next, let&apos;s look at your household. <strong>Who should be included in your protection circle?</strong>
                    </p>
                    <p>
                      You can select multiple options if your spouse, children, or parents live with you.
                    </p>
                  </div>
                </div>

                {activeStep === 3 && (
                  <div className="chat-interactive-box">
                    <div className="interactive-title">Select Household Dependents:</div>
                    <div className="chat-options-grid">
                      {DEPENDENT_OPTIONS.map((dep) => {
                        const isSelected = (profile.dependents || []).includes(dep.id);
                        return (
                          <button
                            key={dep.id}
                            type="button"
                            className={`chat-option-card ${isSelected ? "selected" : ""}`}
                            onClick={() => toggleDependent(dep.id)}
                          >
                            <span className="chat-option-icon">
                              {dep.id === "None" ? "👤" : dep.id === "Spouse" ? "💍" : dep.id === "Children" ? "👶" : "👵"}
                            </span>
                            <div className="chat-option-text">
                              <h4>{dep.label}</h4>
                              <p>{dep.sub}</p>
                            </div>
                          </button>
                        );
                      })}
                    </div>

                    <div style={{ marginTop: "16px" }}>
                      <button type="button" className="chat-submit-btn" onClick={handleSubmitStep3}>
                        Confirm Dependents <ArrowRight size={15} />
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* User Response to Step 3 */}
            {activeStep > 3 && (
              <div className="chat-turn user-turn">
                <div className="user-message-row">
                  <div className="user-bubble">
                    <span>
                      👨‍👩‍👧 {(profile.dependents || []).map((d) => (d === "None" ? "Just Myself" : d === "Spouse" ? "Spouse" : d === "Children" ? "Children" : "Parents")).join(", ")}
                    </span>
                    <div className="user-bubble-actions">
                      <button type="button" className="btn-edit-answer" onClick={() => jumpToStep(3)}>
                        <Edit2 size={11} /> Edit
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* ---------------- TURN 4: EXISTING COVERAGE ---------------- */}
            {activeStep >= 4 && (
              <div className="chat-turn assistant-turn">
                <div className="assistant-message-row">
                  <div className="assistant-avatar-wrap">
                    <Image src="/protection-hero-person.png" alt="Insurra AI" width={40} height={40} className="assistant-avatar-img" />
                  </div>
                  <div className="chat-assistant-bubble">
                    <p>
                      Great! Next, <strong>what insurance policies do you currently hold?</strong>
                    </p>
                    <p>
                      Select all that are currently active. If you are unsure of your policy details or numbers, choose <em>Not Sure / Needs Verification</em> and Insurra will help inspect your files later.
                    </p>
                  </div>
                </div>

                {activeStep === 4 && (
                  <div className="chat-interactive-box">
                    <div className="interactive-title">Select Current Insurance Coverage:</div>
                    <div className="chat-options-grid">
                      {(isAU ? COVERAGE_OPTIONS_AU : COVERAGE_OPTIONS_ID).map((cov) => {
                        const isSelected = (profile.owned_coverage || []).includes(cov.id);
                        return (
                          <button
                            key={cov.id}
                            type="button"
                            className={`chat-option-card ${isSelected ? "selected" : ""}`}
                            onClick={() => toggleCoverage(cov.id)}
                          >
                            <span className="chat-option-icon">
                              {cov.id === "OSHC" || cov.id === "BPJS" ? "🛡️" : cov.id === "EMPLOYER" ? "🏢" : cov.id === "TRAVEL" ? "✈️" : cov.id === "NOT_SURE" ? "❓" : "🩺"}
                            </span>
                            <div className="chat-option-text">
                              <h4>{cov.label}</h4>
                              <p>{cov.sub}</p>
                            </div>
                          </button>
                        );
                      })}
                    </div>

                    <div style={{ marginTop: "16px" }}>
                      <button type="button" className="chat-submit-btn" onClick={handleSubmitStep4}>
                        Save Coverage &amp; Continue <ArrowRight size={15} />
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* User Response to Step 4 */}
            {activeStep > 4 && (
              <div className="chat-turn user-turn">
                <div className="user-message-row">
                  <div className="user-bubble">
                    <span>
                      🛡️ {(profile.owned_coverage || []).join(", ")}
                    </span>
                    <div className="user-bubble-actions">
                      <button type="button" className="btn-edit-answer" onClick={() => jumpToStep(4)}>
                        <Edit2 size={11} /> Edit
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* ---------------- TURN 5: PRIORITIES ---------------- */}
            {activeStep >= 5 && (
              <div className="chat-turn assistant-turn">
                <div className="assistant-message-row">
                  <div className="assistant-avatar-wrap">
                    <Image src="/protection-hero-person.png" alt="Insurra AI" width={40} height={40} className="assistant-avatar-img" />
                  </div>
                  <div className="chat-assistant-bubble">
                    <p>
                      Almost done! <strong>What are your top health protection priorities?</strong>
                    </p>
                    <p>Select up to 2 areas that matter most to you:</p>
                  </div>
                </div>

                {activeStep === 5 && (
                  <div className="chat-interactive-box">
                    <div className="interactive-title">Select Up to 2 Priorities:</div>
                    <div className="chat-options-grid">
                      {PRIORITY_OPTIONS.map((prio) => {
                        const isSelected = (profile.priorities || []).includes(prio.id);
                        return (
                          <button
                            key={prio.id}
                            type="button"
                            className={`chat-option-card ${isSelected ? "selected" : ""}`}
                            onClick={() => togglePriority(prio.id)}
                          >
                            <span className="chat-option-icon">
                              {prio.id === "low_cost" ? "💰" : prio.id === "speed" ? "⚡" : prio.id === "choice" ? "🏥" : "❤️"}
                            </span>
                            <div className="chat-option-text">
                              <h4>{prio.label}</h4>
                              <p>{prio.sub}</p>
                            </div>
                          </button>
                        );
                      })}
                    </div>

                    <div style={{ marginTop: "16px" }}>
                      <button type="button" className="chat-submit-btn" onClick={handleSubmitStep5}>
                        Continue to Budget <ArrowRight size={15} />
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* User Response to Step 5 */}
            {activeStep > 5 && (
              <div className="chat-turn user-turn">
                <div className="user-message-row">
                  <div className="user-bubble">
                    <span>
                      🎯 {(profile.priorities || []).map((p) => PRIORITY_OPTIONS.find((opt) => opt.id === p)?.label || p).join(", ")}
                    </span>
                    <div className="user-bubble-actions">
                      <button type="button" className="btn-edit-answer" onClick={() => jumpToStep(5)}>
                        <Edit2 size={11} /> Edit
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* ---------------- TURN 6: BUDGET RANGE ---------------- */}
            {activeStep >= 6 && (
              <div className="chat-turn assistant-turn">
                <div className="assistant-message-row">
                  <div className="assistant-avatar-wrap">
                    <Image src="/protection-hero-person.png" alt="Insurra AI" width={40} height={40} className="assistant-avatar-img" />
                  </div>
                  <div className="chat-assistant-bubble">
                    <p>
                      Last question! <strong>What estimated monthly budget would you consider</strong> to close your health protection gaps?
                    </p>
                  </div>
                </div>

                {activeStep === 6 && (
                  <div className="chat-interactive-box">
                    <div className="interactive-title">Select Monthly Budget Range:</div>
                    <div className="chat-options-grid">
                      {(isAU ? BUDGET_OPTIONS_AU : BUDGET_OPTIONS_ID).map((b) => {
                        const isSelected = profile.budget_range === b.label;
                        return (
                          <button
                            key={b.id}
                            type="button"
                            className={`chat-option-card ${isSelected ? "selected" : ""}`}
                            onClick={() => {
                              setProfile({ ...profile, budget_range: b.label });
                            }}
                          >
                            <span className="chat-option-icon">💵</span>
                            <div className="chat-option-text">
                              <h4>{b.label}</h4>
                              <p>{b.sub}</p>
                            </div>
                          </button>
                        );
                      })}
                    </div>

                    <div style={{ marginTop: "16px" }}>
                      <button
                        type="button"
                        className="chat-submit-btn"
                        onClick={() => void handleSelectBudget(profile.budget_range || (isAU ? "$50 - $150 / month" : "Rp 250,000 - Rp 750,000 / month"))}
                      >
                        Complete Profile &amp; View Suggestions <Sparkles size={15} />
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* User Response to Step 6 */}
            {activeStep >= 7 && (
              <div className="chat-turn user-turn">
                <div className="user-message-row">
                  <div className="user-bubble">
                    <span>💳 {profile.budget_range}</span>
                  </div>
                </div>
              </div>
            )}

            {/* ---------------- TYPING ANIMATION ---------------- */}
            {isTyping && (
              <div className="chat-turn assistant-turn">
                <div className="assistant-message-row">
                  <div className="assistant-avatar-wrap">
                    <Image src="/protection-hero-person.png" alt="Insurra AI" width={40} height={40} className="assistant-avatar-img" />
                  </div>
                  <div className="typing-bubble">
                    <div className="typing-dot" />
                    <div className="typing-dot" />
                    <div className="typing-dot" />
                  </div>
                </div>
              </div>
            )}

            {/* ---------------- TURN 7: COMPLETION & SUGGESTED DOCS ---------------- */}
            {isCompleted && (
              <div className="chat-turn assistant-turn">
                <div className="assistant-message-row">
                  <div className="assistant-avatar-wrap">
                    <Image src="/protection-hero-person.png" alt="Insurra AI" width={40} height={40} className="assistant-avatar-img" />
                  </div>
                  <div className="chat-assistant-bubble" style={{ background: "#ffffff", border: "1.5px solid #a4ddce" }}>
                    <p>
                      🎉 <strong>Your Protection Profile is Ready!</strong>
                    </p>
                    <p>
                      All information has been saved securely to your workspace. Based on your residence in <strong>{profile.city}, {isAU ? "Australia" : "Indonesia"}</strong>, here are the recommended documents to upload so Insurra can extract policy limits, waiting periods, and benefit clauses:
                    </p>

                    {/* Suggested Docs List inside Chat Bubble */}
                    <div className="chat-docs-preview-list" style={{ marginTop: "14px" }}>
                      {suggestedDocsList.map((doc) => (
                        <div key={doc.id} className="chat-doc-preview-item">
                          <div>
                            <span className={`doc-card-badge ${doc.badgeType}`} style={{ marginBottom: "4px" }}>
                              {doc.badge}
                            </span>
                            <h5>{doc.title}</h5>
                            <p>{doc.description}</p>
                          </div>
                          <Link
                            href={`/documents?kind=${doc.kind}`}
                            className="chat-submit-btn"
                            style={{ padding: "8px 14px", fontSize: "12px", whiteSpace: "nowrap" }}
                          >
                            Upload <ArrowRight size={13} />
                          </Link>
                        </div>
                      ))}
                    </div>

                    {/* Action buttons */}
                    <div className="chat-completion-actions">
                      <Link href="/dashboard" className="chat-submit-btn">
                        Continue to Dashboard <ArrowRight size={15} />
                      </Link>
                      <Link href="/documents" className="onboarding-exit-btn">
                        Open Documents Space (/documents)
                      </Link>
                      <button type="button" className="onboarding-exit-btn" onClick={() => jumpToStep(1)}>
                        Retake Questions
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
        </section>

        {/* Right Column: Live Protection Profile Sidebar */}
        <aside className="live-profile-card">
          <div className="live-card-head">
            <div className="live-user-snippet">
              <div className="live-user-avatar">
                {userName.charAt(0).toUpperCase()}
              </div>
              <div className="live-user-text">
                <h3>{userName}</h3>
                <p>{account?.email || "Verified Account"}</p>
              </div>
            </div>
            <span className={`badge ${isCompleted ? "success" : "neutral"}`}>
              {isCompleted ? "Complete" : "Draft"}
            </span>
          </div>

          {/* Completion Progress Gauge */}
          <div className="live-completion-meter">
            <div className="meter-header">
              <span>Context Completeness</span>
              <strong>{isCompleted ? "100%" : `${completionPct}%`}</strong>
            </div>
            <div className="meter-bar-track">
              <div className="meter-bar-fill" style={{ width: `${isCompleted ? 100 : Math.max(16, completionPct)}%` }} />
            </div>
          </div>

          {/* Real-time Profile Facts */}
          <div className="live-facts-list">
            <div className="live-fact-item">
              <span className="live-fact-label">
                <Globe2 size={15} /> Residence Area
              </span>
              <span className="live-fact-val">
                {profile.residence_context === "ABROAD" ? "Living Abroad (AU)" : "Domestic (ID)"}
              </span>
            </div>

            <div className="live-fact-item">
              <span className="live-fact-label">
                <MapPin size={15} /> City &amp; Country
              </span>
              <span className="live-fact-val">
                {profile.city || "-"}{isAU ? " 🇦🇺" : " 🇮🇩"}
              </span>
            </div>

            <div className="live-fact-item">
              <span className="live-fact-label">
                <Briefcase size={15} /> Status / Occupation
              </span>
              <span className="live-fact-val">
                {profile.occupation || "-"}
              </span>
            </div>

            <div className="live-fact-item">
              <span className="live-fact-label">
                <Users size={15} /> Dependents
              </span>
              <span className="live-fact-val">
                {(profile.dependents || []).length ? (profile.dependents || []).join(", ") : "-"}
              </span>
            </div>

            <div className="live-fact-item">
              <span className="live-fact-label">
                <ShieldCheck size={15} /> Current Insurance
              </span>
              <span className="live-fact-val">
                {(profile.owned_coverage || []).length ? (profile.owned_coverage || []).join(", ") : "-"}
              </span>
            </div>

            <div className="live-fact-item">
              <span className="live-fact-label">
                <Heart size={15} /> Top Priorities
              </span>
              <span className="live-fact-val">
                {(profile.priorities || []).length ? (profile.priorities || []).join(", ") : "-"}
              </span>
            </div>

            <div className="live-fact-item">
              <span className="live-fact-label">
                <Wallet size={15} /> Monthly Budget
              </span>
              <span className="live-fact-val">
                {profile.budget_range || "-"}
              </span>
            </div>
          </div>

          {/* Footer note */}
          <div className="live-card-footer">
            <span>Encrypted &amp; private data</span>
            <span className="autosave-pill">
              <Check size={12} /> Real-time
            </span>
          </div>
        </aside>
      </main>
    </div>
  );
}

export default function AccountOnboarding() {
  return (
    <Suspense fallback={<div className="narrow-page"><p>Loading onboarding companion...</p></div>}>
      <AccountOnboardingContent />
    </Suspense>
  );
}
