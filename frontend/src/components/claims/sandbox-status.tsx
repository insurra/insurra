"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import type { components } from "@/lib/api/types.gen";
import { getWorkflowHeaders, getWorkflowUrl } from "@/lib/api/workflow-client";

type SandboxClaimResponse = components["schemas"]["SandboxClaimResponse"];

export function SandboxClaimStatus({ accountToken }: { accountToken: string | null }) {
  const claimRef = useSearchParams().get("claim_ref");
  const [status, setStatus] = useState<SandboxClaimResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadStatus = useCallback(
    async (advance: boolean) => {
      if (!claimRef) return;
      setLoading(true);
      setError(null);
      try {
        const suffix = advance ? "?advance=true" : "";
        const response = await fetch(
          getWorkflowUrl(`/api/v1/sandbox/insurer/claims/${encodeURIComponent(claimRef)}${suffix}`),
          { headers: getWorkflowHeaders(accountToken) },
        );
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        setStatus((await response.json()) as SandboxClaimResponse);
      } catch {
        setError("Status klaim sandbox belum dapat dimuat. Coba lagi.");
      } finally {
        setLoading(false);
      }
    },
    [accountToken, claimRef],
  );

  useEffect(() => {
    void Promise.resolve().then(() => loadStatus(false));
  }, [loadStatus]);

  async function exportLogs(format: "json" | "csv") {
    setError(null);
    try {
      const response = await fetch(
        getWorkflowUrl(`/api/v1/sandbox/insurer/logs?format=${format}`),
        { headers: getWorkflowHeaders(accountToken) },
      );
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `insurra-sandbox-logs.${format}`;
      link.click();
      URL.revokeObjectURL(url);
    } catch {
      setError("Log sandbox belum dapat diunduh. Coba lagi.");
    }
  }

  if (!claimRef) return null;

  return (
    <section className="mb-6 rounded-2xl border-2 border-indigo-200 bg-white p-6 shadow-sm" aria-label="Status klaim sandbox">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <span data-testid="claims-sandbox-badge" className="rounded bg-indigo-900 px-2 py-1 text-xs font-bold text-white">SANDBOX</span>
          <h2 className="mt-3 text-xl font-bold text-slate-900">Status Kasus Klaim (Sandbox – Bukan Penyedia Nyata)</h2>
          <p className="mt-1 text-sm text-slate-600">Referensi: <code>{status?.claim_ref ?? claimRef}</code></p>
          {status?.provider_label && <p className="text-sm text-slate-600">{status.provider_label}</p>}
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" disabled={loading} onClick={() => void loadStatus(true)} className="rounded-lg border border-indigo-300 px-3 py-2 text-sm font-semibold text-indigo-950 disabled:opacity-50">
            {loading ? "Memuat..." : "Simulasikan Status Berikutnya"}
          </button>
          <button type="button" onClick={() => void exportLogs("json")} className="rounded-lg border border-slate-300 px-3 py-2 text-sm">Ekspor log JSON</button>
          <button type="button" onClick={() => void exportLogs("csv")} className="rounded-lg border border-slate-300 px-3 py-2 text-sm">Ekspor log CSV</button>
        </div>
      </div>
      {error && <p role="alert" className="mt-4 text-sm text-rose-700">{error}</p>}
      {status && (
        <div className="mt-5">
          <strong data-testid="claim-case-status-badge" className="rounded-full bg-emerald-100 px-3 py-1 text-sm text-emerald-900">
            Status: {status.claim_case_status_label ?? status.status}
          </strong>
          {status.status_timeline && status.status_timeline.length > 0 && (
            <ol className="mt-4 grid gap-3 sm:grid-cols-3">
              {status.status_timeline.map((step, index) => (
                <li key={index} className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm">
                  <strong>{String(step.status ?? "-")}</strong>
                  <p>{String(step.note ?? "")}</p>
                </li>
              ))}
            </ol>
          )}
        </div>
      )}
      <Link href="/audit" className="mt-4 inline-block text-sm font-semibold text-emerald-800 underline">Lihat log audit</Link>
    </section>
  );
}
