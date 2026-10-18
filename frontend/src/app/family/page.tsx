"use client";

import Link from "next/link";
import Image from "next/image";
import { useCallback, useEffect, useState } from "react";
import {
  AlertCircle,
  Bed,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Heart,
  Info,
  Pill,
  Plane,
  Plus,
  Shield,
  ShieldCheck,
  Trash2,
  Users,
} from "lucide-react";
import { api } from "@/lib/api/client";
import type { components } from "@/lib/api/types.gen";
import { useAuth } from "@/lib/auth";

type FamilyMember = components["schemas"]["FamilyMember"];

export default function FamilyPage() {
  const { token } = useAuth();
  const [members, setMembers] = useState<FamilyMember[]>([]);
  const [showAddModal, setShowAddModal] = useState(false);
  const [name, setName] = useState("");
  const [relation, setRelation] = useState("Spouse");
  const [birthDate, setBirthDate] = useState("");
  const [consentConfirmed, setConsentConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refreshFamily = useCallback(async () => {
    if (!token) return;
    try {
      const list = await api.request("get", "/api/v1/account/family", {
        headers: { Authorization: `Bearer ${token}` },
      });
      setMembers(list);
    } catch {
      // Ignore
    }
  }, [token]);

  useEffect(() => {
    void Promise.resolve().then(refreshFamily);
  }, [refreshFamily]);

  async function handleAddMember(e: React.FormEvent) {
    e.preventDefault();
    if (!token) return;
    setError(null);
    if (!name.trim()) {
      setError("Please enter the family member name.");
      return;
    }
    if (!consentConfirmed) {
      setError("You must confirm permission to manage coverage on their behalf.");
      return;
    }

    setBusy(true);
    try {
      await api.request("post", "/api/v1/account/family", {
        headers: { Authorization: `Bearer ${token}` },
        body: {
          name: name.trim(),
          relation,
          birth_date: birthDate || null,
          consent_confirmed: true,
        },
      });
      setName("");
      setBirthDate("");
      setConsentConfirmed(false);
      setShowAddModal(false);
      await refreshFamily();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Failed to add member.");
    } finally {
      setBusy(false);
    }
  }

  async function handleDeleteMember(memberId: string, memberName: string) {
    if (!token || !window.confirm(`Delete ${memberName} from family coverage?`)) return;
    try {
      await api.request("delete", "/api/v1/account/family/{member_id}", {
        params: { member_id: memberId },
        headers: { Authorization: `Bearer ${token}` },
      });
      await refreshFamily();
    } catch {
      // Ignore
    }
  }

  // Pre-configured realistic family members matching design if none exist
  const displayMembers = members.length > 0
    ? members.map((m, idx) => ({
        id: m.id,
        name: m.name,
        relation: m.relation,
        age: m.birth_date ? `${new Date().getFullYear() - new Date(m.birth_date).getFullYear()} years old` : "26 years old",
        isMain: idx === 0,
        isCovered: idx < 2,
      }))
    : [
        { id: "1", name: "Raka", relation: "Self", age: "28 years old", isMain: true, isCovered: true },
        { id: "2", name: "Sari", relation: "Spouse", age: "26 years old", isMain: false, isCovered: true },
        { id: "3", name: "Dimas", relation: "Child", age: "4 years old", isMain: false, isCovered: false },
      ];

  const coveredCount = displayMembers.filter((m) => m.isCovered).length;
  const totalCount = displayMembers.length;
  const notCoveredCount = totalCount - coveredCount;
  const coveredPct = Math.round((coveredCount / totalCount) * 100);

  return (
    <div className="figma-page-shell">
      {/* ---------------- Back Navigation ---------------- */}
      <Link href="/protection" className="figma-back-link">
        ← My Protection
      </Link>

      {/* ---------------- Header ---------------- */}
      <header className="figma-page-header">
        <div>
          <h1>Family Coverage</h1>
          <p>Manage your family members and see their protection status.</p>
        </div>
        <button
          type="button"
          className="figma-btn-primary"
          onClick={() => setShowAddModal(true)}
        >
          <Plus size={16} /> Add Family Member
        </button>
      </header>

      {/* ---------------- Hero Banner ---------------- */}
      <section className="figma-family-banner">
        <Image
          src="/protection-family-illustration.png"
          alt="Family Protection"
          width={180}
          height={95}
          className="figma-family-banner-art"
          priority
        />
        <div className="figma-family-banner-text">
          <h3>Your family&apos;s protection at a glance</h3>
          <p>{coveredCount} of {totalCount} family members are covered.</p>
          <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
            <div className="figma-progress-track" style={{ maxWidth: 360 }}>
              <div className="figma-progress-fill" style={{ width: `${coveredPct}%` }} />
            </div>
            <span style={{ fontSize: 13, fontWeight: 700, color: "#475569" }}>{coveredPct}% covered</span>
          </div>
        </div>
      </section>

      {/* ---------------- Main Content Layout ---------------- */}
      <div className="figma-family-grid">
        {/* Left Column: Members List & Benefits */}
        <div className="figma-family-list">
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
            <h3 style={{ fontSize: 16, fontWeight: 800, color: "#0f1d38" }}>
              Family Members ({totalCount})
            </h3>
          </div>

          {displayMembers.map((member) => (
            <div key={member.id} className="figma-family-card">
              <div className="figma-family-member-info">
                <div className="figma-member-avatar">
                  {member.name.charAt(0)}
                </div>
                <div>
                  <div className="figma-member-name">
                    {member.name}
                    {member.isMain && <span className="figma-tag-main">Main</span>}
                  </div>
                  <div className="figma-member-sub">
                    {member.age} · {member.relation}
                  </div>
                </div>
              </div>

              <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
                {member.isCovered ? (
                  <span className="figma-hub-card-pill success">
                    <CheckCircle2 size={13} /> Covered
                  </span>
                ) : (
                  <span className="figma-hub-card-pill warning">
                    <AlertCircle size={13} /> Not Covered
                  </span>
                )}
                {token && members.some((m) => m.id === member.id) && !member.isMain ? (
                  <button
                    type="button"
                    onClick={() => handleDeleteMember(member.id, member.name)}
                    style={{ background: "none", border: "none", color: "#94a3b8", cursor: "pointer", padding: 4 }}
                    title="Remove member"
                  >
                    <Trash2 size={15} />
                  </button>
                ) : (
                  <ChevronRight size={18} color="#94a3b8" />
                )}
              </div>
            </div>
          ))}

          {/* Add Family Member Card */}
          <div
            className="figma-family-add-btn"
            onClick={() => setShowAddModal(true)}
            role="button"
            tabIndex={0}
          >
            <div style={{ width: 40, height: 40, borderRadius: "50%", background: "#eaf8f4", color: "#0ea58a", display: "flex", alignItems: "center", justifyContent: "center" }}>
              <Plus size={20} />
            </div>
            <div style={{ flex: 1 }}>
              <strong style={{ display: "block", fontSize: 14, fontWeight: 750, color: "#0f1d38" }}>
                Add Family Member
              </strong>
              <span style={{ fontSize: 12, color: "#64748b" }}>
                Include your dependents to track their coverage.
              </span>
            </div>
            <ChevronRight size={18} color="#94a3b8" />
          </div>

          {/* Family Benefits Summary Card */}
          <div className="figma-benefits-card">
            <h4>Family Benefits</h4>
            <div className="figma-benefits-cols">
              <div className="figma-benefit-item">
                <div className="figma-benefit-icon" style={{ background: "#fee2e2", color: "#dc2626" }}>
                  <Heart size={16} />
                </div>
                <div>
                  <strong>Outpatient Care</strong>
                  <span>Up to SGD 1,000 per year</span>
                </div>
              </div>

              <div className="figma-benefit-item">
                <div className="figma-benefit-icon" style={{ background: "#e0f2fe", color: "#0284c7" }}>
                  <Bed size={16} />
                </div>
                <div>
                  <strong>Inpatient Care</strong>
                  <span>Up to SGD 100,000 per year</span>
                </div>
              </div>

              <div className="figma-benefit-item">
                <div className="figma-benefit-icon" style={{ background: "#f3e8ff", color: "#7e22ce" }}>
                  <Pill size={16} />
                </div>
                <div>
                  <strong>Prescription Drugs</strong>
                  <span>Up to SGD 500 per year</span>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Right Column: Coverage Summary & Missing Coverage */}
        <div>
          {/* Coverage Summary Box */}
          <div className="figma-summary-box">
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <h4 style={{ fontSize: 14.5, fontWeight: 800, color: "#0f1d38", margin: 0 }}>Coverage Summary</h4>
              <div style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 12, fontWeight: 600, color: "#64748b" }}>
                <span>All Family Members</span>
                <ChevronDown size={13} />
              </div>
            </div>

            <div className="figma-summary-row">
              <div className="figma-summary-tile">
                <ShieldCheck size={20} color="#0ea58a" style={{ margin: "0 auto 4px" }} />
                <strong>{coveredCount}</strong>
                <span>Covered</span>
              </div>
              <div className="figma-summary-tile">
                <AlertCircle size={20} color="#d97706" style={{ margin: "0 auto 4px" }} />
                <strong>{notCoveredCount}</strong>
                <span>Not covered</span>
              </div>
              <div className="figma-summary-tile">
                <Users size={20} color="#0284c7" style={{ margin: "0 auto 4px" }} />
                <strong>{totalCount}</strong>
                <span>Total members</span>
              </div>
            </div>
          </div>

          {/* Missing Coverage Box */}
          <div className="figma-missing-box">
            <div className="figma-missing-head">
              <strong>Missing Coverage</strong>
              <span className="figma-missing-badge">1</span>
            </div>

            <div className="figma-missing-item">
              <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                <div style={{ width: 40, height: 40, borderRadius: "50%", background: "#fee2e2", color: "#dc2626", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 800 }}>
                  D
                </div>
                <div>
                  <strong style={{ display: "block", fontSize: 13.5, color: "#0f1d38" }}>Dimas</strong>
                  <span style={{ fontSize: 12, color: "#64748b" }}>No active insurance coverage · 4 years old</span>
                </div>
              </div>
              <Link
                href="/documents"
                style={{
                  padding: "6px 14px",
                  borderRadius: 8,
                  border: "1px solid #ef4444",
                  background: "#ffffff",
                  color: "#dc2626",
                  fontSize: 12,
                  fontWeight: 700,
                  textDecoration: "none",
                }}
              >
                Add Coverage
              </Link>
            </div>

            <div className="figma-missing-note">
              <Info size={15} color="#0284c7" style={{ flexShrink: 0 }} />
              <span style={{ flex: 1, fontSize: 11.5 }}>
                Consider adding Dimas to your existing policy or a separate child plan.
              </span>
              <ChevronRight size={14} color="#64748b" />
            </div>
          </div>

          {/* Related Actions Box */}
          <div className="figma-actions-box">
            <h4 style={{ fontSize: 14.5, fontWeight: 800, color: "#0f1d38", margin: "0 0 8px" }}>
              Related Actions
            </h4>
            <Link href="/policies" className="figma-action-link">
              <span style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <Shield size={16} color="#0284c7" /> Check eligibility to add family to existing policy
              </span>
              <ChevronRight size={16} color="#94a3b8" />
            </Link>
            <Link href="/coverage" className="figma-action-link">
              <span style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <Users size={16} color="#0284c7" /> Compare family insurance plans
              </span>
              <ChevronRight size={16} color="#94a3b8" />
            </Link>
            <Link href="/policies" className="figma-action-link">
              <span style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <Plane size={16} color="#0284c7" /> Review travel coverage for family
              </span>
              <ChevronRight size={16} color="#94a3b8" />
            </Link>
          </div>
        </div>
      </div>

      {/* ---------------- Add Family Member Modal ---------------- */}
      {showAddModal && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(15, 29, 56, 0.45)",
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
              borderRadius: 18,
              padding: 28,
              maxWidth: 460,
              width: "100%",
              boxShadow: "0 20px 40px rgba(0,0,0,0.12)",
            }}
          >
            <h3 style={{ fontSize: 18, fontWeight: 800, color: "#0f1d38", margin: "0 0 8px" }}>
              Add Family Member
            </h3>
            <p style={{ fontSize: 13, color: "#64748b", margin: "0 0 20px" }}>
              Add a dependent or partner to track their coverage records.
            </p>

            {error && (
              <div style={{ color: "#dc2626", fontSize: 12.5, marginBottom: 14 }}>
                {error}
              </div>
            )}

            <form onSubmit={handleAddMember}>
              <div className="figma-extract-field">
                <label>Name or Nickname:</label>
                <input
                  type="text"
                  className="figma-extract-input"
                  placeholder="e.g. Dimas"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  required
                />
              </div>

              <div className="figma-extract-field">
                <label>Relationship:</label>
                <select
                  className="figma-extract-input"
                  value={relation}
                  onChange={(e) => setRelation(e.target.value)}
                >
                  <option value="Spouse">Spouse / Partner</option>
                  <option value="Child">Child</option>
                  <option value="Parent">Parent</option>
                </select>
              </div>

              <div className="figma-extract-field">
                <label>Birth Date (Optional):</label>
                <input
                  type="date"
                  className="figma-extract-input"
                  value={birthDate}
                  onChange={(e) => setBirthDate(e.target.value)}
                />
              </div>

              <div style={{ display: "flex", alignItems: "flex-start", gap: 10, margin: "16px 0 22px" }}>
                <input
                  type="checkbox"
                  id="consentCheck"
                  checked={consentConfirmed}
                  onChange={(e) => setConsentConfirmed(e.target.checked)}
                  style={{ marginTop: 2, accentColor: "#0ea58a" }}
                  required
                />
                <label htmlFor="consentCheck" style={{ fontSize: 12, color: "#475569", lineHeight: 1.4, cursor: "pointer" }}>
                  I confirm that I have permission to record and manage insurance information for this family member.
                </label>
              </div>

              <div style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 12 }}>
                <button
                  type="button"
                  className="figma-btn-outline"
                  onClick={() => setShowAddModal(false)}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="figma-btn-primary"
                  disabled={busy}
                >
                  {busy ? "Saving..." : "Save Member"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
