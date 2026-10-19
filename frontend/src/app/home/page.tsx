"use client";

import Link from "next/link";
import { useState } from "react";
import { api } from "@/lib/api/client";
import { useWorkspace } from "@/lib/workspace";
import { EmergencyNotice, WorkspaceState } from "@/components/workspace/workspace";

export default function HomePage() {
  const workspace = useWorkspace();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  if (!workspace.summary) return <WorkspaceState workspace={workspace} />;
  const s = workspace.summary;
  const context = s.context;
  const cards = s.coverages ?? [];
  const warnings = s.warnings ?? [];
  async function decide(
    rule_id: string,
    subject: string,
    decision: "dismiss" | "handled",
  ) {
    if (
      !workspace.headers ||
      (decision === "handled" &&
        !window.confirm(
          "Confirm that you have handled this step. The recommendation will stay visible until your records are refreshed.",
        ))
    )
      return;
    setBusy(true);
    setError(null);
    try {
      await api.request("post", "/api/v1/home/recommendations/decision", {
        headers: workspace.headers,
        body: { rule_id, subject, decision, confirmed: decision === "handled" },
      });
      workspace.refresh();
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Decision could not be saved.",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="vn">
      <EmergencyNotice info={s.emergency} />
      <header>
        <span className="vn-subtle">
          {context?.synthetic ? "SYNTHETIC DEMO" : "PERSONAL WORKSPACE"}
        </span>
        <h1>Hello, {context?.first_name}.</h1>
        <p>
          {context?.country_label} · {context?.city ?? "City not set"} ·{" "}
          {context?.occupation_label}
        </p>
        {context?.arrival_date && (
          <p>
            {typeof context.days_since_arrival === "number"
              ? `Day ${context.days_since_arrival} since arrival`
              : `Arrival planned on ${context.arrival_date}`}{" "}
            · Visa expires {context.visa_expiry_date ?? "not set"}
          </p>
        )}
        <small>
          Context date: {context?.today} · {context?.timezone}
        </small>
      </header>
      <nav className="vn-actions" aria-label="Situation shortcuts">
        <Link href="/ask">Ask INSURRA</Link>
        <Link href="/pathways">I need healthcare</Link>
        {s.active ? (
          <Link href="/claims">Prepare claim</Link>
        ) : (
          <button disabled title="Upload policy documents first">
            Prepare claim
          </button>
        )}
        <Link href="/coverage-needs">What coverage do I need?</Link>
      </nav>
      {!cards.length && (
        <section className="vn-state">
          <h2>No coverage recorded yet</h2>
          <Link href="/documents">Upload your first document</Link>
        </section>
      )}
      <section className="vn-grid" aria-label="Coverage summary">
        {[
          {
            label: "Active coverage",
            count: s.active,
            filter: (c: (typeof cards)[number]) => c.active,
          },
          {
            label: "Expiring ≤ 30 days",
            count: s.expiring_30d,
            filter: (c: (typeof cards)[number]) => c.expiring_30d,
          },
          {
            label: "Needs verification",
            count: s.needs_verification,
            filter: (c: (typeof cards)[number]) => c.needs_verification,
          },
        ].map((card) => (
          <details className="vn-card" key={card.label}>
            <summary>
              <strong>{card.count}</strong>
              {card.label}
            </summary>
            <ul>
              {cards.filter(card.filter).map((c) => (
                <li key={c.id}>
                  <strong>{c.provider ?? "Provider not specified"}</strong> ·{" "}
                  {c.kind}
                  <p>
                    Record country: {c.country_code} ({c.country_label}) · End{" "}
                    {c.end_date ?? "unknown"}
                  </p>
                </li>
              ))}
            </ul>
          </details>
        ))}
      </section>
      <section>
        <h2>Recommended Next Steps</h2>
        {error && <p role="alert">{error}</p>}
        <div className="vn-list">
          {s.recommendations.map((r) => (
            <article className="vn-card" key={`${r.rule_id}:${r.subject}`}>
              <h3>{r.title}</h3>
              <p>{r.explanation}</p>
              <small>
                Rule: {r.rule_id}
                {r.handled
                  ? " · Marked as handled; check for data updates."
                  : ""}
              </small>
              {r.source?.source_url ? (
                <a href={r.source.source_url} target="_blank" rel="noreferrer">
                  Rule source · {r.source.checked_at}
                </a>
              ) : (
                <small>
                  Needs confirmation · Rule source unverified
                </small>
              )}
              <div className="vn-actions">
                <Link href={r.action_url}>Review now</Link>
                <button
                  disabled={busy}
                  onClick={() =>
                    void decide(
                      r.rule_id,
                      r.subject,
                      r.dismissible ? "dismiss" : "handled",
                    )
                  }
                >
                  {r.dismissible ? "Dismiss 7 days" : "Mark as handled"}
                </button>
              </div>
            </article>
          ))}
        </div>
        {!s.recommendations.length && (
          <p>
            All clear for configured rules in this context. Review any unverified data.
          </p>
        )}
      </section>
      {warnings.length > 0 && (
        <div className="vn-warnings">
          {warnings.map((w) => (
            <p key={w}>{w}</p>
          ))}
        </div>
      )}
      <p className="vn-subtle">
        Summary computed deterministically. Missing data does not imply coverage exclusion. Action service reminders are coming soon.
      </p>
    </div>
  );
}
