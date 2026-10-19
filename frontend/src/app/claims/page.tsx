"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  Clock,
  FileCheck2,
  FileText,
  Plus,
  Search,
  ShieldCheck,
  User,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/lib/auth";
import { ensureActiveDemoSession, getWorkflowHeaders, getWorkflowUrl } from "@/lib/api/workflow-client";
import "./claims.css";

interface WorkflowOverview {
  stats: {
    total_cases: number;
    open_cases: number;
    ready_to_submit: number;
    awaiting_approval: number;
  };
  awaiting_approval_banner: {
    action_id: string;
    action_reference: string;
    title: string;
    purpose: string;
    claim_id: string | null;
  } | null;
  recent_activity: Array<{
    id: string;
    event_type: string;
    category: string;
    title: string;
    summary: string;
    actor_type: string;
    created_at: string;
  }>;
  available_policies: Array<{
    ref: string;
    name: string;
    provider: string;
    kind: string;
    country_code: string;
  }>;
}

interface WorkflowCaseItem {
  id: string;
  reference: string;
  title: string;
  claim_type: string;
  country_code: string;
  policy_label?: string | null;
  status: string;
  status_label: string;
  updated_at: string;
}

export default function ClaimsPage() {
  const { account, token: accountToken } = useAuth();

  const [overview, setOverview] = useState<WorkflowOverview | null>(null);
  const [cases, setCases] = useState<WorkflowCaseItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Filters
  const [activeTab, setActiveTab] = useState("ALL");
  const [searchQuery, setSearchQuery] = useState("");

  // New Claim Modal
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [selectedPolicyRef, setSelectedPolicyRef] = useState("");
  const [claimType, setClaimType] = useState("General Practitioner / Outpatient");
  const [claimTitle, setClaimTitle] = useState("");
  const [creatingCase, setCreatingCase] = useState(false);

  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      if (!accountToken) {
        await ensureActiveDemoSession();
      }
      const headers = getWorkflowHeaders(accountToken);
      const [overviewRes, casesRes] = await Promise.all([
        fetch(getWorkflowUrl("/api/v1/workflow/claims/overview"), { headers }).then((r) => {
          if (!r.ok) throw new Error(`Overview HTTP ${r.status}`);
          return r.json();
        }),
        fetch(getWorkflowUrl("/api/v1/workflow/claims/cases"), { headers }).then((r) => {
          if (!r.ok) throw new Error(`Cases HTTP ${r.status}`);
          return r.json();
        }),
      ]);
      setOverview(overviewRes);
      setCases(casesRes.cases || []);
    } catch (err) {
      console.error("Failed to load claims workflow:", err);
      setError("Could not load claims workflow data. Please try again.");
    } finally {
      setLoading(false);
    }
  }, [accountToken]);

  useEffect(() => {
    void Promise.resolve().then(loadData);
  }, [loadData]);

  const handleCreateCase = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedPolicyRef) {
      alert("Please select a policy.");
      return;
    }
    setCreatingCase(true);
    try {
      const headers = getWorkflowHeaders(accountToken);
      headers["Content-Type"] = "application/json";
      const res = await fetch(getWorkflowUrl("/api/v1/workflow/claims/cases"), {
        method: "POST",
        headers,
        body: JSON.stringify({
          coverage_ref: selectedPolicyRef,
          claim_type: claimType,
          title: claimTitle || claimType,
          insured_person: "Self",
        }),
      });
      if (!res.ok) {
        const errorData = await res.json().catch(() => ({}));
        throw new Error(errorData.message || "Failed to create claim case");
      }
      setIsModalOpen(false);
      setSelectedPolicyRef("");
      setClaimTitle("");
      await loadData();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Error creating claim");
    } finally {
      setCreatingCase(false);
    }
  };

  // Filter cases
  const filteredCases = cases.filter((c) => {
    const matchesTab = (() => {
      switch (activeTab) {
        case "DRAFT":
          return c.status === "DRAFT";
        case "READY":
          return c.status === "READY_FOR_APPROVAL";
        case "SUBMITTED":
          return (
            c.status === "SUBMITTED_TO_SANDBOX" ||
            c.status === "PROCESSING_IN_SANDBOX" ||
            c.status === "APPROVED_IN_SANDBOX"
          );
        case "NEEDS_ACTION":
          return (
            c.status === "MISSING_EVIDENCE" ||
            c.status === "NEEDS_REVIEW" ||
            c.status === "AWAITING_APPROVAL" ||
            c.status === "ADDITIONAL_INFO_REQUIRED"
          );
        default:
          return true;
      }
    })();

    if (!matchesTab) return false;
    if (!searchQuery.trim()) return true;

    const q = searchQuery.toLowerCase();
    return (
      c.reference.toLowerCase().includes(q) ||
      c.title.toLowerCase().includes(q) ||
      (c.policy_label && c.policy_label.toLowerCase().includes(q)) ||
      c.claim_type.toLowerCase().includes(q)
    );
  });

  const getStatusBadge = (status: string, label: string) => {
    switch (status) {
      case "READY_FOR_APPROVAL":
        return <span className="status-chip status-chip-ready"><CheckCircle2 size={13} /> Ready for Approval</span>;
      case "MISSING_EVIDENCE":
        return <span className="status-chip status-chip-needs-docs"><AlertTriangle size={13} /> Needs Documents</span>;
      case "NEEDS_REVIEW":
        return <span className="status-chip status-chip-review"><FileCheck2 size={13} /> Ready for Review</span>;
      case "SUBMITTED_TO_SANDBOX":
      case "PROCESSING_IN_SANDBOX":
      case "APPROVED_IN_SANDBOX":
        return <span className="status-chip status-chip-submitted"><Clock size={13} /> Submitted</span>;
      case "AWAITING_APPROVAL":
        return <span className="status-chip status-chip-awaiting"><Clock size={13} /> Awaiting Approval</span>;
      default:
        return <span className="status-chip status-chip-draft">{label || "Draft"}</span>;
    }
  };

  const formatRelativeTime = (isoString: string) => {
    try {
      const date = new Date(isoString);
      const now = new Date();
      const diffMs = now.getTime() - date.getTime();
      const diffHours = Math.round(diffMs / (1000 * 60 * 60));
      if (diffHours < 1) return "Just now";
      if (diffHours === 1) return "1 hour ago";
      if (diffHours < 24) return `${diffHours} hours ago`;
      const diffDays = Math.round(diffHours / 24);
      if (diffDays === 1) return "Yesterday";
      if (diffDays < 7) return `${diffDays} days ago`;
      const diffWeeks = Math.round(diffDays / 7);
      return `${diffWeeks} week${diffWeeks > 1 ? "s" : ""} ago`;
    } catch {
      return "Recently";
    }
  };

  return (
    <div className="claims-workspace">
      {/* Top Hero Banner if action is awaiting approval (Matching Screenshot 1) */}
      {overview?.awaiting_approval_banner && (
        <div className="claims-hero-banner" role="alert">
          <div className="claims-hero-banner-content">
            <div className="claims-hero-banner-icon">
              <AlertTriangle size={22} />
            </div>
            <div>
              <div className="claims-hero-banner-title">
                1 Action Awaiting Approval
              </div>
              <div className="claims-hero-banner-sub">
                INSURRA prepared &apos;{overview.awaiting_approval_banner.title}&apos;. Review the details and consequences before anything runs.
              </div>
            </div>
          </div>
          <Link
            href="/actions"
            className="claims-hero-banner-btn"
          >
            Review Action <ArrowRight size={15} />
          </Link>
        </div>
      )}

      {/* Heading */}
      <div className="claims-heading">
        <div>
          <h1>Claims Center</h1>
          <p>
            Prepare, review, and track insurance claims with guided document extraction and automated readiness checks.
          </p>
        </div>
        <div className="claims-heading-actions">
          {account ? (
            <span className="claims-tag claims-tag-account">
              <User size={13} /> {account.display_name || account.email}
            </span>
          ) : (
            <span className="claims-tag">
              <ShieldCheck size={13} /> Demo Account · KB Verified
            </span>
          )}
          <Button
            onClick={() => setIsModalOpen(true)}
            className="bg-teal-700 hover:bg-teal-800 text-white font-semibold flex items-center gap-1.5 shadow-sm"
          >
            <Plus size={16} /> New Claim
          </Button>
        </div>
      </div>

      {error && (
        <div className="p-3.5 mb-6 bg-red-50 border border-red-200 text-red-700 text-xs font-semibold rounded-xl">
          {error}
        </div>
      )}

      {/* Summary Stat Cards (Matching Screenshot 1) */}
      <div className="claims-stats-row">
        <div className="claims-stat-card">
          <div className="claims-stat-card-title">
            <span>Open Claim Cases</span>
            <FileText size={18} className="text-slate-400" />
          </div>
          <div className="claims-stat-card-number">
            {loading ? "—" : overview?.stats.open_cases ?? 0}
          </div>
          <p className="claims-stat-card-subtitle">
            {overview?.stats.total_cases ?? 0} total cases in system
          </p>
        </div>

        <div className="claims-stat-card">
          <div className="claims-stat-card-title">
            <span>Ready to Submit</span>
            <CheckCircle2 size={18} className="text-emerald-500" />
          </div>
          <div className="claims-stat-card-number">
            {loading ? "—" : overview?.stats.ready_to_submit ?? 0}
          </div>
          <p className="claims-stat-card-subtitle">
            All required evidence confirmed
          </p>
        </div>

        <div className="claims-stat-card">
          <div className="claims-stat-card-title">
            <span>Awaiting Approval</span>
            <Clock size={18} className="text-amber-500" />
          </div>
          <div className="claims-stat-card-number">
            {loading ? "—" : overview?.stats.awaiting_approval ?? 0}
          </div>
          <p className="claims-stat-card-subtitle">
            Action queued for your decision
          </p>
        </div>
      </div>

      {/* Main 2-column layout */}
      <div className="claims-main-layout">
        {/* Left Column: Claims Cases Table */}
        <div className="claims-left-col">
          <div className="claims-panel-card">
            {/* Tabs Bar */}
            <div className="claims-tabs-bar">
              <button
                type="button"
                className={`claims-tab-btn ${activeTab === "ALL" ? "is-active" : ""}`}
                onClick={() => setActiveTab("ALL")}
              >
                All ({cases.length})
              </button>
              <button
                type="button"
                className={`claims-tab-btn ${activeTab === "DRAFT" ? "is-active" : ""}`}
                onClick={() => setActiveTab("DRAFT")}
              >
                Draft ({cases.filter((c) => c.status === "DRAFT").length})
              </button>
              <button
                type="button"
                className={`claims-tab-btn ${activeTab === "READY" ? "is-active" : ""}`}
                onClick={() => setActiveTab("READY")}
              >
                Ready ({cases.filter((c) => c.status === "READY_FOR_APPROVAL").length})
              </button>
              <button
                type="button"
                className={`claims-tab-btn ${activeTab === "SUBMITTED" ? "is-active" : ""}`}
                onClick={() => setActiveTab("SUBMITTED")}
              >
                Submitted ({cases.filter((c) => c.status.includes("SANDBOX")).length})
              </button>
              <button
                type="button"
                className={`claims-tab-btn ${activeTab === "NEEDS_ACTION" ? "is-active" : ""}`}
                onClick={() => setActiveTab("NEEDS_ACTION")}
              >
                Needs Action ({cases.filter((c) => ["MISSING_EVIDENCE", "NEEDS_REVIEW", "AWAITING_APPROVAL"].includes(c.status)).length})
              </button>
            </div>

            {/* Search Bar */}
            <div className="claims-search-bar">
              <div className="relative">
                <input
                  type="text"
                  placeholder="Search claims by reference, type, policy..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="claims-search-input pl-10"
                />
                <Search size={16} className="absolute left-3.5 top-3 text-slate-400" />
              </div>
            </div>

            {/* Table */}
            <div className="claims-table-wrapper">
              <table className="claims-table">
                <thead>
                  <tr>
                    <th>Claim Reference</th>
                    <th>Type</th>
                    <th>Policy</th>
                    <th>Status</th>
                    <th>Last Updated</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {loading && (
                    <tr>
                      <td colSpan={6} className="py-12 text-center text-slate-400">
                        Loading claim cases...
                      </td>
                    </tr>
                  )}
                  {!loading && filteredCases.length === 0 && (
                    <tr>
                      <td colSpan={6} className="py-12 text-center text-slate-400">
                        No claim cases found matching your criteria.
                      </td>
                    </tr>
                  )}
                  {!loading &&
                    filteredCases.map((item) => (
                      <tr key={item.id}>
                        <td className="claim-ref-cell">{item.reference}</td>
                        <td className="claim-title-cell">{item.title}</td>
                        <td className="claim-policy-cell">
                          {item.policy_label || "Standard Cover"}
                        </td>
                        <td>{getStatusBadge(item.status, item.status_label)}</td>
                        <td className="claim-date-cell">
                          {formatRelativeTime(item.updated_at)}
                        </td>
                        <td>
                          <Link
                            href={`/claims/${item.id}`}
                            className="claim-action-btn"
                          >
                            View Claim <ArrowRight size={13} />
                          </Link>
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        {/* Right Column: "How claims work" & "Recent Activity" (Screenshot 1) */}
        <div className="claims-right-col">
          {/* How Claims Work */}
          <div className="how-claims-work-card">
            <h3 className="how-claims-work-title">How claims work</h3>
            <div className="how-step">
              <div className="how-step-num">1</div>
              <div className="how-step-content">
                <h4>Prepare</h4>
                <p>
                  Upload receipts and documents. INSURRA extracts fields with conservative confidence.
                </p>
              </div>
            </div>

            <div className="how-step">
              <div className="how-step-num">2</div>
              <div className="how-step-content">
                <h4>Submit</h4>
                <p>
                  Every submission requires your explicit, cryptographic approval first.
                </p>
              </div>
            </div>

            <div className="how-step">
              <div className="how-step-num">3</div>
              <div className="how-step-content">
                <h4>Track</h4>
                <p>
                  Follow status in the insurer sandbox or through automated polling.
                </p>
              </div>
            </div>
          </div>

          {/* Recent Activity */}
          <div className="recent-activity-card">
            <div className="flex items-center justify-between mb-4">
              <h3 className="how-claims-work-title mb-0">Recent Activity</h3>
              <Link href="/audit" className="text-xs text-teal-700 font-semibold hover:underline">
                View All
              </Link>
            </div>

            {loading && <p className="text-sm text-slate-400">Loading activity...</p>}
            {!loading && (!overview?.recent_activity || overview.recent_activity.length === 0) && (
              <p className="text-sm text-slate-400">No recent activity recorded.</p>
            )}
            {!loading &&
              overview?.recent_activity.slice(0, 4).map((act) => (
                <div key={act.id} className="activity-item">
                  <div className="activity-icon">
                    <FileText size={16} />
                  </div>
                  <div className="activity-details">
                    <h5>{act.title}</h5>
                    <p>{act.summary}</p>
                    <small>{formatRelativeTime(act.created_at)}</small>
                  </div>
                </div>
              ))}
          </div>
        </div>
      </div>

      {/* Modal: Create New Claim */}
      {isModalOpen && (
        <div className="modal-overlay" onClick={() => setIsModalOpen(false)}>
          <div className="modal-card" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3 className="modal-title">Create New Claim Case</h3>
              <button
                type="button"
                onClick={() => setIsModalOpen(false)}
                className="text-slate-400 hover:text-slate-600"
              >
                <X size={20} />
              </button>
            </div>
            <form onSubmit={handleCreateCase}>
              <div className="modal-form-group">
                <label>Select Covered Policy</label>
                <select
                  value={selectedPolicyRef}
                  onChange={(e) => setSelectedPolicyRef(e.target.value)}
                  required
                >
                  <option value="">-- Choose Policy --</option>
                  {overview?.available_policies.map((p) => (
                    <option key={p.ref} value={p.ref}>
                      {p.name} ({p.provider})
                    </option>
                  ))}
                </select>
              </div>

              <div className="modal-form-group">
                <label>Claim Category / Type</label>
                <select
                  value={claimType}
                  onChange={(e) => setClaimType(e.target.value)}
                >
                  <option value="General Practitioner / Outpatient">General Practitioner / Outpatient</option>
                  <option value="Emergency Care">Emergency Care</option>
                  <option value="Medical Expenses">Medical Expenses</option>
                  <option value="Hospitalization / Inpatient">Hospitalization / Inpatient</option>
                  <option value="Prescription Medication">Prescription Medication</option>
                  <option value="Trip Cancellation">Trip Cancellation</option>
                </select>
              </div>

              <div className="modal-form-group">
                <label>Claim Title / Description</label>
                <input
                  type="text"
                  placeholder="e.g. Outpatient Clinic Visit"
                  value={claimTitle}
                  onChange={(e) => setClaimTitle(e.target.value)}
                />
              </div>

              <div className="modal-actions">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setIsModalOpen(false)}
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  disabled={creatingCase}
                  className="bg-teal-700 hover:bg-teal-800 text-white font-semibold"
                >
                  {creatingCase ? "Creating..." : "Start Claim Case"}
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
