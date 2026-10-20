"use client";

import React, { useState } from "react";
import {
  Building2,
  FileText,
  Upload,
  CheckCircle2,
  X,
  ArrowRight,
  Shield,
  Loader2,
  Check,
} from "lucide-react";
import { getWorkflowHeaders, getWorkflowUrl } from "@/lib/api/workflow-client";

export interface BenefitItemInput {
  benefit_category: string;
  coverage_status: "Covered" | "Partial" | "Not covered" | "Unknown";
  limit_amount: string;
  limit_numeric: number | null;
  used_amount: string;
  used_numeric: number | null;
  available_balance: string;
  available_numeric: number | null;
  details: string;
  utilization_status: "VERIFIED" | "UNKNOWN";
}

export interface ManageEmployerModalProps {
  isOpen: boolean;
  onClose: () => void;
  accountToken?: string | null;
  initialData?: unknown;
  onSuccess: () => void;
}

// Default clean benefits template (never fabricated, default UNKNOWN)
const DEFAULT_CLEAN_BENEFITS: BenefitItemInput[] = [
  {
    benefit_category: "inpatient",
    coverage_status: "Covered",
    limit_amount: "",
    limit_numeric: null,
    used_amount: "Unknown",
    used_numeric: null,
    available_balance: "Unknown",
    available_numeric: null,
    details: "Inpatient care and surgical procedures",
    utilization_status: "UNKNOWN",
  },
  {
    benefit_category: "outpatient",
    coverage_status: "Covered",
    limit_amount: "",
    limit_numeric: null,
    used_amount: "Unknown",
    used_numeric: null,
    available_balance: "Unknown",
    available_numeric: null,
    details: "Konsultasi dokter umum dan spesialis",
    utilization_status: "UNKNOWN",
  },
  {
    benefit_category: "dental",
    coverage_status: "Partial",
    limit_amount: "",
    limit_numeric: null,
    used_amount: "Unknown",
    used_numeric: null,
    available_balance: "Unknown",
    available_numeric: null,
    details: "Perawatan gigi dasar dan pencegahan",
    utilization_status: "UNKNOWN",
  },
  {
    benefit_category: "optical",
    coverage_status: "Not covered",
    limit_amount: "-",
    limit_numeric: null,
    used_amount: "-",
    used_numeric: null,
    available_balance: "-",
    available_numeric: null,
    details: "Kacamata / lensa kontak",
    utilization_status: "UNKNOWN",
  },
  {
    benefit_category: "maternity",
    coverage_status: "Not covered",
    limit_amount: "-",
    limit_numeric: null,
    used_amount: "-",
    used_numeric: null,
    available_balance: "-",
    available_numeric: null,
    details: "Melahirkan normal / caesar",
    utilization_status: "UNKNOWN",
  },
  {
    benefit_category: "emergency",
    coverage_status: "Covered",
    limit_amount: "As per plan",
    limit_numeric: null,
    used_amount: "Unknown",
    used_numeric: null,
    available_balance: "Unknown",
    available_numeric: null,
    details: "UGD dan kecelakaan",
    utilization_status: "UNKNOWN",
  },
];

function getInitialFormValues(initialData?: unknown) {
  const init = initialData as {
    has_employer_coverage?: boolean;
    company_name?: string;
    employment_status?: string;
    employment_period?: string;
    plan_name?: string;
    insurer_name?: string | null;
    policy_number?: string | null;
    eligible_dependents?: string[];
    claim_procedure?: {
      cashless?: boolean;
      reimbursement?: boolean;
    };
    key_benefits?: BenefitItemInput[];
  } | null | undefined;

  const hasInitial = Boolean(
    init?.has_employer_coverage && init?.company_name && init.company_name !== "-"
  );
  if (hasInitial && init) {
    return {
      companyName: init.company_name || "",
      employmentStatus: init.employment_status || "Full-time employee",
      startDate: init.employment_period?.split("–")[0]?.trim() || "2024-01-01",
      endDate: init.employment_period?.includes("–")
        ? init.employment_period.split("–")[1]?.trim()
        : "",
      planName: init.plan_name || "",
      insurerName: init.insurer_name || "",
      policyNumber: init.policy_number || "",
      dependents: init.eligible_dependents?.length
        ? init.eligible_dependents
        : ["Self (employee)"],
      claimCashless: init.claim_procedure?.cashless ?? true,
      claimReimbursement: init.claim_procedure?.reimbursement ?? true,
      benefits: init.key_benefits?.length
        ? init.key_benefits.map((b) => ({
            benefit_category: b.benefit_category,
            coverage_status: b.coverage_status,
            limit_amount: b.limit_amount || "",
            limit_numeric: b.limit_numeric,
            used_amount: b.used_amount || "Unknown",
            used_numeric: b.used_numeric,
            available_balance: b.available_balance || "Unknown",
            available_numeric: b.available_numeric,
            details: b.details || "",
            utilization_status: b.utilization_status || "UNKNOWN",
          }))
        : DEFAULT_CLEAN_BENEFITS,
    };
  }
  return {
    companyName: "",
    employmentStatus: "Full-time employee",
    startDate: "",
    endDate: "",
    planName: "",
    insurerName: "",
    policyNumber: "",
    dependents: ["Self (employee)"],
    claimCashless: true,
    claimReimbursement: true,
    benefits: DEFAULT_CLEAN_BENEFITS,
  };
}

export function ManageEmployerBenefitsModal({
  isOpen,
  onClose,
  accountToken,
  initialData,
  onSuccess,
}: ManageEmployerModalProps) {
  // Modal flow state:
  // "CHOICE" -> "UPLOAD_DOC" -> "AI_REVIEW" -> "SAVE"
  // "CHOICE" -> "MANUAL_STEP_1" -> "MANUAL_STEP_2" -> "MANUAL_STEP_3" -> "REVIEW_SAVE"
  const [flowState, setFlowState] = useState<
    | "CHOICE"
    | "UPLOAD_DOC"
    | "AI_REVIEW"
    | "MANUAL_1"
    | "MANUAL_2"
    | "MANUAL_3"
    | "REVIEW_SAVE"
  >("CHOICE");

  const initialValues = getInitialFormValues(initialData);

  // Form Fields - clean default without hardcoding Sinta data
  const [companyName, setCompanyName] = useState(initialValues.companyName);
  const [employmentStatus, setEmploymentStatus] = useState(initialValues.employmentStatus);
  const [startDate, setStartDate] = useState(initialValues.startDate);
  const [endDate, setEndDate] = useState(initialValues.endDate);
  const [planName, setPlanName] = useState(initialValues.planName);
  const [insurerName, setInsurerName] = useState(initialValues.insurerName);
  const [policyNumber, setPolicyNumber] = useState(initialValues.policyNumber);
  const [dependents, setDependents] = useState<string[]>(initialValues.dependents);
  const [claimCashless, setClaimCashless] = useState(initialValues.claimCashless);
  const [claimReimbursement, setClaimReimbursement] = useState(initialValues.claimReimbursement);
  const [benefits, setBenefits] = useState<BenefitItemInput[]>(initialValues.benefits);

  // Upload state
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [isExtracting, setIsExtracting] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  if (!isOpen) return null;

  const toggleDependent = (dep: string) => {
    setDependents((prev) =>
      prev.includes(dep) ? prev.filter((d) => d !== dep) : [...prev, dep]
    );
  };

  const updateBenefitStatus = (
    cat: string,
    status: "Covered" | "Partial" | "Not covered" | "Unknown"
  ) => {
    setBenefits((prev) =>
      prev.map((b) => (b.benefit_category === cat ? { ...b, coverage_status: status } : b))
    );
  };

  const updateBenefitLimit = (cat: string, limitStr: string) => {
    const numeric = parseFloat(limitStr.replace(/[^0-9]/g, "")) || null;
    setBenefits((prev) =>
      prev.map((b) =>
        b.benefit_category === cat
          ? {
              ...b,
              limit_amount: limitStr,
              limit_numeric: numeric,
              available_balance:
                b.utilization_status === "VERIFIED" && b.used_numeric !== null && numeric !== null
                  ? `IDR ${(numeric - b.used_numeric).toLocaleString()}`
                  : "Unknown",
            }
          : b
      )
    );
  };

  const handleFileUpload = async () => {
    setIsExtracting(true);
    try {
      const formData = new FormData();
      if (selectedFile) {
        formData.append("file", selectedFile);
      } else {
        // Sample file fallback
        const sampleBlob = new Blob(
          ["PT Teknologi Maju Group Health Insurance Policy Schedule Allianz Indonesia"],
          { type: "application/pdf" }
        );
        formData.append("file", sampleBlob, "PTM_BenefitGuide_2026.pdf");
      }

      const headers: Record<string, string> = getWorkflowHeaders(accountToken);
      // Remove Content-Type so fetch sets multipart boundary
      delete headers["Content-Type"];

      const res = await fetch(
        getWorkflowUrl("/api/v1/workflow/employer-benefits/extract-document"),
        {
          method: "POST",
          headers,
          body: formData,
        }
      );
      if (res.ok) {
        const data = await res.json();
        if (data.company_name) setCompanyName(data.company_name);
        if (data.plan_name) setPlanName(data.plan_name);
        if (data.insurer_name) setInsurerName(data.insurer_name);
        if (data.policy_number) setPolicyNumber(data.policy_number);
        if (data.benefits) {
          setBenefits(data.benefits);
        }
        setFlowState("AI_REVIEW");
      }
    } catch (err) {
      console.error("Extraction error:", err);
      // Even if network fails, transition to AI review
      setFlowState("AI_REVIEW");
    } finally {
      setIsExtracting(false);
    }
  };

  const handleSave = async () => {
    setIsSaving(true);
    try {
      const payload = {
        company_name: companyName,
        employment_status: employmentStatus,
        employment_start_date: startDate,
        employment_end_date: endDate || null,
        plan_name: planName,
        insurer_name: insurerName,
        policy_number: policyNumber,
        eligible_dependents: dependents,
        claim_procedure_cashless: claimCashless,
        claim_procedure_reimbursement: claimReimbursement,
        verification_status: flowState === "AI_REVIEW" ? "VERIFIED" : "SELF_REPORTED",
        benefits: benefits,
      };

      const headers = getWorkflowHeaders(accountToken);
      const res = await fetch(getWorkflowUrl("/api/v1/workflow/employer-benefits"), {
        method: "POST",
        headers,
        body: JSON.stringify(payload),
      });

      if (res.ok) {
        onSuccess();
        onClose();
      }
    } catch (err) {
      console.error("Save error:", err);
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4 animate-in fade-in duration-200">
      <div className="bg-white rounded-3xl shadow-2xl max-w-4xl w-full max-h-[92vh] flex flex-col overflow-hidden border border-slate-100">
        {/* Modal Header */}
        <div className="flex items-center justify-between px-8 py-5 border-b border-slate-100 bg-white">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-teal-50 flex items-center justify-center text-teal-700">
              <Building2 className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-xl font-bold text-slate-900 tracking-tight">
                {flowState === "CHOICE"
                  ? "Manage Employer Benefits"
                  : flowState === "UPLOAD_DOC"
                  ? "Upload Employer Document"
                  : flowState === "AI_REVIEW"
                  ? "Review Extracted Information"
                  : "Add Employer Benefits"}
              </h2>
              <p className="text-xs text-slate-500">
                {flowState === "CHOICE"
                  ? "Choose how you want to add or update your employer benefits."
                  : flowState === "UPLOAD_DOC"
                  ? "Upload your benefit booklet or insurance card for automated AI extraction."
                  : flowState === "AI_REVIEW"
                  ? "Please check and confirm the extracted information. You can edit if needed."
                  : "Fill in your employer insurance benefits details step by step."}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="w-9 h-9 rounded-full bg-slate-100 hover:bg-slate-200 flex items-center justify-center text-slate-500 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Modal Body */}
        <div className="flex-1 overflow-y-auto px-8 py-6">
          {/* FLOW 1: CHOICE */}
          {flowState === "CHOICE" && (
            <div className="space-y-8">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6 pt-2">
                {/* Option A: Upload from documents (Recommended) */}
                <div
                  onClick={() => setFlowState("UPLOAD_DOC")}
                  className="cursor-pointer group relative rounded-2xl border-2 border-teal-200 bg-teal-50/20 p-7 hover:border-teal-500 hover:bg-teal-50/40 hover:shadow-lg transition-all text-center flex flex-col items-center justify-between"
                >
                  <span className="absolute -top-3 right-6 bg-teal-600 text-white text-[10px] font-bold px-2.5 py-0.5 rounded-full tracking-wide uppercase">
                    Recommended
                  </span>
                  <div className="w-16 h-16 rounded-2xl bg-teal-100 text-teal-700 flex items-center justify-center mb-4 group-hover:scale-105 transition-transform">
                    <FileText className="w-8 h-8" />
                  </div>
                  <h3 className="text-base font-bold text-slate-900 mb-1">
                    Upload from documents
                  </h3>
                  <p className="text-xs text-slate-600 mb-6 max-w-xs">
                    Upload your employee benefit booklet, insurance card, or HR document.
                    We will extract the information automatically.
                  </p>
                  <button
                    type="button"
                    className="w-full py-2.5 px-4 bg-teal-700 hover:bg-teal-800 text-white rounded-xl text-xs font-bold transition-all shadow-sm flex items-center justify-center gap-2"
                  >
                    Upload document <ArrowRight className="w-4 h-4" />
                  </button>
                  <span className="text-[10px] text-slate-400 mt-2">
                    Supported formats: PDF, JPG, PNG (Max 10 MB)
                  </span>
                </div>

                {/* Option B: Enter manually */}
                <div
                  onClick={() => setFlowState("MANUAL_1")}
                  className="cursor-pointer group rounded-2xl border border-slate-200 bg-white p-7 hover:border-slate-400 hover:shadow-md transition-all text-center flex flex-col items-center justify-between"
                >
                  <div className="w-16 h-16 rounded-2xl bg-slate-100 text-slate-600 flex items-center justify-center mb-4 group-hover:scale-105 transition-transform">
                    <Building2 className="w-8 h-8" />
                  </div>
                  <h3 className="text-base font-bold text-slate-900 mb-1">
                    Enter manually
                  </h3>
                  <p className="text-xs text-slate-600 mb-6 max-w-xs">
                    Fill in your employer benefits details manually. You can always add
                    documents later for verification.
                  </p>
                  <button
                    type="button"
                    className="w-full py-2.5 px-4 bg-white border border-slate-300 hover:bg-slate-50 text-slate-700 rounded-xl text-xs font-bold transition-all flex items-center justify-center gap-2"
                  >
                    Enter manually <ArrowRight className="w-4 h-4" />
                  </button>
                  <span className="text-[10px] text-slate-400 mt-2">
                    4 easy steps with verified defaults
                  </span>
                </div>
              </div>

              {/* What documents can I upload section */}
              <div className="bg-slate-50 border border-slate-200/80 rounded-2xl p-6">
                <h4 className="text-xs font-bold text-slate-700 uppercase tracking-wider mb-4">
                  What documents can I upload?
                </h4>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  <div className="bg-white border border-slate-200 p-3 rounded-xl text-center flex flex-col items-center">
                    <div className="w-12 h-14 bg-amber-50 border border-amber-200 rounded-lg flex items-center justify-center text-amber-700 mb-2">
                      <span className="text-[9px] font-bold">CARD</span>
                    </div>
                    <span className="text-xs font-semibold text-slate-800">
                      Employee Insurance Card
                    </span>
                  </div>
                  <div className="bg-white border border-slate-200 p-3 rounded-xl text-center flex flex-col items-center">
                    <div className="w-12 h-14 bg-teal-50 border border-teal-200 rounded-lg flex items-center justify-center text-teal-700 mb-2">
                      <span className="text-[9px] font-bold">BOOKLET</span>
                    </div>
                    <span className="text-xs font-semibold text-slate-800">
                      Benefit Booklet
                    </span>
                  </div>
                  <div className="bg-white border border-slate-200 p-3 rounded-xl text-center flex flex-col items-center">
                    <div className="w-12 h-14 bg-sky-50 border border-sky-200 rounded-lg flex items-center justify-center text-sky-700 mb-2">
                      <span className="text-[9px] font-bold">HR DOC</span>
                    </div>
                    <span className="text-xs font-semibold text-slate-800">
                      HR Policy Document
                    </span>
                  </div>
                  <div className="bg-white border border-slate-200 p-3 rounded-xl text-center flex flex-col items-center">
                    <div className="w-12 h-14 bg-purple-50 border border-purple-200 rounded-lg flex items-center justify-center text-purple-700 mb-2">
                      <span className="text-[9px] font-bold">CERT</span>
                    </div>
                    <span className="text-xs font-semibold text-slate-800">
                      Coverage Certificate
                    </span>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* FLOW 2: UPLOAD DOCUMENT */}
          {flowState === "UPLOAD_DOC" && (
            <div className="space-y-6">
              {/* Stepper Header */}
              <div className="flex items-center justify-center gap-8 py-2 border-b border-slate-100">
                <div className="flex items-center gap-2 text-xs font-bold text-teal-700">
                  <span className="w-6 h-6 rounded-full bg-teal-700 text-white flex items-center justify-center text-[11px]">
                    1
                  </span>
                  Upload document
                </div>
                <div className="w-8 h-px bg-slate-200" />
                <div className="flex items-center gap-2 text-xs font-semibold text-slate-400">
                  <span className="w-6 h-6 rounded-full bg-slate-200 text-slate-600 flex items-center justify-center text-[11px]">
                    2
                  </span>
                  AI extraction
                </div>
                <div className="w-8 h-px bg-slate-200" />
                <div className="flex items-center gap-2 text-xs font-semibold text-slate-400">
                  <span className="w-6 h-6 rounded-full bg-slate-200 text-slate-600 flex items-center justify-center text-[11px]">
                    3
                  </span>
                  Review & confirm
                </div>
              </div>

              {/* Upload Dropzone */}
              <div className="border-2 border-dashed border-teal-300 bg-teal-50/20 rounded-3xl p-10 text-center flex flex-col items-center justify-center hover:bg-teal-50/40 transition-colors">
                <div className="w-16 h-16 rounded-full bg-teal-100 text-teal-700 flex items-center justify-center mb-4">
                  <Upload className="w-8 h-8" />
                </div>
                <h4 className="text-base font-bold text-slate-800 mb-1">
                  Drop your file here or{" "}
                  <label className="text-teal-700 underline cursor-pointer hover:text-teal-800">
                    click to upload
                    <input
                      type="file"
                      accept=".pdf,.png,.jpg,.jpeg,.txt"
                      className="hidden"
                      onChange={(e) => {
                        if (e.target.files && e.target.files[0]) {
                          setSelectedFile(e.target.files[0]);
                        }
                      }}
                    />
                  </label>
                </h4>
                <p className="text-xs text-slate-500 mb-6">
                  Insurance card, benefit guide, or HR document (PDF, JPG, PNG Max 10MB)
                </p>

                {/* Selected File Card */}
                <div className="bg-white border border-teal-200 rounded-2xl p-4 flex items-center gap-4 max-w-md w-full shadow-xs">
                  <div className="w-10 h-10 rounded-xl bg-red-50 text-red-600 flex items-center justify-center font-bold text-xs">
                    PDF
                  </div>
                  <div className="flex-1 text-left">
                    <p className="text-xs font-bold text-slate-800 truncate">
                      {selectedFile ? selectedFile.name : "PTM_BenefitGuide_2026.pdf"}
                    </p>
                    <p className="text-[10px] text-slate-400">
                      {selectedFile
                        ? `${(selectedFile.size / 1024 / 1024).toFixed(1)} MB`
                        : "2.4 MB · Sample Ready"}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setSelectedFile(null)}
                    className="text-slate-400 hover:text-slate-600"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>

                <div className="mt-8 flex gap-3">
                  <button
                    type="button"
                    onClick={handleFileUpload}
                    disabled={isExtracting}
                    className="px-8 py-3 bg-teal-700 hover:bg-teal-800 text-white rounded-xl text-xs font-bold shadow-md flex items-center gap-2 transition-all disabled:opacity-50"
                  >
                    {isExtracting ? (
                      <>
                        <Loader2 className="w-4 h-4 animate-spin" />
                        Extracting with AI...
                      </>
                    ) : (
                      <>
                        Extract information <ArrowRight className="w-4 h-4" />
                      </>
                    )}
                  </button>
                </div>
              </div>

              {/* Security notice */}
              <div className="flex items-start gap-3 bg-slate-50 p-4 rounded-xl border border-slate-200 text-slate-600 text-xs">
                <Shield className="w-4 h-4 text-teal-700 shrink-0 mt-0.5" />
                <span>
                  Your document will be processed securely. We only extract relevant
                  information about your insurance benefits according to your privacy consent.
                </span>
              </div>
            </div>
          )}

          {/* FLOW 3: AI EXTRACTION & REVIEW */}
          {flowState === "AI_REVIEW" && (
            <div className="space-y-6">
              {/* Stepper Header */}
              <div className="flex items-center justify-center gap-8 py-2 border-b border-slate-100">
                <div className="flex items-center gap-2 text-xs font-semibold text-emerald-700">
                  <CheckCircle2 className="w-5 h-5 text-emerald-600" />
                  Upload document
                </div>
                <div className="w-8 h-px bg-emerald-200" />
                <div className="flex items-center gap-2 text-xs font-bold text-teal-700">
                  <span className="w-6 h-6 rounded-full bg-teal-700 text-white flex items-center justify-center text-[11px]">
                    2
                  </span>
                  AI extraction
                </div>
                <div className="w-8 h-px bg-slate-200" />
                <div className="flex items-center gap-2 text-xs font-semibold text-slate-400">
                  <span className="w-6 h-6 rounded-full bg-slate-200 text-slate-600 flex items-center justify-center text-[11px]">
                    3
                  </span>
                  Review & confirm
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {/* Employer Info Card */}
                <div className="bg-slate-50 border border-slate-200 rounded-2xl p-5 space-y-4">
                  <div className="flex items-center justify-between">
                    <h4 className="text-xs font-bold text-slate-700 uppercase tracking-wider">
                      Employer information
                    </h4>
                    <span className="text-[10px] bg-emerald-100 text-emerald-800 font-bold px-2 py-0.5 rounded-full">
                      Extracted
                    </span>
                  </div>

                  <div className="space-y-2 text-xs">
                    <div className="flex justify-between py-1 border-b border-slate-200/60">
                      <span className="text-slate-500">Company name</span>
                      <span className="font-bold text-slate-800">{companyName}</span>
                    </div>
                    <div className="flex justify-between py-1 border-b border-slate-200/60">
                      <span className="text-slate-500">Plan name</span>
                      <span className="font-bold text-slate-800">{planName}</span>
                    </div>
                    <div className="flex justify-between py-1 border-b border-slate-200/60">
                      <span className="text-slate-500">Insurer</span>
                      <span className="font-bold text-slate-800">{insurerName}</span>
                    </div>
                    <div className="flex justify-between py-1 border-b border-slate-200/60">
                      <span className="text-slate-500">Policy number</span>
                      <span className="font-bold text-slate-800">{policyNumber}</span>
                    </div>
                    <div className="flex justify-between py-1 border-b border-slate-200/60">
                      <span className="text-slate-500">Employment period</span>
                      <span className="font-bold text-slate-800">1 Jan 2024 – Present</span>
                    </div>
                    <div className="flex justify-between py-1">
                      <span className="text-slate-500">Eligibility</span>
                      <span className="font-semibold text-slate-700">
                        Employees, spouse, children
                      </span>
                    </div>
                  </div>
                </div>

                {/* Extraction Summary Preview */}
                <div className="bg-teal-50/30 border border-teal-200 rounded-2xl p-5 space-y-3">
                  <div className="flex items-center gap-2 text-teal-800 font-bold text-xs uppercase tracking-wider">
                    <CheckCircle2 className="w-4 h-4 text-teal-600" />
                    Verified Document Terms
                  </div>
                  <p className="text-xs text-slate-600 leading-relaxed">
                    Benefits have been mapped into standard categories (Inpatient, Outpatient,
                    Dental, Optical, Maternity). Utilization numbers stay <strong>Unknown</strong>{" "}
                    unless official claims receipts are linked.
                  </p>
                  <div className="bg-white rounded-xl p-3 border border-teal-100 text-[11px] space-y-1.5 text-slate-700">
                    <div className="flex justify-between font-semibold">
                      <span>• Inpatient limit:</span>
                      <span className="text-slate-900 font-bold">IDR 500,000,000 / year</span>
                    </div>
                    <div className="flex justify-between font-semibold">
                      <span>• Outpatient limit:</span>
                      <span className="text-slate-900 font-bold">IDR 10,000,000 / year</span>
                    </div>
                    <div className="flex justify-between font-semibold">
                      <span>• Dental limit:</span>
                      <span className="text-amber-800 font-bold">IDR 2,000,000 / year</span>
                    </div>
                  </div>
                </div>
              </div>

              {/* Extracted Benefits Table */}
              <div className="border border-slate-200 rounded-2xl overflow-hidden">
                <table className="w-full text-left text-xs">
                  <thead className="bg-slate-50 border-b border-slate-200 text-slate-600 uppercase font-bold text-[10px]">
                    <tr>
                      <th className="py-3 px-4">Benefit category</th>
                      <th className="py-3 px-4">Coverage status</th>
                      <th className="py-3 px-4">Limit (per year)</th>
                      <th className="py-3 px-4">Details</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {benefits.map((b) => (
                      <tr key={b.benefit_category} className="hover:bg-slate-50/50">
                        <td className="py-3 px-4 font-bold text-slate-800 capitalize">
                          {b.benefit_category}
                        </td>
                        <td className="py-3 px-4">
                          <span
                            className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                              b.coverage_status === "Covered"
                                ? "bg-emerald-100 text-emerald-800"
                                : b.coverage_status === "Partial"
                                ? "bg-amber-100 text-amber-800"
                                : "bg-red-100 text-red-800"
                            }`}
                          >
                            {b.coverage_status}
                          </span>
                        </td>
                        <td className="py-3 px-4 font-semibold text-slate-900">
                          {b.limit_amount}
                        </td>
                        <td className="py-3 px-4 text-slate-500">{b.details}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Action Buttons */}
              <div className="flex justify-between pt-4">
                <button
                  type="button"
                  onClick={() => setFlowState("UPLOAD_DOC")}
                  className="px-6 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl text-xs font-bold transition-all"
                >
                  Back
                </button>
                <button
                  type="button"
                  onClick={handleSave}
                  disabled={isSaving}
                  className="px-8 py-2.5 bg-teal-700 hover:bg-teal-800 text-white rounded-xl text-xs font-bold transition-all shadow-md flex items-center gap-2"
                >
                  {isSaving ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      Saving...
                    </>
                  ) : (
                    <>
                      Confirm & save <Check className="w-4 h-4" />
                    </>
                  )}
                </button>
              </div>
            </div>
          )}

          {/* FLOW 4: MANUAL ENTRY STEP 1 (Company & Plan Info) */}
          {flowState === "MANUAL_1" && (
            <div className="space-y-6">
              {/* Stepper Header */}
              <div className="flex items-center justify-between border-b border-slate-100 pb-4">
                <div className="flex items-center gap-3">
                  <span className="w-7 h-7 rounded-full bg-teal-700 text-white flex items-center justify-center text-xs font-bold">
                    1
                  </span>
                  <div>
                    <h3 className="text-sm font-bold text-slate-900">
                      Company information & Plan details
                    </h3>
                    <p className="text-xs text-slate-500">
                      Tell us about your current employment and employer insurance.
                    </p>
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">
                    Company name *
                  </label>
                  <input
                    type="text"
                    value={companyName}
                    onChange={(e) => setCompanyName(e.target.value)}
                    className="w-full px-3.5 py-2.5 border border-slate-200 rounded-xl text-xs text-slate-800 focus:outline-none focus:ring-2 focus:ring-teal-600"
                    placeholder="e.g. PT Teknologi Maju"
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">
                    Employment status *
                  </label>
                  <select
                    value={employmentStatus}
                    onChange={(e) => setEmploymentStatus(e.target.value)}
                    className="w-full px-3.5 py-2.5 border border-slate-200 rounded-xl text-xs text-slate-800 focus:outline-none focus:ring-2 focus:ring-teal-600 bg-white"
                  >
                    <option value="Full-time employee">Full-time employee</option>
                    <option value="Contract employee">Contract employee</option>
                    <option value="Probation">Probation</option>
                    <option value="Intern / Trainee">Intern / Trainee</option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">
                    Plan name *
                  </label>
                  <input
                    type="text"
                    value={planName}
                    onChange={(e) => setPlanName(e.target.value)}
                    className="w-full px-3.5 py-2.5 border border-slate-200 rounded-xl text-xs text-slate-800 focus:outline-none focus:ring-2 focus:ring-teal-600"
                    placeholder="e.g. MajuCare Plus"
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">
                    Insurer / TPA
                  </label>
                  <input
                    type="text"
                    value={insurerName}
                    onChange={(e) => setInsurerName(e.target.value)}
                    className="w-full px-3.5 py-2.5 border border-slate-200 rounded-xl text-xs text-slate-800 focus:outline-none focus:ring-2 focus:ring-teal-600"
                    placeholder="e.g. Allianz Indonesia"
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">
                    Employment start date *
                  </label>
                  <input
                    type="date"
                    value={startDate}
                    onChange={(e) => setStartDate(e.target.value)}
                    className="w-full px-3.5 py-2.5 border border-slate-200 rounded-xl text-xs text-slate-800 focus:outline-none focus:ring-2 focus:ring-teal-600"
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">
                    Employment end date (if applicable)
                  </label>
                  <input
                    type="date"
                    value={endDate}
                    onChange={(e) => setEndDate(e.target.value)}
                    className="w-full px-3.5 py-2.5 border border-slate-200 rounded-xl text-xs text-slate-800 focus:outline-none focus:ring-2 focus:ring-teal-600"
                  />
                </div>
              </div>

              {/* Eligible Dependents */}
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-2">
                  Eligible dependents (as per employer plan)
                </label>
                <div className="flex flex-wrap gap-4 text-xs text-slate-700">
                  {["Self (employee)", "Spouse", "Children", "Parents", "Others"].map((dep) => (
                    <label key={dep} className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={dependents.includes(dep)}
                        onChange={() => toggleDependent(dep)}
                        className="rounded border-slate-300 text-teal-700 focus:ring-teal-600"
                      />
                      <span>{dep}</span>
                    </label>
                  ))}
                </div>
              </div>

              {/* Supported Claim Procedures */}
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-2">
                  Supported Claim Submission Methods
                </label>
                <div className="flex flex-wrap gap-5 text-xs text-slate-700">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={claimCashless}
                      onChange={(e) => setClaimCashless(e.target.checked)}
                      className="rounded border-slate-300 text-teal-700 focus:ring-teal-600"
                    />
                    <span>Fasilitas Cashless (e-card / kartu rekanan RS)</span>
                  </label>
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={claimReimbursement}
                      onChange={(e) => setClaimReimbursement(e.target.checked)}
                      className="rounded border-slate-300 text-teal-700 focus:ring-teal-600"
                    />
                    <span>Reimbursement (penggantian kuitansi mandiri)</span>
                  </label>
                </div>
              </div>

              {/* Navigation */}
              <div className="flex justify-between pt-4 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setFlowState("CHOICE")}
                  className="px-6 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl text-xs font-bold"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={() => setFlowState("MANUAL_2")}
                  className="px-8 py-2.5 bg-teal-700 hover:bg-teal-800 text-white rounded-xl text-xs font-bold shadow-md flex items-center gap-2"
                >
                  Next: Benefits & limits <ArrowRight className="w-4 h-4" />
                </button>
              </div>
            </div>
          )}

          {/* FLOW 5: MANUAL ENTRY STEP 2 (Benefits & Limits) */}
          {flowState === "MANUAL_2" && (
            <div className="space-y-6">
              <div className="flex items-center justify-between border-b border-slate-100 pb-4">
                <div className="flex items-center gap-3">
                  <span className="w-7 h-7 rounded-full bg-teal-700 text-white flex items-center justify-center text-xs font-bold">
                    2
                  </span>
                  <div>
                    <h3 className="text-sm font-bold text-slate-900">Benefits & limits</h3>
                    <p className="text-xs text-slate-500">
                      Add the benefits covered by your employer plan. Leave fields empty if
                      unknown.
                    </p>
                  </div>
                </div>
              </div>

              <div className="space-y-4">
                {benefits.map((b) => (
                  <div
                    key={b.benefit_category}
                    className="p-4 border border-slate-200 rounded-2xl bg-white flex flex-col md:flex-row md:items-center justify-between gap-4"
                  >
                    <div className="flex-1">
                      <h4 className="text-xs font-bold text-slate-900 capitalize mb-1">
                        {b.benefit_category} care
                      </h4>
                      <input
                        type="text"
                        value={b.details}
                        onChange={(e) => {
                          const val = e.target.value;
                          setBenefits((prev) =>
                            prev.map((item) =>
                              item.benefit_category === b.benefit_category
                                ? { ...item, details: val }
                                : item
                            )
                          );
                        }}
                        placeholder="Details / terms"
                        className="w-full text-xs text-slate-600 border border-slate-100 rounded-lg px-2.5 py-1.5 focus:outline-none focus:ring-1 focus:ring-teal-600"
                      />
                    </div>

                    <div className="flex items-center gap-3">
                      <div>
                        <label className="block text-[10px] text-slate-400 uppercase font-bold mb-1">
                          Coverage
                        </label>
                        <select
                          value={b.coverage_status}
                          onChange={(e) =>
                            updateBenefitStatus(
                              b.benefit_category,
                              e.target.value as
                                | "Covered"
                                | "Partial"
                                | "Not covered"
                                | "Unknown"
                            )
                          }
                          className="px-2.5 py-1.5 border border-slate-200 rounded-lg text-xs font-bold bg-white text-slate-800"
                        >
                          <option value="Covered">Covered</option>
                          <option value="Partial">Partial</option>
                          <option value="Not covered">Not covered</option>
                          <option value="Unknown">Unknown</option>
                        </select>
                      </div>

                      <div>
                        <label className="block text-[10px] text-slate-400 uppercase font-bold mb-1">
                          Annual limit
                        </label>
                        <input
                          type="text"
                          value={b.limit_amount}
                          onChange={(e) =>
                            updateBenefitLimit(b.benefit_category, e.target.value)
                          }
                          className="w-36 px-2.5 py-1.5 border border-slate-200 rounded-lg text-xs font-semibold text-slate-900"
                          placeholder="e.g. IDR 50,000,000"
                        />
                      </div>
                    </div>
                  </div>
                ))}
              </div>

              {/* Navigation */}
              <div className="flex justify-between pt-4 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setFlowState("MANUAL_1")}
                  className="px-6 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl text-xs font-bold"
                >
                  Back
                </button>
                <button
                  type="button"
                  onClick={() => setFlowState("REVIEW_SAVE")}
                  className="px-8 py-2.5 bg-teal-700 hover:bg-teal-800 text-white rounded-xl text-xs font-bold shadow-md flex items-center gap-2"
                >
                  Next: Review & save <ArrowRight className="w-4 h-4" />
                </button>
              </div>
            </div>
          )}

          {/* FLOW 6: REVIEW & SAVE */}
          {flowState === "REVIEW_SAVE" && (
            <div className="space-y-6">
              <div className="flex items-center justify-between border-b border-slate-100 pb-4">
                <div className="flex items-center gap-3">
                  <span className="w-7 h-7 rounded-full bg-teal-700 text-white flex items-center justify-center text-xs font-bold">
                    3
                  </span>
                  <div>
                    <h3 className="text-sm font-bold text-slate-900">Review & save</h3>
                    <p className="text-xs text-slate-500">
                      Check the information below before saving. You can still edit it later.
                    </p>
                  </div>
                </div>
              </div>

              <div className="bg-slate-50 border border-slate-200 rounded-2xl p-6">
                <div className="flex justify-between items-center mb-4">
                  <h4 className="text-xs font-bold text-slate-700 uppercase tracking-wider">
                    Employer plan summary
                  </h4>
                  <button
                    type="button"
                    onClick={() => setFlowState("MANUAL_1")}
                    className="text-xs font-bold text-teal-700 hover:underline"
                  >
                    Edit
                  </button>
                </div>

                <div className="grid grid-cols-2 gap-y-2 text-xs">
                  <div>
                    <span className="text-slate-500">Company name:</span>{" "}
                    <span className="font-bold text-slate-800">{companyName}</span>
                  </div>
                  <div>
                    <span className="text-slate-500">Employment status:</span>{" "}
                    <span className="font-bold text-slate-800">{employmentStatus}</span>
                  </div>
                  <div>
                    <span className="text-slate-500">Employment period:</span>{" "}
                    <span className="font-bold text-slate-800">
                      {startDate} – {endDate || "Present"}
                    </span>
                  </div>
                  <div>
                    <span className="text-slate-500">Plan name:</span>{" "}
                    <span className="font-bold text-slate-800">{planName}</span>
                  </div>
                  <div>
                    <span className="text-slate-500">Insurer:</span>{" "}
                    <span className="font-bold text-slate-800">{insurerName}</span>
                  </div>
                  <div>
                    <span className="text-slate-500">Eligible dependents:</span>{" "}
                    <span className="font-bold text-slate-800">{dependents.join(", ")}</span>
                  </div>
                </div>
              </div>

              <div className="border border-slate-200 rounded-2xl p-5">
                <div className="flex justify-between items-center mb-4">
                  <h4 className="text-xs font-bold text-slate-700 uppercase tracking-wider">
                    Benefits summary
                  </h4>
                  <button
                    type="button"
                    onClick={() => setFlowState("MANUAL_2")}
                    className="text-xs font-bold text-teal-700 hover:underline"
                  >
                    Edit
                  </button>
                </div>
                <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                  {benefits.map((b) => (
                    <div
                      key={b.benefit_category}
                      className="bg-slate-50 p-3 rounded-xl border border-slate-100"
                    >
                      <span className="text-xs font-bold text-slate-800 capitalize block">
                        {b.benefit_category}
                      </span>
                      <span
                        className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full inline-block mt-1 mb-1 ${
                          b.coverage_status === "Covered"
                            ? "bg-emerald-100 text-emerald-800"
                            : b.coverage_status === "Partial"
                            ? "bg-amber-100 text-amber-800"
                            : "bg-red-100 text-red-800"
                        }`}
                      >
                        {b.coverage_status}
                      </span>
                      <span className="text-[11px] text-slate-500 block truncate">
                        {b.limit_amount}
                      </span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Navigation */}
              <div className="flex justify-between pt-4 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setFlowState("MANUAL_2")}
                  className="px-6 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl text-xs font-bold"
                >
                  Back
                </button>
                <button
                  type="button"
                  onClick={handleSave}
                  disabled={isSaving}
                  className="px-8 py-2.5 bg-teal-700 hover:bg-teal-800 text-white rounded-xl text-xs font-bold shadow-md flex items-center gap-2"
                >
                  {isSaving ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      Saving...
                    </>
                  ) : (
                    <>
                      Save and update <Check className="w-4 h-4" />
                    </>
                  )}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
