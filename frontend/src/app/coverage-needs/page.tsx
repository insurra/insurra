"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useState } from "react";
import { ArrowRight, CalendarDays, FileText, GraduationCap, MapPin, ShieldCheck } from "lucide-react";
import { api } from "@/lib/api/client";
import type { components } from "@/lib/api/types.gen";
import { useWorkspace } from "@/lib/workspace";
import { ConsentNotice, EmergencyNotice, WorkspaceState } from "@/components/workspace/workspace";
import "./coverage-needs.css";

type Need = components["schemas"]["CoverageNeed"];
type Filter = "all" | "REQUIRED" | "RECOMMENDED";
const statusLabel = {
  OWNED: "Covered",
  NOT_OWNED: "Not found in documents",
  NEEDS_CHECK: "Needs verification",
};
const dateLabel = (value?: string | null) => value
  ? new Intl.DateTimeFormat("en-US", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }).format(new Date(`${value}T00:00:00`))
  : "Not recorded";

export default function CoverageNeedsPage() {
  const workspace = useWorkspace();
  const [result, setResult] = useState<{ key: string; items: Need[] } | null>(null);
  const [failure, setFailure] = useState<{ key: string; message: string } | null>(null);
  const [filter, setFilter] = useState<Filter>("all");
  const requestKey = `${workspace.identityKey ?? ""}:${workspace.summary?.context?.country_code ?? ""}:${workspace.summary?.context?.process_documents ?? false}`;
  const needs = result?.key === requestKey ? result.items : null;
  const error = failure?.key === requestKey ? failure.message : null;
  useEffect(() => {
    const controller = new AbortController();
    if (workspace.summary?.context?.process_documents && workspace.headers) {
      api.request("get", "/api/v1/coverage-needs", { headers: workspace.headers, signal: controller.signal })
        .then((value) => { if (!controller.signal.aborted) { setResult({ key: requestKey, items: value }); setFailure(null); } })
        .catch((cause: unknown) => { if (!controller.signal.aborted) { setResult(null); setFailure({ key: requestKey, message: cause instanceof Error ? cause.message : "Coverage analysis is currently unavailable." }); } });
    }
    return () => controller.abort();
  }, [workspace.headers, workspace.summary, requestKey]);

  if (!workspace.summary) return <WorkspaceState workspace={workspace} />;
  const summary = workspace.summary;
  const context = summary.context;
  const visible = needs?.filter((need) => filter === "all" || need.requirement_level === filter) ?? [];
  const owned = needs?.filter((need) => need.ownership_status === "OWNED").length ?? 0;

  return <div className="vn coverage-dashboard" lang="en">
    <EmergencyNotice info={summary.emergency} />
    <header className="coverage-hero"><div><span className="coverage-eyebrow">MY PROTECTION / COVERAGE NEEDS</span><h1>Coverage Needs &amp; Gap Analysis</h1><p>Understand your active coverage, spot potential timing or category gaps, and see actionable next steps.</p></div><div className="coverage-hero-note"><Image src="/Winking%20Kangaroo%20Shield%20Mascot.png" alt="" width={100} height={100} /><div><strong>You have insurance. Are your actual needs covered?</strong><span>This assessment cross-references your profile context, uploaded records, and regional compliance rules. Unverified details stay explicitly flagged.</span></div></div></header>
    <div className="coverage-tabs" role="group" aria-label="Filter coverage needs">{([["all", "All Needs"], ["REQUIRED", "Mandatory Requirements"], ["RECOMMENDED", "Recommended Coverage"]] as const).map(([value, label]) => <button key={value} type="button" aria-pressed={filter === value} onClick={() => setFilter(value)}>{label}</button>)}</div>
    <div className="coverage-layout"><div className="coverage-main">
      <section className="coverage-panel"><div className="coverage-panel-heading"><h2>1. Profile &amp; Context</h2><Link href="/onboarding?mode=edit">Edit Profile <ArrowRight size={14} /></Link></div><div className="coverage-context-grid">
        <div className="coverage-context-item"><MapPin /><span>Location<strong>{[context?.city, context?.country_label].filter(Boolean).join(", ") || "Not recorded"}</strong></span></div>
        <div className="coverage-context-item"><GraduationCap /><span>Situation<strong>{context?.occupation_label || "Not recorded"}</strong></span></div>
        <div className="coverage-context-item"><CalendarDays /><span>Arrival Date<strong>{dateLabel(context?.arrival_date)}</strong></span></div>
        <div className="coverage-context-item"><FileText /><span>Stay / Visa Expiry<strong>{dateLabel(context?.visa_expiry_date)}</strong></span></div>
      </div></section>
      {!context?.process_documents ? <ConsentNotice /> : <>
        {error && <div className="vn-error" role="alert">{error} <button type="button" onClick={workspace.refresh}>Try again</button></div>}
        {!needs && !error && <p role="status">Checking rules and uploaded documents…</p>}
        {needs && <><section className="coverage-panel"><div className="coverage-panel-heading"><div><h2>2. Coverage Assessment</h2><p>Evaluated for {context?.country_label || "recorded"} context against verified evidence.</p></div><span className="coverage-count">{owned} of {needs.length} confirmed covered</span></div>
          {needs.length === 0 ? <p className="coverage-empty">No specific coverage rules available for this context yet. An empty result does not imply complete coverage.</p> : <div className="coverage-status-grid">{visible.map((need) => <article className={`coverage-status-card status-${need.ownership_status.toLowerCase()}`} key={need.need_code} data-testid={`coverage-need-${need.need_code}`}><div className="coverage-status-title"><span className="coverage-icon"><ShieldCheck size={18} /></span><h3>{need.label}</h3></div><div className="coverage-meter" aria-hidden="true"><span /></div><strong className="coverage-status-label">{statusLabel[need.ownership_status]}</strong><p>{need.explanation}</p><Link href={`#need-${need.need_code}`}>View details <ArrowRight size={14} /></Link></article>)}</div>}
          {needs.length > 0 && visible.length === 0 && <p className="coverage-empty">No needs match the selected filter.</p>}
        </section><section className="coverage-panel"><div className="coverage-panel-heading"><div><h2>3. Findings &amp; Evidence Verification</h2><p>Review the exact evidence, policy citations, and verification steps for each category.</p></div><Link href="/documents">Inspect Documents <ArrowRight size={14} /></Link></div><div className="coverage-findings">{visible.map((need) => <article id={`need-${need.need_code}`} className={`coverage-finding status-${need.ownership_status.toLowerCase()}`} key={need.need_code}><span className="coverage-finding-icon"><ShieldCheck size={19} /></span><div className="coverage-finding-body"><h3>{need.label}</h3><strong>{statusLabel[need.ownership_status]}</strong><p>{need.explanation}</p><span className="coverage-meta" data-testid={`need-applicability-${need.need_code}`}>{need.applicability.replace(/_/g, " ")}</span><span className="coverage-meta" data-testid={`need-evidence-state-${need.need_code}`}>{need.evidence_state.replace(/_/g, " ")}</span>{!need.requirement_confirmed && <small>Rule application unverified; does not represent legal certainty or institutional approval.</small>}{need.source_reference?.source_url ? <a href={need.source_reference.source_url} target="_blank" rel="noreferrer">Rule Source · {need.source_reference.checked_at || "date not recorded"}</a> : <small>Source and verification date unconfirmed.</small>}
          {need.visa_assessment && <div className="coverage-continuity" data-testid="continuity-assessment"><p>{typeof need.visa_assessment.gap_days === "number" ? `Identified ${need.visa_assessment.gap_days} calendar days requiring review.` : "Dates incomplete or pending verification."}</p>{need.continuity?.interval_start && need.continuity?.interval_end && <small>Recorded window: {dateLabel(need.continuity.interval_start)} – {dateLabel(need.continuity.interval_end)}{need.continuity.compared_to ? `; compared against ${dateLabel(need.continuity.compared_to)}` : ""}.</small>}<small>{need.visa_assessment.assessment_status === "NEEDS_VERIFICATION" ? "Needs verification. " : ""}Calculation uses inclusive calendar intervals.</small><Link href="/completeness?task=visa_cover">Review gap</Link></div>}
          {need.exclusion && <blockquote>{need.exclusion.original_text} · p. {need.exclusion.page_number}</blockquote>}{!!need.verification_steps?.length && <ul>{need.verification_steps.map((step) => <li key={step}>{step}</li>)}</ul>}</div><Link className="coverage-finding-action" href={need.action_url || "/documents"}>{need.ownership_status === "OWNED" ? "View Policy" : "Verify"} <ArrowRight size={14} /></Link></article>)}{visible.length === 0 && <p className="coverage-empty">No findings to display.</p>}</div></section></>}
      </>}
      <p className="vn-subtle">“Not found in documents” does not constitute proof of policy exclusion. INSURRA does not sell or endorse commercial insurance products.</p>
    </div><aside className="coverage-sidebar" aria-label="Supporting information"><section className="coverage-panel"><div className="coverage-panel-heading"><h2>Recorded Policies</h2><Link href="/policies">View All <ArrowRight size={14} /></Link></div><div className="coverage-policy-list">{summary.coverages?.length ? summary.coverages.map((coverage) => <div className="coverage-policy" key={coverage.id}><span className="coverage-icon"><ShieldCheck size={19} /></span><div><strong>{coverage.provider || coverage.kind}</strong><p>{coverage.kind} · {coverage.country_label || coverage.country_code}</p><small>{dateLabel(coverage.start_date)} – {dateLabel(coverage.end_date)}</small></div><span className="coverage-policy-state">{coverage.active ? "Active" : "Review"}</span></div>) : <p>No policies recorded yet.</p>}</div></section><section className="coverage-ask-card"><Image src="/Winking%20Kangaroo%20Shield%20Mascot.png" alt="" width={72} height={72} /><div><h2>Ask INSURRA</h2><p>Questions about your policy or coverage requirements?</p></div><Link href="/ask">Ask INSURRA <ArrowRight size={15} /></Link></section><section className="coverage-panel"><h2>Next Steps</h2><Link className="coverage-side-link" href="/documents"><FileText size={18} /> Review documents <ArrowRight size={14} /></Link><Link className="coverage-side-link" href="/completeness"><ShieldCheck size={18} /> Check completeness <ArrowRight size={14} /></Link><Link className="coverage-side-link" href="/pathways"><ArrowRight size={18} /> Care pathways <ArrowRight size={14} /></Link></section></aside></div>
  </div>;
}
