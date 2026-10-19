"use client";

import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  AlertCircle,
  AlertTriangle,
  Car,
  CheckCircle2,
  ChevronRight,
  Copy,
  FileCheck,
  IdCard,
  MapPin,
  Search,
  ShieldAlert,
  ShieldCheck,
  Stethoscope,
} from "lucide-react";

import { PathwayConfirmation } from "@/components/workspace/pathway-confirmation";
import {
  ConsentNotice,
  EmergencyNotice,
  WorkspaceState,
} from "@/components/workspace/workspace";
import { api } from "@/lib/api/client";
import type { components } from "@/lib/api/types.gen";
import { useWorkspace } from "@/lib/workspace";

type Comparison = components["schemas"]["PathwayComparison"];
type PathwayOption = components["schemas"]["PathwayOption"];
type EmployerOverview = {
  country_code: string;
  coordination: string;
  coordination_evidence_ref?: string | null;
  coordination_principles?: { coordination: string; summary?: string } | null;
  user_declared_policies?: Array<{ kind: string; coordination: string }>;
};

export default function PathwaysPage() {
  const router = useRouter();
  const workspace = useWorkspace();
  const [complaint, setComplaint] = useState("");
  const [service, setService] = useState("");
  const [city, setCity] = useState("");
  const [timeframe, setTimeframe] = useState<"today" | "this_week" | "unknown">("unknown");
  const [filterChip, setFilterChip] = useState<"all" | "in_network" | "direct_billing" | "english">("all");
  const [sortBy, setSortBy] = useState<"recommended" | "lowest_cost" | "closest">("recommended");
  const [result, setResult] = useState<Comparison | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [emergency, setEmergency] = useState(false);
  const [selected, setSelected] = useState<PathwayOption | null>(null);
  const [created, setCreated] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [employerOverview, setEmployerOverview] = useState<EmployerOverview | null>(null);
  const [preparingInquiry, setPreparingInquiry] = useState(false);

  const searchInputRef = useRef<HTMLInputElement>(null);
  const pending = useRef<AbortController | null>(null);
  const country = workspace.summary?.context?.country_code;
  const defaultCity = workspace.summary?.context?.city ?? "";

  useEffect(() => {
    pending.current?.abort();
    queueMicrotask(() => {
      setResult(null);
      setError(null);
      setEmergency(false);
      setBusy(false);
      setComplaint("");
      setService("");
      setCity(defaultCity);
      setTimeframe("unknown");
      setSelected(null);
      setCreated(null);
    });
    return () => pending.current?.abort();
  }, [country, defaultCity, workspace.identityKey]);

  useEffect(() => {
    if (!workspace.headers || !country) return;
    let active = true;
    fetch(`/api/v1/workflow/employer-benefits/overview?country_code=${encodeURIComponent(country)}`, {
      headers: workspace.headers,
    })
      .then(async (res: Response) => {
        if (!res.ok) throw new Error("Failed");
        const data = (await res.json()) as EmployerOverview;
        if (active) setEmployerOverview(data);
      })
      .catch(() => {
        if (active) setEmployerOverview(null);
      });
    return () => {
      active = false;
    };
  }, [country, workspace.headers]);

  const rawPaths: PathwayOption[] = useMemo(() => {
    return result?.paths ?? [];
  }, [result]);

  const filteredPaths = useMemo(() => {
    return rawPaths.filter((path) => {
      if (filterChip === "in_network") return path.in_network === true || path.coverage_status === "MATCHED";
      if (filterChip === "direct_billing") return path.direct_billing === true;
      if (filterChip === "english") return (path.language_support ?? "").toLowerCase().includes("english");
      return true;
    });
  }, [rawPaths, filterChip]);

  const displayedPaths = useMemo(() => {
    const list = [...filteredPaths];
    if (sortBy === "recommended") {
      list.sort((a, b) => (b.best_for_priority ? 1 : 0) - (a.best_for_priority ? 1 : 0));
    } else if (sortBy === "lowest_cost") {
      list.sort((a, b) => {
        const costA = parseFloat(a.est_out_of_pocket?.minimum || "999999");
        const costB = parseFloat(b.est_out_of_pocket?.minimum || "999999");
        return costA - costB;
      });
    } else if (sortBy === "closest") {
      list.sort((a, b) => (a.distance_km ?? 99) - (b.distance_km ?? 99));
    }
    return list;
  }, [filteredPaths, sortBy]);

  if (!workspace.summary) return <WorkspaceState workspace={workspace} />;
  const summary = workspace.summary;
  const enabled = Boolean(summary.context?.process_documents && summary.triage_available);
  const serviceTypes = summary.service_types ?? [];
  const activeCoverage = summary.coverages?.[0] ?? null;

  async function performCompare(e?: React.FormEvent) {
    e?.preventDefault();
    const textToSearch = complaint.trim();
    const serviceType = service.trim();

    if (!workspace.headers || busy || !enabled || !textToSearch || !serviceType) {
      if (!textToSearch) {
        searchInputRef.current?.focus();
      }
      return;
    }

    const controller = new AbortController();
    pending.current = controller;
    setBusy(true);
    setError(null);
    setEmergency(false);

    try {
      const value = await api.request("post", "/api/v1/pathways/compare", {
        headers: workspace.headers,
        signal: controller.signal,
        body: {
          complaint: textToSearch,
          service_type: serviceType,
          city: city.trim() || summary.context?.city || null,
          timeframe,
        },
      });

      if (controller.signal.aborted) return;
      if ("redirect" in value) {
        setResult(null);
        setEmergency(true);
      } else if (value.context_country_code !== country) {
        setError("Country context changed during comparison. Please compare again.");
      } else {
        setResult(value);
        setComplaint("");
      }
    } catch (cause: unknown) {
      if (!controller.signal.aborted) {
        setError(cause instanceof Error ? cause.message : "Pathway comparison is currently unavailable.");
      }
    } finally {
      if (!controller.signal.aborted) setBusy(false);
    }
  }

  async function copyQuestions() {
    if (!result?.uncertainties?.length) return;
    const text = result.uncertainties
      .map((q) => `- ${q.label}${q.steps?.length ? `\n  ${q.steps.join("; ")}` : ""}`)
      .join("\n");
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  }

  async function handlePrepareClarification(actionType: "employer_benefit_inquiry" | "policy_clarification_inquiry") {
    if (preparingInquiry) return;
    setPreparingInquiry(true);
    setError(null);
    try {
      const q =
        actionType === "employer_benefit_inquiry"
          ? "Bagaimana koordinasi manfaat antara BPJS/JKN dan asuransi kantor untuk klaim rawat jalan?"
          : `Bagaimana status jaringan dan klaim langsung (direct billing) untuk ${activeCoverage?.provider || "asuransi saya"}?`;
      if (typeof window !== "undefined") {
        sessionStorage.setItem("insurra_demo_prompt", q);
      }
      router.push("/ask");
    } catch (cause: unknown) {
      setError(cause instanceof Error ? cause.message : "Could not prepare clarification draft.");
    } finally {
      setPreparingInquiry(false);
    }
  }

  return (
    <div className="vn min-h-screen bg-[#f8fafc] text-[#0f172a] pb-16 px-4 sm:px-6 lg:px-8 max-w-7xl mx-auto">
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

      <EmergencyNotice info={summary.emergency} />

      {created && (
        <div className="mb-6 p-4 rounded-2xl bg-emerald-50 border border-emerald-200 text-emerald-950 flex items-start justify-between gap-3 shadow-xs">
          <div className="flex items-start gap-3">
            <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0 mt-0.5" />
            <div>
              <h2 className="text-sm font-bold">Claim Case Created</h2>
              <p className="text-xs text-emerald-800 mt-0.5">Status Draft · ID {created}</p>
              <p className="text-xs text-emerald-700 mt-1">
                Draft claim case saved. Open Claims Center to review evidence checklist items.
              </p>
            </div>
          </div>
          <Link
            href={`/claims/${created}`}
            className="px-3 py-1.5 rounded-xl bg-emerald-700 text-white text-xs font-semibold hover:bg-emerald-800 shrink-0"
          >
            Open in Claims Center
          </Link>
        </div>
      )}

      <header className="pt-6 pb-6 flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-gray-100">
        <div>
          <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight text-[#0f172a]">
            Care Pathways
          </h1>
          <p className="text-sm text-gray-500 mt-1">
            Compare KB-supported care pathways based on your active coverage and jurisdiction ({country ?? "Unknown"}).
          </p>
        </div>

        <div className="flex items-center gap-3 bg-white/80 backdrop-blur-xs p-2 rounded-2xl border border-sky-100 shadow-xs max-w-md">
          <div className="relative w-12 h-12 shrink-0">
            <Image
              src="/Winking Kangaroo Shield Mascot.png"
              alt="INSURRA Mascot"
              fill
              className="object-contain"
              priority
            />
          </div>
          <div className="text-xs leading-relaxed">
            <span className="font-bold text-sky-950 block">Evidence-first comparison</span>
            <span className="text-gray-600 line-clamp-2">
              {result?.ai_guidance ||
                "Select a service type and describe your non-emergency care need to compare pathways."}
            </span>
          </div>
        </div>
      </header>

      {!summary.context?.process_documents && (
        <div className="mt-4">
          <ConsentNotice />
        </div>
      )}
      {!summary.triage_available && (
        <div className="mt-4 p-4 rounded-xl bg-amber-50 border border-amber-200 text-amber-900 text-xs">
          <strong>Safety triage data for this country is not yet verified.</strong>
          <p className="mt-1">
            Care pathways are locked until verified red-flag safety rules are available for this jurisdiction.
          </p>
        </div>
      )}

      {emergency && (
        <div
          className="mt-4 p-4 rounded-2xl bg-rose-50 border border-rose-200 text-rose-950 flex items-start justify-between gap-3 shadow-xs"
          role="alert"
        >
          <div className="flex items-start gap-3">
            <ShieldAlert className="w-6 h-6 text-rose-600 shrink-0" />
            <div>
              <strong className="text-sm font-bold">
                Comparison stopped: Emergency symptoms detected.
              </strong>
              <p className="text-xs text-rose-800 mt-1">
                Do not wait for an insurance pathway comparison. Seek immediate emergency medical attention.
              </p>
            </div>
          </div>
          <Link
            href="/emergency"
            className="px-3 py-1.5 rounded-xl bg-rose-600 text-white text-xs font-semibold hover:bg-rose-700 shrink-0"
          >
            Open Emergency Guidance
          </Link>
        </div>
      )}

      {error && (
        <p className="mt-4 p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 text-xs" role="alert">
          {error}
        </p>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 mt-6 items-start">
        <main className="lg:col-span-8 space-y-6">
          <section className="bg-white rounded-2xl border border-gray-200/80 p-5 shadow-xs">
            <h2 className="text-base font-bold text-gray-900">What kind of care do you need?</h2>
            <p className="text-xs text-gray-500 mt-0.5">
              Describe your non-emergency care need and select a KB service type.
            </p>

            <form onSubmit={performCompare} className="mt-4 space-y-4">
              <div>
                <label htmlFor="pathway-complaint" className="block text-xs font-semibold text-gray-700 mb-1">
                  Describe your care need
                </label>
                <div className="relative flex items-center">
                  <Search className="absolute left-3.5 w-4 h-4 text-gray-400" />
                  <input
                    id="pathway-complaint"
                    ref={searchInputRef}
                    type="text"
                    value={complaint}
                    onChange={(e) => setComplaint(e.target.value)}
                    disabled={!enabled || busy}
                    placeholder="e.g. non-emergency outpatient consultation, fever, dental checkup"
                    className="w-full pl-10 pr-4 py-2.5 bg-[#f8fafc] border border-gray-200 rounded-xl text-xs sm:text-sm text-gray-900 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-600"
                    aria-label="Describe your care need"
                  />
                </div>
              </div>

              <div>
                <span className="text-[11px] font-bold text-gray-500 uppercase tracking-wider block mb-2">
                  Service type
                </span>
                {serviceTypes.length > 0 ? (
                  <div className="flex flex-wrap gap-2">
                    {serviceTypes.map((item: components["schemas"]["ServiceChoice"]) => (
                      <button
                        key={item.code}
                        type="button"
                        aria-pressed={service === item.code}
                        onClick={() => setService(item.code)}
                        disabled={!enabled || busy}
                        className={`px-3 py-1.5 rounded-full text-xs font-medium border transition-colors ${
                          service === item.code
                            ? "bg-emerald-600 text-white border-emerald-600 font-semibold"
                            : "bg-[#f8fafc] text-gray-700 border-gray-200 hover:bg-emerald-50"
                        }`}
                      >
                        {item.label}
                      </button>
                    ))}
                  </div>
                ) : (
                  <p className="text-xs text-gray-500">Not available for this country context.</p>
                )}
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label htmlFor="pathway-city" className="block text-xs font-semibold text-gray-700 mb-1">
                    City
                  </label>
                  <input
                    id="pathway-city"
                    type="text"
                    aria-label="City"
                    value={city}
                    onChange={(e) => setCity(e.target.value)}
                    disabled={!enabled || busy}
                    className="w-full px-3 py-2 bg-[#f8fafc] border border-gray-200 rounded-xl text-xs text-gray-900"
                  />
                </div>
                <div>
                  <label htmlFor="pathway-timeframe" className="block text-xs font-semibold text-gray-700 mb-1">
                    Timeframe
                  </label>
                  <select
                    id="pathway-timeframe"
                    aria-label="Timeframe"
                    value={timeframe}
                    onChange={(e) =>
                      setTimeframe(e.target.value as "today" | "this_week" | "unknown")
                    }
                    disabled={!enabled || busy}
                    className="w-full px-3 py-2 bg-[#f8fafc] border border-gray-200 rounded-xl text-xs text-gray-900"
                  >
                    <option value="unknown">Not specified / Planning ahead</option>
                    <option value="today">Today</option>
                    <option value="this_week">This week</option>
                  </select>
                </div>
              </div>

              <div className="flex justify-end">
                <button
                  type="submit"
                  disabled={!enabled || busy || !complaint.trim() || !service}
                  className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 disabled:bg-gray-200 disabled:text-gray-500 text-white font-semibold text-xs rounded-xl transition-colors shadow-xs"
                  aria-label="Compare pathways"
                >
                  {busy ? "Comparing..." : "Compare pathways"}
                </button>
              </div>
            </form>
          </section>

          <section className="space-y-4" role="region" aria-label="Pathway comparison">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
              <div>
                <h2 className="text-lg font-bold text-gray-900">Care pathway options</h2>
                <p className="text-xs text-gray-500">
                  Matched to your jurisdiction ({country ?? "Unknown"}) and active policy records.
                </p>
              </div>
            </div>

            {rawPaths.length > 0 && (
              <div className="flex flex-wrap items-center justify-between gap-3 bg-white p-3 rounded-xl border border-gray-100 shadow-xs">
                <div className="flex flex-wrap items-center gap-1.5 text-xs font-medium">
                  <button
                    type="button"
                    onClick={() => setFilterChip("all")}
                    className={`px-3 py-1 rounded-full transition-colors ${
                      filterChip === "all"
                        ? "bg-emerald-600 text-white font-semibold"
                        : "bg-gray-100 text-gray-600 hover:bg-gray-200"
                    }`}
                  >
                    All ({rawPaths.length})
                  </button>
                  <button
                    type="button"
                    onClick={() => setFilterChip("in_network")}
                    className={`px-3 py-1 rounded-full transition-colors ${
                      filterChip === "in_network"
                        ? "bg-emerald-600 text-white font-semibold"
                        : "bg-gray-100 text-gray-600 hover:bg-gray-200"
                    }`}
                  >
                    Matched coverage ({rawPaths.filter((p) => p.in_network || p.coverage_status === "MATCHED").length})
                  </button>
                  <button
                    type="button"
                    onClick={() => setFilterChip("direct_billing")}
                    className={`px-3 py-1 rounded-full transition-colors ${
                      filterChip === "direct_billing"
                        ? "bg-emerald-600 text-white font-semibold"
                        : "bg-gray-100 text-gray-600 hover:bg-gray-200"
                    }`}
                  >
                    Verified direct billing ({rawPaths.filter((p) => p.direct_billing === true).length})
                  </button>
                  <button
                    type="button"
                    onClick={() => setFilterChip("english")}
                    className={`px-3 py-1 rounded-full transition-colors ${
                      filterChip === "english"
                        ? "bg-emerald-600 text-white font-semibold"
                        : "bg-gray-100 text-gray-600 hover:bg-gray-200"
                    }`}
                  >
                    English support
                  </button>
                </div>

                <div className="flex items-center gap-2 text-xs text-gray-500 shrink-0">
                  <span>Sort by:</span>
                  <select
                    value={sortBy}
                    onChange={(e) => setSortBy(e.target.value as "recommended" | "lowest_cost" | "closest")}
                    className="bg-gray-50 border border-gray-200 rounded-lg px-2 py-1 text-xs text-gray-800"
                  >
                    <option value="recommended">Recommended</option>
                    <option value="lowest_cost">Lowest verified cost</option>
                    <option value="closest">Closest distance</option>
                  </select>
                </div>
              </div>
            )}

            {displayedPaths.length === 0 ? (
              <div className="bg-white rounded-2xl border border-gray-200/80 p-6 text-xs text-gray-600">
                {result
                  ? "Not available: no pathways matched the selected filter."
                  : "Enter your care need and select a service type above to compare KB pathways."}
              </div>
            ) : (
              <div className="space-y-4">
                {displayedPaths.map((path) => (
                  <article
                    key={path.pathway_code}
                    className="bg-white rounded-2xl border border-gray-200/80 hover:border-emerald-300 p-4 sm:p-5 shadow-xs transition-all flex flex-col md:flex-row gap-4 sm:gap-5 justify-between items-start"
                  >
                    <div className="flex-1 min-w-0 space-y-2">
                      <div className="flex flex-wrap items-center gap-2">
                        {path.best_for_priority && (
                          <span className="bg-indigo-600 text-white text-[10px] font-bold px-2 py-0.5 rounded-full uppercase tracking-wider">
                            Recommended
                          </span>
                        )}
                        <span className="bg-slate-100 text-slate-700 text-[10px] font-semibold px-2 py-0.5 rounded-full">
                          {path.coverage_status === "MATCHED" ? "Coverage matched" : "Needs verification"}
                        </span>
                        {path.sources?.[0]?.verification_status && (
                          <span className="bg-amber-50 text-amber-800 border border-amber-200 text-[10px] font-semibold px-2 py-0.5 rounded-full">
                            KB source: {path.sources[0].verification_status}
                          </span>
                        )}
                        <h3 className="text-base font-bold text-gray-900">{path.name}</h3>
                      </div>

                      {path.native_name && (
                        <p className="text-xs text-gray-500 font-sans">{path.native_name}</p>
                      )}
                      <p className="text-xs text-gray-600">{path.description}</p>
                      {path.coverage_label && (
                        <p className="text-xs font-medium text-teal-800">{path.coverage_label}</p>
                      )}
                      {path.priority_reason && (
                        <p className="text-xs text-indigo-700 font-medium">{path.priority_reason}</p>
                      )}

                      <div className="flex flex-wrap items-center gap-2 text-xs text-gray-500">
                        {path.distance_km != null && (
                          <span className="flex items-center gap-1 font-medium text-gray-600">
                            <Car className="w-3.5 h-3.5 text-gray-400" />
                            {path.distance_km} km
                            {path.travel_time_min != null ? ` · ${path.travel_time_min} min` : ""}
                          </span>
                        )}
                        {path.language_support && (
                          <span className="text-[11px] px-2 py-0.5 rounded-full font-medium bg-emerald-50 text-emerald-700 border border-emerald-200">
                            {path.language_support}
                          </span>
                        )}
                        <span className="text-[11px] px-2 py-0.5 rounded-full bg-slate-100 text-slate-700">
                          Direct billing:{" "}
                          {path.direct_billing === true
                            ? "Verified"
                            : path.direct_billing === false
                              ? "Reimbursement"
                              : "Unverified"}
                        </span>
                      </div>

                      {path.steps.length > 0 && (
                        <div className="pt-2">
                          <p className="text-[11px] font-bold text-gray-700 uppercase tracking-wider">
                            Steps
                          </p>
                          <ol className="list-decimal list-inside text-xs text-gray-700 space-y-1 mt-1">
                            {path.steps.map((step, i) => (
                              <li key={i}>{step}</li>
                            ))}
                          </ol>
                        </div>
                      )}

                      {path.docs.length > 0 && (
                        <div className="pt-1">
                          <p className="text-[11px] font-bold text-gray-700 uppercase tracking-wider">
                            Required documents
                          </p>
                          <ul className="list-disc list-inside text-xs text-gray-600 space-y-0.5 mt-1">
                            {path.docs.map((doc, i) => (
                              <li key={i}>{doc}</li>
                            ))}
                          </ul>
                        </div>
                      )}

                      {(path.highlights?.length || path.cautions?.length) ? (
                        <div className="pt-1 space-y-1">
                          {(path.highlights || []).map((h, i) => (
                            <div key={i} className="flex items-center gap-1.5 text-xs text-gray-700">
                              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                              <span>{h}</span>
                            </div>
                          ))}
                          {(path.cautions || []).map((c, i) => (
                            <div key={i} className="flex items-center gap-1.5 text-xs text-gray-700">
                              <AlertCircle className="w-3.5 h-3.5 text-amber-500 shrink-0" />
                              <span>{c}</span>
                            </div>
                          ))}
                        </div>
                      ) : null}
                    </div>

                    <div className="w-full md:w-auto flex md:flex-col items-center md:items-end justify-between gap-3 pt-3 md:pt-0 border-t md:border-t-0 border-gray-100 shrink-0">
                      <div className="text-left md:text-right">
                        <span className="text-[11px] text-gray-500 block">Estimated out-of-pocket</span>
                        <div className="text-sm font-extrabold text-emerald-700">
                          {path.est_out_of_pocket
                            ? `${path.est_out_of_pocket.minimum} - ${path.est_out_of_pocket.maximum} ${path.est_out_of_pocket.currency}`
                            : "Not available"}
                        </div>
                        <span className="text-[10px] text-gray-400 block">
                          {path.est_out_of_pocket ? "From verified tariff & policy" : "Requires verified tariff & policy fields"}
                        </span>
                      </div>

                      {path.emergency ? (
                        <button
                          type="button"
                          onClick={() => setEmergency(true)}
                          className="px-4 py-2 bg-rose-600 hover:bg-rose-700 text-white text-xs font-semibold rounded-xl flex items-center gap-1 shadow-xs transition-colors"
                          aria-label="Emergency guidance"
                        >
                          Emergency guidance
                          <ChevronRight className="w-3.5 h-3.5" />
                        </button>
                      ) : (
                        <button
                          type="button"
                          disabled={!path.coverage_id}
                          onClick={() => setSelected(path)}
                          className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 disabled:bg-gray-200 disabled:text-gray-500 text-white text-xs font-semibold rounded-xl flex items-center gap-1 shadow-xs transition-colors"
                          aria-label="Select this pathway"
                        >
                          Select this pathway
                          <ChevronRight className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                  </article>
                ))}
              </div>
            )}

            {result && (result.uncertainties?.length ?? 0) > 0 && (
              <div className="bg-amber-50/70 rounded-2xl border border-amber-200 p-4 space-y-3">
                <div className="flex items-center justify-between gap-2">
                  <h3 className="text-xs font-bold uppercase tracking-wider text-amber-900">
                    Questions to verify before treatment
                  </h3>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => void copyQuestions()}
                      className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-white border border-amber-300 text-amber-900 text-xs font-semibold"
                    >
                      <Copy className="w-3.5 h-3.5" />
                      {copied ? "Copied" : "Copy questions"}
                    </button>
                    <button
                      type="button"
                      disabled={preparingInquiry}
                      onClick={() => void handlePrepareClarification("policy_clarification_inquiry")}
                      className="px-2.5 py-1 rounded-lg bg-amber-900 text-white text-xs font-semibold disabled:opacity-50"
                    >
                      {preparingInquiry ? "Preparing..." : "Prepare insurer inquiry"}
                    </button>
                  </div>
                </div>
                <ul className="space-y-2 text-xs text-amber-950">
                  {result.uncertainties?.map((q) => (
                    <li key={q.code} className="bg-white/80 rounded-xl p-2.5 border border-amber-100">
                      <p className="font-semibold">{q.label}</p>
                      {q.steps?.length ? (
                        <ul className="list-disc list-inside text-amber-900 mt-1 space-y-0.5">
                          {q.steps.map((s, idx) => (
                            <li key={idx}>{s}</li>
                          ))}
                        </ul>
                      ) : null}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </section>
        </main>

        <aside className="lg:col-span-4 space-y-5">
          <div className="bg-white rounded-2xl border border-gray-200/80 p-5 shadow-xs space-y-3.5">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-bold text-gray-900">Your current context</h3>
              <Link href="/profile" className="text-xs font-semibold text-emerald-700 hover:underline">
                Edit
              </Link>
            </div>

            <div className="space-y-3 text-xs">
              <div className="flex items-start gap-2.5">
                <MapPin className="w-4 h-4 text-sky-500 shrink-0 mt-0.5" />
                <div>
                  <span className="text-gray-400 block text-[11px]">Location</span>
                  <span className="font-semibold text-gray-800">
                    {summary.context?.city ? `${summary.context.city}, ` : ""}
                    {summary.context?.country_label || country || "Not available"}
                  </span>
                </div>
              </div>

              <div className="flex items-start gap-2.5">
                <IdCard className="w-4 h-4 text-blue-500 shrink-0 mt-0.5" />
                <div>
                  <span className="text-gray-400 block text-[11px]">Occupation & Visa</span>
                  <span className="font-semibold text-gray-800">
                    {summary.context?.occupation_label || "Student"}
                    {summary.context?.visa_expiry_date ? ` (until ${summary.context.visa_expiry_date})` : ""}
                  </span>
                </div>
              </div>

              <div className="flex items-start gap-2.5">
                <FileCheck className="w-4 h-4 text-indigo-500 shrink-0 mt-0.5" />
                <div>
                  <span className="text-gray-400 block text-[11px]">Coverage period</span>
                  <span className="font-semibold text-gray-800">
                    {activeCoverage?.end_date ? `Until ${activeCoverage.end_date}` : "Not available"}
                  </span>
                </div>
              </div>

              <div className="flex items-center justify-between pt-1">
                <div className="flex items-center gap-2.5">
                  <ShieldCheck className="w-4 h-4 text-emerald-600 shrink-0" />
                  <div>
                    <span className="text-gray-400 block text-[11px]">Active coverage</span>
                    <span className="font-semibold text-gray-800">
                      {activeCoverage
                        ? `${activeCoverage.kind}${activeCoverage.provider ? ` · ${activeCoverage.provider}` : ""}`
                        : "Not available"}
                    </span>
                  </div>
                </div>
                <Link
                  href="/protection"
                  className="px-2.5 py-1 text-[11px] font-semibold text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-lg transition-colors"
                >
                  View
                </Link>
              </div>
            </div>
          </div>

          {employerOverview && (country === "ID" || (employerOverview.user_declared_policies?.length ?? 0) > 0) && (
            <div
              className="bg-white rounded-2xl border border-gray-200/80 p-5 shadow-xs space-y-3"
              data-testid="employer-coordination-panel"
            >
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-bold text-gray-900">Benefit coordination</h3>
                <span className="bg-amber-50 text-amber-800 text-[10px] font-bold px-2 py-0.5 rounded-full border border-amber-200">
                  {employerOverview.coordination ?? "UNKNOWN"}
                </span>
              </div>
              <div className="flex items-start gap-3">
                <div className="w-8 h-8 rounded-full bg-amber-50 flex items-center justify-center shrink-0 text-amber-700 mt-0.5">
                  <Stethoscope className="w-4 h-4" />
                </div>
                <div className="text-xs space-y-2">
                  <p className="text-gray-600">
                    {employerOverview.coordination_principles?.summary ||
                      "Coordination of benefits between public and employer policies is unknown until verified from policy evidence."}
                  </p>
                  <button
                    type="button"
                    disabled={preparingInquiry}
                    onClick={() => void handlePrepareClarification("employer_benefit_inquiry")}
                    className="px-3 py-1.5 rounded-xl bg-teal-700 hover:bg-teal-800 text-white text-xs font-semibold disabled:opacity-50"
                  >
                    {preparingInquiry ? "Preparing..." : "Prepare benefit clarification"}
                  </button>
                </div>
              </div>
            </div>
          )}

          <div className="bg-rose-50/70 border border-rose-200/80 rounded-2xl p-4 flex items-center justify-between gap-3 text-rose-950">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-xl bg-rose-100 flex items-center justify-center shrink-0">
                <AlertTriangle className="w-5 h-5 text-rose-600" />
              </div>
              <div className="text-xs">
                <span className="font-bold block text-rose-950">Is this an emergency?</span>
                <span className="text-rose-700 text-[11px]">
                  View verified local emergency numbers or go to the nearest ER.
                </span>
              </div>
            </div>
            <Link
              href="/emergency"
              className="text-rose-700 hover:text-rose-900 font-semibold text-xs flex items-center gap-1"
              aria-label="Open emergency guidance"
            >
              Emergency
              <ChevronRight className="w-4 h-4" />
            </Link>
          </div>
        </aside>
      </div>
    </div>
  );
}
