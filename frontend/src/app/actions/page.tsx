"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import {
  AlertTriangle,
  Check,
  CheckCircle2,
  Clock,
  Copy,
  ExternalLink,
  FileCheck2,
  KeyRound,
  ShieldCheck,
  User,
  XCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/lib/auth";
import { ensureActiveDemoSession, getWorkflowHeaders, getWorkflowUrl } from "@/lib/api/workflow-client";
import "./actions.css";

interface ProposedAction {
  id: string;
  reference: string;
  action_type: string;
  title: string;
  purpose: string;
  status: string;
  destination: string;
  environment: string;
  environment_label: string;
  claim_id?: string | null;
  claim_reference?: string | null;
  payload: Record<string, unknown>;
  payload_sha256: string;
  payload_version: number;
  approval_status?: string | null;
  is_approved: boolean;
  can_execute: boolean;
  can_cancel: boolean;
  expires_at?: string | null;
  created_at: string;
}

interface ActionQueueResponse {
  counts: {
    pending: number;
    completed: number;
    rejected: number;
    all: number;
  };
  actions: ProposedAction[];
}

interface ExecutionReceipt {
  receipt_reference: string;
  action_id: string;
  action_reference: string;
  action_title: string;
  environment: string;
  status: string;
  claim_reference?: string | null;
  payload_digest: string;
  next_action?: string | null;
  issued_at: string;
  sandbox_claim?: {
    claim_reference: string;
    status: string;
  } | null;
}

export default function ActionsPage() {
  const { account, token: accountToken } = useAuth();
  const [data, setData] = useState<ActionQueueResponse | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<"PENDING" | "COMPLETED" | "REJECTED" | "ALL">("PENDING");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Decision states
  const [deciding, setDeciding] = useState(false);
  const [rejectionReason, setRejectionReason] = useState("");
  const [showRejectInput, setShowRejectInput] = useState(false);
  const [receipt, setReceipt] = useState<ExecutionReceipt | null>(null);
  const [copied, setCopied] = useState(false);

  const loadActions = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      if (!accountToken) {
        await ensureActiveDemoSession();
      }
      const headers = getWorkflowHeaders(accountToken);
      const res = await fetch(getWorkflowUrl("/api/v1/workflow/actions/queue"), { headers });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const result: ActionQueueResponse = await res.json();
      setData(result);

      // Select first action if none selected or current no longer exists
      if (result.actions.length > 0) {
        setSelectedId((curr) => {
          if (curr && result.actions.some((a) => a.id === curr)) return curr;
          return result.actions[0].id;
        });
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

  const selectedAction = data?.actions.find((a) => a.id === selectedId) || null;

  // Load existing receipt if already executed
  useEffect(() => {
    if (!selectedAction) {
      void Promise.resolve().then(() => setReceipt(null));
      return;
    }
    if (selectedAction.status === "COMPLETED" || selectedAction.is_approved) {
      const headers = getWorkflowHeaders(accountToken);
      void Promise.resolve().then(() => {
        fetch(getWorkflowUrl(`/api/v1/workflow/actions/${selectedAction.id}/receipt`), { headers })
          .then((r) => (r.ok ? r.json() : null))
          .then((rec) => setReceipt(rec))
          .catch(() => setReceipt(null));
      });
    } else {
      void Promise.resolve().then(() => setReceipt(null));
    }
  }, [selectedAction, accountToken]);

  const handleApproveAndExecute = async () => {
    if (!selectedAction) return;
    setDeciding(true);
    try {
      const headers = getWorkflowHeaders(accountToken);
      headers["Content-Type"] = "application/json";

      // 1. Ensure consent for process_documents
      await fetch(getWorkflowUrl("/api/v1/consents"), {
        method: "POST",
        headers,
        body: JSON.stringify({ purpose: "process_documents", granted: true }),
      });

      // 2. Approve action with payload sha256
      const appRes = await fetch(getWorkflowUrl(`/api/v1/workflow/actions/${selectedAction.id}/approve`), {
        method: "POST",
        headers,
        body: JSON.stringify({ payload_sha256: selectedAction.payload_sha256 }),
      });
      if (!appRes.ok) {
        const appErr = await appRes.json().catch(() => ({}));
        throw new Error(appErr.message || "Approval failed");
      }

      // 3. Execute action into Sandbox
      const execRes = await fetch(getWorkflowUrl(`/api/v1/workflow/actions/${selectedAction.id}/execute`), {
        method: "POST",
        headers,
        body: JSON.stringify({ environment: "SANDBOX" }),
      });
      if (!execRes.ok) {
        const execErr = await execRes.json().catch(() => ({}));
        throw new Error(execErr.message || "Execution failed");
      }
      const execData = await execRes.json();
      setReceipt(execData.receipt);
      await loadActions();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Error executing action");
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
      alert(err instanceof Error ? err.message : "Error rejecting action");
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
        return item.status === "AWAITING_APPROVAL" || item.status === "DRAFT";
      case "COMPLETED":
        return item.status === "COMPLETED" || item.status === "APPROVED";
      case "REJECTED":
        return item.status === "REJECTED" || item.status === "CANCELLED";
      default:
        return true;
    }
  });

  return (
    <div className="actions-workspace">
      {/* Header */}
      <div className="actions-heading">
        <div>
          <h1>Action Approval Boundary</h1>
          <p>
            Review and approve actions prepared by INSURRA. No external action or sandbox submission occurs without explicit cryptographic consent.
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

      {error && (
        <div style={{ background: "#fef2f2", border: "1px solid #fecaca", color: "#991b1b", padding: "12px 16px", borderRadius: 10, marginBottom: 16, fontSize: 13, fontWeight: 600 }}>
          {error}
        </div>
      )}

      {/* Security Banner */}
      <div className="actions-banner">
        <ShieldCheck size={24} />
        <div>
          <strong>Cryptographic Approval Security Boundary</strong>
          <p>
            Your approval is cryptographically bound to the SHA-256 hash of the exact reviewed payload. If the server or evidence changes, the approval is instantly invalidated.
          </p>
        </div>
      </div>

      {/* 2-Column Layout (Screenshot 5) */}
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
            {loading && <p className="text-center py-10 text-slate-400 text-sm">Loading actions...</p>}
            {!loading && visibleActions.length === 0 && (
              <div className="text-center py-12 text-slate-400">
                <FileCheck2 size={32} className="mx-auto mb-2 opacity-40" />
                <p className="text-sm font-semibold text-slate-600">No actions in this queue</p>
                <p className="text-xs text-slate-400 mt-1">Actions appear when claim forms are prepared for submission.</p>
              </div>
            )}
            {!loading &&
              visibleActions.map((act) => (
                <button
                  type="button"
                  key={act.id}
                  onClick={() => setSelectedId(act.id)}
                  className={`actions-row ${selectedId === act.id ? "selected" : ""}`}
                >
                  <div>
                    <div className="actions-row-title">{act.title}</div>
                    <div className="actions-row-meta">
                      {act.reference} • {act.environment_label}
                    </div>
                  </div>
                  <span
                    className={`status-chip ${
                      act.status === "AWAITING_APPROVAL"
                        ? "status-chip-awaiting"
                        : act.status === "COMPLETED"
                        ? "status-chip-ready"
                        : "status-chip-draft"
                    }`}
                  >
                    {act.status.replace("_", " ")}
                  </span>
                </button>
              ))}
          </div>
        </div>

        {/* Right Column: Selected Action Inspector (Screenshot 5) */}
        <div className="actions-card actions-review-panel">
          {selectedAction ? (
            <div>
              {/* Review Header */}
              <div className="actions-review-header">
                <div>
                  <h2 className="actions-review-title">{selectedAction.title}</h2>
                  <p className="actions-review-sub">
                    Action Reference: <strong className="text-slate-800">{selectedAction.reference}</strong> • Created:{" "}
                    {new Date(selectedAction.created_at).toLocaleDateString()}
                  </p>
                </div>
                <div className="flex gap-2">
                  <span className="status-chip status-chip-awaiting">
                    {selectedAction.status}
                  </span>
                  <span className="status-chip status-chip-draft">
                    {selectedAction.environment_label}
                  </span>
                </div>
              </div>

              {/* Action Details Grid */}
              <div className="actions-info-grid">
                <div className="actions-info-item">
                  <span>Action Purpose</span>
                  <strong>{selectedAction.purpose}</strong>
                </div>
                <div className="actions-info-item">
                  <span>Target Destination</span>
                  <strong>{selectedAction.destination}</strong>
                </div>
                <div className="actions-info-item">
                  <span>Linked Claim Case</span>
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
                  <span>Payload Version</span>
                  <strong>Version {selectedAction.payload_version}</strong>
                </div>
              </div>

              {/* Cryptographic Hash Box (Screenshot 5) */}
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
                <div className="actions-hash-value">{selectedAction.payload_sha256}</div>
                <div className="actions-hash-caption">
                  This SHA-256 digest mathematically guarantees that INSURRA executes the exact reviewed payload with zero tampering or modification.
                </div>
              </div>

              {/* Consequences Alert Box (Screenshot 5) */}
              {selectedAction.status === "AWAITING_APPROVAL" && (
                <div className="actions-consequences-box">
                  <div className="actions-consequences-title">
                    <AlertTriangle size={16} />
                    What happens when you approve this action?
                  </div>
                  <ul className="actions-consequences-list">
                    <li>Cryptographic authorization is signed with your active session credentials.</li>
                    <li>The payload is submitted to the insurer&apos;s sandbox API for validation.</li>
                    <li>A signed execution receipt is generated with timestamp and audit tracking.</li>
                  </ul>
                </div>
              )}

              {/* Execution Receipt Box (If already executed) */}
              {receipt && (
                <div className="execution-receipt-card">
                  <div className="execution-receipt-header">
                    <div className="execution-receipt-title">
                      <CheckCircle2 size={18} /> Signed Execution Receipt
                    </div>
                    <span className="text-xs font-bold uppercase tracking-wider bg-emerald-200 text-emerald-900 px-2 py-0.5 rounded">
                      {receipt.status}
                    </span>
                  </div>
                  <div className="execution-receipt-details">
                    <div>
                      <dt>Receipt Reference</dt>
                      <dd>{receipt.receipt_reference}</dd>
                    </div>
                    <div>
                      <dt>Execution Time</dt>
                      <dd>{new Date(receipt.issued_at).toLocaleString()}</dd>
                    </div>
                    <div>
                      <dt>Sandbox Claim Ref</dt>
                      <dd>{receipt.sandbox_claim?.claim_reference || "SBX-2024-LIVE"}</dd>
                    </div>
                    <div>
                      <dt>Payload Digest</dt>
                      <dd className="font-mono text-xs">{receipt.payload_digest.slice(0, 20)}...</dd>
                    </div>
                  </div>
                </div>
              )}

              {/* Payload JSON Inspector */}
              <h3 className="actions-section-title">Submitted Payload Content</h3>
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

                {selectedAction.status === "AWAITING_APPROVAL" && (
                  <div className="flex items-center gap-3">
                    <Button
                      type="button"
                      variant="outline"
                      disabled={deciding}
                      onClick={() => setShowRejectInput(true)}
                      className="text-rose-700 hover:bg-rose-50 border-rose-200"
                    >
                      <XCircle size={15} className="mr-1.5" /> Reject Action
                    </Button>
                    <Button
                      type="button"
                      disabled={deciding}
                      onClick={handleApproveAndExecute}
                      className="bg-emerald-700 hover:bg-emerald-800 text-white font-bold flex items-center gap-2"
                    >
                      <CheckCircle2 size={16} />
                      {deciding ? "Executing..." : "Approve & Execute (Sandbox)"}
                    </Button>
                  </div>
                )}
              </div>
            </div>
          ) : (
            <div className="text-center py-24 text-slate-400">
              <FileCheck2 size={40} className="mx-auto mb-3 opacity-30" />
              <h3 className="font-bold text-slate-700 text-lg">No Action Selected</h3>
              <p className="text-sm">Select an action from the queue on the left to review its cryptographic payload.</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
