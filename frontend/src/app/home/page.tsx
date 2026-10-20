"use client";

import Link from "next/link";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import {
  Calendar,
  FileText,
  Clock,
  Sparkles,
  Send,
  AlertTriangle,
  ChevronRight,
  ArrowRight,
  CheckCircle2,
} from "lucide-react";
import { api } from "@/lib/api/client";
import { useWorkspace } from "@/lib/workspace";
import { useAuth } from "@/lib/auth";
import { getWorkflowHeaders, getWorkflowUrl } from "@/lib/api/workflow-client";
import { WorkspaceState } from "@/components/workspace/workspace";
import "./home-dashboard.css";

interface WorkflowOverview {
  stats?: {
    total_cases?: number;
    open_cases?: number;
    ready_to_submit?: number;
    awaiting_approval?: number;
  };
  awaiting_approval_banner?: {
    action_id: string;
    action_reference: string;
    title: string;
    purpose?: string;
    claim_id?: string;
  } | null;
  recent_activity?: Array<{
    id: string;
    event_type: string;
    category?: string;
    title: string;
    summary: string;
    created_at: string;
  }>;
}

interface InsightAction {
  kind?: string;
  action_type?: string | null;
  entity_type?: string | null;
  entity_id?: string | null;
  label?: string;
  deep_link?: string;
}

export default function HomePage() {
  const router = useRouter();
  const workspace = useWorkspace();
  const [askQuery, setAskQuery] = useState("");
  const [workflowData, setWorkflowData] = useState<WorkflowOverview | null>(null);
  const { token: accountToken } = useAuth();
  const [preparingActionId, setPreparingActionId] = useState<string | null>(null);

  const handleInsightAction = async (action: InsightAction) => {
    if (action?.kind === "PREPARE_ACTION" && action?.action_type) {
      setPreparingActionId(action.action_type);
      try {
        const headers = getWorkflowHeaders(accountToken);
        const res = await fetch(getWorkflowUrl("/api/v1/workflow/actions"), {
          method: "POST",
          headers,
          body: JSON.stringify({
            action_type: action.action_type,
            entity_type: action.entity_type,
            entity_id: action.entity_id,
          }),
        });
        if (res.ok) {
          const data = await res.json();
          router.push(`/actions?action=${data.id}`);
          return;
        }
      } catch {
        // Fallback to deep link
      } finally {
        setPreparingActionId(null);
      }
    }
    router.push(action?.deep_link || "/actions");
  };

  // Fetch live workflow data (claims, pending actions, audit activity)
  useEffect(() => {
    if (!workspace.headers) return;
    const controller = new AbortController();

    api
      .request("get", "/api/v1/workflow/claims/overview", {
        headers: workspace.headers,
        signal: controller.signal,
      })
      .then((res) => {
        if (!controller.signal.aborted && res) {
          setWorkflowData(res as WorkflowOverview);
        }
      })
      .catch(() => {
        // Fallback cleanly to workspace summary data without fabricating counts
      });

    return () => controller.abort();
  }, [workspace.headers]);

  if (!workspace.summary) {
    return <WorkspaceState workspace={workspace} />;
  }

  const s = workspace.summary as typeof workspace.summary & {
    insights?: Array<{
      id: string;
      rule_id: string;
      kind: string;
      severity: "HIGH" | "NORMAL" | "NEEDS_VERIFICATION";
      status: string;
      title: string;
      explanation: string;
      facts?: Array<{ key: string; label: string; value: string; unit?: string | null }>;
      next_actions?: Array<{
        kind: string;
        label: string;
        deep_link: string;
        action_type?: string | null;
      }>;
    }>;
    attention?: {
      open_claims?: number | null;
      claims_needing_evidence?: number | null;
      pending_approvals?: number | null;
      expiring_policies?: number | null;
    } | null;
    recent_activity?: Array<{
      id: string;
      event_type: string;
      category?: string | null;
      title: string;
      summary?: string | null;
      created_at: string;
    }>;
  };
  const context = s.context;
  const cards = s.coverages ?? [];
  const insights = s.insights ?? [];
  const topInsight = insights[0];

  // Expiry calculation from real policy rows only
  const nextExpiringPolicy = cards.find((c) => c.end_date) ?? cards[0];
  const expiryText =
    nextExpiringPolicy && nextExpiringPolicy.end_date
      ? `${nextExpiringPolicy.kind || nextExpiringPolicy.provider || "Coverage"} expires on ${nextExpiringPolicy.end_date}.`
      : "Not available";

  // Claim status calculation from real backend stats only
  const openClaimsCount =
    typeof s.attention?.open_claims === "number"
      ? s.attention.open_claims
      : typeof workflowData?.stats?.open_cases === "number"
      ? workflowData.stats.open_cases
      : null;
  const claimText =
    openClaimsCount === null
      ? "Not available"
      : openClaimsCount === 0
      ? "No open claims awaiting review."
      : `${openClaimsCount} open claim${openClaimsCount === 1 ? "" : "s"} in your workspace.`;

  // Pending action calculation from real backend queue only
  const pendingCount =
    typeof s.attention?.pending_approvals === "number"
      ? s.attention.pending_approvals
      : typeof workflowData?.stats?.awaiting_approval === "number"
      ? workflowData.stats.awaiting_approval
      : null;
  const pendingActionTitle = workflowData?.awaiting_approval_banner?.title
    ? workflowData.awaiting_approval_banner.title
    : pendingCount === 0
    ? "No pending actions awaiting confirmation."
    : pendingCount !== null
    ? `${pendingCount} action${pendingCount === 1 ? "" : "s"} awaiting review and approval.`
    : "Not available";

  // Hero headline and description from real backend insights or recommendations
  const topRec = s.recommendations?.[0];
  const hasContinuityDiff = Boolean(
    nextExpiringPolicy?.end_date &&
      context?.visa_expiry_date &&
      nextExpiringPolicy.end_date < context.visa_expiry_date
  );
  const heroTitle = topInsight
    ? topInsight.title
    : topRec
    ? topRec.title
    : hasContinuityDiff
    ? "Coverage continuity needs verification"
    : cards.length > 0
    ? `${s.active} active coverage${s.active === 1 ? "" : "s"} in ${context?.country_label || "your workspace"}`
    : "No active coverage recorded yet";

  const heroMessage = topInsight
    ? topInsight.explanation
    : topRec
    ? topRec.explanation
    : hasContinuityDiff
    ? `Recorded coverage ends on ${nextExpiringPolicy?.end_date} while your stay period extends to ${context?.visa_expiry_date}. Needs verification against official requirements.`
    : cards.length > 0
    ? `${s.needs_verification} coverage item${s.needs_verification === 1 ? "" : "s"} needing verification and ${s.expiring_30d} expiring within 30 days.`
    : "Upload a policy document or check coverage needs to evaluate your protection status.";

  // Emergency contact resolution strictly from verified KB data
  const emergencyNumber =
    s.emergency?.available && s.emergency?.phone_number
      ? s.emergency.phone_number
      : "Not available";
  const countryName = context?.country_label || context?.country_code || "Not available";
  const activityItems =
    s.recent_activity && s.recent_activity.length > 0
      ? s.recent_activity
      : workflowData?.recent_activity ?? [];

  const handleAskSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const q = askQuery.trim();
    if (!q) return;
    sessionStorage.setItem("insurra_demo_prompt", q);
    router.push("/ask");
  };

  const handleShortcutPrompt = (prompt: string) => {
    sessionStorage.setItem("insurra_demo_prompt", prompt);
    router.push("/ask");
  };

  return (
    <div className="home-dashboard">
      {/* Top Header */}
      <header className="home-header">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div>
            <h1>Home</h1>
            <p>Your command center for protection, care, and claims.</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold bg-white border border-slate-200 text-slate-700 shadow-2xs">
              <span className="w-2 h-2 rounded-full bg-teal-600" />
              Jurisdiction: <strong>{countryName}</strong>
            </span>
            <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold bg-teal-50 border border-teal-200 text-teal-800">
              <strong>{s.active}</strong> Active {s.active === 1 ? "Policy" : "Policies"}
            </span>
            {s.needs_verification > 0 && (
              <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold bg-amber-50 border border-amber-200 text-amber-800">
                <strong>{s.needs_verification}</strong> Needs Verification
              </span>
            )}
            {s.expiring_30d > 0 && (
              <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold bg-rose-50 border border-rose-200 text-rose-700">
                <strong>{s.expiring_30d}</strong> Expiring ≤ 30d
              </span>
            )}
          </div>
        </div>
      </header>

      {/* Hero Section */}
      <section className="home-hero" data-testid="home-hero">
        <div className="home-hero-art" aria-hidden="true" />
        <div className="home-hero-copy">
          <div className="home-eyebrow">
            PROTECTION COMMAND CENTER
            {topInsight ? ` · ${topInsight.severity.replace(/_/g, " ")}` : ""}
          </div>
          <h2>{heroTitle}</h2>
          <p>{heroMessage}</p>
          {topInsight?.facts && topInsight.facts.length > 0 && (
            <div className="flex flex-wrap gap-2 mt-2" data-testid="home-hero-facts">
              {topInsight.facts.map((fact) => (
                <span
                  key={fact.key}
                  className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium bg-white/80 text-slate-800 border border-slate-200"
                >
                  {fact.label}: <strong className="ml-1">{fact.value}</strong>
                </span>
              ))}
            </div>
          )}
          <div className="home-cta-row">
            <Link
              href="/coverage-needs"
              className="home-btn primary"
              data-action="gap"
            >
              <ArrowRight size={16} />
              <span>Review Coverage Needs</span>
            </Link>
            <Link href="/ask" className="home-btn" data-action="ask">
              <Sparkles size={16} />
              <span>Ask INSURRA</span>
            </Link>
          </div>
        </div>
      </section>

      {/* 3 Mini Cards */}
      <section className="home-cards3">
        {/* Card 1: Upcoming Expiry */}
        <article className="home-panel home-mini">
          <div className="home-mini-top">
            <div className="home-feature-icon">
              <Calendar size={22} />
            </div>
            <div className="home-mini-content">
              <div className="home-mini-title-row">
                <div className="flex items-center gap-2">
                  <h3>Upcoming Expiry</h3>
                  <span
                    className={`text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full ${
                      s.expiring_30d > 0
                        ? "bg-amber-50 text-amber-800 border border-amber-200"
                        : "bg-emerald-50 text-emerald-700 border border-emerald-200"
                    }`}
                  >
                    {s.expiring_30d > 0 ? "Expiring Soon" : "Active"}
                  </span>
                </div>
                <ChevronRight size={15} className="chevron" />
              </div>
              <p data-testid="home-expiry-text">{expiryText}</p>
            </div>
          </div>
          <Link href="/protection" className="home-softlink">
            View Details →
          </Link>
        </article>

        {/* Card 2: Claim Status */}
        <article className="home-panel home-mini">
          <div className="home-mini-top">
            <div className="home-feature-icon blue">
              <FileText size={22} />
            </div>
            <div className="home-mini-content">
              <div className="home-mini-title-row">
                <div className="flex items-center gap-2">
                  <h3>Claim Status</h3>
                  <span
                    className={`text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full ${
                      openClaimsCount && openClaimsCount > 0
                        ? "bg-sky-50 text-sky-700 border border-sky-200"
                        : "bg-slate-100 text-slate-600"
                    }`}
                  >
                    {openClaimsCount && openClaimsCount > 0 ? `${openClaimsCount} Active` : "Clear"}
                  </span>
                </div>
                <ChevronRight size={15} className="chevron" />
              </div>
              <p data-testid="home-claim-text">{claimText}</p>
            </div>
          </div>
          <Link href="/claims" className="home-softlink blue">
            Continue Claim →
          </Link>
        </article>

        {/* Card 3: Pending Action */}
        <article className="home-panel home-mini">
          <div className="home-mini-top">
            <div className="home-feature-icon amber">
              <Clock size={22} />
            </div>
            <div className="home-mini-content">
              <div className="home-mini-title-row">
                <div className="flex items-center gap-2">
                  <h3>Pending Action</h3>
                  <span
                    className={`text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full ${
                      pendingCount && pendingCount > 0
                        ? "bg-amber-50 text-amber-800 border border-amber-200"
                        : "bg-slate-100 text-slate-600"
                    }`}
                  >
                    {pendingCount && pendingCount > 0 ? "Needs Approval" : "Queue Empty"}
                  </span>
                </div>
                <ChevronRight size={15} className="chevron" />
              </div>
              <p data-testid="home-pending-action-text">{pendingActionTitle}</p>
            </div>
          </div>
          <Link href="/actions" className="home-softlink amber">
            Review & Approve →
          </Link>
        </article>
      </section>

      {/* 2-Column Grid */}
      <section className="home-grid2">
        {/* Left Column: Protection Insights + Recommended Next Steps + Recent Activity */}
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          {/* Protection Insights & Recommended Next Steps */}
          <article className="home-panel home-section" data-testid="home-insights-section">
            <div className="home-section-title">
              <div>
                <h3>
                  <span style={{ color: "#008b78" }}>◎</span>
                  <span>Recommended Next Steps</span>
                </h3>
                <div className="hint">
                  Based on your documents, coverage dates, and recent activity.
                </div>
              </div>
            </div>

            {insights.length > 0 ? (
              insights.slice(0, 3).map((ins, index) => {
                const primaryAction = ins.next_actions?.[0];
                return (
                  <div className="home-step" key={ins.id || index} data-testid="home-insight-card">
                    <div className="home-step-num">{index + 1}</div>
                    <div className="home-step-desc">
                      <div className="flex items-center gap-2 mb-0.5">
                        <strong>{ins.title}</strong>
                        <span
                          className={`text-[10px] font-bold uppercase tracking-wider px-2.5 py-0.5 rounded-full border ${
                            ins.severity === "HIGH"
                              ? "bg-rose-50 text-rose-700 border-rose-200"
                              : ins.severity === "NEEDS_VERIFICATION"
                              ? "bg-amber-50 text-amber-800 border-amber-200"
                              : "bg-teal-50 text-teal-800 border-teal-200"
                          }`}
                        >
                          {ins.severity.replace(/_/g, " ")}
                        </span>
                      </div>
                      <p>{ins.explanation}</p>
                    </div>
                    {primaryAction?.kind === "PREPARE_ACTION" ? (
                      <button
                        type="button"
                        onClick={() => handleInsightAction(primaryAction)}
                        disabled={preparingActionId === primaryAction.action_type}
                        className="home-smallbtn cursor-pointer"
                      >
                        <span>
                          {preparingActionId === primaryAction.action_type
                            ? "Preparing..."
                            : primaryAction?.label || "Prepare Action"}
                        </span>
                        <ArrowRight size={12} />
                      </button>
                    ) : (
                      <Link
                        href={primaryAction?.deep_link || "/coverage-needs"}
                        className="home-smallbtn"
                      >
                        <span>{primaryAction?.label || "Review Now"}</span>
                        <ArrowRight size={12} />
                      </Link>
                    )}
                  </div>
                );
              })
            ) : s.recommendations && s.recommendations.length > 0 ? (
              s.recommendations.slice(0, 3).map((r, index) => (
                <div className="home-step" key={r.rule_id || index}>
                  <div className="home-step-num">{index + 1}</div>
                  <div className="home-step-desc">
                    <strong>{r.title}</strong>
                    <p>{r.explanation}</p>
                  </div>
                  <Link
                    href={r.action_url || "/documents"}
                    className="home-smallbtn"
                  >
                    <span>Review Now</span>
                    <ArrowRight size={12} />
                  </Link>
                </div>
              ))
            ) : (
              <div className="p-4 text-xs text-slate-600 bg-slate-50 rounded-xl border border-slate-200">
                <strong className="block text-slate-800 mb-1">Not available</strong>
                {s.warnings?.[0] ||
                  "No rule-based recommendations are currently triggered. An empty list does not guarantee full coverage."}
              </div>
            )}
          </article>

          {/* Recent Activity */}
          <article className="home-panel home-section">
            <div className="home-section-title">
              <h3>
                <span style={{ color: "#008b78" }}>◫</span>
                <span>Recent Activity</span>
              </h3>
              <Link href="/audit" className="home-section-link">
                View All →
              </Link>
            </div>

            <div className="home-activity-list">
              {activityItems.length > 0 ? (
                activityItems.slice(0, 5).map((item, idx) => (
                  <div className="home-activity-item" key={item.id || idx}>
                    <div className="home-activity-dot">
                      {item.event_type.includes("POLICY") ||
                      item.event_type.includes("VERIF") ? (
                        <CheckCircle2 size={16} />
                      ) : (
                        <FileText size={16} />
                      )}
                    </div>
                    <div className="home-activity-details">
                      <strong>{item.title}</strong>
                      <p>{item.summary || "Not available"}</p>
                    </div>
                    <time className="home-activity-time">
                      {item.created_at
                        ? new Date(item.created_at).toLocaleDateString("en-US", {
                            month: "short",
                            day: "numeric",
                          })
                        : "Not available"}
                    </time>
                  </div>
                ))
              ) : (
                <div className="p-4 text-xs text-slate-500 bg-slate-50 rounded-xl border border-slate-200">
                  Not available (no recent activity recorded for this session).
                </div>
              )}
            </div>
          </article>
        </div>

        {/* Right Column: Agent Workspace */}
        <article className="home-panel home-section">
          <div className="home-section-title">
            <div>
              <h3>
                <Sparkles size={17} style={{ color: "#008b78" }} />
                <span>Agent Workspace</span>
              </h3>
              <div className="hint">
                Your AI copilot for protection, care, and claims.
              </div>
            </div>
          </div>

          <div className="home-agent-box">
            {/* Greeting */}
            <div className="home-agent-greet">
              <div className="home-agent-face">
                <Image
                  src="/mascot-bubble.png"
                  alt="Insurra AI"
                  width={44}
                  height={44}
                  className="home-agent-avatar"
                  priority
                />
              </div>
              <div className="home-speech">
                Hi! I&apos;m INSURRA. I can help you understand your coverage,
                verify gaps, and request approvals.
              </div>
            </div>

            {/* Quick Prompt Shortcuts */}
            <div className="home-shortcuts">
              <button
                type="button"
                className="home-chip"
                onClick={() =>
                  handleShortcutPrompt("Explain my insurance coverage")
                }
              >
                <span>Understand</span>
                <span className="home-chip-sub">My coverage</span>
              </button>

              <button
                type="button"
                className="home-chip"
                onClick={() => handleShortcutPrompt("Track my claims")}
              >
                <span>Track</span>
                <span className="home-chip-sub">My claims</span>
              </button>

              <button
                type="button"
                className="home-chip"
                onClick={() =>
                  handleShortcutPrompt("Help me request approval")
                }
              >
                <span>Request</span>
                <span className="home-chip-sub">Approval</span>
              </button>
            </div>

            {/* Ask Input Form */}
            <form onSubmit={handleAskSubmit} className="home-ask-input">
              <input
                type="text"
                placeholder="Ask me about your coverage, claims, or documents..."
                aria-label="Ask INSURRA"
                value={askQuery}
                onChange={(e) => setAskQuery(e.target.value)}
              />
              <button type="submit" aria-label="Submit query">
                <Send size={15} />
              </button>
            </form>
          </div>
        </article>
      </section>

      {/* Emergency Footer Bar */}
      <footer className="home-emergency">
        <Link href="/emergency">
          <AlertTriangle size={18} />
          <span>Emergency Guidance →</span>
        </Link>
        <span className="sub">
          For urgent medical situations, contact a local hospital or emergency services.
        </span>
        <span className="home-emergency-contact" data-testid="home-emergency-contact">
          Local Emergency ({countryName}): <strong>{emergencyNumber}</strong>
        </span>
      </footer>
    </div>
  );
}
