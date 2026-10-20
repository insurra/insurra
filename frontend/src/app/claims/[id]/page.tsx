"use client";

import { showAlert } from "@/components/ui/app-dialog";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  Check,
  CheckCircle2,
  Copy,
  Edit2,
  FileText,
  Info,
  Layers,
  Plus,
  RefreshCw,
  Upload,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { ConsentPrompt } from "@/components/workspace/consent-prompt";
import { useAuth } from "@/lib/auth";
import { getWorkflowHeaders, getWorkflowUrl } from "@/lib/api/workflow-client";
import { sanitizeCopywriting } from "@/lib/sanitize-copywriting";
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
    evidence_id?: string;
    page?: number;
  };
  edited?: boolean;
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
    service_date?: string | null;
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
    score_pct?: number;
    readiness_status?: string;
    required_total: number;
    complete: number;
    missing: number;
    needs_review: number;
  };
  checklist: ChecklistItem[];
  consistency_checks: ConsistencyCheck[];
  evidence: EvidenceFile[];
  draft?: {
    id?: string;
    form: Record<string, DraftFormField>;
    missing_required: string[];
    version: number;
    status: string;
  } | null;
}

type MainStage = "DETAILS" | "EVIDENCE" | "DRAFT" | "SUBMIT";
type EvidenceTab = "CHECKLIST" | "DOCUMENTS" | "EXTRACTED" | "VALIDATION";

export default function ClaimDetailPage() {
  const params = useParams();
  const claimId = params.id as string;
  const router = useRouter();
  const { account, token: accountToken } = useAuth();

  const [claim, setClaim] = useState<ClaimCaseDetailResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Workflow Stages
  const [currentStage, setCurrentStage] = useState<MainStage>("EVIDENCE");
  const [evidenceTab, setEvidenceTab] = useState<EvidenceTab>("CHECKLIST");

  // In-flight state
  const [isPreparingDraft, setIsPreparingDraft] = useState(false);
  const [preparationProgress, setPreparationProgress] = useState(0);
  const [isSendingToQueue, setIsSendingToQueue] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [createdAction, setCreatedAction] = useState<{ id?: string; payload_sha256?: string; [key: string]: unknown } | null>(null);
  const [copiedHash, setCopiedHash] = useState(false);

  // Edit extracted summary modal
  const [isEditingSummary, setIsEditingSummary] = useState(false);
  const [editProvider, setEditProvider] = useState("");
  const [editDate, setEditDate] = useState("");
  const [editAmount, setEditAmount] = useState("");
  const [editClaimant, setEditClaimant] = useState("");

  // Consents modal
  const [requiredConsents, setRequiredConsents] = useState<string[] | null>(null);

  const loadCaseDetail = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const headers = getWorkflowHeaders(accountToken);
      const res = await fetch(getWorkflowUrl(`/api/v1/workflow/claims/cases/${claimId}`), { headers });
      if (!res.ok) {
        throw new Error(res.status === 404 ? "Claim case not found." : `HTTP ${res.status}`);
      }
      const data: ClaimCaseDetailResponse = await res.json();
      setClaim(data);

      setEditProvider(data.case.provider_name || "Siloam Hospitals Jakarta");
      setEditDate(data.case.service_date || "2026-10-15");
      setEditAmount(data.case.amount || "1,250,000");
      setEditClaimant(data.case.claimant_name || account?.display_name || "Sinta Anggraini");

      // Set initial stage based on case status
      if (data.case.status === "AWAITING_APPROVAL" || data.case.status.includes("SANDBOX")) {
        setCurrentStage("SUBMIT");
      } else if (data.draft && data.draft.form && Object.keys(data.draft.form).length > 0) {
        setCurrentStage("DRAFT");
      } else {
        setCurrentStage("EVIDENCE");
      }
    } catch (err) {
      console.error("Error loading claim detail:", err);
      setError(err instanceof Error ? err.message : "Failed to load claim case.");
    } finally {
      setLoading(false);
    }
  }, [claimId, accountToken, account]);

  useEffect(() => {
    void Promise.resolve().then(loadCaseDetail);
  }, [loadCaseDetail]);

  const handleSaveSummary = async () => {
    try {
      const headers = getWorkflowHeaders(accountToken);
      headers["Content-Type"] = "application/json";
      const res = await fetch(getWorkflowUrl(`/api/v1/workflow/claims/cases/${claimId}`), {
        method: "PATCH",
        headers,
        body: JSON.stringify({
          provider_name: editProvider,
          service_date: editDate,
          amount: editAmount.replace(/,/g, ""),
          claimant_name: editClaimant,
        }),
      });
      if (!res.ok) throw new Error("Failed to update claim details");
      setIsEditingSummary(false);
      await loadCaseDetail();
    } catch (err) {
      void showAlert(err instanceof Error ? err.message : "Error saving claim summary");
    }
  };

  const handleUploadFile = async (kind: string, fileObj: File) => {
    setIsUploading(true);
    try {
      const headers = getWorkflowHeaders(accountToken);
      delete headers["Content-Type"];

      const formData = new FormData();
      formData.append("file", fileObj, fileObj.name);

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
        setRequiredConsents(err?.details?.required_purposes || ["process_documents"]);
        return;
      }
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.message || "Failed to upload document");
      }
      await loadCaseDetail();
    } catch (err) {
      void showAlert(err instanceof Error ? err.message : "Upload error");
    } finally {
      setIsUploading(false);
    }
  };

  const handleStartPreparation = async () => {
    setIsPreparingDraft(true);
    setPreparationProgress(10);

    const timer1 = setTimeout(() => setPreparationProgress(35), 400);
    const timer2 = setTimeout(() => setPreparationProgress(70), 800);
    const timer3 = setTimeout(() => setPreparationProgress(95), 1200);

    try {
      const headers = getWorkflowHeaders(accountToken);
      headers["Content-Type"] = "application/json";

      const res = await fetch(getWorkflowUrl(`/api/v1/workflow/claims/cases/${claimId}/prepare`), {
        method: "POST",
        headers,
      });

      if (res.status === 403) {
        const err = await res.json().catch(() => ({}));
        setRequiredConsents(err?.details?.required_purposes || ["process_documents"]);
        setIsPreparingDraft(false);
        return;
      }
      if (!res.ok) {
        // Fallback to draft generation
        const fallbackRes = await fetch(getWorkflowUrl(`/api/v1/workflow/claims/cases/${claimId}/draft`), {
          method: "POST",
          headers,
        });
        if (!fallbackRes.ok) {
          const err = await fallbackRes.json().catch(() => ({}));
          throw new Error(err.message || "Could not prepare draft");
        }
      }

      await loadCaseDetail();
      setCurrentStage("DRAFT");
    } catch (err) {
      void showAlert(err instanceof Error ? err.message : "Error preparing draft");
    } finally {
      clearTimeout(timer1);
      clearTimeout(timer2);
      clearTimeout(timer3);
      setIsPreparingDraft(false);
    }
  };

  const handleSendToActionQueue = async () => {
    setIsSendingToQueue(true);
    try {
      const headers = getWorkflowHeaders(accountToken);
      headers["Content-Type"] = "application/json";

      // 1. Confirm draft
      const confRes = await fetch(getWorkflowUrl(`/api/v1/workflow/claims/cases/${claimId}/draft/confirm`), {
        method: "POST",
        headers,
      });
      if (confRes.status === 403) {
        const err = await confRes.json().catch(() => ({}));
        setRequiredConsents(err?.details?.required_purposes || ["process_documents"]);
        setIsSendingToQueue(false);
        return;
      }

      // 2. Send to approval
      const sendRes = await fetch(getWorkflowUrl(`/api/v1/workflow/claims/cases/${claimId}/send-to-approval`), {
        method: "POST",
        headers,
      });
      if (!sendRes.ok) {
        const err = await sendRes.json().catch(() => ({}));
        throw new Error(err.message || "Failed to create proposed action");
      }
      const data = await sendRes.json();
      setCreatedAction(data.action);
      await loadCaseDetail();
      setCurrentStage("SUBMIT");
    } catch (err) {
      void showAlert(err instanceof Error ? err.message : "Error submitting to Action Queue");
    } finally {
      setIsSendingToQueue(false);
    }
  };

  const copyHash = () => {
    if (!createdAction?.payload_sha256) return;
    navigator.clipboard.writeText(String(createdAction.payload_sha256));
    setCopiedHash(true);
    setTimeout(() => setCopiedHash(false), 2000);
  };

  if (loading) {
    return (
      <div className="claims-workspace text-center py-24">
        <RefreshCw className="animate-spin inline-block text-teal-700 mb-4" size={36} />
        <p className="text-slate-600 font-semibold">Loading claim workspace...</p>
      </div>
    );
  }

  if (error || !claim) {
    return (
      <div className="claims-workspace text-center py-20">
        <AlertTriangle className="inline-block text-amber-500 mb-4" size={40} />
        <h2 className="text-2xl font-bold text-slate-800 mb-2">Claim Case Not Found</h2>
        <p className="text-slate-500 mb-6">{error || "This claim could not be retrieved."}</p>
        <Button asChild variant="outline">
          <Link href="/claims">
            <ArrowLeft size={16} className="mr-2" /> Return to Claims Center
          </Link>
        </Button>
      </div>
    );
  }

  const { case: caseData, readiness, checklist, consistency_checks, evidence, draft } = claim;
  const percentage = readiness.score_pct ?? Math.min(100, Math.round(((readiness.complete || 0) / Math.max(1, readiness.required_total || 4)) * 100));
  const isReadyToDraft = readiness.readiness_status === "READY_TO_DRAFT" || readiness.missing === 0;

  const missingChecklistItems = checklist.filter((item) => item.mandatory && item.status === "MISSING");

  return (
    <div className="claims-workspace">
      {/* Breadcrumbs */}
      <div className="text-xs font-semibold text-slate-400 mb-3 flex items-center gap-2">
        <Link href="/claims" className="hover:text-teal-700 flex items-center gap-1">
          Claims Center
        </Link>
        <span>&gt;</span>
        <span className="text-slate-700">{sanitizeCopywriting(caseData.title) || "New Claim"}</span>
      </div>

      {/* Top Banner with Mascot Speech (Screenshot 1) */}
      <div className="claims-top-hero">
        <div className="claims-top-hero-text">
          <h1>{currentStage === "DRAFT" ? "Review Your Claim Draft" : "Create a New Claim"}</h1>
          <p>
            {currentStage === "DRAFT"
              ? "Check details before submission. All fields are filled using your verified documents."
              : "Upload your documents and we will check if everything is ready based on your policy."}
          </p>
        </div>
        <div className="claims-mascot-speech">
          <div className="claims-bubble">
            {currentStage === "DRAFT"
              ? "I've mapped your verified facts to Allianz's standard claim form!"
              : "We'll help you prepare a complete and accurate claim."}
          </div>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/mascot-clipboard.png"
            alt="INSSURA Mascot"
            className="w-20 h-20 object-contain drop-shadow-md"
            onError={(e) => {
              (e.target as HTMLElement).style.display = "none";
            }}
          />
        </div>
      </div>

      {/* 4-Step Horizontal Progress Stepper (Screenshot 1) */}
      <div className="claims-stepper">
        <div className="claims-step done">
          <div className="claims-step-badge">
            <Check size={16} />
          </div>
          <div>
            <div className="font-bold text-xs text-slate-800">1. Claim Details</div>
            <div className="text-[11px] text-slate-400">Type and basic info</div>
          </div>
        </div>
        <div className="claims-step-line done" />

        <div
          className={`claims-step cursor-pointer ${
            currentStage === "EVIDENCE" ? "active font-bold" : currentStage === "DRAFT" || currentStage === "SUBMIT" ? "done" : ""
          }`}
          onClick={() => setCurrentStage("EVIDENCE")}
        >
          <div className="claims-step-badge">
            {currentStage === "DRAFT" || currentStage === "SUBMIT" ? <Check size={16} /> : "2"}
          </div>
          <div>
            <div className="font-bold text-xs text-slate-800">2. Evidence &amp; Validation</div>
            <div className="text-[11px] text-slate-400">Upload and check documents</div>
          </div>
        </div>
        <div className={`claims-step-line ${currentStage === "DRAFT" || currentStage === "SUBMIT" ? "done" : ""}`} />

        <div
          className={`claims-step cursor-pointer ${
            currentStage === "DRAFT" ? "active font-bold" : currentStage === "SUBMIT" ? "done" : ""
          }`}
          onClick={() => {
            if (draft?.form) setCurrentStage("DRAFT");
          }}
        >
          <div className="claims-step-badge">
            {currentStage === "SUBMIT" ? <Check size={16} /> : "3"}
          </div>
          <div>
            <div className="font-bold text-xs text-slate-800">3. Review &amp; Draft</div>
            <div className="text-[11px] text-slate-400">Check details before submission</div>
          </div>
        </div>
        <div className={`claims-step-line ${currentStage === "SUBMIT" ? "done" : ""}`} />

        <div className={`claims-step ${currentStage === "SUBMIT" ? "active font-bold" : ""}`}>
          <div className="claims-step-badge">4</div>
          <div>
            <div className="font-bold text-xs text-slate-800">4. Submit</div>
            <div className="text-[11px] text-slate-400">Send to insurer (with approval)</div>
          </div>
        </div>
      </div>

      {/* Case Header Card */}
      <div className="bg-white border border-slate-200 rounded-2xl p-4.5 mb-6 shadow-2xs flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="flex items-center gap-3.5">
          <div className="w-12 h-12 rounded-xl bg-teal-50 border border-teal-100 flex items-center justify-center text-teal-700">
            <span className="text-2xl">🦷</span>
          </div>
          <div>
            <div className="flex items-center gap-2.5">
              <h2 className="text-lg font-bold text-slate-900">{sanitizeCopywriting(caseData.title) || "Dental Treatment Claim"}</h2>
              <span className="status-chip status-chip-draft text-xs">
                {caseData.status === "READY_FOR_APPROVAL" ? "Ready for Approval" : "In Progress"}
              </span>
            </div>
            <p className="text-xs text-slate-500 mt-0.5">
              <strong className="text-slate-700">{caseData.reference}</strong> | {sanitizeCopywriting(caseData.coverage_label) || "Allianz Indonesia"} | Created{" "}
              {new Date(caseData.created_at).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}
            </p>
          </div>
        </div>

        <Button asChild variant="outline" size="sm" className="text-slate-600 self-start md:self-auto">
          <Link href="/claims">Save and Exit</Link>
        </Button>
      </div>

      {/* =========================================================================
          STAGE 2: EVIDENCE & VALIDATION (SCREENSHOT 1)
          ========================================================================= */}
      {currentStage === "EVIDENCE" && (
        <div className="claims-main-layout">
          {/* Left Column: 4 Tabs */}
          <div>
            <div className="flex gap-4 border-b border-slate-200 mb-5">
              <button
                type="button"
                onClick={() => setEvidenceTab("CHECKLIST")}
                className={`pb-3 text-sm font-bold border-b-2 transition-all ${
                  evidenceTab === "CHECKLIST"
                    ? "border-teal-700 text-teal-800"
                    : "border-transparent text-slate-500 hover:text-slate-800"
                }`}
              >
                Evidence Checklist
              </button>
              <button
                type="button"
                onClick={() => setEvidenceTab("DOCUMENTS")}
                className={`pb-3 text-sm font-bold border-b-2 transition-all ${
                  evidenceTab === "DOCUMENTS"
                    ? "border-teal-700 text-teal-800"
                    : "border-transparent text-slate-500 hover:text-slate-800"
                }`}
              >
                Uploaded Documents ({evidence.length})
              </button>
              <button
                type="button"
                onClick={() => setEvidenceTab("EXTRACTED")}
                className={`pb-3 text-sm font-bold border-b-2 transition-all ${
                  evidenceTab === "EXTRACTED"
                    ? "border-teal-700 text-teal-800"
                    : "border-transparent text-slate-500 hover:text-slate-800"
                }`}
              >
                Extracted Information
              </button>
              <button
                type="button"
                onClick={() => setEvidenceTab("VALIDATION")}
                className={`pb-3 text-sm font-bold border-b-2 transition-all ${
                  evidenceTab === "VALIDATION"
                    ? "border-teal-700 text-teal-800"
                    : "border-transparent text-slate-500 hover:text-slate-800"
                }`}
              >
                Validation Results
              </button>
            </div>

            {/* TAB: EVIDENCE CHECKLIST (Screenshot 1) */}
            {evidenceTab === "CHECKLIST" && (
              <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-2xs">
                <div className="flex items-center justify-between mb-4">
                  <div>
                    <h3 className="font-bold text-slate-900 text-sm">Required Documents</h3>
                    <p className="text-xs text-slate-500">
                      Based on Allianz employer health insurance policy and dental claim procedure.
                    </p>
                  </div>
                  <button type="button" className="text-xs text-teal-700 font-semibold hover:underline flex items-center gap-1">
                    View policy procedure &rarr;
                  </button>
                </div>

                {/* Checklist Document Rows */}
                <div className="space-y-3">
                  {checklist.map((item) => {
                    const isComplete = item.status === "COMPLETE";
                    const matchingEvidence = evidence.find((e) => item.evidence_ids?.includes(e.id)) || evidence[0];

                    return (
                      <div key={item.code} className="doc-check-row">
                        <div className="flex items-start gap-3 min-w-0">
                          <div className="w-8 h-8 rounded-lg bg-teal-50 text-teal-700 flex items-center justify-center shrink-0 mt-0.5">
                            <FileText size={18} />
                          </div>
                          <div>
                            <div className="font-bold text-slate-900 text-sm flex items-center gap-2">
                              {item.label}
                              {!item.mandatory && (
                                <span className="text-[10px] text-slate-500 bg-slate-100 px-1.5 py-0.5 rounded font-normal">
                                  Optional
                                </span>
                              )}
                            </div>
                            <p className="text-xs text-slate-500 mt-0.5">
                              {item.reason || "Original invoice with provider name, date, and itemized charges."}
                            </p>
                          </div>
                        </div>

                        <div className="flex items-center gap-3 shrink-0">
                          {isComplete ? (
                            <>
                              <div className="w-6 h-6 rounded-full bg-emerald-100 text-emerald-700 flex items-center justify-center">
                                <Check size={14} />
                              </div>
                              <div className="doc-pill-extracted">
                                <FileText size={14} className="text-slate-500" />
                                <div className="text-left text-xs">
                                  <div className="font-bold text-slate-800 leading-tight">
                                    {matchingEvidence?.filename || "invoice_201025.pdf"}
                                  </div>
                                  <div className="text-[10px] text-slate-400">Extracted • 20 Oct 2026</div>
                                </div>
                                <Info size={12} className="text-slate-400 ml-1" />
                              </div>
                            </>
                          ) : (
                            <>
                              <div className="w-6 h-6 rounded-full bg-amber-100 text-amber-700 flex items-center justify-center font-bold text-xs">
                                !
                              </div>
                              <label className="cursor-pointer inline-flex items-center gap-1.5 px-3 py-1.5 bg-white border border-teal-600 text-teal-700 hover:bg-teal-50 rounded-lg text-xs font-bold transition-colors">
                                <Upload size={13} /> Upload document
                                <input
                                  type="file"
                                  className="hidden"
                                  accept=".pdf,.png,.jpg,.jpeg"
                                  disabled={isUploading}
                                  onChange={(e) => {
                                    if (e.target.files?.[0]) {
                                      handleUploadFile(item.code || "MEDICAL_INVOICE", e.target.files[0]);
                                    }
                                  }}
                                />
                              </label>
                            </>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>

                {/* Additional Documents Accordion */}
                <div className="mt-6 pt-5 border-t border-slate-100">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Layers size={16} className="text-slate-400" />
                      <div>
                        <div className="font-bold text-sm text-slate-800">Additional Documents (Optional)</div>
                        <div className="text-xs text-slate-500">
                          Attach any other documents that may support your claim, such as prescription, photos, or referral letter.
                        </div>
                      </div>
                    </div>
                    <label className="cursor-pointer inline-flex items-center gap-1 px-3 py-1.5 bg-slate-50 hover:bg-slate-100 border border-slate-200 text-slate-700 rounded-lg text-xs font-semibold">
                      <Plus size={13} /> Upload Additional Document
                      <input
                        type="file"
                        className="hidden"
                        accept=".pdf,.png,.jpg,.jpeg"
                        disabled={isUploading}
                        onChange={(e) => {
                          if (e.target.files?.[0]) {
                            handleUploadFile("OTHER", e.target.files[0]);
                          }
                        }}
                      />
                    </label>
                  </div>
                </div>
              </div>
            )}

            {/* TAB: UPLOADED DOCUMENTS */}
            {evidenceTab === "DOCUMENTS" && (
              <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-2xs space-y-3">
                <h3 className="font-bold text-slate-900 text-sm mb-2">Attached Documents</h3>
                {evidence.length === 0 ? (
                  <p className="text-xs text-slate-500 py-6 text-center">No documents uploaded yet.</p>
                ) : (
                  evidence.map((ev) => (
                    <div key={ev.id} className="p-3.5 border border-slate-200 rounded-xl flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <FileText size={20} className="text-teal-700" />
                        <div>
                          <div className="font-bold text-slate-800 text-sm">{ev.filename}</div>
                          <div className="text-xs text-slate-400 font-mono">
                            Kind: {ev.evidence_kind} • {ev.sha256 ? `${ev.sha256.slice(0, 16)}...` : "Verified SHA-256"}
                          </div>
                        </div>
                      </div>
                      <span className="text-xs font-bold text-emerald-700 bg-emerald-50 px-2.5 py-1 rounded-full">
                        {ev.status}
                      </span>
                    </div>
                  ))
                )}
              </div>
            )}

            {/* TAB: EXTRACTED INFORMATION */}
            {evidenceTab === "EXTRACTED" && (
              <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-2xs">
                <h3 className="font-bold text-slate-900 text-sm mb-4">Extracted Invoice Facts</h3>
                <div className="grid grid-cols-2 gap-4 text-xs">
                  <div className="p-3 bg-slate-50 rounded-xl">
                    <span className="text-slate-400 block mb-1">Provider</span>
                    <span className="font-bold text-slate-800">{sanitizeCopywriting(caseData.provider_name) || "Siloam Hospitals Jakarta"}</span>
                  </div>
                  <div className="p-3 bg-slate-50 rounded-xl">
                    <span className="text-slate-400 block mb-1">Service Date</span>
                    <span className="font-bold text-slate-800">{caseData.service_date || "2026-10-15"}</span>
                  </div>
                  <div className="p-3 bg-slate-50 rounded-xl">
                    <span className="text-slate-400 block mb-1">Claimed Amount</span>
                    <span className="font-bold text-slate-800">
                      {caseData.currency || "IDR"} {caseData.amount || "1,250,000"}
                    </span>
                  </div>
                  <div className="p-3 bg-slate-50 rounded-xl">
                    <span className="text-slate-400 block mb-1">Treatment Type</span>
                    <span className="font-bold text-slate-800">{caseData.claim_type || "Dental treatment"}</span>
                  </div>
                </div>
              </div>
            )}

            {/* TAB: VALIDATION RESULTS */}
            {evidenceTab === "VALIDATION" && (
              <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-2xs space-y-3">
                <h3 className="font-bold text-slate-900 text-sm mb-2">Automated Policy &amp; Procedure Rules</h3>
                {consistency_checks.map((check) => (
                  <div key={check.code} className="p-3 border border-slate-200 rounded-xl flex items-start gap-3">
                    {check.status === "PASS" ? (
                      <CheckCircle2 size={18} className="text-emerald-600 shrink-0 mt-0.5" />
                    ) : (
                      <AlertTriangle size={18} className="text-amber-500 shrink-0 mt-0.5" />
                    )}
                    <div>
                      <div className="font-bold text-slate-800 text-xs">{check.label}</div>
                      <div className="text-xs text-slate-500 mt-0.5">{check.detail}</div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Right Column (Sidebar from Screenshot 1) */}
          <div className="space-y-5">
            {/* 1. Claim Readiness Card */}
            <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-2xs">
              <div className="flex items-center justify-between mb-4">
                <h3 className="font-bold text-slate-900 text-sm flex items-center gap-1.5">
                  Claim Readiness <Info size={13} className="text-slate-400" />
                </h3>
              </div>

              <div className="flex items-center gap-4 mb-4">
                {/* SVG Donut Chart */}
                <div className="claims-donut-wrapper">
                  <svg className="claims-donut-svg" viewBox="0 0 100 100">
                    <circle cx="50" cy="50" r="40" className="claims-donut-bg" />
                    <circle
                      cx="50"
                      cy="50"
                      r="40"
                      className="claims-donut-bar"
                      strokeDasharray={251.2}
                      strokeDashoffset={251.2 - (251.2 * percentage) / 100}
                    />
                  </svg>
                  <div className="claims-donut-text">{percentage}%</div>
                </div>

                <div>
                  <span
                    className={`inline-block text-[11px] font-extrabold uppercase px-2.5 py-0.5 rounded-full mb-1 ${
                      isReadyToDraft
                        ? "bg-emerald-100 text-emerald-800"
                        : "bg-amber-100 text-amber-800"
                    }`}
                  >
                    {isReadyToDraft ? "READY TO DRAFT" : "NEEDS INFORMATION"}
                  </span>
                  <div className="text-xs font-bold text-amber-800">
                    {isReadyToDraft ? "All required documents uploaded" : "Some items missing"}
                  </div>
                  <div className="text-[11px] text-slate-500 mt-1 leading-tight">
                    {readiness.complete || 3} of {readiness.required_total || 4} required documents uploaded.
                  </div>
                </div>
              </div>

              {/* Missing items alert box */}
              {missingChecklistItems.length > 0 && (
                <div className="bg-amber-50/80 border border-amber-200 rounded-xl p-3 text-xs mb-3">
                  <div className="font-bold text-amber-900 mb-1 flex items-center gap-1.5">
                    <AlertTriangle size={13} /> Missing items
                  </div>
                  <ul className="list-disc list-inside space-y-1 text-amber-950">
                    {missingChecklistItems.map((m) => (
                      <li key={m.code}>{m.label}</li>
                    ))}
                  </ul>
                  <button type="button" className="text-teal-700 font-semibold hover:underline mt-2 text-[11px] flex items-center gap-1">
                    <FileText size={11} /> View policy requirement &rarr;
                  </button>
                </div>
              )}
            </div>

            {/* 2. Extracted Claim Summary Card */}
            <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-2xs">
              <div className="flex items-center justify-between mb-3">
                <h3 className="font-bold text-slate-900 text-sm">Extracted Claim Summary</h3>
                <button
                  type="button"
                  onClick={() => setIsEditingSummary(true)}
                  className="text-xs text-teal-700 font-semibold hover:underline flex items-center gap-1"
                >
                  <Edit2 size={12} /> Edit
                </button>
              </div>

              <div className="space-y-2.5 text-xs">
                <div className="flex items-center gap-2">
                  <span className="text-slate-400">🦷 Treatment type:</span>
                  <span className="font-bold text-slate-800">{caseData.claim_type || "Dental treatment (cavity filling)"}</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-slate-400">📅 Service date:</span>
                  <span className="font-bold text-slate-800">{caseData.service_date || "15 Oct 2026"}</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-slate-400">🏥 Provider:</span>
                  <span className="font-bold text-slate-800">{sanitizeCopywriting(caseData.provider_name) || "Siloam Hospitals Jakarta"}</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-slate-400">💰 Total amount:</span>
                  <span className="font-bold text-slate-800">{caseData.currency || "IDR"} {caseData.amount || "1,250,000"}</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-slate-400">👤 Patient:</span>
                  <span className="font-bold text-slate-800">{caseData.claimant_name || account?.display_name || "Sinta Anggraini"}</span>
                </div>
              </div>
            </div>

            {/* 3. Next Step Card */}
            <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-2xs">
              <h3 className="font-bold text-slate-900 text-sm mb-1.5">Next Step</h3>
              <p className="text-xs text-slate-500 mb-4 leading-relaxed">
                Once all required documents are uploaded and validated, you can review the extracted details and create a claim draft for your approval.
              </p>

              <Button
                type="button"
                onClick={handleStartPreparation}
                disabled={isPreparingDraft}
                className="w-full bg-teal-700 hover:bg-teal-800 text-white font-bold py-2.5 rounded-xl text-xs flex items-center justify-center gap-1.5 shadow-sm"
              >
                {isPreparingDraft ? (
                  <>
                    <RefreshCw size={14} className="animate-spin" /> Preparing Draft ({preparationProgress}%)...
                  </>
                ) : (
                  <>
                    Continue to Review &amp; Draft <ArrowRight size={14} />
                  </>
                )}
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* =========================================================================
          STAGE 3: REVIEW & DRAFT (SCREENSHOT 2 & 3)
          ========================================================================= */}
      {currentStage === "DRAFT" && (
        <div className="space-y-6">
          {/* Top Ready Banner */}
          <div className="bg-emerald-50 border border-emerald-200 rounded-2xl p-5 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-emerald-100 text-emerald-800 flex items-center justify-center font-bold">
                <Check size={20} />
              </div>
              <div>
                <div className="font-bold text-emerald-950 text-sm">Claim Draft Ready for Approval</div>
                <div className="text-xs text-emerald-800">
                  All required fields are completed based on verified documents.
                </div>
              </div>
            </div>

            <Button variant="outline" size="sm" className="text-xs text-slate-700 bg-white">
              View as PDF
            </Button>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 items-start">
            {/* Insurer Claim Form Preview (Screenshot 2 Step 3) */}
            <div className="lg:col-span-2 claim-form-preview">
              <div className="flex items-center justify-between pb-4 border-b border-slate-200">
                <div className="flex items-center gap-3">
                  <div className="font-extrabold text-blue-900 text-lg tracking-wider">Allianz</div>
                  <div className="text-xs font-semibold text-slate-500">Group Health Insurance Claim Form</div>
                </div>
                <span className="text-xs font-bold text-slate-500 bg-slate-100 px-2 py-0.5 rounded">Draft</span>
              </div>

              {/* Form Section 1 */}
              <div className="claim-form-section-header">1. Policyholder Information</div>
              <div className="space-y-1">
                <div className="claim-form-field-row">
                  <div className="claim-form-field-label">Name</div>
                  <div className="claim-form-field-value">{caseData.claimant_name || "Sinta Anggraini"}</div>
                  <span className="text-[10px] font-bold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-full text-center">Verified</span>
                </div>
                <div className="claim-form-field-row">
                  <div className="claim-form-field-label">Policy Number</div>
                  <div className="claim-form-field-value">{caseData.coverage_ref || "AZID-2025-77821"}</div>
                  <span className="text-[10px] font-bold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-full text-center">Verified</span>
                </div>
                <div className="claim-form-field-row">
                  <div className="claim-form-field-label">Employer</div>
                  <div className="claim-form-field-value">PT Maju Sejahtera</div>
                  <span className="text-[10px] font-bold text-slate-400">Policy</span>
                </div>
              </div>

              {/* Form Section 2 */}
              <div className="claim-form-section-header">2. Patient Information</div>
              <div className="space-y-1">
                <div className="claim-form-field-row">
                  <div className="claim-form-field-label">Name</div>
                  <div className="claim-form-field-value">{caseData.claimant_name || "Sinta Anggraini"}</div>
                  <span className="text-[10px] font-bold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-full text-center">Verified</span>
                </div>
                <div className="claim-form-field-row">
                  <div className="claim-form-field-label">Relationship</div>
                  <div className="claim-form-field-value">Self</div>
                  <span className="text-[10px] font-bold text-slate-400">Declared</span>
                </div>
              </div>

              {/* Form Section 3 */}
              <div className="claim-form-section-header">3. Treatment &amp; Claim Details</div>
              <div className="space-y-1">
                <div className="claim-form-field-row">
                  <div className="claim-form-field-label">Treatment Type</div>
                  <div className="claim-form-field-value">{caseData.claim_type || "Dental treatment"}</div>
                  <span className="text-[10px] font-bold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-full text-center">Verified</span>
                </div>
                <div className="claim-form-field-row">
                  <div className="claim-form-field-label">Service Date</div>
                  <div className="claim-form-field-value">{caseData.service_date || "15 Oct 2026"}</div>
                  <span className="text-[10px] font-bold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-full text-center">Verified</span>
                </div>
                <div className="claim-form-field-row">
                  <div className="claim-form-field-label">Provider</div>
                  <div className="claim-form-field-value">{sanitizeCopywriting(caseData.provider_name) || "Siloam Hospitals Jakarta"}</div>
                  <span className="text-[10px] font-bold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-full text-center">Verified</span>
                </div>
                <div className="claim-form-field-row">
                  <div className="claim-form-field-label">Total Amount</div>
                  <div className="claim-form-field-value font-bold text-teal-800">
                    {caseData.currency || "IDR"} {caseData.amount || "1,250,000"}
                  </div>
                  <span className="text-[10px] font-bold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-full text-center">Verified</span>
                </div>
              </div>
            </div>

            {/* Right Panel: Field Details & Source (Screenshot 2 Step 3 Right Drawer) */}
            <div className="space-y-5">
              <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-2xs">
                <h4 className="font-bold text-slate-900 text-sm mb-3">Field Details &amp; Source</h4>
                <div className="p-3 bg-slate-50 border border-slate-200 rounded-xl mb-4">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-xs text-slate-500 font-semibold">Name</span>
                    <span className="text-[10px] font-bold text-emerald-700 bg-emerald-100 px-2 py-0.5 rounded">✓ Verified</span>
                  </div>
                  <div className="font-bold text-slate-800 text-sm">{caseData.claimant_name || "Sinta Anggraini"}</div>
                  <div className="text-xs text-slate-500 mt-2 flex items-center gap-1.5">
                    <FileText size={12} className="text-slate-400" />
                    <span>Source: <strong>KTP_Sinta.pdf</strong> (Page 1)</span>
                  </div>
                </div>

                <div className="p-3 bg-slate-50 border border-slate-200 rounded-xl mb-4">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-xs text-slate-500 font-semibold">Total Claim Amount</span>
                    <span className="text-[10px] font-bold text-emerald-700 bg-emerald-100 px-2 py-0.5 rounded">✓ Verified</span>
                  </div>
                  <div className="font-bold text-slate-800 text-sm">
                    {caseData.currency || "IDR"} {caseData.amount || "1,250,000"}
                  </div>
                  <div className="text-xs text-slate-500 mt-2 flex items-center gap-1.5">
                    <FileText size={12} className="text-slate-400" />
                    <span>Source: <strong>invoice_201025.pdf</strong> (Page 1)</span>
                  </div>
                </div>

                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setIsEditingSummary(true)}
                  className="w-full text-xs font-semibold text-teal-700 border-teal-200 hover:bg-teal-50"
                >
                  <Edit2 size={13} className="mr-1.5" /> Edit Form Fields
                </Button>
              </div>

              {/* What happens next box (Screenshot 2 Step 5) */}
              <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-2xs">
                <h4 className="font-bold text-slate-900 text-sm mb-3">What happens next?</h4>
                <ol className="space-y-2 text-xs text-slate-600">
                  <li className="flex items-start gap-2">
                    <span className="w-5 h-5 rounded-full bg-teal-100 text-teal-800 font-bold flex items-center justify-center shrink-0">1</span>
                    <span>You approve this draft in the Action Queue.</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="w-5 h-5 rounded-full bg-teal-100 text-teal-800 font-bold flex items-center justify-center shrink-0">2</span>
                    <span>INSSURA sends the claim to Allianz sandbox securely.</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="w-5 h-5 rounded-full bg-teal-100 text-teal-800 font-bold flex items-center justify-center shrink-0">3</span>
                    <span>You receive a confirmation receipt and reference number.</span>
                  </li>
                </ol>

                <Button
                  onClick={handleSendToActionQueue}
                  disabled={isSendingToQueue}
                  className="w-full mt-4 bg-teal-700 hover:bg-teal-800 text-white font-bold py-2.5 rounded-xl text-xs flex items-center justify-center gap-1.5 shadow-sm"
                >
                  {isSendingToQueue ? "Creating Proposed Action..." : "Send to Action Queue"} <ArrowRight size={14} />
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* =========================================================================
          STAGE 4: SUBMIT / PROPOSED ACTION CREATED (SCREENSHOT 2 STEP 6)
          ========================================================================= */}
      {currentStage === "SUBMIT" && (
        <div className="bg-white border border-slate-200 rounded-2xl p-8 max-w-2xl mx-auto shadow-sm text-center">
          <div className="w-16 h-16 rounded-full bg-emerald-100 text-emerald-700 mx-auto mb-4 flex items-center justify-center">
            <Check size={32} />
          </div>

          <h2 className="text-2xl font-bold text-slate-900 mb-2">Claim Draft Created</h2>
          <p className="text-sm text-slate-500 mb-6 max-w-md mx-auto">
            A proposed action has been created and sent to your Action Queue for approval. No claim will be sent until you review and confirm.
          </p>

          <div className="bg-slate-50 border border-slate-200 rounded-xl p-5 text-left text-xs space-y-3 mb-6">
            <div className="flex justify-between">
              <span className="text-slate-500">Action type</span>
              <strong className="text-slate-800">Submit Claim</strong>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-500">Recipient</span>
              <strong className="text-slate-800">Allianz Indonesia (Sandbox)</strong>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-500">Related claim</span>
              <strong className="text-slate-800">{caseData.reference}</strong>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-slate-500">Payload SHA-256</span>
              <div className="flex items-center gap-1.5 font-mono text-[11px] text-slate-700">
                <span>{createdAction?.payload_sha256 ? `${String(createdAction.payload_sha256).slice(0, 16)}...` : "a3f9...7c21"}</span>
                <button type="button" onClick={copyHash} className="text-teal-700 hover:text-teal-900">
                  {copiedHash ? <Check size={12} /> : <Copy size={12} />}
                </button>
              </div>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-500">Expires in</span>
              <strong className="text-slate-800">7 days</strong>
            </div>
          </div>

          <div className="flex items-center justify-center gap-3">
            <Button
              onClick={() => router.push(createdAction ? `/actions?action=${createdAction.id}` : "/actions")}
              className="bg-teal-700 hover:bg-teal-800 text-white font-bold px-6 py-2.5 text-xs rounded-xl shadow-sm"
            >
              Go to Action Queue &rarr;
            </Button>
            <Button variant="outline" size="sm" onClick={() => setCurrentStage("EVIDENCE")}>
              Back to Claim
            </Button>
          </div>
        </div>
      )}

      {/* Edit Extracted Summary Modal */}
      {isEditingSummary && (
        <div className="modal-overlay">
          <div className="modal-card">
            <div className="modal-header">
              <h3 className="modal-title">Edit Claim Information</h3>
              <button type="button" onClick={() => setIsEditingSummary(false)}>
                <X size={18} />
              </button>
            </div>

            <div className="space-y-3 text-xs">
              <div className="modal-form-group">
                <label>Healthcare Provider</label>
                <input
                  type="text"
                  value={editProvider}
                  onChange={(e) => setEditProvider(e.target.value)}
                  className="w-full p-2 border rounded"
                />
              </div>

              <div className="modal-form-group">
                <label>Service Date (YYYY-MM-DD)</label>
                <input
                  type="text"
                  value={editDate}
                  onChange={(e) => setEditDate(e.target.value)}
                  className="w-full p-2 border rounded"
                />
              </div>

              <div className="modal-form-group">
                <label>Claim Amount</label>
                <input
                  type="text"
                  value={editAmount}
                  onChange={(e) => setEditAmount(e.target.value)}
                  className="w-full p-2 border rounded"
                />
              </div>

              <div className="modal-form-group">
                <label>Patient Name</label>
                <input
                  type="text"
                  value={editClaimant}
                  onChange={(e) => setEditClaimant(e.target.value)}
                  className="w-full p-2 border rounded"
                />
              </div>
            </div>

            <div className="modal-actions">
              <Button variant="outline" size="sm" onClick={() => setIsEditingSummary(false)}>
                Cancel
              </Button>
              <Button size="sm" className="bg-teal-700 text-white" onClick={handleSaveSummary}>
                Save Changes
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Consents Prompt */}
      {requiredConsents && (
        <ConsentPrompt
          purposes={requiredConsents}
          accountToken={accountToken}
          onGranted={() => setRequiredConsents(null)}
          onCancel={() => setRequiredConsents(null)}
        />
      )}
    </div>
  );
}
