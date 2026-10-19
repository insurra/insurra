"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import {
  AlertCircle,
  ArrowRight,
  CalendarDays,
  CheckCircle2,
  ChevronRight,
  FileText,
  Search,
  ShieldCheck,
  Users,
  Wallet,
  ListChecks,
  BarChart3,
  Building2,
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
type Setup = components["schemas"]["AccountSetup"];
type Completeness = components["schemas"]["AccountCompleteness"];

type NextStep = { title: string; description: string; href: string };

export default function MyProtectionParentPage() {
  const { account, token, loading: authLoading } = useAuth();
  const { data: demoSession, loading: demoLoading } = useSession();
  const userContext = useUserContext();
  const [profileState, setProfileState] = useState<ProfileState | null>(null);
  const [inventory, setInventory] = useState<Inventory | null>(null);
  const [policies, setPolicies] = useState<Policy[]>([]);
  const [family, setFamily] = useState<FamilyMember[]>([]);
  const [setup, setSetup] = useState<Setup | null>(null);
  const [completeness, setCompleteness] = useState<Completeness | null>(null);
  const [query, setQuery] = useState("");

  useEffect(() => {
    if (!token) return;
    const controller = new AbortController();
    let active = true;
    const headers = { Authorization: `Bearer ${token}` };

    async function loadAccountData() {
      const [profileResult, inventoryResult, policiesResult, familyResult] = await Promise.allSettled([
        api.request("get", "/api/v1/account/profile", { headers, signal: controller.signal }),
        api.request("get", "/api/v1/account/inventory", { headers, signal: controller.signal }),
        api.request("get", "/api/v1/account/policies", { headers, signal: controller.signal }),
        api.request("get", "/api/v1/account/family", { headers, signal: controller.signal }),
      ]);
      if (!active) return;

      const nextProfile = profileResult.status === "fulfilled" ? profileResult.value : null;
      if (nextProfile) setProfileState(nextProfile);
      if (inventoryResult.status === "fulfilled") setInventory(inventoryResult.value);
      if (policiesResult.status === "fulfilled") setPolicies(policiesResult.value);
      if (familyResult.status === "fulfilled") setFamily(familyResult.value);

      const countryCode = nextProfile?.profile?.country_code;
      if (!countryCode) return;

      try {
        const nextSetup = await api.request("get", "/api/v1/account/setup/{country_code}", {
          params: { country_code: countryCode },
          headers,
          signal: controller.signal,
        });
        if (!active) return;
        setSetup(nextSetup);

        const firstTask = nextSetup.tasks.find((item) => typeof item.task_code === "string")?.task_code;
        if (typeof firstTask !== "string") return;
        const result = await api.request("get", "/api/v1/account/completeness", {
          query: { task: firstTask },
          headers,
          signal: controller.signal,
        });
        if (active) setCompleteness(result);
      } catch {
        // Without a task in the verified country KB, completeness remains unknown.
      }
    }

    void loadAccountData().catch(() => {
      // Keep the hub usable with any account data that did load successfully.
    });
    return () => {
      active = false;
      controller.abort();
    };
  }, [token]);

  const isDemo = !token && Boolean(demoSession);
  const displayName = account?.display_name ?? account?.email ?? "";
  const demoDependents = isDemo
    ? userContext.dependents.filter((name) => name && name.toLowerCase() !== "none")
    : [];
  const documentCount = token
    ? inventory?.document_count ?? 0
    : demoSession?.record.documents.length ?? 0;
  const policyCount = token
    ? policies.length
    : Math.max(demoSession?.record.policies.length ?? 0, isDemo ? userContext.declaredCoverages.length : 0);
  const familyCount = token ? family.length : demoDependents.length;
  const profileComplete = token
    ? Boolean(profileState?.completed)
    : isDemo && userContext.profileSetupComplete;

  const completenessItems = completeness?.items;
  const missingItems = useMemo(
    () => completenessItems?.filter((item) => item.status === "MISSING") ?? [],
    [completenessItems],
  );
  const unverifiedItems = useMemo(
    () => completenessItems?.filter((item) => item.status === "UNVERIFIED") ?? [],
    [completenessItems],
  );
  const readyPercent = completeness && completeness.total_count > 0 ? completeness.ready_pct : null;
  const hasCompleteness = Boolean(completeness && completeness.total_count > 0);

  const dateCount = useMemo(() => {
    const dates = new Set<string>();
    const visaDate = token
      ? profileState?.profile?.visa_expiry_date
      : demoSession?.profile.visa_expiry_date ?? userContext.segmentDetails.residencePermitExpiry;
    if (visaDate) dates.add(visaDate);
    const policyDates = token
      ? policies.map((policy) => policy.end_date)
      : (demoSession?.record.policies ?? []).map((policy) => policy.coverage_end_date);
    policyDates.forEach((date) => {
      if (date) dates.add(date);
    });
    return dates.size;
  }, [demoSession, policies, profileState, token, userContext.segmentDetails.residencePermitExpiry]);

  const nextStep = useMemo<NextStep>(() => {
    if (!profileComplete) {
      return {
        title: "Complete your profile context",
        description: "Add basic information to give your protection overview context.",
        href: "/onboarding",
      };
    }
    if (setup && setup.tasks.length === 0) {
      return {
        title: "Review available documents",
        description: "A completeness check is not available for this context yet.",
        href: "/documents",
      };
    }
    if (missingItems.length || unverifiedItems.length) {
      const firstItem = missingItems[0] ?? unverifiedItems[0];
      return {
        title: firstItem.status === "MISSING" ? "Add missing information" : "Verify information source",
        description: firstItem.status === "MISSING" ? "This information has not been found yet." : "Review the source for this information.",
        href: firstItem.document_id ? `/documents` : "/completeness",
      };
    }
    if (!documentCount) {
      return {
        title: "Upload your first document",
        description: "Add a policy or protection document for review.",
        href: "/documents",
      };
    }
    return {
      title: "Review your protection details",
      description: "Review the available information and its supporting sources.",
      href: "/completeness",
    };
  }, [documentCount, missingItems, profileComplete, setup, unverifiedItems]);

  const statusTitle = hasCompleteness && completeness
    ? missingItems.length
      ? `${missingItems.length} items not found`
      : unverifiedItems.length
        ? `${unverifiedItems.length} items need verification`
        : "Required information found"
    : setup && setup.tasks.length === 0
      ? "Checks are not available for this context yet"
    : profileComplete
      ? "Completeness check is not available yet"
      : "Start with your protection context";
  const statusDescription = hasCompleteness && completeness
    ? `${completeness.ready_count} of ${completeness.total_count} required items found${unverifiedItems.length ? ` · ${unverifiedItems.length} not yet verified` : ""}.`
    : setup && setup.tasks.length === 0
      ? "No completeness tasks are available for this context yet."
      : "Completeness details appear when profile information and checks are available.";

  const searchResults = useMemo(() => {
    const term = query.trim().toLocaleLowerCase();
    if (!term) return [];
    return [
      ...policies
        .filter((policy) => `${policy.provider ?? ""} ${policy.kind}`.toLocaleLowerCase().includes(term))
        .map((policy) => ({ label: policy.provider ?? policy.kind.replaceAll("_", " "), hint: "Policy Wallet", href: "/policies" })),
      ...(inventory?.documents ?? [])
        .filter((document) => `${document.original_filename} ${document.kind}`.toLocaleLowerCase().includes(term))
        .map((document) => ({ label: document.original_filename, hint: "Documents", href: "/documents" })),
      ...family
        .filter((member) => `${member.name} ${member.relation}`.toLocaleLowerCase().includes(term))
        .map((member) => ({ label: member.name, hint: "Family Coverage", href: "/family" })),
      ...userContext.declaredCoverages
        .filter(() => isDemo)
        .filter((coverage) => `${coverage.label} ${coverage.provider ?? ""}`.toLocaleLowerCase().includes(term))
        .map((coverage) => ({ label: coverage.label, hint: "Declared coverage", href: "/policies" })),
    ].slice(0, 6);
  }, [family, inventory?.documents, isDemo, policies, query, userContext.declaredCoverages]);

  if (authLoading || demoLoading) {
    return <main className="figma-page-shell"><p role="status">Loading My Protection…</p></main>;
  }

  const hubCards = [
    {
      title: "Policy Wallet",
      description: "View your policies and recorded information.",
      href: "/policies",
      icon: <Wallet size={21} />,
      tone: "mint",
      image: "/protection-policy-stack.png",
      imageAlt: "",
      pill: `${policyCount} policies recorded`,
      pillTone: "success",
    },
    {
      title: "Documents",
      description: "Upload and review your protection documents.",
      href: "/documents",
      icon: <FileText size={21} />,
      tone: "blue",
      image: "/protection-documents.png",
      imageAlt: "",
      pill: `${documentCount} documents stored`,
      pillTone: "success",
    },
    {
      title: "Data Completeness",
      description: "Check for information that is missing or unverified.",
      href: "/completeness",
      icon: <ListChecks size={21} />,
      tone: "green",
      image: "/protection-completeness.png",
      imageAlt: "",
      pill: hasCompleteness
        ? missingItems.length
          ? `${missingItems.length} items not found`
          : unverifiedItems.length
            ? `${unverifiedItems.length} need verification`
            : "Required information found"
        : "Not checked yet",
      pillTone: missingItems.length ? "danger" : unverifiedItems.length ? "warning" : "success",
    },
    {
      title: "Coverage Needs",
      description: "Analyze protection requirements, gaps, and mandatory coverage.",
      href: "/coverage-needs",
      icon: <BarChart3 size={21} />,
      tone: "purple",
      image: "/protection-coverage-checklist.png",
      imageAlt: "",
      pill: "Gap analysis ready",
      pillTone: "success",
    },
    {
      title: "Employer Benefits",
      description: "Review workplace insurance packages, limits, and deductible overlaps.",
      href: "/employer-benefits",
      icon: <Building2 size={21} />,
      tone: "blue",
      image: "/protection-documents.png",
      imageAlt: "",
      pill: "Group & corporate cover",
      pillTone: "neutral",
    },
    {
      title: "Family Coverage",
      description: "Manage family members and record linked policies.",
      href: "/family",
      icon: <Users size={21} />,
      tone: "amber",
      image: "/protection-family.png",
      imageAlt: "",
      pill: `${familyCount} family members`,
      pillTone: "warning",
    },
    {
      title: "Key Dates",
      description: "Track dates recorded in your profile and policies.",
      href: "/completeness",
      icon: <CalendarDays size={21} />,
      tone: "red",
      image: "/protection-calendar.png",
      imageAlt: "",
      pill: dateCount ? `${dateCount} dates recorded` : "No dates recorded",
      pillTone: "warning",
    },
  ] as const;

  return (
    <main className="figma-page-shell my-protection-page">
      <header className="figma-page-header my-protection-header">
        <div>
          <h1>My Protection</h1>
          <p>View and manage your insurance, documents, and important information.</p>
        </div>
        <div className="figma-search-input-wrap my-protection-search-wrap">
          <Search size={17} aria-hidden="true" />
          <input
            type="search"
            className="figma-search-input"
            placeholder="Search policies, documents, or members…"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            aria-label="Search policies, documents, or members"
          />
          {query && (
            <div className="protection-search-results" role="listbox">
              {searchResults.length ? searchResults.map((item) => (
                <Link key={`${item.href}-${item.label}`} href={item.href} role="option">
                  <span>{item.label}<small>{item.hint}</small></span><ArrowRight size={15} />
                </Link>
              )) : <p>No matching results.</p>}
            </div>
          )}
        </div>
      </header>

      <section className="figma-protection-hero my-protection-hero" aria-label="Protection completeness status">
        <div className="figma-hero-left my-protection-hero-copy">
          <span className="figma-hero-tag">OVERALL PROTECTION STATUS</span>
          <div className="figma-hero-title-row">
            <Image src="/protection-shield.png" alt="" width={68} height={68} className="my-protection-shield" />
            <div>
              <h2>{statusTitle}</h2>
              <p>{statusDescription}</p>
            </div>
          </div>
          <div className="figma-hero-progress-row">
            <div className="figma-progress-track" role="progressbar" aria-label="Data completeness" aria-valuemin={0} aria-valuemax={100} aria-valuenow={readyPercent ?? undefined}>
              <div className="figma-progress-fill" style={{ width: `${readyPercent ?? 0}%` }} />
            </div>
            <span className="figma-progress-label">{readyPercent === null ? "Not checked yet" : `${readyPercent}% · data found`}</span>
          </div>
          <small className="my-protection-disclaimer">Data completeness does not confirm active coverage or guaranteed benefits.</small>
        </div>
        <Image
          src="/protection-hero-checklist.png"
          alt="Illustration of a person reviewing protection information"
          width={190}
          height={190}
          className="figma-hero-illustration my-protection-hero-art"
          priority
        />
        <Link href={nextStep.href} className="figma-hero-next-step my-protection-next-step">
          <span className="figma-next-step-badge">NEXT STEP</span>
          <div className="figma-next-step-content">
            <div className="figma-next-step-icon"><AlertCircle size={18} /></div>
            <div className="figma-next-step-text"><h4>{nextStep.title}</h4><p>{nextStep.description}</p></div>
            <ChevronRight size={18} aria-hidden="true" />
          </div>
        </Link>
      </section>

      <section className="figma-protection-grid my-protection-grid" aria-label="My Protection features">
        {hubCards.map((card) => {
          const content = (
            <>
              <div className="my-protection-card-heading">
                <span className={`figma-hub-icon-box ${card.tone}`}>{card.icon}</span>
                <span className="my-protection-card-copy"><strong>{card.title}</strong><small>{card.description}</small></span>
                {card.href && <ChevronRight className="my-protection-card-arrow" size={18} aria-hidden="true" />}
              </div>
              <Image src={card.image} alt={card.imageAlt} width={150} height={126} className="my-protection-card-art" />
              <span className={`figma-hub-card-pill ${card.pillTone}`}>
                {card.pillTone === "danger" ? <AlertCircle size={14} /> : card.pillTone === "warning" ? <CalendarDays size={14} /> : <CheckCircle2 size={14} />}
                {card.pill}
              </span>
            </>
          );
          return card.href ? (
            <Link href={card.href} className="figma-hub-card my-protection-card" key={card.title}>{content}</Link>
          ) : (
            <div className="figma-hub-card my-protection-card my-protection-card-disabled" key={card.title} aria-disabled="true">{content}</div>
          );
        })}
      </section>

      <footer className="my-protection-footer">
        <ShieldCheck size={15} aria-hidden="true" />
        <span>Information is summarized from your available profile and documents. Review original sources before making decisions.</span>
        {displayName && <span className="my-protection-account-label">{displayName}</span>}
      </footer>
    </main>
  );
}
