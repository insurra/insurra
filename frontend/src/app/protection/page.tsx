"use client";

import Image from "next/image";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import {
  ArrowRight,
  Briefcase,
  ChevronRight,
  ClipboardCheck,
  FileText,
  Info,
  Plus,
  Shield,
  ShieldAlert,
  UploadCloud,
  Users,
  Wallet,
} from "lucide-react";
import { api } from "@/lib/api/client";
import { useAuth } from "@/lib/auth";
import { useSession } from "@/lib/session";
import { Button } from "@/components/ui/button";

interface ProtectionSummaryState {
  totalPolicies: number;
  expiringPolicies: number;
  readinessScore: number | null;
  missingFieldsCount: number;
  familyMembersCount: number;
  documentsCount: number;
  countryCode: string;
  hasUnverifiedFields: boolean;
}

export default function MyProtectionParentPage() {
  const { token } = useAuth();
  const { data: sessionData } = useSession();

  const [loading, setLoading] = useState(true);
  const [summary, setSummary] = useState<ProtectionSummaryState>({
    totalPolicies: 0,
    expiringPolicies: 0,
    readinessScore: null,
    missingFieldsCount: 0,
    familyMembersCount: 0,
    documentsCount: 0,
    countryCode: "AU",
    hasUnverifiedFields: false,
  });

  const loadProtectionData = useCallback(async () => {
    if (!token) {
      // Demo session fallback stats
      if (sessionData) {
        setSummary({
          totalPolicies: sessionData.record.policies.length,
          expiringPolicies: 0,
          readinessScore: sessionData.record.policies.length > 0 ? 83 : null,
          missingFieldsCount: sessionData.record.policies.length > 0 ? 1 : 0,
          familyMembersCount: 1,
          documentsCount: sessionData.record.documents.length,
          countryCode: sessionData.record.country_code || "AU",
          hasUnverifiedFields: sessionData.record.policies.length > 0,
        });
      }
      setLoading(false);
      return;
    }

    try {
      setLoading(true);
      const headers = { Authorization: `Bearer ${token}` };

      // Load policies, completeness, family, and documents in parallel
      const [policiesRes, completenessRes, familyRes, docsRes, profileRes] = await Promise.allSettled([
        api.request("get", "/api/v1/account/policies", { headers }),
        api.request("get", "/api/v1/account/completeness", { headers }),
        api.request("get", "/api/v1/account/family", { headers }),
        api.request("get", "/api/v1/account/documents", { headers }),
        api.request("get", "/api/v1/account/profile", { headers }),
      ]);

      const policies = policiesRes.status === "fulfilled" ? policiesRes.value : [];
      const completeness = completenessRes.status === "fulfilled" ? completenessRes.value : null;
      const family = familyRes.status === "fulfilled" ? familyRes.value : [];
      const documents = docsRes.status === "fulfilled" ? docsRes.value : [];
      const profileState = profileRes.status === "fulfilled" ? profileRes.value : null;

      const missingCount = completeness
        ? completeness.items.filter((item: { status: string }) => item.status === "MISSING").length
        : 0;

      const unverifiedCount = completeness
        ? completeness.items.filter((item: { status: string }) => item.status === "UNVERIFIED").length
        : 0;

      const country = profileState?.profile?.country_code || "AU";

      setSummary({
        totalPolicies: policies.length,
        expiringPolicies: policies.filter(
          (p: { status: string }) => p.status === "EXPIRING_SOON"
        ).length,
        readinessScore: completeness ? completeness.ready_pct : null,
        missingFieldsCount: missingCount,
        familyMembersCount: family.length,
        documentsCount: documents.length,
        countryCode: country,
        hasUnverifiedFields: unverifiedCount > 0 || missingCount > 0,
      });
    } catch {
      // Keep sensible defaults on error
    } finally {
      setLoading(false);
    }
  }, [token, sessionData]);

  useEffect(() => {
    let ignore = false;
    Promise.resolve().then(() => {
      if (!ignore) {
        void loadProtectionData();
      }
    });
    return () => {
      ignore = true;
    };
  }, [loadProtectionData]);

  const isEmpty = summary.totalPolicies === 0 && summary.documentsCount === 0;

  return (
    <div className="protection-screen my-protection-hub">
      {/* ---------------- Breadcrumb Navigation ---------------- */}
      <nav aria-label="Breadcrumb" className="protection-breadcrumb">
        <Link href="/dashboard">Dashboard</Link>
        <ChevronRight size={14} className="breadcrumb-separator" />
        <span aria-current="page">My Protection</span>
      </nav>

      {/* ---------------- Page Heading ---------------- */}
      <div className="page-heading">
        <div>
          <div className="eyebrow">PERSONAL INSURANCE HUB</div>
          <h1>My Protection</h1>
          <p>All your insurance, policy clauses, and evidence records in one place.</p>
        </div>
        <Image
          src="/protection-mascot.png"
          alt="Insurra Companion Mascot"
          width={84}
          height={84}
          priority
        />
      </div>

      {/* ---------------- PRT-03: Priority Action Banner ---------------- */}
      {!isEmpty && summary.hasUnverifiedFields && (
        <section className="card priority-alert-card" aria-label="Priority Action Required">
          <div className="priority-alert-icon">
            <ShieldAlert size={26} />
          </div>
          <div className="priority-alert-content">
            <div className="priority-alert-badge">Needs Review</div>
            <h2>1 item needs your attention</h2>
            <p>
              Your coverage information is still being verified against your document sources and country rules.
            </p>
          </div>
          <div className="priority-alert-action">
            <Button asChild size="sm">
              <Link href="/completeness">
                Review Missing Information <ArrowRight size={15} />
              </Link>
            </Button>
          </div>
        </section>
      )}

      {/* ---------------- Overview Stats Strip ---------------- */}
      <section className="card protection-overview-strip" aria-label="Protection Overview">
        <div className="overview-metric">
          <span className="overview-metric-label">Active Policies</span>
          <strong className="overview-metric-val">{loading ? "..." : summary.totalPolicies}</strong>
          <small>{summary.expiringPolicies > 0 ? `${summary.expiringPolicies} expiring soon` : "All valid"}</small>
        </div>

        <div className="overview-metric-divider" />

        <div className="overview-metric">
          <span className="overview-metric-label">Evidence Readiness</span>
          <strong className="overview-metric-val">
            {loading ? "..." : summary.readinessScore !== null ? `${summary.readinessScore}%` : "Not evaluated"}
          </strong>
          <small>{summary.missingFieldsCount > 0 ? `${summary.missingFieldsCount} missing items` : "Checklist evaluated"}</small>
        </div>

        <div className="overview-metric-divider" />

        <div className="overview-metric">
          <span className="overview-metric-label">Family Covered</span>
          <strong className="overview-metric-val">{loading ? "..." : summary.familyMembersCount}</strong>
          <small>Household dependents</small>
        </div>

        <div className="overview-metric-divider" />

        <div className="overview-metric">
          <span className="overview-metric-label">Document Sources</span>
          <strong className="overview-metric-val">{loading ? "..." : summary.documentsCount}</strong>
          <small>Verified evidence files</small>
        </div>
      </section>

      {/* ---------------- PRT-06: Empty State (First-time user) ---------------- */}
      {isEmpty && !loading ? (
        <section className="card account-empty" style={{ margin: "24px 0" }}>
          <UploadCloud size={46} color="#0ea58a" />
          <h2>No insurance recorded yet</h2>
          <p>
            Upload your first policy document to start mapping benefits, checking visa rules, and inspecting limits.
          </p>
          <Button asChild size="lg">
            <Link href="/documents">
              <Plus size={16} /> Add Your First Policy
            </Link>
          </Button>
        </section>
      ) : null}

      {/* ---------------- PRT-04 & PRT-05: Child Navigation Grid ---------------- */}
      <div className="section-heading" style={{ marginTop: "32px", marginBottom: "16px" }}>
        <div>
          <h2>Protection Modules</h2>
          <p>Select a module to view detailed clauses, test requirements, or manage family records.</p>
        </div>
      </div>

      <div className="protection-hub-grid">
        {/* Card 1: Policy Wallet (SC-13 · P1) */}
        <Link href="/policies" className="card protection-feature-card">
          <div className="feature-card-head">
            <div className="feature-card-icon wallet-icon">
              <Wallet size={22} />
            </div>
            <span className="badge success">P1 · Live</span>
          </div>
          <h3>Policy Wallet</h3>
          <p>
            View all your policies in one place, including benefit limits, exclusions, and waiting periods.
          </p>
          <div className="feature-card-foot">
            <span className="feature-link-label">
              View Policies <ArrowRight size={14} />
            </span>
          </div>
        </Link>

        {/* Card 2: Data Completeness (SC-04 · P0) */}
        <Link href="/completeness" className="card protection-feature-card">
          <div className="feature-card-head">
            <div className="feature-card-icon completeness-icon">
              <ClipboardCheck size={22} />
            </div>
            <span className="badge success">P0 · Core</span>
          </div>
          <h3>Data Completeness</h3>
          <p>
            Check whether required information for visa conditions and claim tasks is complete and verified.
          </p>
          <div className="feature-card-foot">
            <span className="feature-link-label">
              Check Readiness <ArrowRight size={14} />
            </span>
          </div>
        </Link>

        {/* Card 3: Documents & AI Extraction (SC-03 · P0) */}
        <Link href="/documents" className="card protection-feature-card">
          <div className="feature-card-head">
            <div className="feature-card-icon documents-icon">
              <FileText size={22} />
            </div>
            <span className="badge success">P0 · Core</span>
          </div>
          <h3>Documents &amp; AI Extraction</h3>
          <p>
            Upload policy schedules and booklets to extract clauses with exact source page evidence.
          </p>
          <div className="feature-card-foot">
            <span className="feature-link-label">
              Upload and Review <ArrowRight size={14} />
            </span>
          </div>
        </Link>

        {/* Card 4: Family Coverage (SC-18 · P1) */}
        <Link href="/family" className="card protection-feature-card">
          <div className="feature-card-head">
            <div className="feature-card-icon family-icon">
              <Users size={22} />
            </div>
            <span className="badge success">P1 · Live</span>
          </div>
          <h3>Family Coverage</h3>
          <p>
            Organize dependents, link individual policies, and track household protection with explicit consent.
          </p>
          <div className="feature-card-foot">
            <span className="feature-link-label">
              Manage Family <ArrowRight size={14} />
            </span>
          </div>
        </Link>

        {/* Card 5: Coverage Needs (P0 / Beta) */}
        <Link href="/coverage" className="card protection-feature-card">
          <div className="feature-card-head">
            <div className="feature-card-icon coverage-icon">
              <Shield size={22} />
            </div>
            <span className="badge neutral">P0 · Beta</span>
          </div>
          <h3>Coverage Needs</h3>
          <p>
            Explore protection gaps, deductible limits, and health scenarios tailored to your residence.
          </p>
          <div className="feature-card-foot">
            <span className="feature-link-label">
              Explore Gaps <ArrowRight size={14} />
            </span>
          </div>
        </Link>

        {/* Card 6: Employer Benefits (P1 / Beta) */}
        <Link href="/employer-benefits" className="card protection-feature-card">
          <div className="feature-card-head">
            <div className="feature-card-icon employer-icon">
              <Briefcase size={22} />
            </div>
            <span className="badge neutral">P1 · Preview</span>
          </div>
          <h3>Employer Benefits</h3>
          <p>
            Review corporate group health coverage, workplace allowances, and coordinated provider networks.
          </p>
          <div className="feature-card-foot">
            <span className="feature-link-label">
              Inspect Benefits <ArrowRight size={14} />
            </span>
          </div>
        </Link>
      </div>

      {/* ---------------- PRT-08: Legal & Coverage Disclaimer ---------------- */}
      <aside className="protection-disclaimer-card" aria-label="Compliance Disclaimer">
        <Info size={18} className="disclaimer-icon" />
        <p>
          <strong>Evidence Based Guidance:</strong> Readiness scores reflect available document evidence
          extracted from your uploaded files, not legal visa certainty or a guarantee of claim payment.
          Always confirm coverage details with your insurer before incurring major medical expenses.
        </p>
      </aside>
    </div>
  );
}
