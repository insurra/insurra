"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  ArrowRight,
  Check,
  CheckCircle2,
  ChevronRight,
  Edit2,
  ExternalLink,
  Eye,
  FileCheck,
  FileSearch,
  FileText,
  Info,
  Lock,
  Plus,
  RefreshCw,
  Search,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  Trash2,
  Upload,
  UploadCloud,
  X,
} from "lucide-react";
import { api } from "@/lib/api/client";
import { getWorkflowHeaders, getWorkflowUrl } from "@/lib/api/workflow-client";
import type { components } from "@/lib/api/types.gen";
import { config } from "@/lib/config";
import { useAuth } from "@/lib/auth";
import { useUserContext } from "@/lib/user-context";

type DocumentSummary = components["schemas"]["AccountDocumentSummary"];
type DocumentDetail = components["schemas"]["AccountDocumentDetail"];
type AccountField = components["schemas"]["AccountField"];

// Human-readable labels for document kinds
const DOCUMENT_KIND_LABELS: Record<string, string> = {
  insurance_certificate: "Insurance Certificate (保险凭证)",
  policy_wording: "Policy Terms & Booklet (保险条款)",
  benefit_schedule: "Schedule of Benefits (保障待遇表)",
  medical_fapiao: "Medical Receipt / Fapiao (医疗收费票据)",
  diagnosis_certificate: "Diagnosis Certificate (诊断证明)",
  cost_breakdown: "Cost Breakdown Sheet (费用清单)",
  admission_notice: "Admission Notice / Student Card (录取通知书)",
  residence_permit: "Residence Permit / Visa (居留许可)",
  social_insurance_voucher: "Social Medical Insurance Voucher (医保凭证)",
  bpjs_card: "Kartu BPJS Kesehatan (JKN-KIS)",
  insurance_card: "Kartu Asuransi Swasta / Cashless Card",
  policy_booklet: "Buku Polis / Ketentuan Polis",
  employer_policy: "Polis Asuransi Kumpulan (Group)",
  receipt: "Kwitansi / Invoice Medis",
  medical_resume: "Resume Medis / Diagnosis Dokter",
  prescription: "Resep Obat / Pharmacy Bill",
  referral: "Surat Rujukan (FKTP / Spesialis)",
  other: "Other Insurance Document",
  auto: "Auto-detect from file",
};

// Human-readable labels for extracted fields
const FIELD_KEY_LABELS: Record<string, string> = {
  provider: "Insurance Provider",
  insurance_provider: "Insurance Provider",
  policy_number: "Policy / Certificate Number",
  nomor_kartu: "Card / Identification Number",
  receipt_number: "Receipt / Fapiao Number",
  insured_name: "Insured Member Name",
  coverage_start_date: "Coverage Start Date",
  coverage_end_date: "Coverage End Date",
  treatment_date: "Treatment / Service Date",
  visa_expiry_date: "Visa / Permit Expiry Date",
  plan_type: "Plan / Scheme Name",
  hospital_name: "Hospital / Healthcare Provider",
  inpatient_limit: "Inpatient Hospital Limit",
  outpatient_limit: "Outpatient Limit",
  total_amount: "Total Medical Amount",
  status_peserta: "Participant Status",
  faskes_tingkat_1: "Primary Care Clinic (FKTP)",
};

export default function AccountDocuments() {
  const { token } = useAuth();
  const userCtx = useUserContext();

  const [activeTab, setActiveTab] = useState<"OVERVIEW" | "UPLOAD" | "RECOMMENDED" | "PROOF">("OVERVIEW");
  const [proofOriginalHash, setProofOriginalHash] = useState<string>("");
  const [proofCandidateText, setProofCandidateText] = useState<string>("");
  const [proofResult, setProofResult] = useState<{
    verified: boolean;
    original_sha256: string;
    computed_sha256: string;
    status: string;
    detail: string;
  } | null>(null);
  const [proofVerifying, setProofVerifying] = useState<boolean>(false);
  const [anchorDocTitle, setAnchorDocTitle] = useState<string>("");
  const [anchorHash, setAnchorHash] = useState<string>("");
  const [anchorResult, setAnchorResult] = useState<{
    network: string;
    transaction_hash: string;
    block_number: number;
    smart_contract_address: string;
    gas_used: number;
  } | null>(null);
  const [anchoring, setAnchoring] = useState<boolean>(false);
  const [documents, setDocuments] = useState<DocumentSummary[]>([]);
  const [selectedDocId, setSelectedDocId] = useState<string | null>(null);
  const [selectedDetail, setSelectedDetail] = useState<DocumentDetail | null>(null);
  const [fileUrl, setFileUrl] = useState<string | null>(null);
  const [previewMode, setPreviewMode] = useState<"ORIGINAL" | "OCR_TEXT">("ORIGINAL");

  const [uploadKind, setUploadKind] = useState<string>("auto");
  const [filterCategory, setFilterCategory] = useState<string>("ALL");
  const [searchQuery, setSearchQuery] = useState<string>("");

  const [editingFieldId, setEditingFieldId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState<string>("");

  const [busy, setBusy] = useState<boolean>(false);
  const [loadingDetail, setLoadingDetail] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [deleteConfirmDocId, setDeleteConfirmDocId] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);

  const countryCode = userCtx.countryCode || "CN";
  const countryName = userCtx.residenceCountry || "China";

  // Available document kinds based on active residence country
  const availableKinds = useMemo(() => {
    if (countryCode === "CN") {
      return [
        { code: "auto", label: "Auto-detect from file" },
        { code: "insurance_certificate", label: "Insurance Certificate (保险凭证)" },
        { code: "policy_wording", label: "Policy Terms & Booklet (保险条款)" },
        { code: "medical_fapiao", label: "Hospital Receipt / Fapiao (医疗收费票据)" },
        { code: "social_insurance_voucher", label: "Social Medical Insurance Voucher (医保凭证)" },
        { code: "residence_permit", label: "Residence Permit / Visa Notice (居留许可)" },
        { code: "other", label: "Other Insurance Document" },
      ];
    }
    if (countryCode === "ID") {
      return [
        { code: "auto", label: "Auto-detect from file" },
        { code: "bpjs_card", label: "Kartu BPJS Kesehatan (JKN-KIS)" },
        { code: "insurance_card", label: "Kartu Asuransi Swasta / Cashless Card" },
        { code: "policy_booklet", label: "Buku Polis / Ketentuan Polis Asuransi" },
        { code: "employer_policy", label: "Polis / Manfaat Asuransi Kantor (Group)" },
        { code: "receipt", label: "Kwitansi / Invoice Pembayaran Medis" },
        { code: "other", label: "Dokumen Asuransi Lainnya" },
      ];
    }
    return [
      { code: "auto", label: "Auto-detect from file" },
      { code: "insurance_certificate", label: "Insurance Policy Certificate" },
      { code: "policy_wording", label: "Policy Terms & Guide" },
      { code: "receipt", label: "Medical Receipt / Claim Invoice" },
      { code: "other", label: "Other Insurance Document" },
    ];
  }, [countryCode]);

  // Contextual recommended documents tailored to SC-02 user context
  const recommendedDocs = useMemo(() => {
    if (countryCode === "CN") {
      if (userCtx.userSegment === "student") {
        return [
          {
            id: "cn_student_cert",
            kind: "insurance_certificate",
            title: "Student Comprehensive Insurance Certificate (保险凭证)",
            provider: "Ping An Annuity / lxbx.net",
            level: "REQUIRED",
            reason: "Mandatory under Chinese Ministry of Education regulations for foreign students. Unlocks comprehensive hospital and outpatient coverage verification.",
            badge: "Mandatory for Enrollment",
          },
          {
            id: "cn_policy_terms",
            kind: "policy_wording",
            title: "Policy Terms & Benefit Schedule (保险条款)",
            provider: "Ping An Annuity Scheme for Foreigners",
            level: "RECOMMENDED",
            reason: "Verifies the RMB 650 outpatient threshold, designated public hospital tiers, and emergency claim exclusion rules.",
            badge: "Outpatient Threshold Check",
          },
          {
            id: "cn_jw202_permit",
            kind: "residence_permit",
            title: "JW202 / JW201 Form or Residence Permit (居留许可)",
            provider: "Entry-Exit Administration / University",
            level: "OPTIONAL",
            reason: "Validates active foreign resident status and university affiliation for institutional plan eligibility.",
            badge: "Residency Validation",
          },
          {
            id: "cn_fapiao",
            kind: "medical_fapiao",
            title: "Designated Public Hospital Fapiao (医疗发票)",
            provider: "Tier-2 or Tier-3 Public Hospital",
            level: "OPTIONAL",
            reason: "Official tax invoice required for reimbursement claims through the foreign student claims portal.",
            badge: "Claim Evidence",
          },
        ];
      }
      return [
        {
          id: "cn_emp_voucher",
          kind: "social_insurance_voucher",
          title: "Social Medical Insurance Voucher (医保凭证)",
          provider: "Municipal Healthcare Security Bureau (医保局)",
          level: "REQUIRED",
          reason: "Confirms enrollment in Chinese Basic Medical Insurance (BMI) for employed residents.",
          badge: "Public Basic Healthcare",
        },
        {
          id: "cn_emp_group",
          kind: "insurance_certificate",
          title: "Corporate Group Health Policy Certificate",
          provider: "Employer Commercial Group Provider",
          level: "RECOMMENDED",
          reason: "Clarifies supplementary outpatient reimbursement and private clinic network access.",
          badge: "Corporate Benefits",
        },
      ];
    }

    if (countryCode === "ID") {
      return [
        {
          id: "id_bpjs_card",
          kind: "bpjs_card",
          title: "Kartu BPJS Kesehatan (JKN-KIS)",
          provider: "BPJS Kesehatan Republik Indonesia",
          level: "REQUIRED",
          reason: "Program jaminan kesehatan nasional wajib untuk seluruh WNI dan WNA yang bekerja di Indonesia. Membuka verifikasi rujukan FKTP.",
          badge: "National Health Mandate",
        },
        {
          id: "id_private_card",
          kind: "insurance_card",
          title: "Kartu Asuransi Rawat Inap Swasta",
          provider: "Prudential, AIA, Sinarmas, Allianz, dsb.",
          level: "RECOMMENDED",
          reason: "Memastikan fasilitas kamar RS (Class 1/VIP) dan klaim cashless saat perawatan di rumah sakit swasta tanpa rujukan berjenjang.",
          badge: "Private Cashless",
        },
        {
          id: "id_employer_policy",
          kind: "employer_policy",
          title: "Buku Polis / Manfaat Asuransi Kumpulan Kantor",
          provider: "Perusahaan Penjamin / Corporate TPA",
          level: "OPTIONAL",
          reason: "Memverifikasi batas tahunan klaim kacamata, rawat jalan, dan koordinasi manfaat (COB) dengan BPJS.",
          badge: "Corporate Benefit",
        },
      ];
    }

    return [
      {
        id: "gen_cert",
        kind: "insurance_certificate",
        title: "Health & Medical Insurance Certificate",
        provider: "Designated Insurer",
        level: "REQUIRED",
        reason: "Primary document verifying active dates, policy number, and insured coverage limits.",
        badge: "Core Verification",
      },
    ];
  }, [countryCode, userCtx.userSegment]);

  // Load document list from backend (or demo state)
  const refreshDocuments = useCallback(async () => {
    if (token) {
      try {
        const list = await api.request("get", "/api/v1/account/documents", {
          headers: { Authorization: `Bearer ${token}` },
        });
        setDocuments(list);
        if (list.length > 0 && !selectedDocId) {
          setSelectedDocId(list[0].id);
        }
      } catch (err: unknown) {
        setError(err instanceof Error ? err.message : "Failed to load document vault.");
      }
    } else {
      // Demo session: read from local demo storage or initialize empty
      try {
        const raw = localStorage.getItem("insurra.demo-documents");
        if (raw) {
          const parsed = JSON.parse(raw) as DocumentSummary[];
          setDocuments(parsed);
          if (parsed.length > 0 && !selectedDocId) {
            setSelectedDocId(parsed[0].id);
          }
        }
      } catch {
        // Ignore
      }
    }
  }, [token, selectedDocId]);

  useEffect(() => {
    void Promise.resolve().then(refreshDocuments);
  }, [refreshDocuments]);

  // Load selected document detail
  const loadDetail = useCallback(
    async (docId: string) => {
      setLoadingDetail(true);
      setError(null);
      if (token) {
        try {
          const detail = await api.request("get", "/api/v1/account/documents/{document_id}", {
            params: { document_id: docId },
            headers: { Authorization: `Bearer ${token}` },
          });
          setSelectedDetail(detail);

          // Fetch original file preview URL
          try {
            const resp = await fetch(
              `${config.apiBaseUrl}/api/v1/account/documents/${encodeURIComponent(docId)}/file`,
              {
                headers: { Authorization: `Bearer ${token}` },
                cache: "no-store",
              }
            );
            if (resp.ok) {
              const blob = await resp.blob();
              if (fileUrl) URL.revokeObjectURL(fileUrl);
              setFileUrl(URL.createObjectURL(blob));
            } else {
              setFileUrl(null);
            }
          } catch {
            setFileUrl(null);
          }
        } catch (err: unknown) {
          setError(err instanceof Error ? err.message : "Could not load document details.");
        } finally {
          setLoadingDetail(false);
        }
      } else {
        // Demo detail fallback
        try {
          const rawDetails = localStorage.getItem(`insurra.demo-doc-detail.${docId}`);
          if (rawDetails) {
            setSelectedDetail(JSON.parse(rawDetails) as DocumentDetail);
          } else {
            setSelectedDetail(null);
          }
        } catch {
          setSelectedDetail(null);
        } finally {
          setLoadingDetail(false);
        }
      }
    },
    [token, fileUrl]
  );

  useEffect(() => {
    if (selectedDocId) {
      void Promise.resolve().then(() => loadDetail(selectedDocId));
    }
  }, [selectedDocId, loadDetail]);

  // Clean up object URL
  useEffect(() => {
    return () => {
      if (fileUrl) URL.revokeObjectURL(fileUrl);
    };
  }, [fileUrl]);

  // Handle real file upload
  async function handleFileUpload(file: File, kind: string) {
    if (!file) return;
    setBusy(true);
    setError(null);
    setNotice(null);

    if (token) {
      try {
        const body = new FormData();
        body.append("file", file);
        if (kind && kind !== "auto") {
          body.append("kind", kind);
        }

        const res = await api.request("post", "/api/v1/account/documents", {
          body,
          headers: { Authorization: `Bearer ${token}` },
        });

        setNotice("Document uploaded and analyzed successfully.");
        await refreshDocuments();
        if (res.document_id) {
          setSelectedDocId(res.document_id);
          setActiveTab("OVERVIEW");
        }
      } catch (err: unknown) {
        setError(
          err instanceof Error
            ? err.message
            : "Upload failed. Please ensure file is a valid PDF, JPG, or PNG under 10MB."
        );
      } finally {
        setBusy(false);
      }
    } else {
      // Demo session upload: process locally and persist
      try {
        const cleanName = file.name.toLowerCase().replace(/[^a-z0-9]/g, "");
        const docId = `demo-${cleanName}-${file.size}`;
        const fn = file.name.toLowerCase();
        const isInjection = fn.includes("injection") || fn.includes("malicious");
        const isFapiao = fn.includes("fapiao") || fn.includes("receipt") || fn.includes("kwitansi");
        const isCard = fn.includes("card") || file.type.startsWith("image/");
        const isShenzhen = fn.includes("shenzhen") || fn.includes("szu");

        const detectedKind = isFapiao
          ? "receipt"
          : isCard
            ? "card"
            : kind === "auto"
              ? "policy"
              : kind;

        const fileIsoDate = new Date(file.lastModified || 1725148800000).toISOString();

        const newSummary: DocumentSummary = {
          id: docId,
          kind: detectedKind,
          country_code: countryCode as DocumentSummary["country_code"],
          original_filename: file.name,
          mime_type: file.type || (isCard ? "image/png" : "application/pdf"),
          size_bytes: file.size,
          status: "COMPLETED",
          language: countryCode === "CN" || isShenzhen ? "zh" : countryCode === "ID" ? "id" : "en",
          injection_flag: isInjection,
          original_file_status: "RETAINED",
          error_code: null,
          created_at: fileIsoDate,
        };

        const providerName = isFapiao
          ? "深圳大学总医院 (医疗机构)"
          : isShenzhen || countryCode === "CN"
            ? "中国平安财产保险股份有限公司"
            : countryCode === "ID"
              ? "BPJS Kesehatan"
              : "Allianz Care";

        const insuredName = "Budi Santoso";

        const policyNumber = isShenzhen
          ? "PA-CN-2024-SZU-882910"
          : `PA-2024-${file.size.toString().padStart(6, "0")}`;

        const candidateFields: AccountField[] = isFapiao
          ? [
              {
                id: `${docId}-rec`,
                document_id: docId,
                field_key: "receipt_number",
                value: "FP-SZ-2024-918230",
                previous_value: null,
                status: "FOUND",
                confidence: 0.98,
                source_page: 1,
                source_type: "DOCUMENT_EXTRACTION",
                confirmed_by_user: false,
                updated_at: fileIsoDate,
              },
              {
                id: `${docId}-tdate`,
                document_id: docId,
                field_key: "treatment_date",
                value: "2024-10-12",
                previous_value: null,
                status: "FOUND",
                confidence: 0.97,
                source_page: 1,
                source_type: "DOCUMENT_EXTRACTION",
                confirmed_by_user: false,
                updated_at: fileIsoDate,
              },
              {
                id: `${docId}-hosp`,
                document_id: docId,
                field_key: "hospital_name",
                value: "深圳大学总医院",
                previous_value: null,
                status: "FOUND",
                confidence: 0.96,
                source_page: 1,
                source_type: "DOCUMENT_EXTRACTION",
                confirmed_by_user: false,
                updated_at: fileIsoDate,
              },
              {
                id: `${docId}-ins`,
                document_id: docId,
                field_key: "insured_name",
                value: insuredName,
                previous_value: null,
                status: "FOUND",
                confidence: 0.95,
                source_page: 1,
                source_type: "DOCUMENT_EXTRACTION",
                confirmed_by_user: false,
                updated_at: fileIsoDate,
              },
            ]
          : [
              {
                id: `${docId}-prov`,
                document_id: docId,
                field_key: "provider",
                value: providerName,
                previous_value: null,
                status: "FOUND",
                confidence: 0.96,
                source_page: 1,
                source_type: "DOCUMENT_EXTRACTION",
                confirmed_by_user: false,
                updated_at: fileIsoDate,
              },
              {
                id: `${docId}-pol`,
                document_id: docId,
                field_key: "policy_number",
                value: policyNumber,
                previous_value: null,
                status: "FOUND",
                confidence: 0.95,
                source_page: 1,
                source_type: "DOCUMENT_EXTRACTION",
                confirmed_by_user: false,
                updated_at: fileIsoDate,
              },
              {
                id: `${docId}-ins`,
                document_id: docId,
                field_key: "insured_name",
                value: insuredName,
                previous_value: null,
                status: "FOUND",
                confidence: 0.94,
                source_page: 1,
                source_type: "DOCUMENT_EXTRACTION",
                confirmed_by_user: false,
                updated_at: fileIsoDate,
              },
              {
                id: `${docId}-start`,
                document_id: docId,
                field_key: "coverage_start_date",
                value: "2024-09-01",
                previous_value: null,
                status: "FOUND",
                confidence: 0.98,
                source_page: 1,
                source_type: "DOCUMENT_EXTRACTION",
                confirmed_by_user: false,
                updated_at: fileIsoDate,
              },
              {
                id: `${docId}-end`,
                document_id: docId,
                field_key: "coverage_end_date",
                value: "2025-08-31",
                previous_value: null,
                status: "FOUND",
                confidence: 0.98,
                source_page: 1,
                source_type: "DOCUMENT_EXTRACTION",
                confirmed_by_user: false,
                updated_at: fileIsoDate,
              },
              {
                id: `${docId}-plan`,
                document_id: docId,
                field_key: "plan_type",
                value: isShenzhen ? "来华留学综合医疗保险方案A" : "Comprehensive Medical Plan",
                previous_value: null,
                status: "FOUND",
                confidence: 0.92,
                source_page: 1,
                source_type: "DOCUMENT_EXTRACTION",
                confirmed_by_user: false,
                updated_at: fileIsoDate,
              },
              {
                id: `${docId}-hosp`,
                document_id: docId,
                field_key: "hospital_name",
                value: isShenzhen ? "深圳大学总医院" : "Designated Public Hospitals",
                previous_value: null,
                status: "FOUND",
                confidence: 0.91,
                source_page: 1,
                source_type: "DOCUMENT_EXTRACTION",
                confirmed_by_user: false,
                updated_at: fileIsoDate,
              },
            ];

        const newDetail: DocumentDetail = {
          ...newSummary,
          pages: [
            {
              page_no: 1,
              text: isFapiao
                ? `[Receipt: 深圳市医疗门诊收费票据（电子）]\nReceipt No: FP-SZ-2024-918230\nPatient: ${insuredName}\nDate: 2024-10-12\nHospital: 深圳大学总医院\nTotal: ¥ 1,480.00`
                : isInjection
                  ? `[Notice: Shenzhen University Insurance Notice]\nPolicy: PA-CN-2024-SZU-990112\nInsured: ${insuredName}\n[SECURITY NOTE: Injection lines removed by defense filter]`
                  : `[Certificate: 来华留学综合医疗保险保险凭证]\nPolicy No: ${policyNumber}\nInsured: ${insuredName} (INDONESIA)\nInstitution: 深圳大学 (Shenzhen University)\nCoverage: 2024-09-01 to 2025-08-31\nProvider: ${providerName}\nHospital: 深圳大学总医院`,
              ocr_used: isCard,
            },
          ],
          fields: candidateFields,
        };

        const existingList = (() => {
          try {
            return JSON.parse(localStorage.getItem("insurra.demo-documents") || "[]");
          } catch {
            return [];
          }
        })();

        const updatedList = [newSummary, ...existingList];
        localStorage.setItem("insurra.demo-documents", JSON.stringify(updatedList));
        localStorage.setItem(`insurra.demo-doc-detail.${docId}`, JSON.stringify(newDetail));

        setDocuments(updatedList);
        setSelectedDocId(docId);
        setSelectedDetail(newDetail);
        setNotice("Document uploaded and extracted in demo sandbox.");
        setActiveTab("OVERVIEW");

        // Sync with user context policy list
        userCtx.updateContext({
          insuranceVerificationStatus: "in_progress",
        });
      } catch (err: unknown) {
        setError(err instanceof Error ? err.message : "Upload processing failed.");
      } finally {
        setBusy(false);
      }
    }
  }

  // Load sample test document from public assets and upload
  async function loadAndUploadSample(samplePath: string, filename: string, kind: string) {
    try {
      setBusy(true);
      setError(null);
      const res = await fetch(samplePath);
      const blob = await res.blob();
      const file = new File([blob], filename, { type: blob.type || "application/pdf" });
      await handleFileUpload(file, kind);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to load sample document.");
      setBusy(false);
    }
  }

  // Handle reviewing/editing an extracted field
  async function handleFieldConfirm(field: AccountField, customValue?: string) {
    const finalValue = customValue !== undefined ? customValue : (typeof field.value === "string" ? field.value : "");
    if (!finalValue.trim()) {
      setError("Field value cannot be empty.");
      return;
    }

    setBusy(true);
    setError(null);
    setNotice(null);

    if (token) {
      try {
        const updated = await api.request("patch", "/api/v1/account/fields/{field_id}", {
          params: { field_id: field.id },
          body: {
            value: finalValue.trim(),
            confirm: true,
          },
          headers: { Authorization: `Bearer ${token}` },
        });

        // Update local state
        if (selectedDetail) {
          const nextFields = selectedDetail.fields.map((f) => (f.id === field.id ? updated : f));
          setSelectedDetail({ ...selectedDetail, fields: nextFields });
        }
        setEditingFieldId(null);
        setNotice(`Confirmed ${FIELD_KEY_LABELS[field.field_key] || field.field_key}.`);

        // Refresh documents and sync userCtx
        await refreshDocuments();
      } catch (err: unknown) {
        setError(err instanceof Error ? err.message : "Failed to confirm field.");
      } finally {
        setBusy(false);
      }
    } else {
      // Demo session field update
      if (selectedDetail) {
        const updatedField: AccountField = {
          ...field,
          value: finalValue.trim(),
          previous_value: field.value,
          status: "FOUND",
          confirmed_by_user: true,
          source_type: field.value !== finalValue.trim() ? "USER_CORRECTED" : "USER_CONFIRMED",
          updated_at: new Date().toISOString(),
        };
        const nextFields = selectedDetail.fields.map((f) => (f.id === field.id ? updatedField : f));
        const nextDetail = { ...selectedDetail, fields: nextFields };
        setSelectedDetail(nextDetail);
        try {
          localStorage.setItem(`insurra.demo-doc-detail.${selectedDetail.id}`, JSON.stringify(nextDetail));
        } catch {
          // Ignore
        }
        setEditingFieldId(null);
        setNotice(`Confirmed ${FIELD_KEY_LABELS[field.field_key] || field.field_key}.`);
      }
      setBusy(false);
    }
  }

  // Handle secure document deletion
  async function handleDeleteDocument(docId: string) {
    setBusy(true);
    setError(null);
    setNotice(null);

    if (token) {
      try {
        await api.request("delete", "/api/v1/account/documents/{document_id}", {
          params: { document_id: docId },
          body: { confirm: "HAPUS" },
          headers: { Authorization: `Bearer ${token}` },
        });
        setNotice("Document securely deleted.");
        setDeleteConfirmDocId(null);
        setSelectedDocId(null);
        setSelectedDetail(null);
        await refreshDocuments();
      } catch (err: unknown) {
        setError(err instanceof Error ? err.message : "Failed to delete document.");
      } finally {
        setBusy(false);
      }
    } else {
      // Demo session deletion
      const filtered = documents.filter((d) => d.id !== docId);
      setDocuments(filtered);
      try {
        localStorage.setItem("insurra.demo-documents", JSON.stringify(filtered));
        localStorage.removeItem(`insurra.demo-doc-detail.${docId}`);
      } catch {
        // Ignore
      }
      setDeleteConfirmDocId(null);
      setSelectedDocId(null);
      setSelectedDetail(null);
      setNotice("Document deleted from demo vault.");
      setBusy(false);
    }
  }

  // Filtered documents
  const filteredDocuments = useMemo(() => {
    return documents.filter((d) => {
      const matchCat = filterCategory === "ALL" || d.kind === filterCategory;
      const matchSearch =
        !searchQuery.trim() ||
        d.original_filename.toLowerCase().includes(searchQuery.toLowerCase()) ||
        (DOCUMENT_KIND_LABELS[d.kind] || d.kind).toLowerCase().includes(searchQuery.toLowerCase());
      return matchCat && matchSearch;
    });
  }, [documents, filterCategory, searchQuery]);

  // Overall workspace statistics
  const stats = useMemo(() => {
    const total = documents.length;
    const completed = documents.filter((d) => d.status === "COMPLETED").length;
    const flagged = documents.filter((d) => d.injection_flag).length;
    const failed = documents.filter((d) => d.status === "FAILED").length;
    return { total, completed, flagged, failed };
  }, [documents]);

  return (
    <div className="figma-page-shell">
      {/* ---------------- Back Navigation ---------------- */}
      <Link href="/protection" className="figma-back-link">
        ← Back to My Protection
      </Link>

      {/* ---------------- Header ---------------- */}
      <header className="figma-page-header">
        <div>
          <h1>Documents &amp; AI Intelligence</h1>
          <p>
            Securely upload your insurance certificates, policies, and medical receipts. INSURRA extracts,
            verifies, and maps policy benefits directly to your protection profile.
          </p>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <button
            type="button"
            className="figma-btn-primary"
            onClick={() => setActiveTab("UPLOAD")}
            style={{ height: 40, padding: "0 16px", fontSize: 13 }}
          >
            <Upload size={14} /> Upload Document
          </button>
        </div>
      </header>

      {/* ---------------- Notice & Error Banners ---------------- */}
      {error && (
        <div className="doc-injection-banner" style={{ background: "#fef2f2", borderColor: "#fecaca", color: "#991b1b" }}>
          <AlertTriangle size={18} />
          <div style={{ flex: 1 }}>
            <strong>Action Error</strong>
            <p style={{ margin: "2px 0 0", fontSize: 12.5 }}>{error}</p>
          </div>
          {(error.includes("Privasi") || error.includes("CONSENT_REQUIRED") || error.includes("persetujuan")) && (
            <Link
              href="/account/privacy"
              className="figma-btn-primary"
              style={{ height: 32, fontSize: 12, padding: "0 14px", textDecoration: "none", whiteSpace: "nowrap" }}
            >
              Aktifkan di Privasi &amp; Data
            </Link>
          )}
          {(error.includes("profil") || error.includes("PROFILE_REQUIRED")) && (
            <Link
              href="/account/onboarding"
              className="figma-btn-primary"
              style={{ height: 32, fontSize: 12, padding: "0 14px", textDecoration: "none", whiteSpace: "nowrap" }}
            >
              Lengkapi Profil
            </Link>
          )}
          <button type="button" onClick={() => setError(null)} style={{ background: "none", border: "none", cursor: "pointer", color: "#991b1b" }}>
            <X size={15} />
          </button>
        </div>
      )}

      {notice && (
        <div className="doc-injection-banner" style={{ background: "#f0fdf4", borderColor: "#bbf7d0", color: "#166534" }}>
          <CheckCircle2 size={18} />
          <div style={{ flex: 1 }}>
            <strong>Success</strong>
            <p style={{ margin: "2px 0 0", fontSize: 12.5 }}>{notice}</p>
          </div>
          <button type="button" onClick={() => setNotice(null)} style={{ background: "none", border: "none", cursor: "pointer", color: "#166534" }}>
            <X size={15} />
          </button>
        </div>
      )}

      {/* ---------------- Metrics Row ---------------- */}
      <div className="doc-metrics-row">
        <div className="doc-metric-card">
          <div className="doc-metric-icon" style={{ background: "#e6f7f3", color: "#0ea58a" }}>
            <FileText size={20} />
          </div>
          <div>
            <div className="doc-metric-val">{stats.total}</div>
            <div className="doc-metric-lbl">Total Documents</div>
          </div>
        </div>

        <div className="doc-metric-card">
          <div className="doc-metric-icon" style={{ background: "#f0fdf4", color: "#16a34a" }}>
            <FileCheck size={20} />
          </div>
          <div>
            <div className="doc-metric-val">{stats.completed}</div>
            <div className="doc-metric-lbl">Extracted &amp; Ready</div>
          </div>
        </div>

        <div className="doc-metric-card">
          <div className="doc-metric-icon" style={{ background: "#eff6ff", color: "#0284c7" }}>
            <Sparkles size={20} />
          </div>
          <div>
            <div className="doc-metric-val">{countryName}</div>
            <div className="doc-metric-lbl">Jurisdiction Context</div>
          </div>
        </div>

        <div className="doc-metric-card">
          <div
            className="doc-metric-icon"
            style={{
              background: stats.flagged > 0 ? "#fef3c7" : "#f1f5f9",
              color: stats.flagged > 0 ? "#d97706" : "#64748b",
            }}
          >
            {stats.flagged > 0 ? <ShieldAlert size={20} /> : <ShieldCheck size={20} />}
          </div>
          <div>
            <div className="doc-metric-val" style={{ color: stats.flagged > 0 ? "#d97706" : "#0f1d38" }}>
              {stats.flagged}
            </div>
            <div className="doc-metric-lbl">Security Protections</div>
          </div>
        </div>
      </div>

      {/* ---------------- Navigation Tabs ---------------- */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 24, borderBottom: "1px solid #e2e8f0", paddingBottom: 12 }}>
        <button
          type="button"
          className={`figma-pill-btn ${activeTab === "OVERVIEW" ? "active" : ""}`}
          onClick={() => setActiveTab("OVERVIEW")}
        >
          <FileSearch size={14} style={{ display: "inline", marginRight: 6 }} /> Document Vault ({documents.length})
        </button>
        <button
          type="button"
          className={`figma-pill-btn ${activeTab === "UPLOAD" ? "active" : ""}`}
          onClick={() => setActiveTab("UPLOAD")}
        >
          <Upload size={14} style={{ display: "inline", marginRight: 6 }} /> Upload &amp; Analyze
        </button>
        <button
          type="button"
          className={`figma-pill-btn ${activeTab === "RECOMMENDED" ? "active" : ""}`}
          onClick={() => setActiveTab("RECOMMENDED")}
        >
          <CheckCircle2 size={14} style={{ display: "inline", marginRight: 6 }} /> Recommended for You ({recommendedDocs.length})
        </button>
        <button
          type="button"
          className={`figma-pill-btn ${activeTab === "PROOF" ? "active" : ""}`}
          onClick={() => setActiveTab("PROOF")}
        >
          <ShieldCheck size={14} style={{ display: "inline", marginRight: 6 }} /> Blockchain Proof &amp; Integrity
        </button>
      </div>

      {/* ======================================================================
          TAB 1: DOCUMENT VAULT & TWO-PANEL REVIEW
          ====================================================================== */}
      {activeTab === "OVERVIEW" && (
        <>
          {documents.length === 0 ? (
            /* Empty State */
            <div
              style={{
                background: "#ffffff",
                border: "1.5px dashed #cbd5e1",
                borderRadius: 20,
                padding: "54px 24px",
                textAlign: "center",
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                gap: 14,
              }}
            >
              <div
                style={{
                  width: 64,
                  height: 64,
                  borderRadius: "50%",
                  background: "#e6f7f3",
                  color: "#0ea58a",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <UploadCloud size={32} />
              </div>
              <h2 style={{ fontSize: 18, fontWeight: 800, color: "#0f1d38", margin: 0 }}>
                No insurance documents uploaded yet
              </h2>
              <p style={{ maxWidth: 480, fontSize: 13.5, color: "#64748b", margin: 0, lineHeight: 1.5 }}>
                Upload your insurance certificate, policy wording, or receipts to automatically extract coverages,
                deductibles, and emergency care network rules.
              </p>
              <div style={{ display: "flex", alignItems: "center", gap: 12, marginTop: 8 }}>
                <button
                  type="button"
                  className="figma-btn-primary"
                  onClick={() => setActiveTab("UPLOAD")}
                  style={{ height: 42, padding: "0 20px" }}
                >
                  <Upload size={15} /> Upload Your First Document
                </button>
                <button
                  type="button"
                  className="figma-btn-outline"
                  onClick={() => setActiveTab("RECOMMENDED")}
                  style={{ height: 42, padding: "0 20px" }}
                >
                  View Recommended Documents
                </button>
              </div>
            </div>
          ) : (
            /* Two-Panel Layout */
            <div className="doc-review-layout">
              {/* Left Column: Uploaded Document Queue & Source Preview */}
              <div>
                {/* Search & Filter Bar */}
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 14 }}>
                  <div style={{ position: "relative", flex: 1 }}>
                    <Search
                      size={14}
                      color="#94a3b8"
                      style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)" }}
                    />
                    <input
                      type="text"
                      placeholder="Search documents by name or type..."
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      style={{
                        width: "100%",
                        height: 38,
                        paddingLeft: 34,
                        paddingRight: 12,
                        borderRadius: 10,
                        border: "1px solid #cbd5e1",
                        fontSize: 13,
                        outline: "none",
                      }}
                    />
                  </div>
                  <button
                    type="button"
                    className="figma-btn-outline"
                    onClick={() => setActiveTab("UPLOAD")}
                    style={{ height: 38, padding: "0 14px", fontSize: 12.5 }}
                  >
                    <Plus size={14} /> Add
                  </button>
                </div>

                {/* Category Filter Pills */}
                <div style={{ display: "flex", gap: 6, overflowX: "auto", marginBottom: 14, paddingBottom: 2 }}>
                  {[
                    { id: "ALL", label: "All Documents" },
                    { id: "policy", label: "Policy" },
                    { id: "claim_form", label: "Claims" },
                    { id: "receipt", label: "Receipts" },
                    { id: "card", label: "Cards" },
                  ].map((cat) => (
                    <button
                      key={cat.id}
                      type="button"
                      onClick={() => setFilterCategory(cat.id)}
                      className={`figma-pill-btn ${filterCategory === cat.id ? "active" : ""}`}
                      style={{ fontSize: 11.5, padding: "4px 10px", whiteSpace: "nowrap" }}
                    >
                      {cat.label}
                    </button>
                  ))}
                </div>

                {/* Document List */}
                <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 20 }}>
                  {filteredDocuments.map((doc) => {
                    const isSelected = doc.id === selectedDocId;
                    return (
                      <div
                        key={doc.id}
                        className="figma-doc-queue-item"
                        style={{
                          borderColor: isSelected ? "#0ea58a" : "#e2e8f0",
                          background: isSelected ? "#f9fefd" : "#ffffff",
                          boxShadow: isSelected ? "0 2px 8px rgba(14, 165, 138, 0.12)" : "none",
                        }}
                        onClick={() => setSelectedDocId(doc.id)}
                        role="button"
                        tabIndex={0}
                      >
                        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                          <div
                            style={{
                              width: 38,
                              height: 44,
                              background: isSelected ? "#e6f7f3" : "#f1f5f9",
                              color: isSelected ? "#0ea58a" : "#64748b",
                              borderRadius: 8,
                              display: "flex",
                              alignItems: "center",
                              justifyContent: "center",
                              flexShrink: 0,
                            }}
                          >
                            <FileText size={20} />
                          </div>
                          <div>
                            <strong style={{ display: "block", fontSize: 13.5, color: "#0f1d38" }}>
                              {doc.original_filename}
                            </strong>
                            <span style={{ fontSize: 11.5, color: "#64748b" }}>
                              {DOCUMENT_KIND_LABELS[doc.kind] || doc.kind} · {(doc.size_bytes / 1024).toFixed(0)} KB
                            </span>
                          </div>
                        </div>

                        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                          {doc.injection_flag && (
                            <span
                              className="figma-hub-card-pill neutral"
                              style={{ background: "#fef3c7", color: "#b45309", fontSize: 10.5 }}
                              title="Prompt injection neutralized"
                            >
                              <ShieldAlert size={12} /> Protected
                            </span>
                          )}

                          {doc.status === "COMPLETED" && (
                            <span className="figma-hub-card-pill success" style={{ fontSize: 11 }}>
                              <CheckCircle2 size={12} /> Ready
                            </span>
                          )}

                          {doc.status === "FAILED" && (
                            <span
                              className="figma-hub-card-pill neutral"
                              style={{ background: "#fee2e2", color: "#dc2626", fontSize: 11 }}
                            >
                              Failed
                            </span>
                          )}

                          <ChevronRight size={16} color={isSelected ? "#0ea58a" : "#94a3b8"} />
                        </div>
                      </div>
                    );
                  })}
                </div>

                {/* Source File Preview Card */}
                {selectedDetail && (
                  <div className="doc-source-pane">
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                        <button
                          type="button"
                          className={`figma-pill-btn ${previewMode === "ORIGINAL" ? "active" : ""}`}
                          onClick={() => setPreviewMode("ORIGINAL")}
                          style={{ fontSize: 11.5, padding: "4px 10px" }}
                        >
                          <Eye size={12} /> Source Preview
                        </button>
                        <button
                          type="button"
                          className={`figma-pill-btn ${previewMode === "OCR_TEXT" ? "active" : ""}`}
                          onClick={() => setPreviewMode("OCR_TEXT")}
                          style={{ fontSize: 11.5, padding: "4px 10px" }}
                        >
                          <FileText size={12} /> Extracted Text ({selectedDetail.pages.length} Pages)
                        </button>
                      </div>

                      {fileUrl && (
                        <a
                          href={fileUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="figma-btn-outline"
                          style={{ padding: "4px 8px", fontSize: 11.5, height: 28 }}
                        >
                          <ExternalLink size={12} /> Open File
                        </a>
                      )}
                    </div>

                    <div className="doc-source-frame-wrap">
                      {previewMode === "ORIGINAL" ? (
                        fileUrl ? (
                          selectedDetail.mime_type.includes("pdf") ? (
                            <iframe src={fileUrl} title="Document Preview" className="doc-source-frame" />
                          ) : (
                            <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", padding: 10 }}>
                              {/* eslint-disable-next-line @next/next/no-img-element */}
                              <img src={fileUrl} alt="Document" style={{ maxWidth: "100%", maxHeight: "100%", objectFit: "contain" }} />
                            </div>
                          )
                        ) : (
                          <div style={{ textAlign: "center", padding: 20 }}>
                            <FileText size={32} color="#94a3b8" />
                            <p style={{ margin: "8px 0 0", fontSize: 13, color: "#64748b" }}>
                              Original file content preview is available when retention consent is active.
                            </p>
                          </div>
                        )
                      ) : (
                        <div className="doc-ocr-text-scroll">
                          {selectedDetail.pages.map((p, idx) => (
                            <div key={idx} style={{ marginBottom: 16 }}>
                              <div style={{ color: "#38bdf8", fontWeight: 700, marginBottom: 4, display: "flex", alignItems: "center", gap: 6 }}>
                                <span>[Page {String(p.page_no)}]</span>
                                {Boolean(p.ocr_used) && (
                                  <span style={{ fontSize: 10, background: "rgba(56, 189, 248, 0.2)", padding: "1px 6px", borderRadius: 4 }}>
                                    OCR Fallback
                                  </span>
                                )}
                              </div>
                              <p style={{ margin: 0 }}>{typeof p.text === "string" ? p.text : ""}</p>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>

              {/* Right Column: AI Extraction Review Panel */}
              <div className="figma-policy-detail">
                {selectedDetail ? (
                  <>
                    {/* Prompt Injection Alert Banner (US-03-04) */}
                    {selectedDetail.injection_flag && (
                      <div className="doc-injection-banner">
                        <ShieldAlert size={20} style={{ flexShrink: 0, marginTop: 2 }} />
                        <div>
                          <strong>Prompt Injection Protected</strong>
                          <p style={{ margin: "2px 0 0" }}>
                            Suspicious prompt text in this document was identified and safely isolated. No unauthorized
                            instructions or tool actions were executed.
                          </p>
                        </div>
                      </div>
                    )}

                    {/* Document Header Tile */}
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                        padding: "14px 16px",
                        background: "#f8fafc",
                        borderRadius: 14,
                        marginBottom: 16,
                      }}
                    >
                      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                        <div
                          style={{
                            width: 36,
                            height: 42,
                            background: "#ffffff",
                            border: "1px solid #cbd5e1",
                            borderRadius: 6,
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                          }}
                        >
                          <FileText size={18} color="#0ea58a" />
                        </div>
                        <div>
                          <strong style={{ display: "block", fontSize: 14, color: "#0f1d38" }}>
                            {selectedDetail.original_filename}
                          </strong>
                          <span style={{ fontSize: 12, color: "#64748b" }}>
                            {DOCUMENT_KIND_LABELS[selectedDetail.kind] || selectedDetail.kind} ·{" "}
                            {new Date(selectedDetail.created_at).toLocaleDateString()}
                            {loadingDetail && " (updating...)"}
                          </span>
                        </div>
                      </div>

                      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <button
                          type="button"
                          className="figma-btn-outline"
                          onClick={() => setDeleteConfirmDocId(selectedDetail.id)}
                          style={{
                            height: 32,
                            padding: "0 10px",
                            fontSize: 12,
                            color: "#dc2626",
                            borderColor: "#fca5a5",
                          }}
                          title="Delete Document"
                        >
                          <Trash2 size={13} /> Delete
                        </button>
                      </div>
                    </div>

                    {/* AI Extraction Banner */}
                    <div className="figma-alert-banner" style={{ marginBottom: 18 }}>
                      <div
                        style={{
                          width: 28,
                          height: 28,
                          borderRadius: "50%",
                          background: "#0ea58a",
                          color: "#ffffff",
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          flexShrink: 0,
                        }}
                      >
                        <Sparkles size={16} />
                      </div>
                      <div>
                        <strong style={{ display: "block", fontSize: 13.5, color: "#065f46" }}>
                          AI Extraction Summary ({selectedDetail.fields.length} Fields Found)
                        </strong>
                        <span style={{ fontSize: 12, color: "#047857" }}>
                          Extracted from source evidence. Review each field below and confirm or edit as needed. User
                          confirmation records provenance and syncs to your Policy Wallet.
                        </span>
                      </div>
                    </div>

                    {/* Extracted Fields List */}
                    <div style={{ marginBottom: 20 }}>
                      <h3 style={{ fontSize: 15, fontWeight: 800, color: "#0f1d38", marginBottom: 12 }}>
                        Extracted Policy Information
                      </h3>

                      {selectedDetail.fields.length === 0 ? (
                        <div
                          style={{
                            padding: 24,
                            background: "#f8fafc",
                            borderRadius: 12,
                            textAlign: "center",
                            color: "#64748b",
                            fontSize: 13,
                          }}
                        >
                          <Info size={20} style={{ margin: "0 auto 8px", color: "#94a3b8" }} />
                          No structured fields could be automatically extracted from this file. You can manually enter policy
                          details or upload a clearer policy certificate.
                        </div>
                      ) : (
                        selectedDetail.fields.map((field) => {
                          const isEditing = editingFieldId === field.id;
                          const fieldLabel = FIELD_KEY_LABELS[field.field_key] || field.field_key;
                          const strValue = typeof field.value === "string" ? field.value : JSON.stringify(field.value);

                          return (
                            <div key={field.id} className="doc-field-row-item">
                              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                                <label style={{ fontSize: 12, fontWeight: 700, color: "#475569" }}>
                                  {fieldLabel}
                                </label>
                                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                                  {field.source_page && (
                                    <span
                                      className="figma-tag"
                                      style={{ fontSize: 10.5, background: "#e0f2fe", color: "#0369a1" }}
                                    >
                                      Page {field.source_page}
                                    </span>
                                  )}
                                  <span
                                    className="figma-tag"
                                    style={{
                                      fontSize: 10.5,
                                      background: field.confirmed_by_user ? "#dcfce7" : "#f1f5f9",
                                      color: field.confirmed_by_user ? "#15803d" : "#64748b",
                                    }}
                                  >
                                    {field.confirmed_by_user ? "Confirmed by You" : "Self-Reported"}
                                  </span>
                                </div>
                              </div>

                              {isEditing ? (
                                <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 4 }}>
                                  <input
                                    type="text"
                                    className="figma-extract-input"
                                    style={{ height: 36 }}
                                    value={editValue}
                                    onChange={(e) => setEditValue(e.target.value)}
                                    autoFocus
                                  />
                                  <button
                                    type="button"
                                    className="figma-btn-primary"
                                    onClick={() => handleFieldConfirm(field, editValue)}
                                    style={{ height: 36, padding: "0 12px", fontSize: 12 }}
                                    disabled={busy}
                                  >
                                    <Check size={13} /> Save
                                  </button>
                                  <button
                                    type="button"
                                    className="figma-btn-outline"
                                    onClick={() => setEditingFieldId(null)}
                                    style={{ height: 36, padding: "0 10px", fontSize: 12 }}
                                  >
                                    Cancel
                                  </button>
                                </div>
                              ) : (
                                <div
                                  style={{
                                    display: "flex",
                                    alignItems: "center",
                                    justifyContent: "space-between",
                                    gap: 12,
                                  }}
                                >
                                  <span style={{ fontSize: 14, fontWeight: 600, color: "#0f1d38" }}>
                                    {strValue || <span style={{ color: "#94a3b8" }}>Not detected</span>}
                                  </span>
                                  <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                                    <button
                                      type="button"
                                      onClick={() => {
                                        setEditingFieldId(field.id);
                                        setEditValue(strValue);
                                      }}
                                      className="figma-btn-outline"
                                      style={{ height: 28, padding: "0 8px", fontSize: 11.5 }}
                                    >
                                      <Edit2 size={11} /> Edit
                                    </button>
                                    {!field.confirmed_by_user && (
                                      <button
                                        type="button"
                                        onClick={() => handleFieldConfirm(field)}
                                        className="figma-btn-primary"
                                        style={{ height: 28, padding: "0 10px", fontSize: 11.5 }}
                                        disabled={busy}
                                      >
                                        <Check size={11} /> Confirm
                                      </button>
                                    )}
                                  </div>
                                </div>
                              )}
                            </div>
                          );
                        })
                      )}
                    </div>

                    {/* Bottom Navigation Actions */}
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                        paddingTop: 16,
                        borderTop: "1px solid #e2e8f0",
                      }}
                    >
                      <Link href="/policies" className="figma-btn-outline" style={{ height: 40, fontSize: 12.5 }}>
                        View in Policy Wallet
                      </Link>
                      <Link
                        href="/completeness"
                        className="figma-btn-primary"
                        style={{ height: 40, fontSize: 12.5 }}
                      >
                        Check Completeness <ArrowRight size={14} />
                      </Link>
                    </div>
                  </>
                ) : (
                  <div style={{ textAlign: "center", padding: "60px 20px", color: "#64748b" }}>
                    <FileSearch size={36} color="#94a3b8" style={{ margin: "0 auto 12px" }} />
                    <h3 style={{ fontSize: 16, color: "#0f1d38", margin: "0 0 6px" }}>Select a Document</h3>
                    <p style={{ fontSize: 13, margin: 0 }}>
                      Choose any document from the list on the left to review its source file, OCR text, and extracted
                      insurance benefits.
                    </p>
                  </div>
                )}
              </div>
            </div>
          )}
        </>
      )}

      {/* ======================================================================
          TAB 2: UPLOAD & INGEST EXPERIENCE
          ====================================================================== */}
      {activeTab === "UPLOAD" && (
        <div style={{ maxWidth: 720, margin: "0 auto" }}>
          <div className="figma-dropzone-box" onClick={() => fileInputRef.current?.click()}>
            <input
              type="file"
              ref={fileInputRef}
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void handleFileUpload(f, uploadKind);
              }}
              style={{ display: "none" }}
              accept=".pdf,.jpg,.jpeg,.png"
            />
            <div className="figma-dropzone-icon">
              {busy ? <RefreshCw size={26} className="spin-slow" /> : <UploadCloud size={26} />}
            </div>
            <strong style={{ fontSize: 16, fontWeight: 800, color: "#0f1d38" }}>
              {busy ? "Analyzing and extracting document..." : "Drag and drop your insurance documents here"}
            </strong>
            <span style={{ fontSize: 13, color: "#64748b" }}>
              {busy ? "Performing OCR, prompt security isolation, and structured extraction" : "or click to browse local files"}
            </span>
            <small style={{ fontSize: 11.5, color: "#94a3b8" }}>
              Supported: PDF, JPG, PNG (maximum 10MB per file)
            </small>

            <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 4 }}>
              <span className="figma-tag" style={{ color: "#dc2626", fontWeight: 750 }}>
                PDF
              </span>
              <span className="figma-tag" style={{ color: "#16a34a", fontWeight: 750 }}>
                JPG
              </span>
              <span className="figma-tag" style={{ color: "#0284c7", fontWeight: 750 }}>
                PNG
              </span>
            </div>
          </div>

          {/* Document Kind Pre-Selection */}
          <div style={{ background: "#ffffff", border: "1px solid #e2e8f0", borderRadius: 16, padding: 20, marginBottom: 20 }}>
            <label style={{ display: "block", fontSize: 13, fontWeight: 700, color: "#0f1d38", marginBottom: 8 }}>
              Document Category ({countryName})
            </label>
            <select
              className="figma-extract-input"
              value={uploadKind}
              onChange={(e) => setUploadKind(e.target.value)}
              style={{ height: 42 }}
            >
              {availableKinds.map((k) => (
                <option key={k.code} value={k.code}>
                  {k.label}
                </option>
              ))}
            </select>
            <p style={{ margin: "8px 0 0", fontSize: 12, color: "#64748b" }}>
              Selecting the appropriate category accelerates field classification and alignment with your country&apos;s
              healthcare regulations.
            </p>
          </div>

          {/* Sample Test Documents for Shenzhen University */}
          <div
            style={{
              background: "#ffffff",
              border: "1px solid #e2e8f0",
              borderRadius: 16,
              padding: 20,
              marginBottom: 20,
            }}
          >
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
              <div>
                <strong style={{ fontSize: 14, color: "#0f1d38", display: "block" }}>
                  Sample Test Documents: Indonesian Student at Shenzhen University
                </strong>
                <span style={{ fontSize: 12, color: "#64748b" }}>
                  Budi Santoso · Shenzhen University (Yuehai Campus, Nanshan) · Ping An Comprehensive Student Insurance
                </span>
              </div>
              <span className="figma-tag" style={{ background: "#fef3c7", color: "#b45309", fontWeight: 700 }}>
                Test Fixtures
              </span>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 12 }}>
              {[
                {
                  title: "Ping An Insurance Certificate",
                  desc: "Policy PA-CN-2024-SZU-882910, Budi Santoso (SZU)",
                  filename: "shenzhen_pingan_insurance_certificate.pdf",
                  path: "/sample-documents/shenzhen_pingan_insurance_certificate.pdf",
                  kind: "policy",
                  badge: "PDF · Policy",
                },
                {
                  title: "SZU General Hospital Fapiao",
                  desc: "Outpatient Receipt FP-SZ-2024-918230, RMB 1,480",
                  filename: "shenzhen_hospital_medical_fapiao.pdf",
                  path: "/sample-documents/shenzhen_hospital_medical_fapiao.pdf",
                  kind: "receipt",
                  badge: "PDF · Receipt",
                },
                {
                  title: "Physical Student Insurance Card",
                  desc: "Member ID 2024190823, Ping An & SZU",
                  filename: "shenzhen_pingan_student_card.png",
                  path: "/sample-documents/shenzhen_pingan_student_card.png",
                  kind: "card",
                  badge: "PNG · Card",
                },
                {
                  title: "Prompt Injection Security Test",
                  desc: "US-03-04: Embedded prompt override defense test",
                  filename: "test_prompt_injection_detection.pdf",
                  path: "/sample-documents/test_prompt_injection_detection.pdf",
                  kind: "policy",
                  badge: "PDF · Security Test",
                },
              ].map((s) => (
                <div
                  key={s.filename}
                  style={{
                    border: "1px solid #e2e8f0",
                    borderRadius: 12,
                    padding: "12px 14px",
                    background: "#f8fafc",
                    display: "flex",
                    flexDirection: "column",
                    justifyContent: "space-between",
                    gap: 10,
                  }}
                >
                  <div>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
                      <strong style={{ fontSize: 13, color: "#0f1d38" }}>{s.title}</strong>
                      <span className="figma-tag" style={{ fontSize: 10 }}>{s.badge}</span>
                    </div>
                    <p style={{ margin: 0, fontSize: 11.5, color: "#64748b", lineHeight: 1.4 }}>{s.desc}</p>
                  </div>
                  <div style={{ display: "flex", gap: 8, marginTop: 4 }}>
                    <button
                      type="button"
                      className="figma-btn-primary"
                      disabled={busy}
                      onClick={() => void loadAndUploadSample(s.path, s.filename, s.kind)}
                      style={{ flex: 1, height: 32, fontSize: 11.5, padding: "0 10px" }}
                    >
                      Try This File
                    </button>
                    <a
                      href={s.path}
                      download={s.filename}
                      className="figma-btn-outline"
                      style={{ height: 32, fontSize: 11.5, padding: "0 10px", display: "inline-flex", alignItems: "center" }}
                    >
                      Download
                    </a>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Security & Private Storage Commitment */}
          <div
            style={{
              background: "#f0faf8",
              border: "1px solid #cceee7",
              borderRadius: 14,
              padding: "16px 20px",
              display: "flex",
              alignItems: "flex-start",
              gap: 14,
            }}
          >
            <Lock size={20} color="#0ea58a" style={{ flexShrink: 0, marginTop: 2 }} />
            <div>
              <strong style={{ fontSize: 13.5, color: "#0f3630", display: "block" }}>
                Private Storage &amp; Prompt Security Guarantee
              </strong>
              <p style={{ fontSize: 12.5, color: "#144a42", margin: "4px 0 0", lineHeight: 1.5 }}>
                Documents are stored in private user-scoped storage with SHA-256 verification. Content is treated as
                untrusted data with prompt injection isolation. Original files can be deleted anytime.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* ======================================================================
          TAB 3: CONTEXT-AWARE RECOMMENDED DOCUMENTS
          ====================================================================== */}
      {activeTab === "RECOMMENDED" && (
        <div>
          <div style={{ marginBottom: 18 }}>
            <h2 style={{ fontSize: 16, fontWeight: 800, color: "#0f1d38", margin: "0 0 4px" }}>
              Tailored Document Checklist for {countryName}
            </h2>
            <p style={{ fontSize: 13, color: "#64748b", margin: 0 }}>
              Based on your declared location ({countryName}) and background (
              {userCtx.userSegmentLabel || "General Protection"}), these documents provide the highest coverage certainty.
            </p>
          </div>

          <div className="doc-recommended-grid">
            {recommendedDocs.map((doc) => (
              <div key={doc.id} className="doc-rec-card">
                <div>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
                    <span
                      className="figma-tag"
                      style={{
                        fontWeight: 750,
                        background: doc.level === "REQUIRED" ? "#fef2f2" : doc.level === "RECOMMENDED" ? "#eff6ff" : "#f1f5f9",
                        color: doc.level === "REQUIRED" ? "#dc2626" : doc.level === "RECOMMENDED" ? "#0284c7" : "#64748b",
                      }}
                    >
                      {doc.level}
                    </span>
                    <span style={{ fontSize: 11.5, color: "#94a3b8" }}>{doc.badge}</span>
                  </div>

                  <strong style={{ fontSize: 14.5, color: "#0f1d38", display: "block", marginBottom: 4 }}>
                    {doc.title}
                  </strong>
                  <span style={{ fontSize: 12, color: "#0ea58a", fontWeight: 600, display: "block", marginBottom: 10 }}>
                    Source: {doc.provider}
                  </span>

                  <p style={{ fontSize: 12.5, color: "#475569", margin: 0, lineHeight: 1.5 }}>
                    {doc.reason}
                  </p>
                </div>

                <button
                  type="button"
                  className="figma-btn-primary"
                  onClick={() => {
                    setUploadKind(doc.kind);
                    setActiveTab("UPLOAD");
                  }}
                  style={{ width: "100%", height: 38, fontSize: 12.5, justifyContent: "center" }}
                >
                  <Upload size={13} /> Upload this Document
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ======================================================================
          TAB 4: BLOCKCHAIN PROOF & INTEGRITY ANCHORING (SC-19)
          ====================================================================== */}
      {activeTab === "PROOF" && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(420px, 1fr))", gap: 24, marginTop: 12 }}>
          {/* Card 1: Cryptographic Integrity Verification */}
          <div style={{ background: "#ffffff", borderRadius: 16, border: "1px solid #e2e8f0", padding: 24, boxShadow: "0 2px 8px rgba(0,0,0,0.04)" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 16 }}>
              <div style={{ width: 36, height: 36, borderRadius: 10, background: "#f0fdfa", color: "#0f766e", display: "grid", placeItems: "center" }}>
                <ShieldCheck size={20} />
              </div>
              <div>
                <h3 style={{ fontSize: 16, fontWeight: 800, margin: 0, color: "#0f172a" }}>Verify Document Integrity</h3>
                <p style={{ fontSize: 12, color: "#64748b", margin: 0 }}>Compare candidate content against a registered SHA-256 digest</p>
              </div>
            </div>

            <div style={{ display: "grid", gap: 14 }}>
              <div>
                <label style={{ display: "block", fontSize: 12, fontWeight: 700, color: "#334155", marginBottom: 6 }}>
                  Original Expected SHA-256 Hash
                </label>
                <input
                  type="text"
                  placeholder="e.g. 4d71bc29f8a3d548325a07c126e7925e01934c568910b8cf891045a190283bca"
                  value={proofOriginalHash}
                  onChange={(e) => setProofOriginalHash(e.target.value)}
                  style={{ width: "100%", padding: "10px 14px", borderRadius: 10, border: "1px solid #cbd5e1", fontSize: 12, fontFamily: "monospace" }}
                />
              </div>

              <div>
                <label style={{ display: "block", fontSize: 12, fontWeight: 700, color: "#334155", marginBottom: 6 }}>
                  Candidate Document Content / Text
                </label>
                <textarea
                  rows={4}
                  placeholder="Paste candidate text or invoice content to verify byte-level integrity..."
                  value={proofCandidateText}
                  onChange={(e) => setProofCandidateText(e.target.value)}
                  style={{ width: "100%", padding: "10px 14px", borderRadius: 10, border: "1px solid #cbd5e1", fontSize: 12, outline: "none" }}
                />
              </div>

              <button
                type="button"
                className="figma-btn-primary"
                disabled={proofVerifying || !proofOriginalHash || !proofCandidateText}
                onClick={async () => {
                  setProofVerifying(true);
                  try {
                    const headers = getWorkflowHeaders(token);
                    headers["Content-Type"] = "application/json";
                    const res = await fetch(getWorkflowUrl("/api/v1/workflow/proof/verify"), {
                      method: "POST",
                      headers,
                      body: JSON.stringify({
                        original_sha256: proofOriginalHash.trim(),
                        candidate_text: proofCandidateText.trim(),
                      }),
                    });
                    const resJson = await res.json();
                    setProofResult(resJson);
                  } catch {
                    alert("Verification request failed");
                  } finally {
                    setProofVerifying(false);
                  }
                }}
                style={{ height: 42, fontSize: 13, fontWeight: 700 }}
              >
                {proofVerifying ? "Computing Cryptographic Digest..." : "Verify Content Integrity"}
              </button>

              {proofResult && (
                <div style={{ marginTop: 10, padding: 16, borderRadius: 12, background: proofResult.verified ? "#ecfdf5" : "#fef2f2", border: `1px solid ${proofResult.verified ? "#a7f3d0" : "#fecaca"}` }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, fontWeight: 800, fontSize: 14, color: proofResult.verified ? "#065f46" : "#991b1b", marginBottom: 6 }}>
                    {proofResult.verified ? <CheckCircle2 size={18} /> : <AlertTriangle size={18} />}
                    {proofResult.status}
                  </div>
                  <p style={{ fontSize: 12, color: proofResult.verified ? "#047857" : "#b91c1c", margin: "0 0 8px", lineHeight: 1.45 }}>
                    {proofResult.detail}
                  </p>
                  <div style={{ fontSize: 11, fontFamily: "monospace", color: "#475569", wordBreak: "break-all" }}>
                    Computed SHA: {proofResult.computed_sha256}
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Card 2: Blockchain Testnet Anchoring */}
          <div style={{ background: "#ffffff", borderRadius: 16, border: "1px solid #e2e8f0", padding: 24, boxShadow: "0 2px 8px rgba(0,0,0,0.04)" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 16 }}>
              <div style={{ width: 36, height: 36, borderRadius: 10, background: "#f0fdf4", color: "#16a34a", display: "grid", placeItems: "center" }}>
                <CheckCircle2 size={20} />
              </div>
              <div>
                <h3 style={{ fontSize: 16, fontWeight: 800, margin: 0, color: "#0f172a" }}>Sepolia Testnet Proof Anchor</h3>
                <p style={{ fontSize: 12, color: "#64748b", margin: 0 }}>Anchor document SHA-256 hash to immutable public ledger</p>
              </div>
            </div>

            <div style={{ display: "grid", gap: 14 }}>
              <div>
                <label style={{ display: "block", fontSize: 12, fontWeight: 700, color: "#334155", marginBottom: 6 }}>
                  Document Title / Description
                </label>
                <input
                  type="text"
                  placeholder="e.g. Official Medical Invoice Oct 2026"
                  value={anchorDocTitle}
                  onChange={(e) => setAnchorDocTitle(e.target.value)}
                  style={{ width: "100%", padding: "10px 14px", borderRadius: 10, border: "1px solid #cbd5e1", fontSize: 13 }}
                />
              </div>

              <div>
                <label style={{ display: "block", fontSize: 12, fontWeight: 700, color: "#334155", marginBottom: 6 }}>
                  Document SHA-256 Digest
                </label>
                <input
                  type="text"
                  placeholder="e.g. 4d71bc29f8a3d548325a07c126e7925e01934c568910b8cf891045a190283bca"
                  value={anchorHash}
                  onChange={(e) => setAnchorHash(e.target.value)}
                  style={{ width: "100%", padding: "10px 14px", borderRadius: 10, border: "1px solid #cbd5e1", fontSize: 12, fontFamily: "monospace" }}
                />
              </div>

              <button
                type="button"
                className="figma-btn-primary"
                disabled={anchoring || !anchorDocTitle || !anchorHash}
                onClick={async () => {
                  setAnchoring(true);
                  try {
                    const headers = getWorkflowHeaders(token);
                    headers["Content-Type"] = "application/json";
                    const res = await fetch(getWorkflowUrl("/api/v1/workflow/proof/anchor"), {
                      method: "POST",
                      headers,
                      body: JSON.stringify({
                        document_title: anchorDocTitle.trim(),
                        document_sha256: anchorHash.trim(),
                        mime_type: "application/pdf",
                      }),
                    });
                    const json = await res.json();
                    setAnchorResult(json);
                  } catch {
                    alert("Anchoring failed");
                  } finally {
                    setAnchoring(false);
                  }
                }}
                style={{ height: 42, fontSize: 13, fontWeight: 700, background: "#0f766e", borderColor: "#0f766e" }}
              >
                {anchoring ? "Broadcasting Digest..." : "Anchor Digest to Testnet"}
              </button>

              {anchorResult && (
                <div style={{ marginTop: 10, padding: 16, borderRadius: 12, background: "#f0fdf4", border: "1px solid #bbf7d0" }}>
                  <div style={{ fontWeight: 800, fontSize: 13, color: "#166534", marginBottom: 8, display: "flex", alignItems: "center", gap: 6 }}>
                    <CheckCircle2 size={16} /> Anchored Successfully to {anchorResult.network}
                  </div>
                  <div style={{ fontSize: 11, color: "#334155", display: "grid", gap: 4 }}>
                    <div><strong>Tx Hash:</strong> <span style={{ fontFamily: "monospace", wordBreak: "break-all" }}>{anchorResult.transaction_hash}</span></div>
                    <div><strong>Block Number:</strong> {anchorResult.block_number}</div>
                    <div><strong>Contract:</strong> <span style={{ fontFamily: "monospace" }}>{anchorResult.smart_contract_address}</span></div>
                    <div><strong>Gas Used:</strong> {anchorResult.gas_used} gwei</div>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ---------------- Delete Confirmation Modal ---------------- */}
      {deleteConfirmDocId && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(15, 29, 56, 0.4)",
            backdropFilter: "blur(4px)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 100,
            padding: 20,
          }}
        >
          <div
            style={{
              background: "#ffffff",
              borderRadius: 20,
              padding: 28,
              maxWidth: 440,
              width: "100%",
              boxShadow: "0 20px 48px rgba(0, 0, 0, 0.2)",
            }}
          >
            <div
              style={{
                width: 48,
                height: 48,
                borderRadius: "50%",
                background: "#fee2e2",
                color: "#dc2626",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                marginBottom: 16,
              }}
            >
              <Trash2 size={24} />
            </div>
            <h3 style={{ fontSize: 17, fontWeight: 800, color: "#0f1d38", margin: "0 0 8px" }}>
              Delete Document Permanently?
            </h3>
            <p style={{ fontSize: 13, color: "#64748b", margin: "0 0 20px", lineHeight: 1.5 }}>
              This action will remove the document file, OCR page records, and associated unverified extraction fields
              from private storage.
            </p>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 10 }}>
              <button
                type="button"
                className="figma-btn-outline"
                onClick={() => setDeleteConfirmDocId(null)}
                disabled={busy}
              >
                Cancel
              </button>
              <button
                type="button"
                className="figma-btn-primary"
                onClick={() => handleDeleteDocument(deleteConfirmDocId)}
                style={{ background: "#dc2626", borderColor: "#dc2626" }}
                disabled={busy}
              >
                {busy ? "Deleting..." : "Confirm Deletion"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
