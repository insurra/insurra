"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import {
  AlertCircle,
  ArrowRight,
  BarChart3,
  Calendar,
  CheckCircle2,
  ChevronRight,
  Clock,
  FileText,
  ListChecks,
  Search,
  Shield,
  ShieldCheck,
  Users,
} from "lucide-react";
import { api } from "@/lib/api/client";
import type { components } from "@/lib/api/types.gen";
import { useAuth } from "@/lib/auth";
import { useSession } from "@/lib/session";
import { useUserContext } from "@/lib/user-context";

type ProfileState = components["schemas"]["AccountProfileState"];
type Inventory = components["schemas"]["AccountInventory"];
type Policy = components["schemas"]["AccountPolicySummary"];
type FamilyMember = components["schemas"]["FamilyMember"];
type Completeness = components["schemas"]["AccountCompleteness"];

export default function MyProtectionParentPage() {
  const { token } = useAuth();
  const { data: demoSession } = useSession();
  const userCtx = useUserContext();

  const [profile, setProfile] = useState<ProfileState | null>(null);
  const [inventory, setInventory] = useState<Inventory | null>(null);
  const [policies, setPolicies] = useState<Policy[]>([]);
  const [family, setFamily] = useState<FamilyMember[]>([]);
  const [completeness, setCompleteness] = useState<Completeness | null>(null);
  const [query, setQuery] = useState("");

  useEffect(() => {
    let active = true;

    async function loadData() {
      if (!token) return;
      try {
        const headers = { Authorization: `Bearer ${token}` };
        const [nextProfile, nextInventory, nextPolicies, nextFamily] = await Promise.allSettled([
          api.request("get", "/api/v1/account/profile", { headers }),
          api.request("get", "/api/v1/account/inventory", { headers }),
          api.request("get", "/api/v1/account/policies", { headers }),
          api.request("get", "/api/v1/account/family", { headers }),
        ]);

        if (!active) return;
        if (nextProfile.status === "fulfilled") setProfile(nextProfile.value);
        if (nextInventory.status === "fulfilled") setInventory(nextInventory.value);
        if (nextPolicies.status === "fulfilled") setPolicies(nextPolicies.value);
        if (nextFamily.status === "fulfilled") setFamily(nextFamily.value);

        try {
          const compResult = await api.request("get", "/api/v1/account/completeness", { headers });
          if (active) setCompleteness(compResult);
        } catch {
          // ignore
        }
      } catch {
        // Fallback gracefully
      }
    }

    void loadData();
    return () => {
      active = false;
    };
  }, [token]);

  // Active user facts from context
  const countryCode = profile?.profile?.country_code || userCtx.countryCode || "CN";
  const countryName = userCtx.residenceCountry || (countryCode === "CN" ? "China" : countryCode === "ID" ? "Indonesia" : "Australia");
  const countryFlag = userCtx.countryFlag || "🇨🇳";
  const city = profile?.profile?.city || userCtx.residenceCity || "Shenzhen";
  const isStudent = userCtx.userSegment === "student";
  const isEmployee = userCtx.userSegment === "employee";
  const declaredCoverages = useMemo(() => userCtx.declaredCoverages || [], [userCtx.declaredCoverages]);
  const isSelfOnly = userCtx.householdScope === "self";
  const dependentCount = userCtx.dependentCount || family.length || 0;
  const readyPct = completeness ? completeness.ready_pct : 0;

  // Search results
  const searchResults = useMemo(() => {
    const term = query.trim().toLowerCase();
    if (!term) return [];
    return [
      ...policies
        .filter((item) => `${item.provider ?? ""} ${item.kind}`.toLowerCase().includes(term))
        .map((item) => ({ label: item.provider ?? item.kind.replaceAll("_", " "), hint: "Policy Wallet", href: "/policies" })),
      ...declaredCoverages
        .filter((item) => `${item.category} ${item.label} ${item.provider ?? ""}`.toLowerCase().includes(term))
        .map((item) => ({ label: item.label, hint: "Policy Wallet (Declared)", href: "/policies" })),
      ...(inventory?.documents ?? [])
        .filter((item) => `${item.original_filename} ${item.kind}`.toLowerCase().includes(term))
        .map((item) => ({ label: item.original_filename, hint: "Documents", href: `/documents` })),
    ].slice(0, 5);
  }, [declaredCoverages, inventory?.documents, policies, query]);

  // Real document and policy counts
  const docCount = inventory?.document_count ?? (token ? 0 : demoSession?.record.documents.length ?? 0);
  const totalPolicyCount = policies.length > 0 ? policies.length : declaredCoverages.length;

  // Context-aware tailored hero next step
  const tailoredNextStep = useMemo(() => {
    if (countryCode === "CN") {
      if (isStudent) {
        return {
          title: "Upload student insurance certificate",
          desc: `Upload your Ping An or university certificate to verify hospital networks and coverage dates in ${city}.`,
          href: "/documents",
        };
      }
      if (isEmployee) {
        return {
          title: "Add employer benefit schedule",
          desc: `Upload your corporate medical schedule or social medical voucher (医保) for ${city}.`,
          href: "/documents",
        };
      }
      return {
        title: "Upload your medical policy certificate",
        desc: `Upload your policy documents to verify coverage in ${city}, China.`,
        href: "/documents",
      };
    }

    if (countryCode === "ID") {
      return {
        title: "Verify BPJS & private health coverage",
        desc: `Upload your BPJS card or private hospital schedule to confirm your care pathways in ${city}.`,
        href: "/documents",
      };
    }

    if (countryCode === "AU") {
      return {
        title: "Verify your OSHC coverage dates",
        desc: "Upload your OSHC policy certificate to confirm Student Visa Condition 8501 compliance.",
        href: "/documents",
      };
    }

    return {
      title: "Upload insurance certificate",
      desc: `Upload policy documents to begin evidence checks for ${countryName}.`,
      href: "/documents",
    };
  }, [countryCode, countryName, city, isEmployee, isStudent]);

  return (
    <div className="figma-page-shell">
      {/* ---------------- Page Header ---------------- */}
      <header className="figma-page-header">
        <div>
          <h1>My Protection</h1>
          <p>
            Overview of your protection, declared policies, and verification status for{" "}
            <strong>
              {countryFlag} {city}, {countryName}
            </strong>
            .
          </p>
        </div>
        <div className="figma-search-input-wrap">
          <Search size={16} />
          <input
            type="text"
            className="figma-search-input"
            placeholder="Search policies, documents, or members..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          {query && searchResults.length > 0 && (
            <div className="protection-search-results">
              {searchResults.map((item, idx) => (
                <Link key={idx} href={item.href}>
                  <span>
                    {item.label} <small>{item.hint}</small>
                  </span>
                  <ArrowRight size={14} />
                </Link>
              ))}
            </div>
          )}
        </div>
      </header>

      {/* ---------------- Overall Protection Status Banner ---------------- */}
      <section className="figma-protection-hero" aria-label="Overall protection status">
        <div className="figma-hero-left">
          <span className="figma-hero-tag">Overall Protection Status</span>
          <div className="figma-hero-title-row">
            <div className="figma-hero-icon">
              <ShieldCheck size={28} />
            </div>
            <div>
              <h2>Profile Setup Complete</h2>
              <p>Upload policy documents to verify active coverage.</p>
            </div>
          </div>
          <div className="figma-hero-progress-row">
            <div className="figma-progress-track">
              <div
                className="figma-progress-fill"
                style={{ width: docCount > 0 ? "50%" : "20%" }}
              />
            </div>
            <span className="figma-progress-label">
              {docCount > 0 ? "Evidence Under Review" : "Self-Reported · Verification Pending"}
            </span>
          </div>
        </div>

        {/* Mascot / Person Art */}
        <Image
          src="/protection-hero-person.png"
          alt="INSURRA Assistant"
          width={150}
          height={150}
          className="figma-hero-illustration"
          priority
        />

        {/* Dynamic Context Next Step Card */}
        <Link href={tailoredNextStep.href} className="figma-hero-next-step">
          <span className="figma-next-step-badge">Next Step</span>
          <div className="figma-next-step-content">
            <div className="figma-next-step-icon">
              <AlertCircle size={17} />
            </div>
            <div className="figma-next-step-text">
              <h4>{tailoredNextStep.title}</h4>
              <p>{tailoredNextStep.desc}</p>
            </div>
            <ChevronRight size={18} />
          </div>
        </Link>
      </section>

      {/* ---------------- 6 Grid Cards (3 columns x 2 rows) ---------------- */}
      <div className="figma-protection-grid">
        {/* Card 1: Policy Wallet */}
        <Link href="/policies" className="figma-hub-card">
          <div className="figma-hub-card-head">
            <div className="figma-hub-icon-box mint">
              <Shield size={22} />
            </div>
            <ChevronRight size={18} color="#94a3b8" />
          </div>
          <h3>Policy Wallet</h3>
          <p>View and manage your self-reported and verified policies.</p>
          <div className="figma-hub-card-art">
            <div className="figma-art-policy-cards">
              {declaredCoverages.length > 0 ? (
                declaredCoverages.slice(0, 2).map((cov, idx) => (
                  <span key={idx} className="figma-mini-card aia" style={{ textTransform: "capitalize", fontSize: 11 }}>
                    {cov.provider || cov.category}
                  </span>
                ))
              ) : (
                <span className="figma-mini-card aia">Policy</span>
              )}
              {declaredCoverages.length > 2 && (
                <span className="figma-mini-card more">+{declaredCoverages.length - 2}</span>
              )}
            </div>
          </div>
          <span className="figma-hub-card-pill neutral">
            <Clock size={13} /> {totalPolicyCount} self-reported policies
          </span>
        </Link>

        {/* Card 2: Documents */}
        <Link href="/documents" className="figma-hub-card">
          <div className="figma-hub-card-head">
            <div className="figma-hub-icon-box blue">
              <FileText size={22} />
            </div>
            <ChevronRight size={18} color="#94a3b8" />
          </div>
          <h3>Documents</h3>
          <p>Upload and manage your insurance policies and certificates.</p>
          <div className="figma-hub-card-art">
            <div className="figma-art-doc-stack">
              <div className="figma-mini-doc passport" />
              <div className="figma-mini-doc" />
              <div className="figma-mini-doc" />
              {docCount > 0 && (
                <span style={{ fontSize: 11, fontWeight: 750, color: "#64748b", marginLeft: 4 }}>
                  +{docCount}
                </span>
              )}
            </div>
          </div>
          <span className="figma-hub-card-pill success">
            <CheckCircle2 size={13} /> {docCount} documents uploaded
          </span>
        </Link>

        {/* Card 3: Data Completeness */}
        <Link href="/completeness" className="figma-hub-card">
          <div className="figma-hub-card-head">
            <div className="figma-hub-icon-box green">
              <ListChecks size={22} />
            </div>
            <ChevronRight size={18} color="#94a3b8" />
          </div>
          <h3>Data Completeness</h3>
          <p>Check what information is missing to ensure full protection.</p>
          <div className="figma-hub-card-art" style={{ width: "100%", flexDirection: "column", alignItems: "flex-start", gap: 6 }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", width: "100%" }}>
              <div className="figma-progress-track" style={{ width: 140 }}>
                <div
                  className="figma-progress-fill"
                  style={{ width: `${readyPct}%` }}
                />
              </div>
              <span style={{ fontSize: 11.5, fontWeight: 750, color: "#64748b" }}>
                {readyPct > 0 ? `${readyPct}% complete` : docCount > 0 ? "Under Review" : "Pending Evidence"}
              </span>
            </div>
          </div>
          <span className="figma-hub-card-pill danger">
            <AlertCircle size={13} /> Policy verification pending
          </span>
        </Link>

        {/* Card 4: Coverage Needs */}
        <Link href="/coverage-needs" className="figma-hub-card">
          <div className="figma-hub-card-head">
            <div className="figma-hub-icon-box purple">
              <BarChart3 size={22} />
            </div>
            <ChevronRight size={18} color="#94a3b8" />
          </div>
          <h3>Coverage Needs</h3>
          <p>Analyze coverage adequacy, out-of-pocket caps, and recommendations.</p>
          <div className="figma-hub-card-art">
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <div
                style={{
                  width: 48,
                  height: 36,
                  background: "#f5effc",
                  border: "1px solid #ddd6fe",
                  borderRadius: 6,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <CheckCircle2 size={18} color="#0ea58a" />
              </div>
            </div>
          </div>
          <span className="figma-hub-card-pill success">
            <CheckCircle2 size={13} /> Context analyzed
          </span>
        </Link>

        {/* Card 5: Family Coverage */}
        <Link href="/family" className="figma-hub-card">
          <div className="figma-hub-card-head">
            <div className="figma-hub-icon-box amber">
              <Users size={22} />
            </div>
            <ChevronRight size={18} color="#94a3b8" />
          </div>
          <h3>Family Coverage</h3>
          <p>
            {isSelfOnly
              ? "Personal protection only. No household dependents added."
              : "Manage family members and their insurance protection."}
          </p>
          <div className="figma-hub-card-art">
            <Image
              src="/protection-family-illustration.png"
              alt="Family"
              width={110}
              height={55}
              style={{ objectFit: "contain" }}
            />
          </div>
          <span className="figma-hub-card-pill neutral">
            <span style={{ width: 6, height: 6, borderRadius: "50%", background: "#64748b" }} />{" "}
            {isSelfOnly ? "Personal protection only" : `${dependentCount} household members`}
          </span>
        </Link>

        {/* Card 6: Key Dates */}
        <Link href="/completeness" className="figma-hub-card">
          <div className="figma-hub-card-head">
            <div className="figma-hub-icon-box red">
              <Calendar size={22} />
            </div>
            <ChevronRight size={18} color="#94a3b8" />
          </div>
          <h3>Key Dates</h3>
          <p>Track renewal dates, policy validity, and residence milestones.</p>
          <div className="figma-hub-card-art">
            <div
              style={{
                width: 50,
                height: 42,
                background: "#f8fafc",
                border: "1.5px solid #cbd5e1",
                borderRadius: 8,
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <div
                style={{
                  width: "100%",
                  height: 10,
                  background: "#0ea58a",
                  borderTopLeftRadius: 6,
                  borderTopRightRadius: 6,
                }}
              />
              <span style={{ fontSize: 13, fontWeight: 800, color: "#0f1d38", marginTop: 2 }}>
                {userCtx.segmentDetails?.studyPeriod ? "26" : "01"}
              </span>
            </div>
          </div>
          <span className="figma-hub-card-pill neutral">
            <Clock size={13} /> Verification required for dates
          </span>
        </Link>
      </div>
    </div>
  );
}
