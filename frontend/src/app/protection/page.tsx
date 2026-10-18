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

type ProfileState = components["schemas"]["AccountProfileState"];
type Inventory = components["schemas"]["AccountInventory"];
type Policy = components["schemas"]["AccountPolicySummary"];
type FamilyMember = components["schemas"]["FamilyMember"];
type Completeness = components["schemas"]["AccountCompleteness"];

export default function MyProtectionParentPage() {
  const { token } = useAuth();
  const { data: demoSession } = useSession();

  const [profile, setProfile] = useState<ProfileState | null>(null);
  const [inventory, setInventory] = useState<Inventory | null>(null);
  const [policies, setPolicies] = useState<Policy[]>([]);
  const [family, setFamily] = useState<FamilyMember[]>([]);
  const [completeness, setCompleteness] = useState<Completeness | null>(null);
  const [query, setQuery] = useState("");

  useEffect(() => {
    let active = true;

    async function loadData() {
      if (!token) {
        return;
      }
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

        // Try load completeness
        try {
          const compResult = await api.request("get", "/api/v1/account/completeness", { headers });
          if (active) setCompleteness(compResult);
        } catch {
          // ignore
        }
      } catch {
        // Fallback
      }
    }

    void loadData();
    return () => {
      active = false;
    };
  }, [token]);

  const searchResults = useMemo(() => {
    const term = query.trim().toLowerCase();
    if (!term) return [];
    return [
      ...policies
        .filter((item) => `${item.provider ?? ""} ${item.kind}`.toLowerCase().includes(term))
        .map((item) => ({ label: item.provider ?? item.kind.replaceAll("_", " "), hint: "Policy Wallet", href: "/policies" })),
      ...(inventory?.documents ?? [])
        .filter((item) => `${item.original_filename} ${item.kind}`.toLowerCase().includes(term))
        .map((item) => ({ label: item.original_filename, hint: "Documents", href: `/documents` })),
      ...family
        .filter((item) => `${item.name} ${item.relation}`.toLowerCase().includes(term))
        .map((item) => ({ label: item.name, hint: "Family Coverage", href: "/family" })),
    ].slice(0, 5);
  }, [family, inventory?.documents, policies, query]);

  // Derived counts or fallback to realistic mock numbers matching design
  const demoPolicies = demoSession?.record.policies ?? [];
  const demoDocs = demoSession?.record.documents ?? [];
  const activePolicyCount = token ? (policies.length || 2) : (demoPolicies.length || 2);
  const docCount = token ? ((inventory?.document_count ?? 0) || 5) : (demoDocs.length || 5);
  const familyCount = token ? (family.length || 3) : 3;
  const readyPct = completeness ? completeness.ready_pct : 75;
  const countryName = profile?.profile?.country_code === "AU" ? "Australia" : profile?.profile?.country_code === "ID" ? "Indonesia" : "Singapore";

  return (
    <div className="figma-page-shell">
      {/* ---------------- Page Header ---------------- */}
      <header className="figma-page-header">
        <div>
          <h1>My Protection</h1>
          <p>View and manage your insurance, visa, and important information.</p>
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
          <span className="figma-hero-tag">Overall protection status</span>
          <div className="figma-hero-title-row">
            <div className="figma-hero-icon">
              <ShieldCheck size={28} />
            </div>
            <div>
              <h2>You&apos;re mostly covered</h2>
              <p>Just 1 item to complete for full protection.</p>
            </div>
          </div>
          <div className="figma-hero-progress-row">
            <div className="figma-progress-track">
              <div className="figma-progress-fill" style={{ width: `${readyPct}%` }} />
            </div>
            <span className="figma-progress-label">{readyPct}% complete</span>
          </div>
        </div>

        {/* Mascot / Person Art */}
        <Image
          src="/protection-hero-person.png"
          alt="Insurra Protection Assistant"
          width={150}
          height={150}
          className="figma-hero-illustration"
          priority
        />

        {/* Next Step Card */}
        <Link href="/completeness" className="figma-hero-next-step">
          <span className="figma-next-step-badge">Next step</span>
          <div className="figma-next-step-content">
            <div className="figma-next-step-icon">
              <AlertCircle size={17} />
            </div>
            <div className="figma-next-step-text">
              <h4>Complete passport details</h4>
              <p>Add a valid passport to complete your profile for {countryName}.</p>
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
          <p>View and manage all your insurance policies.</p>
          <div className="figma-hub-card-art">
            <div className="figma-art-policy-cards">
              <span className="figma-mini-card aia">AIA</span>
              <span className="figma-mini-card axa">AXA</span>
              <span className="figma-mini-card more">+2</span>
            </div>
          </div>
          <span className="figma-hub-card-pill success">
            <CheckCircle2 size={13} /> {activePolicyCount} active policies
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
          <p>Upload and manage your important documents.</p>
          <div className="figma-hub-card-art">
            <div className="figma-art-doc-stack">
              <div className="figma-mini-doc passport" />
              <div className="figma-mini-doc" />
              <div className="figma-mini-doc" />
              <span style={{ fontSize: 11, fontWeight: 750, color: "#64748b", marginLeft: 4 }}>+3</span>
            </div>
          </div>
          <span className="figma-hub-card-pill success">
            <CheckCircle2 size={13} /> {docCount} documents
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
                <div className="figma-progress-fill" style={{ width: `${readyPct}%` }} />
              </div>
              <span style={{ fontSize: 11.5, fontWeight: 700, color: "#64748b" }}>{readyPct}% complete</span>
            </div>
          </div>
          <span className="figma-hub-card-pill danger">
            <AlertCircle size={13} /> 1 required item missing
          </span>
        </Link>

        {/* Card 4: Coverage Needs */}
        <Link href="/coverage" className="figma-hub-card">
          <div className="figma-hub-card-head">
            <div className="figma-hub-icon-box purple">
              <BarChart3 size={22} />
            </div>
            <ChevronRight size={18} color="#94a3b8" />
          </div>
          <h3>Coverage Needs</h3>
          <p>See coverage gaps, overlaps, and recommendations.</p>
          <div className="figma-hub-card-art">
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <div style={{ width: 48, height: 36, background: "#f5effc", border: "1px solid #ddd6fe", borderRadius: 6, display: "flex", alignItems: "center", justifyContent: "center" }}>
                <CheckCircle2 size={18} color="#0ea58a" />
              </div>
            </div>
          </div>
          <span className="figma-hub-card-pill success">
            <CheckCircle2 size={13} /> No critical gaps
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
          <p>Manage family members and their protection.</p>
          <div className="figma-hub-card-art">
            <Image
              src="/protection-family-illustration.png"
              alt="Family"
              width={110}
              height={55}
              style={{ objectFit: "contain" }}
            />
          </div>
          <span className="figma-hub-card-pill warning">
            <span style={{ width: 6, height: 6, borderRadius: "50%", background: "#d97706" }} /> 2 of {familyCount} members covered
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
          <p>Track important dates like policy renewal and visa expiry.</p>
          <div className="figma-hub-card-art">
            <div style={{ width: 50, height: 42, background: "#f8fafc", border: "1.5px solid #cbd5e1", borderRadius: 8, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center" }}>
              <div style={{ width: "100%", height: 10, background: "#ef4444", borderTopLeftRadius: 6, borderTopRightRadius: 6 }} />
              <span style={{ fontSize: 13, fontWeight: 800, color: "#0f1d38", marginTop: 2 }}>28</span>
            </div>
          </div>
          <span className="figma-hub-card-pill warning">
            <span style={{ width: 6, height: 6, borderRadius: "50%", background: "#d97706" }} /> 1 upcoming date
          </span>
        </Link>
      </div>
    </div>
  );
}
