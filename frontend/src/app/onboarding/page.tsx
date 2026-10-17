"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowRight,
  Check,
  FileCheck2,
  LockKeyhole,
  ShieldCheck,
} from "lucide-react";
import { useAuth } from "@/lib/auth";
import { useSession } from "@/lib/session";
import { Button } from "@/components/ui/button";
import { SessionRequired } from "@/components/session-required";
import AccountOnboarding from "@/app/account/onboarding/page";

export default function OnboardingPage() {
  const { account, token } = useAuth();
  const { data, loading, setConsent } = useSession();
  const [checked, setChecked] = useState(false);
  const router = useRouter();

  // If authenticated account session, show full 6-step context wizard
  if (token && account) {
    return <AccountOnboarding />;
  }

  // Fallback for demo session persona
  if (!data) return loading ? null : <SessionRequired />;

  async function grant() {
    if (await setConsent(true)) router.push("/dashboard");
  }

  return (
    <div className="narrow-page">
      <div className="eyebrow">
        STEP 01 <span className="muted">/ 02</span>
      </div>
      <h1>Control stays in your hands.</h1>
      <p className="lead">
        Hello, {data.profile.display_name}. Before continuing, review how your demo session data is handled.
      </p>
      <div className="card consent-card">
        <div className="consent-heading">
          <div className="empty-icon">
            <LockKeyhole />
          </div>
          <span
            className={`badge ${data.consent.processing_consent ? "success" : "neutral"}`}
          >
            {data.consent.processing_consent
              ? "CONSENT ACTIVE"
              : "NOT GRANTED"}
          </span>
        </div>
        <h2>Processing Consent</h2>
        <p>
          This control approves local document processing only. Transmission to external AI services and retention of original files require separate explicit grants. Synthetic data remains inspectable without consent.
        </p>
        <div className="consent-point">
          <FileCheck2 size={21} />
          <div>
            <strong>Clear Purpose Boundaries</strong>
            <p>
              Reads documents to assist in understanding coverage. In this phase, no documents are processed or dispatched without explicit grants.
            </p>
          </div>
        </div>
        <div className="consent-point">
          <ShieldCheck size={21} />
          <div>
            <strong>No Action Without Prior Approval</strong>
            <p>
              Creating draft proposals does not trigger execution. No insurance claims are submitted in this demo.
            </p>
          </div>
        </div>
        <div className="consent-point">
          <Check size={21} />
          <div>
            <strong>Revocable at Any Time</strong>
            <p>
              Changes are saved to the backend database and logged in the session audit trail.
            </p>
          </div>
        </div>
        {data.consent.processing_consent ? (
          <div className="consent-actions">
            <Button asChild>
              <Link href="/dashboard">
                View Summary <ArrowRight size={16} />
              </Link>
            </Button>
            <Button
              variant="outline"
              disabled={loading}
              onClick={() => void setConsent(false)}
            >
              Revoke Consent
            </Button>
          </div>
        ) : (
          <>
            <label className="checkbox-label">
              <input
                type="checkbox"
                checked={checked}
                onChange={(e) => setChecked(e.target.checked)}
              />
              <span>
                I understand this consent covers document processing only and does not submit claims or dispatch external actions.
              </span>
            </label>
            <div className="consent-actions">
              <Button disabled={!checked || loading} onClick={() => void grant()}>
                Agree and Continue <ArrowRight size={16} />
              </Button>
              <Button asChild variant="ghost">
                <Link href="/dashboard">Explore Without Processing</Link>
              </Button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
