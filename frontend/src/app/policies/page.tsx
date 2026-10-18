"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import {
  Calendar,
  ChevronRight,
  Clock,
  FileText,
  HelpCircle,
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
  evidenceStatus: "Self-Reported" | "Document Uploaded" | "Extracted" | "Source Verified";
}

export default function PoliciesPage() {
  const { token } = useAuth();
  const userCtx = useUserContext();

  const [policies, setPolicies] = useState<PolicySummary[]>([]);
  const [activeTab, setActiveTab] = useState<"ALL" | "SELF_REPORTED" | "EMPLOYER">("ALL");
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState<string>("0");
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

  // Construct policies based on actual state and onboarding declarations
  const declaredList = userCtx.declaredCoverages || [];
  const countryName = userCtx.residenceCountry || "China";
  const city = userCtx.residenceCity || "Shenzhen";

  const allDisplayPolicies: DisplayPolicy[] = policies.length > 0
    ? policies.map((p) => ({
        id: p.id,
        provider: p.provider || "Insurance Provider",
        title: p.kind ? p.kind.replaceAll("_", " ") : "Medical Policy",
        category: p.kind || "Health",
        tags: [p.kind || "Health", countryName],
        status: p.status === "ACTIVE" ? "ACTIVE" : "SELF_REPORTED",
        statusLabel: p.status === "ACTIVE" ? "Verified Active" : "Self-Reported",
        dateRange: p.end_date ? `Valid until ${p.end_date}` : "Verification pending",
        policyNumber: p.policy_number_masked || "Masked for privacy",
        planType: "Policy Record",
        region: `${countryName} (${city})`,
        logoBadge: "generic",
        isEmployer: p.kind?.includes("EMPLOYER") ?? false,
        evidenceStatus: p.status === "ACTIVE" ? "Source Verified" : "Self-Reported",
      }))
    : declaredList.map((cov, idx) => ({
        id: String(idx),
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

  const filtered = allDisplayPolicies.filter((p) => {
    if (activeTab === "SELF_REPORTED" && p.status !== "SELF_REPORTED") return false;
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

  return (
    <div className="figma-page-shell">
      {/* ---------------- Breadcrumb Navigation ---------------- */}
      <nav aria-label="Breadcrumb" className="figma-breadcrumb">
        <Link href="/protection">My Protection</Link>
        <span className="figma-breadcrumb-separator">/</span>
        <strong>Policy Wallet</strong>
      </nav>

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
          Self-Reported ({allDisplayPolicies.filter((p) => p.status === "SELF_REPORTED").length})
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
                <strong>Self-reported insurance declaration:</strong> This policy was entered during onboarding.
                Specific benefits, hospital coverage networks, and deductible thresholds will be verified once
                your policy certificate or booklet is uploaded in <strong>Documents</strong>.
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
                    <div style={{ width: 10, height: 10, borderRadius: "50%", background: "#d97706" }} />
                    <span>Evidence pending: Upload document to enable AI policy extraction.</span>
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
                <div style={{ padding: "20px 0", textAlign: "center", color: "#64748b" }}>
                  <HelpCircle size={32} color="#cbd5e1" style={{ margin: "0 auto 8px" }} />
                  <h4 style={{ margin: 0, fontSize: 14, fontWeight: 700, color: "#334155" }}>
                    Benefits Awaiting Document Verification
                  </h4>
                  <p style={{ margin: "4px 0 16px", fontSize: 12.5 }}>
                    INSURRA does not fabricate policy benefits or monetary limits. Upload your official policy
                    wording to display verified room rates, outpatient limits, and surgical coverage.
                  </p>
                  <Link
                    href="/documents"
                    className="figma-btn-primary"
                    style={{ textDecoration: "none", display: "inline-flex", alignItems: "center", gap: 8, fontSize: 13 }}
                  >
                    <Upload size={14} />
                    <span>Upload Policy Document</span>
                  </Link>
                </div>
              </div>
            )}

            {/* Tab: Coverage Details */}
            {detailTab === "Coverage Details" && (
              <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                <div className="figma-meta-grid">
                  <div className="figma-meta-item">
                    <span className="figma-meta-label">Hospital Network</span>
                    <strong className="figma-meta-value">
                      {countryName === "China"
                        ? "Public secondary and tertiary hospitals (二级及以上公立医院)"
                        : countryName === "Indonesia"
                        ? "BPJS FKTP / FKRTL & Network Hospitals"
                        : "Australian hospital network"}
                    </strong>
                  </div>
                  <div className="figma-meta-item">
                    <span className="figma-meta-label">Deductibles & Excess</span>
                    <strong className="figma-meta-value">
                      {countryName === "China"
                        ? "Subject to scheme threshold (typically RMB 650 outpatient)"
                        : "Pending document evidence"}
                    </strong>
                  </div>
                </div>
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
                  <h4 style={{ margin: 0, fontSize: 13.5, fontWeight: 700, color: "#1e293b" }}>
                    No Document Linked Yet
                  </h4>
                  <p style={{ margin: "4px 0 14px", fontSize: 12, color: "#64748b" }}>
                    Upload an insurance certificate or PDF policy to link evidence.
                  </p>
                  <Link
                    href="/documents"
                    className="figma-btn-primary"
                    style={{ textDecoration: "none", display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12.5 }}
                  >
                    <Upload size={14} />
                    <span>Upload Document</span>
                  </Link>
                </div>
              </div>
            )}
          </div>
        ) : null}
      </div>
    </div>
  );
}
