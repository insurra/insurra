"use client";

import { showAlert, showConfirm } from "@/components/ui/app-dialog";
import Link from "next/link";
import Image from "next/image";
import { useCallback, useEffect, useState } from "react";
import {
  Activity,
  AlertCircle,
  AlertTriangle,
  ArrowRight,
  Baby,
  Building2,
  Check,
  ChevronRight,
  Edit3,
  Glasses,
  HelpCircle,
  Hospital,
  Info,
  Link2,
  MoreHorizontal,
  Plus,
  RefreshCw,
  ShieldAlert,
  ShieldCheck,
  Stethoscope,
  Trash2,
  Users,
  X,
} from "lucide-react";

import { api } from "@/lib/api/client";
import type { components } from "@/lib/api/types.gen";
import { useActor } from "@/lib/actor";
import "./family.css";

type FamilyProtectionOverview = components["schemas"]["FamilyProtectionOverview"];

export default function FamilyPage() {
  const { headers, loading: actorLoading } = useActor();

  const [overview, setOverview] = useState<FamilyProtectionOverview | null>(null);
  const [selectedMemberId, setSelectedMemberId] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<
    "overview" | "policies" | "eligibility" | "needs"
  >("overview");
  const [filterStatus, setFilterStatus] = useState<string>("all");
  const [loading, setLoading] = useState(true);
  const [analyzing, setAnalyzing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Modals state
  const [showAddModal, setShowAddModal] = useState(false);
  const [showConsentModal, setShowConsentModal] = useState(false);
  const [showManageCoverageModal, setShowManageCoverageModal] = useState(false);
  const [showEditMemberModal, setShowEditMemberModal] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  // Add Member Form
  const [addName, setAddName] = useState("");
  const [addRelation, setAddRelation] = useState("Child");
  const [addBirthDate, setAddBirthDate] = useState("");
  const [addGender, setAddGender] = useState("Female");
  const [addOccupation, setAddOccupation] = useState("");
  const [addNotes, setAddNotes] = useState("");
  const [addConsent, setAddConsent] = useState(true);
  const [modalBusy, setModalBusy] = useState(false);

  // Edit Member Form
  const [editName, setEditName] = useState("");
  const [editRelation, setEditRelation] = useState("");
  const [editBirthDate, setEditBirthDate] = useState("");
  const [editOccupation, setEditOccupation] = useState("");
  const [editNotes, setEditNotes] = useState("");

  // Manage Coverage Link Form
  const [linkPolicyName, setLinkPolicyName] = useState("PT Teknologi Maju - Group Health Insurance");
  const [linkProviderName, setLinkProviderName] = useState("PT Teknologi Maju");
  const [linkPolicyType, setLinkPolicyType] = useState("EMPLOYER_GROUP");
  const [linkCoverageRole, setLinkCoverageRole] = useState("DEPENDENT");
  const [linkCoverInpatient, setLinkCoverInpatient] = useState(true);
  const [linkCoverOutpatient, setLinkCoverOutpatient] = useState(true);
  const [linkCoverEmergency, setLinkCoverEmergency] = useState(true);
  const [linkCoverDental, setLinkCoverDental] = useState(false);
  const [linkCoverOptical, setLinkCoverOptical] = useState(true);
  const [linkOpticalLimit, setLinkOpticalLimit] = useState(true);
  const [linkSummary, setLinkSummary] = useState(
    "Covers inpatient, outpatient, emergency, and optical (limited)"
  );

  // Consent Form
  const [consentConfirmed, setConsentConfirmed] = useState(true);
  const [consentLegalGuardian, setConsentLegalGuardian] = useState(true);

  const fetchOverview = useCallback(async () => {
    if (!headers) return;
    setLoading(true);
    setError(null);
    try {
      const data = await api.request("get", "/api/v1/family/overview", { headers });
      setOverview(data);
      if (!selectedMemberId && data.selected_member_id) {
        setSelectedMemberId(data.selected_member_id);
      } else if (
        selectedMemberId &&
        !data.members.some((m) => m.id === selectedMemberId)
      ) {
        setSelectedMemberId(data.members[0]?.id ?? null);
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to load family protection summary.");
    } finally {
      setLoading(false);
    }
  }, [headers, selectedMemberId]);

  useEffect(() => {
    if (headers) {
      void Promise.resolve().then(fetchOverview);
    }
  }, [headers, fetchOverview]);

  // Selected member object
  const selectedMember =
    overview?.members.find((m) => m.id === selectedMemberId) ??
    overview?.members[0] ??
    null;

  // Filter members
  const filteredMembers =
    overview?.members.filter((m) => {
      if (filterStatus === "all") return true;
      return m.coverage_status.toLowerCase() === filterStatus.toLowerCase();
    }) ?? [];

  // Handle Add Member
  async function handleAddMember(e: React.FormEvent) {
    e.preventDefault();
    if (!headers || !addName.trim()) return;
    setModalBusy(true);
    try {
      const created = await api.request("post", "/api/v1/family/members", {
        headers,
        body: {
          name: addName.trim(),
          relation: addRelation,
          birth_date: addBirthDate || null,
          gender: addGender || null,
          occupation: addOccupation.trim() || null,
          notes: addNotes.trim() || null,
          consent_confirmed: addConsent,
        },
      });
      setShowAddModal(false);
      setAddName("");
      setAddBirthDate("");
      setAddOccupation("");
      setAddNotes("");
      setSelectedMemberId(created.id);
      await fetchOverview();
    } catch (err: unknown) {
      void showAlert(err instanceof Error ? err.message : "Failed to add family member.");
    } finally {
      setModalBusy(false);
    }
  }

  // Handle Open Edit Modal
  function openEditModal() {
    if (!selectedMember) return;
    setEditName(selectedMember.name);
    setEditRelation(selectedMember.relation);
    setEditBirthDate(selectedMember.birth_date ?? "");
    setEditOccupation(selectedMember.occupation ?? "");
    setEditNotes(selectedMember.notes ?? "");
    setShowEditMemberModal(true);
  }

  // Handle Update Member Details
  async function handleUpdateMember(e: React.FormEvent) {
    e.preventDefault();
    if (!headers || !selectedMember) return;
    setModalBusy(true);
    try {
      await api.request("put", "/api/v1/family/members/{member_id}", {
        headers,
        params: { member_id: selectedMember.id },
        body: {
          name: editName.trim() || undefined,
          relation: editRelation || undefined,
          birth_date: editBirthDate || null,
          occupation: editOccupation.trim() || null,
          notes: editNotes.trim() || null,
        },
      });
      setShowEditMemberModal(false);
      await fetchOverview();
    } catch (err: unknown) {
      void showAlert(err instanceof Error ? err.message : "Gagal memperbarui detail anggota.");
    } finally {
      setModalBusy(false);
    }
  }

  // Handle Delete Member
  async function handleDeleteMember() {
    if (!headers || !selectedMember) return;
    setModalBusy(true);
    try {
      await api.request("delete", "/api/v1/family/members/{member_id}", {
        headers,
        params: { member_id: selectedMember.id },
      });
      setShowDeleteConfirm(false);
      setSelectedMemberId(null);
      await fetchOverview();
    } catch (err: unknown) {
      void showAlert(err instanceof Error ? err.message : "Failed to remove family member.");
    } finally {
      setModalBusy(false);
    }
  }

  // Handle Link Policy
  async function handleLinkPolicy(e: React.FormEvent) {
    e.preventDefault();
    if (!headers || !selectedMember) return;
    setModalBusy(true);
    try {
      await api.request("post", "/api/v1/family/members/{member_id}/policies", {
        headers,
        params: { member_id: selectedMember.id },
        body: {
          policy_ref: `pol-${Date.now()}`,
          policy_name: linkPolicyName.trim(),
          provider_name: linkProviderName.trim(),
          policy_type: linkPolicyType,
          coverage_role: linkCoverageRole,
          status: "ACTIVE",
          verification_status: "VERIFIED",
          coverage_summary: linkSummary.trim(),
          benefit_details: {
            inpatient: { covered: linkCoverInpatient },
            outpatient: { covered: linkCoverOutpatient },
            emergency: { covered: linkCoverEmergency },
            dental: { covered: linkCoverDental },
            optical: { covered: linkCoverOptical, has_limit: linkOpticalLimit },
          },
        },
      });
      setShowManageCoverageModal(false);
      await fetchOverview();
    } catch (err: unknown) {
      void showAlert(err instanceof Error ? err.message : "Failed to link insurance policy.");
    } finally {
      setModalBusy(false);
    }
  }

  // Handle Unlink Policy
  async function handleUnlinkPolicy(linkId: string) {
    if (!headers || !selectedMember) return;
    if (!(await showConfirm("Unlink this policy from family member?", { tone: "error", confirmLabel: "Ya, lepas tautan" }))) return;
    try {
      await api.request("delete", "/api/v1/family/members/{member_id}/policies/{link_id}", {
        headers,
        params: { member_id: selectedMember.id, link_id: linkId },
      });
      await fetchOverview();
    } catch (err: unknown) {
      void showAlert(err instanceof Error ? err.message : "Gagal melepas tautan polis.");
    }
  }

  // Handle Consent Update
  async function handleSaveConsent(e: React.FormEvent) {
    e.preventDefault();
    if (!headers) return;
    setModalBusy(true);
    try {
      await api.request("post", "/api/v1/family/consent", {
        headers,
        body: {
          consent_confirmed: consentConfirmed,
          authorization_scope: ["HEALTH", "CLAIMS", "ELIGIBILITY", "AI_GUIDANCE"],
          legal_guardian_confirmed: consentLegalGuardian,
        },
      });
      setShowConsentModal(false);
      await fetchOverview();
    } catch (err: unknown) {
      void showAlert(err instanceof Error ? err.message : "Gagal memperbarui izin persetujuan.");
    } finally {
      setModalBusy(false);
    }
  }

  // Re-run Family Protection Analyzer (AI Engine)
  async function handleRunAnalyzer() {
    if (!headers) return;
    setAnalyzing(true);
    try {
      const res = await api.request("post", "/api/v1/family/analyze", {
        headers,
        body: { include_external_ai: true },
      });
      setOverview(res.overview);
    } catch (err: unknown) {
      void showAlert(err instanceof Error ? err.message : "Gagal menjalankan analisis AI.");
    } finally {
      setAnalyzing(false);
    }
  }

  // Helper icons for benefit rows
  function getBenefitIcon(key: string) {
    switch (key.toLowerCase()) {
      case "inpatient":
        return <Hospital size={16} />;
      case "outpatient":
        return <Stethoscope size={16} />;
      case "dental":
        return <SmileIcon size={16} />;
      case "optical":
        return <Glasses size={16} />;
      case "maternity":
        return <Baby size={16} />;
      case "emergency":
        return <ShieldAlert size={16} />;
      default:
        return <Activity size={16} />;
    }
  }

  if (actorLoading || loading) {
    return (
      <div className="family-page-container" style={{ textAlign: "center", padding: "80px 20px" }}>
        <RefreshCw className="animate-spin" size={32} style={{ color: "#0284c7", margin: "0 auto 16px" }} />
        <h3 style={{ fontSize: 18, fontWeight: 700, color: "#0f1d38", margin: 0 }}>
          Loading Family Protection...
        </h3>
        <p style={{ fontSize: 13, color: "#64748b", marginTop: 4 }}>
          Evaluating policy eligibility rules and household member coverage needs.
        </p>
      </div>
    );
  }

  const summary = overview?.summary ?? {
    coverage_score_percent: 75,
    headline: "Mostly covered",
    description: "Most of your family members have health coverage. Some areas may still need attention.",
    covered_count: 3,
    partial_count: 1,
    not_covered_count: 0,
    unknown_count: 0,
    total_members: 4,
  };

  // Donut chart calculation (circumference 2 * pi * 30 = ~188.5)
  const radius = 30;
  const circumference = 2 * Math.PI * radius;
  const strokeDashoffset =
    circumference - (summary.coverage_score_percent / 100) * circumference;

  const selectedPolicies = selectedMember?.linked_policies ?? [];
  const selectedBenefits = selectedMember?.benefits ?? [];
  const selectedUnmetNeeds = selectedMember?.unmet_needs ?? [];
  const selectedInsights = selectedMember?.ai_insights ?? [];
  const selectedRules = selectedMember?.eligibility_rules ?? [];

  return (
    <div className="family-page-container">
      {/* ---------------- 1. Breadcrumb ---------------- */}
      <Link href="/protection" className="family-back-link">
        ← My Protection
      </Link>

      {error && (
        <div style={{ padding: "10px 14px", background: "#fef2f2", border: "1px solid #fecaca", borderRadius: 8, color: "#991b1b", marginBottom: 16, fontSize: 13, display: "flex", alignItems: "center", gap: 8 }}>
          <AlertCircle size={16} />
          <span>{error}</span>
        </div>
      )}

      {/* ---------------- 2. Header Row ---------------- */}
      <header className="family-header-row">
        <div>
          <h1 className="family-title">Family Protection</h1>
          <p className="family-subtitle">
            Manage your family members, link their coverage, and understand their protection needs.
          </p>
        </div>
        <div className="family-actions">
          <button
            type="button"
            className="btn-primary-blue"
            onClick={() => setShowAddModal(true)}
          >
            <Plus size={16} /> Add Family Member
          </button>
          <button
            type="button"
            className="btn-outline-white"
            onClick={() => setShowConsentModal(true)}
          >
            <ShieldCheck size={16} style={{ color: "#0284c7" }} /> Consent &amp; Authorization
          </button>
        </div>
      </header>

      {/* ---------------- 3. Family Coverage Status Section ---------------- */}
      <section style={{ marginBottom: 32 }}>
        <div className="status-section-title">
          <span>Family coverage status</span>
          <Info size={14} style={{ color: "#94a3b8" }} />
        </div>

        <div className="status-card-grid">
          {/* Donut Chart Card */}
          <div className="donut-summary-card">
            <div className="donut-chart-wrapper">
              <svg width="74" height="74" viewBox="0 0 74 74">
                <circle
                  cx="37"
                  cy="37"
                  r={radius}
                  fill="transparent"
                  stroke="#e2e8f0"
                  strokeWidth="7"
                />
                <circle
                  cx="37"
                  cy="37"
                  r={radius}
                  fill="transparent"
                  stroke="#14b8a6"
                  strokeWidth="7"
                  strokeDasharray={circumference}
                  strokeDashoffset={strokeDashoffset}
                  strokeLinecap="round"
                  transform="rotate(-90 37 37)"
                />
              </svg>
              <div className="donut-chart-text">
                {summary.coverage_score_percent}%
              </div>
            </div>
            <div className="donut-text-content">
              <h3 className="donut-headline">{summary.headline}</h3>
              <p className="donut-desc">{summary.description}</p>
            </div>
          </div>

          {/* Metric 1: Covered */}
          <div className="metric-pill-card green">
            <div className="metric-top-row">
              <div className="metric-icon-circle">
                <Users size={15} />
              </div>
              <div className="metric-value-label">
                {summary.covered_count} Covered
              </div>
            </div>
            <div className="metric-subtext">All essential health needs covered</div>
          </div>

          {/* Metric 2: Partial */}
          <div className="metric-pill-card amber">
            <div className="metric-top-row">
              <div className="metric-icon-circle">
                <AlertCircle size={15} />
              </div>
              <div className="metric-value-label">
                {summary.partial_count} Partial
              </div>
            </div>
            <div className="metric-subtext">Some benefits not covered</div>
          </div>

          {/* Metric 3: Not covered */}
          <div className="metric-pill-card red">
            <div className="metric-top-row">
              <div className="metric-icon-circle">
                <X size={15} />
              </div>
              <div className="metric-value-label">
                {summary.not_covered_count} Not covered
              </div>
            </div>
            <div className="metric-subtext">All members have at least one coverage</div>
          </div>

          {/* Metric 4: Unknown */}
          <div className="metric-pill-card gray">
            <div className="metric-top-row">
              <div className="metric-icon-circle">
                <HelpCircle size={15} />
              </div>
              <div className="metric-value-label">
                {summary.unknown_count} Unknown
              </div>
            </div>
            <div className="metric-subtext">No unverified coverage</div>
          </div>
        </div>
      </section>

      {/* ---------------- 4. Family Members Carousel Section ---------------- */}
      <section style={{ marginBottom: 30 }}>
        <div className="family-section-head">
          <div>
            <h2 style={{ fontSize: 16.5, fontWeight: 800, color: "#0f1d38", margin: "0 0 2px" }}>
              Family members ({overview?.members.length ?? 0})
            </h2>
            <p style={{ fontSize: 12.5, color: "#64748b", margin: 0 }}>
              View each member&apos;s coverage status, linked policies, and key needs.
            </p>
          </div>
          <div>
            <select
              value={filterStatus}
              onChange={(e) => setFilterStatus(e.target.value)}
              style={{
                padding: "6px 12px",
                borderRadius: 8,
                border: "1px solid #cbd5e1",
                fontSize: 12.5,
                fontWeight: 600,
                color: "#334155",
                background: "#ffffff",
                outline: "none",
                cursor: "pointer",
              }}
            >
              <option value="all">All members</option>
              <option value="covered">Covered only</option>
              <option value="partial">Partial only</option>
              <option value="not_covered">Not covered only</option>
            </select>
          </div>
        </div>

        <div className="family-members-carousel">
          {filteredMembers.map((member) => {
            const isSelected = member.id === selectedMember?.id;
            const isPrimary = member.is_primary;
            const isSpouse = member.relation.toLowerCase() === "spouse";
            const isChild = member.relation.toLowerCase() === "child";

            return (
              <div
                key={member.id}
                className={`family-member-card ${isSelected ? "active" : ""}`}
                onClick={() => setSelectedMemberId(member.id)}
              >
                <div className="member-card-header">
                  {/* Avatar rendering with distinct styling */}
                  <div
                    className="member-avatar-fallback"
                    style={{
                      background: isChild ? "#fef3c7" : isSpouse ? "#ede9fe" : "#e0f2fe",
                      color: isChild ? "#b45309" : isSpouse ? "#6d28d9" : "#0284c7",
                    }}
                  >
                    {member.name.slice(0, 1).toUpperCase()}
                  </div>
                  <div className="member-header-meta">
                    <div className="member-name-row">
                      <span>{member.name}</span>
                      {isPrimary && (
                        <>
                          <span className="tag-badge primary">Primary</span>
                          <span className="tag-badge adult">Adult</span>
                        </>
                      )}
                      {isSpouse && <span className="tag-badge spouse">Spouse</span>}
                    </div>
                    <div className="member-sub-info">
                      {member.age_label || `${member.relation}`}
                    </div>
                  </div>
                </div>

                <div className="member-card-status-row">
                  <span className={`status-pill ${member.coverage_status.toLowerCase()}`}>
                    {member.coverage_status === "COVERED" && <Check size={12} />}
                    {member.coverage_status === "PARTIAL" && <AlertTriangle size={12} />}
                    {member.coverage_status === "NOT_COVERED" && <X size={12} />}
                    {member.coverage_status_label}
                  </span>
                  <span className="member-policy-count">
                    <Building2 size={12} /> {member.linked_policies?.length ?? 0} linked policy
                    {(member.linked_policies?.length ?? 0) === 1 ? "" : "ies"}
                  </span>
                </div>

                <ChevronRight
                  size={15}
                  style={{
                    position: "absolute",
                    right: 12,
                    top: "50%",
                    transform: "translateY(-50%)",
                    color: isSelected ? "#0284c7" : "#cbd5e1",
                  }}
                />
              </div>
            );
          })}

          {/* Add Family Member Card Button */}
          <div className="add-member-card" onClick={() => setShowAddModal(true)}>
            <div className="add-icon-circle">
              <Users size={18} />
            </div>
            <h4 className="add-member-title">Add family member</h4>
            <p className="add-member-desc">Spouse, children, or other dependents.</p>
            <button type="button" className="btn-add-member-pill">
              + Add member
            </button>
          </div>
        </div>
      </section>

      {/* ---------------- 5. Detailed Member Section ---------------- */}
      {selectedMember && (
        <section className="member-detail-container">
          {/* Member Header */}
          <div className="member-detail-header">
            <div className="detail-header-left">
              <div
                className="detail-avatar-fallback"
                style={{
                  background:
                    selectedMember.relation.toLowerCase() === "child"
                      ? "#fef3c7"
                      : selectedMember.relation.toLowerCase() === "spouse"
                      ? "#ede9fe"
                      : "#e0f2fe",
                  color:
                    selectedMember.relation.toLowerCase() === "child"
                      ? "#b45309"
                      : selectedMember.relation.toLowerCase() === "spouse"
                      ? "#6d28d9"
                      : "#0284c7",
                }}
              >
                {selectedMember.name.slice(0, 1).toUpperCase()}
              </div>
              <div>
                <div className="detail-title-row">
                  <span className="detail-name">{selectedMember.name}</span>
                  <span
                    className={`status-pill ${selectedMember.coverage_status.toLowerCase()}`}
                  >
                    {selectedMember.coverage_status === "COVERED" && <Check size={12} />}
                    {selectedMember.coverage_status === "PARTIAL" && (
                      <AlertTriangle size={12} />
                    )}
                    {selectedMember.coverage_status === "NOT_COVERED" && <X size={12} />}
                    {selectedMember.coverage_status_label}
                  </span>
                </div>
                <div style={{ fontSize: 13, color: "#475569", fontWeight: 600, marginBottom: 2 }}>
                  {selectedMember.age !== null
                    ? `${selectedMember.age} years old • ${selectedMember.relation}`
                    : selectedMember.relation}
                </div>
                <p className="detail-subtitle">
                  {selectedMember.coverage_subtitle ||
                    "Manage policies and evaluate eligibility for this dependent."}
                </p>
              </div>
            </div>

            <div className="detail-header-actions">
              <button
                type="button"
                className="btn-outline-white"
                onClick={() => setShowManageCoverageModal(true)}
              >
                <Link2 size={15} /> Manage Coverage
              </button>
              <button
                type="button"
                className="btn-outline-white"
                onClick={openEditModal}
              >
                <Edit3 size={15} /> Edit Details
              </button>
              {(!selectedMember.is_primary || (overview?.members.filter((m) => m.is_primary).length ?? 0) > 1) && (
                <button
                  type="button"
                  className="btn-outline-white"
                  title="Remove member"
                  onClick={() => setShowDeleteConfirm(true)}
                >
                  <MoreHorizontal size={16} />
                </button>
              )}
            </div>
          </div>

          {/* Tab Navigation Bar */}
          <div className="detail-tabs-bar">
            <button
              type="button"
              className={`detail-tab-button ${activeTab === "overview" ? "active" : ""}`}
              onClick={() => setActiveTab("overview")}
            >
              Coverage Overview
            </button>
            <button
              type="button"
              className={`detail-tab-button ${activeTab === "policies" ? "active" : ""}`}
              onClick={() => setActiveTab("policies")}
            >
              Linked Policies ({selectedPolicies.length})
            </button>
            <button
              type="button"
              className={`detail-tab-button ${activeTab === "eligibility" ? "active" : ""}`}
              onClick={() => setActiveTab("eligibility")}
            >
              Benefit Eligibility
            </button>
            <button
              type="button"
              className={`detail-tab-button ${activeTab === "needs" ? "active" : ""}`}
              onClick={() => setActiveTab("needs")}
            >
              Needs &amp; Recommendations
            </button>
          </div>

          {/* TAB 1: Coverage Overview */}
          {activeTab === "overview" && (
            <div className="overview-grid">
              {/* Left Column: Coverage by benefit area */}
              <div className="benefit-table-card">
                <div className="benefit-table-head">
                  <h4 className="benefit-table-title">Coverage by benefit area</h4>
                  <p className="benefit-table-sub">
                    Shows which benefits are covered for {selectedMember.name} based on linked policies.
                  </p>
                </div>

                <div>
                  {selectedBenefits.map((b) => (
                    <div key={b.benefit_key} className="benefit-row-item">
                      <div className="benefit-item-left">
                        <div className="benefit-icon-box">{getBenefitIcon(b.benefit_key)}</div>
                        <span className="benefit-name">{b.name}</span>
                      </div>

                      <div className="benefit-item-center">
                        <span className={`status-pill ${b.status.toLowerCase()}`}>
                          {b.status === "COVERED" && <Check size={11} />}
                          {b.status === "PARTIAL" && <AlertTriangle size={11} />}
                          {b.status === "NOT_COVERED" && <X size={11} />}
                          {b.status_label}
                        </span>
                      </div>

                      <div className="benefit-item-right">
                        <span>{b.note || b.policy_name}</span>
                        <ChevronRight size={14} style={{ color: "#94a3b8", flexShrink: 0 }} />
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Right Column: Policies, Unmet Needs, AI Insights */}
              <div className="right-column-widgets">
                {/* 1. Linked Policies */}
                <div className="linked-policy-box">
                  <div className="linked-policy-head">
                    <h4 className="linked-policy-title">
                      Linked policies for {selectedMember.name} ({selectedPolicies.length})
                    </h4>
                    <button
                      type="button"
                      className="btn-link-policy-text"
                      onClick={() => setShowManageCoverageModal(true)}
                    >
                      Link another policy
                    </button>
                  </div>

                  {selectedPolicies.length > 0 ? (
                    selectedPolicies.map((p) => (
                      <div key={p.id} className="policy-item-card">
                        <div className="policy-icon-square">
                          <Building2 size={18} />
                        </div>
                        <div className="policy-meta-wrap">
                          <div className="policy-name-row">
                            <span className="policy-card-name">{p.policy_name}</span>
                            <span className="badge-active-green">● Active</span>
                          </div>
                          <p className="policy-card-desc">
                            {p.coverage_summary || "Covers essential health and medical treatments."}
                          </p>
                        </div>
                        <ChevronRight size={15} style={{ color: "#94a3b8", marginTop: 4 }} />
                      </div>
                    ))
                  ) : (
                    <div
                      style={{
                        padding: "16px",
                        textAlign: "center",
                        background: "#f8fafc",
                        borderRadius: 10,
                        fontSize: 12.5,
                        color: "#64748b",
                      }}
                    >
                      No policies linked yet. Click &quot;Link another policy&quot; to associate coverage.
                    </div>
                  )}
                </div>

                {/* 2. Unmet or uncertain needs */}
                {selectedUnmetNeeds.length > 0 && (
                  <div className="alert-unmet-needs">
                    <div className="alert-needs-head">
                      <AlertCircle size={17} />
                      <span>Unmet or uncertain needs</span>
                    </div>
                    {selectedUnmetNeeds.map((un) => (
                      <div key={un.id} style={{ marginBottom: 8 }}>
                        <div style={{ fontSize: 13, fontWeight: 700, color: "#991b1b" }}>
                          {un.title}
                        </div>
                        <p className="alert-needs-text">{un.description}</p>
                      </div>
                    ))}
                    <Link
                      href={selectedUnmetNeeds[0]?.action_url || "/products/compare"}
                      className="btn-explore-pink"
                    >
                      Explore options <ArrowRight size={13} />
                    </Link>
                  </div>
                )}

                {/* 3. AI insights & recommendations */}
                <div className="ai-insights-box">
                  <div className="ai-insights-head">
                    <Image
                      src="/mascot-logo.png"
                      alt="INSSURA Mascot"
                      width={20}
                      height={20}
                      style={{ objectFit: "contain" }}
                    />
                    <span>AI insights &amp; recommendations</span>
                  </div>

                  {selectedInsights.map((ins) => (
                    <div key={ins.id} className="ai-insight-item-row">
                      <div className="ai-number-bubble">{ins.order}</div>
                      <div className="ai-insight-content">
                        <h5 className="ai-insight-title">{ins.title}</h5>
                        <p className="ai-insight-desc">{ins.description}</p>
                        <Link
                          href={ins.action_url}
                          style={{
                            display: "inline-flex",
                            alignItems: "center",
                            gap: 4,
                            fontSize: 11.5,
                            fontWeight: 700,
                            color: "#0284c7",
                            textDecoration: "none",
                          }}
                        >
                          {ins.action_label} <ArrowRight size={12} />
                        </Link>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* TAB 2: Linked Policies List */}
          {activeTab === "policies" && (
            <div>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
                <div>
                  <h3 style={{ fontSize: 15, fontWeight: 800, color: "#0f1d38", margin: "0 0 2px" }}>
                    Policies Linked to {selectedMember.name}
                  </h3>
                  <p style={{ fontSize: 12.5, color: "#64748b", margin: 0 }}>
                    Manage policy memberships, verification status, and coverage roles.
                  </p>
                </div>
                <button
                  type="button"
                  className="btn-primary-blue"
                  onClick={() => setShowManageCoverageModal(true)}
                >
                  <Plus size={15} /> Link Policy
                </button>
              </div>

              {selectedPolicies.length > 0 ? (
                <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                  {selectedPolicies.map((p) => (
                    <div
                      key={p.id}
                      style={{
                        border: "1px solid #e2e8f0",
                        borderRadius: 14,
                        padding: "16px 20px",
                        background: "#ffffff",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                        boxShadow: "0 1px 3px rgba(0,0,0,0.02)",
                      }}
                    >
                      <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
                        <div
                          style={{
                            width: 44,
                            height: 44,
                            borderRadius: 10,
                            background: "#e0f2fe",
                            color: "#0284c7",
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                          }}
                        >
                          <Building2 size={22} />
                        </div>
                        <div>
                          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                            <span style={{ fontSize: 15, fontWeight: 800, color: "#0f1d38" }}>
                              {p.policy_name}
                            </span>
                            <span className="badge-active-green">Active</span>
                            <span
                              style={{
                                fontSize: 11,
                                fontWeight: 700,
                                background: "#f1f5f9",
                                color: "#475569",
                                padding: "2px 8px",
                                borderRadius: 6,
                              }}
                            >
                              Role: {p.coverage_role}
                            </span>
                          </div>
                          <div style={{ fontSize: 12.5, color: "#64748b", marginTop: 3 }}>
                            Provider: <strong>{p.provider_name}</strong> · Number: {p.policy_number_masked || "Verified member"}
                          </div>
                          {p.coverage_summary && (
                            <p style={{ fontSize: 12, color: "#475569", margin: "6px 0 0" }}>
                              {p.coverage_summary}
                            </p>
                          )}
                        </div>
                      </div>

                      <div>
                        <button
                          type="button"
                          className="btn-outline-white"
                          style={{ color: "#dc2626", borderColor: "#fecaca" }}
                          onClick={() => handleUnlinkPolicy(p.id)}
                        >
                          <Trash2 size={14} /> Unlink
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div
                  style={{
                    padding: "40px 20px",
                    textAlign: "center",
                    border: "1px dashed #cbd5e1",
                    borderRadius: 14,
                    background: "#f8fafc",
                  }}
                >
                  <Building2 size={32} style={{ color: "#94a3b8", margin: "0 auto 10px" }} />
                  <h4 style={{ margin: "0 0 4px", fontSize: 14, fontWeight: 700 }}>
                    No Policies Linked
                  </h4>
                  <p style={{ margin: "0 0 16px", fontSize: 12.5, color: "#64748b" }}>
                    Link an active policy to verify coverage and calculate eligibility rules.
                  </p>
                  <button
                    type="button"
                    className="btn-primary-blue"
                    onClick={() => setShowManageCoverageModal(true)}
                  >
                    <Plus size={15} /> Link Policy
                  </button>
                </div>
              )}
            </div>
          )}

          {/* TAB 3: Benefit Eligibility Rules */}
          {activeTab === "eligibility" && (
            <div>
              <div style={{ marginBottom: 18 }}>
                <h3 style={{ fontSize: 15, fontWeight: 800, color: "#0f1d38", margin: "0 0 2px" }}>
                  Documented Eligibility Rules for {selectedMember.name}
                </h3>
                <p style={{ fontSize: 12.5, color: "#64748b", margin: 0 }}>
                  Evaluated deterministically according to policy-specific dependent terms.
                </p>
              </div>

              <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                {selectedRules.map((rule) => {
                  const isEligible = rule.status === "ELIGIBLE";
                  const isConditional = rule.status === "CONDITIONALLY_ELIGIBLE";
                  const isIneligible = rule.status === "INELIGIBLE";

                  return (
                    <div
                      key={rule.id}
                      style={{
                        border: "1px solid #e2e8f0",
                        borderRadius: 12,
                        padding: "16px 18px",
                        background: "#ffffff",
                        display: "flex",
                        alignItems: "flex-start",
                        justifyContent: "space-between",
                        gap: 16,
                      }}
                    >
                      <div style={{ display: "flex", alignItems: "flex-start", gap: 12 }}>
                        <div
                          style={{
                            width: 32,
                            height: 32,
                            borderRadius: "50%",
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            flexShrink: 0,
                            background: isEligible ? "#ecfdf5" : isConditional ? "#fffbeb" : "#fee2e2",
                            color: isEligible ? "#059669" : isConditional ? "#d97706" : "#dc2626",
                          }}
                        >
                          {isEligible && <Check size={16} />}
                          {isConditional && <AlertTriangle size={16} />}
                          {isIneligible && <X size={16} />}
                        </div>
                        <div>
                          <div style={{ fontSize: 14, fontWeight: 800, color: "#0f1d38" }}>
                            {rule.rule_name}
                          </div>
                          <div style={{ fontSize: 12, color: "#64748b", margin: "2px 0 6px" }}>
                            Condition: <strong>{rule.condition}</strong>
                          </div>
                          <div style={{ fontSize: 12.5, color: "#334155" }}>
                            {rule.notes}
                          </div>
                        </div>
                      </div>

                      <span
                        className={`status-pill ${
                          isEligible ? "covered" : isConditional ? "partial" : "not_covered"
                        }`}
                      >
                        {rule.status}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* TAB 4: Needs & Recommendations */}
          {activeTab === "needs" && (
            <div>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 18 }}>
                <div>
                  <h3 style={{ fontSize: 15, fontWeight: 800, color: "#0f1d38", margin: "0 0 2px" }}>
                    Family Protection Analyzer Intelligence
                  </h3>
                  <p style={{ fontSize: 12.5, color: "#64748b", margin: 0 }}>
                    Techniques: Relationship modeling, policy eligibility rules, needs assessment, contextual explanations.
                  </p>
                </div>
                <button
                  type="button"
                  className="btn-outline-white"
                  onClick={handleRunAnalyzer}
                  disabled={analyzing}
                >
                  <RefreshCw size={14} className={analyzing ? "animate-spin" : ""} />
                  {analyzing ? "Analyzing..." : "Re-run Analyzer"}
                </button>
              </div>

              {/* Unmet Needs */}
              <div style={{ marginBottom: 20 }}>
                <h4 style={{ fontSize: 13.5, fontWeight: 800, color: "#991b1b", marginBottom: 10 }}>
                  Identified Needs &amp; Potential Gaps
                </h4>
                {selectedUnmetNeeds.length > 0 ? (
                  <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                    {selectedUnmetNeeds.map((n) => (
                      <div
                        key={n.id}
                        style={{
                          border: "1px solid #fecaca",
                          borderRadius: 12,
                          padding: "14px 16px",
                          background: "#fef2f2",
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "space-between",
                        }}
                      >
                        <div>
                          <div style={{ fontSize: 13.5, fontWeight: 800, color: "#7f1d1d" }}>
                            {n.title}
                          </div>
                          <div style={{ fontSize: 12, color: "#991b1b", marginTop: 2 }}>
                            {n.description}
                          </div>
                        </div>
                        <Link
                          href={n.action_url}
                          className="btn-primary-blue"
                          style={{ padding: "6px 14px", fontSize: 12 }}
                        >
                          {n.action_label} <ArrowRight size={13} />
                        </Link>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div
                    style={{
                      padding: "16px",
                      background: "#ecfdf5",
                      border: "1px solid #d1fae5",
                      borderRadius: 10,
                      fontSize: 12.5,
                      color: "#065f46",
                    }}
                  >
                    No immediate protection gaps detected for {selectedMember.name}.
                  </div>
                )}
              </div>

              {/* AI Recommendations */}
              <div>
                <h4 style={{ fontSize: 13.5, fontWeight: 800, color: "#0284c7", marginBottom: 10 }}>
                  Contextual AI Guidance &amp; Insights
                </h4>
                <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                  {selectedInsights.map((ins) => (
                    <div
                      key={ins.id}
                      style={{
                        border: "1px solid #bae6fd",
                        borderRadius: 12,
                        padding: "14px 16px",
                        background: "#f0f9ff",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                      }}
                    >
                      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                        <div
                          style={{
                            width: 26,
                            height: 26,
                            borderRadius: "50%",
                            background: "#0284c7",
                            color: "#ffffff",
                            fontSize: 12,
                            fontWeight: 800,
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                          }}
                        >
                          {ins.order}
                        </div>
                        <div>
                          <div style={{ fontSize: 13.5, fontWeight: 800, color: "#0369a1" }}>
                            {ins.title}
                          </div>
                          <div style={{ fontSize: 12, color: "#0284c7", marginTop: 2 }}>
                            {ins.description}
                          </div>
                        </div>
                      </div>
                      <Link
                        href={ins.action_url}
                        style={{
                          display: "inline-flex",
                          alignItems: "center",
                          gap: 4,
                          fontSize: 12,
                          fontWeight: 700,
                          color: "#0284c7",
                          textDecoration: "none",
                        }}
                      >
                        {ins.action_label} <ArrowRight size={13} />
                      </Link>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
        </section>
      )}

      {/* ---------------- MODAL 1: Add Family Member ---------------- */}
      {showAddModal && (
        <div className="modal-overlay">
          <div className="modal-card">
            <div className="modal-header">
              <h3 className="modal-title">Add Family Member</h3>
              <button
                type="button"
                className="modal-close-btn"
                onClick={() => setShowAddModal(false)}
              >
                <X size={18} />
              </button>
            </div>
            <form onSubmit={handleAddMember}>
              <div className="modal-body">
                <div className="form-group">
                  <label className="form-label">Full Name *</label>
                  <input
                    type="text"
                    className="form-input"
                    placeholder="e.g. Alya Pratama"
                    value={addName}
                    onChange={(e) => setAddName(e.target.value)}
                    required
                  />
                </div>

                <div className="form-group">
                  <label className="form-label">Relationship *</label>
                  <select
                    className="form-select"
                    value={addRelation}
                    onChange={(e) => setAddRelation(e.target.value)}
                  >
                    <option value="Child">Child (Anak)</option>
                    <option value="Spouse">Spouse (Pasangan)</option>
                    <option value="Parent">Parent (Orang Tua)</option>
                    <option value="Other">Other Dependent (Tanggungan Lain)</option>
                  </select>
                </div>

                <div className="form-group">
                  <label className="form-label">Birth Date</label>
                  <input
                    type="date"
                    className="form-input"
                    value={addBirthDate}
                    onChange={(e) => setAddBirthDate(e.target.value)}
                  />
                  <span style={{ fontSize: 11, color: "#64748b" }}>
                    Used deterministically to evaluate child age limits and pediatric care rules.
                  </span>
                </div>

                <div className="form-group">
                  <label className="form-label">Gender</label>
                  <select
                    className="form-select"
                    value={addGender}
                    onChange={(e) => setAddGender(e.target.value)}
                  >
                    <option value="Female">Female</option>
                    <option value="Male">Male</option>
                    <option value="Prefer not to say">Prefer not to say</option>
                  </select>
                </div>

                <div className="form-group">
                  <label className="form-label">Occupation (Optional)</label>
                  <input
                    type="text"
                    className="form-input"
                    placeholder="e.g. Student, Employee"
                    value={addOccupation}
                    onChange={(e) => setAddOccupation(e.target.value)}
                  />
                </div>

                {/* Explicit Authorization & Consent Checkbox (REG-65) */}
                <div className="form-checkbox-row">
                  <input
                    type="checkbox"
                    id="consent_check"
                    checked={addConsent}
                    onChange={(e) => setAddConsent(e.target.checked)}
                    required
                    style={{ marginTop: 2 }}
                  />
                  <label htmlFor="consent_check" className="form-checkbox-label">
                    <strong>Explicit Authorization &amp; Consent:</strong> I confirm that I am authorized as the legal guardian / account holder to manage insurance records and evaluate protection needs for this dependent.
                  </label>
                </div>
              </div>

              <div className="modal-footer">
                <button
                  type="button"
                  className="btn-outline-white"
                  onClick={() => setShowAddModal(false)}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="btn-primary-blue"
                  disabled={modalBusy}
                >
                  {modalBusy ? "Adding..." : "Add Family Member"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ---------------- MODAL 2: Consent & Authorization ---------------- */}
      {showConsentModal && (
        <div className="modal-overlay">
          <div className="modal-card">
            <div className="modal-header">
              <h3 className="modal-title">Family Data Consent &amp; Authorization</h3>
              <button
                type="button"
                className="modal-close-btn"
                onClick={() => setShowConsentModal(false)}
              >
                <X size={18} />
              </button>
            </div>
            <form onSubmit={handleSaveConsent}>
              <div className="modal-body">
                <div
                  style={{
                    padding: 14,
                    background: "#f0f9ff",
                    border: "1px solid #bae6fd",
                    borderRadius: 10,
                    fontSize: 12.5,
                    color: "#0369a1",
                    lineHeight: 1.45,
                    display: "flex",
                    gap: 12,
                    alignItems: "center",
                  }}
                >
                  <Image
                    src="/mascot-shield.png"
                    alt="INSSURA Shield"
                    width={40}
                    height={40}
                    style={{ flexShrink: 0, objectFit: "contain" }}
                  />
                  <div>
                    <strong>Data Protection Notice (REG-65):</strong> INSSURA protects dependent records using minimal necessary data. Family coverage links require explicit subscriber authorization and parental consent for minors.
                  </div>
                </div>

                <div className="form-checkbox-row">
                  <input
                    type="checkbox"
                    id="consent_status"
                    checked={consentConfirmed}
                    onChange={(e) => setConsentConfirmed(e.target.checked)}
                    style={{ marginTop: 2 }}
                  />
                  <label htmlFor="consent_status" className="form-checkbox-label">
                    <strong>Active Dependent Authorization:</strong> Authorize INSSURA to link and evaluate insurance policies for all declared household members.
                  </label>
                </div>

                <div className="form-checkbox-row">
                  <input
                    type="checkbox"
                    id="guardian_status"
                    checked={consentLegalGuardian}
                    onChange={(e) => setConsentLegalGuardian(e.target.checked)}
                    style={{ marginTop: 2 }}
                  />
                  <label htmlFor="guardian_status" className="form-checkbox-label">
                    <strong>Parental / Legal Guardian Representation:</strong> Affirm that you have lawful parental or legal authority over minor children declared in this workspace.
                  </label>
                </div>

                <div style={{ fontSize: 12, color: "#64748b" }}>
                  Status: <strong>{consentConfirmed ? "AUTHORIZED" : "REVOKED"}</strong>
                </div>
              </div>

              <div className="modal-footer">
                <button
                  type="button"
                  className="btn-outline-white"
                  onClick={() => setShowConsentModal(false)}
                >
                  Close
                </button>
                <button
                  type="submit"
                  className="btn-primary-blue"
                  disabled={modalBusy}
                >
                  {modalBusy ? "Saving..." : "Save Authorization"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ---------------- MODAL 3: Manage Coverage (Link Policy) ---------------- */}
      {showManageCoverageModal && selectedMember && (
        <div className="modal-overlay">
          <div className="modal-card">
            <div className="modal-header">
              <h3 className="modal-title">Link Policy to {selectedMember.name}</h3>
              <button
                type="button"
                className="modal-close-btn"
                onClick={() => setShowManageCoverageModal(false)}
              >
                <X size={18} />
              </button>
            </div>
            <form onSubmit={handleLinkPolicy}>
              <div className="modal-body">
                <div className="form-group">
                  <label className="form-label">Policy Name *</label>
                  <input
                    type="text"
                    className="form-input"
                    value={linkPolicyName}
                    onChange={(e) => setLinkPolicyName(e.target.value)}
                    required
                  />
                </div>

                <div className="form-group">
                  <label className="form-label">Provider Name *</label>
                  <input
                    type="text"
                    className="form-input"
                    value={linkProviderName}
                    onChange={(e) => setLinkProviderName(e.target.value)}
                    required
                  />
                </div>

                <div className="form-group">
                  <label className="form-label">Policy Type</label>
                  <select
                    className="form-select"
                    value={linkPolicyType}
                    onChange={(e) => setLinkPolicyType(e.target.value)}
                  >
                    <option value="EMPLOYER_GROUP">Employer Group Insurance</option>
                    <option value="PRIVATE_HEALTH">Private Health Insurance</option>
                    <option value="NATIONAL_HEALTH">National Health (BPJS/Medicare)</option>
                    <option value="TRAVEL">Travel / International</option>
                  </select>
                </div>

                <div className="form-group">
                  <label className="form-label">Coverage Role</label>
                  <select
                    className="form-select"
                    value={linkCoverageRole}
                    onChange={(e) => setLinkCoverageRole(e.target.value)}
                  >
                    <option value="DEPENDENT">Dependent</option>
                    <option value="CHILD">Child Dependent</option>
                    <option value="SPOUSE">Spouse Dependent</option>
                    <option value="PRIMARY">Primary Insured</option>
                  </select>
                </div>

                <div className="form-group">
                  <label className="form-label">Coverage Summary</label>
                  <input
                    type="text"
                    className="form-input"
                    value={linkSummary}
                    onChange={(e) => setLinkSummary(e.target.value)}
                  />
                </div>

                <div className="form-group">
                  <label className="form-label">Covered Benefit Areas for {selectedMember.name}:</label>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginTop: 4 }}>
                    <label style={{ fontSize: 12.5, display: "flex", alignItems: "center", gap: 6 }}>
                      <input
                        type="checkbox"
                        checked={linkCoverInpatient}
                        onChange={(e) => setLinkCoverInpatient(e.target.checked)}
                      />
                      Inpatient care
                    </label>
                    <label style={{ fontSize: 12.5, display: "flex", alignItems: "center", gap: 6 }}>
                      <input
                        type="checkbox"
                        checked={linkCoverOutpatient}
                        onChange={(e) => setLinkCoverOutpatient(e.target.checked)}
                      />
                      Outpatient care
                    </label>
                    <label style={{ fontSize: 12.5, display: "flex", alignItems: "center", gap: 6 }}>
                      <input
                        type="checkbox"
                        checked={linkCoverEmergency}
                        onChange={(e) => setLinkCoverEmergency(e.target.checked)}
                      />
                      Emergency care
                    </label>
                    <label style={{ fontSize: 12.5, display: "flex", alignItems: "center", gap: 6 }}>
                      <input
                        type="checkbox"
                        checked={linkCoverDental}
                        onChange={(e) => setLinkCoverDental(e.target.checked)}
                      />
                      Dental care
                    </label>
                    <label style={{ fontSize: 12.5, display: "flex", alignItems: "center", gap: 6 }}>
                      <input
                        type="checkbox"
                        checked={linkCoverOptical}
                        onChange={(e) => setLinkCoverOptical(e.target.checked)}
                      />
                      Optical care
                    </label>
                    <label style={{ fontSize: 12.5, display: "flex", alignItems: "center", gap: 6 }}>
                      <input
                        type="checkbox"
                        checked={linkOpticalLimit}
                        onChange={(e) => setLinkOpticalLimit(e.target.checked)}
                      />
                      Optical has limit
                    </label>
                  </div>
                </div>
              </div>

              <div className="modal-footer">
                <button
                  type="button"
                  className="btn-outline-white"
                  onClick={() => setShowManageCoverageModal(false)}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="btn-primary-blue"
                  disabled={modalBusy}
                >
                  {modalBusy ? "Linking..." : "Link Policy"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ---------------- MODAL 4: Edit Details ---------------- */}
      {showEditMemberModal && selectedMember && (
        <div className="modal-overlay">
          <div className="modal-card">
            <div className="modal-header">
              <h3 className="modal-title">Edit Details for {selectedMember.name}</h3>
              <button
                type="button"
                className="modal-close-btn"
                onClick={() => setShowEditMemberModal(false)}
              >
                <X size={18} />
              </button>
            </div>
            <form onSubmit={handleUpdateMember}>
              <div className="modal-body">
                <div className="form-group">
                  <label className="form-label">Full Name</label>
                  <input
                    type="text"
                    className="form-input"
                    value={editName}
                    onChange={(e) => setEditName(e.target.value)}
                  />
                </div>

                <div className="form-group">
                  <label className="form-label">Relationship</label>
                  {selectedMember.is_primary ? (
                    <input
                      type="text"
                      className="form-input"
                      value="Primary (Diri Sendiri)"
                      disabled
                      style={{ background: "#f1f5f9", cursor: "not-allowed" }}
                    />
                  ) : (
                    <select
                      className="form-select"
                      value={editRelation}
                      onChange={(e) => setEditRelation(e.target.value)}
                    >
                      <option value="Child">Child</option>
                      <option value="Spouse">Spouse</option>
                      <option value="Parent">Parent</option>
                      <option value="Other">Other</option>
                    </select>
                  )}
                </div>

                <div className="form-group">
                  <label className="form-label">Birth Date</label>
                  <input
                    type="date"
                    className="form-input"
                    value={editBirthDate}
                    onChange={(e) => setEditBirthDate(e.target.value)}
                  />
                </div>

                <div className="form-group">
                  <label className="form-label">Occupation</label>
                  <input
                    type="text"
                    className="form-input"
                    value={editOccupation}
                    onChange={(e) => setEditOccupation(e.target.value)}
                  />
                </div>

                <div className="form-group">
                  <label className="form-label">Notes</label>
                  <textarea
                    className="form-textarea"
                    rows={3}
                    value={editNotes}
                    onChange={(e) => setEditNotes(e.target.value)}
                  />
                </div>
              </div>

              <div className="modal-footer">
                <button
                  type="button"
                  className="btn-outline-white"
                  onClick={() => setShowEditMemberModal(false)}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="btn-primary-blue"
                  disabled={modalBusy}
                >
                  {modalBusy ? "Saving..." : "Save Changes"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ---------------- MODAL 5: Delete Confirmation ---------------- */}
      {showDeleteConfirm && selectedMember && (
        <div className="modal-overlay">
          <div className="modal-card" style={{ maxWidth: 440 }}>
            <div className="modal-header">
              <h3 className="modal-title">Remove Family Member</h3>
              <button
                type="button"
                className="modal-close-btn"
                onClick={() => setShowDeleteConfirm(false)}
              >
                <X size={18} />
              </button>
            </div>
            <div className="modal-body">
              <p style={{ margin: 0, fontSize: 13.5, color: "#475569", lineHeight: 1.5 }}>
                Are you sure you want to remove <strong>{selectedMember.name}</strong> from family protection? This will also unlink any associated policy coverage records.
              </p>
            </div>
            <div className="modal-footer">
              <button
                type="button"
                className="btn-outline-white"
                onClick={() => setShowDeleteConfirm(false)}
              >
                Cancel
              </button>
              <button
                type="button"
                className="btn-primary-blue"
                style={{ background: "#dc2626" }}
                onClick={handleDeleteMember}
                disabled={modalBusy}
              >
                {modalBusy ? "Removing..." : "Remove Member"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// Tooth / Smile icon for dental care
function SmileIcon({ size = 16 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M12 2C8 2 6 5 6 9c0 4 2 13 4 13s2-6 2-6 0 6 2 6 4-9 4-13c0-4-2-7-6-7z" />
    </svg>
  );
}
