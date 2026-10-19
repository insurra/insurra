"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import {
  Calendar,
  ChevronRight,
  Clock,
  FileText,
  Info,
  Plus,
  Search,
  Upload,
} from "lucide-react";
import { api } from "@/lib/api/client";
import type { components } from "@/lib/api/types.gen";
import { useAuth } from "@/lib/auth";
import { useUserContext } from "@/lib/user-context";

type PolicySummary = components["schemas"]["AccountPolicySummary"];
type PolicyDetail = components["schemas"]["AccountPolicyDetail"];

interface DisplayPolicy {
  id: string;
  provider: string;
  title: string;
  category: string;
  tags: string[];
  status: "ACTIVE" | "EXPIRING_SOON" | "SELF_REPORTED";
  statusLabel: string;
  dateRange: string;
  policyNumber: string;
  planType: string;
  region: string;
  logoBadge: string;
  isEmployer: boolean;
  evidenceStatus: "Self-Reported" | "Needs Review" | "Verified";
}

export default function PoliciesPage() {
  const { token } = useAuth();
  const userCtx = useUserContext();

  const [policies, setPolicies] = useState<PolicySummary[]>([]);
  const [policyDetail, setPolicyDetail] = useState<PolicyDetail | null>(null);
  const [activeTab, setActiveTab] = useState<"ALL" | "SELF_REPORTED" | "EMPLOYER">("ALL");
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState<string>("");
  const [detailTab, setDetailTab] = useState<"Overview" | "Benefits" | "Coverage Details" | "Documents">("Overview");

  const refreshPolicies = useCallback(async () => {
    if (!token) return;
    try {
      const list = await api.request("get", "/api/v1/account/policies", {
        headers: { Authorization: `Bearer ${token}` },
      });
      setPolicies(list);
    } catch {
      // Handled gracefully
    }
  }, [token]);

  useEffect(() => {
    void Promise.resolve().then(refreshPolicies);
  }, [refreshPolicies]);

  // Keep extracted records and user declarations distinct in the wallet.
  const declaredList = userCtx.declaredCoverages || [];
  const countryName = userCtx.residenceCountry || userCtx.countryCode || "Selected country";
  const city = userCtx.residenceCity || "Location not provided";

  const extractedPolicies: DisplayPolicy[] = policies.map((p) => ({
        id: p.id,
        provider: p.provider || "Provider not identified",
        title: p.kind ? p.kind.replaceAll("_", " ") : "Medical Policy",
        category: p.kind || "Health",
        tags: [p.kind || "Health", p.country_code],
        status: p.status === "ACTIVE" ? "ACTIVE" : p.status === "EXPIRING_SOON" ? "EXPIRING_SOON" : "SELF_REPORTED",
        statusLabel: p.evidence_status === "VERIFIED" ? "Verified" : p.evidence_status === "NEEDS_REVIEW" ? "Needs Review" : "Self-Reported",
        dateRange: p.start_date && p.end_date ? `${p.start_date} – ${p.end_date}` : p.end_date ? `End date: ${p.end_date}` : "Coverage dates unavailable",
        policyNumber: p.policy_number_masked || "Not provided",
        planType: "Policy Record",
        region: p.country_code,
        logoBadge: "generic",
        isEmployer: p.kind?.includes("EMPLOYER") ?? false,
        evidenceStatus: p.evidence_status === "VERIFIED" ? "Verified" : p.evidence_status === "NEEDS_REVIEW" ? "Needs Review" : "Self-Reported",
      }));
  const declaredPolicies: DisplayPolicy[] = declaredList.map((cov, idx) => ({
        id: `declared-${idx}`,
        provider: cov.provider || cov.category,
        title: cov.label || cov.category,
        category: cov.category,
        tags: [cov.category, countryName, "Self-Reported"],
        status: "SELF_REPORTED",
        statusLabel: "Self-Reported",
        dateRange: userCtx.segmentDetails?.studyPeriod
          ? `Expected period: ${userCtx.segmentDetails.studyPeriod}`
          : "Dates pending document upload",
        policyNumber: "Pending document upload",
        planType: cov.policyName || cov.category,
        region: `${countryName} (${city})`,
        logoBadge: cov.provider?.toLowerCase().includes("ping")
          ? "pingan"
          : cov.provider?.toLowerCase().includes("bpjs")
          ? "bpjs"
          : "generic",
        isEmployer: cov.category.toLowerCase().includes("employer") || cov.category.toLowerCase().includes("group"),
        evidenceStatus: "Self-Reported",
      }));
  const allDisplayPolicies = [...extractedPolicies, ...declaredPolicies];

  const filtered = allDisplayPolicies.filter((p) => {
    if (activeTab === "SELF_REPORTED" && p.evidenceStatus !== "Self-Reported") return false;
    if (activeTab === "EMPLOYER" && !p.isEmployer) return false;
    if (query.trim()) {
      const q = query.toLowerCase();
      return (
        p.title.toLowerCase().includes(q) ||
        p.provider.toLowerCase().includes(q) ||
        p.category.toLowerCase().includes(q)
      );
    }
    return true;
  });

  const selectedPolicy =
    filtered.find((p) => p.id === selectedId) || filtered[0] || allDisplayPolicies[0];
  const selectedPolicyId = selectedPolicy?.id;
  const selectedPolicyIsPersisted = policies.some((policy) => policy.id === selectedPolicyId);
  const activePolicyDetail = policyDetail?.id === selectedPolicy?.id ? policyDetail : null;

  useEffect(() => {
    if (!token || !selectedPolicyId || !selectedPolicyIsPersisted) {
      return;
    }
    let active = true;
    api
      .request("get", "/api/v1/account/policies/{policy_id}", {
        params: { policy_id: selectedPolicyId },
        headers: { Authorization: `Bearer ${token}` },
      })
      .then((detail) => {
        if (active) setPolicyDetail(detail);
      })
      .catch(() => {
        if (active) setPolicyDetail(null);
      });
    return () => {
      active = false;
    };
  }, [token, selectedPolicyId, selectedPolicyIsPersisted]);

  return (
    <div className="figma-page-shell">
      {/* ---------------- Page Header ---------------- */}
      <header className="figma-page-header">
        <div>
          <h1>Policy Wallet</h1>
          <p>
            Manage and view declared and verified insurance policies in{" "}
            <strong>
              {userCtx.countryFlag} {city}, {countryName}
            </strong>
            .
          </p>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <div className="figma-search-input-wrap">
            <Search size={16} />
            <input
              type="text"
              className="figma-search-input"
              placeholder="Search policy name, provider, or category..."
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>

          <Link
            href="/documents"
            className="figma-btn-primary"
            style={{ textDecoration: "none", display: "inline-flex", alignItems: "center", gap: 8 }}
          >
            <Upload size={16} />
            <span>Upload Document</span>
          </Link>
        </div>
      </header>

      {/* ---------------- Filter Tabs ---------------- */}
      <div className="figma-tabs-bar">
        <button
          type="button"
          className={`figma-tab-btn ${activeTab === "ALL" ? "active" : ""}`}
          onClick={() => setActiveTab("ALL")}
        >
          All Policies ({allDisplayPolicies.length})
        </button>
        <button
          type="button"
          className={`figma-tab-btn ${activeTab === "SELF_REPORTED" ? "active" : ""}`}
          onClick={() => setActiveTab("SELF_REPORTED")}
        >
          Self-Reported ({allDisplayPolicies.filter((p) => p.evidenceStatus === "Self-Reported").length})
        </button>
        <button
          type="button"
          className={`figma-tab-btn ${activeTab === "EMPLOYER" ? "active" : ""}`}
          onClick={() => setActiveTab("EMPLOYER")}
        >
          Employer / Group ({allDisplayPolicies.filter((p) => p.isEmployer).length})
        </button>
      </div>

      {/* ---------------- Main Wallet Grid (2 columns) ---------------- */}
      <div className="figma-wallet-grid">
        {/* Left Column: Policies List */}
        <div className="figma-policy-list">
          {filtered.map((policy) => {
            const isSelected = selectedPolicy && policy.id === selectedPolicy.id;
            return (
              <div
                key={policy.id}
                className={`figma-policy-card ${isSelected ? "selected" : ""}`}
                onClick={() => setSelectedId(policy.id)}
                role="button"
                tabIndex={0}
              >
                <div className="figma-policy-card-top">
                  <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
                    <div className="figma-provider-logo-badge generic">
                      {policy.provider.slice(0, 3).toUpperCase()}
                    </div>
                    <div>
                      <h3 style={{ fontSize: 15, fontWeight: 750, color: "#0f1d38", margin: "0 0 3px" }}>
                        {policy.title}
                      </h3>
                      <span style={{ fontSize: 12.5, color: "#64748b" }}>{policy.provider}</span>
                    </div>
                  </div>

                  <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    <span className="figma-hub-card-pill neutral">
                      <Clock size={12} /> {policy.statusLabel}
                    </span>
                    <ChevronRight size={18} color="#94a3b8" />
                  </div>
                </div>

                <div className="figma-tag-row">
                  {policy.tags.map((tag, idx) => (
                    <span key={idx} className="figma-tag">
                      {tag}
                    </span>
                  ))}
                </div>

                <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: "#64748b", marginTop: 4 }}>
                  <Calendar size={13} color="#94a3b8" />
                  <span>{policy.dateRange}</span>
                </div>
              </div>
            );
          })}

          {/* Add Another Policy Card */}
          <Link
            href="/documents"
            className="figma-policy-card"
            style={{ borderStyle: "dashed", background: "#fcfdfd", textDecoration: "none" }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
              <div
                style={{
                  width: 40,
                  height: 40,
                  borderRadius: "50%",
                  background: "#eaf8f4",
                  color: "#0ea58a",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <Plus size={20} />
              </div>
              <div style={{ flex: 1 }}>
                <strong style={{ display: "block", fontSize: 14, fontWeight: 750, color: "#0f1d38" }}>
                  Add Another Policy Document
                </strong>
                <span style={{ fontSize: 12, color: "#64748b" }}>
                  Upload your insurance certificate to extract and verify benefits.
                </span>
              </div>
              <ChevronRight size={18} color="#94a3b8" />
            </div>
          </Link>
        </div>

        {/* Right Column: Policy Detail Panel */}
        {selectedPolicy ? (
          <div className="figma-policy-detail">
            <div className="figma-policy-detail-header">
              <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
                <div className="figma-provider-logo-badge large generic">
                  {selectedPolicy.provider.slice(0, 3).toUpperCase()}
                </div>
                <div>
                  <h2>{selectedPolicy.title}</h2>
                  <span style={{ fontSize: 13, color: "#64748b" }}>{selectedPolicy.provider}</span>
                </div>
              </div>

              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <span className="figma-hub-card-pill neutral">
                  <Clock size={12} /> {selectedPolicy.evidenceStatus}
                </span>
              </div>
            </div>

            {/* Unverified Policy Caution Box */}
            <div
              style={{
                background: "#f8fafc",
                border: "1px dashed #cbd5e1",
                borderRadius: 12,
                padding: "14px 16px",
                display: "flex",
                alignItems: "flex-start",
                gap: 12,
                margin: "16px 0",
              }}
            >
              <Info size={18} color="#0ea58a" style={{ flexShrink: 0, marginTop: 2 }} />
              <div style={{ fontSize: 12.5, color: "#475569", lineHeight: 1.5 }}>
                <strong>{selectedPolicy.evidenceStatus}:</strong> Evidence status is shown separately from the date-based policy status.
                Benefits, limits, exclusions, and product version appear only when they are present in the linked policy evidence.
              </div>
            </div>

            {/* Sub-tabs inside policy detail */}
            <div className="figma-detail-subtabs">
              {(["Overview", "Benefits", "Coverage Details", "Documents"] as const).map((tab) => (
                <button
                  key={tab}
                  type="button"
                  className={`figma-detail-tab-btn ${detailTab === tab ? "active" : ""}`}
                  onClick={() => setDetailTab(tab)}
                >
                  {tab}
                </button>
              ))}
            </div>

            {/* Tab: Overview */}
            {detailTab === "Overview" && (
              <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
                <div className="figma-meta-grid">
                  <div className="figma-meta-item">
                    <span className="figma-meta-label">Plan Category</span>
                    <strong className="figma-meta-value">{selectedPolicy.category}</strong>
                  </div>
                  <div className="figma-meta-item">
                    <span className="figma-meta-label">Jurisdiction</span>
                    <strong className="figma-meta-value">{selectedPolicy.region}</strong>
                  </div>
                  <div className="figma-meta-item">
                    <span className="figma-meta-label">Policy / Certificate ID</span>
                    <strong className="figma-meta-value">{selectedPolicy.policyNumber}</strong>
                  </div>
                  <div className="figma-meta-item">
                    <span className="figma-meta-label">Coverage Period</span>
                    <strong className="figma-meta-value">{selectedPolicy.dateRange}</strong>
                  </div>
                </div>

                <div style={{ borderTop: "1px solid #f1f5f9", paddingTop: 18 }}>
                  <h4 style={{ margin: "0 0 10px", fontSize: 13.5, fontWeight: 750, color: "#0f1d38" }}>
                    Evidence & Verification Status
                  </h4>
                  <div style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 13, color: "#64748b" }}>
                    <div style={{ width: 10, height: 10, borderRadius: "50%", background: selectedPolicy.evidenceStatus === "Verified" ? "#059669" : "#d97706" }} />
                    <span>{selectedPolicy.evidenceStatus}{activePolicyDetail?.document_id ? ` · linked document ${activePolicyDetail.document_id}` : " · no linked source document"}</span>
                  </div>
                  <div style={{ marginTop: 14 }}>
                    <Link
                      href="/documents"
                      className="figma-btn-primary"
                      style={{ textDecoration: "none", display: "inline-flex", alignItems: "center", gap: 8, fontSize: 13 }}
                    >
                      <Upload size={14} />
                      <span>Upload Certificate to Verify</span>
                    </Link>
                  </div>
                </div>
              </div>
            )}

            {/* Tab: Benefits */}
            {detailTab === "Benefits" && (
              <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                <h4 style={{ margin: 0, color: "#0f1d38" }}>Benefits and limits</h4>
                {(activePolicyDetail?.benefits ?? []).length ? (activePolicyDetail?.benefits ?? []).map((benefit, index) => (
                  <div key={`${String(benefit.field_key)}-${index}`} className="figma-meta-item">
                    <span className="figma-meta-label">{String(benefit.field_key).replaceAll("_", " ")}</span>
                    <strong className="figma-meta-value">{JSON.stringify(benefit.value)}</strong>
                    {typeof benefit.source_page === "number" && <span className="figma-meta-label">Source: page {benefit.source_page}</span>}
                  </div>
                )) : <p style={{ margin: 0, color: "#64748b", fontSize: 13 }}>No benefit or limit data is available in the linked evidence.</p>}
                <p style={{ margin: 0, color: "#64748b", fontSize: 12 }}>Product version: Not available in the current record.</p>
                {activePolicyDetail?.document_id && <Link href={`/documents/${activePolicyDetail.document_id}`} className="figma-btn-primary" style={{ textDecoration: "none", width: "fit-content" }}><FileText size={14} /> Review source document</Link>}
              </div>
            )}

            {/* Tab: Coverage Details */}
            {detailTab === "Coverage Details" && (
              <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                <h4 style={{ margin: 0, color: "#0f1d38" }}>Exclusions</h4>
                {(activePolicyDetail?.exclusions ?? []).length ? (activePolicyDetail?.exclusions ?? []).map((exclusion, index) => <p key={`${exclusion}-${index}`} style={{ margin: 0, color: "#334155" }}>{exclusion}</p>) : <p style={{ margin: 0, color: "#64748b", fontSize: 13 }}>No exclusion data is available in the linked evidence.</p>}
                <p style={{ margin: 0, color: "#64748b", fontSize: 12 }}>Uncertainties: Not specified in the current record. Source pages: {activePolicyDetail?.source_pages?.length ? activePolicyDetail.source_pages.join(", ") : "Not available"}.</p>
                {activePolicyDetail?.document_id && <Link href={`/documents/${activePolicyDetail.document_id}`} className="figma-btn-primary" style={{ textDecoration: "none", width: "fit-content" }}><FileText size={14} /> Review source citations</Link>}
              </div>
            )}

            {/* Tab: Documents */}
            {detailTab === "Documents" && (
              <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                <p style={{ fontSize: 13, color: "#64748b", margin: 0 }}>
                  Associated insurance certificates and evidence files for this policy:
                </p>
                <div
                  style={{
                    border: "1px dashed #cbd5e1",
                    borderRadius: 12,
                    padding: 24,
                    textAlign: "center",
                    background: "#fcfdfd",
                  }}
                >
                  <FileText size={28} color="#94a3b8" style={{ margin: "0 auto 8px" }} />
                  {activePolicyDetail?.document_id ? (
                    <>
                      <h4 style={{ margin: 0, fontSize: 13.5, fontWeight: 700, color: "#1e293b" }}>Linked source document</h4>
                      <p style={{ margin: "4px 0 14px", fontSize: 12, color: "#64748b" }}>Document ID: {activePolicyDetail.document_id}</p>
                      <Link href={`/documents/${activePolicyDetail.document_id}`} className="figma-btn-primary" style={{ textDecoration: "none", display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12.5 }}><FileText size={14} /> Review document and evidence</Link>
                    </>
                  ) : (
                    <>
                      <h4 style={{ margin: 0, fontSize: 13.5, fontWeight: 700, color: "#1e293b" }}>No source document linked</h4>
                      <p style={{ margin: "4px 0 14px", fontSize: 12, color: "#64748b" }}>Upload a policy document to associate source evidence with this record.</p>
                      <Link href="/documents" className="figma-btn-primary" style={{ textDecoration: "none", display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12.5 }}><Upload size={14} /> Upload document</Link>
                    </>
                  )}
                </div>
              </div>
            )}
          </div>
        ) : null}
      </div>
    </div>
  );
}
