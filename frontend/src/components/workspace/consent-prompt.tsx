"use client";

import Link from "next/link";
import { useState } from "react";
import { ShieldAlert, CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { getWorkflowHeaders, getWorkflowUrl } from "@/lib/api/workflow-client";

interface ConsentPromptProps {
  purposes: string[];
  accountToken?: string | null;
  onGranted: () => void;
  onCancel: () => void;
}

const PURPOSE_LABELS: Record<string, string> = {
  process_documents: "Document Processing (extracting and validating claim & policy fields)",
  external_ai: "External AI Assistance (grounded Q&A and drafting)",
  retention: "Document Page Retention (saving extracted pages for citations)",
};

export function ConsentPrompt({
  purposes,
  accountToken,
  onGranted,
  onCancel,
}: ConsentPromptProps) {
  const [granting, setGranting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleExplicitGrant = async () => {
    setGranting(true);
    setError(null);
    try {
      const headers = getWorkflowHeaders(accountToken);
      headers["Content-Type"] = "application/json";
      const endpoint = accountToken ? "/api/v1/account/consents" : "/api/v1/consents";
      for (const purpose of purposes) {
        const res = await fetch(getWorkflowUrl(endpoint), {
          method: "POST",
          headers,
          body: JSON.stringify({ purpose, granted: true }),
        });
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          throw new Error(err.message || `Failed to grant ${purpose} consent.`);
        }
      }
      onGranted();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not update consent.");
    } finally {
      setGranting(false);
    }
  };

  return (
    <div
      className="p-4 mb-6 rounded-2xl border border-amber-300 bg-amber-50 text-amber-950 shadow-sm"
      role="region"
      aria-label="Explicit Consent Required"
      data-testid="consent-required-prompt"
    >
      <div className="flex items-start gap-3">
        <ShieldAlert className="text-amber-700 shrink-0 mt-0.5" size={22} />
        <div className="flex-1">
          <h3 className="font-bold text-sm text-amber-950 mb-1">
            Explicit Purpose Consent Required
          </h3>
          <p className="text-xs text-amber-900 mb-3">
            INSURRA never silently grants privacy permissions. To continue with this step, please
            explicitly grant the required purpose permission below or manage your preferences in
            Privacy Settings:
          </p>
          <ul className="list-disc pl-5 text-xs font-semibold text-amber-950 space-y-1 mb-4">
            {purposes.map((p) => (
              <li key={p}>{PURPOSE_LABELS[p] || p}</li>
            ))}
          </ul>
          {error && (
            <p className="text-xs font-semibold text-rose-700 mb-3">{error}</p>
          )}
          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              size="sm"
              disabled={granting}
              onClick={handleExplicitGrant}
              data-testid="grant-consent-btn"
              className="bg-teal-700 hover:bg-teal-800 text-white font-semibold flex items-center gap-1.5"
            >
              <CheckCircle2 size={14} />
              {granting ? "Recording Consent..." : "Grant Required Consent"}
            </Button>
            <Button asChild variant="outline" size="sm">
              <Link href="/settings/privacy">Open Privacy Settings</Link>
            </Button>
            <Button type="button" variant="ghost" size="sm" onClick={onCancel}>
              Cancel
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
