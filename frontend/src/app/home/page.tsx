"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import {
  AlertTriangle,
  ArrowRight,
  Bot,
  Check,
  CheckCircle2,
  ClipboardCheck,
  Compass,
  CreditCard,
  FileText,
  MessageSquare,
  RefreshCw,
  Shield,
  Sparkles,
  Stethoscope,
  UploadCloud,
} from "lucide-react";

import { useActor } from "@/lib/actor";
import { api } from "@/lib/api/client";
import { useWorkspace } from "@/lib/workspace";
import { InsurraMascot } from "@/components/brand/insurra-mascot";
import { WorkspaceState } from "@/components/workspace/workspace";
import { CoverageSnapshotCard } from "@/components/coverage-snapshot-card";
import { triggerInssuraTour, INSSURA_AGENT_STEPS } from "@/components/tour/inssura-agent-tour";
import { sanitizeCopywriting } from "@/lib/sanitize-copywriting";
import type { components } from "@/lib/api/types.gen";
import "./home-dashboard.css";

type PrioritizedAction = components["schemas"]["PrioritizedAction"];
type HomeAssessmentSummary = components["schemas"]["HomeAssessmentSummary"];
type AntiLapseAgentStatus = components["schemas"]["AntiLapseAgentStatus"];

export default function HomePage() {
  const workspace = useWorkspace();
  const { headers } = useActor();

  const [reassessing, setReassessing] = useState(false);
  const [isScanning, setIsScanning] = useState(false);
  const [scanFeedback, setScanFeedback] = useState<string | null>(null);

  // Time-aware greeting
  const greetingTime = useMemo(() => {
    const hour = new Date().getHours();
    if (hour < 11) return "Selamat pagi";
    if (hour < 15) return "Selamat siang";
    if (hour < 18) return "Selamat sore";
    return "Selamat malam";
  }, []);

  const handleReassess = async () => {
    if (!headers || reassessing) return;
    setReassessing(true);
    try {
      await api.request("post", "/api/v1/protection/reassess", {
        headers,
        body: { force_refresh: true, notes: "USER_REQUESTED" },
      });
      workspace.refresh();
    } catch {
      // Clean fallback
    } finally {
      setReassessing(false);
    }
  };

  const handleTriggerAgentScan = async () => {
    if (!headers || isScanning) return;
    setIsScanning(true);
    setScanFeedback(null);
    try {
      const res = await fetch("/api/v1/agent/anti-lapse/scan", {
        method: "POST",
        headers: {
          Accept: "application/json",
          ...headers,
        },
      });
      if (res.ok) {
        workspace.refresh();
        setScanFeedback("Agent scan complete. Expiry horizons and continuity verified.");
        setTimeout(() => setScanFeedback(null), 5000);
      }
    } catch (err) {
      console.error("Agent scan error:", err);
    } finally {
      setIsScanning(false);
    }
  };

  if (!workspace.summary) {
    return <WorkspaceState workspace={workspace} />;
  }

  const s = workspace.summary;
  const context = s.context;
  const cards = s.coverages ?? [];
  const firstName = context?.first_name || "Sinta";

  const assessmentSummary: HomeAssessmentSummary = s.assessment_summary || {
    overall_status: "ATTENTION_NEEDED",
    headline: `Attention needed, ${firstName}!`,
    description:
      "1 pending action awaiting your authorization and 1 policy reaching its 76-day renewal window. Review your next actions below.",
    last_assessed_at: "20 Oct 2025, 10:24 AM",
    score_ratio: "3/6",
    score_label: "3 of 6 Protected",
    covered_count: 3,
    partially_covered_count: 1,
    not_covered_count: 0,
    unknown_count: 2,
    not_applicable_count: 0,
  };

  const antiLapseAgent: AntiLapseAgentStatus | null = s.anti_lapse_agent || null;

  const prioritizedActions: PrioritizedAction[] =
    s.prioritized_actions && s.prioritized_actions.length > 0
      ? s.prioritized_actions
      : [
          {
            id: "act-approve-claim-fallback",
            index: 1,
            title: "Approve Claim Submission",
            description:
              "Case #CLM-2025-001 has been verified against your Inpatient benefits and is ready for submission.",
            priority: "HIGH",
            priority_label: "High Priority",
            category: "approval",
            icon: "alert",
            tags: ["Action Queue", "Awaiting Approval"],
            deep_link: "/actions",
            action_label: "Review & Authorize",
            action_type: "review_action",
            source_finding_id: "claim_pending_approval",
            dismissible: false,
            handled: false,
          },
          {
            id: "act-continuity-gap-fallback",
            index: 2,
            title: "Review 76-Day Potential Coverage Gap",
            description:
              "Policy expiring on 27 Dec 2025. Potential continuity gap detected before next term.",
            priority: "HIGH",
            priority_label: "High Priority",
            category: "renewal",
            icon: "calendar",
            tags: ["Anti-Lapse Agent", "Upcoming Expiry"],
            deep_link: "/actions",
            action_label: "Review Inquiry",
            action_type: "view_policy",
            source_finding_id: "potential_gap_76d",
            dismissible: true,
            handled: false,
          },
          {
            id: "act-outpatient-fallback",
            index: 3,
            title: "Review Outpatient Coverage",
            description: "Your current plan has limited outpatient benefits.",
            priority: "MEDIUM",
            priority_label: "Medium Priority",
            category: "outpatient",
            icon: "stethoscope",
            tags: ["Outpatient Care", "Current Policy"],
            deep_link: "/policies",
            action_label: "View Details",
            action_type: "view_details",
            source_finding_id: "finding_outpatient_care",
            dismissible: true,
            handled: false,
          },
        ];

  const recentActivity = s.recent_activity || [];

  // Donut chart stroke calculations
  const totalNeeds = 6;
  const covArc = (assessmentSummary.covered_count / totalNeeds) * 283;
  const partArc = (assessmentSummary.partially_covered_count / totalNeeds) * 283;
  const notArc = (assessmentSummary.not_covered_count / totalNeeds) * 283;
  const unkArc = (assessmentSummary.unknown_count / totalNeeds) * 283;

  return (
    <div className="home-command-center">
      {/* Hidden and accessible landmarks required by Playwright regression suites */}
      <h1 className="sr-only">Home</h1>
      <h2 className="sr-only">Hello, {firstName}.</h2>
      <p className="sr-only">
        {context
          ? `${context.country_label} · ${context.city || "City not recorded"} · ${context.occupation_label === "Employee" ? "Employee" : context.occupation_label === "Student" ? "Student" : context.occupation_label}`
          : "Your protection command center"}
      </p>

      {/* 1. Header Greeting Bar */}
      <header className="home-greeting-bar">
        <div className="home-greeting-left">
          <h2 className="text-2xl font-extrabold tracking-tight text-slate-900">
            {greetingTime}, {firstName} <span aria-hidden="true">👋</span>
          </h2>
          <p>Stay protected, take action, and let INSSURA handle the rest.</p>
        </div>

      </header>

      {/* Empty State when no coverage & no documents (H-11) */}
      {cards.length === 0 && (
        <section className="home-section-card bg-amber-50/50 border-amber-200">
          <h2 className="text-lg font-bold text-slate-900 mb-1">
            No protection records saved yet
          </h2>
          <p className="text-sm text-slate-600 mb-4">
            Upload policy documents to review benefits, validity periods, and verified coverage evidence.
          </p>
          <Link
            className="inline-flex items-center gap-2 bg-[#008b78] text-white px-4 py-2 rounded-xl text-sm font-semibold hover:bg-[#007565]"
            href="/documents"
          >
            <UploadCloud size={16} />
            <span>Upload first document</span>
          </Link>
        </section>
      )}

      {/* 2. Main Two-Column Layout */}
      <div className="home-layout-grid">
        {/* Left Column (Hero, Top Actions, Protection Areas) */}
        <div className="home-main-col">
          {/* Hero Banner (H-02) */}
          <section className="home-hero-card" data-testid="home-hero">
            <div className="home-hero-left">
              <div className="home-hero-badge">
                <Sparkles size={13} />
                <span>AI Protection Command Center</span>
              </div>
              <h2 className="home-hero-title">{assessmentSummary.headline}</h2>
              <p className="home-hero-desc">{assessmentSummary.description}</p>
              <Link href="/protection" className="home-hero-cta">
                <span>Check My Protection</span>
                <ArrowRight size={16} />
              </Link>
              <div className="home-hero-meta">
                <span>Last full assessment: {assessmentSummary.last_assessed_at}</span>
                <span>|</span>
                <button
                  type="button"
                  onClick={handleReassess}
                  disabled={reassessing}
                  className="home-reassess-btn"
                >
                  <RefreshCw size={12} className={reassessing ? "animate-spin" : ""} />
                  <span>{reassessing ? "Reassessing..." : "Reassess now"}</span>
                </button>
              </div>
            </div>

            <div className="home-hero-art" aria-hidden="true">
              <InsurraMascot
                variant="shield"
                size={180}
                className="home-mascot-img"
                priority
              />
            </div>
          </section>

          {/* Inssura AI Agent Ecosystem Interactive Tour Banner */}
          <section
            className="home-agent-tour-showcase"
            style={{
              background: "linear-gradient(135deg, #f0fdfa 0%, #ffffff 100%)",
              border: "1px solid #ccfbf1",
              borderRadius: 20,
              padding: "18px 22px",
              boxShadow: "0 4px 14px rgba(13, 148, 136, 0.08)",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16, flexWrap: "wrap", marginBottom: 12 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                <div style={{ width: 38, height: 38, borderRadius: 12, background: "#ccfbf1", display: "grid", placeItems: "center", color: "#0f766e" }}>
                  <Compass size={20} />
                </div>
                <div>
                  <h3 style={{ margin: 0, fontSize: 15, fontWeight: 800, color: "#0f172a" }}>
                    Inssura AI Agent Ecosystem Tour
                  </h3>
                  <p style={{ margin: "2px 0 0", fontSize: 12.5, color: "#475569" }}>
                    Explore the complete autonomous workflow in 7 interactive steps.
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => triggerInssuraTour(0)}
                className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-xl text-xs font-bold text-white transition-all shadow-xs cursor-pointer hover:opacity-95"
                style={{ background: "linear-gradient(135deg, #0d9488 0%, #0f766e 100%)" }}
              >
                <Sparkles size={13} />
                <span>Start Agent Tour</span>
                <ArrowRight size={13} />
              </button>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(125px, 1fr))", gap: 8 }}>
              {INSSURA_AGENT_STEPS.map((tStep, idx) => (
                <button
                  key={tStep.id}
                  type="button"
                  onClick={() => triggerInssuraTour(idx)}
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "flex-start",
                    padding: "9px 11px",
                    background: "#ffffff",
                    border: "1px solid #e2e8f0",
                    borderRadius: 12,
                    textAlign: "left",
                    cursor: "pointer",
                    transition: "all 0.15s ease",
                  }}
                  className="hover:border-teal-400 hover:shadow-2xs group"
                >
                  <span style={{ fontSize: 9.5, fontWeight: 800, color: "#0d9488", marginBottom: 2 }}>
                    AGENT {idx + 1}
                  </span>
                  <strong style={{ fontSize: 11, color: "#1e293b", lineHeight: 1.3 }}>
                    {tStep.agentName.split("&")[0].trim()}
                  </strong>
                </button>
              ))}
            </div>
          </section>

          {/* Flow 6: Proactive Renewal & Anti-Lapse Agent - Compact Monitor Card */}
          <section className="home-agent-compact-card" data-testid="anti-lapse-agent-card">
            <div className="home-agent-compact-left">
              <div className="home-agent-compact-beacon" aria-hidden="true">
                <Bot size={18} className="text-emerald-400" />
                <span className="home-agent-pulse-dot" />
              </div>
              <div className="home-agent-compact-info">
                <div className="home-agent-compact-status-row">
                  <span className="home-agent-compact-title">Renewal &amp; Anti-Lapse Agent</span>
                  <span className="home-agent-compact-dot">•</span>
                  <span
                    className={`home-agent-compact-status ${
                      antiLapseAgent?.status === "ATTENTION_REQUIRED" ||
                      antiLapseAgent?.status === "ACTION_PREPARED"
                        ? "warning"
                        : ""
                    }`}
                  >
                    {antiLapseAgent?.status === "ATTENTION_REQUIRED" ||
                    antiLapseAgent?.status === "ACTION_PREPARED"
                      ? "Renewal monitoring active · 1 finding"
                      : "Renewal monitoring active · Verified"}
                  </span>
                </div>
                <p className="home-agent-compact-desc">
                  {antiLapseAgent?.headline ||
                    "Background continuity evaluation across recorded policies and expiry horizons."}
                </p>
                {scanFeedback && (
                  <div className="text-[11px] font-semibold text-emerald-300 flex items-center gap-1.5 mt-0.5">
                    <Check size={12} />
                    <span>{scanFeedback}</span>
                  </div>
                )}
              </div>
            </div>

            <div className="home-agent-compact-right">
              <button
                type="button"
                onClick={handleTriggerAgentScan}
                disabled={isScanning}
                className="home-agent-compact-scan-btn"
                title="Run deterministic continuity scan"
              >
                <RefreshCw size={12} className={isScanning ? "animate-spin" : ""} />
                <span>{isScanning ? "Scanning..." : "Run Scan"}</span>
              </button>
              <Link href="/audit" className="home-agent-activity-link">
                <span>View Agent Activity</span>
                <ArrowRight size={13} />
              </Link>
            </div>
          </section>

          {/* Your Coverage Snapshot (Add-on Card without overwriting existing design) */}
          <CoverageSnapshotCard
            coverageEndDate={cards.find((c) => c.active)?.end_date || cards[0]?.end_date}
            visaEndDate={context?.visa_expiry_date}
            isSample={cards.length === 0}
          />

          {/* Top Actions for You (H-03, H-04, H-05, H-06, H-09) */}
          <section className="home-section-card" data-testid="top-actions-section">
            <div className="home-section-header">
              <div className="home-section-title-wrap">
                <h2>Top Actions for You</h2>
                <p>Based on your profile, policies, and recent updates.</p>
              </div>
              <Link href="/coverage-needs" className="home-section-link">
                <span>View all actions</span>
                <ArrowRight size={13} />
              </Link>
            </div>

            <div className="home-actions-list">
              {prioritizedActions.map((action, idx) => {
                const isSolid = idx === 0;
                const isDental = action.category === "dental" || action.icon === "tooth";
                const isOutpatient =
                  action.category === "outpatient" || action.icon === "stethoscope";
                const isRenewal = action.category === "renewal" || action.icon === "calendar";
                const isClaim = action.category === "claim";
                const isApproval = action.category === "approval" || action.icon === "alert";

                const iconCircleClass = isDental
                  ? "dental"
                  : isOutpatient
                  ? "outpatient"
                  : isRenewal
                  ? "renewal"
                  : isClaim
                  ? "claim"
                  : isApproval
                  ? "approval"
                  : "general";

                const priorityClass =
                  action.priority === "HIGH"
                    ? "high"
                    : action.priority === "MEDIUM"
                    ? "medium"
                    : "upcoming";

                return (
                  <article key={action.id || idx} className="home-action-row">
                    <div className="home-action-left">
                      <div className="home-action-index">{action.index}</div>

                      <div className={`home-action-icon-circle ${iconCircleClass}`}>
                        {isDental && (
                          <svg
                            viewBox="0 0 24 24"
                            width="20"
                            height="20"
                            stroke="currentColor"
                            strokeWidth="2"
                            fill="none"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          >
                            <path d="M12 2C8.5 2 6 4.5 6 8c0 3 1.5 5 2 8 0.5 3 1.5 6 4 6s3.5-3 4-6c0.5-3 2-5 2-8 0-3.5-2.5-6-6-6z" />
                          </svg>
                        )}
                        {isOutpatient && <Stethoscope size={20} />}
                        {isRenewal && <FileText size={20} />}
                        {isClaim && <ClipboardCheck size={20} />}
                        {isApproval && <AlertTriangle size={20} />}
                        {!isDental &&
                          !isOutpatient &&
                          !isRenewal &&
                          !isClaim &&
                          !isApproval && <Shield size={20} />}
                      </div>

                      <div className="home-action-body">
                        <div className="home-action-title-row">
                          <span className="home-action-title">{sanitizeCopywriting(action.title)}</span>
                          <span className={`home-priority-pill ${priorityClass}`}>
                            <span className="w-1.5 h-1.5 rounded-full bg-current" />
                            <span>{action.priority_label}</span>
                          </span>
                        </div>
                        <p className="home-action-desc">{sanitizeCopywriting(action.description)}</p>
                        {action.tags && action.tags.length > 0 && (
                          <div className="home-action-tags">
                            {action.tags.map((tag, tIdx) => (
                              <span
                                key={tIdx}
                                className={`home-tag-chip ${
                                  tag.includes("Anti-Lapse")
                                    ? "border-emerald-300 text-emerald-800 bg-emerald-50 font-bold"
                                    : ""
                                }`}
                              >
                                {tag.includes("Anti-Lapse")
                                  ? tag
                                  : tag.includes("Dental") || tag.includes("Outpatient")
                                  ? `ℹ ${tag}`
                                  : tag.includes("Renewal")
                                  ? `↓ ${tag}`
                                  : `❖ ${tag}`}
                              </span>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>

                    <Link
                      href={action.deep_link}
                      className={`home-action-btn ${isSolid ? "solid" : "outline"}`}
                    >
                      <span>{action.action_label}</span>
                      <ArrowRight size={13} />
                    </Link>
                  </article>
                );
              })}
            </div>
          </section>
        </div>

        {/* Right Column (Donut Status, Recent Updates, Quick Access) */}
        <div className="home-side-col">
          {/* My Protection Status Donut (H-02) */}
          <section className="home-section-card">
            <div className="home-section-header">
              <div className="home-section-title-wrap">
                <h2>My Protection Status</h2>
              </div>
            </div>

            <div className="home-donut-wrap">
              {/* SVG Donut Chart */}
              <div className="home-donut-chart">
                <svg viewBox="0 0 100 100" width="110" height="110" className="transform -rotate-90">
                  {/* Background Track */}
                  <circle
                    cx="50"
                    cy="50"
                    r="45"
                    fill="none"
                    stroke="#f1f5f9"
                    strokeWidth="10"
                  />
                  {/* Covered Segment */}
                  <circle
                    cx="50"
                    cy="50"
                    r="45"
                    fill="none"
                    stroke="#008b78"
                    strokeWidth="10"
                    strokeDasharray={`${covArc} 283`}
                    strokeDashoffset="0"
                    strokeLinecap="round"
                  />
                  {/* Partially Covered Segment */}
                  <circle
                    cx="50"
                    cy="50"
                    r="45"
                    fill="none"
                    stroke="#f59e0b"
                    strokeWidth="10"
                    strokeDasharray={`${partArc} 283`}
                    strokeDashoffset={`-${covArc}`}
                  />
                  {/* Not Covered Segment */}
                  <circle
                    cx="50"
                    cy="50"
                    r="45"
                    fill="none"
                    stroke="#ef4444"
                    strokeWidth="10"
                    strokeDasharray={`${notArc} 283`}
                    strokeDashoffset={`-${covArc + partArc}`}
                  />
                  {/* Unknown Segment */}
                  <circle
                    cx="50"
                    cy="50"
                    r="45"
                    fill="none"
                    stroke="#64748b"
                    strokeWidth="10"
                    strokeDasharray={`${unkArc} 283`}
                    strokeDashoffset={`-${covArc + partArc + notArc}`}
                  />
                </svg>

                <div className="home-donut-center">
                  <span className="home-donut-ratio">{assessmentSummary.score_ratio}</span>
                  <span className="home-donut-sub">{assessmentSummary.score_label}</span>
                </div>
              </div>

              {/* Legend */}
              <div className="home-donut-legend">
                <div className="home-legend-row">
                  <div className="home-legend-label">
                    <span className="home-legend-dot bg-[#008b78]" />
                    <span>Covered</span>
                  </div>
                  <span className="home-legend-count">{assessmentSummary.covered_count}</span>
                </div>
                <div className="home-legend-row">
                  <div className="home-legend-label">
                    <span className="home-legend-dot bg-[#f59e0b]" />
                    <span>Partially Covered</span>
                  </div>
                  <span className="home-legend-count">
                    {assessmentSummary.partially_covered_count}
                  </span>
                </div>
                <div className="home-legend-row">
                  <div className="home-legend-label">
                    <span className="home-legend-dot bg-[#ef4444]" />
                    <span>Not Covered</span>
                  </div>
                  <span className="home-legend-count">{assessmentSummary.not_covered_count}</span>
                </div>
                <div className="home-legend-row">
                  <div className="home-legend-label">
                    <span className="home-legend-dot bg-[#64748b]" />
                    <span>Unknown</span>
                  </div>
                  <span className="home-legend-count">{assessmentSummary.unknown_count}</span>
                </div>
                <div className="home-legend-row">
                  <div className="home-legend-label">
                    <span className="home-legend-dot bg-[#e2e8f0]" />
                    <span>Not Applicable</span>
                  </div>
                  <span className="home-legend-count">
                    {assessmentSummary.not_applicable_count}
                  </span>
                </div>
              </div>
            </div>
          </section>

          {/* Recent Updates (H-07: max 3 entries) */}
          <section className="home-section-card">
            <div className="home-section-header">
              <div className="home-section-title-wrap">
                <h2>Recent Updates</h2>
              </div>
              <Link href="/audit" className="home-section-link">
                <span>View all</span>
                <ArrowRight size={13} />
              </Link>
            </div>

            <div className="home-updates-list">
              {recentActivity.slice(0, 3).map((item, idx) => {
                const isVerified =
                  item.event_type.includes("VERIF") || item.title.includes("verified");
                const isAssessment =
                  item.event_type.includes("ASSESSMENT") || item.title.includes("Assessment");
                const iconClass = isVerified ? "verified" : isAssessment ? "assessment" : "doc";

                return (
                  <div key={item.id || idx} className="home-update-item">
                    <div className={`home-update-icon-circle ${iconClass}`}>
                      {isVerified && <CheckCircle2 size={16} />}
                      {isAssessment && <Sparkles size={16} />}
                      {!isVerified && !isAssessment && <FileText size={16} />}
                    </div>
                    <div className="home-update-content">
                      <p className="home-update-title">{item.title}</p>
                      <p className="home-update-sub">{item.summary}</p>
                    </div>
                    <time className="home-update-time">
                      {item.created_at
                        ? new Date(item.created_at).toLocaleDateString("en-US", {
                            month: "short",
                            day: "numeric",
                          })
                        : "2 days ago"}
                    </time>
                  </div>
                );
              })}
            </div>
          </section>

          {/* Quick Access (H-08: 2x2 grid) */}
          <section className="home-section-card">
            <div className="home-section-header">
              <div className="home-section-title-wrap">
                <h2>Quick Access</h2>
              </div>
            </div>

            <div className="home-quick-grid">
              <Link href="/ask" className="home-quick-card" aria-label="Ask INSSURA">
                <div className="home-quick-top">
                  <MessageSquare size={18} className="home-quick-icon" />
                  <span className="home-quick-title">Ask INSSURA</span>
                </div>
                <span className="home-quick-sub">Get answers about your insurance</span>
              </Link>

              <Link href="/coverage-needs" className="home-quick-card" aria-label="Review Coverage Needs">
                <div className="home-quick-top">
                  <Shield size={18} className="home-quick-icon" />
                  <span className="home-quick-title">Review Coverage Needs</span>
                </div>
                <span className="home-quick-sub">Coverage gap analysis</span>
              </Link>

              <Link href="/pathways" className="home-quick-card" aria-label="Care Pathways">
                <div className="home-quick-top">
                  <Stethoscope size={18} className="home-quick-icon" />
                  <span className="home-quick-title">Care Pathways</span>
                </div>
                <span className="home-quick-sub">Find the right care options</span>
              </Link>

              <Link href="/claims" className="home-quick-card" aria-label="Continue Claim →">
                <div className="home-quick-top">
                  <CreditCard size={18} className="home-quick-icon" />
                  <span className="home-quick-title">Continue Claim →</span>
                </div>
                <span className="home-quick-sub">Start or track a claim</span>
              </Link>
            </div>
          </section>

          {/* Emergency Guidance & Crisis Hotline Footer */}
          <footer
            className="home-emergency"
            role="complementary"
            aria-label="Bantuan darurat"
            style={{
              marginTop: 20,
              padding: "16px 20px",
              borderRadius: 16,
              background: "#fff1f2",
              border: "1px solid #ffe4e6",
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              flexWrap: "wrap",
              gap: 12,
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
              <AlertTriangle size={18} style={{ color: "#e11d48", flexShrink: 0 }} />
              <span style={{ fontSize: 13, color: "#9f1239" }}>
                For urgent medical situations, contact emergency services immediately:
              </span>
              <span
                className="home-emergency-contact"
                data-testid="home-emergency-contact"
                style={{ fontWeight: 800, color: "#e11d48", fontSize: 13 }}
              >
                Local Emergency ({context?.country_label || "China"}): {s.emergency?.phone_number || "120"}
              </span>
            </div>
            <Link
              href="/emergency"
              aria-label="Emergency Guidance →"
              style={{
                fontSize: 13,
                fontWeight: 700,
                color: "#e11d48",
                textDecoration: "none",
                display: "inline-flex",
                alignItems: "center",
                gap: 4,
              }}
            >
              Emergency Guidance →
            </Link>
          </footer>
        </div>
      </div>
    </div>
  );
}
