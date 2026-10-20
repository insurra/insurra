"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle,
  FileCheck,
  FileText,
  HelpCircle,
  Info,
  MapPin,
  RefreshCw,
  Shield,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  X,
} from "lucide-react";
import { api } from "@/lib/api/client";
import type { components } from "@/lib/api/types.gen";
import { useWorkspace } from "@/lib/workspace";
import {
  ConsentNotice,
  WorkspaceState,
} from "@/components/workspace/workspace";
import { InsurraMascot } from "@/components/brand/insurra-mascot";
import { sanitizeCopywriting } from "@/lib/sanitize-copywriting";
import "./coverage-needs.css";

type AssessmentDetail = components["schemas"]["ProtectionAssessmentDetail"];
type NeedDetail = components["schemas"]["NeedDetail"];
type CoverageNeed = components["schemas"]["CoverageNeed"];
type Filter = "all" | "MET" | "POTENTIAL_GAP" | "NEEDS_VERIFICATION" | "UNKNOWN";

export default function CoverageNeedsPage() {
  const workspace = useWorkspace();
  const [assessment, setAssessment] = useState<AssessmentDetail | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [running, setRunning] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>("all");
  const [coverageNeeds, setCoverageNeeds] = useState<CoverageNeed[]>([]);
  const [needsError, setNeedsError] = useState<string | null>(null);

  // Modals & Drawers state
  const [showResultPopup, setShowResultPopup] = useState<boolean>(false);
  const [selectedNeed, setSelectedNeed] = useState<NeedDetail | null>(null);
  const [showRecommendationsDrawer, setShowRecommendationsDrawer] = useState<boolean>(false);
  const [showComparisonModal, setShowComparisonModal] = useState<boolean>(false);

  // Fetch assessment
  useEffect(() => {
    const controller = new AbortController();
    if (!workspace.headers) return () => controller.abort();

    void Promise.resolve().then(() => {
      if (!controller.signal.aborted) {
        setLoading(true);
      }
    });
    api
      .request("get", "/api/v1/protection-assessment", {
        headers: workspace.headers,
        signal: controller.signal,
      })
      .then((res) => {
        if (!controller.signal.aborted) {
          setAssessment(res);
          setError(null);
          setLoading(false);
        }
      })
      .catch((cause: unknown) => {
        if (!controller.signal.aborted) {
          setError(cause instanceof Error ? cause.message : "Protection assessment is unavailable.");
          setLoading(false);
        }
      });

    return () => controller.abort();
  }, [workspace.headers, workspace.identityKey]);

  useEffect(() => {
    const controller = new AbortController();
    if (!workspace.headers || !workspace.summary?.context?.process_documents) {
      return () => controller.abort();
    }
    api
      .request("get", "/api/v1/coverage-needs", {
        headers: workspace.headers,
        signal: controller.signal,
      })
      .then((needs) => {
        if (!controller.signal.aborted) {
          setCoverageNeeds(needs);
          setNeedsError(null);
        }
      })
      .catch((cause: unknown) => {
        if (!controller.signal.aborted) {
          setNeedsError(
            cause instanceof Error
              ? cause.message
              : "Coverage needs could not be loaded.",
          );
        }
      });
    return () => controller.abort();
  }, [workspace.headers, workspace.identityKey, workspace.summary?.context?.process_documents]);

  // Run assessment on demand
  const handleCheckMyProtection = async () => {
    if (!workspace.headers || running) return;
    setRunning(true);
    setError(null);
    try {
      const updated = await api.request("post", "/api/v1/protection-assessment/run", {
        headers: workspace.headers,
        body: { force: true, trigger_reason: "USER_CHECK_MY_PROTECTION" },
      });
      setAssessment(updated);
      setShowResultPopup(true);
    } catch (cause: unknown) {
      setError(cause instanceof Error ? cause.message : "Failed to run protection assessment.");
    } finally {
      setRunning(false);
    }
  };

  if (!workspace.summary) return <WorkspaceState workspace={workspace} />;
  const context = workspace.summary.context;

  const visibleNeeds =
    (assessment?.needs ?? []).filter((item) => {
      if (filter === "all") return true;
      return item.status === filter;
    });

  return (
    <div className="vn coverage-dashboard" lang="en">

      <section className="coverage-panel" aria-labelledby="canonical-needs-title">
        <div className="coverage-panel-heading">
          <div>
            <h1 id="canonical-needs-title">
              Protection You Need in {context?.country_label}
            </h1>
            <p>
              These needs are derived from your profile context and verified regulatory standards. Ownership status uses authorized policy evidence only.
            </p>
          </div>
          <InsurraMascot variant="checklist" size={72} priority />
        </div>
        {!context?.process_documents && <ConsentNotice />}
        {needsError && <p className="vn-error" role="alert">{needsError}</p>}
        <div className="coverage-findings">
          {coverageNeeds.map((need) => {
            const coverage = workspace.summary?.coverages?.find((item) =>
              (need.coverage_ids ?? []).includes(item.id),
            );
            const gapDays = need.visa_assessment?.gap_days;
            const ownedLabel =
              need.ownership_status === "OWNED"
                ? "Covered"
                : need.ownership_status === "NOT_OWNED"
                  ? "Not covered"
                  : "Needs verification";
            return (
              <article key={need.need_code} className="coverage-finding-card">
                <div className="finding-header">
                  <h2>
                    {need.label}
                    {coverage?.provider ? ` · ${sanitizeCopywriting(coverage.provider)}` : ""}
                  </h2>
                  <span className="badge-status">{ownedLabel}</span>
                </div>
                <p className="finding-reason">{need.explanation}</p>
                {typeof gapDays === "number" && gapDays > 0 && (
                  <p><strong>Ada jeda {gapDays} hari</strong></p>
                )}
                <div className="finding-footer">
                  <span>
                    {need.requirement_confirmed
                      ? "Kebutuhan didukung sumber yang telah diverifikasi."
                      : "Penerapan kebutuhan masih perlu diverifikasi."}
                  </span>
                  <Link
                    href={
                      typeof gapDays === "number" && gapDays > 0
                        ? "/completeness?task=visa_cover"
                        : need.action_url
                    }
                  >
                    {typeof gapDays === "number" && gapDays > 0
                      ? "Periksa jeda"
                      : "Periksa bukti"}
                  </Link>
                </div>
              </article>
            );
          })}
        </div>
      </section>

      {/* Hero Header */}
      <header className="coverage-hero">
        <div>
          <span className="coverage-eyebrow">MY PROTECTION / AGENTIC REVIEW</span>
          <h1>My Protection Assessment</h1>
          <p>
            Event-driven AI agent that continuously evaluates what protection you need, what your
            verified evidence supports, and what areas require attention.
          </p>
        </div>
        <div className="coverage-hero-note">
          <InsurraMascot variant="shield" size={90} />
          <div>
            <strong>I keep unknown facts visible.</strong>
            <span>
              If a benefit is not verified, it stays Unknown, never falsely assumed as covered or
              excluded.
            </span>
          </div>
        </div>
      </header>

      {/* AI Assessment Banner & KPI Cards */}
      <section className="coverage-assessment-banner">
        <div className="coverage-assessment-top">
          <div className="coverage-assessment-title">
            <h2>{assessment?.overall_headline || "Protection Review Agent"}</h2>
            <p>
              Status: <strong>{assessment?.status.replace("_", " ") || "INITIALIZING"}</strong>
              {assessment?.updated_at
                ? ` - Last evaluated ${new Date(assessment.updated_at).toLocaleDateString()}`
                : ""}
            </p>
          </div>
          <div className="coverage-assessment-actions">
            <button
              type="button"
              className="btn-assessment-cta"
              onClick={handleCheckMyProtection}
              disabled={running}
            >
              <RefreshCw size={15} className={running ? "animate-spin" : ""} />
              {running ? "Assessing protection..." : "Check My Protection"}
            </button>
            {assessment && (
              <button
                type="button"
                className="btn-summary-outline"
                onClick={() => setShowResultPopup(true)}
              >
                <Sparkles size={14} />
                View AI Summary
              </button>
            )}
          </div>
        </div>

        {/* 4 Metrics KPI Counters */}
        <div className="coverage-kpi-grid">
          <div className="coverage-kpi-card">
            <ShieldCheck style={{ color: "#00d2ad" }} />
            <div>
              <strong>{assessment?.covered_count ?? 0}</strong>
              <span>Covered by Evidence</span>
            </div>
          </div>
          <div className="coverage-kpi-card">
            <AlertTriangle style={{ color: "#f59e0b" }} />
            <div>
              <strong>{assessment?.attention_count ?? 0}</strong>
              <span>Needs Attention</span>
            </div>
          </div>
          <div className="coverage-kpi-card">
            <HelpCircle style={{ color: "#93c5fd" }} />
            <div>
              <strong>{assessment?.unknown_count ?? 0}</strong>
              <span>Unknowns / To Verify</span>
            </div>
          </div>
          <div className="coverage-kpi-card">
            <FileText style={{ color: "#c084fc" }} />
            <div>
              <strong>{assessment?.documents_needed_count ?? 0}</strong>
              <span>Documents Needed</span>
            </div>
          </div>
        </div>
      </section>

      {/* Filter Tabs */}
      <div className="coverage-tabs" role="group" aria-label="Filter protection needs">
        {(
          [
            ["all", "All Needs"],
            ["MET", "Covered"],
            ["POTENTIAL_GAP", "Potential Gaps"],
            ["NEEDS_VERIFICATION", "Needs Verification"],
            ["UNKNOWN", "Unknown"],
          ] as const
        ).map(([value, label]) => (
          <button
            key={value}
            type="button"
            aria-pressed={filter === value}
            onClick={() => setFilter(value)}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="coverage-layout">
        <div className="coverage-main">
          {/* Section 1: Profile & Authorization Inputs */}
          <section className="coverage-panel">
            <div className="coverage-panel-heading">
              <div>
                <h2>1. Profile context</h2>
                <p>Authorized user inputs reused from onboarding and preferences.</p>
              </div>
              <Link href="/onboarding?mode=edit">
                Edit profile <ArrowRight size={14} />
              </Link>
            </div>
            <div className="coverage-context-grid">
              <div className="coverage-context-item">
                <MapPin />
                <span>
                  Residence
                  <strong>
                    {[context?.city, context?.country_label].filter(Boolean).join(", ") ||
                      "Not recorded"}
                  </strong>
                </span>
              </div>
              <div className="coverage-context-item">
                <Shield />
                <span>
                  Occupation
                  <strong>{context?.occupation_label || "Not recorded"}</strong>
                </span>
              </div>
              <div className="coverage-context-item">
                <ShieldCheck />
                <span>
                  Document Consent
                  <strong>{context?.process_documents ? "Granted" : "Not granted"}</strong>
                </span>
              </div>
              <div className="coverage-context-item">
                <Sparkles />
                <span>
                  AI Processing
                  <strong>{context?.external_ai ? "External AI enabled" : "Internal only"}</strong>
                </span>
              </div>
            </div>
          </section>

          {error && (
            <div className="vn-error" role="alert">
              {error}
            </div>
          )}
          {loading && !assessment && <p role="status">Loading protection review...</p>}

          {/* Section 2: Protection Needs & Evidence Findings */}
          {assessment && (
            <section className="coverage-panel">
              <div className="coverage-panel-heading">
                <div>
                  <h2>2. Protection needs &amp; coverage findings</h2>
                  <p>
                    Deterministic taxonomy matching benefits to personal risks. Unverified benefits
                    remain Unknown.
                  </p>
                </div>
                <span className="coverage-count">
                  {visibleNeeds.length} {visibleNeeds.length === 1 ? "need" : "needs"}
                </span>
              </div>

              <div className="coverage-findings">
                {visibleNeeds.map((item) => (
                  <article
                    key={item.code}
                    className={`coverage-finding-card status-${item.status.toLowerCase()}`}
                  >
                    <div className="finding-header">
                      <div className="finding-header-left">
                        {item.status === "MET" ? (
                          <CheckCircle size={18} style={{ color: "#00a887" }} />
                        ) : item.status === "POTENTIAL_GAP" ? (
                          <ShieldAlert size={18} style={{ color: "#f64457" }} />
                        ) : item.status === "NEEDS_VERIFICATION" ? (
                          <AlertTriangle size={18} style={{ color: "#f59e0b" }} />
                        ) : (
                          <HelpCircle size={18} style={{ color: "#6366f1" }} />
                        )}
                        <h3>{item.title}</h3>
                      </div>
                      <div style={{ display: "flex", gap: "6px" }}>
                        <span className={`badge-status badge-${item.status.toLowerCase()}`}>
                          {item.status.replace("_", " ")}
                        </span>
                        <span className="badge-level">
                          {item.requirement_level.replace("_", " ")}
                        </span>
                      </div>
                    </div>

                    <p className="finding-reason">{item.reason}</p>

                    <div className="finding-tags">
                      <span className="tag-category">{item.category.replace("_", " ")}</span>
                      {(item.evidence_basis ?? []).map((b) => (
                        <span key={b} className="tag-evidence">
                          {b.replace("_", " ")}
                        </span>
                      ))}
                    </div>

                    <div className="finding-footer">
                      <span>
                        {(item.matched_coverage ?? []).length > 0
                          ? `Evidence: ${sanitizeCopywriting((item.matched_coverage ?? [])[0].provider)} (${(item.matched_coverage ?? [])[0].verification_status})`
                          : "No policy linked yet"}
                      </span>
                      <div className="finding-btn-group">
                        <button
                          type="button"
                          className="btn-mini-action"
                          onClick={() => setSelectedNeed(item)}
                        >
                          Need details
                        </button>
                        {item.status !== "MET" && (
                          <button
                            type="button"
                            className="btn-mini-action primary"
                            onClick={() => setShowRecommendationsDrawer(true)}
                          >
                            Recommendations
                          </button>
                        )}
                      </div>
                    </div>
                  </article>
                ))}

                {visibleNeeds.length === 0 && (
                  <p className="coverage-empty">No protection needs match the selected filter.</p>
                )}
              </div>
            </section>
          )}

          {/* Section 3: Sourced Product Options */}
          {assessment && (
            <section className="coverage-panel">
              <div className="coverage-panel-heading">
                <div>
                  <h2>3. Supported product options</h2>
                  <p>
                    Officially sourced insurance options from the versioned catalog. First verify
                    existing coverage before purchasing.
                  </p>
                </div>
                <button
                  type="button"
                  style={{
                    background: "none",
                    border: "none",
                    color: "#008e7e",
                    cursor: "pointer",
                    fontSize: "12px",
                    fontWeight: 700,
                  }}
                  onClick={() => setShowComparisonModal(true)}
                >
                  Open comparison table <ArrowRight size={13} style={{ display: "inline" }} />
                </button>
              </div>

              {(assessment.product_candidates ?? []).length > 0 ? (
                <div className="coverage-status-grid">
                  {(assessment.product_candidates ?? []).map((product) => (
                    <article className="coverage-status-card" key={product.product_id}>
                      <div className="coverage-status-title">
                        <span className="coverage-icon">
                          <ShieldCheck size={18} />
                        </span>
                        <h3>{product.product_name}</h3>
                      </div>
                      <strong className="coverage-status-label">{product.insurer_name}</strong>
                      <p>{(product.match_reasons ?? []).join(" ")}</p>
                      <small>
                        Eligibility: {product.eligibility.replace("_", " ")} -{" "}
                        {product.verification_status}
                      </small>
                      <ul>
                        {(product.limitations ?? []).map((lim, idx) => (
                          <li key={idx}>{lim}</li>
                        ))}
                      </ul>
                      <a
                        href={product.official_source_url}
                        target="_blank"
                        rel="noreferrer"
                        style={{ marginTop: "auto", paddingTop: "8px" }}
                      >
                        Official product page <ArrowRight size={13} />
                      </a>
                    </article>
                  ))}
                </div>
              ) : (
                <p className="coverage-empty">
                  No active catalog candidate passed the jurisdiction and gap filters. This can be a
                  valid outcome.
                </p>
              )}
            </section>
          )}

          {/* Section 4: Recent Updates / Changed Findings */}
          {assessment && (assessment.changed_findings ?? []).length > 0 && (
            <section className="coverage-panel">
              <div className="coverage-panel-heading">
                <h2>Recent updates &amp; changed findings</h2>
              </div>
              <div className="coverage-updates-list">
                {(assessment.changed_findings ?? []).map((item, idx) => (
                  <div key={idx} className="coverage-update-item">
                    <FileCheck size={14} style={{ color: "#00a887" }} />
                    <span>{item}</span>
                  </div>
                ))}
              </div>
            </section>
          )}
        </div>

        {/* Sidebar */}
        <aside className="coverage-sidebar" aria-label="Next steps">
          <section className="coverage-ask-card">
            <InsurraMascot variant="assistant" size={64} decorative />
            <div>
              <h2>Ask INSSURA</h2>
              <p>Ask why a need or product appears in your assessment.</p>
            </div>
            <Link href="/ask">
              Ask INSSURA <ArrowRight size={14} />
            </Link>
          </section>

          <section className="coverage-panel">
            <h2>Quick actions</h2>
            <Link className="coverage-side-link" href="/documents">
              <FileText size={16} /> Add policy evidence <ArrowRight size={13} />
            </Link>
            <Link className="coverage-side-link" href="/policies">
              <Shield size={16} /> Policy wallet <ArrowRight size={13} />
            </Link>
            <Link className="coverage-side-link" href="/account/privacy">
              <ShieldCheck size={16} /> Manage privacy &amp; consent <ArrowRight size={13} />
            </Link>
          </section>
        </aside>
      </div>

      {/* ==================================================================== */}
      {/* 1. Result Popup Modal (PR-10)                                         */}
      {/* ==================================================================== */}
      {showResultPopup && assessment && (
        <div className="vn-modal-backdrop" onClick={() => setShowResultPopup(false)}>
          <div className="vn-modal-card" onClick={(e) => e.stopPropagation()}>
            <div className="vn-modal-header">
              <div>
                <h2>AI Protection Assessment Result</h2>
                <p>{assessment.overall_headline}</p>
              </div>
              <button
                type="button"
                className="btn-close-modal"
                onClick={() => setShowResultPopup(false)}
                aria-label="Close"
              >
                <X size={16} />
              </button>
            </div>

            {/* What is covered */}
            <div className="outcome-section">
              <h4>
                <CheckCircle size={15} style={{ color: "#00a887" }} /> What is covered
              </h4>
              <ul className="outcome-list">
                {(assessment.summary?.what_is_covered ?? []).map((item, idx) => (
                  <li key={idx} className="outcome-item covered">
                    <CheckCircle size={14} />
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
            </div>

            {/* What needs attention */}
            <div className="outcome-section">
              <h4>
                <AlertTriangle size={15} style={{ color: "#f59e0b" }} /> What needs attention
              </h4>
              <ul className="outcome-list">
                {(assessment.summary?.what_needs_attention ?? []).map((item, idx) => (
                  <li key={idx} className="outcome-item attention">
                    <AlertTriangle size={14} />
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
            </div>

            {/* Unknowns */}
            <div className="outcome-section">
              <h4>
                <HelpCircle size={15} style={{ color: "#6366f1" }} /> Unknowns &amp; verification
                needed
              </h4>
              <ul className="outcome-list">
                {(assessment.summary?.unknowns ?? []).map((item, idx) => (
                  <li key={idx} className="outcome-item unknown">
                    <Info size={14} />
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
            </div>

            {/* Next steps */}
            <div className="outcome-section">
              <h4>
                <Sparkles size={15} style={{ color: "#00a887" }} /> Recommended next steps
              </h4>
              <ul className="outcome-list">
                {(assessment.summary?.next_steps ?? []).map((step, idx) => (
                  <li key={idx} className="outcome-item step">
                    <ArrowRight size={14} />
                    <span>{step}</span>
                  </li>
                ))}
              </ul>
            </div>

            <div style={{ display: "flex", justifyContent: "flex-end", marginTop: "16px" }}>
              <button
                type="button"
                className="btn-mini-action primary"
                style={{ padding: "8px 18px", fontSize: "12px" }}
                onClick={() => setShowResultPopup(false)}
              >
                Done
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ==================================================================== */}
      {/* 2. Need Details Drawer (PR-11)                                       */}
      {/* ==================================================================== */}
      {selectedNeed && (
        <div className="vn-drawer-backdrop" onClick={() => setSelectedNeed(null)}>
          <div className="vn-drawer-panel" onClick={(e) => e.stopPropagation()}>
            <div className="vn-drawer-header">
              <div>
                <h2>{selectedNeed.title}</h2>
                <div style={{ display: "flex", gap: "6px", marginTop: "6px" }}>
                  <span className={`badge-status badge-${selectedNeed.status.toLowerCase()}`}>
                    {selectedNeed.status.replace("_", " ")}
                  </span>
                  <span className="badge-level">
                    {selectedNeed.requirement_level.replace("_", " ")}
                  </span>
                </div>
              </div>
              <button
                type="button"
                className="btn-close-modal"
                onClick={() => setSelectedNeed(null)}
                aria-label="Close"
              >
                <X size={16} />
              </button>
            </div>

            <div className="vn-drawer-body">
              <div className="drawer-section">
                <h4>Supporting Reason</h4>
                <p>{selectedNeed.reason}</p>
                {selectedNeed.rule_id && (
                  <small style={{ color: "#64748b" }}>Rule: {selectedNeed.rule_id}</small>
                )}
              </div>

              <div className="drawer-section">
                <h4>Matched Policy Evidence</h4>
                {(selectedNeed.matched_coverage?.length ?? 0) > 0 ? (
                  selectedNeed.matched_coverage?.map((mc, idx) => (
                    <div key={idx} className="drawer-evidence-box">
                      <strong>
                        {sanitizeCopywriting(mc.provider)} - {sanitizeCopywriting(mc.plan_name)}
                      </strong>
                      <span>Benefit: {mc.benefit_name}</span>
                      <span>Limit: {mc.benefit_limit || "Not specified"}</span>
                      <span>Verification Status: {mc.verification_status}</span>
                      <span>Source Origin: {mc.source_origin}</span>
                    </div>
                  ))
                ) : (
                  <p style={{ color: "#8a9cb5", fontStyle: "italic" }}>
                    No verified policy is currently matched to this protection area.
                  </p>
                )}
              </div>

              {selectedNeed.limits_summary && (
                <div className="drawer-section">
                  <h4>Limits Summary</h4>
                  <p>{selectedNeed.limits_summary}</p>
                </div>
              )}

              {(selectedNeed.risks?.length ?? 0) > 0 && (
                <div className="drawer-section">
                  <h4>Identified Risks</h4>
                  {selectedNeed.risks?.map((risk, idx) => (
                    <div key={idx} className="drawer-risk-box">
                      {risk}
                    </div>
                  ))}
                </div>
              )}

              {(selectedNeed.applicable_next_steps?.length ?? 0) > 0 && (
                <div className="drawer-section">
                  <h4>Applicable Next Steps</h4>
                  {selectedNeed.applicable_next_steps?.map((step, idx) => (
                    <div key={idx} className="drawer-action-box">
                      {step}
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="vn-drawer-footer">
              <button
                type="button"
                className="btn-mini-action primary"
                onClick={() => setSelectedNeed(null)}
              >
                Close details
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ==================================================================== */}
      {/* 3. Recommendations Drawer (PR-11)                                     */}
      {/* ==================================================================== */}
      {showRecommendationsDrawer && assessment && (
        <div
          className="vn-drawer-backdrop"
          onClick={() => setShowRecommendationsDrawer(false)}
        >
          <div className="vn-drawer-panel" onClick={(e) => e.stopPropagation()}>
            <div className="vn-drawer-header">
              <div>
                <h2>Coverage Recommendations</h2>
                <p style={{ fontSize: "12px", color: "#627598", margin: "4px 0 0 0" }}>
                  Guidance on resolving protection gaps
                </p>
              </div>
              <button
                type="button"
                className="btn-close-modal"
                onClick={() => setShowRecommendationsDrawer(false)}
                aria-label="Close"
              >
                <X size={16} />
              </button>
            </div>

            <div className="vn-drawer-body">
              {/* Step 1: First verify existing coverage */}
              <div className="drawer-section">
                <h4>Step 1: Verify Existing Coverage First</h4>
                <div className="drawer-action-box">
                  Before purchasing any new policy, check whether your existing insurance or campus
                  scheme already covers this need. Upload your policy document or certificate to
                  replace unverified assumptions with evidence.
                </div>
                <Link
                  href="/documents"
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: "5px",
                    color: "#008e7e",
                    fontSize: "12px",
                    fontWeight: 700,
                    marginTop: "6px",
                  }}
                >
                  Upload existing policy <ArrowRight size={13} />
                </Link>
              </div>

              {/* Step 2: Sourced product options */}
              <div className="drawer-section">
                <h4>Step 2: Supported Product Options</h4>
                <p>
                  If a gap remains after verification, you can consider these officially sourced
                  insurance products from licensed insurers:
                </p>
                {(assessment.product_candidates ?? []).map((prod) => (
                  <div key={prod.product_id} className="drawer-evidence-box">
                    <strong>{prod.product_name}</strong>
                    <span>Insurer: {prod.insurer_name}</span>
                    <span>Category: {prod.category.replace("_", " ")}</span>
                    <a
                      href={prod.official_source_url}
                      target="_blank"
                      rel="noreferrer"
                      style={{ color: "#008e7e", fontSize: "11px", fontWeight: 700 }}
                    >
                      Official product page <ArrowRight size={12} style={{ display: "inline" }} />
                    </a>
                  </div>
                ))}
              </div>
            </div>

            <div className="vn-drawer-footer">
              <button
                type="button"
                className="btn-mini-action primary"
                onClick={() => setShowRecommendationsDrawer(false)}
              >
                Done
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ==================================================================== */}
      {/* 4. Comparison Modal (P1)                                             */}
      {/* ==================================================================== */}
      {showComparisonModal && assessment && (
        <div className="vn-modal-backdrop" onClick={() => setShowComparisonModal(false)}>
          <div
            className="vn-modal-card"
            style={{ maxWidth: "800px" }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="vn-modal-header">
              <div>
                <h2>Insurance Product Comparison</h2>
                <p>Actual officially sourced products, constraints, and official links.</p>
              </div>
              <button
                type="button"
                className="btn-close-modal"
                onClick={() => setShowComparisonModal(false)}
                aria-label="Close"
              >
                <X size={16} />
              </button>
            </div>

            <div style={{ overflowX: "auto" }}>
              <table
                style={{
                  width: "100%",
                  borderCollapse: "collapse",
                  fontSize: "12px",
                  textAlign: "left",
                }}
              >
                <thead>
                  <tr style={{ borderBottom: "2px solid #e2edf5", color: "#0f1c64" }}>
                    <th style={{ padding: "8px" }}>Product</th>
                    <th style={{ padding: "8px" }}>Provider</th>
                    <th style={{ padding: "8px" }}>Category</th>
                    <th style={{ padding: "8px" }}>Eligibility Note</th>
                    <th style={{ padding: "8px" }}>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {(assessment.product_candidates ?? []).map((p) => (
                    <tr key={p.product_id} style={{ borderBottom: "1px solid #edf4f8" }}>
                      <td style={{ padding: "8px", fontWeight: 700 }}>{p.product_name}</td>
                      <td style={{ padding: "8px" }}>{p.insurer_name}</td>
                      <td style={{ padding: "8px" }}>{p.category.replace("_", " ")}</td>
                      <td style={{ padding: "8px", color: "#64748b" }}>
                        {p.eligibility.replace("_", " ")} ({p.verification_status})
                      </td>
                      <td style={{ padding: "8px" }}>
                        <a
                          href={p.official_source_url}
                          target="_blank"
                          rel="noreferrer"
                          style={{
                            color: "#008e7e",
                            fontWeight: 700,
                            display: "inline-flex",
                            alignItems: "center",
                            gap: "4px",
                          }}
                        >
                          Official link <ArrowRight size={12} />
                        </a>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div style={{ display: "flex", justifyContent: "flex-end", marginTop: "20px" }}>
              <button
                type="button"
                className="btn-mini-action primary"
                onClick={() => setShowComparisonModal(false)}
              >
                Close comparison
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
