"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import {
  AlertTriangle,
  Building2,
  CheckCircle2,
  GraduationCap,
  HeartHandshake,
  Lock,
  Save,
  Shield,
  User,
  X,
} from "lucide-react";
import { api } from "@/lib/api/client";
import type { components } from "@/lib/api/types.gen";
import { useActor } from "@/lib/actor";
import { useUserContext } from "@/lib/user-context";
import "./profile.css";

type Goal = components["schemas"]["Goal"];
type ProtectionScope = components["schemas"]["ProtectionScope"];
type Situation = components["schemas"]["Situation"];
type ResidenceContext = components["schemas"]["ResidenceContext"];

const GOAL_OPTIONS: { id: Goal; label: string }[] = [
  { id: "UNDERSTAND_COVERAGE", label: "Understand Policy & Clauses" },
  { id: "DISCOVER_GAPS", label: "Discover Coverage Gaps" },
  { id: "PREPARE_CLAIM", label: "Prepare & Track Claims" },
  { id: "FIND_CARE", label: "Find Care Pathways" },
  { id: "TRACK_RENEWALS", label: "Track Policy Renewals" },
  { id: "COMPARE_OPTIONS", label: "Compare Insurance Options" },
  { id: "MANAGE_FAMILY", label: "Manage Family Protection" },
];

const SCOPE_OPTIONS: { id: ProtectionScope; label: string }[] = [
  { id: "SELF", label: "Self" },
  { id: "SPOUSE", label: "Spouse / Partner" },
  { id: "CHILDREN", label: "Children" },
  { id: "DEPENDENTS", label: "Dependents" },
  { id: "HOUSEHOLD", label: "Entire Household" },
];

const BUDGET_OPTIONS = [
  "No additional budget",
  "< $50 / month",
  "$50 - $150 / month",
  "$150 - $300 / month",
  "> $300 / month",
];

export default function ProfilePage() {
  const { mode, headers, loading: actorLoading } = useActor();
  const { updateContext } = useUserContext();

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // Form State
  const [displayName, setDisplayName] = useState("");
  const [email, setEmail] = useState("");
  const [nationality, setNationality] = useState<"ID" | "CN">("ID");
  const [residenceCountry, setResidenceCountry] = useState<"CN" | "ID">("CN");
  const [originalCountry, setOriginalCountry] = useState<"CN" | "ID">("CN");
  const [city, setCity] = useState("");
  const [timezone, setTimezone] = useState("Asia/Shanghai");
  const [situation, setSituation] = useState<Situation>("STUDENT");
  const [institutionName, setInstitutionName] = useState("");
  const [employerName, setEmployerName] = useState("");
  const [studyStartDate, setStudyStartDate] = useState("");
  const [studyEndDate, setStudyEndDate] = useState("");
  const [permitEndDate, setPermitEndDate] = useState("");
  const [budgetRange, setBudgetRange] = useState("$50 - $150 / month");
  const [goals, setGoals] = useState<Goal[]>(["UNDERSTAND_COVERAGE", "PREPARE_CLAIM"]);
  const [protectionScope, setProtectionScope] = useState<ProtectionScope[]>(["SELF"]);
  const [dependents, setDependents] = useState<string[]>([]);
  const [newDependent, setNewDependent] = useState("");

  const loadProfile = useCallback(async () => {
    if (!headers) return;
    setLoading(true);
    setError(null);
    try {
      if (mode === "account") {
        const res = await api.request("get", "/api/v1/account/profile", { headers });
        const p = (res.profile || res.draft || {}) as Partial<components["schemas"]["UserProfile"]>;
        if (p.display_name) setDisplayName(p.display_name);
        if (p.country_code) {
          const code = p.country_code === "ID" ? "ID" : "CN";
          setResidenceCountry(code);
          setOriginalCountry(code);
        }
        if (p.city) setCity(p.city);
        if (p.timezone) setTimezone(p.timezone);
        if (p.nationality) setNationality(p.nationality === "CN" ? "CN" : "ID");
        if (p.situation) setSituation(p.situation);
        if (p.institution_name) setInstitutionName(p.institution_name);
        if (p.employer_name) setEmployerName(p.employer_name);
        if (p.study_start_date) setStudyStartDate(p.study_start_date);
        if (p.study_end_date) setStudyEndDate(p.study_end_date);
        if (p.permit_end_date || p.visa_expiry_date) {
          setPermitEndDate(p.permit_end_date || p.visa_expiry_date || "");
        }
        if (p.budget_range) setBudgetRange(p.budget_range);
        if (p.goals) setGoals(p.goals);
        if (p.protection_scope) setProtectionScope(p.protection_scope);
        if (p.dependents) setDependents(p.dependents);

        const me = await api.request("get", "/api/v1/auth/me", { headers });
        if (me?.email) setEmail(me.email);
      } else if (mode === "demo") {
        const p = await api.request("get", "/api/v1/profile", { headers });
        if (p.display_name) setDisplayName(p.display_name);
        if (p.country_code) {
          const code = p.country_code === "ID" ? "ID" : "CN";
          setResidenceCountry(code);
          setOriginalCountry(code);
        }
        if (p.city) setCity(p.city);
        if (p.timezone) setTimezone(p.timezone || (p.country_code === "ID" ? "Asia/Jakarta" : "Asia/Shanghai"));
        if (p.nationality) setNationality(p.nationality === "CN" ? "CN" : "ID");
        if (p.situation) setSituation(p.situation);
        if (p.institution_name) setInstitutionName(p.institution_name);
        if (p.employer_name) setEmployerName(p.employer_name);
        if (p.study_start_date) setStudyStartDate(p.study_start_date);
        if (p.study_end_date) setStudyEndDate(p.study_end_date);
        if (p.permit_end_date || p.visa_expiry_date) {
          setPermitEndDate(p.permit_end_date || p.visa_expiry_date || "");
        }
        if (p.budget_range) setBudgetRange(p.budget_range);
        if (p.goals) setGoals(p.goals);
        if (p.protection_scope) setProtectionScope(p.protection_scope);
        if (p.dependents) setDependents(p.dependents);
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Failed to load profile.");
    } finally {
      setLoading(false);
    }
  }, [headers, mode]);

  useEffect(() => {
    if (!actorLoading && headers) {
      void Promise.resolve().then(() => loadProfile());
    } else if (!actorLoading && !headers) {
      void Promise.resolve().then(() => setLoading(false));
    }
  }, [actorLoading, headers, loadProfile]);

  function handleCountryChange(newCode: "CN" | "ID") {
    setResidenceCountry(newCode);
    if (newCode === "ID") {
      setTimezone("Asia/Jakarta");
      if (residenceCountry !== "ID") {
        setCity("Jakarta");
      }
    } else {
      setTimezone("Asia/Shanghai");
      if (residenceCountry !== "CN") {
        setCity("Shenzhen");
      }
    }
  }

  function toggleGoal(goalId: Goal) {
    if (goals.includes(goalId)) {
      setGoals(goals.filter((g) => g !== goalId));
    } else {
      if (goals.length < 7) {
        setGoals([...goals, goalId]);
      }
    }
  }

  function toggleScope(scopeId: ProtectionScope) {
    if (protectionScope.includes(scopeId)) {
      setProtectionScope(protectionScope.filter((s) => s !== scopeId));
    } else {
      setProtectionScope([...protectionScope, scopeId]);
    }
  }

  function addDependent() {
    const trimmed = newDependent.trim();
    if (trimmed && !dependents.includes(trimmed) && dependents.length < 6) {
      setDependents([...dependents, trimmed]);
      setNewDependent("");
    }
  }

  function removeDependent(name: string) {
    setDependents(dependents.filter((d) => d !== name));
  }

  async function handleSave() {
    if (!headers) return;
    setSaving(true);
    setError(null);
    setSuccess(null);

    const derivedOccupation: "STUDENT" | "EMPLOYEE" | "OTHER" =
      situation === "STUDENT" ? "STUDENT" : situation === "EMPLOYEE" ? "EMPLOYEE" : "OTHER";

    const residenceContext: ResidenceContext =
      residenceCountry === nationality ? "DOMESTIC" : "ABROAD";

    const currency: "CNY" | "IDR" = residenceCountry === "CN" ? "CNY" : "IDR";

    const payload = {
      display_name: displayName.trim() || "User",
      country_code: residenceCountry,
      residence_context: residenceContext,
      city: city.trim() || (residenceCountry === "CN" ? "Shenzhen" : "Jakarta"),
      occupation: derivedOccupation,
      situation,
      timezone: timezone || (residenceCountry === "CN" ? "Asia/Shanghai" : "Asia/Jakarta"),
      institution_name: situation === "STUDENT" ? institutionName.trim() || null : null,
      employer_name: situation === "EMPLOYEE" ? employerName.trim() || null : null,
      study_start_date: situation === "STUDENT" && studyStartDate ? studyStartDate : null,
      study_end_date: situation === "STUDENT" && studyEndDate ? studyEndDate : null,
      permit_end_date: permitEndDate || null,
      visa_expiry_date: permitEndDate || null,
      nationality,
      goals,
      protection_scope: protectionScope,
      dependents,
      budget_range: budgetRange,
      currency,
    };

    try {
      if (mode === "account") {
        await api.request("put", "/api/v1/account/profile", {
          headers,
          body: payload,
        });
      } else if (mode === "demo") {
        await api.request("put", "/api/v1/profile", {
          headers,
          body: payload,
        });
      }

      setOriginalCountry(residenceCountry);
      setSuccess("Profile saved successfully.");

      // Sync active context so topbar reflects changes
      updateContext({
        countryCode: residenceCountry,
        residenceCity: city.trim() || (residenceCountry === "CN" ? "Shenzhen" : "Jakarta"),
        userSegment: situation === "STUDENT" ? "student" : situation === "EMPLOYEE" ? "employee" : "other",
      });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Failed to update profile.");
    } finally {
      setSaving(false);
    }
  }

  if (actorLoading || loading) {
    return <p role="status">Loading profile details...</p>;
  }

  if (!headers) {
    return (
      <div className="profile-page">
        <div className="profile-card">
          <h1>Sign in or select a demo persona to view profile.</h1>
          <p>You can sign in with your account or explore as a demo user.</p>
          <div style={{ display: "flex", gap: 12 }}>
            <Link href="/auth" className="profile-save-btn">
              Sign In
            </Link>
            <Link href="/" className="profile-chip">
              Explore Demo
            </Link>
          </div>
        </div>
      </div>
    );
  }

  const countryChanged = residenceCountry !== originalCountry;

  return (
    <div className="profile-page">
      <div className="profile-header">
        <div>
          <h1>Your Profile</h1>
          <p>Manage personal details, residence context, insurance goals, and protection scope.</p>
        </div>
        <div className={`profile-badge ${mode === "account" ? "account" : "demo"}`}>
          <Shield size={14} />
          <span>{mode === "account" ? "AUTHENTICATED ACCOUNT" : "DEMO PERSONA (SESSION)"}</span>
        </div>
      </div>

      {mode === "demo" && (
        <div className="profile-alert warning">
          <AlertTriangle size={18} />
          <div>
            <strong>Interactive Demo Session:</strong> Edits here are isolated to your current demo
            session and will reset if you restart the demo.
          </div>
        </div>
      )}

      {countryChanged && (
        <div className="profile-alert warning">
          <AlertTriangle size={18} />
          <div>
            <strong>Country Switch Notice:</strong> Switching residence country clears
            country-bound fields (city, institution/employer, study and permit dates, currency) to
            maintain data integrity with the target country regulations.
          </div>
        </div>
      )}

      {error && (
        <div className="profile-alert error" role="alert">
          <AlertTriangle size={18} />
          <div>{error}</div>
        </div>
      )}

      {success && (
        <div className="profile-alert success" role="status">
          <CheckCircle2 size={18} />
          <div>{success}</div>
        </div>
      )}

      {/* SECTION 1: Personal & Identity */}
      <section className="profile-card">
        <div className="profile-card-header">
          <User size={18} />
          <h2>Personal Information</h2>
        </div>
        <div className="profile-form-grid">
          <div className="profile-field">
            <label htmlFor="display-name">Full Name / Display Name</label>
            <input
              id="display-name"
              type="text"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              placeholder="e.g. Raka Pratama"
            />
          </div>

          {email && (
            <div className="profile-field">
              <label htmlFor="email">Email Address</label>
              <input id="email" type="email" value={email} disabled />
              <span className="profile-field-hint">Managed via account login</span>
            </div>
          )}

          <div className="profile-field">
            <label htmlFor="nationality">Nationality</label>
            <select
              id="nationality"
              value={nationality}
              onChange={(e) => setNationality(e.target.value as "ID" | "CN")}
            >
              <option value="ID">Indonesia 🇮🇩</option>
              <option value="CN">China 🇨🇳</option>
            </select>
          </div>
        </div>
      </section>

      {/* SECTION 2: Residence & Country Context */}
      <section className="profile-card">
        <div className="profile-card-header">
          <Building2 size={18} />
          <h2>Residence Context & Location</h2>
        </div>
        <div className="profile-form-grid">
          <div className="profile-field">
            <label htmlFor="residence-country">Residence Country</label>
            <select
              id="residence-country"
              value={residenceCountry}
              onChange={(e) => handleCountryChange(e.target.value as "CN" | "ID")}
            >
              <option value="CN">China 🇨🇳 (Supported)</option>
              <option value="ID">Indonesia 🇮🇩 (Supported)</option>
            </select>
            <span className="profile-field-hint">
              Supported insurance coverage regions are China and Indonesia.
            </span>
          </div>

          <div className="profile-field">
            <label htmlFor="residence-city">City</label>
            <input
              id="residence-city"
              type="text"
              value={city}
              onChange={(e) => setCity(e.target.value)}
              placeholder={residenceCountry === "CN" ? "e.g. Shenzhen" : "e.g. Jakarta"}
            />
          </div>

          <div className="profile-field">
            <label htmlFor="timezone">Timezone</label>
            <select
              id="timezone"
              value={timezone}
              onChange={(e) => setTimezone(e.target.value)}
            >
              <option value="Asia/Shanghai">Asia/Shanghai (CST, UTC+8)</option>
              <option value="Asia/Jakarta">Asia/Jakarta (WIB, UTC+7)</option>
              <option value="Asia/Makassar">Asia/Makassar (WITA, UTC+8)</option>
              <option value="Asia/Jayapura">Asia/Jayapura (WIT, UTC+9)</option>
            </select>
          </div>

          <div className="profile-field">
            <label htmlFor="currency">Local Currency</label>
            <input
              id="currency"
              type="text"
              value={residenceCountry === "CN" ? "CNY (¥)" : "IDR (Rp)"}
              disabled
            />
          </div>
        </div>
      </section>

      {/* SECTION 3: Situation & Education / Employment */}
      <section className="profile-card">
        <div className="profile-card-header">
          <GraduationCap size={18} />
          <h2>Situation & Occupation</h2>
        </div>
        <div className="profile-form-grid">
          <div className="profile-field">
            <label htmlFor="situation">Your Situation</label>
            <select
              id="situation"
              value={situation}
              onChange={(e) => setSituation(e.target.value as Situation)}
            >
              <option value="STUDENT">International Student</option>
              <option value="EMPLOYEE">Employed / Professional</option>
              <option value="SELF_EMPLOYED">Self-Employed / Freelancer</option>
              <option value="OTHER">Other</option>
            </select>
          </div>

          {situation === "STUDENT" && (
            <>
              <div className="profile-field">
                <label htmlFor="institution">University / Institution</label>
                <input
                  id="institution"
                  type="text"
                  value={institutionName}
                  onChange={(e) => setInstitutionName(e.target.value)}
                  placeholder="e.g. Shenzhen University"
                />
              </div>

              <div className="profile-field">
                <label htmlFor="study-start">Study Start Date</label>
                <input
                  id="study-start"
                  type="date"
                  value={studyStartDate}
                  onChange={(e) => setStudyStartDate(e.target.value)}
                />
              </div>

              <div className="profile-field">
                <label htmlFor="study-end">Study End Date</label>
                <input
                  id="study-end"
                  type="date"
                  value={studyEndDate}
                  onChange={(e) => setStudyEndDate(e.target.value)}
                />
              </div>
            </>
          )}

          {situation === "EMPLOYEE" && (
            <div className="profile-field">
              <label htmlFor="employer">Employer / Company Name</label>
              <input
                id="employer"
                type="text"
                value={employerName}
                onChange={(e) => setEmployerName(e.target.value)}
                placeholder="e.g. Tech Nusantara PT"
              />
            </div>
          )}

          <div className="profile-field">
            <label htmlFor="permit-end">Residence Permit / Visa Expiry</label>
            <input
              id="permit-end"
              type="date"
              value={permitEndDate}
              onChange={(e) => setPermitEndDate(e.target.value)}
            />
            <span className="profile-field-hint">
              Used to compute coverage continuity and gap warnings.
            </span>
          </div>
        </div>
      </section>

      {/* SECTION 4: Protection Goals & Budget */}
      <section className="profile-card">
        <div className="profile-card-header">
          <Shield size={18} />
          <h2>Insurance Goals & Priorities</h2>
        </div>

        <div className="profile-field">
          <label>Select Your Goals (up to 7)</label>
          <div className="profile-chip-group">
            {GOAL_OPTIONS.map((opt) => {
              const selected = goals.includes(opt.id);
              return (
                <button
                  type="button"
                  key={opt.id}
                  className={`profile-chip ${selected ? "selected" : ""}`}
                  onClick={() => toggleGoal(opt.id)}
                >
                  {selected && "✓ "}
                  {opt.label}
                </button>
              );
            })}
          </div>
        </div>

        <div className="profile-form-grid" style={{ marginTop: 12 }}>
          <div className="profile-field">
            <label htmlFor="budget">Additional Insurance Budget</label>
            <select
              id="budget"
              value={budgetRange}
              onChange={(e) => setBudgetRange(e.target.value)}
            >
              {BUDGET_OPTIONS.map((b) => (
                <option key={b} value={b}>
                  {b}
                </option>
              ))}
            </select>
          </div>
        </div>
      </section>

      {/* SECTION 5: Household & Scope */}
      <section className="profile-card">
        <div className="profile-card-header">
          <HeartHandshake size={18} />
          <h2>Household & Protection Scope</h2>
        </div>

        <div className="profile-field">
          <label>Who should this protection cover?</label>
          <div className="profile-checkbox-group">
            {SCOPE_OPTIONS.map((opt) => (
              <label key={opt.id} className="profile-checkbox-item">
                <input
                  type="checkbox"
                  checked={protectionScope.includes(opt.id)}
                  onChange={() => toggleScope(opt.id)}
                />
                <span>{opt.label}</span>
              </label>
            ))}
          </div>
        </div>

        <div className="profile-field" style={{ marginTop: 10 }}>
          <label>Dependents</label>
          <div className="profile-tags-container">
            {dependents.map((dep) => (
              <span key={dep} className="profile-tag">
                {dep}
                <button type="button" onClick={() => removeDependent(dep)} aria-label={`Remove ${dep}`}>
                  <X size={14} />
                </button>
              </span>
            ))}
            {dependents.length === 0 && (
              <span style={{ fontSize: 13, color: "#627888" }}>No dependents listed.</span>
            )}
          </div>
          {dependents.length < 6 && (
            <div style={{ display: "flex", gap: 8, marginTop: 8, maxWidth: 320 }}>
              <input
                type="text"
                value={newDependent}
                onChange={(e) => setNewDependent(e.target.value)}
                placeholder="Add dependent name"
                style={{ flex: 1, padding: "6px 10px", borderRadius: 6, border: "1px solid #c9d6df", fontSize: 13 }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    addDependent();
                  }
                }}
              />
              <button
                type="button"
                onClick={addDependent}
                className="profile-chip"
                style={{ borderRadius: 6, padding: "6px 12px" }}
              >
                Add
              </button>
            </div>
          )}
        </div>
      </section>

      {/* SECTION 6: Security & Privacy Navigation */}
      <section className="profile-card" style={{ background: "#f8fafc" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 12 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <Lock size={18} color="#087f8c" />
            <div>
              <strong style={{ fontSize: 14, color: "#102a43" }}>Privacy, Consents & Data Controls</strong>
              <p style={{ margin: "2px 0 0", fontSize: 12.5, color: "#526579" }}>
                Manage purpose consents, download data export, or inspect your stored inventory.
              </p>
            </div>
          </div>
          <Link
            href="/settings/privacy"
            className="profile-chip"
            style={{ textDecoration: "none" }}
          >
            Manage Privacy
          </Link>
        </div>
      </section>

      {/* Action Footer */}
      <div className="profile-actions">
        <button
          type="button"
          onClick={() => void handleSave()}
          disabled={saving}
          className="profile-save-btn"
        >
          <Save size={16} />
          {saving ? "Saving Changes..." : "Save Profile Changes"}
        </button>
      </div>
    </div>
  );
}
