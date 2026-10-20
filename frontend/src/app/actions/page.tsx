"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import {
  AlertTriangle,
  Check,
  CheckCircle2,
  Clock,
  Copy,
  Edit3,
  ExternalLink,
  FileCheck2,
  KeyRound,
  Play,
  ShieldCheck,
  User,
  XCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { ConsentPrompt } from "@/components/workspace/consent-prompt";
import { useAuth } from "@/lib/auth";
import {
  getWorkflowHeaders,
  getWorkflowUrl,
  type WorkflowActionQueueResponse,
  type WorkflowActionView,
  type WorkflowExecutionReceipt,
} from "@/lib/api/workflow-client";
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

      {/* Security Banner */}
      <div className="actions-banner">
        <ShieldCheck size={24} />
        <div>
          <strong>Cryptographic Approval Security Boundary</strong>
          <p>
            Your approval is cryptographically bound to the SHA-256 hash and version of the exact reviewed payload. If the server or evidence changes, the approval is instantly invalidated.
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
            {loading && <p className="text-center py-10 text-slate-400 text-sm">Loading actions...</p>}
            {!loading && visibleActions.length === 0 && (
              <div className="text-center py-12 text-slate-400">
                <FileCheck2 size={32} className="mx-auto mb-2 opacity-40" />
                <p className="text-sm font-semibold text-slate-600">No actions in this queue</p>
                <p className="text-xs text-slate-400 mt-1">
                  Actions appear when claim forms or inquiries are prepared for review.
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
                        : act.status === "COMPLETED" || act.status === "HANDOFF_READY"
                        ? "status-chip-ready"
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
                <div>
                  <h2 className="actions-review-title">{selectedAction.title}</h2>
                  <p className="actions-review-sub">
                    Action Reference: <strong className="text-slate-800">{selectedAction.reference}</strong> • Created:{" "}
                    {new Date(String(selectedAction.created_at)).toLocaleDateString()}
                  </p>
                </div>
                <div className="flex gap-2">
                  <span className="status-chip status-chip-awaiting" data-testid="action-status-badge">
                    {selectedAction.status}
                  </span>
                  <span className="status-chip status-chip-draft">
                    {selectedAction.environment_label}
                  </span>
                </div>
              </div>

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
                  <strong data-testid="action-payload-version">
                    Version {selectedAction.payload_version}
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
                  {selectedAction.consequence} {selectedAction.privacy_note}
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
                    <li>Cryptographic authorization is bound to payload version {selectedAction.payload_version} and SHA-256 digest.</li>
                    <li>
                      {selectedAction.environment === "MANUAL_HANDOFF"
                        ? "Draft prepared. Not sent. INSURRA never sends messages to external insurers automatically."
                        : selectedAction.environment === "SANDBOX"
                        ? "Accepted by the INSURRA test sandbox. No insurer received this."
                        : "Reminder scheduled in INSURRA."}
                    </li>
                    <li>Any edit to the payload increments the version and invalidates prior approval.</li>
                  </ul>
                </div>
              )}

              {/* Execution Receipt Box (If already executed) */}
              {receipt && (
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
                    <p className="text-xs text-emerald-900 mt-3">
                      Next step: {receipt.next_action}
                    </p>
                  )}
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
