"use client";

import Image from "next/image";
import Link from "next/link";
import { Suspense, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  Check,
  CheckCircle2,
  ExternalLink,
  Globe2,
  RotateCcw,
  Save,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import { api } from "@/lib/api/client";
import type { components } from "@/lib/api/types.gen";
import { useAuth } from "@/lib/auth";
import "@/app/onboarding/onboarding.css";

type ProfileData = components["schemas"]["ProfileData"];
type AccountProfileState = components["schemas"]["AccountProfileState"];
type CountryCode = "AU" | "ID";

const STEP_TITLES = [
  "Residence Context",
  "Location & Status",
  "Dependents",
  "Existing Coverage",
  "Protection Priorities",
  "Budget",
];

const DEFAULT_PROFILE: ProfileData = {
  display_name: "",
  residence_context: "ABROAD",
  country_code: "AU",
  city: "",
  occupation: "STUDENT",
  timezone: "Australia/Melbourne",
  employment_status: "",
  institution_name: "",
  dependents: ["None"],
  owned_coverage: ["OSHC"],
  priorities: [],
  budget_range: "No additional budget",
  currency: "AUD",
  arrival_date: null,
  visa_expiry_date: null,
};

// Supported and Coming Soon Countries for Step 2
const ABROAD_COUNTRIES = [
  { code: "AU", name: "Australia", supported: true },
  { code: "SG", name: "Singapore", supported: false },
  { code: "GB", name: "United Kingdom", supported: false },
  { code: "JP", name: "Japan", supported: false },
  { code: "DE", name: "Germany", supported: false },
  { code: "US", name: "United States", supported: false },
];

const AUSTRALIA_CITIES = ["Melbourne", "Sydney", "Brisbane", "Perth", "Adelaide", "Canberra"];
const INDONESIA_CITIES = ["Jakarta", "Surabaya", "Bandung", "Medan", "Yogyakarta", "Bali"];

const DEPENDENT_OPTIONS = [
  { id: "None", label: "None", sub: "Only myself" },
  { id: "Spouse", label: "Spouse", sub: "Partner / Husband / Wife" },
  { id: "Children", label: "Children", sub: "Dependents under 18" },
  { id: "Parents", label: "Parents", sub: "Elderly or dependent parents" },
];

const COVERAGE_OPTIONS_AU = [
  { id: "OSHC", label: "OSHC", sub: "Overseas Student Health Cover" },
  { id: "EMPLOYER", label: "Employer Insurance", sub: "Corporate group health plan" },
  { id: "PERSONAL_HEALTH", label: "Personal Health Insurance", sub: "Australian private health fund" },
  { id: "TRAVEL", label: "Travel Insurance", sub: "Active international travel policy" },
  { id: "BPJS", label: "BPJS (from Indonesia)", sub: "Indonesian national health membership" },
  { id: "NOT_SURE", label: "Not Sure Yet", sub: "I do not know my exact policy details yet" },
];

const COVERAGE_OPTIONS_ID = [
  { id: "BPJS", label: "BPJS Kesehatan", sub: "Jaminan Kesehatan Nasional (JKN)" },
  { id: "EMPLOYER", label: "Employer Insurance", sub: "Asuransi rawat inap kantor / korporat" },
  { id: "PERSONAL_HEALTH", label: "Personal Health Insurance", sub: "Asuransi kesehatan swasta individu" },
  { id: "TRAVEL", label: "Travel Insurance", sub: "Asuransi perjalanan luar / dalam negeri" },
  { id: "LIFE", label: "Life Insurance", sub: "Asuransi jiwa dan proteksi keluarga" },
  { id: "NOT_SURE", label: "Not Sure Yet", sub: "Belum yakin / ingin diperiksa lebih lanjut" },
];

const PRIORITY_OPTIONS = [
  {
    id: "low_cost",
    label: "Lower Costs",
    sub: "Minimizing out-of-pocket expenses and excess fees",
  },
  {
    id: "speed",
    label: "Speed & Convenience",
    sub: "Fast clinic booking, rapid claims, and easy direct-billing",
  },
  {
    id: "choice",
    label: "Doctor & Hospital Choice",
    sub: "Freedom to consult preferred specialists and private hospitals",
  },
  {
    id: "family",
    label: "Family Security",
    sub: "Comprehensive health safety for partner, children, or parents",
  },
];

const BUDGET_OPTIONS_AU = [
  { id: "none", label: "No additional budget", sub: "Relying strictly on existing coverage" },
  { id: "low", label: "< $50 / month", sub: "Entry gap protection" },
  { id: "mid", label: "$50 - $150 / month", sub: "Balanced everyday health & dental" },
  { id: "high", label: "$150 - $300 / month", sub: "Comprehensive private inpatient cover" },
  { id: "top", label: "> $300 / month", sub: "Premium health security" },
];

const BUDGET_OPTIONS_ID = [
  { id: "none", label: "No additional budget", sub: "Hanya mengandalkan asuransi yang ada" },
  { id: "low", label: "< Rp 250.000 / month", sub: "Proteksi dasar pelengkap" },
  { id: "mid", label: "Rp 250.000 - Rp 750.000 / month", sub: "Perlindungan rawat jalan & gigi" },
  { id: "high", label: "Rp 750.000 - Rp 1.500.000 / month", sub: "Asuransi kesehatan swasta standar" },
  { id: "top", label: "> Rp 1.500.000 / month", sub: "Proteksi kamar VIP & limit tinggi" },
];

// Document item contract for Suggested Docs screen (US-02-03)
interface SuggestedDocItem {
  id: string;
  kind: string;
  title: string;
  badge: "Visa requirement" | "Mandatory" | "Recommended";
  badgeType: "visa-req" | "mandatory" | "recommended";
  description: string;
  sourceUrl?: string;
  sourceLabel?: string;
}

function AccountOnboardingContent() {
  const { account, token, loading: authLoading } = useAuth();
  const router = useRouter();
  const searchParams = useSearchParams();
  const modeParam = searchParams.get("mode");

  const [step, setStep] = useState<number>(1);
  const [profile, setProfile] = useState<ProfileData>(DEFAULT_PROFILE);
  const [savedProfile, setSavedProfile] = useState<ProfileData>(DEFAULT_PROFILE);
  const [initialLoaded, setInitialLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [draftSaved, setDraftSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Suggested docs state (US-02-03)
  const [showSuggestedDocs, setShowSuggestedDocs] = useState(false);
  const [selectedDocKind, setSelectedDocKind] = useState<string>("");

  // Country Change Confirmation Modal State (US-02-02)
  const [pendingCountrySwitch, setPendingCountrySwitch] = useState<CountryCode | null>(null);

  // Edit Mode state (US-02-02)
  const isEditMode = modeParam === "edit";

  // Load existing profile / draft
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
        const merged: ProfileData = {
          ...DEFAULT_PROFILE,
          ...source,
          display_name: source.display_name || account?.display_name || "",
          residence_context: source.residence_context || (source.country_code === "ID" ? "DOMESTIC" : "ABROAD"),
          country_code: (source.country_code as CountryCode) || "AU",
          currency: (source.currency as "AUD" | "IDR") || (source.country_code === "ID" ? "IDR" : "AUD"),
        };
        setProfile(merged);
        setSavedProfile(merged);
        if (state.completed && !modeParam) {
          // If already completed and no explicit mode, show suggested docs or allow editing
          setShowSuggestedDocs(true);
        }
        setInitialLoaded(true);
      })
      .catch(() => {
        if (active) setInitialLoaded(true);
      });

    return () => {
      active = false;
    };
  }, [token, account?.display_name, modeParam]);

  // Check if profile has uncommitted changes in edit mode
  const isDirty = useMemo(() => {
    return JSON.stringify(profile) !== JSON.stringify(savedProfile);
  }, [profile, savedProfile]);

  // Derived suggested documents list based on profile (US-02-03, FR-02-17..22)
  const suggestedDocsList = useMemo<SuggestedDocItem[]>(() => {
    const list: SuggestedDocItem[] = [];
    const isAU = profile.country_code === "AU";
    const isStudent = profile.occupation === "STUDENT";
    const owned = profile.owned_coverage || [];
    const notSure = owned.includes("NOT_SURE");

    if (isAU) {
      if (isStudent || owned.includes("OSHC")) {
        list.push({
          id: "oshc_certificate",
          kind: "oshc_certificate",
          title: "OSHC Certificate",
          badge: "Visa requirement",
          badgeType: "visa-req",
          description: "From your university or insurance provider (e.g. Allianz, Medibank, Bupa)",
          sourceUrl: "https://immi.homeaffairs.gov.au/visas/getting-a-visa/visa-listing/student-500#Eligibility",
          sourceLabel: "View Australian Home Affairs visa requirement",
        });
      }

      list.push({
        id: "visa_grant_notice",
        kind: "visa_grant_notice",
        title: "Visa Grant Notice",
        badge: "Recommended",
        badgeType: "recommended",
        description: "From your Australian Department of Home Affairs grant notification email",
        sourceUrl: "https://immi.homeaffairs.gov.au",
        sourceLabel: "View Department of Home Affairs portal",
      });

      if (owned.includes("OSHC") || isStudent) {
        list.push({
          id: "policy_booklet",
          kind: "policy_booklet",
          title: "OSHC Policy Booklet",
          badge: "Recommended",
          badgeType: "recommended",
          description: "From your insurer portal detailing schedule of benefits and hospital exclusions",
        });
      }

      if (owned.includes("EMPLOYER")) {
        list.push({
          id: "employer_policy",
          kind: "employer_policy",
          title: "Employer Policy Certificate",
          badge: "Recommended",
          badgeType: "recommended",
          description: "From your Australian employer HR portal or corporate benefit guide",
        });
      }

      if (owned.includes("PERSONAL_HEALTH")) {
        list.push({
          id: "insurance_card",
          kind: "insurance_card",
          title: "Private Health Fund Statement",
          badge: "Recommended",
          badgeType: "recommended",
          description: "From your registered Australian health fund (e.g. Medibank, NIB, Bupa)",
        });
      }

      if (notSure && list.length < 3) {
        list.push({
          id: "other",
          kind: "other",
          title: "University Confirmation / Any Health Card",
          badge: "Recommended",
          badgeType: "recommended",
          description: "Upload any enrollment letter or existing card to let Insurra check your coverage",
        });
      }
    } else {
      // Indonesia
      list.push({
        id: "bpjs_card",
        kind: "bpjs_card",
        title: "Kartu BPJS Kesehatan",
        badge: "Mandatory",
        badgeType: "mandatory",
        description: "Dari aplikasi Mobile JKN (tangkapan layar kartu digital) atau scan kartu fisik",
        sourceUrl: "https://bpjs-kesehatan.go.id",
        sourceLabel: "Lihat portal resmi BPJS Kesehatan",
      });

      if (owned.includes("EMPLOYER")) {
        list.push({
          id: "employer_policy",
          kind: "employer_policy",
          title: "Polis Asuransi Kantor / Korporat",
          badge: "Recommended",
          badgeType: "recommended",
          description: "Dari portal HR perusahaan atau buku panduan manfaat karyawan",
        });
      }

      if (owned.includes("PERSONAL_HEALTH") || owned.includes("LIFE")) {
        list.push({
          id: "policy_booklet",
          kind: "policy_booklet",
          title: "Buku Polis Asuransi Pribadi",
          badge: "Recommended",
          badgeType: "recommended",
          description: "Dari portal aplikasi asuransi atau surat konfirmasi polis yang masih aktif",
        });
      }

      if (notSure && list.length < 3) {
        list.push({
          id: "insurance_card",
          kind: "insurance_card",
          title: "Kartu Asuransi / Bukti Kepesertaan",
          badge: "Recommended",
          badgeType: "recommended",
          description: "Foto atau dokumen asuransi apa pun yang Anda miliki saat ini",
        });
      }
    }

    return list.slice(0, 6);
  }, [profile]);

  // Derived selected document kind
  const activeDocKind = selectedDocKind || suggestedDocsList[0]?.kind || "";

  // Autosave draft helper (FR-02-15)
  async function persistDraft(updatedData: ProfileData) {
    if (!token) return;
    try {
      await api.request("put", "/api/v1/account/profile/draft", {
        headers: { Authorization: `Bearer ${token}` },
        body: updatedData,
      });
      setDraftSaved(true);
      setTimeout(() => setDraftSaved(false), 2500);
    } catch {
      // Silently ignore draft errors
    }
  }

  // Final submission of profile to complete onboarding (FR-02-16)
  async function completeOnboarding(profileToSave = profile) {
    setError(null);
    setBusy(true);

    // Date validations
    if (profileToSave.country_code === "AU" && profileToSave.residence_context === "ABROAD") {
      if (!profileToSave.visa_expiry_date) {
        setError("Visa expiry date is required for residence abroad.");
        setBusy(false);
        return false;
      }
      if (profileToSave.arrival_date && profileToSave.visa_expiry_date <= profileToSave.arrival_date) {
        setError("Visa expiry date must be strictly after your arrival date.");
        setBusy(false);
        return false;
      }
    }

    if (!profileToSave.city?.trim()) {
      setError("Please specify your city of residence.");
      setBusy(false);
      return false;
    }

    try {
      if (token) {
        await api.request("put", "/api/v1/account/profile", {
          headers: { Authorization: `Bearer ${token}` },
          body: profileToSave,
        });
      }
      setSavedProfile(profileToSave);
      setShowSuggestedDocs(true);
      return true;
    } catch (cause: unknown) {
      setError(cause instanceof Error ? cause.message : "Failed to save profile. Please try again.");
      return false;
    } finally {
      setBusy(false);
    }
  }

  // Handle step navigation & draft saving
  async function handleNextStep() {
    setError(null);

    // Step 1 Validation
    if (step === 1) {
      if (!profile.residence_context) {
        setError("Please choose your residence context.");
        return;
      }
    }

    // Step 2 Validation (Location & Status)
    if (step === 2) {
      if (!profile.city?.trim()) {
        setError("Please enter your city.");
        return;
      }
      if (profile.residence_context === "ABROAD") {
        if (!profile.arrival_date) {
          setError("Arrival date is required for residence abroad.");
          return;
        }
        if (!profile.visa_expiry_date) {
          setError("Visa expiry date is required for residence abroad.");
          return;
        }
        if (profile.visa_expiry_date <= profile.arrival_date) {
          setError("Visa expiry date must be after your arrival date.");
          return;
        }
      }
    }

    // Step 3 Validation (Dependents)
    if (step === 3) {
      if (!profile.dependents || profile.dependents.length === 0) {
        setError("Please select who is covered under your protection.");
        return;
      }
    }

    // Step 4 Validation (Coverage)
    if (step === 4) {
      if (!profile.owned_coverage || profile.owned_coverage.length === 0) {
        setError("Please choose your current coverage, or select 'Not Sure Yet'.");
        return;
      }
    }

    // Step 5 (Priorities) - optional, up to 2
    // Step 6 (Budget) - optional

    // If step < 6, save draft and proceed
    if (step < 6) {
      void persistDraft(profile);
      setStep((prev) => prev + 1);
    } else {
      // Step 6: Complete onboarding!
      await completeOnboarding(profile);
    }
  }

  function handlePrevStep() {
    setError(null);
    if (step > 1) {
      setStep((prev) => prev - 1);
    }
  }

  // Country Switch Confirmation Handlers (US-02-02)
  function handleRequestCountrySwitch(targetCode: CountryCode) {
    if (profile.country_code === targetCode) return;
    setPendingCountrySwitch(targetCode);
  }

  function confirmCountrySwitch() {
    if (!pendingCountrySwitch) return;
    const isAU = pendingCountrySwitch === "AU";
    const updated: ProfileData = {
      ...profile,
      country_code: pendingCountrySwitch,
      residence_context: isAU ? "ABROAD" : "DOMESTIC",
      currency: isAU ? "AUD" : "IDR",
      timezone: isAU ? "Australia/Melbourne" : "Asia/Jakarta",
      // Reset omitted country-bound fields per PRD context switch rules
      city: "",
      arrival_date: null,
      visa_expiry_date: null,
      institution_name: "",
      employment_status: "",
      budget_range: "No additional budget",
      owned_coverage: isAU ? ["OSHC"] : ["BPJS"],
    };
    setProfile(updated);
    setPendingCountrySwitch(null);
    void persistDraft(updated);
  }

  // Dependent selection toggle (FR-02-09, None is exclusive)
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

  // Coverage selection toggle (FR-02-11, Not Sure Yet is exclusive)
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

  // Priority selection toggle (FR-02-12, max 2)
  function togglePriority(id: string) {
    let current = [...(profile.priorities || [])];
    if (current.includes(id)) {
      current = current.filter((item) => item !== id);
    } else {
      if (current.length >= 2) {
        current = [current[1], id]; // keep latest 2
      } else {
        current.push(id);
      }
    }
    setProfile({ ...profile, priorities: current });
  }

  if (authLoading || (token && !initialLoaded)) {
    return (
      <main className="onboarding-container" style={{ display: "grid", placeItems: "center" }}>
        <p style={{ color: "#5b7182", fontWeight: 700 }}>Preparing your context…</p>
      </main>
    );
  }

  // =========================================================================
  // VIEW: SUGGESTED DOCUMENTS (US-02-03)
  // =========================================================================
  if (showSuggestedDocs) {
    return (
      <main className="onboarding-container">
        <header className="onboarding-topbar">
          <Link href="/" className="onboarding-brand" aria-label="Insurra Home">
            <Image
              src="/mascot-logo.png"
              alt="Insurra"
              width={130}
              height={52}
              className="onboarding-brand-logo"
              priority
            />
          </Link>
          <div className="onboarding-stepper">
            <span className="stepper-pill completed">
              <Check size={14} /> Profile Saved
            </span>
            <span className="stepper-pill active">
              <span className="stepper-num">★</span> Suggested Documents
            </span>
          </div>
          <Link href="/dashboard" className="onboarding-exit-btn">
            Skip to Dashboard
          </Link>
        </header>

        <section className="suggested-docs-page">
          <div className="suggested-docs-head">
            <div className="hero-badge" style={{ marginBottom: 12 }}>
              <Sparkles size={14} /> Tailored to your profile
            </div>
            <h1>Let&apos;s get your documents ready.</h1>
            <p>
              Based on your {profile.country_code === "AU" ? "Australia" : "Indonesia"} profile (
              {profile.occupation === "STUDENT" ? "Student" : "Professional"}), here are the documents
              that may help INSURRA understand your protection.
            </p>
          </div>

          <div className="suggested-docs-grid" role="list" aria-label="Suggested documents">
            {suggestedDocsList.map((doc) => {
              const isSelected = activeDocKind === doc.kind;
              return (
                <div
                  key={doc.id}
                  className={`doc-suggestion-card ${isSelected ? "selected-card" : ""}`}
                  style={{
                    border: isSelected ? "2px solid #0ea58a" : "1.5px solid #e1ebed",
                    backgroundColor: isSelected ? "#f6fcfa" : "#ffffff",
                  }}
                  onClick={() => setSelectedDocKind(doc.kind)}
                  role="listitem"
                >
                  <div className="doc-card-top">
                    <span className={`doc-card-badge ${doc.badgeType}`}>
                      {doc.badge === "Visa requirement" && <ShieldCheck size={12} />}
                      {doc.badge}
                    </span>
                  </div>

                  <div className="doc-card-main">
                    <h3>{doc.title}</h3>
                    <p>{doc.description}</p>
                    {doc.sourceUrl && (
                      <a
                        href={doc.sourceUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="doc-card-source"
                        onClick={(e) => e.stopPropagation()}
                      >
                        {doc.sourceLabel || "View official source"} <ExternalLink size={12} />
                      </a>
                    )}
                  </div>

                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", paddingTop: 10, borderTop: "1px solid #eef3f5" }}>
                    <span style={{ fontSize: 12, fontWeight: 700, color: isSelected ? "#0ea58a" : "#728494" }}>
                      {isSelected ? "Selected for upload" : "Click to select"}
                    </span>
                    <div className="check-circle" style={{ borderColor: isSelected ? "#0ea58a" : "#c8d8dd", backgroundColor: isSelected ? "#0ea58a" : "transparent" }}>
                      <Check size={14} color="#fff" />
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          <div className="suggested-docs-actions">
            <button
              type="button"
              className="wizard-btn primary"
              onClick={() => {
                const target = activeDocKind ? `/documents?kind=${encodeURIComponent(activeDocKind)}` : "/documents";
                router.push(target);
              }}
            >
              Start Uploading <ArrowRight size={16} />
            </button>
            <button
              type="button"
              className="wizard-btn secondary"
              onClick={() => router.push("/dashboard")}
            >
              Maybe Later
            </button>
          </div>
        </section>
      </main>
    );
  }

  // =========================================================================
  // VIEW: MY PROFILE & EDIT MODE (US-02-02, route /onboarding?mode=edit)
  // =========================================================================
  if (isEditMode) {
    const isAU = profile.country_code === "AU";
    return (
      <main className="onboarding-container">
        <header className="onboarding-topbar">
          <Link href="/" className="onboarding-brand" aria-label="Insurra Home">
            <Image
              src="/mascot-logo.png"
              alt="Insurra"
              width={130}
              height={52}
              className="onboarding-brand-logo"
              priority
            />
          </Link>
          <div className="my-profile-chip">
            <Globe2 size={15} /> {isAU ? "Australia" : "Indonesia"} ·{" "}
            {profile.occupation === "STUDENT" ? "Student" : "Professional"}
          </div>
          <Link href="/account" className="onboarding-exit-btn">
            Back to Workspace
          </Link>
        </header>

        <section className="my-profile-page">
          <div className="my-profile-head">
            <div>
              <h1>My Profile</h1>
              <p style={{ color: "#556c80", margin: 0, fontSize: 14 }}>
                Review and update your residence context, status, and insurance priorities.
              </p>
            </div>
            <button
              type="button"
              className="wizard-btn secondary"
              onClick={() => {
                setShowSuggestedDocs(false);
                setStep(1);
                router.push("/onboarding");
              }}
            >
              <RotateCcw size={15} /> Walk Through 6 Steps
            </button>
          </div>

          {error && <div className="wizard-error-banner" role="alert"><AlertTriangle size={18} /> {error}</div>}

          <div className="profile-card-list">
            {/* 1. Residence Context */}
            <div className="profile-summary-card">
              <div className="profile-card-left">
                <span className="profile-card-label">Residence Context</span>
                <span className="profile-card-val">
                  {isAU ? "Australia" : "Indonesia"} {profile.city ? `· ${profile.city}` : ""}
                </span>
                <small style={{ color: "#6e8494", fontSize: 12 }}>
                  {isAU ? "International context (AUD)" : "Domestic context (IDR)"}
                </small>
              </div>
              <button
                type="button"
                className="profile-card-edit-btn"
                onClick={() => handleRequestCountrySwitch(isAU ? "ID" : "AU")}
              >
                Switch Country
              </button>
            </div>

            {/* 2. Status & Workplace */}
            <div className="profile-summary-card">
              <div className="profile-card-left">
                <span className="profile-card-label">Status &amp; Occupation</span>
                <span className="profile-card-val">
                  {profile.occupation === "STUDENT" ? "Student" : profile.occupation === "EMPLOYEE" ? "Employee" : "Other"}
                  {profile.institution_name ? ` · ${profile.institution_name}` : profile.employment_status ? ` · ${profile.employment_status}` : ""}
                </span>
                {isAU && profile.visa_expiry_date && (
                  <small style={{ color: "#6e8494", fontSize: 12 }}>
                    Visa expires: {profile.visa_expiry_date}
                  </small>
                )}
              </div>
              <button
                type="button"
                className="profile-card-edit-btn"
                onClick={() => {
                  setStep(2);
                  router.push("/onboarding");
                }}
              >
                Edit
              </button>
            </div>

            {/* 3. Dependents */}
            <div className="profile-summary-card">
              <div className="profile-card-left">
                <span className="profile-card-label">Dependents</span>
                <span className="profile-card-val">
                  {(profile.dependents ?? []).length > 0 ? (profile.dependents ?? []).join(", ") : "None"}
                </span>
              </div>
              <button
                type="button"
                className="profile-card-edit-btn"
                onClick={() => {
                  setStep(3);
                  router.push("/onboarding");
                }}
              >
                Edit
              </button>
            </div>

            {/* 4. Existing Coverage */}
            <div className="profile-summary-card">
              <div className="profile-card-left">
                <span className="profile-card-label">Existing Insurance</span>
                <span className="profile-card-val">
                  {(profile.owned_coverage ?? []).length > 0
                    ? (profile.owned_coverage ?? []).map((c) => (c === "NOT_SURE" ? "Not Sure Yet" : c)).join(", ")
                    : "Not specified"}
                </span>
              </div>
              <button
                type="button"
                className="profile-card-edit-btn"
                onClick={() => {
                  setStep(4);
                  router.push("/onboarding");
                }}
              >
                Edit
              </button>
            </div>

            {/* 5. Priorities */}
            <div className="profile-summary-card">
              <div className="profile-card-left">
                <span className="profile-card-label">Protection Priorities</span>
                <span className="profile-card-val">
                  {(profile.priorities ?? []).length > 0
                    ? (profile.priorities ?? [])
                        .map((p) => PRIORITY_OPTIONS.find((opt) => opt.id === p)?.label || p)
                        .join(", ")
                    : "None selected"}
                </span>
              </div>
              <button
                type="button"
                className="profile-card-edit-btn"
                onClick={() => {
                  setStep(5);
                  router.push("/onboarding");
                }}
              >
                Edit
              </button>
            </div>

            {/* 6. Budget */}
            <div className="profile-summary-card">
              <div className="profile-card-left">
                <span className="profile-card-label">Monthly Additional Budget</span>
                <span className="profile-card-val">
                  {profile.budget_range || "No additional budget"}
                </span>
              </div>
              <button
                type="button"
                className="profile-card-edit-btn"
                onClick={() => {
                  setStep(6);
                  router.push("/onboarding");
                }}
              >
                Edit
              </button>
            </div>
          </div>

          <div className="my-profile-footer">
            <span className="updated-timestamp">
              Last updated: {new Date().toLocaleDateString("en-US", { day: "numeric", month: "short", year: "numeric" })}
            </span>
            <div style={{ display: "flex", gap: 12 }}>
              <button
                type="button"
                className="wizard-btn secondary"
                onClick={() => router.push("/account")}
              >
                Cancel
              </button>
              <button
                type="button"
                className="wizard-btn primary"
                disabled={!isDirty || busy}
                onClick={async () => {
                  const success = await completeOnboarding(profile);
                  if (success) {
                    router.push("/account");
                  }
                }}
              >
                <Save size={16} /> {busy ? "Saving…" : "Save Changes"}
              </button>
            </div>
          </div>
        </section>

        {/* Confirmation Modal for Country Context Switch */}
        {pendingCountrySwitch && (
          <div className="modal-backdrop" role="dialog" aria-modal="true">
            <div className="modal-dialog">
              <div className="modal-icon-badge">
                <AlertTriangle size={24} />
              </div>
              <h2>Change your residence context?</h2>
              <p>
                Insurance rules, suggested documents, care pathways, and emergency contacts will
                update to match your new country ({pendingCountrySwitch === "AU" ? "Australia" : "Indonesia"}).
                Your existing documents will remain saved.
              </p>
              <div className="modal-actions">
                <button
                  type="button"
                  className="wizard-btn secondary"
                  onClick={() => setPendingCountrySwitch(null)}
                >
                  Keep Current Country
                </button>
                <button
                  type="button"
                  className="wizard-btn primary"
                  onClick={confirmCountrySwitch}
                >
                  Confirm Change
                </button>
              </div>
            </div>
          </div>
        )}
      </main>
    );
  }

  // =========================================================================
  // VIEW: 6-STEP ONBOARDING WIZARD (SC-02)
  // =========================================================================
  const isAU = profile.country_code === "AU";
  const coverageOptions = isAU ? COVERAGE_OPTIONS_AU : COVERAGE_OPTIONS_ID;
  const budgetOptions = isAU ? BUDGET_OPTIONS_AU : BUDGET_OPTIONS_ID;

  return (
    <main className="onboarding-container">
      {/* Topbar Navigation */}
      <header className="onboarding-topbar">
        <Link href="/" className="onboarding-brand" aria-label="Insurra Home">
          <Image
            src="/mascot-logo.png"
            alt="Insurra"
            width={130}
            height={52}
            className="onboarding-brand-logo"
            priority
          />
        </Link>

        {/* Stepper (Step X of 6) */}
        <nav className="onboarding-stepper" aria-label={`Step ${step} of 6`}>
          {STEP_TITLES.map((title, idx) => {
            const stepNum = idx + 1;
            const isCompleted = step > stepNum;
            const isActive = step === stepNum;
            return (
              <div
                key={title}
                className={`stepper-pill ${isActive ? "active" : ""} ${isCompleted ? "completed" : ""}`}
                title={title}
              >
                <span className="stepper-num">{isCompleted ? "✓" : stepNum}</span>
                <span className="stepper-label">{title}</span>
              </div>
            );
          })}
        </nav>

        <Link href="/account" className="onboarding-exit-btn">
          Save &amp; Exit
        </Link>
      </header>

      {/* Main 2-Column Stage */}
      <section className="onboarding-main">
        {/* Left Side: Hero Travel Art */}
        <aside className="onboarding-hero-art" aria-label="Insurra Travel Companion">
          <Image
            src="/onboarding-traveler.png"
            alt="Traveler with backpack ready for their journey"
            fill
            sizes="(max-width: 980px) 0px, 35vw"
            className="hero-art-image"
            priority
          />
          <div className="hero-art-gradient" />

          <div className="hero-art-header">
            <span className="hero-badge">
              <Sparkles size={14} /> AI Insurance Companion
            </span>
          </div>

          <div className="hero-art-footer">
            <div className="hero-art-quote">
              <Image
                src="/mascot-bubble.png"
                alt="Insurra Mascot"
                width={48}
                height={48}
                className="quote-mascot"
              />
              <p>
                &ldquo;Take your time. We adapt insurance rules, documents, and hospital guidelines
                directly to your context.&rdquo;
              </p>
            </div>
            <div className="hero-art-trust">
              <ShieldCheck size={18} />
              <span>
                <b>Private by design.</b> Never asked for NIK, passport, or medical histories.
              </span>
            </div>
          </div>
        </aside>

        {/* Right Side: Interactive Step Wizard Panel */}
        <section className="onboarding-wizard-panel" aria-label="Onboarding form">
          <div>
            <div className="step-indicator-row">
              <span className="step-tag">Step {step} of 6</span>
              {draftSaved && (
                <span className="draft-status">
                  <CheckCircle2 size={13} color="#0ea58a" /> Draft saved
                </span>
              )}
            </div>

            {error && (
              <div className="wizard-error-banner" role="alert">
                <AlertTriangle size={18} /> {error}
              </div>
            )}

            {/* STEP 1: Residence Context */}
            {step === 1 && (
              <div className="step-content">
                <div className="wizard-header">
                  <h1>Where do you currently live?</h1>
                  <p>Choose the context that best describes your situation.</p>
                </div>

                <div className="step-body">
                  <div className="option-grid two-cols">
                    <button
                      type="button"
                      className={`context-card ${profile.residence_context === "DOMESTIC" ? "selected" : ""}`}
                      onClick={() => {
                        setProfile({
                          ...profile,
                          residence_context: "DOMESTIC",
                          country_code: "ID",
                          currency: "IDR",
                          timezone: "Asia/Jakarta",
                          owned_coverage: ["BPJS"],
                        });
                      }}
                    >
                      <span className="context-card-badge">Domestic</span>
                      <h2 className="context-card-title">
                        Indonesia
                        {profile.residence_context === "DOMESTIC" && <Check size={20} color="#0ea58a" />}
                      </h2>
                      <p className="context-card-desc">
                        Living in Indonesia, covered by BPJS Kesehatan, office insurance, or local health plans.
                      </p>
                    </button>

                    <button
                      type="button"
                      className={`context-card ${profile.residence_context === "ABROAD" ? "selected" : ""}`}
                      onClick={() => {
                        setProfile({
                          ...profile,
                          residence_context: "ABROAD",
                          country_code: "AU",
                          currency: "AUD",
                          timezone: "Australia/Melbourne",
                          owned_coverage: ["OSHC"],
                        });
                      }}
                    >
                      <span className="context-card-badge">International</span>
                      <h2 className="context-card-title">
                        Living Abroad
                        {profile.residence_context === "ABROAD" && <Check size={20} color="#0ea58a" />}
                      </h2>
                      <p className="context-card-desc">
                        Studying or working outside Indonesia (Australia supported for MVP, more coming soon).
                      </p>
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* STEP 2: Location & Status */}
            {step === 2 && (
              <div className="step-content">
                <div className="wizard-header">
                  <h1>Location &amp; Status</h1>
                  <p>
                    {isAU
                      ? "Specify your Australian destination, study or work status, and visa dates."
                      : "Specify your city in Indonesia and your occupation."}
                  </p>
                </div>

                <div className="step-body">
                  <div className="form-stack">
                    {/* Destination Country Selection for Abroad */}
                    {profile.residence_context === "ABROAD" && (
                      <div className="form-group">
                        <label className="form-label">
                          Destination Country <span className="req">*</span>
                        </label>
                        <div className="country-pill-grid">
                          {ABROAD_COUNTRIES.map((c) => (
                            <button
                              type="button"
                              key={c.code}
                              className={`country-pill ${profile.country_code === c.code ? "selected" : ""} ${!c.supported ? "coming-soon" : ""}`}
                              disabled={!c.supported}
                              onClick={() => {
                                if (c.supported) {
                                  setProfile({ ...profile, country_code: c.code as CountryCode });
                                }
                              }}
                            >
                              <span>{c.name}</span>
                              {!c.supported ? (
                                <span className="coming-soon-badge">Soon</span>
                              ) : profile.country_code === c.code ? (
                                <Check size={14} color="#0ea58a" />
                              ) : null}
                            </button>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* City input with suggestion chips */}
                    <div className="form-group">
                      <label htmlFor="city-input" className="form-label">
                        City <span className="req">*</span>
                      </label>
                      <input
                        id="city-input"
                        type="text"
                        className="form-input"
                        placeholder={isAU ? "e.g. Melbourne, Sydney" : "e.g. Jakarta, Surabaya"}
                        value={profile.city || ""}
                        onChange={(e) => setProfile({ ...profile, city: e.target.value })}
                      />
                      <div className="chip-row">
                        {(isAU ? AUSTRALIA_CITIES : INDONESIA_CITIES).map((c) => (
                          <button
                            type="button"
                            key={c}
                            className={`city-chip ${profile.city === c ? "active" : ""}`}
                            onClick={() => setProfile({ ...profile, city: c })}
                          >
                            {c}
                          </button>
                        ))}
                      </div>
                    </div>

                    {/* Occupation / Status */}
                    <div className="form-group">
                      <label className="form-label">
                        Current Status / Occupation <span className="req">*</span>
                      </label>
                      <div className="option-grid three-cols">
                        {(
                          [
                            ["STUDENT", "Student", "Enrolled in school or university"],
                            ["EMPLOYEE", isAU ? "Employee" : "Pekerja / Karyawan", "Working professional"],
                            ["OTHER", "Other", "Self-employed or other"],
                          ] as const
                        ).map(([val, label, sub]) => (
                          <button
                            type="button"
                            key={val}
                            className={`selectable-card ${profile.occupation === val ? "selected" : ""}`}
                            onClick={() => setProfile({ ...profile, occupation: val })}
                          >
                            <div className="selectable-card-content">
                              <span className="selectable-card-title">{label}</span>
                              <span className="selectable-card-sub">{sub}</span>
                            </div>
                            <div className="check-circle">
                              {profile.occupation === val && <Check size={14} />}
                            </div>
                          </button>
                        ))}
                      </div>
                    </div>

                    {/* Institution or Employer Name (Optional) */}
                    <div className="form-group">
                      <label htmlFor="inst-input" className="form-label">
                        {profile.occupation === "STUDENT"
                          ? "School or University Name"
                          : "Company or Employer Name"}
                        <span className="opt">(Optional)</span>
                      </label>
                      <input
                        id="inst-input"
                        type="text"
                        className="form-input"
                        placeholder={
                          profile.occupation === "STUDENT"
                            ? isAU
                              ? "e.g. University of Melbourne"
                              : "e.g. Universitas Indonesia"
                            : "e.g. Acme Corp"
                        }
                        value={
                          profile.occupation === "STUDENT"
                            ? profile.institution_name || ""
                            : profile.employment_status || ""
                        }
                        onChange={(e) => {
                          if (profile.occupation === "STUDENT") {
                            setProfile({ ...profile, institution_name: e.target.value });
                          } else {
                            setProfile({ ...profile, employment_status: e.target.value });
                          }
                        }}
                      />
                    </div>

                    {/* Visa dates for Abroad context */}
                    {profile.residence_context === "ABROAD" && (
                      <div className="date-row">
                        <div className="form-group">
                          <label htmlFor="arrival-input" className="form-label">
                            Arrival Date <span className="req">*</span>
                          </label>
                          <input
                            id="arrival-input"
                            type="date"
                            className="form-input"
                            value={profile.arrival_date || ""}
                            onChange={(e) => setProfile({ ...profile, arrival_date: e.target.value || null })}
                          />
                        </div>
                        <div className="form-group">
                          <label htmlFor="visa-input" className="form-label">
                            Visa Expiry Date <span className="req">*</span>
                          </label>
                          <input
                            id="visa-input"
                            type="date"
                            className="form-input"
                            value={profile.visa_expiry_date || ""}
                            onChange={(e) => setProfile({ ...profile, visa_expiry_date: e.target.value || null })}
                          />
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )}

            {/* STEP 3: Dependents */}
            {step === 3 && (
              <div className="step-content">
                <div className="wizard-header">
                  <h1>Who is covered under your protection?</h1>
                  <p>
                    Select any family members or dependents who will rely on this coverage with you.
                    (Select &quot;None&quot; if this policy covers only yourself).
                  </p>
                </div>

                <div className="step-body">
                  <div className="option-grid two-cols">
                    {DEPENDENT_OPTIONS.map((opt) => {
                      const isSelected = (profile.dependents || []).includes(opt.id);
                      return (
                        <button
                          type="button"
                          key={opt.id}
                          className={`selectable-card ${isSelected ? "selected" : ""}`}
                          onClick={() => toggleDependent(opt.id)}
                        >
                          <div className="selectable-card-content">
                            <span className="selectable-card-title">{opt.label}</span>
                            <span className="selectable-card-sub">{opt.sub}</span>
                          </div>
                          <div className="check-circle">{isSelected && <Check size={14} />}</div>
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>
            )}

            {/* STEP 4: Existing Coverage */}
            {step === 4 && (
              <div className="step-content">
                <div className="wizard-header">
                  <h1>What coverage do you already have?</h1>
                  <p>
                    Select all insurance policies or public healthcare plans you currently hold for{" "}
                    {isAU ? "Australia" : "Indonesia"}.
                  </p>
                </div>

                <div className="step-body">
                  <div className="option-grid two-cols">
                    {coverageOptions.map((opt) => {
                      const isSelected = (profile.owned_coverage || []).includes(opt.id);
                      return (
                        <button
                          type="button"
                          key={opt.id}
                          className={`selectable-card ${isSelected ? "selected" : ""}`}
                          onClick={() => toggleCoverage(opt.id)}
                        >
                          <div className="selectable-card-content">
                            <span className="selectable-card-title">{opt.label}</span>
                            <span className="selectable-card-sub">{opt.sub}</span>
                          </div>
                          <div className="check-circle">{isSelected && <Check size={14} />}</div>
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>
            )}

            {/* STEP 5: Protection Priorities */}
            {step === 5 && (
              <div className="step-content">
                <div className="wizard-header">
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                    <h1>What matters most to you right now?</h1>
                    <span className="priorities-counter">
                      {(profile.priorities || []).length} of 2 selected
                    </span>
                  </div>
                  <p>
                    Choose up to 2 priorities to help INSURRA highlight the most relevant policy clauses.
                    You can skip this step.
                  </p>
                </div>

                <div className="step-body">
                  <div className="option-grid two-cols">
                    {PRIORITY_OPTIONS.map((opt) => {
                      const isSelected = (profile.priorities || []).includes(opt.id);
                      return (
                        <button
                          type="button"
                          key={opt.id}
                          className={`selectable-card ${isSelected ? "selected" : ""}`}
                          onClick={() => togglePriority(opt.id)}
                        >
                          <div className="selectable-card-content">
                            <span className="selectable-card-title">{opt.label}</span>
                            <span className="selectable-card-sub">{opt.sub}</span>
                          </div>
                          <div className="check-circle">{isSelected && <Check size={14} />}</div>
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>
            )}

            {/* STEP 6: Budget */}
            {step === 6 && (
              <div className="step-content">
                <div className="wizard-header">
                  <h1>Monthly budget for additional coverage</h1>
                  <p>
                    Optional. Helps INSURRA recommend realistic options without exceeding your budget
                    ({isAU ? "AUD" : "IDR"}).
                  </p>
                </div>

                <div className="step-body">
                  <div className="option-grid two-cols">
                    {budgetOptions.map((opt) => {
                      const isSelected = profile.budget_range === opt.label;
                      return (
                        <button
                          type="button"
                          key={opt.id}
                          className={`selectable-card ${isSelected ? "selected" : ""}`}
                          onClick={() => setProfile({ ...profile, budget_range: opt.label })}
                        >
                          <div className="selectable-card-content">
                            <span className="selectable-card-title">{opt.label}</span>
                            <span className="selectable-card-sub">{opt.sub}</span>
                          </div>
                          <div className="check-circle">{isSelected && <Check size={14} />}</div>
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Wizard Action Buttons */}
          <div className="wizard-actions">
            <div className="action-left">
              {step > 1 && (
                <button
                  type="button"
                  className="wizard-btn secondary"
                  onClick={handlePrevStep}
                  disabled={busy}
                >
                  <ArrowLeft size={16} /> Back
                </button>
              )}
            </div>

            <div className="action-right">
              {(step === 5 || step === 6) && (
                <button
                  type="button"
                  className="wizard-btn ghost"
                  onClick={() => {
                    if (step === 5) {
                      setProfile({ ...profile, priorities: [] });
                      setStep(6);
                    } else if (step === 6) {
                      setProfile({ ...profile, budget_range: "No additional budget" });
                      void completeOnboarding({ ...profile, budget_range: "No additional budget" });
                    }
                  }}
                  disabled={busy}
                >
                  Skip
                </button>
              )}

              <button
                type="button"
                className="wizard-btn primary"
                onClick={handleNextStep}
                disabled={busy}
              >
                {busy ? (
                  "Saving…"
                ) : step === 6 ? (
                  <>
                    Complete Profile <Check size={16} />
                  </>
                ) : (
                  <>
                    Continue <ArrowRight size={16} />
                  </>
                )}
              </button>
            </div>
          </div>
        </section>
      </section>
    </main>
  );
}

export default function AccountOnboarding() {
  return (
    <Suspense
      fallback={
        <main className="onboarding-container" style={{ display: "grid", placeItems: "center", minHeight: "100svh" }}>
          <p style={{ color: "#5b7182", fontWeight: 700 }}>Preparing your context…</p>
        </main>
      }
    >
      <AccountOnboardingContent />
    </Suspense>
  );
}
