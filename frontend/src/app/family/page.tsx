"use client";

import Link from "next/link";
import Image from "next/image";
import { useCallback, useEffect, useState } from "react";
import {
  ArrowRight,
  CheckCircle2,
  ChevronRight,
  FileText,
  Heart,
  Plus,
  Trash2,
  UserPlus,
} from "lucide-react";
import { api } from "@/lib/api/client";
import type { components } from "@/lib/api/types.gen";
import { useAuth } from "@/lib/auth";
import { Button } from "@/components/ui/button";

type FamilyMember = components["schemas"]["FamilyMember"];

export default function FamilyPage() {
  const { account, token, loading } = useAuth();
  const [members, setMembers] = useState<FamilyMember[]>([]);
  const [showAddForm, setShowAddForm] = useState(false);
  const [name, setName] = useState("");
  const [relation, setRelation] = useState("Spouse");
  const [birthDate, setBirthDate] = useState("");
  const [consentConfirmed, setConsentConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const refreshFamily = useCallback(async () => {
    if (!token) return;
    try {
      const list = await api.request("get", "/api/v1/account/family", {
        headers: { Authorization: `Bearer ${token}` },
      });
      setMembers(list);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Failed to load family members.");
    }
  }, [token]);

  useEffect(() => {
    void Promise.resolve().then(refreshFamily);
  }, [refreshFamily]);

  async function handleAddMember(e: React.FormEvent) {
    e.preventDefault();
    if (!token) return;
    setError(null);
    setNotice(null);
    if (!name.trim()) {
      setError("Please enter the family member name or nickname.");
      return;
    }
    if (!consentConfirmed) {
      setError("You must confirm you have authorization to manage data on their behalf.");
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
      setShowAddForm(false);
      setNotice("Family member record added successfully.");
      await refreshFamily();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Failed to add family member.");
    } finally {
      setBusy(false);
    }
  }

  async function handleDeleteMember(memberId: string, memberName: string) {
    if (!token || !window.confirm(`Delete ${memberName} from your family records?`)) return;
    setBusy(true);
    setError(null);
    try {
      await api.request("delete", "/api/v1/account/family/{member_id}", {
        params: { member_id: memberId },
        headers: { Authorization: `Bearer ${token}` },
      });
      setNotice(`${memberName} has been removed from family records.`);
      await refreshFamily();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Failed to delete family member.");
    } finally {
      setBusy(false);
    }
  }

  if (loading) return <p role="status">Checking account session...</p>;
  if (!account || !token) {
    return (
      <div className="card account-empty">
        <h1>Sign in to manage Family Members.</h1>
        <Button asChild>
          <Link href="/auth">Sign In or Register</Link>
        </Button>
      </div>
    );
  }

  return (
    <div className="family-page protection-screen">
      <nav aria-label="Breadcrumb" className="protection-breadcrumb">
        <Link href="/protection">My Protection</Link>
        <ChevronRight size={14} className="breadcrumb-separator" />
        <span aria-current="page">Family Coverage</span>
      </nav>

      <div className="page-heading">
        <div>
          <div className="eyebrow">FAMILY PROTECTION</div>
          <h1>Family Coverage</h1>
          <p>Manage family members and track linked insurance policies across your household.</p>
        </div>
        {!showAddForm && (
          <Button onClick={() => setShowAddForm(true)} disabled={members.length >= 6}>
            <Plus size={16} /> Add Family Member
          </Button>
        )}
      </div>

      {error && (
        <div className="alert error" role="alert">
          {error}
        </div>
      )}
      {notice && (
        <div className="alert success" role="status">
          {notice}
        </div>
      )}

      <section className="card family-overview">
        <Image src="/protection-family-illustration.png" alt="Family illustration" width={240} height={150} />
        <div className="family-overview-copy">
          <span className="eyebrow">HOUSEHOLD OVERVIEW</span>
          <h2>Family protection in one place</h2>
          <p>
            This record tracks household dependents and linked policy counts. Dependent benefits cannot be inferred until policies are explicitly linked.
          </p>
          <div className="family-overview-stats">
            <span>
              <strong>{members.length} / 6</strong>Total Members
            </span>
            <span>
              <strong>{members.reduce((sum, member) => sum + member.active_coverage_count, 0)}</strong>Linked Policies
            </span>
          </div>
        </div>
      </section>

      <div className="policy-controls card">
        <div className="filter-group">
          <Heart size={18} />
          <span>Registered Family Members ({members.length})</span>
        </div>
        {!showAddForm && (
          <Button onClick={() => setShowAddForm(true)} disabled={members.length >= 6}>
            <Plus size={16} /> Add Member
          </Button>
        )}
      </div>

      {showAddForm && (
        <section className="card family-add-card">
          <div className="section-heading">
            <h2>Add Family Member</h2>
            <Button variant="ghost" size="sm" onClick={() => setShowAddForm(false)}>
              Cancel
            </Button>
          </div>
          <p className="account-note">
            Insurra does not collect national ID numbers (NIK) in the family member form. Enter only necessary identity fields.
          </p>
          <form onSubmit={handleAddMember} className="form-grid">
            <label>
              Full Name or Nickname:
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Sinta or Alex"
                required
              />
            </label>
            <label>
              Relationship:
              <select value={relation} onChange={(e) => setRelation(e.target.value)}>
                <option value="Spouse">Spouse / Partner</option>
                <option value="Child">Child / Dependent</option>
                <option value="Parent">Parent</option>
                <option value="Sibling">Sibling</option>
                <option value="Other">Other Dependent</option>
              </select>
            </label>
            <label>
              Date of Birth (Optional):
              <input
                type="date"
                value={birthDate}
                onChange={(e) => setBirthDate(e.target.value)}
              />
            </label>

            <div className="family-consent-checkbox">
              <label className="checkbox-label">
                <input
                  type="checkbox"
                  checked={consentConfirmed}
                  onChange={(e) => setConsentConfirmed(e.target.checked)}
                />
                <span>
                  I confirm that I have explicit permission and authority from this family member to record their details and link their insurance documents.
                </span>
              </label>
            </div>

            <div className="wizard-actions">
              <Button type="submit" disabled={busy || !name || !consentConfirmed || members.length >= 6}>
                {busy ? "Saving..." : "Save Family Member"}
                <ArrowRight size={16} />
              </Button>
            </div>
          </form>
        </section>
      )}

      {!members.length && !showAddForm ? (
        <div className="card account-empty">
          <UserPlus size={40} />
          <h2>No family members added yet</h2>
          <p>Add family members only if you have permission to manage their records.</p>
          <Button onClick={() => setShowAddForm(true)}>
            <Plus size={16} /> Add First Family Member
          </Button>
        </div>
      ) : (
        <div className="family-grid">
          {members.map((member) => (
            <article key={member.id} className="card family-card">
              <div className="family-card-head">
                <div className="family-avatar">
                  {member.name.slice(0, 1).toUpperCase()}
                </div>
                <div>
                  <h3>{member.name}</h3>
                  <span className="badge-purpose optional">{member.relation}</span>
                </div>
              </div>

              <div className="family-card-body">
                {member.birth_date && (
                  <div className="policy-meta-row">
                    <span>Date of Birth:</span>
                    <strong>{member.birth_date}</strong>
                  </div>
                )}
                <div className="policy-meta-row">
                  <span>Consent Recorded:</span>
                  <strong>{new Date(member.consent_at).toLocaleDateString()}</strong>
                </div>
                <div className="policy-meta-row">
                  <span>Linked Policies:</span>
                  <strong>{member.active_coverage_count} Active</strong>
                </div>
              </div>

              <div className="family-card-foot">
                <span className="family-coverage-status">
                  {member.active_coverage_count > 0 ? <CheckCircle2 size={15} /> : <FileText size={15} />}
                  {member.active_coverage_count > 0 ? `${member.active_coverage_count} policies linked` : "No linked policies recorded"}
                </span>
                <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
                  <Button asChild variant="outline" size="sm">
                    <Link href={`/documents?owner=${member.id}`}>
                      <FileText size={13} /> Upload Doc
                    </Link>
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => void handleDeleteMember(member.id, member.name)}
                  >
                    <Trash2 size={14} /> Remove
                  </Button>
                </div>
              </div>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}
