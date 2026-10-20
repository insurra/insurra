"use client";

import React, { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { api } from "@/lib/api/client";
import { useActor } from "@/lib/actor";
import { useAuth } from "@/lib/auth";
import { config } from "@/lib/config";
import type { components } from "@/lib/api/types.gen";

type AccountDocumentSummary = components["schemas"]["AccountDocumentSummary"];
type AccountDocumentDetail = components["schemas"]["AccountDocumentDetail"];
import {
  DocumentsDashboard,
  DashboardDocumentItem,
} from "@/components/documents/documents-dashboard";
import {
  UploadFlow,
  UploadQueueItem,
} from "@/components/documents/upload-flow";
import {
  DocumentReview,
  ReviewDocData,
  ReviewDocBenefitItem,
} from "@/components/documents/document-review";

// Raka Pratama's 8 sample documents (China International Student)
const RAKA_SAMPLE_DOCUMENTS: DashboardDocumentItem[] = [
  {
    id: "doc-sample-1",
    name: "AIA_Student_Policy.pdf",
    size: "2.3 MB",
    type: "Policy document",
    extractedInfo: "AIA · Student Plan\n1 Sep 2024 – 31 Aug 2025",
    extractedDetail: {
      issuer: "AIA",
      planName: "AIA International Student Insurance Plan",
      policyNumber: "AIA-STU-2024-568923",
      policyholder: "Raka Pratama",
      insuredPerson: "Raka Pratama",
      dob: "15 Mar 2003",
      coverageStart: "1 Sep 2024",
      coverageEnd: "31 Aug 2025",
      planType: "Comprehensive Plan (Standard)",
    },
    status: "Verified",
    uploadedOn: "12 Oct 2026",
  },
  {
    id: "doc-sample-2",
    name: "Insurance_Certificate.jpg",
    size: "950 KB",
    type: "Insurance certificate",
    extractedInfo: "AIA · Coverage Certificate\nValid until 31 Aug 2025",
    extractedDetail: {
      issuer: "AIA",
      planName: "Coverage Certificate",
      policyNumber: "AIA-STU-2024-568923",
      policyholder: "Raka Pratama",
      insuredPerson: "Raka Pratama",
      dob: "15 Mar 2003",
      coverageStart: "1 Sep 2024",
      coverageEnd: "31 Aug 2025",
      planType: "Comprehensive Plan (Standard)",
    },
    status: "Verified",
    uploadedOn: "10 Oct 2026",
  },
  {
    id: "doc-sample-3",
    name: "Benefit_Schedule.pdf",
    size: "1.4 MB",
    type: "Benefit schedule",
    extractedInfo: "List of benefits\nInpatient, outpatient, evacuation",
    extractedDetail: {
      issuer: "AIA",
      planName: "Schedule of Benefits",
      policyNumber: "AIA-STU-2024-568923",
      policyholder: "Raka Pratama",
      insuredPerson: "Raka Pratama",
      planType: "Comprehensive Plan (Standard)",
    },
    status: "Verified",
    uploadedOn: "10 Oct 2026",
  },
  {
    id: "doc-sample-4",
    name: "Visa_Permit.pdf",
    size: "1.1 MB",
    type: "Visa document",
    extractedInfo: "Student Residence Permit\nValid until 31 Jan 2028",
    extractedDetail: {
      issuer: "Entry-Exit Administration",
      planName: "Student Residence Permit",
      policyNumber: "CN-RES-998821",
      policyholder: "Raka Pratama",
      insuredPerson: "Raka Pratama",
      coverageStart: "1 Feb 2024",
      coverageEnd: "31 Jan 2028",
      planType: "Student Residence Permit",
    },
    status: "Verified",
    uploadedOn: "8 Oct 2026",
  },
  {
    id: "doc-sample-5",
    name: "Sales_Offer.pdf",
    size: "1.6 MB",
    type: "Sales offer",
    extractedInfo: "Quotation from AIA\nPlan comparison and pricing",
    extractedDetail: {
      issuer: "AIA",
      planName: "Quotation from AIA",
      planType: "Plan comparison and pricing",
    },
    status: "Needs review",
    uploadedOn: "8 Oct 2026",
  },
  {
    id: "doc-sample-6",
    name: "Hospital_Bill_Sample.pdf",
    size: "780 KB",
    type: "Claim document",
    extractedInfo: "Out of scope for MVP",
    extractedDetail: {
      issuer: "Designated Public Hospital",
      planName: "Out of scope for MVP",
    },
    status: "Unsupported",
    uploadedOn: "5 Oct 2026",
    isUnsupported: true,
  },
  {
    id: "doc-sample-7",
    name: "Passport.pdf",
    size: "620 KB",
    type: "ID document",
    extractedInfo: "Name, passport number, expiry",
    extractedDetail: {
      policyholder: "Raka Pratama",
      passportNumber: "C1234567",
    },
    status: "Verified",
    uploadedOn: "5 Oct 2026",
  },
  {
    id: "doc-sample-8",
    name: "Vaccination_Record.jpg",
    size: "430 KB",
    type: "Medical record",
    extractedInfo: "Vaccination history\nCOVID-19, other vaccines",
    extractedDetail: {
      policyholder: "Raka Pratama",
    },
    status: "Verified",
    uploadedOn: "3 Oct 2026",
  },
];

// Sinta Dewi's 4 sample documents (Indonesia Employee)
const SINTA_SAMPLE_DOCUMENTS: DashboardDocumentItem[] = [
  {
    id: "doc-sinta-1",
    name: "BPJS_Kesehatan_Card.pdf",
    size: "825 KB",
    type: "Insurance certificate",
    extractedInfo: "BPJS Kesehatan · JKN\nKepesertaan Aktif",
    extractedDetail: {
      issuer: "BPJS Kesehatan",
      planName: "BPJS Kesehatan (JKN)",
      policyNumber: "0001234567891",
      policyholder: "Sinta Dewi",
      insuredPerson: "Sinta Dewi",
      dob: "15 Apr 1995",
      coverageStart: "1 Jan 2021",
      coverageEnd: "31 Des 2099",
      planType: "Jaminan Kesehatan Nasional (Kelas 1)",
    },
    status: "Verified",
    uploadedOn: "12 Oct 2026",
  },
  {
    id: "doc-sinta-2",
    name: "Chubb_Corporate_Health_Policy.pdf",
    size: "1.8 MB",
    type: "Policy document",
    extractedInfo: "Chubb Life · Corporate Plan\n1 Jan 2026 – 31 Des 2026",
    extractedDetail: {
      issuer: "Chubb Life Insurance",
      planName: "Corporate Group Health",
      policyNumber: "CHB-CORP-882910",
      policyholder: "PT Digital Inovasi Nusantara",
      insuredPerson: "Sinta Dewi",
      dob: "15 Apr 1995",
      coverageStart: "1 Jan 2026",
      coverageEnd: "31 Des 2026",
      planType: "Executive Medical Plan",
    },
    status: "Verified",
    uploadedOn: "10 Oct 2026",
  },
  {
    id: "doc-sinta-3",
    name: "KTP_Sinta_Dewi.jpg",
    size: "650 KB",
    type: "ID document",
    extractedInfo: "KTP Elektronik Republik Indonesia\nNIK: 3171015504950002",
    extractedDetail: {
      policyholder: "Sinta Dewi",
      insuredPerson: "Sinta Dewi",
      dob: "15 Apr 1995",
    },
    status: "Verified",
    uploadedOn: "8 Oct 2026",
  },
  {
    id: "doc-sinta-4",
    name: "Employee_Medical_Benefit_Guide.pdf",
    size: "1.2 MB",
    type: "Benefit schedule",
    extractedInfo: "Benefit Guide 2026\nPT Digital Inovasi Nusantara",
    extractedDetail: {
      issuer: "PT Digital Inovasi Nusantara",
      planName: "Employee Health Benefit Guide 2026",
    },
    status: "Verified",
    uploadedOn: "5 Oct 2026",
  },
];

function mapSummariesToDashboard(summaries: AccountDocumentSummary[]): DashboardDocumentItem[] {
  return summaries.map((d) => {
    const mb = (d.size_bytes / (1024 * 1024)).toFixed(1);
    const sizeStr = d.size_bytes > 1024 * 1024 ? `${mb} MB` : `${Math.round(d.size_bytes / 1024)} KB`;
    let statusLabel: "Verified" | "Needs review" | "Unsupported" = "Needs review";
    if (d.status === "VERIFIED" || d.status === "COMPLETED") statusLabel = "Verified";
    else if (d.status === "UNSUPPORTED") statusLabel = "Unsupported";

    let typeLabel = d.kind.replace(/_/g, " ").replace(/\b\w/g, (c: string) => c.toUpperCase());
    if (d.kind === "policy_wording" || d.kind === "policy_document") typeLabel = "Policy document";
    if (d.kind === "residence_permit") typeLabel = "Visa document";

    return {
      id: d.id,
      name: d.original_filename,
      size: sizeStr,
      type: typeLabel,
      extractedInfo: d.extracted_preview || "Document information processed",
      status: statusLabel,
      uploadedOn: new Date(d.created_at).toLocaleDateString("en-GB", {
        day: "numeric",
        month: "short",
        year: "numeric",
      }),
    };
  });
}

export default function DocumentsPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen bg-slate-50 flex items-center justify-center text-xs text-slate-500 font-medium">
          Loading documents...
        </div>
      }
    >
      <DocumentsContent />
    </Suspense>
  );
}

function DocumentsContent() {
  const searchParams = useSearchParams();
  const { mode, headers, demo } = useActor();
  const { token } = useAuth();

  const isDemo = mode === "demo";
  const isSinta = Boolean(demo?.profile?.display_name?.toLowerCase().includes("sinta"));
  const isRaka = isDemo && !isSinta;

  const defaultDocuments = useMemo(() => {
    if (isSinta) return SINTA_SAMPLE_DOCUMENTS;
    if (isRaka) return RAKA_SAMPLE_DOCUMENTS;
    return []; // Non-demo user accounts start completely empty!
  }, [isSinta, isRaka]);

  const [view, setView] = useState<"dashboard" | "upload" | "review">(() =>
    searchParams.get("upload") === "true" ? "upload" : "dashboard"
  );
  const [documents, setDocuments] = useState<DashboardDocumentItem[]>(defaultDocuments);
  const [activeReviewDoc, setActiveReviewDoc] = useState<ReviewDocData | null>(null);

  const refreshDocuments = useCallback(async () => {
    const authHeaders = headers || (token ? { Authorization: `Bearer ${token}` } : null);
    if (!authHeaders) return;
    try {
      const res = await api.request("get", "/api/v1/account/documents", {
        headers: authHeaders,
      });
      if (Array.isArray(res)) {
        if (res.length > 0) {
          setDocuments(mapSummariesToDashboard(res as AccountDocumentSummary[]));
        } else if (isDemo) {
          // In demo mode, seed persona documents if empty on server
          try {
            const seeded = await api.request("post", "/api/v1/account/documents/seed", {
              headers: authHeaders,
            });
            if (Array.isArray(seeded) && seeded.length > 0) {
              setDocuments(mapSummariesToDashboard(seeded as AccountDocumentSummary[]));
            } else {
              setDocuments(defaultDocuments);
            }
          } catch {
            setDocuments(defaultDocuments);
          }
        } else {
          // Authenticated real user account: keep empty list!
          setDocuments([]);
        }
      }
    } catch {
      // Fallback to persona default if demo
      if (isDemo) {
        setDocuments(defaultDocuments);
      }
    }
  }, [headers, token, isDemo, defaultDocuments]);

  useEffect(() => {
    void Promise.resolve().then(refreshDocuments);
  }, [refreshDocuments]);

  // Handle uploading real file to backend
  const handleUploadFile = async (file: File) => {
    const authHeaders = headers || (token ? { Authorization: `Bearer ${token}` } : null);
    if (!authHeaders) return;
    const form = new FormData();
    form.append("file", file);
    const res = await fetch(`${config.apiBaseUrl}/api/v1/account/documents`, {
      method: "POST",
      headers: authHeaders,
      body: form,
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.message || "Upload failed");
    }
    const data = await res.json();
    let detail = null;
    try {
      detail = await api.request("get", "/api/v1/account/documents/{document_id}", {
        params: { document_id: data.document_id },
        headers: authHeaders,
      });
    } catch {
      // Detail is optional during queueing
    }
    void refreshDocuments();
    return { ...data, detail };
  };

  // Open review for a specific document with real preview & dynamic extraction
  const handleSelectDocument = async (doc: DashboardDocumentItem) => {
    const authHeaders = headers || (token ? { Authorization: `Bearer ${token}` } : null);
    if (authHeaders) {
      try {
        const detail = await api.request("get", "/api/v1/account/documents/{document_id}", {
          params: { document_id: doc.id },
          headers: authHeaders,
        });

        // Fetch actual document binary stream for in-canvas preview
        let fileUrl: string | null = null;
        try {
          const fileRes = await fetch(`${config.apiBaseUrl}/api/v1/account/documents/${doc.id}/file`, {
            headers: authHeaders,
          });
          if (fileRes.ok) {
            const blob = await fileRes.blob();
            fileUrl = URL.createObjectURL(blob);
          }
        } catch {
          // Falls back to high-fidelity visual simulator
        }

        const findField = (key: string): string => {
          const f = detail.fields?.find((item) => item.field_key === key);
          return typeof f?.value === "string" ? f.value : "";
        };

        const mappedBenefits: ReviewDocBenefitItem[] = (
          detail.benefits as Array<{
            benefit_item?: string;
            name?: string;
            coverage_limit?: string;
            limit?: string;
            deductible?: string;
            source_page?: number;
            page?: number;
          }> | undefined
        )?.map((b, idx) => ({
          id: `b-${idx}`,
          name: b.benefit_item || b.name || "Coverage benefit",
          limit: b.coverage_limit || b.limit || "-",
          deductible: b.deductible || "-",
          page: b.source_page || b.page || 1,
        })) || [];

        setActiveReviewDoc({
          id: detail.id,
          filename: detail.original_filename,
          docType: doc.type,
          fileUrl,
          mimeType: detail.mime_type,
          insurer: findField("provider") || findField("insurance_provider"),
          planName: findField("plan_name"),
          policyNumber: findField("policy_number"),
          policyholder: findField("policyholder_name") || findField("insured_name"),
          insuredPerson: findField("insured_name"),
          dob: findField("birth_date"),
          coverageStart: findField("coverage_start_date"),
          coverageEnd: findField("coverage_end_date"),
          planType: findField("plan_type"),
          status: doc.status,
          benefits: mappedBenefits,
          exclusions: detail.exclusions || [],
          waitingPeriods: detail.waiting_periods || [],
          claimConditions: detail.claim_conditions || [],
          rawPages: (detail.pages as Array<{ page_no?: number; text?: string; ocr_used?: boolean }> | undefined)?.map((p) => ({
            pageNo: typeof p.page_no === "number" ? p.page_no : 1,
            text: typeof p.text === "string" ? p.text : "",
            ocrUsed: Boolean(p.ocr_used),
          })) || [],
        });
        setView("review");
        return;
      } catch {
        // Fallback to local doc item below
      }
    }

    // Local fallback
    setActiveReviewDoc({
      id: doc.id,
      filename: doc.name,
      docType: doc.type,
      insurer: doc.extractedDetail?.issuer || "",
      planName: doc.extractedDetail?.planName || "",
      policyNumber: doc.extractedDetail?.policyNumber || "",
      policyholder: doc.extractedDetail?.policyholder || "",
      insuredPerson: doc.extractedDetail?.insuredPerson || "",
      dob: doc.extractedDetail?.dob || "",
      coverageStart: doc.extractedDetail?.coverageStart || "",
      coverageEnd: doc.extractedDetail?.coverageEnd || "",
      planType: doc.extractedDetail?.planType || "",
      status: doc.status,
      benefits: [],
      exclusions: [],
      waitingPeriods: [],
      claimConditions: [],
    });
    setView("review");
  };

  const handleDeleteDocument = async (id: string) => {
    const authHeaders = headers || (token ? { Authorization: `Bearer ${token}` } : null);
    if (authHeaders) {
      try {
        await api.request("delete", "/api/v1/account/documents/{document_id}", {
          params: { document_id: id },
          headers: authHeaders,
          body: { confirm: "HAPUS" },
        });
        void refreshDocuments();
      } catch {
        setDocuments((prev) => prev.filter((d) => d.id !== id));
      }
    } else {
      setDocuments((prev) => prev.filter((d) => d.id !== id));
    }
  };

  const handleProceedFromUpload = (item: UploadQueueItem) => {
    const fileUrl = item.file ? URL.createObjectURL(item.file) : null;
    const detail = (item as unknown as { detail?: AccountDocumentDetail }).detail;
    const findField = (key: string): string => {
      const f = detail?.fields?.find((i: { field_key: string }) => i.field_key === key);
      return typeof f?.value === "string" ? f.value : "";
    };

    const mappedBenefits: ReviewDocBenefitItem[] = (
      detail?.benefits as Array<{
        benefit_item?: string;
        name?: string;
        coverage_limit?: string;
        limit?: string;
        deductible?: string;
        source_page?: number;
        page?: number;
      }> | undefined
    )?.map((b, idx) => ({
      id: `b-${idx}`,
      name: b.benefit_item || b.name || "Coverage benefit",
      limit: b.coverage_limit || b.limit || "-",
      deductible: b.deductible || "-",
      page: b.source_page || b.page || 1,
    })) || [];

    setActiveReviewDoc({
      id: item.id,
      filename: item.name,
      docType: item.extracted?.docType || "Policy document",
      fileUrl,
      mimeType: item.file?.type || "application/pdf",
      insurer: findField("provider") || item.extracted?.issuer || "",
      planName: findField("plan_name") || item.extracted?.planName || item.name,
      policyNumber: findField("policy_number") || item.extracted?.policyNumber || "",
      policyholder: findField("policyholder_name") || item.extracted?.policyholder || "",
      insuredPerson: findField("insured_name") || item.extracted?.insuredPerson || "",
      dob: findField("birth_date") || item.extracted?.dob || "",
      coverageStart: findField("coverage_start_date") || item.extracted?.coverageStart || "",
      coverageEnd: findField("coverage_end_date") || item.extracted?.coverageEnd || "",
      planType: findField("plan_type") || item.extracted?.planType || "",
      status: "Verified",
      benefits: mappedBenefits,
      exclusions: detail?.exclusions || [],
      waitingPeriods: detail?.waiting_periods || [],
      claimConditions: detail?.claim_conditions || [],
      rawPages: (detail?.pages as Array<{ page_no?: number; text?: string; ocr_used?: boolean }> | undefined)?.map((p) => ({
        pageNo: typeof p.page_no === "number" ? p.page_no : 1,
        text: typeof p.text === "string" ? p.text : "",
        ocrUsed: Boolean(p.ocr_used),
      })) || [],
    });
    setView("review");
  };

  if (view === "upload") {
    return (
      <UploadFlow
        onBackToDashboard={() => setView("dashboard")}
        onProceedToReview={handleProceedFromUpload}
        onUploadFile={handleUploadFile}
      />
    );
  }

  if (view === "review") {
    return (
      <DocumentReview
        initialDoc={activeReviewDoc}
        onBack={() => setView("dashboard")}
        onConfirmSuccess={() => {
          if (activeReviewDoc?.id) {
            setDocuments((prev) =>
              prev.map((d) =>
                d.id === activeReviewDoc.id ? { ...d, status: "Verified" } : d
              )
            );
          }
        }}
      />
    );
  }

  return (
    <DocumentsDashboard
      documents={documents}
      onUploadClick={() => setView("upload")}
      onSelectDocument={handleSelectDocument}
      onDeleteDocument={handleDeleteDocument}
    />
  );
}
