"use client";

import Link from "next/link";
import { AlertTriangle, ArrowRight, Calendar, CheckSquare, FileText, Search } from "lucide-react";
import "./coverage-snapshot-card.css";

interface CoverageSnapshotCardProps {
  /** Optional policy end date (YYYY-MM-DD or ISO string) */
  coverageEndDate?: string | null;
  /** Optional visa expiry date (YYYY-MM-DD or ISO string) */
  visaEndDate?: string | null;
  /** Optional days uncovered */
  gapDays?: number | null;
  /** Explicit illustrative example badge toggle */
  isSample?: boolean;
  className?: string;
}

function formatDate(dateStr?: string | null): string | null {
  if (!dateStr) return null;
  const parsed = Date.parse(dateStr.length === 10 ? `${dateStr}T00:00:00Z` : dateStr);
  if (Number.isNaN(parsed)) return null;
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  }).format(parsed);
}

export function CoverageSnapshotCard({
  coverageEndDate,
  visaEndDate,
  gapDays,
  isSample = false,
  className = "",
}: CoverageSnapshotCardProps) {
  const formattedCoverage = formatDate(coverageEndDate) || "30 Jun 2027";
  const formattedVisa = formatDate(visaEndDate) || "31 Jul 2027";

  let computedGap = gapDays;
  if (computedGap === undefined || computedGap === null) {
    if (coverageEndDate && visaEndDate) {
      const c = Date.parse(coverageEndDate.length === 10 ? `${coverageEndDate}T00:00:00Z` : coverageEndDate);
      const v = Date.parse(visaEndDate.length === 10 ? `${visaEndDate}T00:00:00Z` : visaEndDate);
      if (!Number.isNaN(c) && !Number.isNaN(v) && v > c) {
        computedGap = Math.round((v - c) / (1000 * 60 * 60 * 24));
      }
    }
  }

  const finalGap = computedGap ?? 31;
  const hasLiveDates = Boolean(coverageEndDate && visaEndDate);
  const badgeLabel = !hasLiveDates || isSample ? "ILLUSTRATIVE EXAMPLE" : "ACTIVE RUNWAY";

  return (
    <section
      className={`coverage-snapshot-card ${className}`.trim()}
      data-testid="coverage-snapshot-card"
      aria-label="Coverage snapshot summary"
    >
      <div className="css-snaphead">
        <h2 className="css-title">Your Coverage Snapshot</h2>
        <span className={`css-sample-badge ${!isSample && hasLiveDates ? "live" : ""}`}>
          {badgeLabel}
        </span>
      </div>

      <div className="css-metricrow">
        <div className="css-metric">
          <div className="css-metricicon" aria-hidden="true">
            <FileText size={20} />
          </div>
          <div>
            <div className="css-metriclabel">Insurance cover ends</div>
            <div className="css-metricval">{formattedCoverage}</div>
          </div>
        </div>

        <div className="css-metric">
          <div className="css-metricicon" aria-hidden="true">
            <Calendar size={20} />
          </div>
          <div>
            <div className="css-metriclabel">Visa ends</div>
            <div className="css-metricval">{formattedVisa}</div>
          </div>
        </div>
      </div>

      <div className="css-timeline-track" role="img" aria-label={`Coverage timeline with ${finalGap} days uncovered`}>
        <div className="css-bar-green" style={{ width: "62%" }} />
        <div className="css-bar-orange" style={{ width: "22%" }} />
      </div>

      <div className="css-timelabel">
        <span className="css-timelabel-dot" aria-hidden="true">●</span>
        <span>{finalGap} days potentially uncovered</span>
      </div>

      <Link href="/coverage-needs" className="css-insight-card" title="Review timing gaps in coverage needs">
        <div className="css-insight-warn" aria-hidden="true">
          <AlertTriangle size={20} />
        </div>
        <div className="css-insight-content">
          <strong>Your insurance could end before your visa.</strong>
          <small>Insurra helps you spot timing gaps early and understand what to do next.</small>
        </div>
        <div className="css-insight-arrow" aria-hidden="true">
          <ArrowRight size={18} />
        </div>
      </Link>

      <div className="css-foot-actions">
        <Link href="/coverage-needs" className="css-action-pill">
          <FileText size={16} className="css-action-icon" aria-hidden="true" />
          <span>Understand coverage</span>
        </Link>
        <Link href="/coverage-needs" className="css-action-pill">
          <Search size={16} className="css-action-icon" aria-hidden="true" />
          <span>Verify gaps</span>
        </Link>
        <Link href="/actions" className="css-action-pill">
          <CheckSquare size={16} className="css-action-icon" aria-hidden="true" />
          <span>Take action</span>
        </Link>
      </div>
    </section>
  );
}
