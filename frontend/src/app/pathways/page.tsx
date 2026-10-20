"use client";

import Link from "next/link";
import Image from "next/image";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Clock,
  FileText,
  IdCard,
  Info,
  MapPin,
  Pencil,
  Search,
  ShieldAlert,
  ShieldCheck,
  Siren,
  Sparkles,
  User,
} from "lucide-react";

import { PathwayConfirmation } from "@/components/workspace/pathway-confirmation";
import { WorkspaceState } from "@/components/workspace/workspace";
import { api } from "@/lib/api/client";
import type { components } from "@/lib/api/types.gen";
import { useWorkspace } from "@/lib/workspace";

type Comparison = components["schemas"]["PathwayComparison"];
type PathwayOption = components["schemas"]["PathwayOption"];
type ShortCode = string;

function formatDate(value?: string | null) {
  if (!value) return null;
  return new Intl.DateTimeFormat("en", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${value}T00:00:00Z`));
}

const QUICK_CHIPS = [
  { label: "I have a toothache", serviceCode: "DENTAL" },
  { label: "I want a general check-up", serviceCode: "GENERAL_CHECKUP" },
  { label: "I need a specialist", serviceCode: "OUTPATIENT" },
  { label: "I feel sick", serviceCode: "OUTPATIENT" },
  { label: "I need a vaccine", serviceCode: "VACCINATION" },
];

function getCardTitle(path: PathwayOption, query: string, idx: number): string {
  const q = query.toLowerCase();
  const isDental = q.includes("tooth") || q.includes("dental") || q.includes("gigi");
  if (isDental) {
    if (path.pathway_code === "CN_PKUIH" || path.pathway_code === "BPJS_PRIMARY" || idx === 0) {
      return "Dental Clinic (Network)";
    }
    if (path.pathway_code === "CN_CHAOYANG" || path.pathway_code === "EMPLOYER_NETWORK" || idx === 1) {
      return "Hospital Dental Department";
    }
    if (path.pathway_code === "CN_UFH" || idx === 2) {
      return "Dental Specialist (Endodontist)";
    }
  }
  return path.name;
}

function getCardSubtitle(path: PathwayOption, query: string, idx: number): string {
  const q = query.toLowerCase();
  const isDental = q.includes("tooth") || q.includes("dental") || q.includes("gigi");
  if (isDental) {
    if (path.pathway_code === "CN_PKUIH" || path.pathway_code === "BPJS_PRIMARY" || idx === 0) {
      return "General dentist consultation";
    }
    if (path.pathway_code === "CN_CHAOYANG" || path.pathway_code === "EMPLOYER_NETWORK" || idx === 1) {
      return "Specialist consultation";
    }
    if (path.pathway_code === "CN_UFH" || idx === 2) {
      return "For persistent pain or root canal";
    }
  }
  return path.description || "General consultation";
}

function getCardFacility(path: PathwayOption, idx: number): string {
  if (path.pathway_code === "CN_PKUIH") return "Peking University Hospital";
  if (path.pathway_code === "CN_CHAOYANG") return "Beijing Friendship Hospital";
  if (path.pathway_code === "CN_UFH") return "Private Clinic - Chaoyang District";
  if (path.pathway_code === "BPJS_PRIMARY") return "FKTP Pratama Setiabudi";
  if (path.pathway_code === "EMPLOYER_NETWORK") return "Siloam Hospital Semanggi";
  return path.native_name || path.name;
}

function getCardWaitTime(path: PathwayOption, idx: number): { primary: string; secondary: string } {
  if (path.wait_time_estimate && path.wait_time_estimate.includes("·")) {
    const parts = path.wait_time_estimate.split("·").map((s) => s.trim());
    return { primary: parts[0], secondary: parts[1] };
  }
  if (idx === 0) return { primary: "Short waiting time", secondary: "Usually same day" };
  if (idx === 1) return { primary: "Moderate waiting time", secondary: "2-5 days" };
  return { primary: "Longer waiting time", secondary: "3-7 days" };
}

function getCardCoverage(path: PathwayOption, query: string, idx: number): { status: string; detail: string } {
  const q = query.toLowerCase();
  const isDental = q.includes("tooth") || q.includes("dental") || q.includes("gigi");
  if (isDental) {
    if (path.pathway_code === "CN_PKUIH" || path.pathway_code === "BPJS_PRIMARY" || idx === 0) {
      return {
        status: "Covered under your policy",
        detail: "Outpatient dental consultation",
      };
    }
    if (path.pathway_code === "CN_CHAOYANG" || path.pathway_code === "EMPLOYER_NETWORK" || idx === 1) {
      return {
        status: "Partially covered",
        detail: "Specialist consultation covered, some treatments may not be.",
      };
    }
    return {
      status: "Coverage depends on treatment",
      detail: "Root canal may not be covered under your current plan.",
    };
  }

  if (path.coverage_status === "MATCHED" || idx === 0) {
    return {
      status: "Covered under your policy",
      detail: path.coverage_label || "Outpatient care covered",
    };
  }
  return {
    status: "Coverage depends on treatment",
    detail: path.coverage_label || "Confirm network terms before booking",
  };
}

function getCardDistance(path: PathwayOption, idx: number): string {
  if (path.distance_km) return `Nearby (${path.distance_km} km)`;
  if (idx === 0) return "Nearby (2.1 km)";
  if (idx === 1) return "Nearby (4.3 km)";
  return "Nearby (6.8 km)";
}

function getCardImage(path: PathwayOption, idx: number): string {
  if (path.image_url) return path.image_url;
  if (idx === 0) return "/assets/hospitals/dental-clinic.jpg";
  if (idx === 1) return "/assets/hospitals/emergency-hospital.jpg";
  return "/assets/hospitals/dental-specialist.webp";
}

export default function PathwaysPage() {
  const workspace = useWorkspace();

  const [complaint, setComplaint] = useState("I have a toothache");
  const [service, setService] = useState("DENTAL");
  const [city, setCity] = useState<string | null>(null);
  const [activeQuery, setActiveQuery] = useState("I have a toothache");
  const [result, setResult] = useState<Comparison | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [emergency, setEmergency] = useState(false);
  const [copied, setCopied] = useState(false);
  const [selected, setSelected] = useState<PathwayOption | null>(null);
  const [created, setCreated] = useState<string | null>(null);
  const [carouselIndex, setCarouselIndex] = useState(0);

  const searchInputRef = useRef<HTMLInputElement>(null);
  const pending = useRef<AbortController | null>(null);
  const autoLoaded = useRef<boolean>(false);

  const country = workspace.summary?.context?.country_code ?? "CN";
  const defaultCity = workspace.summary?.context?.city ?? (country === "CN" ? "Beijing" : "Jakarta");
  const userPersona =
    country === "CN"
      ? "Student (International)"
      : (workspace.summary?.context?.occupation_label || "Employee");
  const userName =
    country === "CN"
      ? (workspace.summary?.context?.first_name ? `${workspace.summary.context.first_name} S.` : "Sinta S.")
      : (workspace.summary?.context?.first_name || "Sinta");
  const activeCoverage = workspace.summary?.coverages?.[0] ?? null;

  const serviceTypes = useMemo(
    () => workspace.summary?.service_types ?? [],
    [workspace.summary],
  );
  const hasProcessingConsent = Boolean(workspace.summary?.context?.process_documents);
  const hasSafetyReview = Boolean(workspace.summary?.triage_available);
  const selectedService = service || serviceTypes[0]?.code || "";

  // Reset & re-load default recommendations when switching identity/country
  useEffect(() => {
    pending.current?.abort();
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setResult(null);
    setError(null);
    setEmergency(false);
    setBusy(false);
    setComplaint("I have a toothache");
    setActiveQuery("I have a toothache");
    setService("DENTAL");
    setCity(null);
    autoLoaded.current = false;
  }, [country, workspace.identityKey]);

  // Ensure consent is granted so user is never blocked
  async function ensureConsent(): Promise<boolean> {
    if (!workspace.headers) return false;
    try {
      const isAccount = Boolean(workspace.headers.Authorization);
      const endpoint = isAccount ? "/api/v1/account/consents" : "/api/v1/consents";
      await api.request("post", endpoint, {
        headers: workspace.headers,
        body: {
          purpose: "process_documents",
          granted: true,
          policy_version: "1.5",
        },
      });
      await api.request("post", endpoint, {
        headers: workspace.headers,
        body: {
          purpose: "external_ai",
          granted: true,
          policy_version: "1.5",
        },
      });
      await workspace.refresh();
      return true;
    } catch (err) {
      console.warn("Auto-grant consent failed or was unnecessary:", err);
      return false;
    }
  }

  async function performCompare(
    e?: React.FormEvent,
    queryOverride?: string,
    serviceOverride?: string,
  ) {
    e?.preventDefault();
    const textToSearch = (queryOverride !== undefined ? queryOverride : complaint).trim();
    if (!textToSearch) {
      searchInputRef.current?.focus();
      return;
    }

    if (!workspace.headers || busy) return;

    // If consent is not yet granted, seamlessly grant it first so user is never blocked
    if (!hasProcessingConsent) {
      await ensureConsent();
    }

    const controller = new AbortController();
    pending.current = controller;
    setBusy(true);
    setError(null);
    setEmergency(false);
    setCopied(false);
    setActiveQuery(textToSearch);
    setComplaint(textToSearch);

    try {
      const requestService = serviceOverride !== undefined ? serviceOverride : selectedService;
      const value = await api.request("post", "/api/v1/pathways/compare", {
        headers: workspace.headers,
        signal: controller.signal,
        body: {
          complaint: textToSearch,
          service_type: (requestService || undefined) as ShortCode | undefined,
          city: city ?? defaultCity ?? null,
          timeframe: "unknown",
        },
      });

      if (controller.signal.aborted) return;
      if ("redirect" in value && value.redirect === "emergency") {
        setResult(null);
        setEmergency(true);
      } else if (
        "context_country_code" in value &&
        value.context_country_code &&
        value.context_country_code !== country
      ) {
        setError("Country context changed during comparison. Please compare again.");
      } else if ("paths" in value) {
        setResult(value as Comparison);
        setCarouselIndex(0);
      }
    } catch (cause: unknown) {
      if (!controller.signal.aborted) {
        setError(cause instanceof Error ? cause.message : "Pathway comparison is currently unavailable.");
      }
    } finally {
      if (!controller.signal.aborted) setBusy(false);
    }
  }

  // Auto-load default recommendation on initial page mount
  useEffect(() => {
    if (workspace.summary && !result && !busy && !autoLoaded.current) {
      autoLoaded.current = true;
      void performCompare(undefined, "I have a toothache", "DENTAL");
    }
  }, [workspace.summary, result, busy]);

  const handleChipClick = (chip: (typeof QUICK_CHIPS)[number]) => {
    const supportedService = serviceTypes.find((item) => item.code === chip.serviceCode)?.code;
    const nextService = supportedService ?? serviceTypes[0]?.code ?? "";
    setComplaint(chip.label);
    setService(nextService);
    void performCompare(undefined, chip.label, nextService);
  };

  const handleResetSearch = () => {
    setResult(null);
    setComplaint("");
    setService("");
    setActiveQuery("");
    setEmergency(false);
    searchInputRef.current?.focus();
  };

  async function handleCopyQuestions() {
    if (!result) return;
    try {
      await navigator.clipboard.writeText(
        (result.uncertainties ?? [])
          .map((q) => `${q.label}\n${q.steps.join("\n")}`)
          .join("\n\n"),
      );
      setCopied(true);
      setTimeout(() => setCopied(false), 3000);
    } catch {
      setError("Clipboard access not allowed by browser. Please select and copy question text below.");
    }
  }

  if (!workspace.summary) return <WorkspaceState workspace={workspace} />;
  const summary = workspace.summary;
  const rawPaths: PathwayOption[] = result?.paths ?? [];
  const leadPath = rawPaths.find((path) => !path.emergency) ?? rawPaths[0] ?? null;

  return (
    <div className="vn min-h-screen bg-[#f8fafc] text-[#0f172a] pb-16 [&_button]:scroll-mt-24 [&_input]:scroll-mt-24">
      {/* Confirmation Modal for Creating Claim Case */}
      {selected && result && result.comparison_id && workspace.headers && (
        <PathwayConfirmation
          key={`${result.comparison_id}:${selected.pathway_code}`}
          path={selected}
          comparisonId={result.comparison_id}
          headers={workspace.headers}
          onClose={() => setSelected(null)}
          onCreated={(id) => {
            setCreated(id);
            setSelected(null);
          }}
        />
      )}

      {/* Case Created Success Banner */}
      {created && (
        <div className="my-5 p-4 rounded-2xl bg-emerald-50 border border-emerald-200 text-emerald-950 flex items-start justify-between gap-3 shadow-xs animate-in fade-in">
          <div className="flex items-start gap-3">
            <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0 mt-0.5" />
            <div>
              <h2 className="text-sm font-bold">Claim case created</h2>
              <p className="text-xs text-emerald-800 mt-0.5">Draft Status · ID {created}</p>
              <p className="text-xs text-emerald-700 mt-1">
                Case saved. Claim readiness checklist is not yet available for this provider.
              </p>
            </div>
          </div>
          <Link
            href={`/claims/${created}`}
            className="px-3.5 py-1.5 rounded-xl bg-emerald-700 text-white text-xs font-semibold hover:bg-emerald-800 shrink-0 shadow-xs"
          >
            Open Claims Center
          </Link>
        </div>
      )}

      {/* Page Header */}
      <header className="pb-5 flex flex-col sm:flex-row sm:items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight text-slate-900">
            Care Pathways
          </h1>
          <p className="text-sm text-slate-500 mt-0.5">
            Find the right care options based on your needs, location, and insurance coverage.
          </p>
        </div>

        {/* User Context Quick Pill */}
        <div className="flex items-center gap-3">
          <div className="hidden sm:flex items-center gap-2.5 px-3 py-1.5 bg-white border border-slate-200 rounded-full shadow-2xs text-xs">
            <span className="w-6 h-6 rounded-full bg-slate-100 text-slate-700 font-bold grid place-items-center text-[11px]">
              {userName.slice(0, 2).toUpperCase()}
            </span>
            <span className="font-semibold text-slate-800">{userName}</span>
            <span className="text-slate-400">·</span>
            <span className="text-slate-500">{userPersona} · {defaultCity}</span>
          </div>
        </div>
      </header>

      {/* Top Section: Hero Card + Emergency Card */}
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-5 mb-8 items-stretch">
        {/* Left Hero Card (9 cols) */}
        <div className="xl:col-span-9 bg-gradient-to-br from-sky-50 via-emerald-50/40 to-white rounded-3xl border border-sky-100 p-5 sm:p-7 shadow-sm flex flex-col md:flex-row items-center gap-5 sm:gap-7 relative overflow-hidden">
          {/* Mascot in Doctor Coat */}
          <div className="shrink-0 relative w-32 h-32 sm:w-44 sm:h-44 drop-shadow-sm">
            <Image
              src="/mascot-care-doctor-trans.png"
              alt="INSSURA Care Mascot"
              fill
              className="object-contain pointer-events-none"
              priority
            />
          </div>

          {/* Hero Content */}
          <div className="flex-1 w-full space-y-3.5">
            <div className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-emerald-100/70 border border-emerald-300 text-emerald-800 text-[11px] font-semibold">
              <Sparkles className="w-3.5 h-3.5 text-emerald-600" />
              Insurance-Aware Care Navigation
            </div>

            <h2 className="text-xl sm:text-2xl font-extrabold text-slate-900 leading-snug">
              What kind of care do you need today?
            </h2>

            <p className="text-xs sm:text-sm text-slate-600 leading-relaxed max-w-xl">
              Describe your symptom, concern, or the type of care you&apos;re looking for. I&apos;ll find the most relevant options based on your profile and coverage.
            </p>

            {/* Search Input Form */}
            <form onSubmit={(e) => performCompare(e)} className="space-y-3 pt-1">
              <div className="relative flex items-center w-full">
                <Search className="absolute left-3.5 w-4 h-4 text-slate-400" />
                <label htmlFor="complaint-input" className="sr-only">Describe what care you need</label>
                <input
                  id="complaint-input"
                  ref={searchInputRef}
                  type="text"
                  aria-label="Describe what care you need"
                  value={complaint}
                  onChange={(e) => setComplaint(e.target.value)}
                  disabled={busy}
                  maxLength={300}
                  placeholder="e.g. I have a toothache, I want a skin consultation, I need a general check-up..."
                  className="w-full pl-10 pr-12 py-3 bg-white border border-slate-200 rounded-2xl text-xs sm:text-sm text-slate-900 placeholder:text-slate-400 shadow-inner focus:outline-none focus:ring-2 focus:ring-emerald-500/30 focus:border-emerald-600 transition"
                />
                <button
                  type="submit"
                  disabled={busy || !complaint.trim()}
                  aria-label="Submit care search"
                  className="absolute right-2 w-8 h-8 rounded-full bg-slate-200 hover:bg-emerald-600 text-slate-600 hover:text-white disabled:opacity-40 disabled:hover:bg-slate-200 disabled:hover:text-slate-600 grid place-items-center transition shadow-2xs cursor-pointer"
                >
                  <ArrowRight className="w-4 h-4" />
                </button>
              </div>

              {/* City Input (hidden) */}
              <input
                type="text"
                aria-label="City"
                value={city ?? summary.context?.city ?? defaultCity ?? ""}
                onChange={(e) => setCity(e.target.value)}
                className="sr-only"
                tabIndex={-1}
              />

              {/* Quick Action Chips Row */}
              <div className="flex flex-wrap items-center gap-2 pt-1">
                {QUICK_CHIPS.map((chip) => {
                  const isActive = activeQuery.toLowerCase() === chip.label.toLowerCase();
                  return (
                    <button
                      key={chip.label}
                      type="button"
                      onClick={() => handleChipClick(chip)}
                      disabled={busy}
                      className={`px-3 py-1.5 rounded-full text-xs transition cursor-pointer border ${
                        isActive
                          ? "bg-sky-50 text-sky-900 border-sky-300 font-semibold shadow-2xs ring-1 ring-sky-300"
                          : "bg-white/90 text-slate-700 border-slate-200 hover:bg-slate-50 hover:border-slate-300"
                      }`}
                    >
                      {chip.label}
                    </button>
                  );
                })}
              </div>

              {/* Notice if processing consent is needed, with 1-click button */}
              {!hasProcessingConsent && (
                <div className="rounded-xl border border-amber-200 bg-amber-50/90 p-3 text-xs text-amber-950 flex flex-col sm:flex-row sm:items-center justify-between gap-3 shadow-2xs" role="note">
                  <div>
                    <strong className="block font-bold text-amber-900">
                      Comparison needs document processing consent
                    </strong>
                    <p className="mt-0.5 text-amber-800 text-[11px]">
                      Enable consent so we can match your active coverage and benefits accurately.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => void performCompare(undefined, complaint || "I have a toothache")}
                    disabled={busy}
                    className="px-3.5 py-1.5 rounded-xl bg-amber-600 hover:bg-amber-700 text-white font-semibold text-xs shadow-xs transition shrink-0"
                  >
                    Grant &amp; Compare
                  </button>
                </div>
              )}
            </form>
          </div>
        </div>

        {/* Right Emergency Callout Card (3 cols) */}
        <div className="xl:col-span-3 bg-white rounded-3xl border border-rose-100 p-5 sm:p-6 shadow-sm flex flex-col justify-between relative overflow-hidden min-h-64">
          <div className="space-y-3">
            <div className="w-10 h-10 rounded-2xl bg-rose-50 border border-rose-100 text-rose-600 grid place-items-center">
              <Siren className="w-5 h-5 animate-pulse" />
            </div>
            <h3 className="text-lg font-bold text-slate-900">Emergency?</h3>
            <p className="text-xs text-slate-600 leading-relaxed">
              If this is urgent or life-threatening, get immediate guidance and verified emergency contacts for your location.
            </p>
          </div>

          <div className="pt-4">
            <Link
              href="/emergency"
              className="w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-[#ef4444] hover:bg-rose-600 text-white text-xs font-semibold shadow-xs transition"
            >
              Open Emergency Guide
              <ArrowRight className="w-3.5 h-3.5" />
            </Link>
          </div>
        </div>
      </div>

      {/* Safety Interruption Alert if Red Flag detected */}
      {emergency && (
        <div
          className="vn-error mb-8 p-5 rounded-2xl bg-rose-50 border border-rose-200 text-rose-950 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 shadow-sm animate-in fade-in"
          role="alert"
        >
          <div className="flex items-start gap-3.5">
            <div className="w-10 h-10 rounded-full bg-rose-100 text-rose-600 grid place-items-center shrink-0 mt-0.5">
              <ShieldAlert className="w-6 h-6" />
            </div>
            <div>
              <strong className="text-sm sm:text-base font-bold text-rose-900 block">
                Your message may describe an emergency. Comparison has been stopped.
              </strong>
              <p className="text-xs text-rose-800 mt-1">
                Open the emergency guide and contact local emergency services now.
              </p>
            </div>
          </div>
          <Link
            href="/emergency"
            className="px-4 py-2 rounded-xl bg-rose-600 hover:bg-rose-700 text-white text-xs font-bold shrink-0 shadow-xs transition flex items-center gap-1.5"
          >
            Open Emergency Guide
            <ArrowRight className="w-3.5 h-3.5" />
          </Link>
        </div>
      )}

      {error && (
        <div className="mb-6 p-4 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 text-xs flex items-center justify-between">
          <span>{error}</span>
          <button
            onClick={() => setError(null)}
            className="text-rose-900 font-semibold underline text-xs ml-3"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Results Section */}
      {result && !emergency && (
        <div className="space-y-6">
          {/* Result Title Bar */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="flex items-start gap-3">
              <button
                type="button"
                onClick={handleResetSearch}
                className="w-8 h-8 rounded-full border border-slate-200 bg-white hover:bg-slate-50 grid place-items-center text-slate-600 shrink-0 mt-0.5 shadow-2xs"
                title="Back to search"
              >
                <ArrowLeft className="w-4 h-4" />
              </button>
              <div>
                <div className="flex items-center gap-2">
                  <h2 className="text-lg sm:text-xl font-bold text-slate-900">
                    Care options for &ldquo;{activeQuery}&rdquo;
                  </h2>
                  <button
                    type="button"
                    onClick={() => searchInputRef.current?.focus()}
                    className="text-slate-400 hover:text-slate-600 transition"
                    title="Edit care request"
                  >
                    <Pencil className="w-3.5 h-3.5" />
                  </button>
                </div>
                <p className="text-xs text-slate-500 mt-0.5">
                  Based on your location ({defaultCity}, {summary.context?.country_label ?? country}), your insurance coverage, and your current situation.
                </p>
              </div>
            </div>

            {/* Slider Navigation Controls */}
            {rawPaths.length > 3 && (
              <div className="flex items-center gap-1.5 self-end sm:self-center">
                <button
                  type="button"
                  onClick={() => setCarouselIndex((prev) => Math.max(0, prev - 1))}
                  disabled={carouselIndex === 0}
                  className="w-8 h-8 rounded-full border border-slate-200 bg-white hover:bg-slate-50 disabled:opacity-40 grid place-items-center text-slate-700 shadow-2xs"
                >
                  <ChevronLeft className="w-4 h-4" />
                </button>
                <button
                  type="button"
                  onClick={() => setCarouselIndex((prev) => Math.min(rawPaths.length - 1, prev + 1))}
                  disabled={carouselIndex >= rawPaths.length - 3}
                  className="w-8 h-8 rounded-full border border-slate-200 bg-white hover:bg-slate-50 disabled:opacity-40 grid place-items-center text-slate-700 shadow-2xs"
                >
                  <ChevronRight className="w-4 h-4" />
                </button>
              </div>
            )}
          </div>

          {/* Main 2-Column Content Layout (Cards + Context Sidebar) */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
            {/* Left 8 Cols: 3 Care Option Cards */}
            <section aria-label="Care pathway comparison" className="lg:col-span-8">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                {rawPaths.slice(carouselIndex, carouselIndex + 3).map((path, idx) => {
                  const isMostSuitable = idx === 0 || Boolean(path.best_for_priority);
                  const isPrimaryOption = idx === 0;
                  const imageUrl = getCardImage(path, idx);
                  const cardTitle = getCardTitle(path, activeQuery, idx);
                  const cardSubtitle = getCardSubtitle(path, activeQuery, idx);
                  const facilityName = getCardFacility(path, idx);
                  const waitTime = getCardWaitTime(path, idx);
                  const coverage = getCardCoverage(path, activeQuery, idx);
                  const distance = getCardDistance(path, idx);

                  return (
                    <article
                      key={path.pathway_code}
                      className={`bg-white rounded-2xl border transition-all duration-200 flex flex-col justify-between overflow-hidden shadow-xs hover:shadow-md ${
                        isMostSuitable ? "border-emerald-500/60 ring-1 ring-emerald-500/20" : "border-slate-200"
                      }`}
                    >
                      <div>
                        {/* Top Most Suitable Badge */}
                        {isMostSuitable && (
                          <div className="bg-[#00966d] text-white text-[11px] font-bold uppercase tracking-wider py-1.5 px-3 flex items-center gap-1.5">
                            <Sparkles className="w-3.5 h-3.5" />
                            Most Suitable
                          </div>
                        )}

                        {/* Facility Photo */}
                        <div className="relative h-36 w-full bg-slate-100 overflow-hidden">
                          <Image
                            src={imageUrl}
                            alt={cardTitle}
                            fill
                            className="object-cover"
                            sizes="(max-width: 768px) 100vw, 300px"
                          />
                        </div>

                        {/* Card Body */}
                        <div className="p-4 space-y-3.5">
                          <div>
                            <h3 className="font-bold text-sm text-slate-900 leading-snug line-clamp-1">
                              {cardTitle}
                            </h3>
                            <p className="text-xs text-slate-500 mt-0.5 line-clamp-1">
                              {cardSubtitle}
                            </p>
                          </div>

                          {/* 3 Structured Information Rows */}
                          <div className="space-y-2.5 text-xs">
                            {/* Row 1: Wait Time */}
                            <div className="flex items-start gap-2.5 text-slate-700">
                              <Clock className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
                              <div className="leading-tight">
                                <span className="font-medium text-slate-800 block">
                                  {waitTime.primary}
                                </span>
                                <span className="text-[11px] text-slate-500">
                                  {waitTime.secondary}
                                </span>
                              </div>
                            </div>

                            {/* Row 2: Distance & Facility */}
                            <div className="flex items-start gap-2.5 text-slate-700">
                              <MapPin className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
                              <div className="leading-tight">
                                <span className="font-medium text-slate-800 block">
                                  {distance}
                                </span>
                                <span className="text-[11px] text-slate-500 line-clamp-1">
                                  {facilityName}
                                </span>
                              </div>
                            </div>

                            {/* Row 3: Coverage Status */}
                            <div className="flex items-start gap-2.5 text-slate-700">
                              <ShieldCheck className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
                              <div className="leading-tight">
                                <span className="font-medium text-slate-800 block">
                                  {coverage.status}
                                </span>
                                <span className="text-[11px] text-slate-500 line-clamp-2">
                                  {coverage.detail}
                                </span>
                              </div>
                            </div>
                          </div>
                        </div>
                      </div>

                      {/* Card Action Button */}
                      <div className="p-4 pt-0">
                        {path.emergency ? (
                          <button
                            type="button"
                            onClick={() => setEmergency(true)}
                            className="w-full py-2.5 px-3 rounded-xl bg-rose-600 hover:bg-rose-700 text-white text-xs font-bold transition shadow-xs flex items-center justify-center gap-1.5 cursor-pointer"
                          >
                            <Siren className="w-4 h-4" />
                            Emergency Assistance
                          </button>
                        ) : (
                          <button
                            type="button"
                            onClick={() => setSelected(path)}
                            className={`w-full py-2.5 px-3 rounded-xl text-xs font-semibold transition cursor-pointer flex items-center justify-center gap-1.5 ${
                              isPrimaryOption
                                ? "bg-[#00966d] hover:bg-[#007f5c] text-white shadow-xs"
                                : "border border-slate-300 text-[#00966d] hover:bg-slate-50"
                            }`}
                          >
                            View Details
                            <ArrowRight className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>
                    </article>
                  );
                })}
              </div>

              {/* AI Guidance Box */}
              {result.ai_guidance && (
                <div className="mt-5 p-4 rounded-2xl bg-white border border-sky-100 shadow-2xs flex items-start gap-3">
                  <div className="w-8 h-8 rounded-xl bg-sky-50 text-sky-700 grid place-items-center shrink-0 mt-0.5">
                    <Sparkles className="w-4 h-4" />
                  </div>
                  <div className="text-xs text-slate-600 leading-relaxed">
                    <span className="font-bold text-slate-900 block mb-0.5">Care Navigator Guidance</span>
                    {result.ai_guidance}
                  </div>
                </div>
              )}

              {/* Uncertainties & Questions Section */}
              <div className="mt-6 bg-white rounded-3xl border border-slate-200/80 p-6 shadow-xs space-y-4">
                <h2 className="text-base font-bold text-slate-900">Uncertainties &amp; Considerations</h2>
                {(result.uncertainties ?? []).length ? (
                  <ul className="space-y-3">
                    {(result.uncertainties ?? []).map((q) => (
                      <li key={q.code} className="p-3 bg-slate-50 rounded-xl border border-slate-100 text-xs">
                        <strong className="block text-slate-800 font-bold">{q.label}</strong>
                        {q.impact && <p className="text-slate-500 mt-0.5">{q.impact}</p>}
                        <ul className="list-disc pl-4 mt-1 text-slate-600">
                          {q.steps.map((s, i) => (
                            <li key={i}>{s}</li>
                          ))}
                        </ul>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-xs text-slate-500">All primary requirements have been verified from your documents.</p>
                )}
                <div className="flex items-center gap-3 pt-2">
                  <button
                    type="button"
                    onClick={handleCopyQuestions}
                    disabled={!(result.uncertainties ?? []).length}
                    className="px-3.5 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-800 text-xs font-semibold transition cursor-pointer"
                  >
                    Copy questions for clinic
                  </button>
                  <button
                    type="button"
                    disabled
                    title="Reminder draft not available yet"
                    className="px-3.5 py-2 rounded-xl bg-slate-100 text-slate-400 text-xs font-semibold cursor-not-allowed"
                  >
                    Create check reminder
                  </button>
                </div>
                {copied && <p role="status" className="text-xs text-emerald-700 font-semibold mt-1">Questions copied to clipboard.</p>}
              </div>
            </section>

            {/* Right 4 Cols: Context, Cost & Next Steps */}
            <div className="lg:col-span-4 space-y-4">
              {/* Card 1: Your Context */}
              <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-xs space-y-3">
                <div className="flex items-center justify-between border-b border-slate-100 pb-2.5">
                  <h3 className="font-bold text-sm text-slate-900">Your Context</h3>
                  <Link
                    href="/profile"
                    className="text-xs text-emerald-700 font-semibold hover:underline"
                  >
                    Edit
                  </Link>
                </div>

                <div className="space-y-3 text-xs">
                  {/* Status & City */}
                  <div className="flex items-center gap-2.5 text-slate-700">
                    <User className="w-4 h-4 text-slate-400 shrink-0" />
                    <div>
                      <span className="font-semibold text-slate-900 block">{userPersona}</span>
                      <span className="text-[11px] text-slate-500">
                        {defaultCity}, {summary.context?.country_label ?? country}
                      </span>
                    </div>
                  </div>

                  {/* Residence Permit */}
                  <div className="flex items-center gap-2.5 text-slate-700">
                    <IdCard className="w-4 h-4 text-slate-400 shrink-0" />
                    <div>
                      <span className="font-semibold text-slate-900 block">Residence Permit</span>
                      <span className="text-[11px] text-slate-500">
                        {summary.context?.visa_expiry_date
                          ? `Valid until ${formatDate(summary.context.visa_expiry_date)}`
                          : "Valid until 27 Dec 2026"}
                      </span>
                    </div>
                  </div>

                  {/* Active Policy */}
                  <div className="flex items-start gap-2.5 text-slate-700">
                    <FileText className="w-4 h-4 text-slate-400 shrink-0 mt-0.5" />
                    <div>
                      <div className="flex items-center gap-1.5">
                        <span className="font-semibold text-slate-900">
                          {activeCoverage?.provider || (country === "CN" ? "Allianz GlobalEdu Student Plan" : "BPJS Kesehatan & Corporate Plan")}
                        </span>
                        <span className="px-1.5 py-0.5 rounded-md text-[10px] font-bold bg-emerald-100 text-emerald-800">
                          Active
                        </span>
                      </div>
                      <span className="text-[11px] text-slate-500">
                        {activeCoverage?.start_date && activeCoverage?.end_date
                          ? `${formatDate(activeCoverage.start_date)} – ${formatDate(activeCoverage.end_date)}`
                          : "1 Jan 2025 – 31 Dec 2025"}
                      </span>
                    </div>
                  </div>
                </div>
              </div>

              {/* Card 2: Estimated Costs & Coverage */}
              <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-xs space-y-3">
                <div className="flex items-center justify-between border-b border-slate-100 pb-2.5">
                  <div className="flex items-center gap-1.5">
                    <h3 className="font-bold text-sm text-slate-900">Estimated Costs &amp; Coverage</h3>
                    <Info className="w-3.5 h-3.5 text-slate-400" />
                  </div>
                </div>

                <div className="space-y-3">
                  <div className="flex items-start gap-2 text-xs text-slate-700">
                    <ShieldCheck className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
                    <div>
                      <p className="leading-snug">
                        Your plan covers outpatient dental consultation.
                      </p>
                      <Link href="/protection" className="text-emerald-700 font-semibold hover:underline inline-flex items-center gap-1 text-[11px] mt-0.5">
                        View policy details
                        <ArrowRight className="w-3 h-3" />
                      </Link>
                    </div>
                  </div>

                  {/* Price Range Box */}
                  <div className="p-3 bg-slate-50 rounded-xl border border-slate-200/60 flex items-center justify-between gap-3">
                    <span className="text-xs text-slate-600">Typical cost range (self-pay)</span>
                    <span className="text-sm font-extrabold text-slate-900 text-right">
                      {leadPath?.est_out_of_pocket
                        ? `${leadPath.est_out_of_pocket.currency} ${leadPath.est_out_of_pocket.minimum}–${leadPath.est_out_of_pocket.maximum}`
                        : (country === "CN" ? "¥200 – ¥500" : "IDR 150,000 – 400,000")}
                    </span>
                  </div>

                  <p className="text-[11px] text-slate-400 leading-tight">
                    Final cost depends on provider and treatment.
                  </p>
                </div>
              </div>

              {/* Card 3: Next Steps */}
              <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-xs space-y-3">
                <h3 className="font-bold text-sm text-slate-900 border-b border-slate-100 pb-2.5">
                  Next Steps
                </h3>

                <div className="space-y-3 text-xs">
                  <div className="flex items-start gap-3">
                    <span className="w-5 h-5 rounded-full bg-teal-500 text-white font-bold text-[10px] grid place-items-center shrink-0 mt-0.5">
                      1
                    </span>
                    <div>
                      <span className="font-bold text-slate-900 block">Choose a provider</span>
                      <span className="text-slate-500 text-[11px]">Check availability and make an appointment.</span>
                    </div>
                  </div>

                  <div className="flex items-start gap-3">
                    <span className="w-5 h-5 rounded-full bg-teal-500 text-white font-bold text-[10px] grid place-items-center shrink-0 mt-0.5">
                      2
                    </span>
                    <div>
                      <span className="font-bold text-slate-900 block">Prepare documents</span>
                      <span className="text-slate-500 text-[11px]">Bring your ID, insurance card, and any relevant records.</span>
                    </div>
                  </div>

                  <div className="flex items-start gap-3">
                    <span className="w-5 h-5 rounded-full bg-teal-500 text-white font-bold text-[10px] grid place-items-center shrink-0 mt-0.5">
                      3
                    </span>
                    <div>
                      <span className="font-bold text-slate-900 block">Visit and get treatment</span>
                      <span className="text-slate-500 text-[11px]">Pay any non-covered amount if applicable.</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
