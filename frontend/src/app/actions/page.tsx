"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import {
  AlertTriangle,
  ArrowLeft,
  Check,
  CheckCircle2,
  Clock,
  Compass,
  Copy,
  Edit3,
  ExternalLink,
  FileCheck2,
  FileText,
  Home,
  KeyRound,
  Play,
  Send,
  ShieldCheck,
  User,
  XCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { ConsentPrompt } from "@/components/workspace/consent-prompt";
import { InsurraMascot } from "@/components/brand/insurra-mascot";
import { useAuth } from "@/lib/auth";
import {
  getWorkflowHeaders,
  getWorkflowUrl,
  type WorkflowActionQueueResponse,
  type WorkflowActionView,
  type WorkflowExecutionReceipt,
} from "@/lib/api/workflow-client";
import { sanitizeCopywriting } from "@/lib/sanitize-copywriting";
import "./actions.css";

export default function ActionsPage() {
  const { account, token: accountToken } = useAuth();
  const [data, setData] = useState<WorkflowActionQueueResponse | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<"PENDING" | "COMPLETED" | "REJECTED" | "ALL">("PENDING");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Decision states
  const [deciding, setDeciding] = useState(false);
  const [rejectionReason, setRejectionReason] = useState("");
  const [showRejectInput, setShowRejectInput] = useState(false);
  const [receipt, setReceipt] = useState<WorkflowExecutionReceipt | null>(null);
  const [copied, setCopied] = useState(false);
  const [requiredConsents, setRequiredConsents] = useState<string[] | null>(null);

  // Edit payload states
  const [editing, setEditing] = useState(false);
  const [editDraft, setEditDraft] = useState<Record<string, string>>({});

  const loadActions = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const headers = getWorkflowHeaders(accountToken);
      const res = await fetch(getWorkflowUrl("/api/v1/workflow/actions/queue"), { headers });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const result: WorkflowActionQueueResponse = await res.json();
      setData(result);

      const queryActionId =
        typeof window !== "undefined"
          ? new URLSearchParams(window.location.search).get("action")
          : null;

      if (result.actions.length > 0) {
        if (queryActionId && result.actions.some((a) => a.id === queryActionId)) {
          const target = result.actions.find((a) => a.id === queryActionId)!;
          if (
            target.status !== "AWAITING_APPROVAL" &&
            target.status !== "DRAFT" &&
            target.status !== "APPROVED"
          ) {
            setActiveTab("ALL");
          }
          setSelectedId(queryActionId);
        } else {
          setSelectedId((curr) => {
            if (curr && result.actions.some((a) => a.id === curr)) return curr;
            return result.actions[0].id;
          });
        }
      } else {
        setSelectedId(null);
      }
    } catch (err) {
      console.error("Error loading action queue:", err);
      setError("Failed to load actions queue.");
    } finally {
      setLoading(false);
    }
  }, [accountToken]);

  useEffect(() => {
    void Promise.resolve().then(loadActions);
  }, [loadActions]);

  const selectedAction: WorkflowActionView | null =
    data?.actions.find((a) => a.id === selectedId) || null;

  // Load existing receipt if already executed
  useEffect(() => {
    if (!selectedAction) {
      void Promise.resolve().then(() => setReceipt(null));
      return;
    }
    if (
      selectedAction.status === "COMPLETED" ||
      selectedAction.status === "HANDOFF_READY" ||
      selectedAction.receipt_reference
    ) {
      const headers = getWorkflowHeaders(accountToken);
      void Promise.resolve().then(() => {
        fetch(getWorkflowUrl(`/api/v1/workflow/actions/${selectedAction.id}/receipt`), { headers })
          .then((r) => (r.ok ? r.json() : null))
          .then((rec: WorkflowExecutionReceipt | null) => setReceipt(rec))
          .catch(() => setReceipt(null));
      });
    } else {
      void Promise.resolve().then(() => setReceipt(null));
    }
  }, [selectedAction, accountToken]);

  const startEditing = () => {
    if (!selectedAction) return;
    const initial: Record<string, string> = {};
    for (const field of selectedAction.editable_fields || []) {
      const val = selectedAction.payload?.[field];
      initial[field] = typeof val === "string" ? val : val != null ? String(val) : "";
    }
    setEditDraft(initial);
    setEditing(true);
  };

  const handleSaveEdit = async () => {
    if (!selectedAction) return;
    setDeciding(true);
    setError(null);
    try {
      const headers = getWorkflowHeaders(accountToken);
      headers["Content-Type"] = "application/json";
      const res = await fetch(getWorkflowUrl(`/api/v1/workflow/actions/${selectedAction.id}`), {
        method: "PATCH",
        headers,
        body: JSON.stringify({ changes: editDraft }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.message || "Failed to update action payload");
      }
      setEditing(false);
      await loadActions();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error saving payload edits");
    } finally {
      setDeciding(false);
    }
  };

  const handleApproveOnly = async () => {
    if (!selectedAction) return;
    setDeciding(true);
    setError(null);
    try {
      const headers = getWorkflowHeaders(accountToken);
      headers["Content-Type"] = "application/json";
      const appRes = await fetch(
        getWorkflowUrl(`/api/v1/workflow/actions/${selectedAction.id}/approve`),
        {
          method: "POST",
          headers,
          body: JSON.stringify({
            payload_sha256: selectedAction.payload_sha256,
            payload_version: selectedAction.payload_version ?? 1,
          }),
        }
      );
      if (appRes.status === 403) {
        const appErr = await appRes.json().catch(() => ({}));
        setRequiredConsents(appErr?.details?.required_purposes || ["process_documents"]);
        return;
      }
      if (!appRes.ok) {
        const appErr = await appRes.json().catch(() => ({}));
        throw new Error(appErr.message || "Approval failed");
      }
      await loadActions();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error approving action");
    } finally {
      setDeciding(false);
    }
  };

  const handleExecuteOnly = async () => {
    if (!selectedAction) return;
    setDeciding(true);
    setError(null);
    try {
      const headers = getWorkflowHeaders(accountToken);
      headers["Content-Type"] = "application/json";
      const execRes = await fetch(
        getWorkflowUrl(`/api/v1/workflow/actions/${selectedAction.id}/execute`),
        {
          method: "POST",
          headers,
        }
      );
      if (execRes.status === 403) {
        const execErr = await execRes.json().catch(() => ({}));
        if (execErr?.code === "CONSENT_REQUIRED") {
          setRequiredConsents(execErr?.details?.required_purposes || ["process_documents"]);
          await loadActions();
          return;
        }
        throw new Error(execErr.message || "Action execution blocked by approval boundary");
      }
      if (!execRes.ok) {
        const execErr = await execRes.json().catch(() => ({}));
        throw new Error(execErr.message || "Execution failed");
      }
      const execData = await execRes.json();
      setReceipt(execData.receipt);
      await loadActions();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error executing action");
    } finally {
      setDeciding(false);
    }
  };

  const handleApproveAndExecute = async () => {
    if (!selectedAction) return;
    setDeciding(true);
    setError(null);
    try {
      const headers = getWorkflowHeaders(accountToken);
      headers["Content-Type"] = "application/json";

      if (!selectedAction.approved && selectedAction.requires_approval) {
        const appRes = await fetch(
          getWorkflowUrl(`/api/v1/workflow/actions/${selectedAction.id}/approve`),
          {
            method: "POST",
            headers,
            body: JSON.stringify({
              payload_sha256: selectedAction.payload_sha256,
              payload_version: selectedAction.payload_version ?? 1,
            }),
          }
        );
        if (appRes.status === 403) {
          const appErr = await appRes.json().catch(() => ({}));
          setRequiredConsents(appErr?.details?.required_purposes || ["process_documents"]);
          return;
        }
        if (!appRes.ok) {
          const appErr = await appRes.json().catch(() => ({}));
          throw new Error(appErr.message || "Approval failed");
        }
      }

      const execRes = await fetch(
        getWorkflowUrl(`/api/v1/workflow/actions/${selectedAction.id}/execute`),
        {
          method: "POST",
          headers,
        }
      );
      if (execRes.status === 403) {
        const execErr = await execRes.json().catch(() => ({}));
        if (execErr?.code === "CONSENT_REQUIRED") {
          setRequiredConsents(execErr?.details?.required_purposes || ["process_documents"]);
          await loadActions();
          return;
        }
        throw new Error(execErr.message || "Execution blocked");
      }
      if (!execRes.ok) {
        const execErr = await execRes.json().catch(() => ({}));
        throw new Error(execErr.message || "Execution failed");
      }
      const execData = await execRes.json();
      setReceipt(execData.receipt);
      await loadActions();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error executing action");
    } finally {
      setDeciding(false);
    }
  };

  const handleReject = async () => {
    if (!selectedAction) return;
    setDeciding(true);
    try {
      const headers = getWorkflowHeaders(accountToken);
      headers["Content-Type"] = "application/json";
      const res = await fetch(getWorkflowUrl(`/api/v1/workflow/actions/${selectedAction.id}/reject`), {
        method: "POST",
        headers,
        body: JSON.stringify({ reason: rejectionReason || "Rejected by user" }),
      });
      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.message || "Rejection failed");
      }
      setShowRejectInput(false);
      setRejectionReason("");
      await loadActions();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error rejecting action");
    } finally {
      setDeciding(false);
    }
  };

  const copyHash = () => {
    if (!selectedAction) return;
    navigator.clipboard.writeText(selectedAction.payload_sha256);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  // Filter actions based on activeTab
  const visibleActions = (data?.actions || []).filter((item) => {
    switch (activeTab) {
      case "PENDING":
        return (
          item.status === "AWAITING_APPROVAL" ||
          item.status === "DRAFT" ||
          item.status === "APPROVED"
        );
      case "COMPLETED":
        return item.status === "COMPLETED" || item.status === "HANDOFF_READY";
      case "REJECTED":
        return (
          item.status === "REJECTED" ||
          item.status === "CANCELLED" ||
          item.status === "EXPIRED" ||
          item.status === "FAILED"
        );
      default:
        return true;
    }
  });

  return (
    <div className="actions-workspace">
      {/* Top Navigation / Back to Menu */}
      <div className="actions-nav-bar">
        <Link href="/claims" className="actions-back-btn">
          <ArrowLeft size={15} />
          <span>Kembali ke Claims Center</span>
        </Link>
        <span className="actions-nav-sep">•</span>
        <Link href="/home" className="actions-nav-home">
          <Home size={14} />
          <span>Dashboard Menu</span>
        </Link>
      </div>

      {/* Header */}
      <div className="actions-heading">
        <div>
          <div className="actions-pre-badge">
            <ShieldCheck size={13} />
            <span>Persetujuan Kriptografis Tindakan</span>
          </div>
          <h1>Action Approval Boundary</h1>
          <p>
            Tinjau dan setujui tindakan yang disiapkan oleh INSSURA. Tidak ada tindakan eksternal atau pengiriman ke lingkungan asuransi yang dilakukan tanpa persetujuan eksplisit Anda.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {account ? (
            <span className="claims-tag claims-tag-account">
              <User size={13} /> {account.display_name || account.email}
            </span>
          ) : (
            <span className="claims-tag">
              <ShieldCheck size={13} /> Demo Boundary
            </span>
          )}
          <Button asChild variant="outline" size="sm">
            <Link href="/audit">
              <Clock size={14} className="mr-1.5" /> View Audit Trail
            </Link>
          </Button>
        </div>
      </div>

      {requiredConsents && (
        <ConsentPrompt
          purposes={requiredConsents}
          accountToken={accountToken}
          onGranted={() => {
            setRequiredConsents(null);
            void handleApproveAndExecute();
          }}
          onCancel={() => setRequiredConsents(null)}
        />
      )}

      {error && (
        <div
          role="alert"
          data-testid="actions-error-alert"
          style={{
            background: "#fef2f2",
            border: "1px solid #fecaca",
            color: "#991b1b",
            padding: "12px 16px",
            borderRadius: 10,
            marginBottom: 16,
            fontSize: 13,
            fontWeight: 600,
          }}
        >
          {error}
        </div>
      )}

      {/* Security Mascot Banner */}
      <div className="actions-security-mascot-card">
        <div className="actions-mascot-img-wrap">
          <InsurraMascot variant="shield" size={68} priority />
        </div>
        <div className="actions-mascot-card-body">
          <div className="actions-mascot-card-badge">
            <ShieldCheck size={13} />
            <span>Cryptographic Approval Security Boundary</span>
          </div>
          <h3 className="actions-mascot-card-title">Batas Keamanan &amp; Izin Kriptografis</h3>
          <p className="actions-mascot-card-text">
            Persetujuan Anda terikat secara kriptografis dengan SHA-256 hash dan versi muatan server yang ditinjau. Jika data atau bukti medis di server berubah, persetujuan akan otomatis dibatalkan seketika demi keamanan Anda.
          </p>
        </div>
      </div>

      {/* 2-Column Layout */}
      <div className="actions-grid">
        {/* Left Column: Action Queue */}
        <div className="actions-card">
          <div className="actions-tabs-header">
            <button
              type="button"
              className={`actions-tab-btn ${activeTab === "PENDING" ? "is-active" : ""}`}
              onClick={() => setActiveTab("PENDING")}
            >
              Pending Approval ({data?.counts.pending ?? 0})
            </button>
            <button
              type="button"
              className={`actions-tab-btn ${activeTab === "COMPLETED" ? "is-active" : ""}`}
              onClick={() => setActiveTab("COMPLETED")}
            >
              Completed ({data?.counts.completed ?? 0})
            </button>
            <button
              type="button"
              className={`actions-tab-btn ${activeTab === "REJECTED" ? "is-active" : ""}`}
              onClick={() => setActiveTab("REJECTED")}
            >
              Rejected ({data?.counts.rejected ?? 0})
            </button>
            <button
              type="button"
              className={`actions-tab-btn ${activeTab === "ALL" ? "is-active" : ""}`}
              onClick={() => setActiveTab("ALL")}
            >
              All ({data?.counts.all ?? 0})
            </button>
          </div>

          <div className="actions-list">
            {loading && <p className="text-center py-10 text-slate-400 text-sm">Memuat daftar tindakan...</p>}
            {!loading && visibleActions.length === 0 && (
              <div className="text-center py-12 px-4 text-slate-400">
                <div className="mb-3 flex justify-center">
                  <InsurraMascot variant="checklist" size={64} decorative />
                </div>
                <p className="text-sm font-bold text-slate-700">Tidak ada tindakan di antrean ini</p>
                <p className="text-xs text-slate-500 mt-1 max-w-xs mx-auto">
                  Tindakan akan otomatis muncul ketika formulir klaim, pengingat, atau surat ke pihak asuransi disiapkan untuk ditinjau.
                </p>
              </div>
            )}
            {!loading &&
              visibleActions.map((act) => (
                <button
                  type="button"
                  key={act.id}
                  data-testid={`action-row-${act.id}`}
                  onClick={() => {
                    setSelectedId(act.id);
                    setEditing(false);
                  }}
                  className={`actions-row ${selectedId === act.id ? "selected" : ""}`}
                >
                  <div className="actions-row-main">
                    <div className="actions-row-title">{sanitizeCopywriting(act.title)}</div>
                    <div className="actions-row-meta">
                      <span className="actions-row-ref">{act.reference}</span>
                      <span className="actions-row-dot">•</span>
                      <span className="actions-row-env">{act.environment_label}</span>
                    </div>
                  </div>
                  <span
                    className={`status-chip ${
                      act.status === "AWAITING_APPROVAL"
                        ? "status-chip-awaiting"
                        : act.status === "COMPLETED" || act.status === "HANDOFF_READY"
                        ? "status-chip-ready"
                        : act.status === "REJECTED" || act.status === "CANCELLED" || act.status === "FAILED"
                        ? "status-chip-rejected"
                        : "status-chip-draft"
                    }`}
                  >
                    {act.status.replace(/_/g, " ")}
                  </span>
                </button>
              ))}
          </div>
        </div>

        {/* Right Column: Selected Action Inspector */}
        <div className="actions-card actions-review-panel" data-testid="action-review-drawer">
          {selectedAction ? (
            <div>
              {/* Review Header */}
              <div className="actions-review-header">
                <div className="actions-review-title-group">
                  <h2 className="actions-review-title">{sanitizeCopywriting(selectedAction.title)}</h2>
                  <p className="actions-review-sub">
                    Action Reference: <strong className="text-slate-800">{selectedAction.reference}</strong> • Created:{" "}
                    {new Date(String(selectedAction.created_at)).toLocaleDateString()}
                  </p>
                </div>
                <div className="actions-review-header-badges">
                  <span
                    className={`status-chip ${
                      selectedAction.status === "AWAITING_APPROVAL"
                        ? "status-chip-awaiting"
                        : selectedAction.status === "COMPLETED" || selectedAction.status === "HANDOFF_READY"
                        ? "status-chip-ready"
                        : selectedAction.status === "REJECTED" || selectedAction.status === "FAILED"
                        ? "status-chip-rejected"
                        : "status-chip-draft"
                    }`}
                    data-testid="action-status-badge"
                  >
                    {selectedAction.status.replace(/_/g, " ")}
                  </span>
                  <span className="status-chip status-chip-draft">
                    {selectedAction.environment_label}
                  </span>
                </div>
              </div>

              {/* Proactive Anti-Lapse Agent Banner */}
              {selectedAction.action_type === "renewal_inquiry" && (
                <div className="mb-4 p-3.5 rounded-xl bg-gradient-to-r from-emerald-950 via-slate-900 to-teal-950 border border-emerald-500/40 text-white shadow-sm">
                  <div className="flex items-center justify-between gap-2 mb-2">
                    <div className="flex items-center gap-2">
                      <span className="w-6 h-6 rounded-lg bg-emerald-500/20 text-emerald-400 grid place-items-center text-xs">
                        🤖
                      </span>
                      <strong className="text-xs font-bold text-emerald-300 uppercase tracking-wider">
                        Autonomous Output: Proactive Renewal &amp; Anti-Lapse Agent
                      </strong>
                    </div>
                    <span className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 font-semibold border border-emerald-500/30">
                      H-30 Horizon Check
                    </span>
                  </div>
                  <p className="text-xs text-slate-300 leading-relaxed mb-2">
                    The agent autonomously detected an upcoming policy expiry or continuity risk and drafted this renewal inquiry using verified policy data.
                  </p>
                  <div className="flex flex-wrap items-center gap-3 text-[11px] text-emerald-200/90 pt-1 border-t border-white/10">
                    <span>🔒 <strong>Rule #8 Guardrail:</strong> Zero automatic purchase or payment.</span>
                    <span>✍️ <strong>User Control:</strong> Inquiry dispatched only upon your explicit approval.</span>
                  </div>
                </div>
              )}

              {/* 3-Step Visual Approval Boundary Guide */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5 mb-5 p-3 bg-slate-50 rounded-xl border border-slate-200">
                <div className="flex items-center gap-2.5 p-2 rounded-lg bg-white border border-slate-200/80">
                  <span className="w-6 h-6 rounded-full bg-teal-700 text-white text-xs font-bold grid place-items-center shrink-0">
                    1
                  </span>
                  <div className="text-xs">
                    <strong className="block text-slate-900">Review Payload</strong>
                    <span className="text-slate-500 text-[11px]">Verify fields &amp; destination</span>
                  </div>
                </div>
                <div className="flex items-center gap-2.5 p-2 rounded-lg bg-white border border-slate-200/80">
                  <span
                    className={`w-6 h-6 rounded-full text-xs font-bold grid place-items-center shrink-0 ${
                      selectedAction.approved || selectedAction.status === "COMPLETED"
                        ? "bg-teal-700 text-white"
                        : "bg-amber-100 text-amber-800"
                    }`}
                  >
                    2
                  </span>
                  <div className="text-xs">
                    <strong className="block text-slate-900">Approve SHA-256</strong>
                    <span className="text-slate-500 text-[11px]">
                      {selectedAction.approved ? "Digest approved" : "Requires your consent"}
                    </span>
                  </div>
                </div>
                <div className="flex items-center gap-2.5 p-2 rounded-lg bg-white border border-slate-200/80">
                  <span
                    className={`w-6 h-6 rounded-full text-xs font-bold grid place-items-center shrink-0 ${
                      selectedAction.status === "COMPLETED" || selectedAction.status === "HANDOFF_READY"
                        ? "bg-emerald-600 text-white"
                        : "bg-slate-200 text-slate-700"
                    }`}
                  >
                    3
                  </span>
                  <div className="text-xs">
                    <strong className="block text-slate-900">Sandbox / Handoff</strong>
                    <span className="text-slate-500 text-[11px]">{selectedAction.environment_label}</span>
                  </div>
                </div>
              </div>

              {/* Action Details Grid */}
              <div className="actions-info-grid">
                <div className="actions-info-item">
                  <span>
                    <Compass size={13} className="text-teal-700" /> Action Purpose
                  </span>
                  <strong>{selectedAction.purpose}</strong>
                </div>
                <div className="actions-info-item">
                  <span>
                    <Send size={13} className="text-teal-700" /> Target Destination
                  </span>
                  <strong>{selectedAction.destination}</strong>
                </div>
                <div className="actions-info-item">
                  <span>
                    <FileText size={13} className="text-teal-700" /> Linked Claim Case
                  </span>
                  <strong>
                    {selectedAction.claim_reference ? (
                      <Link
                        href={`/claims/${selectedAction.claim_id}`}
                        className="text-teal-700 hover:underline flex items-center gap-1"
                      >
                        {selectedAction.claim_reference} <ExternalLink size={13} />
                      </Link>
                    ) : (
                      "No Claim Linked"
                    )}
                  </strong>
                </div>
                <div className="actions-info-item">
                  <span>
                    <ShieldCheck size={13} className="text-teal-700" /> Payload Version
                  </span>
                  <strong data-testid="action-payload-version">
                    Version {String(selectedAction.payload_version ?? "1")}
                    {selectedAction.approved ? " (Approved)" : " (Unapproved)"}
                  </strong>
                </div>
              </div>

              {/* Cryptographic Hash Box */}
              <div className="actions-hash-box">
                <div className="actions-hash-header">
                  <div className="actions-hash-label">
                    <KeyRound size={15} className="text-teal-700" />
                    Payload SHA-256 Digest
                  </div>
                  <button
                    type="button"
                    onClick={copyHash}
                    className="text-xs font-semibold text-teal-700 hover:text-teal-800 flex items-center gap-1"
                  >
                    {copied ? <Check size={13} /> : <Copy size={13} />}
                    {copied ? "Copied" : "Copy Hash"}
                  </button>
                </div>
                <div className="actions-hash-value" data-testid="action-payload-sha256">
                  {selectedAction.payload_sha256}
                </div>
                <div className="actions-hash-caption">
                  {String(selectedAction.consequence ?? "")} {String(selectedAction.privacy_note ?? "")}
                </div>
              </div>

              {/* Consequences Alert Box */}
              {(selectedAction.status === "AWAITING_APPROVAL" || selectedAction.status === "APPROVED") && (
                <div className="actions-consequences-box">
                  <div className="actions-consequences-title">
                    <AlertTriangle size={16} />
                    What happens when you approve and execute this action?
                  </div>
                  <ul className="actions-consequences-list">
                    <li>Cryptographic authorization is bound to payload version {String(selectedAction.payload_version ?? "1")} and SHA-256 digest.</li>
                    <li>
                      {selectedAction.environment === "MANUAL_HANDOFF"
                        ? "Draft prepared. Not sent. INSSURA never sends messages to external insurers automatically."
                        : selectedAction.environment === "SANDBOX"
                        ? "Accepted by the INSSURA test sandbox. No insurer received this."
                        : "Reminder scheduled in INSSURA."}
                    </li>
                    <li>Any edit to the payload increments the version and invalidates prior approval.</li>
                  </ul>
                </div>
              )}

              {/* Execution in Progress Modal / Stepper (Screenshot 2 Step 8) */}
              {deciding && (
                <div className="executing-overlay">
                  <div className="executing-header">
                    <div className="executing-spinner" />
                    <div>
                      <h4 className="font-bold text-slate-900 text-sm">Submitting claim to insurer sandbox...</h4>
                      <p className="text-xs text-slate-500">This may take a few moments. We are executing your approved action.</p>
                    </div>
                  </div>

                  <div className="exec-step-list">
                    <div className="exec-step-item done">
                      <div className="exec-step-dot">✓</div>
                      <span>Approval confirmed</span>
                    </div>
                    <div className="exec-step-item done">
                      <div className="exec-step-dot">✓</div>
                      <span>Validating payload and permissions</span>
                    </div>
                    <div className="exec-step-item active">
                      <div className="exec-step-dot">●</div>
                      <span>Calling Allianz sandbox API</span>
                    </div>
                    <div className="exec-step-item">
                      <div className="exec-step-dot">○</div>
                      <span>Waiting for response</span>
                    </div>
                    <div className="exec-step-item">
                      <div className="exec-step-dot">○</div>
                      <span>Processing result &amp; issuing receipt</span>
                    </div>
                  </div>

                  <div className="mt-4 pt-3 border-t border-slate-100 flex items-center justify-between text-[11px] text-slate-400">
                    <span>Adapter: <strong>Allianz Sandbox API (v1)</strong></span>
                    <span>Operation key: <strong className="font-mono">op_{selectedAction.payload_sha256?.slice(0, 10)}</strong></span>
                  </div>
                </div>
              )}

              {/* Execution Receipt Box (If already executed - Screenshot 2 Step 9) */}
              {receipt && (
                <div className="space-y-4 mb-6">
                  <div className="bg-emerald-50 border border-emerald-200 rounded-2xl p-4 flex items-center justify-between gap-4">
                    <div className="flex items-center gap-3.5">
                      <div className="w-12 h-12 flex-shrink-0 flex items-center justify-center">
                        <InsurraMascot variant="checklist" size={48} decorative />
                      </div>
                      <div>
                        <div className="font-bold text-emerald-950 text-sm">Tindakan Berhasil Disetujui &amp; Dieksekusi!</div>
                        <div className="text-xs text-emerald-800">
                          Tindakan telah dikirim ke sandbox asuransi dan tanda terima digital bertanda tangan kriptografis telah diterbitkan.
                        </div>
                      </div>
                    </div>
                    <Button variant="outline" size="sm" className="bg-white text-xs font-semibold text-emerald-900 border-emerald-300 flex-shrink-0">
                      View Receipt (PDF)
                    </Button>
                  </div>

                  <div className="execution-receipt-card" data-testid="execution-receipt-card">
                    <div className="execution-receipt-header">
                      <div className="execution-receipt-title">
                        <CheckCircle2 size={18} /> Signed Execution Receipt
                      </div>
                      <span className="text-xs font-bold uppercase tracking-wider bg-emerald-200 text-emerald-900 px-2 py-0.5 rounded">
                        {receipt.status}
                      </span>
                    </div>
                    <p className="text-xs text-emerald-950 font-semibold mb-3" data-testid="execution-receipt-notice">
                      {receipt.notice}
                    </p>
                    <div className="execution-receipt-details">
                      <div>
                        <dt>Receipt Reference</dt>
                        <dd>{receipt.receipt_reference}</dd>
                      </div>
                      <div>
                        <dt>Execution Time</dt>
                        <dd>{new Date(String(receipt.submitted_at)).toLocaleString()}</dd>
                      </div>
                      <div>
                        <dt>Claim Reference</dt>
                        <dd>{receipt.claim_reference || "None"}</dd>
                      </div>
                      <div>
                        <dt>Payload Digest</dt>
                        <dd className="font-mono text-xs">{receipt.payload_digest.slice(0, 20)}...</dd>
                      </div>
                    </div>
                    {receipt.next_action && (
                      <p className="text-xs text-emerald-900 mt-3 font-medium">
                        Next step: {receipt.next_action}
                      </p>
                    )}
                  </div>
                </div>
              )}

              {/* Editable Payload Fields */}
              {selectedAction.editable_fields?.length > 0 &&
                (selectedAction.status === "AWAITING_APPROVAL" || selectedAction.status === "APPROVED") && (
                  <div className="mb-4">
                    {!editing ? (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        data-testid="edit-action-btn"
                        onClick={startEditing}
                      >
                        <Edit3 size={14} className="mr-1.5" /> Edit Draft Payload
                      </Button>
                    ) : (
                      <div className="p-4 bg-slate-50 border border-slate-200 rounded-xl space-y-3">
                        <div className="text-xs font-bold uppercase text-slate-700">
                          Edit Draft Payload (Editing invalidates existing approval)
                        </div>
                        {selectedAction.editable_fields.map((field) => (
                          <div key={field}>
                            <label className="block text-xs font-semibold text-slate-600 mb-1">
                              {field}
                            </label>
                            {field === "body" || field === "detail" ? (
                              <textarea
                                data-testid={`edit-field-${field}`}
                                value={editDraft[field] ?? ""}
                                onChange={(e) =>
                                  setEditDraft((prev) => ({ ...prev, [field]: e.target.value }))
                                }
                                rows={3}
                                className="w-full p-2 bg-white border border-slate-300 rounded-lg text-xs"
                              />
                            ) : (
                              <input
                                type="text"
                                data-testid={`edit-field-${field}`}
                                value={editDraft[field] ?? ""}
                                onChange={(e) =>
                                  setEditDraft((prev) => ({ ...prev, [field]: e.target.value }))
                                }
                                className="w-full p-2 bg-white border border-slate-300 rounded-lg text-xs"
                              />
                            )}
                          </div>
                        ))}
                        <div className="flex justify-end gap-2">
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={() => setEditing(false)}
                          >
                            Cancel
                          </Button>
                          <Button
                            type="button"
                            size="sm"
                            data-testid="save-action-edit-btn"
                            disabled={deciding}
                            onClick={handleSaveEdit}
                          >
                            Save Payload Changes
                          </Button>
                        </div>
                      </div>
                    )}
                  </div>
                )}

              {/* Draft Inquiry Preview for renewal_inquiry */}
              {selectedAction.action_type === "renewal_inquiry" && Boolean(selectedAction.payload?.body) && (
                <div className="mb-4 p-4 rounded-xl bg-slate-50 border border-slate-200">
                  <div className="flex items-center justify-between mb-2 pb-2 border-b border-slate-200">
                    <span className="text-xs font-bold text-slate-700 uppercase tracking-wider flex items-center gap-1.5">
                      <FileCheck2 size={14} className="text-teal-700" />
                      Drafted Letter for Insurer Hand-off
                    </span>
                    <span className="text-[11px] text-slate-500 font-mono">
                      Target: {String(selectedAction.payload.provider || "Insurer")}
                    </span>
                  </div>
                  <div className="text-xs text-slate-800 whitespace-pre-line font-sans leading-relaxed bg-white p-3.5 rounded-lg border border-slate-200/80">
                    {String(selectedAction.payload.body)}
                  </div>
                </div>
              )}

              {/* Human-Readable Payload Summary + JSON Inspector */}
              <h3 className="actions-section-title">Submitted Payload Content</h3>
              {selectedAction.payload && typeof selectedAction.payload === "object" && (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 mb-3">
                  {Object.entries(selectedAction.payload).map(([k, v]) => (
                    <div
                      key={k}
                      className="p-2.5 rounded-lg bg-slate-50 border border-slate-200 text-xs flex flex-col justify-between"
                    >
                      <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
                        {k.replace(/_/g, " ")}
                      </span>
                      <span className="font-semibold text-slate-800 mt-0.5 break-words">
                        {typeof v === "object" && v !== null ? JSON.stringify(v) : String(v ?? "—")}
                      </span>
                    </div>
                  ))}
                </div>
              )}
              <pre className="actions-payload-pre">
                {JSON.stringify(selectedAction.payload, null, 2)}
              </pre>

              {/* Rejection Input if requested */}
              {showRejectInput && (
                <div className="mb-4 p-4 bg-rose-50 border border-rose-200 rounded-xl">
                  <label className="block text-xs font-bold text-rose-900 uppercase mb-2">
                    State Reason for Rejection
                  </label>
                  <input
                    type="text"
                    placeholder="e.g. Invoiced amount does not match my receipt"
                    value={rejectionReason}
                    onChange={(e) => setRejectionReason(e.target.value)}
                    className="w-full p-2.5 bg-white border border-rose-300 rounded-lg text-sm mb-3"
                  />
                  <div className="flex justify-end gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => setShowRejectInput(false)}
                    >
                      Cancel
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      onClick={handleReject}
                      disabled={deciding}
                      className="bg-rose-700 hover:bg-rose-800 text-white"
                    >
                      Confirm Rejection
                    </Button>
                  </div>
                </div>
              )}

              {/* CTA Action Buttons */}
              <div className="actions-cta-bar">
                {selectedAction.claim_id ? (
                  <Button asChild variant="outline" size="sm">
                    <Link href={`/claims/${selectedAction.claim_id}`}>
                      Edit Claim Data
                    </Link>
                  </Button>
                ) : (
                  <div />
                )}

                {(selectedAction.status === "AWAITING_APPROVAL" ||
                  selectedAction.status === "APPROVED" ||
                  selectedAction.status === "DRAFT") && (
                  <div className="flex flex-wrap items-center gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      disabled={deciding}
                      onClick={() => setShowRejectInput(true)}
                      className="text-rose-700 hover:bg-rose-50 border-rose-200"
                    >
                      <XCircle size={15} className="mr-1.5" /> Reject Action
                    </Button>
                    {!selectedAction.approved && selectedAction.requires_approval && (
                      <Button
                        type="button"
                        variant="outline"
                        data-testid="approve-action-btn"
                        disabled={deciding}
                        onClick={handleApproveOnly}
                      >
                        <ShieldCheck size={15} className="mr-1.5" />
                        Approve Hash Only
                      </Button>
                    )}
                    {selectedAction.approved && (
                      <Button
                        type="button"
                        data-testid="execute-action-btn"
                        disabled={deciding}
                        onClick={handleExecuteOnly}
                        className="bg-emerald-700 hover:bg-emerald-800 text-white font-bold flex items-center gap-2"
                      >
                        <Play size={15} />
                        {deciding ? "Executing..." : "Execute Approved Action"}
                      </Button>
                    )}
                    {!selectedAction.approved && (
                      <Button
                        type="button"
                        data-testid="approve-and-execute-btn"
                        disabled={deciding}
                        onClick={handleApproveAndExecute}
                        className="bg-emerald-700 hover:bg-emerald-800 text-white font-bold flex items-center gap-2"
                      >
                        <CheckCircle2 size={16} />
                        {deciding ? "Executing..." : "Approve & Execute (Sandbox)"}
                      </Button>
                    )}
                  </div>
                )}
              </div>
            </div>
          ) : (
            <div className="text-center py-24 px-6 text-slate-400">
              <div className="mb-4 flex justify-center">
                <InsurraMascot variant="document" size={76} decorative />
              </div>
              <h3 className="font-bold text-slate-800 text-lg mb-1">Pilih Tindakan untuk Ditinjau</h3>
              <p className="text-sm text-slate-500 max-w-md mx-auto">
                Pilih salah satu tindakan dari daftar antrean di sebelah kiri untuk melihat rincian muatan data, verifikasi digest SHA-256, dan memberikan persetujuan Anda.
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
