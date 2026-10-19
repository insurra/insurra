"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useState } from "react";
import {
  CheckCircle2,
  Download,
  ExternalLink,
  FileText,
  RefreshCw,
  ShieldAlert,
  ShieldCheck,
} from "lucide-react";

import { useAuth } from "@/lib/auth";
import { useSession } from "@/lib/session";
import { SessionRequired } from "@/components/session-required";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api/client";

type SandboxStatusPayload = {
  claim_ref: string;
  status: string;
  sandbox: boolean;
  action_id?: string | null;
  claim_case_id?: string | null;
  claim_case_status?: string | null;
  claim_case_status_label?: string | null;
  submitted_at?: string | null;
  provider_label?: string | null;
  status_timeline?: Array<Record<string, unknown>>;
  rejection_reason?: string | null;
};

type ClaimCaseSummary = {
  id: string;
  path: string;
  status: string;
  claim_ref?: string | null;
};

const CASE_STATUS_LABELS: Record<string, string> = {
  READY_FOR_SUBMISSION: "Siap Diajukan",
  SUBMITTED: "Diajukan",
  PROCESSING: "Diproses",
  APPROVED: "Disetujui",
  REJECTED: "Ditolak",
};

function ClaimsPageContent() {
  const searchParams = useSearchParams();
  const caseIdParam = searchParams.get("case_id");
  const claimRefParam = searchParams.get("claim_ref");

  const { data: sessionData, loading: sessionLoading } = useSession();
  const { account, token: authToken, loading: authLoading } = useAuth();
  const isAccountMode = Boolean(authToken && account);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [claimCase, setClaimCase] = useState<ClaimCaseSummary | null>(null);
  const [sandboxStatus, setSandboxStatus] = useState<SandboxStatusPayload | null>(null);

  const [revision, setRevision] = useState(0);
  const [advanceRequested, setAdvanceRequested] = useState(false);

  const handleTriggerReload = useCallback((advance = false) => {
    setLoading(true);
    setError(null);
    setAdvanceRequested(advance);
    setRevision((r) => r + 1);
  }, []);

  useEffect(() => {
    const storedToken =
      typeof window !== "undefined"
        ? window.sessionStorage.getItem("insurra.demo-session")
        : null;
    if (!storedToken && !isAccountMode) return;

    let cancelled = false;
    void (async () => {
      try {
        const headers: Record<string, string> | undefined = storedToken
          ? { "X-Demo-Session": storedToken }
          : undefined;

        let loadedCase: ClaimCaseSummary | null = null;
        if (caseIdParam) {
          try {
            const detail = await api.request("get", "/api/v1/claims/{claim_case_id}", {
              headers,
              params: { claim_case_id: caseIdParam },
            });
            loadedCase = detail.case;
            if (!cancelled) setClaimCase(detail.case);
          } catch {
            // Ignore if synthetic or not found
          }
        }

        const refToFetch = claimRefParam ?? loadedCase?.claim_ref;
        if (refToFetch) {
          const url = `/api/v1/sandbox/insurer/claims/${encodeURIComponent(refToFetch)}${
            advanceRequested ? "?advance=true" : ""
          }`;
          const res = await fetch(url, {
            method: "GET",
            headers,
            credentials: "include",
          });
          if (res.ok && !cancelled) {
            const payload = (await res.json()) as SandboxStatusPayload;
            setSandboxStatus(payload);
            if (payload.claim_case_status && loadedCase) {
              setClaimCase({
                ...loadedCase,
                status: payload.claim_case_status,
                claim_ref: payload.claim_ref,
              });
            }
          }
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Gagal memuat status kasus klaim.");
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
          setAdvanceRequested(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [caseIdParam, claimRefParam, isAccountMode, revision, advanceRequested]);

  const handleExportLogs = async (format: "json" | "csv") => {
    const storedToken =
      typeof window !== "undefined"
        ? window.sessionStorage.getItem("insurra.demo-session")
        : null;
    if (!storedToken && !isAccountMode) return;
    try {
      const headers: Record<string, string> = {};
      if (storedToken) headers["X-Demo-Session"] = storedToken;
      const res = await fetch(`/api/v1/sandbox/insurer/logs?format=${format}`, {
        method: "GET",
        headers,
        credentials: "include",
      });
      if (!res.ok) throw new Error(`Gagal mengekspor log sandbox (${res.status})`);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `insurra-sandbox-logs.${format}`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Gagal mengekspor log sandbox.");
    }
  };

  if (!sessionData && !isAccountMode) {
    if (sessionLoading || authLoading) return null;
    return <SessionRequired />;
  }

  const displayStatusLabel =
    sandboxStatus?.claim_case_status_label ??
    sandboxStatus?.status ??
    (claimCase?.status ? CASE_STATUS_LABELS[claimCase.status] ?? claimCase.status : "Diajukan");

  return (
    <div className="space-y-6 max-w-4xl mx-auto pb-16">
      <div className="page-heading flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="eyebrow flex items-center gap-2 text-xs font-semibold tracking-wider text-emerald-700 uppercase">
            <ShieldCheck size={14} />
            <span>Kesiapan &amp; Status Kasus Klaim (SC-09 / US-09-05 · US-10-04)</span>
            <span
              data-testid="claims-sandbox-badge"
              className="px-2 py-0.5 rounded bg-indigo-900 text-white text-[11px] font-extrabold uppercase tracking-wider"
            >
              SANDBOX
            </span>
          </div>
          <h1 className="text-2xl md:text-3xl font-bold text-slate-900 tracking-tight mt-1">
            Status Kasus Klaim (Sandbox – Bukan Penyedia Nyata)
          </h1>
          <p className="text-sm text-slate-600 mt-1">
            Pantau status pengajuan klaim pada penyedia simulasi (sandbox) serta unduh log operasi sandbox untuk bukti eksekusi.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => void handleExportLogs("json")}
            className="text-xs flex items-center gap-1.5 border-emerald-300 text-emerald-950"
          >
            <Download size={13} />
            Ekspor log sandbox (JSON)
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => void handleExportLogs("csv")}
            className="text-xs flex items-center gap-1.5 border-emerald-300 text-emerald-950"
          >
            <Download size={13} />
            Ekspor log sandbox (CSV)
          </Button>
          <Link
            href="/actions?tab=COMPLETED"
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg border border-slate-300 bg-white text-xs font-semibold text-slate-700 hover:bg-slate-50"
          >
            Kembali ke Antrean Tindakan (SC-10)
          </Link>
        </div>
      </div>

      {error && (
        <div className="p-4 rounded-xl bg-rose-50 border border-rose-200 text-rose-800 text-xs flex items-center gap-2">
          <ShieldAlert size={16} />
          <span>{error}</span>
        </div>
      )}

      <div className="p-6 rounded-2xl bg-white border-2 border-indigo-200 shadow-xs space-y-5">
        <div className="flex items-center justify-between flex-wrap gap-3 border-b border-slate-100 pb-4">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <span className="text-xs font-extrabold px-2.5 py-0.5 rounded bg-indigo-900 text-white tracking-wider uppercase">
                SANDBOX
              </span>
              <span className="text-xs font-bold text-slate-700">
                {sandboxStatus?.provider_label ??
                  "Allianz Care Australia (Sandbox – bukan penyedia nyata)"}
              </span>
            </div>
            <h2 className="text-lg font-bold text-slate-900">
              Referensi Klaim:{" "}
              <span className="font-mono text-indigo-950">
                {sandboxStatus?.claim_ref ?? claimCase?.claim_ref ?? claimRefParam ?? "Belum dikirim"}
              </span>
            </h2>
          </div>

          <div className="flex items-center gap-2">
            <span
              data-testid="claim-case-status-badge"
              className="px-3 py-1 rounded-full bg-emerald-100 text-emerald-900 text-xs font-extrabold uppercase"
            >
              Status: {displayStatusLabel}
            </span>
            {(sandboxStatus?.claim_ref || claimRefParam) && (
              <Button
                variant="outline"
                size="sm"
                disabled={loading}
                onClick={() => handleTriggerReload(true)}
                className="text-xs flex items-center gap-1.5 border-indigo-300 text-indigo-950"
              >
                <RefreshCw size={13} className={loading ? "animate-spin" : ""} />
                Simulasikan Status Berikutnya
              </Button>
            )}
          </div>
        </div>

        {Array.isArray(sandboxStatus?.status_timeline) && (
          <div className="space-y-2">
            <div className="text-xs font-bold text-slate-800 uppercase tracking-wider">
              Riwayat &amp; Simulasi Status Klaim Sandbox (≤ 1 menit)
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              {sandboxStatus.status_timeline.map((step, idx) => (
                <div
                  key={idx}
                  className="p-3.5 rounded-xl bg-slate-50 border border-slate-200 text-xs space-y-1"
                >
                  <div className="font-bold text-indigo-950 flex items-center gap-1.5">
                    <CheckCircle2 size={14} className="text-emerald-700" />
                    <span>
                      {idx + 1}. {String(step.status ?? "-")}
                    </span>
                  </div>
                  <p className="text-slate-600">{String(step.note ?? "")}</p>
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="pt-3 border-t border-slate-100 flex flex-wrap items-center justify-between gap-2 text-xs text-slate-600">
          <div className="flex items-center gap-1.5">
            <FileText size={14} className="text-slate-500" />
            <span>
              Seluruh pengiriman menggunakan referensi <code>document_id</code> dan{" "}
              <code>sha256</code> tanpa file mentah atau data pribadi sensitif.
            </span>
          </div>
          <Link
            href="/audit"
            className="inline-flex items-center gap-1 font-bold text-emerald-800 underline"
          >
            Lihat Log Audit (tool: submit_claim_sandbox) <ExternalLink size={12} />
          </Link>
        </div>
      </div>
    </div>
  );
}

export default function ClaimsPage() {
  return (
    <Suspense
      fallback={
        <div className="p-8 text-center text-slate-500 text-sm">
          Memuat status kasus klaim...
        </div>
      }
    >
      <ClaimsPageContent />
    </Suspense>
  );
}
