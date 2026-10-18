"use client";

import "../dashboard/dashboard.css";
import Image from "next/image";
import Link from "next/link";
import { useEffect, useState } from "react";
import { ArrowRight, Info } from "lucide-react";
import { api } from "@/lib/api/client";
import type { components } from "@/lib/api/types.gen";
import { useAuth } from "@/lib/auth";
import { CoverageRunway } from "@/components/coverage-runway";

type ProfileState = components["schemas"]["AccountProfileState"];
type Inventory = components["schemas"]["AccountInventory"];
type Policy = components["schemas"]["AccountPolicySummary"];

export default function AccountDashboard() {
  const { account, token, loading } = useAuth();
  const [profile, setProfile] = useState<ProfileState | null>(null);
  const [inventory, setInventory] = useState<Inventory | null>(null);
  const [policies, setPolicies] = useState<Policy[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!token) return;
    let active = true;
    const headers = { Authorization: `Bearer ${token}` };
    Promise.all([
      api.request("get", "/api/v1/account/profile", { headers }),
      api.request("get", "/api/v1/account/inventory", { headers }),
      api.request("get", "/api/v1/account/policies", { headers }),
    ])
      .then(([nextProfile, nextInventory, nextPolicies]) => {
        if (!active) return;
        setProfile(nextProfile);
        setInventory(nextInventory);
        setPolicies(nextPolicies);
      })
      .catch((cause: unknown) => {
        if (active) setError(cause instanceof Error ? cause.message : "Your summary could not be loaded.");
      });
    return () => {
      active = false;
    };
  }, [token]);

  if (loading) return <p role="status">Checking your session...</p>;
  if (!account || !token) {
    return (
      <div className="dx-empty">
        <Image src="/mascot-shield.png" alt="" width={120} height={110} />
        <h1>Sign in to open your workspace.</h1>
        <p>Your documents and coverage records stay private to your account.</p>
        <Link href="/auth" className="dx-link">
          Log in or register <ArrowRight size={16} aria-hidden="true" />
        </Link>
      </div>
    );
  }

  const name = (profile?.profile?.display_name ?? account.display_name ?? "there").split(" ")[0];
  const visaEnd = profile?.profile?.visa_expiry_date;
  const runwayPolicy = policies.find((p) => p.end_date) ?? null;
  const onboardingDone = Boolean(profile?.completed);
  const showRunway = Boolean(profile?.profile && profile.profile.residence_context === "ABROAD");

  return (
    <div className="dx">
      <header className="dx-head">
        <div>
          <p className="dx-kicker">Your private workspace</p>
          <h1>Welcome back, {name}.</h1>
          <p className="profile-context">
            {profile?.profile
              ? `${profile.profile.city ?? "City not set"} · ${profile.profile.country_code}`
              : "Finish your profile to unlock coverage checks"}
          </p>
        </div>
        <Link href={onboardingDone ? "/documents" : "/onboarding"} className="dx-link">
          {onboardingDone ? "Open documents" : "Finish your profile"}
          <ArrowRight size={16} aria-hidden="true" />
        </Link>
      </header>

      {error && (
        <div className="dx-notice" role="alert">
          <Info size={17} aria-hidden="true" />
          <span>{error}</span>
        </div>
      )}

      {profile && !onboardingDone && (
        <div className="dx-notice" role="note">
          <Info size={17} aria-hidden="true" />
          <span>Your profile is not finished yet. Six short steps unlock document checks.</span>
          <Link href="/onboarding">
            Continue <ArrowRight size={14} aria-hidden="true" />
          </Link>
        </div>
      )}

      {showRunway ? (
        <section className="dx-runway" aria-labelledby="dx-account-runway">
          <div className="dx-runway-text">
            <p className="dx-kicker">Coverage and visa timing</p>
            <h2 id="dx-account-runway">
              {runwayPolicy && visaEnd
                ? "Where your cover sits against your visa"
                : "Add two dates to see your timeline"}
            </h2>
            <p className="dx-explain">
              {runwayPolicy && visaEnd
                ? "Dates come from your confirmed documents and profile. Run the completeness check for the exact day count and what to verify."
                : "We need a coverage end date from an uploaded policy and your visa end date. Nothing is guessed."}
            </p>
            <div className="dx-runway-foot">
              <Link href={runwayPolicy && visaEnd ? "/completeness" : "/documents"} className="dx-link">
                {runwayPolicy && visaEnd ? "Check for a gap" : "Upload a policy"}
                <ArrowRight size={15} aria-hidden="true" />
              </Link>
            </div>
          </div>
          <div className="dx-runway-viz">
            <CoverageRunway
              start={runwayPolicy?.start_date}
              coverageEnd={runwayPolicy?.end_date}
              visaEnd={visaEnd}
            />
          </div>
          <Image src="/mascot-jumping.png" alt="" width={140} height={124} className="dx-runway-mascot" />
        </section>
      ) : (
        <section className="dx-runway dx-runway-single" aria-labelledby="dx-account-start">
          <div className="dx-runway-text">
            <p className="dx-kicker">Start here</p>
            <h2 id="dx-account-start">Bring in the documents you already have.</h2>
            <p className="dx-explain">
              INSURRA reads your policies, shows where each detail came from, and flags anything that
              needs your review. Nothing is sent anywhere without your permission.
            </p>
            <div className="dx-runway-foot">
              <Link href="/documents" className="dx-link">
                Open documents <ArrowRight size={15} aria-hidden="true" />
              </Link>
            </div>
          </div>
          <div className="dx-runway-viz dx-runway-art">
            <Image src="/mascot-document.png" alt="" width={280} height={187} />
          </div>
        </section>
      )}

      <ul className="dx-steps" aria-label="Workspace areas">
        <li>
          <Link href="/documents">
            <strong>{inventory?.document_count ?? 0}</strong>
            <span>Documents</span>
            <small>Upload and review the evidence</small>
          </Link>
        </li>
        <li>
          <Link href="/completeness">
            <strong>{inventory?.structured_field_count ?? 0}</strong>
            <span>Structured details</span>
            <small>See what is ready and what is missing</small>
          </Link>
        </li>
        <li>
          <Link href="/policies">
            <strong>{inventory?.coverage_count ?? 0}</strong>
            <span>Policy Wallet</span>
            <small>Coverage dates, benefits and limits</small>
          </Link>
        </li>
        <li>
          <Link href="/settings/privacy">
            <strong>3</strong>
            <span>Permissions</span>
            <small>Review consent or delete your data</small>
          </Link>
        </li>
      </ul>

      <p className="dx-footnote">
        <Info size={15} aria-hidden="true" />
        INSURRA never submits claims or takes external actions for you without your explicit approval.
      </p>
    </div>
  );
}
