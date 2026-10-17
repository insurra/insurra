"use client";

import "./dashboard.css";
import Image from "next/image";
import Link from "next/link";
import {
  ArrowRight,
  ArrowUpRight,
  FileText,
  Info,
  Shield,
  MapPin,
  Calendar,
  CheckCircle2,
  AlertCircle,
  UploadCloud,
} from "lucide-react";
import { useSession } from "@/lib/session";
import { formatDate } from "@/lib/presentation";
import { SessionRequired } from "@/components/session-required";
import { CoverageRunway } from "@/components/coverage-runway";

const occupationLabel: Record<string, string> = {
  STUDENT: "Student",
  EMPLOYEE: "Employee",
};

const benefitStatus: Record<string, string> = {
  UNKNOWN: "Not confirmed",
  COVERED: "Covered",
  NOT_COVERED: "Not covered",
};

export default function Dashboard() {
  const { data, loading } = useSession();
  if (!data) return loading ? null : <SessionRequired />;
  const { profile, record, assessment, consent } = data;

  const firstName = profile.display_name.split(" ")[0];
  const runwayPolicy =
    record.policies.find((p) => p.coverage_end_date) ?? record.policies[0] ?? null;
  const hasGap = assessment.gap_days !== null && assessment.gap_days !== undefined;
  const notApplicable = assessment.assessment_status === "NOT_APPLICABLE";
  const needsVerification = assessment.assessment_status === "NEEDS_VERIFICATION";

  return (
    <div className="dx">
      <header className="dx-head">
        <div>
          <div className="dx-badge-row">
            <span className="dx-kicker">Coverage Workspace</span>
            <span className="dx-pill-verified">
              <Shield size={12} aria-hidden="true" /> Synthetic Active Profile
            </span>
          </div>
          <h1>Welcome back, {firstName}.</h1>
          <div className="profile-context">
            <span>
              <MapPin size={13} aria-hidden="true" />
              {profile.city ?? "City not set"}, {profile.country_code}
            </span>
            <span>•</span>
            <span>
              {occupationLabel[profile.occupation] ?? "Other"}
              {" ("}
              {profile.residence_context === "ABROAD" ? "living abroad" : "living at home"}
              {")"}
            </span>
          </div>
        </div>

        <div className="dx-head-actions">
          <Link href="/documents" className="dx-btn-primary">
            <UploadCloud size={16} aria-hidden="true" /> Manage documents
          </Link>
          <Link href="/settings/privacy" className="dx-link">
            Privacy controls
          </Link>
        </div>
      </header>

      {!consent.processing_consent && (
        <div className="dx-notice" role="note">
          <Info size={17} aria-hidden="true" />
          <span>
            Document processing is currently paused. You can still explore the demo records.
          </span>
          <Link href="/onboarding">
            Review permissions <ArrowRight size={14} aria-hidden="true" />
          </Link>
        </div>
      )}

      {/* Hero Runway Assessment Card */}
      <section className="dx-runway assessment-card" aria-labelledby="dx-runway-title">
        <div className="dx-runway-text">
          <div className="dx-runway-kicker-row">
            <span className="dx-kicker">Coverage &amp; Visa Timeline</span>
            <span className="dx-pulse-dot" aria-hidden="true" />
          </div>

          <h2 id="dx-runway-title">
            {notApplicable
              ? "No visa interval check needed for this profile"
              : hasGap
                ? "Your coverage may end before your visa does"
                : "Dates require verification against policy"}
          </h2>

          {!notApplicable && hasGap && (
            <div className="gap-value">
              <strong>{assessment.gap_days}</strong>
              <span>days potentially uncovered</span>
              <span className="sr-only">hari potensi jeda</span>
            </div>
          )}

          {!notApplicable &&
            assessment.gap_periods.map((gap) => (
              <p className="dx-gap-period" key={gap.start_date}>
                <Calendar size={13} aria-hidden="true" />
                <span>
                  {formatDate(gap.start_date)} to {formatDate(gap.end_date)}
                </span>
              </p>
            ))}

          <p className="dx-explain">{assessment.explanation}</p>

          <div className="dx-runway-foot">
            {!notApplicable && (
              <span className="dx-flag">
                {needsVerification ? "PERLU VERIFIKASI" : "Needs verification"}
              </span>
            )}
            {assessment.rule_source && (
              <span className="dx-source">
                Rules: {assessment.rule_source.country_code} (v{assessment.rule_source.kb_version})
                {" · "}
                {assessment.rule_source.verification_status === "UNVERIFIED"
                  ? "Unverified KB"
                  : "Verified KB"}
              </span>
            )}
          </div>
        </div>

        <div className="dx-runway-viz">
          {notApplicable ? (
            <p className="dx-na">Visa interval checks do not apply to this profile.</p>
          ) : (
            <CoverageRunway
              start={runwayPolicy?.coverage_start_date}
              coverageEnd={runwayPolicy?.coverage_end_date}
              visaEnd={profile.visa_expiry_date}
              gapDays={assessment.gap_days}
            />
          )}
        </div>

        <Image
          src="/mascot-laptop.png"
          alt=""
          width={150}
          height={100}
          className="dx-runway-mascot"
          priority
        />
      </section>

      {/* At A Glance Metrics */}
      <dl className="dx-figures">
        <div className="dx-stat-card">
          <div className="dx-stat-icon-wrap">
            <FileText size={20} />
          </div>
          <dd>{record.policies.length}</dd>
          <dt>Policies on record</dt>
        </div>

        <div className="dx-stat-card">
          <div className="dx-stat-icon-wrap">
            <UploadCloud size={20} />
          </div>
          <dd>{record.documents.length}</dd>
          <dt>Attached documents</dt>
        </div>

        <div className="dx-stat-card">
          <div className="dx-stat-icon-wrap alert">
            <AlertCircle size={20} />
          </div>
          <dd className="dx-figure-text">Verification</dd>
          <dt>Confirm policy terms</dt>
        </div>
      </dl>

      {/* Two-Column Details */}
      <div className="dx-columns">
        <section aria-labelledby="dx-policies-title">
          <div className="dx-section-head">
            <h2 id="dx-policies-title">Protection on record</h2>
            <span>Updated {formatDate(record.updated_at)}</span>
          </div>

          <div className="dx-policies">
            {record.policies.map((policy) => (
              <article key={policy.id} className="dx-policy policy-card">
                <div className="dx-policy-top">
                  <div>
                    <div className="dx-policy-type-row">
                      <span className="dx-policy-type-badge">{policy.policy_type}</span>
                      <span className="dx-country-tag">
                        Record country: {record.country_code}
                        <span className="sr-only">Negara catatan: {record.country_code}</span>
                      </span>
                    </div>
                    <h3>{policy.provider_name ?? "Provider not specified"}</h3>
                  </div>
                  <span className="dx-flag dx-flag-amber">Unverified</span>
                </div>

                <p className="dx-policy-name">{policy.policy_name ?? "Policy name not available"}</p>

                <div className="dx-dates">
                  <div className="dx-date-box">
                    <span>Starts</span>
                    <strong>{formatDate(policy.coverage_start_date)}</strong>
                  </div>
                  <div className="dx-date-arrow" aria-hidden="true">→</div>
                  <div className="dx-date-box">
                    <span>Ends</span>
                    <strong>{formatDate(policy.coverage_end_date)}</strong>
                  </div>
                </div>

                <div className="dx-benefits-wrapper">
                  <div className="dx-benefits-label">Included coverage items:</div>
                  <ul className="dx-benefits">
                    {policy.coverage_items.map((item) => (
                      <li key={item.coverage_code}>
                        <span>{item.benefit_name}</span>
                        <em data-status={item.coverage_status}>
                          {item.coverage_status === "COVERED" && (
                            <CheckCircle2 size={12} className="inline mr-1" />
                          )}
                          {benefitStatus[item.coverage_status] ?? item.coverage_status}
                        </em>
                      </li>
                    ))}
                  </ul>
                </div>

                <div className="dx-policy-foot">
                  <span>Synthetic record, not a formal policy quote</span>
                  <Link href="/documents" className="dx-source-link">
                    View source <ArrowUpRight size={14} aria-hidden="true" />
                  </Link>
                </div>
              </article>
            ))}
          </div>
        </section>

        {/* Sidebar */}
        <aside className="dx-aside">
          <section className="dx-next">
            <div className="dx-mascot-circle">
              <Image src="/mascot-document.png" alt="" width={80} height={80} />
            </div>
            <p className="dx-kicker">Recommended next step</p>
            <h3>Verify your policy schedule.</h3>
            <p>
              Check what is confirmed on record and upload the latest policy certificate if your
              visa dates changed.
            </p>
            <Link href="/documents" className="dx-link dx-link-cta">
              Open documents <ArrowRight size={15} aria-hidden="true" />
            </Link>
          </section>

          <div className="dx-footnote">
            <Info size={16} aria-hidden="true" />
            <p>
              Information not found in uploaded files is not the same as excluded. Always confirm
              benefits and waiting periods with your provider or insurer directly.
            </p>
          </div>
        </aside>
      </div>
    </div>
  );
}
