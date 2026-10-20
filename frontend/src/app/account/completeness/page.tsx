"use client";

import { showAlert } from "@/components/ui/app-dialog";
import Image from "next/image";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import {
  AlertCircle,
  ArrowRight,
  BarChart2,
  Calendar,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  FileCheck,
  FileText,
  Info,
  MinusCircle,
  Shield,
  ShieldAlert,
  User,
  X,
} from "lucide-react";
import { api } from "@/lib/api/client";
import type { components } from "@/lib/api/types.gen";
import { useAuth } from "@/lib/auth";
import { useSession } from "@/lib/session";
import { PolicyDocumentPreviewModal } from "@/components/policies/policy-document-preview-modal";

type Setup = components["schemas"]["AccountSetup"];
type Result = components["schemas"]["AccountCompleteness"];
type Item = components["schemas"]["AccountCompletenessItem"];
type DocSummary = components["schemas"]["AccountDocumentSummary"];

export default function AccountCompleteness() {
  const { token } = useAuth();
  const { data: demoSession } = useSession();

  const [, setSetup] = useState<Setup | null>(null);
  const [task, setTask] = useState("coverage_continuity");
  const [result, setResult] = useState<Result | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [, setLoading] = useState(true);
  const [fromDocuments, setFromDocuments] = useState(false);
  const [accountDocs, setAccountDocs] = useState<DocSummary[]>([]);

  // Collapsible sections
  const [profileOpen, setProfileOpen] = useState(true);
  const [insuranceOpen, setInsuranceOpen] = useState(true);

  // In-page edit modal
  const [editItem, setEditItem] = useState<Item | null>(null);
  const [editValue, setEditValue] = useState("");
  const [savingEdit, setSavingEdit] = useState(false);

  // Document Preview Modal
  const [previewModalOpen, setPreviewModalOpen] = useState(false);
  const [previewModalData, setPreviewModalData] = useState<{
    documentId?: string;
    documentName: string;
    documentType?: string;
    fileUrl?: string;
    policyNumber?: string;
    insurer?: string;
    planName?: string;
    policyholder?: string;
    coverageStart?: string;
    coverageEnd?: string;
  } | null>(null);

  useEffect(() => {
    queueMicrotask(() => {
      const search = new URLSearchParams(window.location.search);
      setFromDocuments(search.get("from") === "documents");
      const paramTask = search.get("task");
      if (paramTask) setTask(paramTask);
    });
  }, []);

  const authHeaders: Record<string, string> = useMemo(() => {
    const headers: Record<string, string> = {};
    if (token) {
      headers.Authorization = `Bearer ${token}`;
    } else if (demoSession?.session?.id) {
      headers["X-Demo-Session"] = demoSession.session.id;
    }
    return headers;
  }, [token, demoSession]);

  const fetchCompleteness = async () => {
    if (!token && !demoSession?.session?.id) return;
    try {
      const value = await api.request("get", "/api/v1/account/completeness", {
        query: { task: task || "coverage_continuity" },
        headers: authHeaders,
      });
      setResult(value);
      setError(null);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Unable to load data completeness assessment.");
    }
  };

  useEffect(() => {
    if (!token && !demoSession?.session?.id) return;
    let active = true;

    async function init() {
      try {
        setLoading(true);
        // Load Profile & Setup
        const profileRes = await api.request("get", "/api/v1/account/profile", {
          headers: authHeaders,
        });
        const countryCode = profileRes.profile?.country_code || "CN";
        const setupRes = await api.request("get", "/api/v1/account/setup/{country_code}", {
          params: { country_code: countryCode },
          headers: authHeaders,
        });
        if (!active) return;
        setSetup(setupRes);

        const continuityTask = setupRes.tasks.find(
          (item) => item.task_code === "coverage_continuity" || item.task_code === "visa_cover",
        );
        const selectedTask = String(continuityTask?.task_code ?? setupRes.tasks[0]?.task_code ?? "coverage_continuity");
        setTask((prev) => prev || selectedTask);

        const compRes = await api.request("get", "/api/v1/account/completeness", {
          query: { task: selectedTask },
          headers: authHeaders,
        });
        if (active) {
          setResult(compRes);
          setError(null);
        }

        try {
          const docsRes = await api.request("get", "/api/v1/account/documents", {
            headers: authHeaders,
          });
          if (active && Array.isArray(docsRes)) {
            setAccountDocs(docsRes);
          }
        } catch {
          // Fallback if documents list endpoint not seeded or returns empty
        }
      } catch (err: unknown) {
        if (active) setError(err instanceof Error ? err.message : "Unable to load assessment.");
      } finally {
        if (active) setLoading(false);
      }
    }

    void init();
    return () => {
      active = false;
    };
  }, [token, demoSession]);

  // Refresh on task change or window focus (REG-45)
  useEffect(() => {
    if (!token && !demoSession?.session?.id) return;
    void Promise.resolve().then(fetchCompleteness);
    const handleFocus = () => void fetchCompleteness();
    window.addEventListener("focus", handleFocus);
    return () => window.removeEventListener("focus", handleFocus);
  }, [task, token, demoSession]);

  const handleOpenDocPreview = (options?: {
    documentId?: string;
    documentName?: string;
    documentType?: string;
    fileUrl?: string;
    policyNumber?: string;
    insurer?: string;
    planName?: string;
    policyholder?: string;
    coverageStart?: string;
    coverageEnd?: string;
  }) => {
    const matchedDoc = options?.documentId
      ? accountDocs.find((d) => d.id === options.documentId)
      : options?.insurer
      ? accountDocs.find((d) => d.original_filename?.toLowerCase().includes(options.insurer!.toLowerCase()))
      : accountDocs[0];

    const effectiveDocId = matchedDoc?.id || options?.documentId || accountDocs[0]?.id;
    setPreviewModalData({
      documentId: effectiveDocId,
      documentName: matchedDoc?.original_filename || options?.documentName || "Document.pdf",
      documentType: matchedDoc?.kind || options?.documentType || "Policy document",
      fileUrl:
        options?.fileUrl ||
        (effectiveDocId && !effectiveDocId.startsWith("demo-")
          ? `/api/v1/account/documents/${effectiveDocId}/file`
          : "/sample-documents/shenzhen_pingan_insurance_certificate.pdf"),
      policyNumber: options?.policyNumber || "",
      insurer: options?.insurer || "",
      planName: options?.planName || "Insurance Plan",
      policyholder:
        options?.policyholder ||
        result?.profile_items?.find((p) => p.field_key === "full_name")?.details ||
        "",
      coverageStart: options?.coverageStart || "1 Sep 2024",
      coverageEnd: options?.coverageEnd || "31 Aug 2025",
    });
    setPreviewModalOpen(true);
  };

  const handleSaveModal = async () => {
    if (!editItem) return;
    setSavingEdit(true);
    try {
      await api.request("post", "/api/v1/account/manual-fields", {
        headers: authHeaders,
        body: {
          field_key: editItem.field_key,
          value: editValue,
          confirm: true,
        },
      });
      setEditItem(null);
      await fetchCompleteness();
    } catch (err: unknown) {
      void showAlert(err instanceof Error ? err.message : "Failed to save field value.");
    } finally {
      setSavingEdit(false);
    }
  };

  const metrics = result?.metrics;
  const overallPct = metrics?.overall_pct ?? result?.ready_pct ?? 76;
  const profileFound = metrics?.profile_found ?? 6;
  const profileTotal = metrics?.profile_total ?? 8;
  const insuranceFound = metrics?.insurance_found ?? 8;
  const insuranceTotal = metrics?.insurance_total ?? 11;
  const docsFound = metrics?.documents_found ?? 6;
  const docsTotal = metrics?.documents_total ?? 8;

  // Fallback defaults for Raka UI demo if list is not populated yet
  const profileRows: Item[] = useMemo(() => {
    if (result?.profile_items && result.profile_items.length > 0) {
      return result.profile_items;
    }
    return [
      { field_key: "full_name", label: "Full name", status: "FOUND", details: "Raka Pratama", action_type: "EDIT" },
      { field_key: "date_of_birth", label: "Date of birth", status: "FOUND", details: "15 Mar 2003", action_type: "EDIT" },
      { field_key: "country_of_residence", label: "Country of residence", status: "FOUND", details: "China (Beijing)", action_type: "EDIT" },
      { field_key: "status", label: "Status", status: "FOUND", details: "Student (X1 Visa)", action_type: "EDIT" },
      { field_key: "visa_permit", label: "Visa / residence permit", status: "FOUND", details: "Valid until 31 Jan 2028", action_type: "EDIT" },
      { field_key: "emergency_contact", label: "Emergency contact", status: "UNVERIFIED", details: "Not yet verified", action_type: "VERIFY" },
      { field_key: "medical_conditions", label: "Medical conditions", status: "MISSING", details: "Not provided", action_type: "ADD" },
      { field_key: "dependents", label: "Dependents", status: "NOT_APPLICABLE", details: "N/A", action_type: undefined },
    ];
  }, [result]);

  const insuranceRows: Item[] = useMemo(() => {
    if (result?.insurance_items && result.insurance_items.length > 0) {
      return result.insurance_items;
    }
    return [
      { field_key: "student_insurance", label: "Student insurance", status: "FOUND", details: "AIA International Student Plan", action_type: "VIEW" },
      { field_key: "public_health_insurance", label: "Public health insurance", status: "UNVERIFIED", details: "Chinese social insurance (pending)", action_type: "VERIFY" },
      { field_key: "travel_insurance", label: "Travel insurance", status: "FOUND", details: "Chubb Travel Insurance", action_type: "VIEW" },
      { field_key: "employer_insurance", label: "Employer insurance", status: "NOT_APPLICABLE", details: "N/A", action_type: undefined },
      { field_key: "policy_effective_dates", label: "Policy effective dates", status: "FOUND", details: "1 Sep 2024 – 31 Aug 2025", action_type: "VIEW" },
      { field_key: "coverage_limits", label: "Coverage limits", status: "FOUND", details: "Medical RMB 1,000,000", action_type: "VIEW" },
      { field_key: "benefits_coverage", label: "Benefits and coverage", status: "UNVERIFIED", details: "Some items need confirmation", action_type: "REVIEW" },
      { field_key: "exclusions", label: "Exclusions", status: "MISSING", details: "Not extracted", action_type: "ADD" },
    ];
  }, [result]);

  const renderStatusBadge = (status: string) => {
    switch (status) {
      case "FOUND":
        return (
          <span style={{ display: "inline-flex", alignItems: "center", gap: 5, padding: "3px 8px", borderRadius: 9999, background: "#ecfdf5", color: "#059669", fontSize: 12, fontWeight: 600 }}>
            <CheckCircle2 size={13} color="#059669" />
            Found
          </span>
        );
      case "UNVERIFIED":
        return (
          <span style={{ display: "inline-flex", alignItems: "center", gap: 5, padding: "3px 8px", borderRadius: 9999, background: "#fffbeb", color: "#d97706", fontSize: 12, fontWeight: 600 }}>
            <AlertCircle size={13} color="#d97706" />
            Unverified
          </span>
        );
      case "MISSING":
        return (
          <span style={{ display: "inline-flex", alignItems: "center", gap: 5, padding: "3px 8px", borderRadius: 9999, background: "#fef2f2", color: "#dc2626", fontSize: 12, fontWeight: 600 }}>
            <MinusCircle size={13} color="#dc2626" />
            Missing
          </span>
        );
      case "NOT_APPLICABLE":
      default:
        return (
          <span style={{ display: "inline-flex", alignItems: "center", gap: 5, padding: "3px 8px", borderRadius: 9999, background: "#f1f5f9", color: "#64748b", fontSize: 12, fontWeight: 500 }}>
            <MinusCircle size={13} color="#94a3b8" />
            Not applicable
          </span>
        );
    }
  };

  const renderActionBtn = (item: Item) => {
    if (!item.action_type) return <span style={{ color: "#94a3b8" }}>-</span>;

    const label = item.action_type === "EDIT" ? "Edit"
      : item.action_type === "VIEW" ? "View"
      : item.action_type === "VERIFY" ? "Verify"
      : item.action_type === "REVIEW" ? "Review"
      : "Add";

    const handleClick = () => {
      if (item.action_type === "VIEW") {
        if (item.field_key === "travel_insurance") {
          handleOpenDocPreview({
            insurer: "Chubb",
            planName: "Chubb Travel Insurance",
            policyNumber: "CHUBB-TRV-88219",
            coverageStart: "15 Aug 2025",
            coverageEnd: "15 Feb 2026",
          });
        } else {
          handleOpenDocPreview({
            insurer: "AIA",
            planName: "AIA International Student Plan",
            policyNumber: "AIA-STU-2024-568923",
            coverageStart: "1 Sep 2024",
            coverageEnd: "31 Aug 2025",
          });
        }
      } else if (item.action_type === "VERIFY" || item.action_type === "REVIEW") {
        if (item.field_key === "public_health_insurance") {
          handleOpenDocPreview({
            insurer: "Chinese Social Insurance",
            planName: "Chinese Public Health Insurance (Pending)",
            policyNumber: "CHN-SHI-2025-091",
            coverageStart: "1 Sep 2024",
            coverageEnd: "Ongoing",
          });
        } else if (item.field_key === "benefits_coverage") {
          handleOpenDocPreview({
            insurer: "AIA",
            planName: "AIA International Student Plan",
            policyNumber: "AIA-STU-2024-568923",
          });
        } else if (item.field_key === "emergency_contact") {
          setEditItem(item);
          setEditValue(String(item.details ?? item.value ?? ""));
        } else {
          handleOpenDocPreview({ documentName: item.label });
        }
      } else {
        setEditItem(item);
        setEditValue(String(item.details ?? item.value ?? ""));
      }
    };

    return (
      <button
        type="button"
        onClick={handleClick}
        style={{
          border: "none",
          background: "transparent",
          color: "#0284c7",
          fontWeight: 600,
          fontSize: 13,
          cursor: "pointer",
          padding: 0,
        }}
      >
        {label}
      </button>
    );
  };

  // Circular gauge calculations
  const radius = 34;
  const strokeWidth = 7;
  const circumference = 2 * Math.PI * radius;
  const strokeDashoffset = circumference - (overallPct / 100) * circumference;

  return (
    <div style={{ maxWidth: 1280, margin: "0 auto", padding: "8px 12px 64px" }}>
      {fromDocuments && (
        <div className="completeness-tour-banner" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "14px 18px", borderRadius: 14, background: "#f0fdf4", border: "1px solid #bbf7d0", color: "#166534", marginBottom: 20 }}>
          <div>
            <strong>Your documents have been processed and calculated.</strong>
            <span style={{ marginLeft: 8, color: "#15803d", fontSize: 13 }}>Review your updated completeness score below, then proceed to the home dashboard.</span>
          </div>
          <Link href="/home?tour=home" style={{ display: "inline-flex", alignItems: "center", gap: 6, fontWeight: 700, color: "#166534", textDecoration: "none", fontSize: 13 }}>
            Continue to Home <ArrowRight size={15} />
          </Link>
        </div>
      )}

      {/* Page Header with Title & Top-Right Mascot Callout */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 24, marginBottom: 24, flexWrap: "wrap" }}>
        <div>
          <h1 style={{ margin: 0, color: "#10223c", fontSize: 30, fontWeight: 800, letterSpacing: "-0.02em" }}>
            Data Completeness
          </h1>
          <p style={{ margin: "6px 0 0", color: "#64748b", fontSize: 14 }}>
            Check if we have everything we need to give you accurate analysis and recommendations.
          </p>
        </div>

        {/* Mascot Speech Bubble Callout */}
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <div
            style={{
              position: "relative",
              background: "#ffffff",
              border: "1px solid #e2e8f0",
              borderRadius: 14,
              padding: "10px 14px",
              boxShadow: "0 2px 6px rgba(0,0,0,0.04)",
              maxWidth: 240,
              fontSize: 12,
              lineHeight: 1.45,
              color: "#334155",
            }}
          >
            Complete your information to get more accurate coverage analysis and personalized recommendations.
            <div
              style={{
                position: "absolute",
                right: -7,
                top: "50%",
                transform: "translateY(-50%) rotate(45deg)",
                width: 12,
                height: 12,
                background: "#ffffff",
                borderRight: "1px solid #e2e8f0",
                borderTop: "1px solid #e2e8f0",
              }}
            />
          </div>
          <div style={{ width: 68, height: 68, position: "relative", flexShrink: 0 }}>
            <Image
              src="/Cute%20Mascot%20with%20Checklist%20Clipboard.png"
              alt="Inssura Mascot"
              fill
              style={{ objectFit: "contain" }}
            />
          </div>
        </div>
      </div>

      {error && (
        <div role="alert" style={{ padding: 14, marginBottom: 20, border: "1px solid #fed7aa", borderRadius: 12, background: "#fff7ed", color: "#9a3412", fontSize: 13 }}>
          {error}
        </div>
      )}

      {/* KPI Cards (Row of 4 Cards) */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: 16, marginBottom: 24 }}>
        {/* Card 1: Overall Completeness Gauge */}
        <div style={{ background: "#ffffff", border: "1px solid #e2e8f0", borderRadius: 16, padding: "18px 20px", display: "flex", alignItems: "center", gap: 16, boxShadow: "0 1px 3px rgba(0,0,0,0.03)" }}>
          <div style={{ position: "relative", width: 78, height: 78, flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center" }}>
            <svg width="78" height="78" style={{ transform: "rotate(-90deg)" }}>
              <circle cx="39" cy="39" r={radius} fill="none" stroke="#e2e8f0" strokeWidth={strokeWidth} />
              <circle
                cx="39"
                cy="39"
                r={radius}
                fill="none"
                stroke="#0d9488"
                strokeWidth={strokeWidth}
                strokeDasharray={circumference}
                strokeDashoffset={strokeDashoffset}
                strokeLinecap="round"
                style={{ transition: "stroke-dashoffset 0.8s ease" }}
              />
            </svg>
            <span style={{ position: "absolute", fontSize: 17, fontWeight: 800, color: "#10223c" }}>
              {overallPct}%
            </span>
          </div>
          <div>
            <div style={{ fontSize: 14, fontWeight: 700, color: "#10223c", marginBottom: 3 }}>Overall completeness</div>
            <div style={{ fontSize: 12, color: "#64748b", lineHeight: 1.4 }}>Good progress! Complete the remaining items for full insights.</div>
          </div>
        </div>

        {/* Card 2: Profile information */}
        <div style={{ background: "#ffffff", border: "1px solid #e2e8f0", borderRadius: 16, padding: "18px 20px", display: "flex", flexDirection: "column", justifyContent: "center", boxShadow: "0 1px 3px rgba(0,0,0,0.03)" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
            <div style={{ width: 34, height: 34, borderRadius: "50%", background: "#ecfdf5", display: "flex", alignItems: "center", justifyContent: "center", color: "#059669" }}>
              <User size={18} />
            </div>
            <div>
              <div style={{ fontSize: 12, color: "#64748b", fontWeight: 600 }}>Profile information</div>
              <div style={{ fontSize: 18, fontWeight: 800, color: "#10223c" }}>{profileFound} / {profileTotal}</div>
            </div>
          </div>
          <div style={{ width: "100%", height: 6, background: "#f1f5f9", borderRadius: 9999, overflow: "hidden" }}>
            <div style={{ width: `${Math.round((profileFound / profileTotal) * 100)}%`, height: "100%", background: "#059669", borderRadius: 9999 }} />
          </div>
        </div>

        {/* Card 3: Insurance information */}
        <div style={{ background: "#ffffff", border: "1px solid #e2e8f0", borderRadius: 16, padding: "18px 20px", display: "flex", flexDirection: "column", justifyContent: "center", boxShadow: "0 1px 3px rgba(0,0,0,0.03)" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
            <div style={{ width: 34, height: 34, borderRadius: "50%", background: "#eff6ff", display: "flex", alignItems: "center", justifyContent: "center", color: "#2563eb" }}>
              <Shield size={18} />
            </div>
            <div>
              <div style={{ fontSize: 12, color: "#64748b", fontWeight: 600 }}>Insurance information</div>
              <div style={{ fontSize: 18, fontWeight: 800, color: "#10223c" }}>{insuranceFound} / {insuranceTotal}</div>
            </div>
          </div>
          <div style={{ width: "100%", height: 6, background: "#f1f5f9", borderRadius: 9999, overflow: "hidden" }}>
            <div style={{ width: `${Math.round((insuranceFound / insuranceTotal) * 100)}%`, height: "100%", background: "#2563eb", borderRadius: 9999 }} />
          </div>
        </div>

        {/* Card 4: Documents */}
        <div style={{ background: "#ffffff", border: "1px solid #e2e8f0", borderRadius: 16, padding: "18px 20px", display: "flex", flexDirection: "column", justifyContent: "center", boxShadow: "0 1px 3px rgba(0,0,0,0.03)" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
            <div style={{ width: 34, height: 34, borderRadius: "50%", background: "#f3e8ff", display: "flex", alignItems: "center", justifyContent: "center", color: "#9333ea" }}>
              <FileText size={18} />
            </div>
            <div>
              <div style={{ fontSize: 12, color: "#64748b", fontWeight: 600 }}>Documents</div>
              <div style={{ fontSize: 18, fontWeight: 800, color: "#10223c" }}>{docsFound} / {docsTotal}</div>
            </div>
          </div>
          <div style={{ width: "100%", height: 6, background: "#f1f5f9", borderRadius: 9999, overflow: "hidden" }}>
            <div style={{ width: `${Math.round((docsFound / docsTotal) * 100)}%`, height: "100%", background: "#9333ea", borderRadius: 9999 }} />
          </div>
        </div>
      </div>

      {/* Main Two-Column Layout */}
      <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1.4fr) minmax(320px, 1fr)", gap: 24, alignItems: "start" }}>
        {/* Left Column: Profile & Insurance Tables */}
        <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
          {/* Section 1: Profile information */}
          <div style={{ background: "#ffffff", border: "1px solid #e2e8f0", borderRadius: 18, overflow: "hidden", boxShadow: "0 1px 3px rgba(0,0,0,0.03)" }}>
            <div
              onClick={() => setProfileOpen(!profileOpen)}
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                padding: "16px 20px",
                cursor: "pointer",
                userSelect: "none",
                background: "#fafbfd",
                borderBottom: profileOpen ? "1px solid #eef2f6" : "none",
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                <div style={{ width: 32, height: 32, borderRadius: 8, background: "#e0f2fe", color: "#0284c7", display: "flex", alignItems: "center", justifyContent: "center" }}>
                  <User size={18} />
                </div>
                <div>
                  <div style={{ fontSize: 15, fontWeight: 700, color: "#10223c" }}>1. Profile information</div>
                  <div style={{ fontSize: 12, color: "#64748b" }}>Your basic information to personalize recommendations.</div>
                </div>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <span style={{ padding: "4px 10px", borderRadius: 9999, background: "#ecfdf5", color: "#059669", fontSize: 12, fontWeight: 700 }}>
                  {profileFound} / {profileTotal} complete
                </span>
                {profileOpen ? <ChevronUp size={18} color="#64748b" /> : <ChevronDown size={18} color="#64748b" />}
              </div>
            </div>

            {profileOpen && (
              <div style={{ overflowX: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "collapse", textAlign: "left", fontSize: 13 }}>
                  <thead>
                    <tr style={{ color: "#64748b", borderBottom: "1px solid #f1f5f9", background: "#ffffff" }}>
                      <th style={{ padding: "12px 20px", fontWeight: 600 }}>Item</th>
                      <th style={{ padding: "12px 14px", fontWeight: 600 }}>Status</th>
                      <th style={{ padding: "12px 14px", fontWeight: 600 }}>Details</th>
                      <th style={{ padding: "12px 20px", fontWeight: 600, textAlign: "right" }}>Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {profileRows.map((row) => (
                      <tr key={row.field_key} style={{ borderBottom: "1px solid #f8fafc" }}>
                        <td style={{ padding: "14px 20px", color: "#1e293b", fontWeight: 500 }}>{row.label}</td>
                        <td style={{ padding: "14px 14px" }}>{renderStatusBadge(row.status)}</td>
                        <td
                          style={{
                            padding: "14px 14px",
                            color: row.status === "MISSING" ? "#dc2626" : row.status === "UNVERIFIED" ? "#d97706" : row.status === "NOT_APPLICABLE" ? "#94a3b8" : "#334155",
                            fontWeight: row.status === "MISSING" || row.status === "UNVERIFIED" ? 600 : 400,
                          }}
                        >
                          {row.details ?? "N/A"}
                        </td>
                        <td style={{ padding: "14px 20px", textAlign: "right" }}>{renderActionBtn(row)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* Section 2: Insurance information */}
          <div style={{ background: "#ffffff", border: "1px solid #e2e8f0", borderRadius: 18, overflow: "hidden", boxShadow: "0 1px 3px rgba(0,0,0,0.03)" }}>
            <div
              onClick={() => setInsuranceOpen(!insuranceOpen)}
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                padding: "16px 20px",
                cursor: "pointer",
                userSelect: "none",
                background: "#fafbfd",
                borderBottom: insuranceOpen ? "1px solid #eef2f6" : "none",
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                <div style={{ width: 32, height: 32, borderRadius: 8, background: "#eff6ff", color: "#2563eb", display: "flex", alignItems: "center", justifyContent: "center" }}>
                  <Shield size={18} />
                </div>
                <div>
                  <div style={{ fontSize: 15, fontWeight: 700, color: "#10223c" }}>2. Insurance information</div>
                  <div style={{ fontSize: 12, color: "#64748b" }}>Details about your existing insurance coverage.</div>
                </div>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <span style={{ padding: "4px 10px", borderRadius: 9999, background: "#eff6ff", color: "#2563eb", fontSize: 12, fontWeight: 700 }}>
                  {insuranceFound} / {insuranceTotal} complete
                </span>
                {insuranceOpen ? <ChevronUp size={18} color="#64748b" /> : <ChevronDown size={18} color="#64748b" />}
              </div>
            </div>

            {insuranceOpen && (
              <div style={{ overflowX: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "collapse", textAlign: "left", fontSize: 13 }}>
                  <thead>
                    <tr style={{ color: "#64748b", borderBottom: "1px solid #f1f5f9", background: "#ffffff" }}>
                      <th style={{ padding: "12px 20px", fontWeight: 600 }}>Item</th>
                      <th style={{ padding: "12px 14px", fontWeight: 600 }}>Status</th>
                      <th style={{ padding: "12px 14px", fontWeight: 600 }}>Details</th>
                      <th style={{ padding: "12px 20px", fontWeight: 600, textAlign: "right" }}>Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {insuranceRows.map((row) => (
                      <tr key={row.field_key} style={{ borderBottom: "1px solid #f8fafc" }}>
                        <td style={{ padding: "14px 20px", color: "#1e293b", fontWeight: 500 }}>{row.label}</td>
                        <td style={{ padding: "14px 14px" }}>{renderStatusBadge(row.status)}</td>
                        <td
                          style={{
                            padding: "14px 14px",
                            color: row.status === "MISSING" ? "#dc2626" : row.status === "UNVERIFIED" ? "#d97706" : row.status === "NOT_APPLICABLE" ? "#94a3b8" : "#334155",
                            fontWeight: row.status === "MISSING" || row.status === "UNVERIFIED" ? 600 : 400,
                          }}
                        >
                          {row.details ?? "N/A"}
                        </td>
                        <td style={{ padding: "14px 20px", textAlign: "right" }}>{renderActionBtn(row)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>

        {/* Right Column: Timeline, Attention & Benefits */}
        <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
          {/* Card 1: Coverage Timeline (REG-42, REG-43) */}
          <div style={{ background: "#ffffff", border: "1px solid #e2e8f0", borderRadius: 18, padding: "20px 22px", boxShadow: "0 1px 3px rgba(0,0,0,0.03)" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 15, fontWeight: 700, color: "#10223c" }}>
                <Calendar size={18} color="#0284c7" />
                Coverage timeline
              </div>
              <Link href="/policies" style={{ fontSize: 12, fontWeight: 700, color: "#0284c7", textDecoration: "none" }}>
                View details &rarr;
              </Link>
            </div>
            <p style={{ margin: "0 0 20px", color: "#64748b", fontSize: 12 }}>
              Your current coverage and important dates.
            </p>

            {/* Timeline Graphic */}
            <div style={{ position: "relative", padding: "10px 0 16px" }}>
              {/* Year Scale Header */}
              <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", textAlign: "center", fontSize: 11, fontWeight: 600, color: "#94a3b8", marginBottom: 12, borderBottom: "1px solid #f1f5f9", paddingBottom: 6 }}>
                <div>2024</div>
                <div>2025</div>
                <div style={{ position: "relative", color: "#0284c7" }}>
                  {/* Floating "Today" Badge */}
                  <span style={{ position: "absolute", top: -20, left: "50%", transform: "translateX(-50%)", background: "#0284c7", color: "#fff", fontSize: 10, fontWeight: 700, padding: "2px 8px", borderRadius: 9999 }}>
                    Today
                  </span>
                  2026
                </div>
                <div>2027</div>
                <div>2028</div>
              </div>

              {/* Dotted Guideline for Today */}
              <div
                style={{
                  position: "absolute",
                  left: "50%",
                  top: 32,
                  bottom: 10,
                  width: 1,
                  borderLeft: "1.5px dashed #0284c7",
                  pointerEvents: "none",
                  zIndex: 2,
                }}
              />

              {/* Timeline Track Bars */}
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                {/* Track 1: Student Insurance (AIA) */}
                <div style={{ position: "relative", height: 32 }}>
                  <div
                    onClick={() =>
                      handleOpenDocPreview({
                        insurer: "AIA",
                        planName: "AIA International Student Plan",
                        policyNumber: "AIA-STU-2024-568923",
                        coverageStart: "1 Sep 2024",
                        coverageEnd: "31 Aug 2025",
                      })
                    }
                    style={{
                      position: "absolute",
                      left: "12%",
                      width: "36%",
                      height: "100%",
                      borderRadius: 9999,
                      background: "#e0f2fe",
                      border: "1px solid #bae6fd",
                      display: "flex",
                      alignItems: "center",
                      gap: 6,
                      padding: "0 10px",
                      fontSize: 11,
                      fontWeight: 600,
                      color: "#0369a1",
                      whiteSpace: "nowrap",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      boxShadow: "0 1px 2px rgba(0,0,0,0.03)",
                      cursor: "pointer",
                    }}
                    title="Click to view policy document: Student Insurance (AIA)"
                  >
                    <Info size={13} style={{ flexShrink: 0 }} />
                    <span>Student Insurance (AIA)</span>
                  </div>
                  <div style={{ position: "absolute", right: 0, top: "50%", transform: "translateY(-50%)", fontSize: 10, color: "#64748b" }}>
                    1 Sep 2024 – 31 Aug 2025
                  </div>
                </div>

                {/* Track 2: Travel Insurance (Chubb) */}
                <div style={{ position: "relative", height: 32 }}>
                  <div
                    onClick={() =>
                      handleOpenDocPreview({
                        insurer: "Chubb",
                        planName: "Chubb Travel Insurance",
                        policyNumber: "CHUBB-TRV-88219",
                        coverageStart: "15 Aug 2025",
                        coverageEnd: "15 Feb 2026",
                      })
                    }
                    style={{
                      position: "absolute",
                      left: "32%",
                      width: "28%",
                      height: "100%",
                      borderRadius: 9999,
                      background: "#f3e8ff",
                      border: "1px solid #e9d5ff",
                      display: "flex",
                      alignItems: "center",
                      gap: 6,
                      padding: "0 10px",
                      fontSize: 11,
                      fontWeight: 600,
                      color: "#7e22ce",
                      whiteSpace: "nowrap",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      boxShadow: "0 1px 2px rgba(0,0,0,0.03)",
                      cursor: "pointer",
                    }}
                    title="Click to view policy document: Travel Insurance (Chubb)"
                  >
                    <Info size={13} style={{ flexShrink: 0 }} />
                    <span>Travel Insurance (Chubb)</span>
                  </div>
                  <div style={{ position: "absolute", right: 0, top: "50%", transform: "translateY(-50%)", fontSize: 10, color: "#64748b" }}>
                    15 Aug 2025 – 15 Feb 2026
                  </div>
                </div>

                {/* Track 3: Visa / Residence Permit (X1) */}
                <div style={{ position: "relative", height: 32 }}>
                  <div
                    onClick={() =>
                      handleOpenDocPreview({
                        documentName: "Student_Visa_X1.pdf",
                        documentType: "Visa / Residence Permit",
                        insurer: "National Immigration Administration",
                        planName: "X1 Student Visa / Residence Permit",
                        policyNumber: "VISA-X1-CN-2024-89",
                        coverageStart: "1 Sep 2024",
                        coverageEnd: "31 Jan 2028",
                      })
                    }
                    style={{
                      position: "absolute",
                      left: "12%",
                      width: "82%",
                      height: "100%",
                      borderRadius: 9999,
                      background: "#ffe4e6",
                      border: "1px solid #fecdd3",
                      display: "flex",
                      alignItems: "center",
                      gap: 6,
                      padding: "0 10px",
                      fontSize: 11,
                      fontWeight: 600,
                      color: "#be123c",
                      whiteSpace: "nowrap",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      boxShadow: "0 1px 2px rgba(0,0,0,0.03)",
                      cursor: "pointer",
                    }}
                    title="Click to view permit details: Visa / Residence Permit (X1)"
                  >
                    <ShieldAlert size={13} style={{ flexShrink: 0 }} />
                    <span>Visa / Residence Permit (X1)</span>
                  </div>
                  <div style={{ position: "absolute", right: 0, top: "50%", transform: "translateY(-50%)", fontSize: 10, color: "#64748b" }}>
                    1 Sep 2024 – 31 Jan 2028
                  </div>
                </div>
              </div>
            </div>

            {/* Date difference insight if detected */}
            {result?.coverage_continuity && result.coverage_continuity.gap_days !== null && (
              <div style={{ marginTop: 14, padding: "10px 14px", borderRadius: 10, background: "#f8fafc", border: "1px solid #e2e8f0", fontSize: 12, color: "#475569" }}>
                <strong>Continuity check:</strong> {result.coverage_continuity.explanation}
              </div>
            )}
          </div>

          {/* Card 2: Items that need your attention (REG-44) */}
          <div style={{ background: "#ffffff", border: "1px solid #e2e8f0", borderRadius: 18, padding: "20px 22px", boxShadow: "0 1px 3px rgba(0,0,0,0.03)" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 15, fontWeight: 700, color: "#10223c" }}>
                <div style={{ width: 22, height: 22, borderRadius: "50%", background: "#ffedd5", display: "flex", alignItems: "center", justifyContent: "center", color: "#c2410c" }}>
                  <AlertCircle size={14} />
                </div>
                Items that need your attention
              </div>
              <span style={{ fontSize: 12, fontWeight: 700, color: "#c2410c", background: "#ffedd5", padding: "2px 8px", borderRadius: 9999 }}>
                3 items
              </span>
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {/* Item 1: Add medical conditions */}
              <div
                onClick={() => {
                  setEditItem({ field_key: "medical_conditions", label: "Medical conditions", status: "MISSING" });
                  setEditValue("");
                }}
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  padding: "12px 14px",
                  borderRadius: 14,
                  background: "#fef2f2",
                  border: "1px solid #fee2e2",
                  cursor: "pointer",
                  transition: "all 0.15s ease",
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <div style={{ width: 32, height: 32, borderRadius: 8, background: "#fee2e2", display: "flex", alignItems: "center", justifyContent: "center", color: "#ef4444" }}>
                    <FileText size={16} />
                  </div>
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 700, color: "#991b1b" }}>Add medical conditions</div>
                    <div style={{ fontSize: 11, color: "#b91c1c" }}>Helps us give more relevant care pathways</div>
                  </div>
                </div>
                <ChevronRight size={18} color="#ef4444" />
              </div>

              {/* Item 2: Verify public health insurance details */}
              <div
                onClick={() =>
                  handleOpenDocPreview({
                    insurer: "Chinese Social Insurance",
                    planName: "Chinese Public Health Insurance (Pending)",
                    policyNumber: "CHN-SHI-2025-091",
                    coverageStart: "1 Sep 2024",
                    coverageEnd: "Ongoing",
                  })
                }
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  padding: "12px 14px",
                  borderRadius: 14,
                  background: "#fffbeb",
                  border: "1px solid #fef3c7",
                  cursor: "pointer",
                  transition: "all 0.15s ease",
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <div style={{ width: 32, height: 32, borderRadius: 8, background: "#fef3c7", display: "flex", alignItems: "center", justifyContent: "center", color: "#d97706" }}>
                    <Shield size={16} />
                  </div>
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 700, color: "#92400e" }}>Verify public health insurance details</div>
                    <div style={{ fontSize: 11, color: "#b45309" }}>Complete your Chinese social insurance information</div>
                  </div>
                </div>
                <ChevronRight size={18} color="#d97706" />
              </div>

              {/* Item 3: Confirm benefits and exclusions */}
              <div
                onClick={() =>
                  handleOpenDocPreview({
                    insurer: "AIA",
                    planName: "AIA International Student Plan",
                    policyNumber: "AIA-STU-2024-568923",
                    coverageStart: "1 Sep 2024",
                    coverageEnd: "31 Aug 2025",
                  })
                }
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  padding: "12px 14px",
                  borderRadius: 14,
                  background: "#fff7ed",
                  border: "1px solid #ffedd5",
                  cursor: "pointer",
                  transition: "all 0.15s ease",
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <div style={{ width: 32, height: 32, borderRadius: 8, background: "#ffedd5", display: "flex", alignItems: "center", justifyContent: "center", color: "#ea580c" }}>
                    <FileCheck size={16} />
                  </div>
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 700, color: "#9a3412" }}>Confirm benefits and exclusions</div>
                    <div style={{ fontSize: 11, color: "#c2410c" }}>Some fields need your confirmation</div>
                  </div>
                </div>
                <ChevronRight size={18} color="#ea580c" />
              </div>
            </div>
          </div>

          {/* Card 3: What you'll get after completion */}
          <div style={{ background: "#ffffff", border: "1px solid #e2e8f0", borderRadius: 18, padding: "20px 22px", boxShadow: "0 1px 3px rgba(0,0,0,0.03)" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 15, fontWeight: 700, color: "#10223c", marginBottom: 14 }}>
              <div style={{ width: 28, height: 28, borderRadius: 8, background: "#e0f2fe", display: "flex", alignItems: "center", justifyContent: "center", color: "#0284c7" }}>
                <BarChart2 size={16} />
              </div>
              What you&apos;ll get after completion
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
                <div style={{ width: 20, height: 20, borderRadius: "50%", background: "#ecfdf5", display: "flex", alignItems: "center", justifyContent: "center", color: "#059669", flexShrink: 0, marginTop: 1 }}>
                  <Check size={13} strokeWidth={3} />
                </div>
                <span style={{ fontSize: 13, color: "#334155", fontWeight: 500, lineHeight: 1.4 }}>
                  More accurate coverage analysis
                </span>
              </div>
              <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
                <div style={{ width: 20, height: 20, borderRadius: "50%", background: "#ecfdf5", display: "flex", alignItems: "center", justifyContent: "center", color: "#059669", flexShrink: 0, marginTop: 1 }}>
                  <Check size={13} strokeWidth={3} />
                </div>
                <span style={{ fontSize: 13, color: "#334155", fontWeight: 500, lineHeight: 1.4 }}>
                  Personalized recommendations for your situation
                </span>
              </div>
              <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
                <div style={{ width: 20, height: 20, borderRadius: "50%", background: "#ecfdf5", display: "flex", alignItems: "center", justifyContent: "center", color: "#059669", flexShrink: 0, marginTop: 1 }}>
                  <Check size={13} strokeWidth={3} />
                </div>
                <span style={{ fontSize: 13, color: "#334155", fontWeight: 500, lineHeight: 1.4 }}>
                  Early alerts for potential gaps or expiries
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* In-page Field Edit Modal */}
      {editItem && (
        <div
          role="dialog"
          aria-modal="true"
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(15, 23, 42, 0.5)",
            backdropFilter: "blur(4px)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 1000,
            padding: 16,
          }}
        >
          <div
            style={{
              background: "#ffffff",
              borderRadius: 20,
              padding: 24,
              width: "100%",
              maxWidth: 440,
              boxShadow: "0 20px 25px -5px rgba(0,0,0,0.1), 0 8px 10px -6px rgba(0,0,0,0.1)",
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
              <h3 style={{ margin: 0, fontSize: 18, fontWeight: 700, color: "#10223c" }}>
                Update {editItem.label}
              </h3>
              <button
                type="button"
                onClick={() => setEditItem(null)}
                style={{ border: "none", background: "transparent", cursor: "pointer", padding: 4, color: "#94a3b8" }}
              >
                <X size={20} />
              </button>
            </div>
            <p style={{ margin: "0 0 16px", color: "#64748b", fontSize: 13 }}>
              Enter or update your {editItem.label.toLowerCase()} to complete your data readiness profile.
            </p>
            <input
              type="text"
              value={editValue}
              onChange={(e) => setEditValue(e.target.value)}
              placeholder={`Enter ${editItem.label.toLowerCase()}`}
              style={{
                width: "100%",
                padding: "10px 14px",
                borderRadius: 12,
                border: "1px solid #dbe4ee",
                fontSize: 14,
                color: "#1e293b",
                marginBottom: 20,
                outline: "none",
              }}
              autoFocus
            />
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 10 }}>
              <button
                type="button"
                onClick={() => setEditItem(null)}
                style={{
                  padding: "9px 16px",
                  borderRadius: 10,
                  border: "1px solid #e2e8f0",
                  background: "#ffffff",
                  color: "#64748b",
                  fontSize: 13,
                  fontWeight: 600,
                  cursor: "pointer",
                }}
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={savingEdit}
                onClick={() => void handleSaveModal()}
                style={{
                  padding: "9px 18px",
                  borderRadius: 10,
                  border: "none",
                  background: "#0284c7",
                  color: "#ffffff",
                  fontSize: 13,
                  fontWeight: 700,
                  cursor: savingEdit ? "not-allowed" : "pointer",
                  opacity: savingEdit ? 0.7 : 1,
                }}
              >
                {savingEdit ? "Saving..." : "Save changes"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Policy & Document Preview Modal */}
      {previewModalOpen && previewModalData && (
        <PolicyDocumentPreviewModal
          isOpen={previewModalOpen}
          onClose={() => setPreviewModalOpen(false)}
          documentId={previewModalData.documentId}
          documentName={previewModalData.documentName}
          documentType={previewModalData.documentType}
          fileUrl={previewModalData.fileUrl}
          policyNumber={previewModalData.policyNumber}
          insurer={previewModalData.insurer}
          planName={previewModalData.planName}
          policyholder={previewModalData.policyholder}
          coverageStart={previewModalData.coverageStart}
          coverageEnd={previewModalData.coverageEnd}
          authHeaders={authHeaders}
          authToken={token}
          onVerify={() => {
            void fetchCompleteness();
          }}
        />
      )}
    </div>
  );
}
