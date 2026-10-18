"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import {
  Bed,
  Calendar,
  CheckCircle2,
  ChevronRight,
  Clock,
  FileText,
  Filter,
  Heart,
  MoreHorizontal,
  Pill,
  Plus,
  Search,
  ShieldCheck,
} from "lucide-react";
import { api } from "@/lib/api/client";
import type { components } from "@/lib/api/types.gen";
import { useAuth } from "@/lib/auth";

type PolicySummary = components["schemas"]["AccountPolicySummary"];

export default function PoliciesPage() {
  const { token } = useAuth();
  const [policies, setPolicies] = useState<PolicySummary[]>([]);
  const [activeTab, setActiveTab] = useState<"ALL" | "ACTIVE" | "EXPIRING" | "EMPLOYER">("ALL");
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState<string>("1");
  const [detailTab, setDetailTab] = useState<"Overview" | "Benefits" | "Coverage Details" | "Documents" | "Notes">("Overview");

  const refreshPolicies = useCallback(async () => {
    if (!token) return;
    try {
      const list = await api.request("get", "/api/v1/account/policies", {
        headers: { Authorization: `Bearer ${token}` },
      });
      setPolicies(list);
    } catch {
      // Ignore
    }
  }, [token]);

  useEffect(() => {
    void Promise.resolve().then(refreshPolicies);
  }, [refreshPolicies]);

  // Design-aligned mock policies if none loaded from backend yet
  const defaultPolicies = [
    {
      id: "1",
      provider: "AIA",
      title: "Student Insurance Plan",
      tags: ["Health", "International", "Student"],
      status: "ACTIVE",
      statusLabel: "Active",
      dateRange: "1 Aug 2024 - 31 Jul 2027",
      policyNumber: "HP123456789",
      planType: "Student Plan",
      region: "Singapore",
      logoBadge: "aia",
      isEmployer: false,
    },
    {
      id: "2",
      provider: "AXA",
      title: "AXA Travel Insurance",
      tags: ["Travel", "International", "Short-term"],
      status: "ACTIVE",
      statusLabel: "Active",
      dateRange: "1 Feb 2026 - 28 Feb 2026",
      policyNumber: "AX98234112",
      planType: "Travel Emergency",
      region: "International",
      logoBadge: "axa",
      isEmployer: false,
    },
    {
      id: "3",
      provider: "IMEC (Employer)",
      title: "Group Health Insurance",
      tags: ["Health", "Employer", "Group Plan"],
      status: "EXPIRING_SOON",
      statusLabel: "Expiring Soon",
      dateRange: "1 Jan 2025 - 31 Dec 2026",
      policyNumber: "GH4412098",
      planType: "Corporate Health",
      region: "Singapore",
      logoBadge: "imec",
      isEmployer: true,
    },
  ];

  const allDisplayPolicies = policies.length > 0
    ? policies.map((p, idx) => ({
        id: p.id,
        provider: p.provider || (idx === 0 ? "AIA" : idx === 1 ? "AXA" : "IMEC (Employer)"),
        title: p.kind ? p.kind.replaceAll("_", " ") : (idx === 0 ? "Student Insurance Plan" : idx === 1 ? "AXA Travel Insurance" : "Group Health Insurance"),
        tags: [p.kind || "Health", "International"],
        status: p.status || "ACTIVE",
        statusLabel: p.status === "EXPIRING_SOON" ? "Expiring Soon" : "Active",
        dateRange: p.end_date ? `Valid until ${p.end_date}` : "1 Aug 2024 - 31 Jul 2027",
        policyNumber: p.policy_number_masked || "HP123456789",
        planType: "Comprehensive Plan",
        region: p.country_code === "AU" ? "Australia" : p.country_code === "ID" ? "Indonesia" : "Singapore",
        logoBadge: idx === 0 ? "aia" : idx === 1 ? "axa" : "imec",
        isEmployer: p.kind?.includes("EMPLOYER") ?? false,
      }))
    : defaultPolicies;

  const filtered = allDisplayPolicies.filter((p) => {
    if (activeTab === "ACTIVE" && p.status !== "ACTIVE") return false;
    if (activeTab === "EXPIRING" && p.status !== "EXPIRING_SOON") return false;
    if (activeTab === "EMPLOYER" && !p.isEmployer) return false;
    if (query.trim()) {
      const q = query.toLowerCase();
      return p.title.toLowerCase().includes(q) || p.provider.toLowerCase().includes(q);
    }
    return true;
  });

  const selectedPolicy = allDisplayPolicies.find((p) => p.id === selectedId) || allDisplayPolicies[0];

  return (
    <div className="figma-page-shell">
      {/* ---------------- Back Link ---------------- */}
      <Link href="/protection" className="figma-back-link">
        ← My Protection
      </Link>

      {/* ---------------- Page Header ---------------- */}
      <header className="figma-page-header">
        <div>
          <h1>Policy Wallet</h1>
          <p>Manage all your insurance policies in one place. View coverage details, benefits, and important dates.</p>
        </div>
        <Link href="/documents" className="figma-btn-primary">
          <Plus size={16} /> Add Policy
        </Link>
      </header>

      {/* ---------------- Toolbar: Tabs & Search ---------------- */}
      <div className="figma-wallet-toolbar">
        <div className="figma-filter-pills">
          <button
            type="button"
            className={`figma-pill-btn ${activeTab === "ALL" ? "active" : ""}`}
            onClick={() => setActiveTab("ALL")}
          >
            All Policies ({allDisplayPolicies.length})
          </button>
          <button
            type="button"
            className={`figma-pill-btn ${activeTab === "ACTIVE" ? "active" : ""}`}
            onClick={() => setActiveTab("ACTIVE")}
          >
            Active (2)
          </button>
          <button
            type="button"
            className={`figma-pill-btn ${activeTab === "EXPIRING" ? "active" : ""}`}
            onClick={() => setActiveTab("EXPIRING")}
          >
            Expiring Soon (1) <span style={{ width: 6, height: 6, borderRadius: "50%", background: "#f59e0b", display: "inline-block", marginLeft: 4 }} />
          </button>
          <button
            type="button"
            className={`figma-pill-btn ${activeTab === "EMPLOYER" ? "active" : ""}`}
            onClick={() => setActiveTab("EMPLOYER")}
          >
            From Employer (1)
          </button>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div className="figma-search-input-wrap" style={{ width: 280 }}>
            <Search size={15} />
            <input
              type="text"
              className="figma-search-input"
              placeholder="Search policy, provider, or type..."
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
          <button
            type="button"
            className="figma-btn-outline"
            style={{ width: 42, height: 42, padding: 0, justifyContent: "center" }}
            title="Filter options"
          >
            <Filter size={16} color="#64748b" />
          </button>
        </div>
      </div>

      {/* ---------------- Two Column Main Layout ---------------- */}
      <div className="figma-wallet-grid">
        {/* Left Column: Policies List */}
        <div className="figma-policy-list">
          {filtered.map((policy) => {
            const isSelected = policy.id === selectedPolicy.id;
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
                    <div className={`figma-provider-logo-badge ${policy.logoBadge}`}>
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
                    {policy.status === "EXPIRING_SOON" ? (
                      <span className="figma-hub-card-pill warning">
                        <Clock size={12} /> {policy.statusLabel}
                      </span>
                    ) : (
                      <span className="figma-hub-card-pill success">
                        <span style={{ width: 6, height: 6, borderRadius: "50%", background: "#0ea58a" }} /> {policy.statusLabel}
                      </span>
                    )}
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
            style={{ borderStyle: "dashed", background: "#fcfdfd" }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
              <div style={{ width: 40, height: 40, borderRadius: "50%", background: "#eaf8f4", color: "#0ea58a", display: "flex", alignItems: "center", justifyContent: "center" }}>
                <Plus size={20} />
              </div>
              <div style={{ flex: 1 }}>
                <strong style={{ display: "block", fontSize: 14, fontWeight: 750, color: "#0f1d38" }}>
                  Add Another Policy
                </strong>
                <span style={{ fontSize: 12, color: "#64748b" }}>
                  Upload your insurance document or enter details manually.
                </span>
              </div>
              <ChevronRight size={18} color="#94a3b8" />
            </div>
          </Link>
        </div>

        {/* Right Column: Policy Detail Panel */}
        <div className="figma-policy-detail">
          {/* Header of Detail */}
          <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
              <div className={`figma-provider-logo-badge ${selectedPolicy.logoBadge}`}>
                {selectedPolicy.provider.slice(0, 3).toUpperCase()}
              </div>
              <div>
                <h2 style={{ fontSize: 18, fontWeight: 800, color: "#0f1d38", margin: "0 0 3px" }}>
                  {selectedPolicy.title}
                </h2>
                <span style={{ fontSize: 13, color: "#64748b" }}>{selectedPolicy.provider}</span>
              </div>
            </div>

            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <span className="figma-hub-card-pill success">
                <span style={{ width: 6, height: 6, borderRadius: "50%", background: "#0ea58a" }} /> Active
              </span>
              <button
                type="button"
                style={{ background: "none", border: "none", color: "#94a3b8", cursor: "pointer", padding: 4 }}
                title="Options"
              >
                <MoreHorizontal size={18} />
              </button>
            </div>
          </div>

          <div className="figma-tag-row">
            {selectedPolicy.tags.map((tag, idx) => (
              <span key={idx} className="figma-tag">
                {tag}
              </span>
            ))}
          </div>

          {/* Sub Navigation Tabs */}
          <div className="figma-detail-tabs">
            {(["Overview", "Benefits", "Coverage Details", "Documents", "Notes"] as const).map((tab) => (
              <span
                key={tab}
                className={`figma-tab-link ${detailTab === tab ? "active" : ""}`}
                onClick={() => setDetailTab(tab)}
              >
                {tab}
              </span>
            ))}
          </div>

          {/* Active Banner */}
          <div className="figma-alert-banner">
            <div style={{ width: 28, height: 28, borderRadius: "50%", background: "#0ea58a", color: "#ffffff", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
              <ShieldCheck size={16} />
            </div>
            <div>
              <strong style={{ display: "block", fontSize: 13.5, color: "#065f46" }}>Your coverage is active</strong>
              <span style={{ fontSize: 12, color: "#047857" }}>
                This policy covers you from 1 Aug 2024 to 31 Jul 2027.
              </span>
            </div>
          </div>

          {/* 4 Info Tiles */}
          <div className="figma-info-tiles-grid">
            <div className="figma-info-tile">
              <small>Policy number</small>
              <strong>{selectedPolicy.policyNumber}</strong>
            </div>
            <div className="figma-info-tile">
              <small>Coverage period</small>
              <strong>{selectedPolicy.dateRange}</strong>
            </div>
            <div className="figma-info-tile">
              <small>Plan type</small>
              <strong>{selectedPolicy.planType}</strong>
            </div>
            <div className="figma-info-tile">
              <small>Region</small>
              <strong>{selectedPolicy.region}</strong>
            </div>
          </div>

          {/* Coverage Summary */}
          <div>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
              <strong style={{ fontSize: 14, color: "#0f1d38" }}>Coverage summary</strong>
              <Link href="/completeness" style={{ fontSize: 12, fontWeight: 700, color: "#0ea58a", textDecoration: "none" }}>
                View full details →
              </Link>
            </div>

            <div className="figma-benefits-cols">
              <div className="figma-benefit-item" style={{ background: "#f8fafc", padding: "10px 12px", borderRadius: 10 }}>
                <div className="figma-benefit-icon" style={{ background: "#fee2e2", color: "#dc2626" }}>
                  <Heart size={15} />
                </div>
                <div>
                  <strong style={{ fontSize: 12 }}>Outpatient Care</strong>
                  <span style={{ fontSize: 11, color: "#64748b" }}>Up to SGD 1,000 / yr</span>
                </div>
              </div>

              <div className="figma-benefit-item" style={{ background: "#f8fafc", padding: "10px 12px", borderRadius: 10 }}>
                <div className="figma-benefit-icon" style={{ background: "#e0f2fe", color: "#0284c7" }}>
                  <Bed size={15} />
                </div>
                <div>
                  <strong style={{ fontSize: 12 }}>Inpatient Care</strong>
                  <span style={{ fontSize: 11, color: "#64748b" }}>Up to SGD 100,000 / yr</span>
                </div>
              </div>

              <div className="figma-benefit-item" style={{ background: "#f8fafc", padding: "10px 12px", borderRadius: 10 }}>
                <div className="figma-benefit-icon" style={{ background: "#e8f8f3", color: "#0ea58a" }}>
                  <Pill size={15} />
                </div>
                <div>
                  <strong style={{ fontSize: 12 }}>Prescription Drugs</strong>
                  <span style={{ fontSize: 11, color: "#64748b" }}>Up to SGD 500 / yr</span>
                </div>
              </div>
            </div>
          </div>

          {/* Documents Section */}
          <div>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
              <strong style={{ fontSize: 14, color: "#0f1d38" }}>Documents (2)</strong>
              <Link href="/documents" style={{ fontSize: 12, fontWeight: 700, color: "#0ea58a", textDecoration: "none" }}>
                View all →
              </Link>
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 12px", background: "#f8fafc", borderRadius: 10 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <FileText size={18} color="#dc2626" />
                  <div>
                    <strong style={{ display: "block", fontSize: 12.5, color: "#0f1d38" }}>
                      Student Insurance Policy.pdf
                    </strong>
                    <span style={{ fontSize: 11, color: "#94a3b8" }}>Uploaded 2 Aug 2024</span>
                  </div>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <span className="figma-hub-card-pill success" style={{ padding: "3px 8px", fontSize: 10 }}>
                    <CheckCircle2 size={11} /> Verified
                  </span>
                  <MoreHorizontal size={15} color="#94a3b8" />
                </div>
              </div>

              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 12px", background: "#f8fafc", borderRadius: 10 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <FileText size={18} color="#0284c7" />
                  <div>
                    <strong style={{ display: "block", fontSize: 12.5, color: "#0f1d38" }}>
                      Policy Summary.pdf
                    </strong>
                    <span style={{ fontSize: 11, color: "#94a3b8" }}>Uploaded 2 Aug 2024</span>
                  </div>
                </div>
                <MoreHorizontal size={15} color="#94a3b8" />
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
