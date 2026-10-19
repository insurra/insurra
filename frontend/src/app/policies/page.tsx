"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Calendar,
  CheckCircle2,
  ChevronRight,
  Clock,
  ExternalLink,
  FileText,
  Info,
  Plus,
  Search,
  ShieldAlert,
  ShieldCheck,
  Upload,
} from "lucide-react";
import { api } from "@/lib/api/client";
import type { components } from "@/lib/api/types.gen";
import { useActor } from "@/lib/actor";
import { useSession } from "@/lib/session";
import { useUserContext } from "@/lib/user-context";
import { getInsurerBrand } from "@/lib/insurer-logos";
import { matchScrapedProduct, type ScrapedProduct } from "@/lib/kb-products-data";

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
  isEmployer: boolean;
  evidenceStatus: "Self-Reported" | "Needs Review" | "Verified";
  sourceDocId?: string;
}

export default function PoliciesPage() {
  const { mode, headers } = useActor();
  const { data: demoSession } = useSession();
  const userCtx = useUserContext();

  const [policies, setPolicies] = useState<PolicySummary[]>([]);
  const [policyDetail, setPolicyDetail] = useState<PolicyDetail | null>(null);
  const [activeTab, setActiveTab] = useState<"ALL" | "SELF_REPORTED" | "EMPLOYER">("ALL");
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState<string>("");
  const [detailTab, setDetailTab] = useState<"Overview" | "Benefits" | "Coverage Details" | "Documents">("Overview");

  // Load persisted policies for account mode
  const refreshPolicies = useCallback(async () => {
    if (mode !== "account" || !headers) return;
    try {
      const list = await api.request("get", "/api/v1/account/policies", {
        headers,
      });
      setPolicies(list);
    } catch {
      // Gracefully handle network/session transitions
    }
  }, [mode, headers]);

  useEffect(() => {
    void Promise.resolve().then(refreshPolicies);
  }, [refreshPolicies]);

  const countryName = userCtx.residenceCountry || userCtx.countryCode || "China";
  const city = userCtx.residenceCity || "Shenzhen";

  // Account extracted policies
  const extractedPolicies: DisplayPolicy[] = useMemo(() => {
    return policies.map((p) => ({
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
      isEmployer: p.kind?.includes("EMPLOYER") ?? false,
      evidenceStatus: p.evidence_status === "VERIFIED" ? "Verified" : p.evidence_status === "NEEDS_REVIEW" ? "Needs Review" : "Self-Reported",
      sourceDocId: p.document_id ?? undefined,
    }));
  }, [policies]);

  // Demo synthetic policies from demo session
  const demoPolicies: DisplayPolicy[] = useMemo(() => {
    if (mode !== "demo" || !demoSession?.record.policies) return [];
    return demoSession.record.policies.map((p) => {
      const isVerified = p.verification_status === "VERIFIED";
      return {
        id: p.id,
        provider: p.provider_name || "Synthetic Provider",
        title: p.policy_name || p.policy_type || "Student Health Plan",
        category: p.policy_type || "Student Insurance",
        tags: [p.policy_type || "Health", demoSession.record.country_code],
        status: "ACTIVE",
        statusLabel: isVerified ? "Verified" : "Self-Reported",
        dateRange: p.coverage_start_date && p.coverage_end_date ? `${p.coverage_start_date} – ${p.coverage_end_date}` : "2026-09-01 – 2027-04-15",
        policyNumber: p.policy_number_masked || "DEMO-****",
        planType: p.policy_type || "Policy Record",
        region: `${countryName} (${city})`,
        isEmployer: p.policy_type?.toLowerCase().includes("employer") ?? false,
        evidenceStatus: isVerified ? "Verified" : "Self-Reported",
        sourceDocId: p.source_document_ids?.[0],
      };
    });
  }, [mode, demoSession, countryName, city]);

  // Declared coverages from user context
  const studyPeriod = userCtx.segmentDetails?.studyPeriod;
  const rawDeclared = userCtx.declaredCoverages;
  const declaredPolicies: DisplayPolicy[] = useMemo(() => {
    const list = rawDeclared || [];
    return list.map((cov, idx) => ({
      id: `declared-${cov.id || idx}`,
      provider: cov.provider || cov.category,
      title: cov.label || cov.category,
      category: cov.category,
      tags: [cov.category, countryName, "Self-Reported"],
      status: "SELF_REPORTED" as const,
      statusLabel: "Self-Reported",
      dateRange: studyPeriod
        ? `Expected period: ${studyPeriod}`
        : "Dates pending document upload",
      policyNumber: "Pending document upload",
      planType: cov.policyName || cov.category,
      region: `${countryName} (${city})`,
      isEmployer: cov.category.toLowerCase().includes("employer") || cov.category.toLowerCase().includes("group"),
      evidenceStatus: "Self-Reported" as const,
    }));
  }, [rawDeclared, studyPeriod, countryName, city]);

  // Combine unique display policies
  const allDisplayPolicies = useMemo(() => {
    if (mode === "account") {
      return [...extractedPolicies, ...declaredPolicies];
    }
    // In demo mode: prioritize declared list if present, else fallback to demoSession
    if (declaredPolicies.length > 0) {
      return declaredPolicies;
    }
    return demoPolicies.length > 0 ? demoPolicies : declaredPolicies;
  }, [mode, extractedPolicies, declaredPolicies, demoPolicies]);

  // Filter policies based on active filter tab and search query
  const filtered = useMemo(() => {
    return allDisplayPolicies.filter((p) => {
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
  }, [allDisplayPolicies, activeTab, query]);

  // Active selected policy
  const selectedPolicy: DisplayPolicy | undefined = useMemo(() => {
    return filtered.find((p) => p.id === selectedId) || filtered[0] || allDisplayPolicies[0];
  }, [filtered, selectedId, allDisplayPolicies]);

  const selectedPolicyId = selectedPolicy?.id;
  const selectedPolicyIsPersisted = policies.some((p) => p.id === selectedPolicyId);
  const activePolicyDetail = policyDetail?.id === selectedPolicy?.id ? policyDetail : null;

  // Matched scraped product from Knowledge Base
  const matchedKbProduct: ScrapedProduct | null = useMemo(() => {
    if (!selectedPolicy) return null;
    return matchScrapedProduct({
      provider: selectedPolicy.provider,
      title: selectedPolicy.title,
      category: selectedPolicy.category,
      region: selectedPolicy.region,
    });
  }, [selectedPolicy]);

  // Fetch policy detail in account mode
  useEffect(() => {
    if (mode !== "account" || !headers || !selectedPolicyId || !selectedPolicyIsPersisted) {
      return;
    }
    let active = true;
    api
      .request("get", "/api/v1/account/policies/{policy_id}", {
        params: { policy_id: selectedPolicyId },
        headers,
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
  }, [mode, headers, selectedPolicyId, selectedPolicyIsPersisted]);

  const selectedBrand = selectedPolicy
    ? getInsurerBrand(selectedPolicy.provider, selectedPolicy.title, selectedPolicy.category)
    : null;

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
            const brand = getInsurerBrand(policy.provider, policy.title, policy.category);

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
                    {/* Official Insurer Logo or Clean Fallback */}
                    <div className="figma-provider-logo-container">
                      {brand.logoUrl ? (
                        /* eslint-disable-next-line @next/next/no-img-element */
                        <img
                          src={brand.logoUrl}
                          alt={brand.name}
                          className="figma-provider-logo-img"
                        />
                      ) : (
                        <div
                          className="figma-provider-logo-fallback"
                          style={{ background: brand.primaryColor }}
                        >
                          {brand.initials}
                        </div>
                      )}
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
                  width: 42,
                  height: 42,
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
                  Upload your insurance certificate or policy wording to extract verified benefits.
                </span>
              </div>
              <ChevronRight size={18} color="#94a3b8" />
            </div>
          </Link>
        </div>

        {/* Right Column: Policy Detail Panel */}
        {selectedPolicy ? (
          <div className="figma-policy-detail">
            {/* Detail Header with Official Logo */}
            <div className="figma-policy-detail-header">
              <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
                <div className="figma-provider-logo-container large">
                  {selectedBrand?.logoUrl ? (
                    /* eslint-disable-next-line @next/next/no-img-element */
                    <img
                      src={selectedBrand.logoUrl}
                      alt={selectedBrand.name}
                      className="figma-provider-logo-img"
                    />
                  ) : (
                    <div
                      className="figma-provider-logo-fallback"
                      style={{ background: selectedBrand?.primaryColor || "#0ea58a" }}
                    >
                      {selectedBrand?.initials || "INS"}
                    </div>
                  )}
                </div>
                <div>
                  <h2 style={{ margin: "0 0 4px", fontSize: 18, fontWeight: 800, color: "#0f1d38" }}>
                    {selectedPolicy.title}
                  </h2>
                  <span style={{ fontSize: 13, color: "#64748b" }}>{selectedPolicy.provider}</span>
                </div>
              </div>

              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <span className="figma-hub-card-pill neutral">
                  <Clock size={12} /> {selectedPolicy.evidenceStatus}
                </span>
              </div>
            </div>

            {/* Evidence vs Date-Status Caution Box */}
            <div
              style={{
                background: "#f8fafc",
                border: "1px dashed #cbd5e1",
                borderRadius: 12,
                padding: "14px 16px",
                display: "flex",
                alignItems: "flex-start",
                gap: 12,
              }}
            >
              <Info size={18} color="#0ea58a" style={{ flexShrink: 0, marginTop: 2 }} />
              <div style={{ fontSize: 12.5, color: "#475569", lineHeight: 1.5 }}>
                <strong>{selectedPolicy.evidenceStatus}:</strong> Evidence status is distinguished from date-based active status.
                Extracted policy benefits and exclusions reflect linked uploaded certificates or verified Knowledge Base reference standards.
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

            {/* ==================== Tab: Overview ==================== */}
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

                {/* Scraped Knowledge Base Product Reference */}
                {matchedKbProduct && (
                  <div className="figma-kb-box">
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                      <span className="figma-kb-badge">
                        <ShieldCheck size={13} /> Knowledge Base Curated Reference
                      </span>
                      {matchedKbProduct.product_version && (
                        <span style={{ fontSize: 11, color: "#64748b" }}>
                          Version {matchedKbProduct.product_version}
                        </span>
                      )}
                    </div>

                    <div>
                      <h4 style={{ margin: "2px 0 4px", fontSize: 14, fontWeight: 750, color: "#0f1d38" }}>
                        {matchedKbProduct.original_name}
                      </h4>
                      <p style={{ margin: 0, fontSize: 12.5, color: "#64748b" }}>
                        {matchedKbProduct.english_name}
                      </p>
                    </div>

                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, fontSize: 12 }}>
                      <div>
                        <span style={{ color: "#64748b", display: "block" }}>Underwriter / Platform:</span>
                        <strong style={{ color: "#1e293b" }}>{matchedKbProduct.insurer_name}</strong>
                      </div>
                      {matchedKbProduct.published_pricing && (
                        <div>
                          <span style={{ color: "#64748b", display: "block" }}>Published Pricing:</span>
                          <strong style={{ color: "#059669" }}>{matchedKbProduct.published_pricing}</strong>
                        </div>
                      )}
                    </div>

                    {matchedKbProduct.product_url && (
                      <div style={{ paddingTop: 4 }}>
                        <a
                          href={matchedKbProduct.product_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          style={{
                            display: "inline-flex",
                            alignItems: "center",
                            gap: 5,
                            fontSize: 12,
                            color: "#0ea58a",
                            textDecoration: "none",
                            fontWeight: 600,
                          }}
                        >
                          <span>Official Portal Reference</span>
                          <ExternalLink size={12} />
                        </a>
                      </div>
                    )}
                  </div>
                )}

                {/* Evidence & Verification Card */}
                <div style={{ borderTop: "1px solid #f1f5f9", paddingTop: 16 }}>
                  <h4 style={{ margin: "0 0 10px", fontSize: 13.5, fontWeight: 750, color: "#0f1d38" }}>
                    Evidence & Document Linkage
                  </h4>
                  <div style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 13, color: "#64748b" }}>
                    <div
                      style={{
                        width: 10,
                        height: 10,
                        borderRadius: "50%",
                        background: selectedPolicy.evidenceStatus === "Verified" ? "#059669" : "#d97706",
                      }}
                    />
                    <span>
                      {selectedPolicy.evidenceStatus}
                      {activePolicyDetail?.document_id
                        ? ` · linked document ${activePolicyDetail.document_id}`
                        : selectedPolicy.sourceDocId
                        ? ` · linked document ${selectedPolicy.sourceDocId}`
                        : " · no linked source document"}
                    </span>
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

            {/* ==================== Tab: Benefits ==================== */}
            {detailTab === "Benefits" && (
              <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
                {/* 1. Verified Extractions from Linked Document (if any) */}
                {(activePolicyDetail?.benefits ?? []).length > 0 && (
                  <div>
                    <h4 style={{ margin: "0 0 10px", fontSize: 13.5, fontWeight: 750, color: "#0f1d38" }}>
                      Extracted Document Evidence
                    </h4>
                    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                      {activePolicyDetail?.benefits?.map((benefit, index) => (
                        <div key={`${String(benefit.field_key)}-${index}`} className="figma-meta-item">
                          <span className="figma-meta-label">{String(benefit.field_key).replaceAll("_", " ")}</span>
                          <strong className="figma-meta-value">{JSON.stringify(benefit.value)}</strong>
                          {typeof benefit.source_page === "number" && (
                            <span className="figma-meta-label">Source: page {benefit.source_page}</span>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* 2. Curated Knowledge Base Scraped Benefits */}
                {matchedKbProduct?.benefits && matchedKbProduct.benefits.length > 0 && (
                  <div>
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
                      <h4 style={{ margin: 0, fontSize: 13.5, fontWeight: 750, color: "#0f1d38" }}>
                        Official Product Benefits & Limits (Scraped KB)
                      </h4>
                      <span className="figma-kb-badge">
                        <CheckCircle2 size={12} /> Verified Scraped Catalog
                      </span>
                    </div>

                    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                      {matchedKbProduct.benefits.map((b) => (
                        <div key={b.benefit_id} className="figma-benefit-card">
                          <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 10 }}>
                            <div>
                              <span style={{ fontSize: 11, fontWeight: 700, color: "#0ea58a", textTransform: "uppercase" }}>
                                {b.category}
                              </span>
                              <h5 style={{ margin: "2px 0 4px", fontSize: 13.5, fontWeight: 750, color: "#0f1d38" }}>
                                {b.name}
                              </h5>
                              {b.original_name && (
                                <span style={{ fontSize: 11.5, color: "#64748b", display: "block" }}>
                                  {b.original_name}
                                </span>
                              )}
                            </div>
                            <div style={{ textAlign: "right" }}>
                              <strong style={{ fontSize: 13.5, fontWeight: 800, color: "#059669" }}>
                                {b.limit_text}
                              </strong>
                              {b.reimbursement_rate && (
                                <span style={{ display: "block", fontSize: 11, color: "#64748b" }}>
                                  {b.reimbursement_rate}
                                </span>
                              )}
                            </div>
                          </div>

                          {b.covered_services && (
                            <p style={{ margin: "4px 0 0", fontSize: 12, color: "#475569", lineHeight: 1.45 }}>
                              {b.covered_services}
                            </p>
                          )}

                          {b.deductible_text && (
                            <div style={{ fontSize: 11.5, color: "#d97706", fontWeight: 600, marginTop: 2 }}>
                              Deductible: {b.deductible_text}
                            </div>
                          )}

                          {b.network && (
                            <div style={{ fontSize: 11, color: "#64748b" }}>
                              Network: {b.network}
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Fallback notice if neither exists */}
                {(!activePolicyDetail?.benefits || activePolicyDetail.benefits.length === 0) &&
                  (!matchedKbProduct?.benefits || matchedKbProduct.benefits.length === 0) && (
                    <p style={{ margin: 0, color: "#64748b", fontSize: 13 }}>
                      No benefit or limit data is available in the current record. Upload a policy document to associate verified benefits.
                    </p>
                  )}

                {matchedKbProduct?.provenance_note && (
                  <p style={{ margin: "8px 0 0", color: "#94a3b8", fontSize: 11.5 }}>
                    {matchedKbProduct.provenance_note}
                  </p>
                )}

                {activePolicyDetail?.document_id && (
                  <Link
                    href={`/documents/${activePolicyDetail.document_id}`}
                    className="figma-btn-primary"
                    style={{ textDecoration: "none", width: "fit-content", marginTop: 8 }}
                  >
                    <FileText size={14} /> Review source document
                  </Link>
                )}
              </div>
            )}

            {/* ==================== Tab: Coverage Details ==================== */}
            {detailTab === "Coverage Details" && (
              <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
                {/* 1. Scraped Knowledge Base Exclusions */}
                {matchedKbProduct?.exclusions && matchedKbProduct.exclusions.length > 0 && (
                  <div>
                    <h4 style={{ margin: "0 0 10px", fontSize: 13.5, fontWeight: 750, color: "#0f1d38" }}>
                      Key Policy Exclusions (Knowledge Base Reference)
                    </h4>
                    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                      {matchedKbProduct.exclusions.map((excl, idx) => (
                        <div
                          key={idx}
                          style={{
                            background: "#fff9f5",
                            border: "1px solid #fee2d5",
                            borderRadius: 10,
                            padding: "10px 14px",
                          }}
                        >
                          <div style={{ display: "flex", alignItems: "flex-start", gap: 8 }}>
                            <ShieldAlert size={15} color="#ea580c" style={{ flexShrink: 0, marginTop: 2 }} />
                            <div>
                              <strong style={{ fontSize: 13, color: "#9a3412", display: "block" }}>
                                {excl.title}
                              </strong>
                              {excl.original_text && (
                                <span style={{ fontSize: 11.5, color: "#7c2d12", display: "block", marginTop: 2 }}>
                                  {excl.original_text}
                                </span>
                              )}
                              {excl.conditions && (
                                <p style={{ margin: "4px 0 0", fontSize: 12, color: "#475569" }}>
                                  {excl.conditions}
                                </p>
                              )}
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* 2. Medical Network Requirements */}
                {matchedKbProduct?.network_requirements && (
                  <div>
                    <h4 style={{ margin: "0 0 6px", fontSize: 13.5, fontWeight: 750, color: "#0f1d38" }}>
                      Hospital & Healthcare Network Criteria
                    </h4>
                    <p style={{ margin: 0, fontSize: 12.5, color: "#334155", lineHeight: 1.5 }}>
                      {matchedKbProduct.network_requirements}
                    </p>
                  </div>
                )}

                {/* 3. Claims Submission Procedures */}
                {matchedKbProduct?.claims_instructions && (
                  <div style={{ background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: 12, padding: 14 }}>
                    <h4 style={{ margin: "0 0 6px", fontSize: 13.5, fontWeight: 750, color: "#0f1d38" }}>
                      Claims Reporting & Timeline
                    </h4>
                    <p style={{ margin: 0, fontSize: 12.5, color: "#334155", lineHeight: 1.5 }}>
                      {matchedKbProduct.claims_instructions}
                    </p>
                  </div>
                )}

                {/* Verified Extracted Exclusions */}
                {(activePolicyDetail?.exclusions ?? []).length > 0 && (
                  <div>
                    <h4 style={{ margin: "0 0 8px", fontSize: 13.5, fontWeight: 750, color: "#0f1d38" }}>
                      Extracted Document Exclusions
                    </h4>
                    {activePolicyDetail?.exclusions?.map((exclusion, index) => (
                      <p key={`${exclusion}-${index}`} style={{ margin: "0 0 6px", color: "#334155", fontSize: 13 }}>
                        • {exclusion}
                      </p>
                    ))}
                  </div>
                )}

                {activePolicyDetail?.document_id && (
                  <Link
                    href={`/documents/${activePolicyDetail.document_id}`}
                    className="figma-btn-primary"
                    style={{ textDecoration: "none", width: "fit-content", marginTop: 8 }}
                  >
                    <FileText size={14} /> Review source citations
                  </Link>
                )}
              </div>
            )}

            {/* ==================== Tab: Documents ==================== */}
            {detailTab === "Documents" && (
              <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                <p style={{ fontSize: 13, color: "#64748b", margin: 0 }}>
                  Associated insurance certificates and evidence files for this policy:
                </p>
                <div
                  style={{
                    border: "1px dashed #cbd5e1",
                    borderRadius: 14,
                    padding: 28,
                    textAlign: "center",
                    background: "#fcfdfd",
                  }}
                >
                  <FileText size={32} color="#94a3b8" style={{ margin: "0 auto 10px" }} />
                  {activePolicyDetail?.document_id || selectedPolicy.sourceDocId ? (
                    <>
                      <h4 style={{ margin: 0, fontSize: 14, fontWeight: 700, color: "#1e293b" }}>
                        Linked Source Document
                      </h4>
                      <p style={{ margin: "6px 0 16px", fontSize: 12.5, color: "#64748b" }}>
                        Document ID: {activePolicyDetail?.document_id || selectedPolicy.sourceDocId}
                      </p>
                      <Link
                        href={`/documents/${activePolicyDetail?.document_id || selectedPolicy.sourceDocId}`}
                        className="figma-btn-primary"
                        style={{ textDecoration: "none", display: "inline-flex", alignItems: "center", gap: 6, fontSize: 13 }}
                      >
                        <FileText size={14} /> Review document and evidence
                      </Link>
                    </>
                  ) : (
                    <>
                      <h4 style={{ margin: 0, fontSize: 14, fontWeight: 700, color: "#1e293b" }}>
                        No Source Document Linked
                      </h4>
                      <p style={{ margin: "6px 0 16px", fontSize: 12.5, color: "#64748b" }}>
                        Upload your insurance policy certificate to link official evidence and verify coverage limits.
                      </p>
                      <Link
                        href="/documents"
                        className="figma-btn-primary"
                        style={{ textDecoration: "none", display: "inline-flex", alignItems: "center", gap: 6, fontSize: 13 }}
                      >
                        <Upload size={14} /> Upload document
                      </Link>
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
