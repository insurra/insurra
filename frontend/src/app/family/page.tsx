"use client";

import Link from "next/link";
import Image from "next/image";
import { useCallback, useEffect, useState } from "react";
import {
  Clock,
  Plus,
  ShieldCheck,
  Trash2,
  User,
} from "lucide-react";
import { api } from "@/lib/api/client";
import type { components } from "@/lib/api/types.gen";
import { useAuth } from "@/lib/auth";
import { useUserContext } from "@/lib/user-context";

type FamilyMember = components["schemas"]["FamilyMember"];

export default function FamilyPage() {
  const { token } = useAuth();
  const userCtx = useUserContext();

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
      // Handled gracefully
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
      setShowAddModal(false);
      setName("");
      setBirthDate("");
      setConsentConfirmed(false);
      await refreshFamily();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to add family member.");
    } finally {
      setBusy(false);
    }
  }

  async function handleDeleteMember(memberId: string, memberName: string) {
    if (!token) return;
    if (!confirm(`Are you sure you want to remove ${memberName}?`)) return;
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

  const isSelfOnly = userCtx.householdScope === "self" && members.length === 0;

  // Build display members based on real backend data or declared onboarding context
  const displayMembers = members.length > 0
    ? members.map((m, idx) => ({
        id: m.id,
        name: m.name,
        relation: m.relation,
        age: m.birth_date
          ? `${new Date().getFullYear() - new Date(m.birth_date).getFullYear()} years old`
          : "Age unverified",
        isMain: idx === 0,
        coverageStatus: "Awaiting policy document",
      }))
    : userCtx.householdScope === "family"
    ? userCtx.dependents
        .filter((d) => d !== "None")
        .map((dep, idx) => ({
          id: `declared-${idx}`,
          name: dep,
          relation: dep,
          age: "Declared in onboarding",
          isMain: false,
          coverageStatus: "Declared (Unverified)",
        }))
    : [];

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
          <p>Manage your household members and inspect evidence-based protection status.</p>
        </div>
        <button
          type="button"
          className="figma-btn-primary"
          onClick={() => setShowAddModal(true)}
        >
          <Plus size={16} /> Add Family Member
        </button>
      </header>

      {/* ---------------- Self Only State ---------------- */}
      {isSelfOnly ? (
        <section
          style={{
            background: "#ffffff",
            border: "1px solid #e1ebed",
            borderRadius: 20,
            padding: 32,
            textAlign: "center",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: 16,
            maxWidth: 680,
            margin: "20px auto 40px",
          }}
        >
          <div
            style={{
              width: 56,
              height: 56,
              borderRadius: "50%",
              background: "#edf7f5",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: "#0ea58a",
            }}
          >
            <User size={28} />
          </div>
          <div>
            <h2 style={{ margin: "0 0 6px", fontSize: 18, fontWeight: 800, color: "#0f1d38" }}>
              You&apos;re currently managing protection for yourself.
            </h2>
            <p style={{ margin: 0, fontSize: 13.5, color: "#64748b", maxWidth: 460 }}>
              During onboarding, you selected personal protection only. If your household circumstances
              change, you can add family members to coordinate shared coverage and travel protection.
            </p>
          </div>
          <button
            type="button"
            className="figma-btn-primary"
            onClick={() => setShowAddModal(true)}
            style={{ marginTop: 8 }}
          >
            <Plus size={16} /> Add Household Member
          </button>
        </section>
      ) : (
        <>
          {/* ---------------- Family Hero Banner ---------------- */}
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
              <h3>Household Protection Overview</h3>
              <p>
                {displayMembers.length} family member{displayMembers.length === 1 ? "" : "s"} declared.
                Evidence documents required to verify active coverage status.
              </p>
              <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
                <span className="figma-hub-card-pill neutral">
                  <ShieldCheck size={13} /> Evidence verification pending
                </span>
              </div>
            </div>
          </section>

          {/* ---------------- Main Content Layout ---------------- */}
          <div className="figma-family-grid">
            {/* Members List */}
            <div className="figma-family-list">
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
                <h3 style={{ fontSize: 16, fontWeight: 800, color: "#0f1d38" }}>
                  Household Members ({displayMembers.length})
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
                    <span className="figma-hub-card-pill neutral">
                      <Clock size={13} /> {member.coverageStatus}
                    </span>
                    {token && members.some((m) => m.id === member.id) && !member.isMain && (
                      <button
                        type="button"
                        onClick={() => handleDeleteMember(member.id, member.name)}
                        style={{ background: "none", border: "none", color: "#94a3b8", cursor: "pointer", padding: 4 }}
                        title="Remove member"
                      >
                        <Trash2 size={15} />
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>

            {/* Right Column: Household Policy Integration */}
            <div className="figma-shared-benefits-card">
              <div className="figma-shared-head">
                <ShieldCheck size={22} color="#0ea58a" />
                <div>
                  <h4>Household Coverage Association</h4>
                  <p>Policies must explicitly associate dependent members.</p>
                </div>
              </div>

              <div
                style={{
                  background: "#f8fafc",
                  borderRadius: 12,
                  padding: 16,
                  fontSize: 12.5,
                  color: "#64748b",
                  lineHeight: 1.5,
                }}
              >
                INSURRA does not infer that a family member is covered solely because they belong to the
                household. Upload policy wording or group certificates showing named dependents to confirm
                active protection.
              </div>

              <Link
                href="/documents"
                className="figma-btn-primary"
                style={{ textDecoration: "none", textAlign: "center", justifyContent: "center", marginTop: 8 }}
              >
                Upload Dependent Policy Document
              </Link>
            </div>
          </div>
        </>
      )}

      {/* ---------------- Add Member Modal ---------------- */}
      {showAddModal && (
        <div className="figma-modal-backdrop" onClick={() => setShowAddModal(false)}>
          <div className="figma-modal" onClick={(e) => e.stopPropagation()}>
            <div className="figma-modal-header">
              <h3>Add Family Member</h3>
              <button
                type="button"
                className="figma-modal-close"
                onClick={() => setShowAddModal(false)}
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleAddMember}>
              {error && <div className="figma-modal-error">{error}</div>}

              <div className="figma-form-group">
                <label>Full Name</label>
                <input
                  type="text"
                  placeholder="e.g. Spouse or Child Name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="figma-modal-input"
                  required
                />
              </div>

              <div className="figma-form-group">
                <label>Relationship</label>
                <select
                  value={relation}
                  onChange={(e) => setRelation(e.target.value)}
                  className="figma-modal-select"
                >
                  <option value="Spouse">Spouse / Partner</option>
                  <option value="Child">Child</option>
                  <option value="Parent">Parent</option>
                  <option value="Other">Other Dependent</option>
                </select>
              </div>

              <div className="figma-form-group">
                <label>Date of Birth (Optional)</label>
                <input
                  type="date"
                  value={birthDate}
                  onChange={(e) => setBirthDate(e.target.value)}
                  className="figma-modal-input"
                />
              </div>

              <div className="figma-form-group">
                <label style={{ display: "flex", alignItems: "flex-start", gap: 10, cursor: "pointer", fontSize: 12.5 }}>
                  <input
                    type="checkbox"
                    checked={consentConfirmed}
                    onChange={(e) => setConsentConfirmed(e.target.checked)}
                    style={{ marginTop: 2 }}
                    required
                  />
                  <span>
                    I confirm that I have explicit authorization or legal authority to manage insurance
                    information on behalf of this household member.
                  </span>
                </label>
              </div>

              <div className="figma-modal-actions">
                <button
                  type="button"
                  className="figma-btn-secondary"
                  onClick={() => setShowAddModal(false)}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="figma-btn-primary"
                  disabled={busy}
                >
                  {busy ? "Saving..." : "Add Member"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
