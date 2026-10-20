"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import {
  Activity,
  AlertCircle,
  AlertTriangle,
  ArrowRight,
  Bed,
  Calendar,
  Check,
  CheckCircle2,
  ChevronRight,
  ExternalLink,
  Eye,
  FileText,
  Heart,
  HelpCircle,
  Info,
  MapPin,
  RefreshCw,
  Shield,
  ShieldCheck,
  Sparkles,
  Stethoscope,
  UploadCloud,
  User,
  Wallet,
  X,
} from "lucide-react";

import { useActor } from "@/lib/actor";
import { api } from "@/lib/api/client";
import type { components } from "@/lib/api/types.gen";
import "./protection.css";

type FullProtectionAssessment = components["schemas"]["FullProtectionAssessment"];
type ProtectionNeedItem = components["schemas"]["ProtectionNeedItem"];
type ProductComparisonResponse = components["schemas"]["ProductComparisonResponse"];

export default function MyProtectionPage() {
  const { headers, loading: actorLoading, demo, account } = useActor();

  const [assessment, setAssessment] = useState<FullProtectionAssessment | null>(null);
  const [loading, setLoading] = useState(true);
  const [reassessing, setReassessing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Modals and Drawers States (Image 2 flows)
  const [showReviewPopup, setShowReviewPopup] = useState(false);
  const [showExpandedAnalysis, setShowExpandedAnalysis] = useState(false);
  const [expandedAnalysisTab, setExpandedAnalysisTab] = useState<"overview" | "needs" | "documents" | "recommendations">("overview");

  const [selectedNeed, setSelectedNeed] = useState<ProtectionNeedItem | null>(null);
  const [needDrawerTab, setNeedDrawerTab] = useState<"overview" | "evidence" | "recommendations">("overview");

  const [productRecNeed, setProductRecNeed] = useState<ProtectionNeedItem | null>(null);
  const [selectedProductIds, setSelectedProductIds] = useState<string[]>([]);
  const [showCompareModal, setShowCompareModal] = useState(false);
  const [comparisonData, setComparisonData] = useState<ProductComparisonResponse | null>(null);
  const [comparing, setComparing] = useState(false);

  const [showAllNeedsDrawer, setShowAllNeedsDrawer] = useState(false);
  const [allNeedsFilter, setAllNeedsFilter] = useState<"all" | "covered" | "attention" | "unknown">("all");

  const loadAssessment = async (force: boolean = false) => {
    if (!headers) return;
    try {
      if (force) {
        setReassessing(true);
        const updated = await api.request("post", "/api/v1/protection/reassess", {
          headers,
          body: { force_refresh: true, notes: "USER_REQUESTED" },
        });
        setAssessment(updated);
      } else {
        setLoading(true);
        const data = await api.request("get", "/api/v1/protection/assessment", { headers });
        setAssessment(data);
      }
      setError(null);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to load protection assessment.");
    } finally {
      setLoading(false);
      setReassessing(false);
    }
  };

  useEffect(() => {
    let active = true;
    if (!actorLoading && headers) {
      api
        .request("get", "/api/v1/protection/assessment", { headers })
        .then((data) => {
          if (active) {
            setAssessment(data);
            setLoading(false);
          }
        })
        .catch((err: unknown) => {
          if (active) {
            setError(err instanceof Error ? err.message : "Failed to load protection assessment.");
            setLoading(false);
          }
        });
    } else if (!actorLoading && !headers) {
      const timer = setTimeout(() => {
        if (active) setLoading(false);
      }, 0);
      return () => {
        active = false;
        clearTimeout(timer);
      };
    }
    return () => {
      active = false;
    };
  }, [headers, actorLoading]);

  // Handle Product Comparison
  const handleOpenCompare = async (idsToCompare?: string[]) => {
    const targetIds = idsToCompare ?? selectedProductIds;
    if (!targetIds.length || !headers) return;
    setComparing(true);
    try {
      const country = assessment?.country_code || "CN";
      const res = await api.request("post", "/api/v1/protection/compare", {
        headers,
        query: { country_code: country },
        body: targetIds,
      });
      setComparisonData(res);
      setShowCompareModal(true);
    } catch (err: unknown) {
      console.error("Comparison error:", err);
    } finally {
      setComparing(false);
    }
  };

  const toggleProductSelect = (id: string) => {
    setSelectedProductIds((prev) =>
      prev.includes(id) ? prev.filter((p) => p !== id) : [...prev, id]
    );
  };

  // User display name
  const userName = useMemo(() => {
    if (assessment?.profile_context?.display_name) return assessment.profile_context.display_name.split(" ")[0];
    if (account?.display_name) return account.display_name.split(" ")[0];
    if (demo?.profile?.display_name) return demo.profile.display_name.split(" ")[0];
    return "there";
  }, [account, demo, assessment]);

  // Top 4 needs for homepage cards
  const topNeeds = useMemo(() => {
    if (!assessment?.needs) return [];
    return assessment.needs.slice(0, 4);
  }, [assessment]);

  // All needs filtered for drawer
  const filteredAllNeeds = useMemo(() => {
    if (!assessment?.needs) return [];
    if (allNeedsFilter === "all") return assessment.needs;
    if (allNeedsFilter === "covered") return assessment.needs.filter((n) => n.status === "COVERED");
    if (allNeedsFilter === "attention")
      return assessment.needs.filter((n) => n.status === "PARTIALLY_COVERED" || n.status === "NOT_COVERED");
    if (allNeedsFilter === "unknown") return assessment.needs.filter((n) => n.status === "UNKNOWN");
    return assessment.needs;
  }, [assessment, allNeedsFilter]);

  // Helper icon renderer
  const getNeedColorClass = (icon: string) => {
    switch (icon) {
      case "bed":
        return "green";
      case "stethoscope":
        return "cyan";
      case "tooth":
        return "purple";
      case "running":
      case "shield":
        return "amber";
      default:
        return "green";
    }
  };

  const renderNeedIcon = (icon: string) => {
    switch (icon) {
      case "bed":
        return <Bed size={18} />;
      case "stethoscope":
        return <Stethoscope size={18} />;
      case "tooth":
        return <Heart size={18} />;
      case "running":
        return <Activity size={18} />;
      case "eye":
        return <Eye size={18} />;
      case "shield":
        return <Shield size={18} />;
      default:
        return <ShieldCheck size={18} />;
    }
  };

  if (actorLoading || loading) {
    return (
      <main className="figma-page-shell">
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", minHeight: "400px", gap: "1rem" }}>
          <RefreshCw className="animate-spin text-emerald-600" size={32} />
          <p style={{ color: "#4b5563", fontWeight: 500 }}>Analyzing your protection profile and policies…</p>
        </div>
      </main>
    );
  }

  return (
    <main className="figma-page-shell protection-dashboard">
      {/* 1. Subnavigation Tabs (Overview, Completeness, Policy Wallet, Employer Benefits, Family) */}
      <nav className="protection-subnav" aria-label="Protection sections">
        <Link href="/protection" className="protection-subnav-tab active">
          Overview / AI Assessment
        </Link>
        <Link href="/completeness" className="protection-subnav-tab">
          Completeness
        </Link>
        <Link href="/policies" className="protection-subnav-tab">
          Policy Wallet
        </Link>
        <Link href="/employer-benefits" className="protection-subnav-tab">
          Employer Benefits
        </Link>
        <Link href="/family" className="protection-subnav-tab">
          Family
        </Link>
      </nav>

      {/* 2. Page Header with Last Updated & Reassess button */}
      <div className="protection-header-row">
        <div className="protection-header-title">
          <h1>My Protection</h1>
          <p>Manage your insurance needs, existing coverage, and next steps.</p>
        </div>
        <div className="protection-header-actions">
          <span className="protection-last-updated">
            <Calendar size={14} />
            Last updated: {assessment?.last_assessed_at || "20 Oct 2026, 10:24"}
          </span>
          <button
            type="button"
            className="reassess-btn"
            onClick={() => loadAssessment(true)}
            disabled={reassessing}
          >
            <RefreshCw size={14} className={reassessing ? "animate-spin" : ""} />
            {reassessing ? "Reassessing…" : "Reassess My Protection"}
          </button>
        </div>
      </div>

      {error && (
        <div className="mb-6 p-4 rounded-xl bg-amber-50 border border-amber-200 text-amber-800 text-sm flex items-center gap-3">
          <AlertCircle size={18} className="shrink-0 text-amber-600" />
          <span>{error}</span>
        </div>
      )}

      {/* 3. Mascot Hero Banner */}
      <section className="protection-hero-banner" aria-label="Protection assessment overview">
        <div className="protection-hero-art-bg" />
        <span className="protection-hero-badge-tag">Cross-border insurance, made simple. 💚</span>
        <div className="protection-hero-left">
          <div className="protection-hero-mascot-wrapper">
            <Image
              src="/mascot-shield.png"
              alt="INSSURA Mascot"
              width={124}
              height={124}
              className="protection-hero-mascot"
              priority
            />
          </div>
          <div className="protection-hero-copy">
            <h2>
              Hi {userName},
              <br />
              are you as <span>protected</span> as you think?
            </h2>
            <p>
              Discover what you need, understand what you already have, and find your next best step.
            </p>
            <div className="protection-hero-assessment-card">
              <div className="protection-hero-assessment-info">
                <span className="sparkle-icon-box">
                  <Sparkles size={18} />
                </span>
                <div>
                  <strong>INSSURA AI Protection Assessment</strong>
                  <small>Get personalized view of your protection based on your profile, policies and life stage</small>
                </div>
              </div>
              <button
                type="button"
                className="check-protection-btn"
                data-tour="check-protection"
                onClick={() => setShowReviewPopup(true)}
              >
                Check My Protection <ArrowRight size={15} />
              </button>
            </div>
          </div>
        </div>
      </section>

      {/* 4. Protection Summary 4 Stat Cards */}
      <section aria-labelledby="summary-heading">
        <div className="section-header-row">
          <h3 id="summary-heading">Protection Summary</h3>
          <span className="section-header-hint">
            Based on your policies, profile, and documents <Info size={13} />
          </span>
        </div>
        <div className="summary-cards-grid">
          <div
            className="summary-stat-card tone-green"
            role="button"
            tabIndex={0}
            onClick={() => setShowExpandedAnalysis(true)}
            onKeyDown={(e) => e.key === "Enter" && setShowExpandedAnalysis(true)}
          >
            <div className="summary-stat-top">
              <span className="stat-icon-wrap green">
                <CheckCircle2 size={20} />
              </span>
              <div className="stat-number-label">
                <span className="stat-number">{assessment?.summary.covered_count ?? 3}</span>
                <span className="stat-label">needs covered</span>
              </div>
            </div>
            <p className="stat-desc">You&apos;re on track</p>
          </div>

          <div
            className="summary-stat-card tone-orange"
            role="button"
            tabIndex={0}
            onClick={() => setShowExpandedAnalysis(true)}
            onKeyDown={(e) => e.key === "Enter" && setShowExpandedAnalysis(true)}
          >
            <div className="summary-stat-top">
              <span className="stat-icon-wrap orange">
                <AlertTriangle size={20} />
              </span>
              <div className="stat-number-label">
                <span className="stat-number">{assessment?.summary.attention_count ?? 2}</span>
                <span className="stat-label">areas need attention</span>
              </div>
            </div>
            <p className="stat-desc">We found some gaps to address</p>
          </div>

          <div
            className="summary-stat-card tone-purple"
            role="button"
            tabIndex={0}
            onClick={() => setShowExpandedAnalysis(true)}
            onKeyDown={(e) => e.key === "Enter" && setShowExpandedAnalysis(true)}
          >
            <div className="summary-stat-top">
              <span className="stat-icon-wrap purple">
                <HelpCircle size={20} />
              </span>
              <div className="stat-number-label">
                <span className="stat-number">{assessment?.summary.unknown_count ?? 1}</span>
                <span className="stat-label">areas unknown</span>
              </div>
            </div>
            <p className="stat-desc">Help us understand your situation better</p>
          </div>

          <div
            className="summary-stat-card tone-blue"
            role="button"
            tabIndex={0}
            onClick={() => setShowExpandedAnalysis(true)}
            onKeyDown={(e) => e.key === "Enter" && setShowExpandedAnalysis(true)}
          >
            <div className="summary-stat-top">
              <span className="stat-icon-wrap blue">
                <FileText size={20} />
              </span>
              <div className="stat-number-label">
                <span className="stat-number">{assessment?.summary.documents_needed_count ?? 4}</span>
                <span className="stat-label">documents needed</span>
              </div>
            </div>
            <p className="stat-desc">Upload to complete your profile</p>
          </div>
        </div>
      </section>

      {/* 5. Your Protection Needs (4 cards with badges + View All Needs) */}
      <section aria-labelledby="needs-heading">
        <div className="section-header-row">
          <h3 id="needs-heading">Your Protection Needs</h3>
          <button
            type="button"
            className="section-header-link"
            onClick={() => setShowAllNeedsDrawer(true)}
          >
            See your full protection breakdown <ArrowRight size={14} />
          </button>
        </div>
        <div className="needs-grid">
          {topNeeds.map((need) => (
            <div className="need-card" key={need.need_code}>
              <div>
                <div className="need-card-header">
                  <span className={`need-icon-box ${getNeedColorClass(need.icon)}`}>
                    {renderNeedIcon(need.icon)}
                  </span>
                  <div>
                    <h4 className="need-card-title">{need.title}</h4>
                  </div>
                </div>
                <p className="need-card-desc">{need.description}</p>
                <div className="mb-2">
                  <span className={`need-status-pill ${need.status.toLowerCase()}`}>
                    {need.status === "COVERED" && <CheckCircle2 size={12} />}
                    {need.status === "PARTIALLY_COVERED" && <AlertTriangle size={12} />}
                    {need.status === "NOT_COVERED" && <AlertCircle size={12} />}
                    {need.status === "UNKNOWN" && <HelpCircle size={12} />}
                    {need.status_label}
                  </span>
                </div>
                <small className="block text-xs text-gray-500 mb-3">{need.status_explanation}</small>
              </div>
              <div className="need-card-footer">
                <button
                  type="button"
                  className="need-card-action-btn"
                  onClick={() => {
                    setSelectedNeed(need);
                    setNeedDrawerTab("overview");
                  }}
                >
                  {need.has_unmet_need ? "View recommendations" : "View details"} <ArrowRight size={13} />
                </button>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* 6. What You Can Do Here 4 action links */}
      <section aria-labelledby="actions-heading">
        <div className="section-header-row">
          <h3 id="actions-heading">What you can do here</h3>
        </div>
        <div className="actions-grid">
          <Link href="/policies?action=add" className="action-card">
            <div className="action-card-img-wrap">
              <Image
                src="/protection-policy-stack.png"
                alt="Add a Policy"
                width={48}
                height={48}
                className="action-card-img"
              />
            </div>
            <div className="action-card-text">
              <strong>Add a Policy</strong>
              <small>Input your existing policies</small>
            </div>
            <div className="action-card-arrow">
              <ArrowRight size={15} />
            </div>
          </Link>

          <Link href="/policies" className="action-card">
            <div className="action-card-img-wrap">
              <Image
                src="/protection-shield.png"
                alt="View Policy Wallet"
                width={48}
                height={48}
                className="action-card-img"
              />
            </div>
            <div className="action-card-text">
              <strong>View Policy Wallet</strong>
              <small>See your policies &amp; coverage</small>
            </div>
            <div className="action-card-arrow">
              <ArrowRight size={15} />
            </div>
          </Link>

          <Link href="/completeness" className="action-card">
            <div className="action-card-img-wrap">
              <Image
                src="/protection-completeness.png"
                alt="Complete Profile"
                width={48}
                height={48}
                className="action-card-img"
              />
            </div>
            <div className="action-card-text">
              <strong>Complete Profile</strong>
              <small>Fill in details for more relevant insights</small>
            </div>
            <div className="action-card-arrow">
              <ArrowRight size={15} />
            </div>
          </Link>

          <Link href="/documents" className="action-card">
            <div className="action-card-img-wrap">
              <Image
                src="/protection-documents.png"
                alt="Upload Documents"
                width={48}
                height={48}
                className="action-card-img"
              />
            </div>
            <div className="action-card-text">
              <strong>Upload Documents</strong>
              <small>Add policy docs &amp; ID for AI verification</small>
            </div>
            <div className="action-card-arrow">
              <ArrowRight size={15} />
            </div>
          </Link>
        </div>
      </section>

      {/* 7. Recent Updates Table */}
      <section aria-labelledby="updates-heading">
        <div className="section-header-row">
          <h3 id="updates-heading">Recent Updates</h3>
          <Link href="/activity" className="section-header-link">
            View all activity <ArrowRight size={14} />
          </Link>
        </div>
        <div className="recent-updates-box">
          <table className="updates-table">
            <thead>
              <tr>
                <th style={{ width: "20%" }}>Date</th>
                <th style={{ width: "50%" }}>Update</th>
                <th style={{ width: "20%" }}>Related to</th>
                <th style={{ width: "10%", textAlign: "right" }}>Action</th>
              </tr>
            </thead>
            <tbody>
              {(assessment?.recent_updates ?? []).map((update, idx) => (
                <tr key={idx}>
                  <td className="update-date-cell">{update.date}</td>
                  <td>
                    <div className="update-content-cell">
                      <span className="update-icon-circle">
                        {update.related_to === "Policy Wallet" ? <Wallet size={16} /> : update.related_to === "Documents" ? <FileText size={16} /> : <Sparkles size={16} />}
                      </span>
                      <div className="update-text">
                        <strong>{update.title.split("\n")[0]}</strong>
                        <small>{update.title.split("\n")[1] || ""}</small>
                      </div>
                    </div>
                  </td>
                  <td style={{ color: "#4b5563", fontWeight: 500 }}>{update.related_to}</td>
                  <td style={{ textAlign: "right" }}>
                    <Link
                      href={update.action_url.startsWith("#") ? "/protection" : update.action_url}
                      onClick={() => {
                        if (update.action_url === "#analysis") setShowExpandedAnalysis(true);
                      }}
                      className="text-emerald-700 font-semibold hover:underline inline-flex items-center gap-1 text-xs"
                    >
                      {update.action_label} <ArrowRight size={12} />
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* =========================================================================
          SCREEN 2: AI Assessment Result Popup (Modal)
         ========================================================================= */}
      {showReviewPopup && (
        <div className="modal-overlay" onClick={() => setShowReviewPopup(false)}>
          <div className="modal-content-card" onClick={(e) => e.stopPropagation()}>
            <button
              type="button"
              className="modal-close-btn"
              onClick={() => setShowReviewPopup(false)}
              aria-label="Close"
            >
              <X size={16} />
            </button>

            <div className="assessment-popup-header">
              <Sparkles size={24} className="popup-sparkle-icon" />
              <div>
                <h3>INSSURA AI Protection Review</h3>
                <p>Here&apos;s your current protection status based on your profile and documents.</p>
              </div>
            </div>

            {/* 4 Summary Pills */}
            <div className="popup-stat-pills-row">
              <div className="popup-stat-pill bg-emerald-50 text-emerald-800 border border-emerald-200">
                <strong>{assessment?.summary.covered_count ?? 3}</strong>
                <span>Covered</span>
              </div>
              <div className="popup-stat-pill bg-amber-50 text-amber-800 border border-amber-200">
                <strong>{assessment?.summary.attention_count ?? 2}</strong>
                <span>Need Attention</span>
              </div>
              <div className="popup-stat-pill bg-purple-50 text-purple-800 border border-purple-200">
                <strong>{assessment?.summary.unknown_count ?? 1}</strong>
                <span>Unknown</span>
              </div>
              <div className="popup-stat-pill bg-blue-50 text-blue-800 border border-blue-200">
                <strong>{assessment?.summary.documents_needed_count ?? 4}</strong>
                <span>Documents</span>
              </div>
            </div>

            {/* Key Findings */}
            <h4 className="popup-section-title">Key Findings</h4>
            <div className="popup-findings-list">
              {(assessment?.key_findings ?? []).map((finding) => (
                <div className="popup-finding-item" key={finding.id}>
                  <span className={`popup-finding-number ${finding.status}`}>{finding.id}</span>
                  <span>{finding.text}</span>
                </div>
              ))}
            </div>

            {/* Recommended Next Steps */}
            <h4 className="popup-section-title">Recommended Next Steps</h4>
            <div className="popup-steps-list">
              {(assessment?.recommended_next_steps ?? []).map((step) => (
                <div className="popup-step-item" key={step.id}>
                  <span className="popup-step-num">{step.id}.</span>
                  <span>{step.description}</span>
                </div>
              ))}
            </div>

            {/* Mascot Footer Box with View Detailed Analysis CTA */}
            <div className="popup-mascot-footer-card">
              <div className="popup-mascot-footer-left">
                <Image src="/mascot-clipboard.png" alt="Mascot" width={52} height={52} />
                <div>
                  <p>You&apos;re in a good place!</p>
                  <small>Just a few areas to take care of.</small>
                </div>
              </div>
              <button
                type="button"
                className="view-analysis-btn"
                onClick={() => {
                  setShowReviewPopup(false);
                  setShowExpandedAnalysis(true);
                }}
              >
                View Detailed Analysis <ArrowRight size={14} className="inline ml-1" />
              </button>
            </div>
          </div>
        </div>
      )}

      {/* =========================================================================
          SCREEN 3: Expanded Result View (Drawer / Modal)
         ========================================================================= */}
      {showExpandedAnalysis && (
        <div className="drawer-overlay" onClick={() => setShowExpandedAnalysis(false)}>
          <div className="drawer-panel" onClick={(e) => e.stopPropagation()}>
            <div className="drawer-header">
              <h3>Your Protection Analysis</h3>
              <button
                type="button"
                className="modal-close-btn"
                onClick={() => setShowExpandedAnalysis(false)}
                aria-label="Close"
              >
                <X size={16} />
              </button>
            </div>

            {/* Drawer Tabs: Overview, Needs & Coverage, Documents, Recommendations */}
            <div className="drawer-tabs">
              {(["overview", "needs", "documents", "recommendations"] as const).map((tab) => (
                <button
                  key={tab}
                  type="button"
                  className={`drawer-tab-btn ${expandedAnalysisTab === tab ? "active" : ""}`}
                  onClick={() => setExpandedAnalysisTab(tab)}
                >
                  {tab === "overview" && "Overview"}
                  {tab === "needs" && "Needs & Coverage"}
                  {tab === "documents" && "Documents"}
                  {tab === "recommendations" && "Recommendations"}
                </button>
              ))}
            </div>

            {expandedAnalysisTab === "overview" && (
              <div>
                {/* Donut Chart Row */}
                <div className="donut-chart-row">
                  <div className="donut-svg-wrap">
                    <svg viewBox="0 0 36 36" className="w-full h-full">
                      {/* Background circle */}
                      <path
                        d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
                        fill="none"
                        stroke="#e5e7eb"
                        strokeWidth="3.8"
                      />
                      {/* Covered arc (green, 50%) */}
                      <path
                        d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
                        fill="none"
                        stroke="#10b981"
                        strokeWidth="3.8"
                        strokeDasharray="50, 100"
                      />
                      {/* Partially covered (yellow, 20%) */}
                      <path
                        d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
                        fill="none"
                        stroke="#f59e0b"
                        strokeWidth="3.8"
                        strokeDasharray="20, 100"
                        strokeDashoffset="-50"
                      />
                      {/* Not covered (red, 15%) */}
                      <path
                        d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
                        fill="none"
                        stroke="#ef4444"
                        strokeWidth="3.8"
                        strokeDasharray="15, 100"
                        strokeDashoffset="-70"
                      />
                    </svg>
                    <div className="donut-inner-text">
                      <strong>{assessment?.summary.overall_score_text ?? "3/6"}</strong>
                      <small>Needs covered</small>
                    </div>
                  </div>
                  <div className="donut-legend">
                    <div className="legend-item">
                      <span className="legend-dot bg-emerald-500" />
                      <span>Covered: <strong>{assessment?.summary.covered_count ?? 3}</strong></span>
                    </div>
                    <div className="legend-item">
                      <span className="legend-dot bg-amber-500" />
                      <span>Partially Covered: <strong>1</strong></span>
                    </div>
                    <div className="legend-item">
                      <span className="legend-dot bg-red-500" />
                      <span>Not Covered: <strong>1</strong></span>
                    </div>
                    <div className="legend-item">
                      <span className="legend-dot bg-purple-500" />
                      <span>Unknown: <strong>{assessment?.summary.unknown_count ?? 1}</strong></span>
                    </div>
                  </div>
                </div>

                {/* Profile Context Used Card */}
                <div className="profile-context-card">
                  <div className="profile-context-header">
                    <strong>Profile Context Used</strong>
                    <Link href="/onboarding?mode=edit">Edit Profile</Link>
                  </div>
                  <div className="profile-context-tags">
                    <span className="profile-context-tag">
                      <User size={13} /> {assessment?.profile_context?.visa_status || "Student (X1 visa)"}
                    </span>
                    <span className="profile-context-tag">
                      <MapPin size={13} /> {assessment?.profile_context?.city || "Beijing"}, {assessment?.country_code}
                    </span>
                    <span className="profile-context-tag">
                      <Calendar size={13} /> {assessment?.profile_context?.key_dates_summary || "Expected graduation: Jun 2027"}
                    </span>
                  </div>
                </div>

                {/* Key Findings List */}
                <h4 className="popup-section-title">Key Findings</h4>
                <div className="popup-findings-list mb-6">
                  {(assessment?.key_findings ?? []).map((finding) => (
                    <div className="popup-finding-item" key={finding.id}>
                      <span className={`popup-finding-number ${finding.status}`}>{finding.id}</span>
                      <span>{finding.text}</span>
                    </div>
                  ))}
                </div>

                {/* Recommended Next Steps Cards */}
                <h4 className="popup-section-title">Recommended Next Steps</h4>
                <div className="space-y-3">
                  {(assessment?.recommended_next_steps ?? []).map((step) => (
                    <div
                      key={step.id}
                      className="border border-gray-200 rounded-xl p-3 flex items-center justify-between gap-3 hover:border-emerald-300 transition-colors"
                    >
                      <div>
                        <strong className="block text-sm text-gray-900">{step.title}</strong>
                        <small className="text-gray-500">{step.description}</small>
                      </div>
                      <button
                        type="button"
                        className="text-xs font-semibold text-emerald-700 hover:underline shrink-0 inline-flex items-center gap-1"
                        onClick={() => {
                          if (step.action_label.includes("Dental")) {
                            const dental = assessment?.needs.find((n) => n.need_code === "DENTAL_CARE");
                            if (dental) setSelectedNeed(dental);
                          } else if (step.action_label.includes("Recommendations")) {
                            const dental = assessment?.needs.find((n) => n.need_code === "DENTAL_CARE");
                            if (dental) setProductRecNeed(dental);
                          }
                        }}
                      >
                        {step.action_label} <ArrowRight size={13} />
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {expandedAnalysisTab === "needs" && (
              <div className="space-y-3">
                {assessment?.needs.map((need) => (
                  <div
                    key={need.need_code}
                    className="p-3 border rounded-xl hover:border-emerald-400 cursor-pointer transition-all"
                    onClick={() => setSelectedNeed(need)}
                  >
                    <div className="flex items-center justify-between mb-1">
                      <strong className="text-sm font-semibold">{need.title}</strong>
                      <span className={`need-status-pill ${need.status.toLowerCase()}`}>{need.status_label}</span>
                    </div>
                    <p className="text-xs text-gray-600 mb-1">{need.description}</p>
                    <small className="text-emerald-700 text-xs font-medium">Click to inspect evidence &amp; options →</small>
                  </div>
                ))}
              </div>
            )}

            {expandedAnalysisTab === "documents" && (
              <div className="space-y-3">
                <p className="text-sm text-gray-600">
                  You have recorded insurance policies. Additional documents (e.g. dental benefit schedule or visa permit) can be uploaded in Documents.
                </p>
                <Link
                  href="/documents"
                  className="inline-flex items-center gap-2 px-4 py-2 bg-emerald-600 text-white rounded-lg text-sm font-semibold hover:bg-emerald-700"
                >
                  <UploadCloud size={16} /> Open Documents Hub
                </Link>
              </div>
            )}

            {expandedAnalysisTab === "recommendations" && (
              <div className="space-y-3">
                <p className="text-sm text-gray-600">
                  Based on unmet needs (Dental Care &amp; Outpatient), here are options from verified providers:
                </p>
                <button
                  type="button"
                  className="w-full py-2.5 bg-emerald-700 text-white font-semibold rounded-lg text-sm flex items-center justify-center gap-2"
                  onClick={() => {
                    const dental = assessment?.needs.find((n) => n.need_code === "DENTAL_CARE");
                    if (dental) setProductRecNeed(dental);
                  }}
                >
                  Explore Dental &amp; Student Options <ArrowRight size={16} />
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* =========================================================================
          SCREEN 4: Protection Need Details (Drawer)
         ========================================================================= */}
      {selectedNeed && (
        <div className="drawer-overlay" onClick={() => setSelectedNeed(null)}>
          <div className="drawer-panel" onClick={(e) => e.stopPropagation()}>
            <div className="drawer-header">
              <div className="flex items-center gap-3">
                <h3>{selectedNeed.title}</h3>
                <span className={`need-status-pill ${selectedNeed.status.toLowerCase()}`}>
                  {selectedNeed.status_label}
                </span>
              </div>
              <button
                type="button"
                className="modal-close-btn"
                onClick={() => setSelectedNeed(null)}
                aria-label="Close"
              >
                <X size={16} />
              </button>
            </div>

            {/* Need Details Tabs */}
            <div className="drawer-tabs">
              {(["overview", "evidence", "recommendations"] as const).map((tab) => (
                <button
                  key={tab}
                  type="button"
                  className={`drawer-tab-btn ${needDrawerTab === tab ? "active" : ""}`}
                  onClick={() => setNeedDrawerTab(tab)}
                >
                  {tab === "overview" && "Overview"}
                  {tab === "evidence" && "Evidence"}
                  {tab === "recommendations" && "Recommendations"}
                </button>
              ))}
            </div>

            {needDrawerTab === "overview" && (
              <div>
                {/* Status Alert Box (red/amber background with alert icon) */}
                <div className={`p-4 rounded-xl border mb-5 ${
                  selectedNeed.status === "COVERED"
                    ? "bg-emerald-50 border-emerald-200 text-emerald-900"
                    : selectedNeed.status === "NOT_COVERED"
                    ? "bg-red-50 border-red-200 text-red-900"
                    : "bg-amber-50 border-amber-200 text-amber-900"
                }`}>
                  <div className="flex items-start gap-3">
                    <AlertCircle size={20} className="shrink-0 mt-0.5" />
                    <div>
                      <strong className="block font-bold text-sm mb-1">{selectedNeed.status_explanation}</strong>
                      <p className="text-xs leading-relaxed opacity-90">
                        {selectedNeed.status === "NOT_COVERED"
                          ? "Your current insurance does not include active benefits for this category, or we could not verify it from your uploaded documents."
                          : selectedNeed.status === "PARTIALLY_COVERED"
                          ? "Benefits exist but contain low sublimits or copayment restrictions."
                          : "Verified policy provisions satisfy your core requirements."}
                      </p>
                    </div>
                  </div>
                </div>

                {/* Date continuity alert if detected */}
                {selectedNeed.date_gap_days && (
                  <div className="p-3 bg-amber-50 border border-amber-300 rounded-lg text-amber-900 text-xs mb-5 flex items-center gap-2">
                    <Calendar size={16} className="text-amber-700 shrink-0" />
                    <span>{selectedNeed.date_gap_explanation}</span>
                  </div>
                )}

                {/* Why this matters */}
                <div className="mb-6">
                  <h4 className="text-sm font-bold text-gray-900 mb-1.5">Why this matters</h4>
                  <p className="text-xs text-gray-600 leading-relaxed">{selectedNeed.why_it_matters}</p>
                </div>

                {/* Suggested next steps */}
                <div className="mb-8">
                  <h4 className="text-sm font-bold text-gray-900 mb-2">Suggested next steps</h4>
                  <ol className="list-decimal pl-4 space-y-1.5 text-xs text-gray-700">
                    {(selectedNeed.suggested_next_steps ?? []).map((st, i) => (
                      <li key={i}>{st}</li>
                    ))}
                  </ol>
                </div>

                {/* Bottom Actions */}
                <div className="flex items-center gap-3 pt-4 border-t border-gray-100">
                  <Link
                    href="/documents"
                    className="flex-1 py-2.5 px-4 text-center border border-gray-300 text-gray-700 font-semibold text-xs rounded-lg hover:bg-gray-50"
                  >
                    Upload Document
                  </Link>
                  <button
                    type="button"
                    className="flex-1 py-2.5 px-4 text-center bg-emerald-700 text-white font-semibold text-xs rounded-lg hover:bg-emerald-800 flex items-center justify-center gap-1.5"
                    onClick={() => {
                      setProductRecNeed(selectedNeed);
                    }}
                  >
                    Explore Insurance Options <ArrowRight size={14} />
                  </button>
                </div>
              </div>
            )}

            {needDrawerTab === "evidence" && (
              <div className="space-y-4">
                <div className="p-3 bg-gray-50 rounded-lg border text-xs">
                  <span className="font-semibold block text-gray-700 mb-1">Evidence Summary:</span>
                  <p className="text-gray-600">{selectedNeed.evidence_summary}</p>
                </div>
                <div>
                  <span className="font-semibold block text-xs text-gray-700 mb-1.5">Recorded Sources:</span>
                  <ul className="list-disc pl-4 text-xs text-gray-600 space-y-1">
                    {(selectedNeed.evidence_sources ?? []).map((src, idx) => (
                      <li key={idx}>{src}</li>
                    ))}
                  </ul>
                </div>
              </div>
            )}

            {needDrawerTab === "recommendations" && (
              <div>
                <p className="text-xs text-gray-600 mb-4">
                  Review verified catalog plans that fulfill {selectedNeed.title} requirements:
                </p>
                <button
                  type="button"
                  className="w-full py-2.5 bg-emerald-700 text-white font-semibold rounded-lg text-xs flex items-center justify-center gap-1.5"
                  onClick={() => setProductRecNeed(selectedNeed)}
                >
                  View Sourced Product Candidates <ArrowRight size={14} />
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* =========================================================================
          SCREEN 5: Product Recommendations (Drawer)
         ========================================================================= */}
      {productRecNeed && (
        <div className="drawer-overlay" onClick={() => setProductRecNeed(null)}>
          <div className="drawer-panel" onClick={(e) => e.stopPropagation()}>
            <div className="drawer-header">
              <div>
                <h3 className="text-lg font-bold text-gray-900">{productRecNeed.title}</h3>
                <p className="text-xs text-gray-500">
                  Recommended Options: Suitable options from trusted providers based on your profile.
                </p>
              </div>
              <button
                type="button"
                className="modal-close-btn"
                onClick={() => setProductRecNeed(null)}
                aria-label="Close"
              >
                <X size={16} />
              </button>
            </div>

            {/* List of Recommended Products (Ping An, Allianz, AXA, etc.) */}
            <div className="flex-1 overflow-y-auto space-y-4 pr-1">
              {[
                {
                  id: "cn-prod-pingan-student-dental",
                  brand: "Ping An",
                  name: "Ping An International Student Insurance",
                  badge: "Popular with students",
                  features: [
                    "Covers basic and major dental treatment",
                    "Worldwide coverage",
                    "Direct billing at designated hospitals",
                  ],
                  url: "https://www.pingan.com/student-insurance",
                },
                {
                  id: "cn-prod-allianz-student-plan",
                  brand: "Allianz",
                  name: "Allianz International Student Plan",
                  badge: "Comprehensive coverage",
                  features: [
                    "Covers outpatient and inpatient dental care",
                    "Multiple plan options",
                    "Wide hospital network in China",
                  ],
                  url: "https://www.allianz.cn/student-plan",
                },
                {
                  id: "cn-prod-axa-student-dental",
                  brand: "AXA",
                  name: "AXA International Student Insurance",
                  badge: "Flexible plan",
                  features: [
                    "Optional dental rider",
                    "Covers preventive and major treatment",
                    "Cashless at selected hospitals",
                  ],
                  url: "https://www.axatp.com/student-insurance",
                },
              ].map((prod) => (
                <div key={prod.id} className="product-rec-card">
                  <div className="product-rec-top">
                    <div className="flex items-center gap-3">
                      <div className="product-rec-logo-box">{prod.brand}</div>
                      <div className="product-rec-meta">
                        <h4>{prod.name}</h4>
                        <span className="comparison-prod-badge">{prod.badge}</span>
                      </div>
                    </div>
                  </div>

                  <ul className="product-features-list">
                    {prod.features.map((feat, i) => (
                      <li key={i}>
                        <Check size={14} className="text-emerald-600 shrink-0" />
                        <span>{feat}</span>
                      </li>
                    ))}
                  </ul>

                  <div className="product-rec-footer">
                    <label className="flex items-center gap-2 text-xs text-gray-700 cursor-pointer font-medium">
                      <input
                        type="checkbox"
                        checked={selectedProductIds.includes(prod.id)}
                        onChange={() => toggleProductSelect(prod.id)}
                        className="rounded border-gray-300 text-emerald-600 focus:ring-emerald-500"
                      />
                      <span>Compare</span>
                    </label>

                    <a
                      href={prod.url}
                      target="_blank"
                      rel="noreferrer"
                      className="get-quote-btn"
                    >
                      Get Quote <ExternalLink size={12} />
                    </a>
                  </div>
                </div>
              ))}
            </div>

            {/* Sticky Compare Bar when products are selected */}
            {selectedProductIds.length >= 2 && (
              <div className="compare-sticky-bar">
                <span className="text-xs font-medium">
                  {selectedProductIds.length} products selected to compare
                </span>
                <button
                  type="button"
                  className="px-3.5 py-1.5 bg-emerald-500 text-white text-xs font-semibold rounded-lg hover:bg-emerald-600 transition-colors"
                  onClick={() => handleOpenCompare()}
                  disabled={comparing}
                >
                  {comparing ? "Comparing…" : "Compare Products →"}
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* =========================================================================
          SCREEN 6: Product Comparison (Modal)
         ========================================================================= */}
      {showCompareModal && comparisonData && (
        <div className="modal-overlay" onClick={() => setShowCompareModal(false)}>
          <div className="comparison-modal-card" onClick={(e) => e.stopPropagation()}>
            <button
              type="button"
              className="modal-close-btn"
              onClick={() => setShowCompareModal(false)}
              aria-label="Close"
            >
              <X size={16} />
            </button>

            <div className="mb-4">
              <h3 className="text-xl font-bold text-gray-900">Compare Insurance Options</h3>
              <p className="text-xs text-gray-500">
                Compare key benefits and find the option that fits you best.
              </p>
            </div>

            <div className="overflow-x-auto">
              <table className="comparison-table">
                <thead>
                  <tr>
                    <th className="comparison-feature-name">Benefit / Feature</th>
                    {comparisonData.products.map((p) => (
                      <th key={p.product_id} style={{ width: `${75 / comparisonData.products.length}%` }}>
                        <div className="comparison-prod-header">
                          <strong className="text-emerald-800">{p.insurer_name}</strong>
                          <span className="text-xs text-gray-700">{p.product_name}</span>
                          {p.badge && <span className="comparison-prod-badge">{p.badge}</span>}
                        </div>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {comparisonData.comparison_matrix.map((row, idx) => (
                    <tr key={idx}>
                      <td className="comparison-feature-name">{row.feature_name}</td>
                      {comparisonData.products.map((p) => {
                        const val = (row.values as Record<string, string> | undefined)?.[p.product_id] || "—";
                        const isYes = val.toLowerCase().startsWith("yes");
                        return (
                          <td key={p.product_id} className="text-xs text-gray-700">
                            {isYes ? (
                              <span className="inline-flex items-center gap-1 text-emerald-700 font-medium">
                                <Check size={14} /> {val}
                              </span>
                            ) : (
                              val
                            )}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                  <tr>
                    <td className="comparison-feature-name">Action</td>
                    {comparisonData.products.map((p) => (
                      <td key={p.product_id}>
                        <a
                          href={p.official_url}
                          target="_blank"
                          rel="noreferrer"
                          className="get-quote-btn"
                        >
                          Get Quote <ExternalLink size={12} />
                        </a>
                      </td>
                    ))}
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* =========================================================================
          SCREEN 7: View All Needs (Drawer)
         ========================================================================= */}
      {showAllNeedsDrawer && (
        <div className="drawer-overlay" onClick={() => setShowAllNeedsDrawer(false)}>
          <div className="drawer-panel" onClick={(e) => e.stopPropagation()}>
            <div className="drawer-header">
              <h3>All Protection Needs</h3>
              <button
                type="button"
                className="modal-close-btn"
                onClick={() => setShowAllNeedsDrawer(false)}
                aria-label="Close"
              >
                <X size={16} />
              </button>
            </div>

            {/* Filter chips: All, Covered, Need Attention, Unknown */}
            <div className="flex gap-2 mb-4 overflow-x-auto pb-1">
              {[
                { id: "all", label: `All (${assessment?.needs.length ?? 6})` },
                { id: "covered", label: `Covered (${assessment?.summary.covered_count ?? 3})` },
                { id: "attention", label: `Need Attention (${assessment?.summary.attention_count ?? 2})` },
                { id: "unknown", label: `Unknown (${assessment?.summary.unknown_count ?? 1})` },
              ].map((chip) => (
                <button
                  key={chip.id}
                  type="button"
                  className={`px-3 py-1 rounded-full text-xs font-semibold border transition-all whitespace-nowrap ${
                    allNeedsFilter === chip.id
                      ? "bg-emerald-600 text-white border-emerald-600"
                      : "bg-gray-100 text-gray-600 border-gray-200 hover:bg-gray-200"
                  }`}
                  onClick={() => setAllNeedsFilter(chip.id as "all" | "covered" | "attention" | "unknown")}
                >
                  {chip.label}
                </button>
              ))}
            </div>

            {/* List of All Needs */}
            <div className="space-y-3 flex-1 overflow-y-auto">
              {filteredAllNeeds.map((need) => (
                <div
                  key={need.need_code}
                  className="p-3.5 border border-gray-200 rounded-xl hover:border-emerald-400 cursor-pointer flex items-center justify-between gap-3 transition-colors"
                  onClick={() => {
                    setSelectedNeed(need);
                    setNeedDrawerTab("overview");
                  }}
                >
                  <div className="flex items-center gap-3">
                    <span className="need-icon-box">{renderNeedIcon(need.icon)}</span>
                    <div>
                      <strong className="block text-sm text-gray-900">{need.title}</strong>
                      <small className="text-gray-500 line-clamp-1">{need.description}</small>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className={`need-status-pill ${need.status.toLowerCase()}`}>
                      {need.status_label}
                    </span>
                    <ChevronRight size={16} className="text-gray-400" />
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
