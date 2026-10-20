"use client";

import React, { useEffect, useState } from "react";
import {
  ChevronLeft,
  ChevronRight,
  FileText,
  ShieldCheck,
  X,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import { config } from "@/lib/config";

interface PolicyDocumentPreviewModalProps {
  isOpen: boolean;
  onClose: () => void;
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
  benefits?: { name: string; limit: string; page?: number }[];
  exclusions?: { title: string; explanation: string; page?: number; clauseText?: string }[];
  pages?: { page_no: number; text: string }[];
  authToken?: string | null;
  authHeaders?: Record<string, string> | null;
  initialPage?: number;
  onVerify?: () => void;
}

export function PolicyDocumentPreviewModal({
  isOpen,
  onClose,
  documentId,
  documentName,
  documentType = "Policy document",
  fileUrl,
  policyNumber,
  insurer = "AIA",
  planName = "AIA International Student Plan",
  policyholder = "Raka Pratama",
  coverageStart = "1 Sep 2024",
  coverageEnd = "31 Aug 2025",
  benefits = [],
  exclusions = [],
  pages = [],
  authToken,
  authHeaders,
  initialPage = 1,
  onVerify,
}: PolicyDocumentPreviewModalProps) {
  const [userPage, setUserPage] = useState<number | null>(null);
  const currentPage = userPage ?? initialPage;
  const setCurrentPage = (p: number | ((prev: number) => number)) => {
    if (typeof p === "function") {
      setUserPage((prev) => p(prev ?? initialPage));
    } else {
      setUserPage(p);
    }
  };

  const [zoom, setZoom] = useState(100);
  const [activeTab, setActiveTab] = useState<"extracted" | "clauses">("extracted");
  const [viewMode, setViewMode] = useState<"pdf" | "rendered">("pdf");
  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  const [loadingFile, setLoadingFile] = useState(false);
  const [liveBenefits, setLiveBenefits] = useState(benefits);
  const [liveExclusions, setLiveExclusions] = useState(exclusions);
  const [isVerified, setIsVerified] = useState(false);
  const [verifying, setVerifying] = useState(false);

  // Load document detail and file blob using headers
  useEffect(() => {
    let active = true;
    if (!isOpen || !documentId || documentId.startsWith("demo-")) {
      return;
    }
    const headers: Record<string, string> = { ...(authHeaders || {}) };
    if (authToken && !headers.Authorization) {
      headers.Authorization = `Bearer ${authToken}`;
    }
    if (!headers.Authorization && !headers["X-Demo-Session"]) {
      return;
    }

    const timer = setTimeout(() => {
      if (active) setLoadingFile(true);
    }, 0);

    // 1. Fetch file blob
    fetch(`${config.apiBaseUrl}/api/v1/account/documents/${documentId}/file`, { headers })
      .then((res) => {
        if (!res.ok) throw new Error("Failed to load document");
        return res.blob();
      })
      .then((blob) => {
        if (active) {
          const url = URL.createObjectURL(blob);
          setBlobUrl((prev) => {
            if (prev) URL.revokeObjectURL(prev);
            return url;
          });
        }
      })
      .catch(() => {})
      .finally(() => {
        if (active) setLoadingFile(false);
      });

    // 2. Fetch document structured details
    fetch(`${config.apiBaseUrl}/api/v1/account/documents/${documentId}`, { headers })
      .then((res) => (res.ok ? res.json() : null))
      .then((detail) => {
        if (!active || !detail) return;
        setIsVerified(detail.status === "VERIFIED");
        if (detail.benefits && detail.benefits.length > 0) {
          setLiveBenefits(
            detail.benefits.map((b: { benefit_item?: string; name?: string; coverage_limit?: string; limit?: string; source_page?: number; page?: number }) => ({
              name: b.benefit_item || b.name || "Benefit",
              limit: b.coverage_limit || b.limit || "Covered",
              page: b.source_page || b.page || 1,
            }))
          );
        }
        if (detail.exclusions && detail.exclusions.length > 0) {
          setLiveExclusions(
            detail.exclusions.map((e: string | { title?: string; explanation?: string; clauseText?: string; page?: number }) => ({
              title: typeof e === "string" ? e : e.title || "Exclusion",
              explanation: typeof e === "string" ? e : e.explanation || "",
              clauseText: typeof e === "string" ? e : e.clauseText || "",
              page: typeof e === "object" ? e.page || 1 : 1,
            }))
          );
        }
      })
      .catch(() => {});

    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [isOpen, documentId, authToken, authHeaders]);

  const handleConfirmVerification = async () => {
    if (!documentId) return;
    setVerifying(true);
    try {
      const headers: Record<string, string> = { ...(authHeaders || {}) };
      if (authToken && !headers.Authorization) {
        headers.Authorization = `Bearer ${authToken}`;
      }
      headers["Content-Type"] = "application/json";
      await fetch(`${config.apiBaseUrl}/api/v1/account/documents/${documentId}/confirm`, {
        method: "POST",
        headers,
        body: JSON.stringify({ status: "VERIFIED" }),
      });
      setIsVerified(true);
      if (onVerify) onVerify();
    } catch {
      // Ignore network errors in demo mode
    } finally {
      setVerifying(false);
    }
  };

  if (!isOpen) return null;

  const totalPages = Math.max(pages.length, 3);
  const resolvedFileUrl = blobUrl || fileUrl || "/sample-documents/shenzhen_pingan_insurance_certificate.pdf";
  const currentPageText = pages.find((p) => p.page_no === currentPage)?.text;

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(15, 23, 42, 0.7)",
        backdropFilter: "blur(6px)",
        zIndex: 100,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 20,
      }}
      onClick={onClose}
    >
      <div
        style={{
          background: "#ffffff",
          borderRadius: 20,
          width: "100%",
          maxWidth: 1200,
          height: "90vh",
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
          boxShadow: "0 25px 60px rgba(0,0,0,0.25)",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Top Control Bar */}
        <div
          style={{
            padding: "12px 20px",
            background: "#ffffff",
            borderBottom: "1px solid #e2e8f0",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <div
              style={{
                width: 32,
                height: 32,
                borderRadius: 8,
                background: "#fee2e2",
                color: "#dc2626",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontWeight: 800,
                fontSize: 11,
              }}
            >
              PDF
            </div>
            <div>
              <div style={{ fontSize: 14, fontWeight: 750, color: "#0f172a" }}>
                {documentName}
              </div>
              <div style={{ fontSize: 11.5, color: "#64748b" }}>
                {documentType} &bull; Policy No. {policyNumber || "AIA-STU-2024-568923"}
              </div>
            </div>
            {isVerified ? (
              <span
                style={{
                  fontSize: 11,
                  fontWeight: 700,
                  padding: "2px 8px",
                  borderRadius: 6,
                  background: "#dcfce7",
                  color: "#15803d",
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 4,
                  marginLeft: 8,
                }}
              >
                <ShieldCheck size={12} /> Verified Document
              </span>
            ) : (
              <button
                type="button"
                onClick={() => void handleConfirmVerification()}
                disabled={verifying}
                style={{
                  fontSize: 11,
                  fontWeight: 700,
                  padding: "4px 10px",
                  borderRadius: 6,
                  background: "#0284c7",
                  color: "#ffffff",
                  border: "none",
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 4,
                  marginLeft: 8,
                  cursor: verifying ? "not-allowed" : "pointer",
                }}
              >
                <ShieldCheck size={12} /> {verifying ? "Verifying..." : "Confirm & Verify"}
              </button>
            )}
          </div>

          {/* Zoom and Page controls */}
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 4,
                background: "#f1f5f9",
                borderRadius: 8,
                padding: "3px 6px",
              }}
            >
              <button
                type="button"
                onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                disabled={currentPage <= 1}
                style={{
                  padding: 4,
                  background: "transparent",
                  border: "none",
                  cursor: currentPage <= 1 ? "default" : "pointer",
                  color: currentPage <= 1 ? "#cbd5e1" : "#475569",
                }}
              >
                <ChevronLeft size={16} />
              </button>
              <span style={{ fontSize: 12, fontWeight: 600, color: "#334155", padding: "0 6px" }}>
                Page {currentPage} of {totalPages}
              </span>
              <button
                type="button"
                onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                disabled={currentPage >= totalPages}
                style={{
                  padding: 4,
                  background: "transparent",
                  border: "none",
                  cursor: currentPage >= totalPages ? "default" : "pointer",
                  color: currentPage >= totalPages ? "#cbd5e1" : "#475569",
                }}
              >
                <ChevronRight size={16} />
              </button>
            </div>

            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 4,
                background: "#f1f5f9",
                borderRadius: 8,
                padding: "3px 6px",
              }}
            >
              <button
                type="button"
                onClick={() => setZoom((z) => Math.max(z - 15, 70))}
                style={{ padding: 4, background: "transparent", border: "none", cursor: "pointer", color: "#475569" }}
              >
                <ZoomOut size={16} />
              </button>
              <span style={{ fontSize: 12, fontWeight: 600, color: "#334155", width: 44, textAlign: "center" }}>
                {zoom}%
              </span>
              <button
                type="button"
                onClick={() => setZoom((z) => Math.min(z + 15, 150))}
                style={{ padding: 4, background: "transparent", border: "none", cursor: "pointer", color: "#475569" }}
              >
                <ZoomIn size={16} />
              </button>
            </div>

            {/* View Mode Toggle */}
            <div style={{ display: "flex", background: "#f1f5f9", borderRadius: 8, padding: 2 }}>
              <button
                type="button"
                onClick={() => setViewMode("pdf")}
                style={{
                  padding: "4px 8px",
                  fontSize: 11,
                  fontWeight: 600,
                  borderRadius: 6,
                  border: "none",
                  background: viewMode === "pdf" ? "#ffffff" : "transparent",
                  color: viewMode === "pdf" ? "#0f172a" : "#64748b",
                  boxShadow: viewMode === "pdf" ? "0 1px 2px rgba(0,0,0,0.06)" : "none",
                  cursor: "pointer",
                }}
              >
                PDF View
              </button>
              <button
                type="button"
                onClick={() => setViewMode("rendered")}
                style={{
                  padding: "4px 8px",
                  fontSize: 11,
                  fontWeight: 600,
                  borderRadius: 6,
                  border: "none",
                  background: viewMode === "rendered" ? "#ffffff" : "transparent",
                  color: viewMode === "rendered" ? "#0f172a" : "#64748b",
                  boxShadow: viewMode === "rendered" ? "0 1px 2px rgba(0,0,0,0.06)" : "none",
                  cursor: "pointer",
                }}
              >
                Text / OCR
              </button>
            </div>

            <button
              type="button"
              onClick={onClose}
              style={{
                padding: 6,
                background: "#f1f5f9",
                border: "none",
                borderRadius: 8,
                cursor: "pointer",
                color: "#64748b",
              }}
            >
              <X size={18} />
            </button>
          </div>
        </div>

        {/* Main Body: Two Columns (PDF Viewer on Left, Real Extracted Facts on Right) */}
        <div style={{ flex: 1, display: "grid", gridTemplateColumns: "1.4fr 1fr", overflow: "hidden" }}>
          {/* Left Column: Document Canvas / PDF Viewer */}
          <div
            style={{
              background: "#64748b15",
              overflow: "auto",
              padding: 24,
              display: "flex",
              justifyContent: "center",
              alignItems: "flex-start",
              borderRight: "1px solid #e2e8f0",
            }}
          >
            <div
              style={{
                transform: `scale(${zoom / 100})`,
                transformOrigin: "top center",
                transition: "transform 0.15s ease",
                width: 580,
                minHeight: 760,
                background: "#ffffff",
                boxShadow: "0 8px 30px rgba(0,0,0,0.12)",
                borderRadius: 12,
                overflow: "hidden",
                border: "1px solid #cbd5e1",
              }}
            >
              {loadingFile ? (
                <div style={{ height: 760, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", color: "#64748b" }}>
                  <FileText size={36} style={{ marginBottom: 12, color: "#0284c7" }} />
                  <div style={{ fontSize: 14, fontWeight: 600 }}>Loading policy document...</div>
                </div>
              ) : viewMode === "pdf" && resolvedFileUrl ? (
                <iframe
                  src={`${resolvedFileUrl}#page=${currentPage}&toolbar=0&navpanes=0`}
                  style={{ width: "100%", height: 760, border: "none" }}
                  title="PDF Preview"
                />
              ) : (
                /* High-Fidelity Rendered Document Page */
                <div style={{ padding: "36px 40px", color: "#1e293b", fontFamily: "sans-serif" }}>
                  {/* Official Insurer Header */}
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "flex-start",
                      paddingBottom: 16,
                      borderBottom: "2px solid #e2e8f0",
                    }}
                  >
                    <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                      <div
                        style={{
                          width: 48,
                          height: 48,
                          borderRadius: "50%",
                          background: "#dc2626",
                          color: "#ffffff",
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          fontWeight: 900,
                          fontSize: 18,
                        }}
                      >
                        AIA
                      </div>
                      <div>
                        <h2 style={{ margin: 0, fontSize: 16, fontWeight: 800, color: "#0f172a" }}>
                          {planName}
                        </h2>
                        <div style={{ fontSize: 12, color: "#64748b" }}>AIA 国际学生健康保险计划</div>
                      </div>
                    </div>

                    <div style={{ textAlign: "right" }}>
                      <div style={{ fontSize: 12, fontWeight: 800, color: "#dc2626" }}>
                        OFFICIAL SCHEDULE
                      </div>
                      <div style={{ fontSize: 11, color: "#64748b" }}>Page {currentPage} of {totalPages}</div>
                    </div>
                  </div>

                  {/* Document Page Content */}
                  {currentPageText ? (
                    <div style={{ marginTop: 20, whiteSpace: "pre-wrap", fontSize: 12.5, lineHeight: 1.6, color: "#334155" }}>
                      {currentPageText}
                    </div>
                  ) : (
                    <div style={{ marginTop: 24 }}>
                      <div
                        style={{
                          background: "#f8fafc",
                          border: "1px solid #e2e8f0",
                          borderRadius: 10,
                          padding: 14,
                          marginBottom: 20,
                        }}
                      >
                        <div style={{ fontSize: 12, fontWeight: 700, color: "#0284c7", marginBottom: 8, textTransform: "uppercase" }}>
                          Policyholder Particulars
                        </div>
                        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, fontSize: 12 }}>
                          <div>
                            <span style={{ color: "#64748b" }}>Policyholder:</span>{" "}
                            <strong>{policyholder}</strong>
                          </div>
                          <div>
                            <span style={{ color: "#64748b" }}>Policy Number:</span>{" "}
                            <strong>{policyNumber || "AIA-STU-2024-568923"}</strong>
                          </div>
                          <div>
                            <span style={{ color: "#64748b" }}>Effective From:</span>{" "}
                            <strong>{coverageStart}</strong>
                          </div>
                          <div>
                            <span style={{ color: "#64748b" }}>Expiry Date:</span>{" "}
                            <strong>{coverageEnd}</strong>
                          </div>
                        </div>
                      </div>

                      {/* Section 4. Exclusions & Limitations */}
                      <div style={{ marginBottom: 20 }}>
                        <div style={{ fontSize: 13, fontWeight: 750, color: "#0f172a", marginBottom: 8 }}>
                          Section 4: Key Benefits & Deductibles
                        </div>
                        <table style={{ width: "100%", fontSize: 12, borderCollapse: "collapse" }}>
                          <thead>
                            <tr style={{ background: "#f1f5f9", textAlign: "left" }}>
                              <th style={{ padding: "8px 10px", borderBottom: "1px solid #cbd5e1" }}>Benefit Item</th>
                              <th style={{ padding: "8px 10px", borderBottom: "1px solid #cbd5e1" }}>Maximum Limit</th>
                              <th style={{ padding: "8px 10px", borderBottom: "1px solid #cbd5e1" }}>Deductible</th>
                            </tr>
                          </thead>
                          <tbody>
                            <tr>
                              <td style={{ padding: "8px 10px", borderBottom: "1px solid #f1f5f9" }}>Inpatient Medical Care</td>
                              <td style={{ padding: "8px 10px", borderBottom: "1px solid #f1f5f9", fontWeight: 700 }}>RMB 1,000,000</td>
                              <td style={{ padding: "8px 10px", borderBottom: "1px solid #f1f5f9" }}>RMB 0</td>
                            </tr>
                            <tr>
                              <td style={{ padding: "8px 10px", borderBottom: "1px solid #f1f5f9" }}>Outpatient Specialty Care</td>
                              <td style={{ padding: "8px 10px", borderBottom: "1px solid #f1f5f9", fontWeight: 700 }}>RMB 200,000</td>
                              <td style={{ padding: "8px 10px", borderBottom: "1px solid #f1f5f9" }}>10% Copay</td>
                            </tr>
                            <tr>
                              <td style={{ padding: "8px 10px", borderBottom: "1px solid #f1f5f9" }}>Emergency Evacuation</td>
                              <td style={{ padding: "8px 10px", borderBottom: "1px solid #f1f5f9", fontWeight: 700 }}>RMB 500,000</td>
                              <td style={{ padding: "8px 10px", borderBottom: "1px solid #f1f5f9" }}>RMB 0</td>
                            </tr>
                          </tbody>
                        </table>
                      </div>

                      {/* Exclusions highlight */}
                      <div
                        style={{
                          background: "#fffbeb",
                          border: "1px solid #fef08a",
                          borderRadius: 10,
                          padding: 14,
                        }}
                      >
                        <div style={{ fontSize: 12, fontWeight: 750, color: "#854d0e", marginBottom: 6 }}>
                          Section 7.3: Exclusions & Waiting Period Clauses
                        </div>
                        <p style={{ margin: 0, fontSize: 11.5, color: "#713f12", lineHeight: 1.5 }}>
                          &ldquo;Pre-existing conditions manifesting prior to policy commencement require twelve (12) consecutive months of continuous active policy tenure before reimbursement benefits apply. Routine, aesthetic, or cosmetic dental care is excluded.&rdquo;
                        </p>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* Right Column: Real Extracted Data & Clause Citations */}
          <div style={{ background: "#ffffff", display: "flex", flexDirection: "column", overflow: "hidden" }}>
            {/* Header Tabs */}
            <div style={{ display: "flex", borderBottom: "1px solid #e2e8f0", padding: "0 18px" }}>
              <button
                type="button"
                onClick={() => setActiveTab("extracted")}
                style={{
                  padding: "12px 16px",
                  fontSize: 13,
                  fontWeight: 700,
                  color: activeTab === "extracted" ? "#0284c7" : "#64748b",
                  borderBottom: activeTab === "extracted" ? "2px solid #0284c7" : "2px solid transparent",
                  background: "transparent",
                  border: "none",
                  cursor: "pointer",
                }}
              >
                Extracted Facts ({liveBenefits.length || 5})
              </button>
              <button
                type="button"
                onClick={() => setActiveTab("clauses")}
                style={{
                  padding: "12px 16px",
                  fontSize: 13,
                  fontWeight: 700,
                  color: activeTab === "clauses" ? "#0284c7" : "#64748b",
                  borderBottom: activeTab === "clauses" ? "2px solid #0284c7" : "2px solid transparent",
                  background: "transparent",
                  border: "none",
                  cursor: "pointer",
                }}
              >
                Supporting Clauses ({liveExclusions.length || 3})
              </button>
            </div>

            {/* Content Area */}
            <div style={{ flex: 1, overflowY: "auto", padding: 20 }}>
              {activeTab === "extracted" ? (
                <div>
                  <div style={{ marginBottom: 18 }}>
                    <div style={{ fontSize: 11, fontWeight: 700, color: "#64748b", textTransform: "uppercase", marginBottom: 8 }}>
                      Document Metadata
                    </div>
                    <div style={{ background: "#f8fafc", borderRadius: 10, padding: 12, border: "1px solid #e2e8f0", fontSize: 12.5 }}>
                      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
                        <span style={{ color: "#64748b" }}>Provider:</span>
                        <strong style={{ color: "#0f172a" }}>{insurer}</strong>
                      </div>
                      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
                        <span style={{ color: "#64748b" }}>Plan Name:</span>
                        <strong style={{ color: "#0f172a" }}>{planName}</strong>
                      </div>
                      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
                        <span style={{ color: "#64748b" }}>Policy Number:</span>
                        <strong style={{ color: "#0f172a" }}>{policyNumber || "AIA-STU-2024-568923"}</strong>
                      </div>
                      <div style={{ display: "flex", justifyContent: "space-between" }}>
                        <span style={{ color: "#64748b" }}>Validity Period:</span>
                        <strong style={{ color: "#0f172a" }}>{coverageStart} &ndash; {coverageEnd}</strong>
                      </div>
                    </div>
                  </div>

                  <div>
                    <div style={{ fontSize: 11, fontWeight: 700, color: "#64748b", textTransform: "uppercase", marginBottom: 8 }}>
                      Extracted Benefits & Limits
                    </div>
                    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                      {(liveBenefits.length > 0
                        ? liveBenefits
                        : [
                            { name: "Inpatient treatment", limit: "Up to RMB 1,000,000", page: 3 },
                            { name: "Outpatient treatment", limit: "Up to RMB 200,000", page: 4 },
                            { name: "Emergency medical evacuation", limit: "Up to RMB 500,000", page: 6 },
                            { name: "Dental emergency treatment", limit: "Up to RMB 10,000", page: 7 },
                            { name: "Repatriation of remains", limit: "Up to RMB 200,000", page: 9 },
                          ]
                      ).map((b, idx) => (
                        <div
                          key={idx}
                          style={{
                            padding: "10px 12px",
                            background: "#ffffff",
                            border: "1px solid #e2e8f0",
                            borderRadius: 10,
                            display: "flex",
                            justifyContent: "space-between",
                            alignItems: "center",
                          }}
                        >
                          <div>
                            <div style={{ fontSize: 13, fontWeight: 650, color: "#0f172a" }}>{b.name}</div>
                            <div style={{ fontSize: 11, color: "#0284c7" }}>Cited on Page {b.page || 1}</div>
                          </div>
                          <strong style={{ fontSize: 13, color: "#16a34a" }}>{b.limit}</strong>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                  {(liveExclusions.length > 0
                    ? liveExclusions
                    : [
                        {
                          title: "Pre-Existing Conditions Waiting Period",
                          explanation: "12 consecutive months of continuous coverage required before pre-existing conditions are covered.",
                          page: 4,
                          clauseText: "Pre-existing conditions, illnesses or bodily injuries manifesting prior to commencement date shall not be covered until 365 consecutive days of continuous active policy tenure.",
                        },
                        {
                          title: "Cosmetic & Routine Dental Exclusion",
                          explanation: "Routine checkups, teeth cleaning, and cosmetic procedures are excluded.",
                          page: 7,
                          clauseText: "Dental treatments including orthodontic corrections, veneers, and preventative cleanings are excluded from reimbursement.",
                        },
                        {
                          title: "Host Country Territorial Limitation",
                          explanation: "Medical care outside Mainland China requires pre-authorization.",
                          page: 11,
                          clauseText: "Medical treatments rendered outside Mainland China shall not be reimbursable under student plan terms.",
                        },
                      ]
                  ).map((item, idx) => (
                    <div
                      key={idx}
                      style={{
                        padding: 14,
                        background: "#f8fafc",
                        border: "1px solid #e2e8f0",
                        borderRadius: 12,
                        cursor: "pointer",
                      }}
                      onClick={() => setCurrentPage(item.page || 1)}
                    >
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
                        <strong style={{ fontSize: 13, color: "#991b1b" }}>{item.title}</strong>
                        <span style={{ fontSize: 11, color: "#0284c7", fontWeight: 700 }}>
                          Jump to Page {item.page || 1} &rarr;
                        </span>
                      </div>
                      <p style={{ margin: "0 0 8px", fontSize: 12, color: "#475569", lineHeight: 1.45 }}>
                        {item.explanation}
                      </p>
                      {item.clauseText && (
                        <div
                          style={{
                            padding: "6px 10px",
                            background: "#ffffff",
                            borderLeft: "2px solid #0284c7",
                            borderRadius: "0 6px 6px 0",
                            fontSize: 11.5,
                            color: "#334155",
                            fontStyle: "italic",
                          }}
                        >
                          &ldquo;{item.clauseText}&rdquo;
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Bottom Footer Action */}
            <div
              style={{
                padding: "12px 20px",
                borderTop: "1px solid #e2e8f0",
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                background: "#f8fafc",
              }}
            >
              <div style={{ fontSize: 12, color: "#64748b" }}>
                Grounded Fact Extraction &bull; Inssura Policy Intelligence
              </div>
              <button
                type="button"
                onClick={onClose}
                style={{
                  padding: "8px 18px",
                  borderRadius: 8,
                  background: "#0284c7",
                  color: "#ffffff",
                  fontSize: 13,
                  fontWeight: 650,
                  border: "none",
                  cursor: "pointer",
                }}
              >
                Close Preview
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
