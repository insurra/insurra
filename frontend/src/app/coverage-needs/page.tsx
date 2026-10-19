"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { api } from "@/lib/api/client";
import type { components } from "@/lib/api/types.gen";
import { useWorkspace } from "@/lib/workspace";
import {
  ConsentNotice,
  EmergencyNotice,
  WorkspaceState,
} from "@/components/workspace/workspace";

type Need = components["schemas"]["CoverageNeed"];
const statusLabel = {
  OWNED: "Covered",
  NOT_OWNED: "Not covered on record",
  NEEDS_CHECK: "Needs verification",
};
export default function CoverageNeedsPage() {
  const workspace = useWorkspace();
  const [needs, setNeeds] = useState<Need[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    if (workspace.summary?.context?.process_documents && workspace.headers) {
      api
        .request("get", "/api/v1/coverage-needs", {
          headers: workspace.headers,
          signal: controller.signal,
        })
        .then((value) => {
          if (!controller.signal.aborted) {
            setNeeds(value);
            setError(null);
          }
        })
        .catch((cause: unknown) => {
          if (!controller.signal.aborted) {
            setNeeds(null);
            setError(
              cause instanceof Error
                ? cause.message
                : "Coverage needs analysis unavailable.",
            );
          }
        });
    }
    return () => controller.abort();
  }, [workspace.headers, workspace.summary]);
  if (!workspace.summary) return <WorkspaceState workspace={workspace} />;
  const s = workspace.summary;
  return (
    <div className="vn" lang="en">
      <EmergencyNotice info={s.emergency} />
      <header>
        <h1>Coverage Needs for {s.context?.country_label}</h1>
        <p>
          {s.context?.country_label} · {s.context?.occupation_label}
        </p>
        <Link href="/onboarding?mode=edit">Update context</Link>
      </header>
      {!s.context?.process_documents ? (
        <ConsentNotice />
      ) : (
        <>
          {error && (
            <div className="vn-error" role="alert">
              {error}
              <button onClick={workspace.refresh}>Try again</button>
            </div>
          )}
          {!needs && !error && (
            <p role="status">Checking rules and uploaded documents…</p>
          )}
          {needs && (
            <>
              <p>
                {needs.filter((n) => n.ownership_status === "OWNED").length}{" "}
                of {needs.length} covered on record
              </p>
              {!needs.length && (
                <p>
                  Coming soon · Specific coverage rules for this context are not loaded yet. An empty result does not guarantee comprehensive protection.
                </p>
              )}
              {(["REQUIRED", "RECOMMENDED"] as const).map((level) => (
                <section key={level}>
                  <h2>
                    {level === "REQUIRED"
                      ? "Mandatory / Visa Requirements"
                      : "Recommended Coverage"}
                  </h2>
                  <div className="vn-list">
                    {needs
                      .filter((n) => n.requirement_level === level)
                      .map((n) => (
                        <article key={n.need_code} className="vn-card">
                          <h3>{n.label}</h3>
                          <span className="vn-badge">
                            {statusLabel[n.ownership_status]}
                          </span>
                          <p>{n.explanation}</p>
                          {!n.requirement_confirmed && (
                            <small>
                              Requirement source needs confirmation; not formal legal advice.
                            </small>
                          )}
                          {n.source_reference?.source_url ? (
                            <a
                              href={n.source_reference.source_url}
                              rel="noreferrer"
                              target="_blank"
                            >
                              Rule source ·{" "}
                              {n.source_reference.checked_at ??
                                "date not recorded"}
                            </a>
                          ) : (
                            <small>
                              Source and verification date not confirmed.
                            </small>
                          )}
                          {n.visa_assessment && (
                            <div className="vn-warnings">
                              {typeof n.visa_assessment.gap_days ===
                              "number" ? (
                                <p>
                                  Potential gap of {n.visa_assessment.gap_days} calendar days (review visa schedule and policy dates).
                                </p>
                              ) : (
                                <p>
                                  Dates incomplete or unverified.
                                </p>
                              )}
                              <small>
                                {n.visa_assessment.assessment_status ===
                                "NEEDS_VERIFICATION"
                                  ? "Needs verification. "
                                  : ""}
                                Uses standard SC-04 interval continuity calculations.
                              </small>
                              <p>
                                <Link href="/completeness?task=visa_cover">
                                  Review gap in Data Completeness
                                </Link>
                              </p>
                            </div>
                          )}
                          {n.exclusion && (
                            <blockquote>
                              {n.exclusion.original_text} · p.{" "}
                              {n.exclusion.page_number}
                            </blockquote>
                          )}
                          <ul>
                            {n.verification_steps?.map((step) => (
                              <li key={step}>{step}</li>
                            ))}
                          </ul>
                          <Link href={n.action_url ?? "/documents"}>
                            {n.ownership_status === "OWNED"
                              ? "View policy"
                              : n.ownership_status === "NEEDS_CHECK"
                                ? "Verify now"
                                : "Review documents & guidance"}
                          </Link>
                        </article>
                      ))}
                  </div>
                </section>
              ))}
            </>
          )}
        </>
      )}
      <p className="vn-subtle">
        A status of &apos;Not covered on record&apos; means the item was not identified in uploaded files, not a determination of exclusion. INSURRA does not endorse or sell commercial products.
      </p>
    </div>
  );
}
