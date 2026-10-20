"use client";

import { useCallback, useEffect, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import {
  Building2,
  Calendar,
  Info,
  RefreshCw,
  Scale,
  ShieldAlert,
  ChevronRight,
  Sparkles,
} from "lucide-react";
import { useAuth } from "@/lib/auth";
import { useActor } from "@/lib/actor";
import { getWorkflowHeaders, getWorkflowUrl } from "@/lib/api/workflow-client";
import { ManageEmployerBenefitsModal } from "@/components/employer-benefits/manage-employer-benefits-modal";

interface BenefitItem {
  benefit_category: string;
  coverage_status: "Covered" | "Partial" | "Not covered" | "Unknown";
  limit_amount: string | null;
  limit_numeric: number | null;
  used_amount: string | null;
  used_numeric: number | null;
  available_balance: string | null;
  available_numeric: number | null;
  details: string | null;
  utilization_status: "VERIFIED" | "UNKNOWN";
}

interface OverlapItem {
  category: string;
  employer_coverage: string;
  public_coverage: string | null;
  personal_coverage: string | null;
  coordination_status: "PRIMARY" | "SECONDARY" | "SUPPLEMENTARY" | "POTENTIAL_OVERLAP" | "UNKNOWN";
  notes: string;
}

interface ContinuityIssue {
  issue_type: string;
  severity: "LOW" | "MEDIUM" | "HIGH";
  description: string;
  recommendation: string;
}

interface EmployerBenefitsData {
  has_employer_coverage?: boolean;
  company_name: string;
  employment_status: string;
  employment_period: string;
  is_active: boolean;
  plan_name: string;
  insurer_name: string | null;
  policy_number: string | null;
  coverage_period: string | null;
  eligible_dependents: string[];
  coverage_score_percent: number;
  coverage_status_label: string;
  coverage_status_summary: string;
  counts: {
    Covered: number;
    Partial: number;
    "Not covered": number;
    Unknown: number;
  };
  key_benefits: BenefitItem[];
  claim_procedure: {
    cashless: boolean;
    reimbursement: boolean;
    cashless_desc: string;
    reimbursement_desc: string;
  };
  overlaps: OverlapItem[];
  continuity_issues: ContinuityIssue[];
  ai_guidance: string[];
  verification_status: string;
  has_custom_data: boolean;
}

export default function EmployerBenefitsPage() {
  const { token: accountToken } = useAuth();
  const { demo, headers: actorHeaders } = useActor();

  // Active Tab: "Overview" | "Benefits & Details" | "Utilization" | "Coordination & Overlap"
  const [activeTab, setActiveTab] = useState<
    "Overview" | "Benefits & Details" | "Utilization" | "Coordination & Overlap"
  >("Overview");

  const [data, setData] = useState<EmployerBenefitsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);

  // Country detection
  const isChina =
    demo?.profile?.country_code === "CN" ||
    demo?.profile?.display_name?.toLowerCase().includes("raka");
  const targetCountry = isChina ? "CN" : "ID";

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const headers = getWorkflowHeaders(accountToken);
      if (actorHeaders?.["X-Demo-Session"]) {
        headers["X-Demo-Session"] = actorHeaders["X-Demo-Session"];
      }

      const res = await fetch(
        getWorkflowUrl(
          `/api/v1/workflow/employer-benefits/overview?country_code=${targetCountry}`
        ),
        { headers }
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const result: EmployerBenefitsData = await res.json();
      setData(result);
    } catch (err) {
      console.error("Error loading employer benefits:", err);
    } finally {
      setLoading(false);
    }
  }, [targetCountry, accountToken, actorHeaders]);

  useEffect(() => {
    void Promise.resolve().then(loadData);
  }, [loadData]);

  const hasEmployerCoverage = Boolean(
    data?.has_employer_coverage && data?.company_name && data.company_name !== "-"
  );

  return (
    <div className="w-full max-w-7xl mx-auto px-4 py-8 text-slate-900 space-y-6">
      {/* Top Breadcrumb & Title */}
      <div className="space-y-1">
        <Link
          href="/home"
          className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-500 hover:text-teal-700 transition-colors mb-2"
        >
          <span className="text-sm">←</span> My Protection
        </Link>
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <h1 className="text-3xl font-extrabold text-slate-900 tracking-tight flex items-center gap-3">
              Employer Benefits
            </h1>
            <p className="text-xs text-slate-500 mt-1">
              See your employer insurance benefits, eligibility, and how they work with your other policies.
            </p>
          </div>

          {/* Top Employer Pill Badge (shown only when coverage is active) */}
          {data && hasEmployerCoverage && (
            <div className="flex flex-wrap items-center gap-3 bg-white p-2.5 px-4 rounded-2xl border border-slate-200 shadow-2xs">
              <div className="w-8 h-8 rounded-xl bg-blue-50 text-blue-700 font-extrabold text-sm flex items-center justify-center border border-blue-100">
                {data.company_name.substring(0, 2).toUpperCase()}
              </div>
              <div className="text-left">
                <span className="text-xs font-bold text-slate-800 block">
                  {data.company_name}
                </span>
                <span className="text-[10px] text-slate-400">Current employer</span>
              </div>
              <div className="h-5 w-px bg-slate-200 mx-1" />
              <div className="text-left">
                <span className="text-[10px] text-slate-400 block">Employment period</span>
                <span className="text-xs font-semibold text-slate-700 flex items-center gap-1.5">
                  <Calendar className="w-3.5 h-3.5 text-teal-600" />
                  {data.employment_period || "Active"}
                </span>
              </div>
              <span className="bg-emerald-50 text-emerald-700 border border-emerald-200 text-[10px] font-bold px-2 py-0.5 rounded-full flex items-center gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                Active
              </span>
            </div>
          )}
        </div>
      </div>

      {/* Tabs (shown only when employer benefits are connected) */}
      {hasEmployerCoverage && (
        <div className="flex border-b border-slate-200 gap-8 text-xs font-bold">
          {[
            "Overview",
            "Benefits & Details",
            "Utilization",
            "Coordination & Overlap",
          ].map((tab) => (
            <button
              key={tab}
              type="button"
              onClick={() =>
                setActiveTab(
                  tab as
                    | "Overview"
                    | "Benefits & Details"
                    | "Utilization"
                    | "Coordination & Overlap"
                )
              }
              className={`pb-3.5 relative transition-colors ${
                activeTab === tab
                  ? "text-teal-800 font-extrabold"
                  : "text-slate-500 hover:text-slate-800"
              }`}
            >
              {tab}
              {activeTab === tab && (
                <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-teal-700 rounded-full" />
              )}
            </button>
          ))}
        </div>
      )}

      {loading && (
        <div className="py-24 text-center text-slate-400">
          <RefreshCw className="animate-spin inline-block text-teal-700 mb-2" size={32} />
          <p className="text-sm font-semibold">Loading employer protection overview...</p>
        </div>
      )}

      {/* EMPTY STATE FOR USERS WITHOUT EMPLOYER COVERAGE */}
      {!loading && data && !hasEmployerCoverage && (
        <div className="bg-white border border-slate-200 rounded-3xl p-8 sm:p-12 shadow-xs space-y-8">
          <div className="flex flex-col md:flex-row items-center justify-between gap-8">
            <div className="space-y-4 max-w-xl text-center md:text-left">
              <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-teal-50 border border-teal-200 text-teal-800 text-xs font-bold">
                <Building2 className="w-3.5 h-3.5 text-teal-700" />
                <span>Employer Insurance Not Connected</span>
              </div>
              <h2 className="text-2xl sm:text-3xl font-extrabold text-slate-900 tracking-tight">
                Connect Your Corporate / Employer Insurance
              </h2>
              <p className="text-sm text-slate-600 leading-relaxed">
                You haven&apos;t linked employer health benefits yet. Upload your employee benefit handbook or policy document to monitor inpatient, outpatient, deductibles, plus benefit coordination (CoB) with national insurance without fabricated data.
              </p>
              <div className="flex flex-wrap items-center justify-center md:justify-start gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setModalOpen(true)}
                  className="px-5 py-3 bg-teal-700 hover:bg-teal-800 text-white text-xs font-bold rounded-2xl shadow-sm hover:shadow transition-all flex items-center gap-2"
                >
                  <Building2 className="w-4 h-4" />
                  Upload Policy / Connect Employer Insurance
                </button>
                <button
                  type="button"
                  onClick={() => setModalOpen(true)}
                  className="px-5 py-3 bg-white border border-slate-200 hover:border-slate-400 text-slate-700 text-xs font-bold rounded-2xl transition-all"
                >
                  Enter Benefits Manually
                </button>
              </div>
            </div>

            {/* Mascot Artwork */}
            <div className="relative w-56 h-56 sm:w-64 sm:h-64 shrink-0 flex items-center justify-center">
              <div className="absolute inset-0 rounded-full bg-gradient-to-tr from-teal-100/70 to-blue-50/70 blur-md" />
              <Image
                src="/protection-hero-person.png"
                alt="INSSURA Mascot"
                width={210}
                height={210}
                className="object-contain relative z-10 drop-shadow-md"
                priority
              />
            </div>
          </div>

          {/* Three Key Pillar Cards */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-5 pt-6 border-t border-slate-100">
            <div className="p-5 rounded-2xl bg-slate-50 border border-slate-200/80 space-y-2">
              <span className="w-8 h-8 rounded-xl bg-teal-100 text-teal-800 flex items-center justify-center font-bold text-xs">
                01
              </span>
              <h4 className="text-sm font-bold text-slate-900">Comprehensive Benefit Limits</h4>
              <p className="text-xs text-slate-500 leading-relaxed">
                Detailed mapping of inpatient, outpatient, dental, optical, and maternity coverage limits directly from your company policy schedule.
              </p>
            </div>

            <div className="p-5 rounded-2xl bg-slate-50 border border-slate-200/80 space-y-2">
              <span className="w-8 h-8 rounded-xl bg-blue-100 text-blue-800 flex items-center justify-center font-bold text-xs">
                02
              </span>
              <h4 className="text-sm font-bold text-slate-900">Coordination of Benefits (CoB)</h4>
              <p className="text-xs text-slate-500 leading-relaxed">
                Automated overlap detection between employer corporate coverage and national insurance to maximize valid reimbursement.
              </p>
            </div>

            <div className="p-5 rounded-2xl bg-slate-50 border border-slate-200/80 space-y-2">
              <span className="w-8 h-8 rounded-xl bg-amber-100 text-amber-800 flex items-center justify-center font-bold text-xs">
                03
              </span>
              <h4 className="text-sm font-bold text-slate-900">Non-Fabricated Balance Audit</h4>
              <p className="text-xs text-slate-500 leading-relaxed">
                Strict INSURRA compliance: utilization and remaining balance are only displayed when verified from actual claim data.
              </p>
            </div>
          </div>
        </div>
      )}

      {!loading && data && hasEmployerCoverage && (
        <div className="space-y-6">
          {/* TAB 1: OVERVIEW */}
          {activeTab === "Overview" && (
            <div className="space-y-6">
              {/* Row 1: Employer coverage overview card & Coverage status donut */}
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                {/* Left Card: Employer Coverage Overview with Mascot Banner */}
                <div className="lg:col-span-2 relative overflow-hidden bg-white border border-slate-200 rounded-3xl p-7 shadow-xs flex flex-col justify-between">
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <h2 className="text-base font-bold text-slate-900">
                        Employer coverage overview
                      </h2>
                      <p className="text-xs text-slate-500 mt-0.5">
                        Group health insurance provided by {data.company_name}.
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => setModalOpen(true)}
                      className="px-4 py-2 bg-white border border-slate-200 hover:border-teal-600 hover:text-teal-700 text-slate-700 text-xs font-bold rounded-xl shadow-2xs transition-all flex items-center gap-1.5"
                    >
                      <Building2 className="w-3.5 h-3.5 text-teal-700" />
                      Manage Employer Benefits
                    </button>
                  </div>

                  {/* Plan Information & Mascot Artwork */}
                  <div className="mt-6 flex flex-col sm:flex-row items-center justify-between gap-6">
                    <div className="space-y-2.5 text-xs text-slate-600 flex-1 w-full">
                      <div className="flex items-center gap-2 mb-3">
                        <div className="w-9 h-9 rounded-xl bg-blue-600 text-white font-black text-base flex items-center justify-center shadow-xs">
                          {data.company_name.substring(0, 1)}
                        </div>
                        <div>
                          <span className="font-bold text-slate-900 block text-sm">
                            {data.company_name}
                          </span>
                          <span className="text-[10px] text-teal-700 font-semibold bg-teal-50 px-2 py-0.5 rounded-full inline-block">
                            Group Health Insurance
                          </span>
                        </div>
                      </div>

                      <div className="grid grid-cols-2 gap-y-2 pt-1 border-t border-slate-100">
                        <span className="text-slate-400">Plan name</span>
                        <span className="font-bold text-slate-800 text-right sm:text-left">
                          {data.plan_name || "-"}
                        </span>

                        <span className="text-slate-400">Insurer</span>
                        <span className="font-bold text-slate-800 text-right sm:text-left">
                          {data.insurer_name || "-"}
                        </span>

                        <span className="text-slate-400">Policy number</span>
                        <span className="font-mono text-slate-800 text-right sm:text-left">
                          {data.policy_number || "-"}
                        </span>

                        <span className="text-slate-400">Coverage period</span>
                        <span className="font-medium text-slate-800 text-right sm:text-left">
                          {data.coverage_period || "-"}
                        </span>

                        <span className="text-slate-400">Eligible members</span>
                        <span className="font-medium text-slate-800 text-right sm:text-left">
                          {data.eligible_dependents?.length > 0
                            ? data.eligible_dependents.join(", ")
                            : "-"}
                        </span>
                      </div>
                    </div>

                    {/* Mascot Artwork Container */}
                    <div className="relative w-44 h-44 sm:w-52 sm:h-52 shrink-0 flex items-center justify-center">
                      <div className="absolute inset-0 rounded-full bg-gradient-to-tr from-teal-100/60 to-blue-50/60 blur-xs" />
                      <Image
                        src="/protection-hero-person.png"
                        alt="INSSURA Corporate Mascot"
                        width={190}
                        height={190}
                        className="object-contain relative z-10 drop-shadow-md"
                        priority
                      />
                    </div>
                  </div>
                </div>

                {/* Right Card: Coverage Status Donut & Counts */}
                <div className="bg-white border border-slate-200 rounded-3xl p-7 shadow-xs flex flex-col justify-between">
                  <div>
                    <div className="flex items-center justify-between mb-4">
                      <h3 className="text-base font-bold text-slate-900">Coverage status</h3>
                      <span className="text-[10px] text-slate-400 font-medium">
                        (based on verified terms)
                      </span>
                    </div>

                    <div className="flex items-center gap-5 my-4">
                      {/* Radial Progress Ring */}
                      <div className="relative w-24 h-24 shrink-0 flex items-center justify-center">
                        <svg className="w-full h-full -rotate-90" viewBox="0 0 36 36">
                          <path
                            className="text-slate-100"
                            strokeWidth="3.5"
                            stroke="currentColor"
                            fill="none"
                            d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
                          />
                          <path
                            className="text-teal-600 transition-all duration-1000 ease-out"
                            strokeDasharray={`${data.coverage_score_percent}, 100`}
                            strokeWidth="3.5"
                            strokeLinecap="round"
                            stroke="currentColor"
                            fill="none"
                            d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
                          />
                        </svg>
                        <div className="absolute flex flex-col items-center justify-center">
                          <span className="text-xl font-extrabold text-slate-900">
                            {data.coverage_score_percent}%
                          </span>
                        </div>
                      </div>

                      <div className="space-y-1">
                        <h4 className="text-sm font-bold text-slate-900">
                          {data.coverage_status_label}
                        </h4>
                        <p className="text-xs text-slate-500 leading-snug">
                          {data.coverage_status_summary}
                        </p>
                      </div>
                    </div>
                  </div>

                  {/* Benefit breakdown pills */}
                  <div className="grid grid-cols-2 gap-2 pt-4 border-t border-slate-100 text-[11px] font-semibold">
                    <div className="flex items-center gap-1.5 text-emerald-800 bg-emerald-50 px-2.5 py-1.5 rounded-xl">
                      <span className="w-2 h-2 rounded-full bg-emerald-600" />
                      {data.counts?.Covered ?? 0} Covered
                    </div>
                    <div className="flex items-center gap-1.5 text-amber-800 bg-amber-50 px-2.5 py-1.5 rounded-xl">
                      <span className="w-2 h-2 rounded-full bg-amber-500" />
                      {data.counts?.Partial ?? 0} Partial coverage
                    </div>
                    <div className="flex items-center gap-1.5 text-rose-800 bg-rose-50 px-2.5 py-1.5 rounded-xl">
                      <span className="w-2 h-2 rounded-full bg-rose-500" />
                      {data.counts?.["Not covered"] ?? 0} Not covered
                    </div>
                    <div className="flex items-center gap-1.5 text-slate-700 bg-slate-100 px-2.5 py-1.5 rounded-xl">
                      <span className="w-2 h-2 rounded-full bg-slate-400" />
                      {data.counts?.Unknown ?? 0} Unknown
                    </div>
                  </div>
                </div>
              </div>

              {/* Row 2: Key benefits from your employer plan (Cards Carousel / Grid) */}
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-bold text-slate-900">
                    Key benefits from your employer plan
                  </h3>
                  <button
                    type="button"
                    onClick={() => setActiveTab("Benefits & Details")}
                    className="text-xs font-bold text-teal-700 hover:text-teal-800 flex items-center gap-1"
                  >
                    View all benefits <ChevronRight className="w-3.5 h-3.5" />
                  </button>
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
                  {data.key_benefits.map((b) => (
                    <div
                      key={b.benefit_category}
                      className="bg-white border border-slate-200/80 rounded-2xl p-4 shadow-2xs hover:border-slate-300 hover:shadow-xs transition-all flex flex-col justify-between"
                    >
                      <div>
                        <div className="flex items-center justify-between mb-2">
                          <span className="text-xs font-bold text-slate-800 capitalize">
                            {b.benefit_category} care
                          </span>
                          <span
                            className={`text-[9px] font-bold px-1.5 py-0.5 rounded-full ${
                              b.coverage_status === "Covered"
                                ? "bg-emerald-100 text-emerald-800"
                                : b.coverage_status === "Partial"
                                ? "bg-amber-100 text-amber-800"
                                : "bg-rose-100 text-rose-800"
                            }`}
                          >
                            {b.coverage_status}
                          </span>
                        </div>
                        <span className="text-[10px] text-slate-400 block mb-0.5">Limit</span>
                        <p className="text-xs font-extrabold text-slate-900 truncate">
                          {b.limit_amount || "-"}
                        </p>
                      </div>

                      <div className="mt-3 pt-2 border-t border-slate-100 text-[10px] text-slate-500 truncate">
                        {b.details || "As per plan"}
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Row 3: Benefits Summary Table with Utilization */}
              <div className="bg-white border border-slate-200 rounded-3xl p-6 shadow-xs space-y-4">
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="text-sm font-bold text-slate-900">
                      Benefits and Utilization Overview
                    </h3>
                    <p className="text-xs text-slate-500">
                      Main benefits provided under your employer plan. Utilization is shown only if verified.
                    </p>
                  </div>
                </div>

                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs">
                    <thead className="bg-slate-50 text-slate-600 font-bold uppercase text-[10px] border-y border-slate-200">
                      <tr>
                        <th className="py-3 px-4">Benefit category</th>
                        <th className="py-3 px-4">Coverage status</th>
                        <th className="py-3 px-4">Limit</th>
                        <th className="py-3 px-4">Used amount</th>
                        <th className="py-3 px-4">Available balance</th>
                        <th className="py-3 px-4">Details</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {data.key_benefits.map((b) => (
                        <tr key={b.benefit_category} className="hover:bg-slate-50/60 transition-colors">
                          <td className="py-3.5 px-4 font-bold text-slate-800 capitalize flex items-center gap-2">
                            <span className="w-2 h-2 rounded-full bg-teal-600" />
                            {b.benefit_category} care
                          </td>
                          <td className="py-3.5 px-4">
                            <span
                              className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                                b.coverage_status === "Covered"
                                  ? "bg-emerald-100 text-emerald-800"
                                  : b.coverage_status === "Partial"
                                  ? "bg-amber-100 text-amber-800"
                                  : "bg-rose-100 text-rose-800"
                              }`}
                            >
                              {b.coverage_status}
                            </span>
                          </td>
                          <td className="py-3.5 px-4 font-semibold text-slate-900">
                            {b.limit_amount || "-"}
                          </td>
                          <td className="py-3.5 px-4">
                            {b.utilization_status === "VERIFIED" && b.used_amount ? (
                              <span className="font-semibold text-slate-900">{b.used_amount}</span>
                            ) : (
                              <span className="text-slate-400 font-medium">Unknown</span>
                            )}
                          </td>
                          <td className="py-3.5 px-4">
                            {b.utilization_status === "VERIFIED" && b.available_balance ? (
                              <span className="font-bold text-teal-700">{b.available_balance}</span>
                            ) : (
                              <span className="text-slate-400 font-medium">Unknown</span>
                            )}
                          </td>
                          <td className="py-3.5 px-4 text-slate-500 max-w-xs truncate">
                            {b.details || "-"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                <div className="p-3 bg-slate-50 rounded-2xl border border-slate-200/80 text-[11px] text-slate-600 flex items-start gap-2">
                  <Info className="w-4 h-4 text-teal-700 shrink-0 mt-0.5" />
                  <span>
                    <strong>Utilization Verification Rule:</strong> In compliance with INSURRA regulations,
                    utilization and remaining limits are only computed when actual usage is verified
                    from claim receipts. Without real evidence, the status remains <em>Unknown</em>.
                  </span>
                </div>
              </div>
            </div>
          )}

          {/* TAB 2: BENEFITS & DETAILS */}
          {activeTab === "Benefits & Details" && (
            <div className="space-y-6">
              <div className="bg-white border border-slate-200 rounded-3xl p-7 shadow-xs space-y-6">
                <div>
                  <h3 className="text-base font-bold text-slate-900">
                    Comprehensive Schedule of Benefits
                  </h3>
                  <p className="text-xs text-slate-500">
                    Detailed entitlements and claim procedures for each benefit category.
                  </p>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {data.key_benefits.map((b) => (
                    <div
                      key={b.benefit_category}
                      className="border border-slate-200 rounded-2xl p-5 bg-white space-y-3"
                    >
                      <div className="flex items-center justify-between">
                        <span className="text-sm font-bold text-slate-900 capitalize">
                          {b.benefit_category} care
                        </span>
                        <span
                          className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                            b.coverage_status === "Covered"
                              ? "bg-emerald-100 text-emerald-800"
                              : b.coverage_status === "Partial"
                              ? "bg-amber-100 text-amber-800"
                              : "bg-rose-100 text-rose-800"
                          }`}
                        >
                          {b.coverage_status}
                        </span>
                      </div>

                      <div className="space-y-1.5 text-xs">
                        <div className="flex justify-between text-slate-600">
                          <span>Annual Limit:</span>
                          <span className="font-bold text-slate-900">{b.limit_amount || "-"}</span>
                        </div>
                        <div className="flex justify-between text-slate-600">
                          <span>Claim Procedure:</span>
                          <span className="font-semibold text-slate-800">
                            {data.claim_procedure.cashless ? "Cashless & Reimbursement" : "Reimbursement only"}
                          </span>
                        </div>
                        <div className="flex justify-between text-slate-600">
                          <span>Coverage Notes:</span>
                          <span className="text-slate-700 text-right">{b.details || "-"}</span>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Claim Procedures (REG-58) */}
              <div className="bg-white border border-slate-200 rounded-3xl p-7 shadow-xs space-y-4">
                <h3 className="text-base font-bold text-slate-900">
                  Cashless & Reimbursement Procedures
                </h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div className="bg-teal-50/40 border border-teal-200 rounded-2xl p-5 space-y-2">
                    <span className="text-xs font-bold text-teal-800 uppercase tracking-wider block">
                      1. Cashless Procedure
                    </span>
                    <p className="text-xs text-slate-700 leading-relaxed">
                      {data.claim_procedure.cashless_desc}
                    </p>
                    <ul className="text-xs text-slate-600 list-disc list-inside space-y-1 pt-2">
                      <li>Available at all network hospitals and partner clinics.</li>
                      <li>Must present physical insurance card or digital e-card from app.</li>
                      <li>Non-medical excess or co-pay is settled directly upon discharge.</li>
                    </ul>
                  </div>

                  <div className="bg-slate-50 border border-slate-200 rounded-2xl p-5 space-y-2">
                    <span className="text-xs font-bold text-slate-800 uppercase tracking-wider block">
                      2. Reimbursement Procedure
                    </span>
                    <p className="text-xs text-slate-700 leading-relaxed">
                      {data.claim_procedure.reimbursement_desc}
                    </p>
                    <ul className="text-xs text-slate-600 list-disc list-inside space-y-1 pt-2">
                      <li>Original receipts and itemized breakdown of medical services and pharmacy.</li>
                      <li>Medical summary or signed physician claim statement.</li>
                      <li>Submission deadline is maximum 30 calendar days following treatment date.</li>
                    </ul>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* TAB 3: UTILIZATION */}
          {activeTab === "Utilization" && (
            <div className="space-y-6">
              <div className="bg-white border border-slate-200 rounded-3xl p-7 shadow-xs space-y-6">
                <div>
                  <h3 className="text-base font-bold text-slate-900">
                    Benefit Utilization & Remaining Balance
                  </h3>
                  <p className="text-xs text-slate-500">
                    Deterministic calculation of verified usages. Balances are strictly locked to real claims.
                  </p>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                  {data.key_benefits.map((b) => (
                    <div
                      key={b.benefit_category}
                      className="border border-slate-200 rounded-2xl p-5 bg-slate-50/50 space-y-3"
                    >
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-bold text-slate-900 capitalize">
                          {b.benefit_category} care
                        </span>
                        <span
                          className={`text-[9px] font-bold px-2 py-0.5 rounded-full ${
                            b.utilization_status === "VERIFIED"
                              ? "bg-teal-100 text-teal-800"
                              : "bg-slate-200 text-slate-600"
                          }`}
                        >
                          {b.utilization_status === "VERIFIED" ? "VERIFIED USAGE" : "UNKNOWN USAGE"}
                        </span>
                      </div>

                      <div className="space-y-2 text-xs pt-2">
                        <div className="flex justify-between">
                          <span className="text-slate-500">Total Limit:</span>
                          <span className="font-bold text-slate-900">{b.limit_amount || "-"}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-slate-500">Used Amount:</span>
                          <span className="font-semibold text-slate-800">
                            {b.utilization_status === "VERIFIED" ? b.used_amount : "Unknown"}
                          </span>
                        </div>
                        <div className="flex justify-between pt-2 border-t border-slate-200">
                          <span className="text-slate-600 font-bold">Remaining Balance:</span>
                          <span
                            className={`font-extrabold ${
                              b.utilization_status === "VERIFIED" ? "text-teal-700" : "text-slate-400"
                            }`}
                          >
                            {b.utilization_status === "VERIFIED" ? b.available_balance : "Unknown"}
                          </span>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* TAB 4: COORDINATION & OVERLAP */}
          {activeTab === "Coordination & Overlap" && (
            <div className="space-y-6">
              {/* Coordination of Benefits (COB) Overlap Matrix */}
              <div className="bg-white border border-slate-200 rounded-3xl p-7 shadow-xs space-y-6">
                <div>
                  <div className="flex items-center gap-2 mb-1">
                    <Scale className="w-5 h-5 text-teal-700" />
                    <h3 className="text-base font-bold text-slate-900">
                      Multi-Tier Benefit Comparison & Potential Overlap
                    </h3>
                  </div>
                  <p className="text-xs text-slate-500">
                    Compare employer group plan with public health insurance (BPJS) and personal coverage to identify duplicate benefits.
                  </p>
                </div>

                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs">
                    <thead className="bg-slate-50 text-slate-600 font-bold uppercase text-[10px] border-y border-slate-200">
                      <tr>
                        <th className="py-3 px-4">Benefit category</th>
                        <th className="py-3 px-4">Employer insurance</th>
                        <th className="py-3 px-4">Public insurance (BPJS)</th>
                        <th className="py-3 px-4">Coordination status</th>
                        <th className="py-3 px-4">Notes & trade-offs</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {data.overlaps.map((item) => (
                        <tr key={item.category} className="hover:bg-slate-50/60 transition-colors">
                          <td className="py-3.5 px-4 font-bold text-slate-800">{item.category}</td>
                          <td className="py-3.5 px-4 font-medium text-slate-700">{item.employer_coverage}</td>
                          <td className="py-3.5 px-4 text-slate-700">{item.public_coverage || "None"}</td>
                          <td className="py-3.5 px-4">
                            <span
                              className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                                item.coordination_status === "POTENTIAL_OVERLAP"
                                  ? "bg-amber-100 text-amber-800"
                                  : item.coordination_status === "PRIMARY"
                                  ? "bg-teal-100 text-teal-800"
                                  : "bg-slate-100 text-slate-700"
                              }`}
                            >
                              {item.coordination_status}
                            </span>
                          </td>
                          <td className="py-3.5 px-4 text-slate-500 max-w-sm">{item.notes}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Continuity and Employment Changes (REG-59) */}
              <div className="bg-white border border-slate-200 rounded-3xl p-7 shadow-xs space-y-4">
                <div className="flex items-center gap-2">
                  <ShieldAlert className="w-5 h-5 text-amber-600" />
                  <h3 className="text-base font-bold text-slate-900">
                    Benefit Continuity & Employment Change Risks
                  </h3>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {data.continuity_issues.map((ci, idx) => (
                    <div
                      key={idx}
                      className="p-4 rounded-2xl bg-amber-50/40 border border-amber-200 space-y-2 text-xs"
                    >
                      <div className="flex items-center justify-between">
                        <span className="font-bold text-amber-900">{ci.issue_type}</span>
                        <span className="text-[10px] font-bold bg-amber-100 text-amber-800 px-2 py-0.5 rounded-full">
                          {ci.severity} RISK
                        </span>
                      </div>
                      <p className="text-slate-700 leading-relaxed">{ci.description}</p>
                      <div className="pt-2 border-t border-amber-100 text-slate-600 font-medium">
                        <strong>Rekomendasi:</strong> {ci.recommendation}
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Grounded AI Guidance (REG-60) */}
              <div className="bg-teal-900 text-white rounded-3xl p-7 shadow-lg space-y-4 relative overflow-hidden">
                <div className="flex items-center gap-2">
                  <Sparkles className="w-5 h-5 text-teal-300" />
                  <h3 className="text-base font-bold text-white tracking-tight">
                    Evidence-Based Benefit Usage Guidance
                  </h3>
                </div>
                <p className="text-xs text-teal-100/90 max-w-2xl">
                  Grounded coordination recommendations generated by INSSURA Employer Benefits & Coordination Intelligence:
                </p>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-2">
                  {data.ai_guidance.map((point, idx) => (
                    <div
                      key={idx}
                      className="bg-teal-800/60 border border-teal-700/60 p-4 rounded-2xl flex items-start gap-3"
                    >
                      <div className="w-6 h-6 rounded-full bg-teal-700 text-teal-200 text-xs font-bold flex items-center justify-center shrink-0 mt-0.5">
                        {idx + 1}
                      </div>
                      <p className="text-xs text-teal-50 leading-relaxed">{point}</p>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Modal for Manage Employer Benefits */}
      <ManageEmployerBenefitsModal
        key={`${modalOpen}-${Boolean(data?.has_employer_coverage)}-${data?.company_name || ""}`}
        isOpen={modalOpen}
        onClose={() => setModalOpen(false)}
        accountToken={accountToken}
        initialData={data}
        onSuccess={() => {
          void loadData();
        }}
      />
    </div>
  );
}
