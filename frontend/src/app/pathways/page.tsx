"use client";

import { useEffect, useRef, useState } from "react";
import { api } from "@/lib/api/client";
import type { components } from "@/lib/api/types.gen";
import { useWorkspace } from "@/lib/workspace";
import { PathwayConfirmation } from "@/components/workspace/pathway-confirmation";
import {
  ConsentNotice,
  EmergencyNotice,
  WorkspaceState,
} from "@/components/workspace/workspace";

type Comparison = components["schemas"]["PathwayComparison"];
type Request = components["schemas"]["PathwayComparisonRequest"];

export default function PathwaysPage() {
  const workspace = useWorkspace();
  const [complaint, setComplaint] = useState("");
  const [service, setService] = useState("");
  const [city, setCity] = useState<string | null>(null);
  const [timeframe, setTimeframe] = useState<Request["timeframe"]>("unknown");
  const [result, setResult] = useState<Comparison | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [emergency, setEmergency] = useState(false);
  const [copied, setCopied] = useState(false);
  const [selected, setSelected] = useState<
    components["schemas"]["PathwayOption"] | null
  >(null);
  const [created, setCreated] = useState<string | null>(null);
  const pending = useRef<AbortController | null>(null);
  const country = workspace.summary?.context?.country_code;
  useEffect(() => {
    // An identity/country refresh clears prior decisions and aborts stale responses.
    pending.current?.abort();
    queueMicrotask(() => {
      setResult(null);
      setError(null);
      setEmergency(false);
      setBusy(false);
      setComplaint("");
      setCity(null);
      setService("");
      setSelected(null);
      setCreated(null);
    });
    return () => pending.current?.abort();
  }, [country, workspace.identityKey]);
  useEffect(() => {
    pending.current?.abort();
    queueMicrotask(() => {
      setResult(null);
      setSelected(null);
      setBusy(false);
    });
  }, [workspace.summary]);
  if (!workspace.summary) return <WorkspaceState workspace={workspace} />;
  const summary = workspace.summary;
  const enabled = Boolean(
    summary.context?.process_documents && summary.triage_available,
  );
  async function compare(event: React.FormEvent) {
    event.preventDefault();
    if (!workspace.headers || busy || !enabled || !complaint.trim() || !service)
      return;
    const controller = new AbortController();
    pending.current = controller;
    setBusy(true);
    setResult(null);
    setError(null);
    setEmergency(false);
    setCopied(false);
    try {
      const value = await api.request("post", "/api/v1/pathways/compare", {
        headers: workspace.headers,
        signal: controller.signal,
        body: {
          complaint,
          service_type: service,
          city: city ?? summary.context?.city,
          timeframe,
        },
      });
      if (controller.signal.aborted) return;
      if ("redirect" in value) {
        setEmergency(true);
        setComplaint("");
      } else if (value.context_country_code !== country)
        setError("Context has changed. Please run comparison again.");
      else {
        setResult(value);
        setComplaint("");
      }
    } catch (cause: unknown) {
      if (!controller.signal.aborted)
        setError(
          cause instanceof Error
            ? cause.message
            : "Pathway comparison unavailable.",
        );
    } finally {
      if (!controller.signal.aborted) setBusy(false);
    }
  }
  async function copy() {
    if (!result) return;
    try {
      await navigator.clipboard.writeText(
        (result.uncertainties ?? [])
          .map((q) => `${q.label}\n${q.steps.join("\n")}`)
          .join("\n\n"),
      );
      setCopied(true);
    } catch {
      setError(
        "Clipboard copy not permitted by browser. Select and copy the text below.",
      );
    }
  }
  return (
    <div className="vn" lang="en">
      {selected && result?.comparison_id && workspace.headers && (
        <PathwayConfirmation
          key={`${result.comparison_id}:${selected.pathway_code}`}
          path={selected}
          comparisonId={result.comparison_id}
          headers={workspace.headers}
          onClose={() => setSelected(null)}
          onCreated={(id) => {
            setCreated(id);
            setSelected(null);
            setResult(null);
          }}
        />
      )}
      <EmergencyNotice info={summary.emergency} />
      {created && (
        <div className="vn-card" role="status">
          <h2>Claim Case Created</h2>
          <p>Draft Status · ID {created}</p>
          <p>
            Case has been saved to Claims Center.
          </p>
        </div>
      )}
      <header>
        <h1>Care Pathways</h1>
        <p>{summary.pathway_help ?? "Compare non-emergency healthcare pathways based on your insurance and location."}</p>
      </header>
      {!summary.context?.process_documents && <ConsentNotice />}
      {!summary.triage_available && (
        <div className="vn-state" role="note">
          <strong>Comparison Unavailable</strong>
          <p>
            Red-flag triage rules are not verified for this country context.
            Care pathways are locked until verified safety rules are configured.
          </p>
        </div>
      )}
      {emergency && (
        <div className="vn-error" role="alert">
          <strong>Symptoms may require urgent emergency care.</strong>
          <p>
            Pathway comparison has been stopped for safety. Please call local emergency services immediately or use the topbar SOS button.
          </p>
        </div>
      )}
      {error && (
        <p className="vn-error" role="alert">
          {error}
        </p>
      )}
      <form className="vn-card vn-form" onSubmit={compare}>
        <label>
          Describe your healthcare need
          <textarea
            value={complaint}
            maxLength={300}
            disabled={!enabled || busy}
            onChange={(e) => setComplaint(e.target.value)}
            placeholder="Describe your non-emergency symptoms or healthcare need…"
          />
        </label>
        <small>{complaint.length}/300 characters · Not stored as raw text</small>
        <fieldset disabled={!enabled || busy}>
          <legend>Service type</legend>
          <div className="vn-chips">
            {(summary.service_types ?? []).map((s) => (
              <button
                key={s.code}
                type="button"
                aria-pressed={service === s.code}
                onClick={() => setService(s.code)}
              >
                {s.label}
              </button>
            ))}
          </div>
          {!(summary.service_types ?? []).length && (
            <p>Service types not yet loaded in knowledge base.</p>
          )}
        </fieldset>
        <label>
          City
          <input
            maxLength={100}
            value={city ?? summary.context?.city ?? ""}
            disabled={!enabled || busy}
            onChange={(e) => setCity(e.target.value)}
          />
        </label>
        <label>
          When do you need care?
          <select
            value={timeframe}
            disabled={!enabled || busy}
            onChange={(e) =>
              setTimeframe(e.target.value as Request["timeframe"])
            }
          >
            <option value="today">Today</option>
            <option value="this_week">This week</option>
            <option value="unknown">Not sure yet</option>
          </select>
        </label>
        <button
          className="vn-primary"
          disabled={!enabled || busy || !complaint.trim() || !service}
        >
          {busy ? "Comparing pathways…" : "Compare pathways"}
        </button>
        {busy && (
          <button
            type="button"
            onClick={() => {
              pending.current?.abort();
              setBusy(false);
            }}
          >
            Cancel
          </button>
        )}
      </form>
      {result && (
        <>
          <section aria-label="Pathway comparison">
            <h2>Available Care Pathways</h2>
            <div className="vn-grid">
              {result.paths.map((path) => (
                <article className="vn-card" key={path.pathway_code}>
                  <h3>{path.name}</h3>
                  <p>{path.description}</p>
                  {path.best_for_priority && (
                    <div>
                      <span className="vn-badge">
                        Best match for your preferences
                      </span>
                      <p>{path.priority_reason}</p>
                    </div>
                  )}
                  <p>
                    {path.coverage_label ??
                      "Active coverage could not be confirmed"}
                  </p>
                  <small>
                    {path.coverage_status === "MATCHED"
                      ? "Active policy found; check specific clinic eligibility rules."
                      : "Needs verification · Not an exclusion of benefits."}
                  </small>
                  <h4>Steps to receive care</h4>
                  <ol>
                    {path.steps.map((step, i) => (
                      <li key={i}>{step}</li>
                    ))}
                  </ol>
                  <h4>Requirements</h4>
                  <ul>
                    {path.requirements.map((s, i) => (
                      <li key={i}>{s}</li>
                    ))}
                  </ul >
                  <h4>Estimated out-of-pocket</h4>
                  {path.est_out_of_pocket ? (
                    <div>
                      <span className="vn-badge">
                        Estimated
                        {path.est_out_of_pocket.synthetic
                          ? " · synthetic demo assumption"
                          : ""}
                      </span>
                      <p>
                        {path.est_out_of_pocket.currency}{" "}
                        {path.est_out_of_pocket.minimum}–
                        {path.est_out_of_pocket.maximum}
                      </p>
                      <a
                        href={
                          path.est_out_of_pocket.source_reference.source_url ??
                          undefined
                        }
                        target="_blank"
                        rel="noreferrer"
                      >
                        Fee reference ·{" "}
                        {path.est_out_of_pocket.source_reference.checked_at}
                      </a>
                    </div>
                  ) : (
                    <p>
                      Unknown · fee schedules not sufficiently verified to estimate out-of-pocket costs.
                    </p>
                  )}
                  <h4>Documents to bring</h4>
                  <ul>
                    {path.docs.map((s, i) => (
                      <li key={i}>{s}</li>
                    ))}
                  </ul>
                  <ul>
                    {path.uncertainties.map((s, i) => (
                      <li key={i}>{s}</li>
                    ))}
                  </ul>
                  {path.sources.map((source, i) => (
                    <div key={i}>
                      {source.source_url ? (
                        <a
                          href={source.source_url}
                          target="_blank"
                          rel="noreferrer"
                        >
                          Official guidelines
                        </a>
                      ) : (
                        <span>Source unavailable</span>
                      )}
                      <small>
                        {" "}
                        ·{" "}
                        {source.verification_status === "VERIFIED"
                          ? "Verified source"
                          : "Unverified"}{" "}
                        · {source.checked_at ?? "Date not recorded"}
                      </small>
                    </div>
                  ))}
                  <button
                    disabled={
                      !path.emergency &&
                      (!path.coverage_id || !result.comparison_id)
                    }
                    title={
                      !path.coverage_id
                        ? "Active coverage must be confirmed before creating a case"
                        : undefined
                    }
                    onClick={() => {
                      if (path.emergency) {
                        setResult(null);
                        setEmergency(true);
                      } else setSelected(path);
                    }}
                  >
                    {path.emergency ? "Emergency Guidance" : "Select this pathway"}
                  </button>
                </article>
              ))}
            </div>
          </section>
          <section className="vn-card">
            <h2>Points to Clarify with Provider</h2>
            {(result.uncertainties ?? []).length ? (
              <ul>
                {(result.uncertainties ?? []).map((q) => (
                  <li key={q.code}>
                    <strong>{q.label}</strong>
                    <p>{q.impact}</p>
                    <ul>
                      {q.steps.map((s, i) => (
                        <li key={i}>{s}</li>
                      ))}
                    </ul>
                  </li>
                ))}
              </ul>
            ) : (
              <p>Key requirements verified from your records.</p>
            )}
            <div className="vn-actions">
              <button
                onClick={copy}
                disabled={!(result.uncertainties ?? []).length}
              >
                Copy questions for clinic
              </button>
            </div>
            {copied && <p role="status">Questions copied to clipboard.</p>}
          </section>
          <div className="vn-warnings">
            {(result.warnings ?? []).map((s, i) => (
              <p key={i}>{s}</p>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
