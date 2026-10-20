"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import {
  AlertCircle,
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  Clock,
  FileSpreadsheet,
  FileText,
  Info,
  Plus,
  RefreshCw,
  Send,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { ConsentPrompt } from "@/components/workspace/consent-prompt";
import { useAuth } from "@/lib/auth";
import { getWorkflowHeaders, getWorkflowUrl } from "@/lib/api/workflow-client";
import "../claims.css";

interface ChecklistItem {
  code: string;
  label: string;
  label_original?: string | null;
  kind: string;
  reason?: string | null;
  source_url?: string | null;
  mandatory: boolean;
  status: "COMPLETE" | "MISSING" | "NEEDS_REVIEW" | "CONFLICT" | "NOT_APPLICABLE";
  verification: string;
  details?: string | null;
  resolution_action?: string | null;
  evidence_ids?: string[];
}

interface ConsistencyCheck {
  code: string;
  label: string;
  status: "PASS" | "FAIL" | "WARN" | "SKIPPED";
  detail: string;
  acknowledged?: boolean;
}

interface EvidenceFile {
  id: string;
  evidence_kind: string;
  filename: string;
  size_bytes?: number | null;
  sha256?: string | null;
  source_type: string;
  status: string;
  created_at: string;
  fields?: Array<{
    key: string;
    label: string;
    value?: string | null;
    confirmed: boolean;
    origin?: string | null;
  }>;
}

interface DraftFormField {
  value?: string | null;
  section: string;
  label: string;
  required: boolean;
  source?: {
    type: string;
    label: string;
  };
}

interface ClaimCaseDetailResponse {
  case: {
    id: string;
    reference: string;
    title: string;
    claim_type: string;
    country_code: string;
    coverage_label?: string | null;
    coverage_ref?: string | null;
    claimant_name?: string | null;
    provider_name?: string | null;
    amount?: string | null;
    currency?: string | null;
    policy_start?: string | null;
    policy_end?: string | null;
    status: string;
    review_confirmed: boolean;
    sandbox_reference?: string | null;
    sandbox_status?: string | null;
    created_at: string;
    updated_at: string;
  };
  readiness: {
    state: string;
    label: string;
    required_total: number;
    complete: number;
    missing: number;
    needs_review: number;
  };
  checklist: ChecklistItem[];
  consistency_checks: ConsistencyCheck[];
  evidence: EvidenceFile[];
  draft?: {
    form: Record<string, DraftFormField>;
    missing_required: string[];
    version: number;
    status: string;
  } | null;
  dispute_review?: {
    claim_id: string;
    claim_reference: string;
    has_rejection_letter: boolean;
    rejection_evidence_id?: string | null;
    rejection_filename?: string | null;
    stated_rejection_reason: string;
    cited_clause: string;
    rejection_date?: string | null;
    insurer_reference?: string | null;
    review_posture: string;
    insurer_at_fault_concluded: boolean;
    acceptance_guaranteed: boolean;
    disclaimer: string;
    matched_policy_clauses: Array<{
      clause_area: string;
      policy_context: string;
      comparison_status: string;
    }>;
    clarifiable_issues: Array<{
      code: string;
      title: string;
      detail: string;
      suggested_evidence: string;
    }>;
    appeal_evidence_checklist: Array<{
      code: string;
      label: string;
      present: boolean;
      status: string;
      note: string;
    }>;
    regulatory_escalation_info?: {
      authority_name?: string;
      channel_name?: string;
      contact_phone?: string;
      online_portal?: string;
      procedure_summary?: string;
      published_deadlines?: string;
    } | null;
    appeal_draft?: {
      subject: string;
      body: string;
      recipient_note?: string;
    };
    appeal_action_id?: string | null;
    appeal_action_status?: string | null;
  } | null;
  timeline?: Array<{
    id: string;
    event_type: string;
    from_status?: string | null;
    to_status?: string | null;
    source: string;
    note?: string | null;
    created_at: string;
  }>;
  next_action?: {
    action: string;
    label: string;
    description: string;
  } | null;
}

type TabType =
  | "Overview"
  | "Required Information"
  | "Documents"
  | "Consistency Check"
  | "Claim Draft"
  | "Dispute & Appeal"
  | "History";

export default function ClaimDetailPage() {
  const params = useParams();
  const claimId = params.id as string;
  const router = useRouter();
  const { account, token: accountToken } = useAuth();

  const [claim, setClaim] = useState<ClaimCaseDetailResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<TabType>("Overview");

  // Actions in flight
  const [generatingDraft, setGeneratingDraft] = useState(false);
  const [sendingApproval, setSendingApproval] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [syncingStatus, setSyncingStatus] = useState(false);
  const [confirmingEvidenceId, setConfirmingEvidenceId] = useState<string | null>(null);
  const [preparingAppeal, setPreparingAppeal] = useState(false);
  const [customRejectionReason] = useState("");
  const [customCitedClause] = useState("");
  const [requiredConsents, setRequiredConsents] = useState<string[] | null>(null);
  const [pendingActionAfterConsent, setPendingActionAfterConsent] = useState<(() => Promise<void>) | null>(null);

  const handleSyncSandboxStatus = async () => {
    setSyncingStatus(true);
    try {
      const headers = getWorkflowHeaders(accountToken);
      const res = await fetch(getWorkflowUrl(`/api/v1/workflow/claims/cases/${claimId}/sync-status`), {
        method: "POST",
        headers,
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.message || "Failed to sync sandbox status");
      }
      await loadCaseDetail();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Error syncing sandbox status");
    } finally {
      setSyncingStatus(false);
    }
  };

  const handleConfirmEvidence = async (evidenceId: string, currentFields: EvidenceFile["fields"]) => {
    setConfirmingEvidenceId(evidenceId);
    try {
      const headers = getWorkflowHeaders(accountToken);
      const values: Record<string, string> = {};
      for (const f of currentFields || []) {
        if (f.value) values[f.key] = f.value;
      }
      const res = await fetch(
        getWorkflowUrl(`/api/v1/workflow/claims/cases/${claimId}/evidence/${evidenceId}/confirm`),
        {
          method: "PATCH",
          headers,
          body: JSON.stringify({ values }),
        }
      );
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.message || "Failed to confirm evidence fields");
      }
      await loadCaseDetail();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Error confirming evidence fields");
    } finally {
      setConfirmingEvidenceId(null);
    }
  };

  const handlePrepareAppeal = async (rejectionReason?: string, citedClause?: string) => {
    setPreparingAppeal(true);
    try {
      const headers = getWorkflowHeaders(accountToken);
      const res = await fetch(
        getWorkflowUrl(`/api/v1/workflow/claims/cases/${claimId}/prepare-appeal`),
        {
          method: "POST",
          headers,
          body: JSON.stringify({
            rejection_reason: rejectionReason || customRejectionReason || undefined,
            cited_clause: citedClause || customCitedClause || undefined,
          }),
        }
      );
      if (res.status === 403) {
        const err = await res.json().catch(() => ({}));
        const purposes = err?.details?.required_purposes || ["process_documents"];
        setRequiredConsents(purposes);
        setPendingActionAfterConsent(() => () => handlePrepareAppeal(rejectionReason, citedClause));
        return;
      }
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.message || "Failed to prepare appeal draft");
      }
      const data = await res.json();
      await loadCaseDetail();
      router.push(`/actions?action=${data.action.id}`);
    } catch (err) {
      alert(err instanceof Error ? err.message : "Error preparing appeal draft");
    } finally {
      setPreparingAppeal(false);
    }
  };

  const loadCaseDetail = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const headers = getWorkflowHeaders(accountToken);
      const res = await fetch(getWorkflowUrl(`/api/v1/workflow/claims/cases/${claimId}`), { headers });
      if (!res.ok) {
        if (res.status === 404) {
          throw new Error("Claim case not found.");
        }
        throw new Error(`HTTP ${res.status}`);
      }
      const data = await res.json();
      setClaim(data);
    } catch (err) {
      console.error("Error loading case:", err);
      setError(err instanceof Error ? err.message : "Failed to load claim case.");
    } finally {
      setLoading(false);
    }
  }, [claimId, accountToken]);

  useEffect(() => {
    void Promise.resolve().then(loadCaseDetail);
  }, [loadCaseDetail]);

  const handleGenerateDraft = async () => {
    setGeneratingDraft(true);
    try {
      const headers = getWorkflowHeaders(accountToken);
      const res = await fetch(getWorkflowUrl(`/api/v1/workflow/claims/cases/${claimId}/draft`), {
        method: "POST",
        headers,
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.message || "Failed to generate draft");
      }
      await loadCaseDetail();
      setActiveTab("Claim Draft");
    } catch (err) {
      alert(err instanceof Error ? err.message : "Error generating draft");
    } finally {
      setGeneratingDraft(false);
    }
  };

  const handleConfirmAndSendApproval = async () => {
    setSendingApproval(true);
    try {
      const headers = getWorkflowHeaders(accountToken);
      headers["Content-Type"] = "application/json";

      // 1. Confirm draft
      const confRes = await fetch(getWorkflowUrl(`/api/v1/workflow/claims/cases/${claimId}/draft/confirm`), {
        method: "POST",
        headers,
      });
      if (confRes.status === 403) {
        const confErr = await confRes.json().catch(() => ({}));
        const purposes = confErr?.details?.required_purposes || ["process_documents"];
        setRequiredConsents(purposes);
        setPendingActionAfterConsent(() => handleConfirmAndSendApproval);
        return;
      }
      if (!confRes.ok) {
        const confErr = await confRes.json().catch(() => ({}));
        throw new Error(confErr.message || "Draft confirmation failed");
      }

      // 2. Send to approval (requires explicit process_documents consent)
      const sendRes = await fetch(getWorkflowUrl(`/api/v1/workflow/claims/cases/${claimId}/send-to-approval`), {
        method: "POST",
        headers,
      });
      if (sendRes.status === 403) {
        const sendErr = await sendRes.json().catch(() => ({}));
        const purposes = sendErr?.details?.required_purposes || ["process_documents"];
        setRequiredConsents(purposes);
        setPendingActionAfterConsent(() => handleConfirmAndSendApproval);
        return;
      }
      if (!sendRes.ok) {
        const sendErr = await sendRes.json().catch(() => ({}));
        throw new Error(sendErr.message || "Sending to approval failed");
      }

      await loadCaseDetail();
      router.push("/actions");
    } catch (err) {
      alert(err instanceof Error ? err.message : "Error sending for approval");
    } finally {
      setSendingApproval(false);
    }
  };

  const handleUploadSimulatedEvidence = async (kind: string, filename: string, fileObj?: File) => {
    setUploading(true);
    try {
      const headers = getWorkflowHeaders(accountToken);
      // Do not set Content-Type manually so browser attaches multipart/form-data boundary
      delete headers["Content-Type"];

      const formData = new FormData();
      if (fileObj) {
        formData.append("file", fileObj, fileObj.name || filename);
      } else {
        const sampleText = [
          "Electronic Medical Invoice",
          "Hospital: Shenzhen University General Hospital",
          "Date: 2026-10-12",
          "Amount: CNY 450.00",
          "Patient: Raka Pratama",
        ].join("\n");
        const blob = new Blob([sampleText], { type: "text/plain" });
        formData.append("file", blob, filename);
      }

      const url = getWorkflowUrl(
        `/api/v1/workflow/claims/cases/${claimId}/evidence?evidence_kind=${encodeURIComponent(kind)}`
      );
      const res = await fetch(url, {
        method: "POST",
        headers,
        body: formData,
      });
      if (res.status === 403) {
        const err = await res.json().catch(() => ({}));
        const purposes = err?.details?.required_purposes || ["process_documents"];
        setRequiredConsents(purposes);
        setPendingActionAfterConsent(() => () => handleUploadSimulatedEvidence(kind, filename, fileObj));
        return;
      }
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.message || "Evidence upload failed");
      }
      await loadCaseDetail();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Error uploading evidence");
    } finally {
      setUploading(false);
    }
  };

  if (loading) {
    return (
      <div className="claims-workspace text-center py-20">
        <RefreshCw className="animate-spin inline-block text-teal-700 mb-4" size={32} />
        <p className="text-slate-500 font-medium">Loading claim workspace...</p>
      </div>
    );
  }

  if (error || !claim) {
    return (
      <div className="claims-workspace text-center py-20">
        <AlertTriangle className="inline-block text-amber-500 mb-4" size={36} />
        <h2 className="text-xl font-bold text-slate-800 mb-2">Claim Not Available</h2>
        <p className="text-slate-500 mb-6">{error || "This claim case could not be found."}</p>
        <Button asChild variant="outline">
          <Link href="/claims">
            <ArrowLeft size={16} className="mr-2" /> Back to Claims Center
          </Link>
        </Button>
      </div>
    );
  }

  const { case: caseData, readiness, checklist, consistency_checks, evidence, draft, timeline } = claim;

  // Compute readiness percentage
  const totalReq = readiness.required_total || 4;
  const completeCount = readiness.complete || 0;
  const percentage = Math.min(100, Math.round((completeCount / totalReq) * 100));

  return (
    <div className="claims-workspace">
      {/* Case Header (Screenshot 2) */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-6">
        <div>
          <div className="flex items-center gap-3 mb-1">
            <h1 className="text-2xl md:text-3xl font-extrabold text-slate-900 tracking-tight">
              {caseData.reference} - {caseData.title}
            </h1>
            <span className="status-chip status-chip-ready text-xs">
              <CheckCircle2 size={13} /> {readiness.label}
            </span>
          </div>
          <p className="text-sm text-slate-500">
            Policy: <strong className="text-slate-700">{caseData.coverage_label || "HealthPlus (HP-0021)"}</strong> • Country:{" "}
            <strong className="text-slate-700">{caseData.country_code === "CN" ? "China (CN)" : "Indonesia (ID)"}</strong> • Created:{" "}
            {new Date(caseData.created_at).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
          </p>
        </div>

        <div className="flex items-center gap-3">
          {caseData.sandbox_reference && (
            <Button
              onClick={handleSyncSandboxStatus}
              disabled={syncingStatus}
              variant="outline"
              size="sm"
              className="text-teal-700 border-teal-200 hover:bg-teal-50 flex items-center gap-1.5"
            >
              <RefreshCw size={13} className={syncingStatus ? "animate-spin" : ""} />
              Sync Sandbox Status
            </Button>
          )}
          <Button asChild variant="outline" size="sm" className="text-slate-600">
            <Link href="/claims">
              <ArrowLeft size={14} className="mr-1.5" /> Back to List
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
            const retry = pendingActionAfterConsent;
            setPendingActionAfterConsent(null);
            if (retry) {
              void retry();
            }
          }}
          onCancel={() => {
            setRequiredConsents(null);
            setPendingActionAfterConsent(null);
          }}
        />
      )}

      {/* Top Banner if Ready for Approval (Screenshot 2 Top Card) */}
      {caseData.status === "READY_FOR_APPROVAL" && (
        <div className="claims-hero-banner mb-6">
          <div className="claims-hero-banner-content">
            <div className="claims-hero-banner-icon bg-emerald-100 text-emerald-700">
              <CheckCircle2 size={24} />
            </div>
            <div>
              <div className="claims-hero-banner-title text-emerald-900">
                Review and Confirmation Complete
              </div>
              <div className="claims-hero-banner-sub text-emerald-700">
                All required evidence has been confirmed. A submission action is ready to be sent for your approval.
              </div>
            </div>
          </div>
          <Button
            onClick={handleConfirmAndSendApproval}
            disabled={sendingApproval}
            className="bg-emerald-700 hover:bg-emerald-800 text-white font-semibold flex items-center gap-1.5"
          >
            {sendingApproval ? "Preparing Action..." : "Send to Approval Queue"} <ArrowRight size={15} />
          </Button>
        </div>
      )}

      {/* Interactive 4-Step Claim Progress Stepper */}
      <div className="bg-white border border-slate-200 rounded-2xl p-4 mb-6 shadow-2xs grid grid-cols-1 sm:grid-cols-4 gap-3">
        <button
          type="button"
          onClick={() => setActiveTab("Required Information")}
          className="flex items-center gap-3 p-2.5 rounded-xl bg-slate-50 hover:bg-teal-50/60 border border-slate-200/80 text-left transition-colors cursor-pointer"
        >
          <span className="w-7 h-7 rounded-full bg-teal-700 text-white text-xs font-extrabold grid place-items-center shrink-0">
            1
          </span>
          <div className="min-w-0">
            <div className="text-xs font-bold text-slate-900 truncate">Evidence &amp; Checklist</div>
            <div className="text-[11px] text-slate-500">
              {completeCount}/{totalReq} required confirmed
            </div>
          </div>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab("Consistency Check")}
          className="flex items-center gap-3 p-2.5 rounded-xl bg-slate-50 hover:bg-teal-50/60 border border-slate-200/80 text-left transition-colors cursor-pointer"
        >
          <span className="w-7 h-7 rounded-full bg-teal-700 text-white text-xs font-extrabold grid place-items-center shrink-0">
            2
          </span>
          <div className="min-w-0">
            <div className="text-xs font-bold text-slate-900 truncate">Consistency Checks</div>
            <div className="text-[11px] text-emerald-700 font-semibold">
              {consistency_checks.filter((c) => c.status === "PASS").length}/{consistency_checks.length} passed
            </div>
          </div>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab("Claim Draft")}
          className="flex items-center gap-3 p-2.5 rounded-xl bg-slate-50 hover:bg-teal-50/60 border border-slate-200/80 text-left transition-colors cursor-pointer"
        >
          <span
            className={`w-7 h-7 rounded-full text-xs font-extrabold grid place-items-center shrink-0 ${
              draft?.form ? "bg-teal-700 text-white" : "bg-slate-200 text-slate-700"
            }`}
          >
            3
          </span>
          <div className="min-w-0">
            <div className="text-xs font-bold text-slate-900 truncate">Prepared Claim Form</div>
            <div className="text-[11px] text-slate-500">
              {draft?.form ? `Version ${draft.version} ready` : "Prepare draft form"}
            </div>
          </div>
        </button>

        <button
          type="button"
          onClick={() => router.push("/actions")}
          className="flex items-center gap-3 p-2.5 rounded-xl bg-slate-50 hover:bg-teal-50/60 border border-slate-200/80 text-left transition-colors cursor-pointer"
        >
          <span
            className={`w-7 h-7 rounded-full text-xs font-extrabold grid place-items-center shrink-0 ${
              caseData.status.includes("SANDBOX") || caseData.status === "AWAITING_APPROVAL"
                ? "bg-teal-700 text-white"
                : "bg-slate-200 text-slate-700"
            }`}
          >
            4
          </span>
          <div className="min-w-0">
            <div className="text-xs font-bold text-slate-900 truncate">Approval &amp; Sandbox</div>
            <div className="text-[11px] text-slate-500">
              {caseData.status.replace(/_/g, " ")}
            </div>
          </div>
        </button>
      </div>

      {/* 6 Tabs Navigation (Screenshot 2) */}
      <div className="border-b border-slate-200 mb-6 overflow-x-auto">
        <div className="flex gap-8">
          {(
            [
              "Overview",
              "Required Information",
              "Documents",
              "Consistency Check",
              "Claim Draft",
              "Dispute & Appeal",
              "History",
            ] as TabType[]
          ).map((tab) => (
            <button
              key={tab}
              type="button"
              onClick={() => setActiveTab(tab)}
              className={`py-3.5 px-1 border-b-2 font-semibold text-sm transition-all whitespace-nowrap ${
                activeTab === tab
                  ? "border-teal-700 text-teal-800 font-bold"
                  : "border-transparent text-slate-500 hover:text-slate-800"
              }`}
            >
              {tab}
              {tab === "Consistency Check" && (
                <span className="ml-1.5 text-xs bg-emerald-100 text-emerald-800 rounded-full px-2 py-0.5">
                  6/6
                </span>
              )}
              {tab === "Dispute & Appeal" && (caseData.status === "REJECTED_IN_SANDBOX" || evidence.some(e => e.evidence_kind === "REJECTION_LETTER")) && (
                <span className="ml-1.5 text-xs bg-amber-100 text-amber-800 rounded-full px-2 py-0.5 font-bold">
                  Action
                </span>
              )}
            </button>
          ))}
        </div>
      </div>

      {/* TAB 1: OVERVIEW */}
      {activeTab === "Overview" && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Readiness Progress Card (Screenshot 2 Ring) */}
          <div className="bg-white border border-slate-200 rounded-2xl p-6 shadow-sm flex flex-col justify-between">
            <div>
              <div className="flex items-center justify-between mb-4">
                <h3 className="font-bold text-slate-800">Claim Readiness</h3>
                <span className="text-xs font-semibold px-2.5 py-1 bg-teal-50 text-teal-700 rounded-full border border-teal-200">
                  {readiness.label}
                </span>
              </div>

              {/* Progress Ring */}
              <div className="flex items-center justify-center py-6">
                <div className="relative w-36 h-36 flex items-center justify-center">
                  <svg className="w-full h-full transform -rotate-90" viewBox="0 0 100 100">
                    <circle
                      cx="50"
                      cy="50"
                      r="40"
                      stroke="#f1f5f9"
                      strokeWidth="10"
                      fill="transparent"
                    />
                    <circle
                      cx="50"
                      cy="50"
                      r="40"
                      stroke="#0f766e"
                      strokeWidth="10"
                      strokeDasharray={251.2}
                      strokeDashoffset={251.2 - (251.2 * percentage) / 100}
                      strokeLinecap="round"
                      fill="transparent"
                      className="transition-all duration-700 ease-out"
                    />
                  </svg>
                  <div className="absolute text-center">
                    <span className="text-3xl font-extrabold text-slate-900">{percentage}%</span>
                    <span className="block text-xs text-slate-500 font-medium">Ready</span>
                  </div>
                </div>
              </div>

              <p className="text-center text-sm font-medium text-slate-600 mb-4">
                <strong>{completeCount} of {totalReq}</strong> required items confirmed
              </p>
            </div>

            <div className="pt-4 border-t border-slate-100 flex flex-col gap-2">
              {caseData.status === "READY_FOR_APPROVAL" ? (
                <Button
                  onClick={handleConfirmAndSendApproval}
                  disabled={sendingApproval}
                  className="w-full bg-teal-700 hover:bg-teal-800 text-white font-semibold"
                >
                  Proceed to Approval <ArrowRight size={15} className="ml-1.5" />
                </Button>
              ) : (
                <Button
                  onClick={handleGenerateDraft}
                  disabled={generatingDraft}
                  className="w-full bg-teal-700 hover:bg-teal-800 text-white font-semibold"
                >
                  Prepare Claim Draft
                </Button>
              )}
            </div>
          </div>

          {/* Claim Case Overview Summary */}
          <div className="lg:col-span-2 bg-white border border-slate-200 rounded-2xl p-6 shadow-sm">
            <h3 className="font-bold text-slate-800 mb-4">Claim Summary</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm mb-6">
              <div className="p-3.5 bg-slate-50 rounded-xl border border-slate-100">
                <span className="text-xs text-slate-500 uppercase font-semibold block mb-1">
                  Policyholder / Claimant
                </span>
                <span className="font-bold text-slate-800">
                  {caseData.claimant_name || account?.display_name || "Self"}
                </span>
              </div>

              <div className="p-3.5 bg-slate-50 rounded-xl border border-slate-100">
                <span className="text-xs text-slate-500 uppercase font-semibold block mb-1">
                  Service / Visit Date
                </span>
                <span className="font-bold text-slate-800">
                  {caseData.policy_start || "12 Oct 2026"}
                </span>
              </div>

              <div className="p-3.5 bg-slate-50 rounded-xl border border-slate-100">
                <span className="text-xs text-slate-500 uppercase font-semibold block mb-1">
                  Healthcare Provider
                </span>
                <span className="font-bold text-slate-800">
                  {caseData.provider_name || "Shenzhen University General Hospital"}
                </span>
              </div>

              <div className="p-3.5 bg-slate-50 rounded-xl border border-slate-100">
                <span className="text-xs text-slate-500 uppercase font-semibold block mb-1">
                  Total Invoiced Amount
                </span>
                <span className="font-bold text-slate-900 text-base">
                  {caseData.currency || "CNY"} {caseData.amount || "450.00"}
                </span>
              </div>
            </div>

            <h4 className="font-semibold text-slate-800 text-sm mb-3">Key Evidence Attached</h4>
            <div className="space-y-2">
              {evidence.map((ev) => (
                <div
                  key={ev.id}
                  className="flex items-center justify-between p-3 bg-white border border-slate-200 rounded-xl hover:border-slate-300 transition-colors"
                >
                  <div className="flex items-center gap-3">
                    <div className="w-9 h-9 rounded-lg bg-teal-50 text-teal-700 grid place-items-center">
                      <FileText size={18} />
                    </div>
                    <div>
                      <div className="font-semibold text-slate-900 text-sm">{ev.filename}</div>
                      <div className="text-xs text-slate-500">
                        {ev.evidence_kind} • {ev.sha256 ? `${ev.sha256.slice(0, 12)}...` : "SHA verified"}
                      </div>
                    </div>
                  </div>
                  <span className="text-xs font-semibold text-emerald-700 bg-emerald-50 border border-emerald-200 px-2.5 py-1 rounded-full">
                    Confirmed
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* TAB 2: REQUIRED INFORMATION (Screenshot 2 Checklist) */}
      {activeTab === "Required Information" && (
        <div className="bg-white border border-slate-200 rounded-2xl p-6 shadow-sm">
          <div className="mb-6">
            <h3 className="text-lg font-bold text-slate-900 mb-1">
              Required Information Checklist
            </h3>
            <p className="text-sm text-slate-500">
              Verified against {caseData.country_code} regulatory rules and your policy contract. Each item must be confirmed before submission.
            </p>
          </div>

          <div className="divide-y divide-slate-100">
            {checklist.map((item) => (
              <div key={item.code} className="py-4.5 flex items-start justify-between gap-4">
                <div className="flex items-start gap-3.5">
                  <div className="mt-0.5">
                    {item.status === "COMPLETE" ? (
                      <CheckCircle2 size={20} className="text-emerald-600" />
                    ) : item.status === "MISSING" ? (
                      <AlertCircle size={20} className="text-rose-500" />
                    ) : (
                      <Clock size={20} className="text-amber-500" />
                    )}
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-bold text-slate-900 text-sm">{item.label}</span>
                      {item.mandatory && (
                        <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider bg-slate-100 px-1.5 py-0.5 rounded">
                          Required
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-slate-500 mt-0.5 mb-1.5">{item.reason}</p>
                    {item.details && (
                      <div className="text-xs font-medium text-slate-700 bg-slate-50 border border-slate-100 rounded-lg px-2.5 py-1 inline-block">
                        {item.details}
                      </div>
                    )}
                  </div>
                </div>

                <div className="flex items-center gap-3">
                  <span
                    className={`text-xs font-semibold px-2.5 py-1 rounded-full ${
                      item.status === "COMPLETE"
                        ? "bg-emerald-50 text-emerald-700 border border-emerald-200"
                        : item.status === "MISSING"
                        ? "bg-rose-50 text-rose-700 border border-rose-200"
                        : "bg-amber-50 text-amber-700 border border-amber-200"
                    }`}
                  >
                    {item.status === "COMPLETE" ? "Confirmed" : item.status === "MISSING" ? "Missing" : "Needs Review"}
                  </span>
                  <Button
                    variant="outline"
                    size="sm"
                    className="text-xs"
                    onClick={() =>
                      setActiveTab(item.status === "COMPLETE" ? "Claim Draft" : "Documents")
                    }
                  >
                    {item.resolution_action || "View"}
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* TAB 3: DOCUMENTS & EVIDENCE */}
      {activeTab === "Documents" && (
        <div className="space-y-6">
          <div className="bg-white border border-slate-200 rounded-2xl p-6 shadow-sm">
            <div className="flex items-center justify-between mb-6">
              <div>
                <h3 className="text-lg font-bold text-slate-900 mb-1">Claim Evidence Files</h3>
                <p className="text-sm text-slate-500">
                  Official invoices, hospital consultation notes, and receipts attached to this claim.
                </p>
              </div>
              <div className="flex gap-2">
                <Button
                  onClick={() =>
                    handleUploadSimulatedEvidence("FAPIAO", "Medical Receipt - Electronic Invoice.pdf")
                  }
                  disabled={uploading}
                  size="sm"
                  className="bg-teal-700 hover:bg-teal-800 text-white font-semibold"
                >
                  <Plus size={14} className="mr-1" /> Add Fapiao / Receipt
                </Button>
              </div>
            </div>

            <div className="space-y-3">
              {evidence.map((file) => (
                <div
                  key={file.id}
                  className="p-4 border border-slate-200 rounded-xl bg-slate-50/50 hover:bg-slate-50 transition-colors"
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-lg bg-teal-100 text-teal-800 grid place-items-center font-bold text-xs">
                        PDF
                      </div>
                      <div>
                        <div className="font-bold text-slate-900 text-sm">{file.filename}</div>
                        <div className="text-xs text-slate-500 font-mono mt-0.5">
                          SHA-256: {file.sha256 ? `${file.sha256.slice(0, 24)}...` : "Verified digest"}
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className={`text-xs font-semibold px-2.5 py-1 rounded-full ${
                        file.status === "CONFIRMED"
                          ? "bg-emerald-100 text-emerald-800 border border-emerald-200"
                          : "bg-amber-100 text-amber-800 border border-amber-200"
                      }`}>
                        {file.status === "CONFIRMED" ? "Confirmed Valid" : "Needs Confirmation"}
                      </span>
                      {file.status !== "CONFIRMED" && (
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={confirmingEvidenceId === file.id}
                          onClick={() => handleConfirmEvidence(file.id, file.fields)}
                          className="text-xs h-7 px-2.5 text-teal-700 border-teal-300 hover:bg-teal-50"
                        >
                          {confirmingEvidenceId === file.id ? "Confirming..." : "Confirm Fields"}
                        </Button>
                      )}
                    </div>
                  </div>

                  {file.fields && file.fields.length > 0 && (
                    <div className="mt-3 pt-3 border-t border-slate-200/60 grid grid-cols-2 md:grid-cols-4 gap-2 text-xs">
                      {file.fields.slice(0, 4).map((f) => (
                        <div key={f.key} className="bg-white p-2 rounded border border-slate-200/80">
                          <span className="text-slate-400 block text-[10px] uppercase font-semibold">
                            {f.label}
                          </span>
                          <span className="font-bold text-slate-800">{f.value || "Not available"}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* TAB 4: CONSISTENCY CHECK (Screenshot 3) */}
      {activeTab === "Consistency Check" && (
        <div className="bg-white border border-slate-200 rounded-2xl p-6 shadow-sm">
          <div className="mb-6">
            <h3 className="text-lg font-bold text-slate-900 mb-1">
              Automated Consistency Checks
            </h3>
            <p className="text-sm text-slate-500">
              Deterministic verification engine cross-references claimant names, service dates, provider networks, currencies, and invoice totals.
            </p>
          </div>

          <div className="divide-y divide-slate-100">
            {consistency_checks.map((check) => (
              <div key={check.code} className="py-4.5 flex items-start justify-between gap-4">
                <div className="flex items-start gap-3">
                  <div className="mt-0.5">
                    {check.status === "PASS" ? (
                      <CheckCircle2 size={22} className="text-emerald-600" />
                    ) : (
                      <AlertTriangle size={22} className="text-amber-500" />
                    )}
                  </div>
                  <div>
                    <div className="font-bold text-slate-900 text-sm">{check.label}</div>
                    <p className="text-xs text-slate-600 mt-1">{check.detail}</p>
                  </div>
                </div>

                <span
                  className={`text-xs font-bold px-3 py-1 rounded-full ${
                    check.status === "PASS"
                      ? "bg-emerald-50 text-emerald-700 border border-emerald-200"
                      : "bg-amber-50 text-amber-700 border border-amber-200"
                  }`}
                >
                  {check.status}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* TAB 5: CLAIM DRAFT (Screenshot 4) */}
      {activeTab === "Claim Draft" && (
        <div className="bg-white border border-slate-200 rounded-2xl p-6 shadow-sm">
          <div className="flex items-center justify-between mb-6">
            <div>
              <h3 className="text-lg font-bold text-slate-900 mb-1">Prepared Claim Form</h3>
              <p className="text-sm text-slate-500">
                Form generated from confirmed evidence and policy context. Confirm all fields before submission.
              </p>
            </div>
            {draft && (
              <span className="text-xs font-semibold px-2.5 py-1 bg-slate-100 text-slate-700 rounded-full">
                Version {draft.version}
              </span>
            )}
          </div>

          {draft?.form ? (
            <div className="space-y-6">
              {/* Group fields by section */}
              {["Member Information", "Visit Details", "Claim Details"].map((sec) => {
                const secFields = Object.entries(draft.form).filter(
                  ([, item]) => item.section === sec
                );
                if (secFields.length === 0) return null;
                return (
                  <div key={sec} className="bg-slate-50/70 rounded-xl p-5 border border-slate-200/80">
                    <h4 className="font-bold text-slate-800 text-sm uppercase tracking-wider mb-4">
                      {sec}
                    </h4>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      {secFields.map(([key, field]) => (
                        <div key={key} className="bg-white p-3.5 rounded-lg border border-slate-200">
                          <div className="flex items-center justify-between mb-1">
                            <span className="text-xs font-semibold text-slate-500">
                              {field.label}
                            </span>
                            {field.source && (
                              <span className="text-[10px] text-teal-700 bg-teal-50 px-1.5 py-0.5 rounded font-medium">
                                {field.source.label}
                              </span>
                            )}
                          </div>
                          <div className="font-bold text-slate-900 text-sm">
                            {field.value || "Not available"}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })}

              <div className="pt-4 border-t border-slate-200 flex justify-end gap-3">
                <Button
                  onClick={handleConfirmAndSendApproval}
                  disabled={sendingApproval}
                  className="bg-teal-700 hover:bg-teal-800 text-white font-semibold flex items-center gap-2"
                >
                  <Send size={15} /> Confirm Draft & Send to Approval
                </Button>
              </div>
            </div>
          ) : (
            <div className="text-center py-12">
              <FileSpreadsheet size={36} className="text-slate-400 mx-auto mb-3" />
              <h4 className="font-bold text-slate-800 mb-1">Draft Not Yet Prepared</h4>
              <p className="text-sm text-slate-500 mb-4">
                Click below to prepare the claim form from your attached evidence files.
              </p>
              <Button
                onClick={handleGenerateDraft}
                disabled={generatingDraft}
                className="bg-teal-700 hover:bg-teal-800 text-white"
              >
                Prepare Claim Form
              </Button>
            </div>
          )}
        </div>
      )}

      {/* TAB: DISPUTE & APPEAL (Flow C: Claim Dispute Agent) */}
      {activeTab === "Dispute & Appeal" && (
        <div className="space-y-6">
          {/* Honest Uncertainty & Non-Conclusive Disclaimer (Criterion 6) */}
          <div className="p-4.5 bg-sky-50/80 border border-sky-200 rounded-2xl flex items-start gap-3.5">
            <Info size={22} className="text-sky-700 mt-0.5 flex-none" />
            <div className="text-xs leading-relaxed text-sky-900">
              <span className="font-bold block text-sm mb-1 text-sky-950">
                Dispute Review &amp; Appeal Preparation (Non-Conclusive Clarification)
              </span>
              {claim.dispute_review?.disclaimer ||
                "This review compares the stated rejection reason against recorded policy context and evidence to highlight points that may be clarified. It does not conclude that the insurer is at fault and does not guarantee that an appeal or claim will be accepted."}
            </div>
          </div>

          {/* Rejection Letter Context Card */}
          <div className="bg-white border border-slate-200 rounded-2xl p-6 shadow-sm">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-5">
              <div>
                <h3 className="text-lg font-bold text-slate-900">1. Stated Rejection Basis</h3>
                <p className="text-xs text-slate-500">
                  Information extracted from your insurer denial letter or recorded claim outcome.
                </p>
              </div>
              <div className="flex gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  disabled={uploading}
                  onClick={() =>
                    handleUploadSimulatedEvidence(
                      "REJECTION_LETTER",
                      "Insurer Denial Notice - Clause Clarification.pdf"
                    )
                  }
                  className="text-xs text-slate-700 border-slate-300"
                >
                  <FileText size={14} className="mr-1" /> Attach Rejection Notice
                </Button>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="p-4 bg-slate-50 rounded-xl border border-slate-200/80">
                <span className="text-[11px] font-bold text-slate-500 uppercase block mb-1">
                  Stated Rejection Reason
                </span>
                <p className="text-sm font-semibold text-slate-900">
                  {claim.dispute_review?.stated_rejection_reason || "No rejection reason on record."}
                </p>
              </div>
              <div className="p-4 bg-slate-50 rounded-xl border border-slate-200/80">
                <span className="text-[11px] font-bold text-slate-500 uppercase block mb-1">
                  Cited Policy Clause / Exclusion
                </span>
                <p className="text-sm font-semibold text-slate-900">
                  {claim.dispute_review?.cited_clause || "Not specified by insurer."}
                </p>
              </div>
            </div>
          </div>

          {/* Matched Policy Clauses & Comparison */}
          <div className="bg-white border border-slate-200 rounded-2xl p-6 shadow-sm">
            <h3 className="text-lg font-bold text-slate-900 mb-1">2. Policy Clause Comparison</h3>
            <p className="text-xs text-slate-500 mb-4">
              Comparing stated denial grounds against your contract facts and recorded policy dates.
            </p>

            <div className="divide-y divide-slate-100">
              {(claim.dispute_review?.matched_policy_clauses || []).map((clause, idx) => (
                <div key={idx} className="py-3.5 flex items-start justify-between gap-4">
                  <div>
                    <span className="font-bold text-sm text-slate-800 block">
                      {clause.clause_area}
                    </span>
                    <p className="text-xs text-slate-600 mt-0.5">{clause.policy_context}</p>
                  </div>
                  <span className="text-xs font-semibold px-2.5 py-1 rounded-full bg-slate-100 text-slate-700 border border-slate-200">
                    {clause.comparison_status.replace(/_/g, " ")}
                  </span>
                </div>
              ))}
            </div>
          </div>

          {/* Clarifiable Issues */}
          <div className="bg-white border border-slate-200 rounded-2xl p-6 shadow-sm">
            <h3 className="text-lg font-bold text-slate-900 mb-1">
              3. Factual Points for Clarification
            </h3>
            <p className="text-xs text-slate-500 mb-4">
              Specific issues identified for written clarification with the claims review team.
            </p>

            <div className="space-y-3">
              {(claim.dispute_review?.clarifiable_issues || []).map((issue) => (
                <div
                  key={issue.code}
                  className="p-4 rounded-xl border border-teal-100 bg-teal-50/40"
                >
                  <div className="font-bold text-sm text-teal-950 mb-1 flex items-center gap-2">
                    <CheckCircle2 size={16} className="text-teal-700" />
                    {issue.title}
                  </div>
                  <p className="text-xs text-slate-700 leading-relaxed mb-2">{issue.detail}</p>
                  <div className="text-[11px] font-semibold text-teal-800 bg-white/80 border border-teal-200 rounded px-2 py-1 inline-block">
                    Recommended Evidence: {issue.suggested_evidence}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Appeal Evidence Checklist */}
          <div className="bg-white border border-slate-200 rounded-2xl p-6 shadow-sm">
            <h3 className="text-lg font-bold text-slate-900 mb-1">
              4. Appeal Supporting Evidence Checklist
            </h3>
            <p className="text-xs text-slate-500 mb-4">
              Documents to compile before submitting your reconsideration request.
            </p>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {(claim.dispute_review?.appeal_evidence_checklist || []).map((item) => (
                <div
                  key={item.code}
                  className="p-3.5 border border-slate-200 rounded-xl bg-slate-50/50 flex items-start gap-3"
                >
                  <div className="mt-0.5">
                    {item.present ? (
                      <CheckCircle2 size={18} className="text-emerald-600" />
                    ) : (
                      <AlertCircle size={18} className="text-amber-500" />
                    )}
                  </div>
                  <div>
                    <span className="font-bold text-slate-900 text-xs block">{item.label}</span>
                    <span className="text-[11px] text-slate-500">{item.note}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Action Review & Approval Handoff (Acceptance Criterion 2) */}
          <div className="p-6 bg-slate-900 text-white rounded-2xl flex flex-col md:flex-row items-center justify-between gap-6 shadow-md">
            <div>
              <span className="text-xs uppercase tracking-wider text-teal-400 font-bold block mb-1">
                Step 5: Review &amp; Approval Boundary
              </span>
              <h4 className="text-base font-bold mb-1">
                Ready to review the Reconsideration &amp; Appeal draft?
              </h4>
              <p className="text-xs text-slate-300 max-w-xl">
                Preparing this action creates a draft bound to an exact payload hash in your Action Queue.
                Nothing is sent to any external party without your explicit approval.
              </p>
            </div>
            <Button
              size="lg"
              onClick={() => handlePrepareAppeal()}
              disabled={preparingAppeal}
              className="bg-teal-500 hover:bg-teal-400 text-slate-950 font-bold px-6 py-2.5 rounded-xl whitespace-nowrap shadow"
            >
              <Send size={15} className="mr-1.5" />
              {preparingAppeal ? "Preparing Draft..." : "Prepare Appeal Draft for Review"}
            </Button>
          </div>
        </div>
      )}

      {/* TAB 6: HISTORY & AUDIT */}
      {activeTab === "History" && (
        <div className="bg-white border border-slate-200 rounded-2xl p-6 shadow-sm">
          <h3 className="text-lg font-bold text-slate-900 mb-4">Case Timeline</h3>
          <div className="space-y-4 pl-4 border-l-2 border-slate-200 ml-2">
            {timeline && timeline.length > 0 ? (
              timeline.map((event) => (
                <div key={event.id} className="relative pl-6">
                  <div className="absolute -left-[31px] top-1 w-4 h-4 rounded-full bg-teal-600 border-2 border-white ring-2 ring-teal-100" />
                  <div className="font-bold text-slate-900 text-sm">{event.event_type}</div>
                  <p className="text-xs text-slate-500 mt-0.5">{event.note || "System event"}</p>
                  <span className="text-[11px] text-slate-400 mt-1 block">
                    {new Date(event.created_at).toLocaleString()} • {event.source}
                  </span>
                </div>
              ))
            ) : (
              <p className="text-sm text-slate-400">No events recorded yet.</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
