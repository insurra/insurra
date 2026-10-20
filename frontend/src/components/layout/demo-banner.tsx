"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { useSession } from "@/lib/session";
import { endDemoSession, resetDemoSession, useActor } from "@/lib/actor";
import "./shell-extras.css";

export function DemoBanner() {
  const router = useRouter();
  const { clearSession } = useSession();
  const { headers, mode } = useActor();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (mode !== "demo" || !headers) return null;

  async function reset() {
    if (!headers) return;
    setBusy(true);
    setError(null);
    try {
      await resetDemoSession(headers);
    } catch {
      setError("The demo could not be reset. Try again.");
      setBusy(false);
    }
  }

  async function exit() {
    if (!headers) return;
    setBusy(true);
    setError(null);
    try {
      await endDemoSession(headers);
    } catch {
      // The session may already have expired. Leaving locally is still correct.
    }
    clearSession();
    router.push("/");
  }

  return (
    <div className="demo-banner" role="region" aria-label="Demo mode" data-testid="demo-banner">
      <p>
        <strong>Demo</strong> Interactive demo mode. No data is connected to a real account or official insurance records.
      </p>
      <div className="demo-banner-actions">
        <button type="button" onClick={() => void reset()} disabled={busy}>
          Reset demo
        </button>
        <button type="button" onClick={() => void exit()} disabled={busy}>
          Exit demo
        </button>
      </div>
      <span role="status" aria-live="polite" className="demo-banner-error">
        {error}
      </span>
    </div>
  );
}
