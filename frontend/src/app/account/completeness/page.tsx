"use client";

import Image from "next/image";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { ArrowRight, CalendarDays, CheckCircle2, CircleHelp, ClipboardCheck, FileText } from "lucide-react";
import { api } from "@/lib/api/client";
import type { components } from "@/lib/api/types.gen";
import { useAuth } from "@/lib/auth";
import { Button } from "@/components/ui/button";

type Setup = components["schemas"]["AccountSetup"];
type Result = components["schemas"]["AccountCompleteness"];

export default function AccountCompleteness() {
  const { account, token, loading } = useAuth();
  const [setup, setSetup] = useState<Setup | null>(null);
  const [task, setTask] = useState("");
  const [result, setResult] = useState<Result | null>(null);
  const [manual, setManual] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!token) return;
    let active = true;
    const headers = { Authorization: `Bearer ${token}` };
    api
      .request("get", "/api/v1/account/profile", { headers })
      .then((profile) => {
        if (!profile.profile) throw new Error("Complete your profile before running completeness checks.");
        return api.request("get", "/api/v1/account/setup/{country_code}", {
          params: { country_code: profile.profile.country_code },
          headers,
        });
      })
      .then((value) => {
        if (active) {
          setSetup(value);
          setTask(String(value.tasks[0]?.task_code ?? ""));
        }
      })
      .catch((cause: unknown) => {
        if (active) setError(cause instanceof Error ? cause.message : "Completeness check unavailable.");
      });
    return () => {
      active = false;
    };
  }, [token]);

  const refresh = useCallback(async () => {
    if (!token || !task) return;
    const value = await api.request("get", "/api/v1/account/completeness", {
      query: { task },
      headers: { Authorization: `Bearer ${token}` },
    });
    setResult(value);
  }, [token, task]);

  useEffect(() => {
    void Promise.resolve()
      .then(refresh)
      .catch((cause: unknown) => setError(cause instanceof Error ? cause.message : "Failed to load completeness."));
  }, [refresh]);

  async function save(fieldKey: string) {
    if (!token || !manual[fieldKey]) return;
    setBusy(true);
    setError(null);
    try {
      await api.request("post", "/api/v1/account/manual-fields", {
        headers: { Authorization: `Bearer ${token}` },
        body: { field_key: fieldKey, value: manual[fieldKey], confirm: true },
      });
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Manual field value could not be saved.");
    } finally {
      setBusy(false);
    }
  }

  if (loading) return <p role="status">Checking account session...</p>;
  if (!account || !token) {
    return (
      <div className="card account-empty">
        <h1>Sign in to check coverage completeness.</h1>
        <Button asChild>
          <Link href="/auth">Sign In or Register</Link>
        </Button>
      </div>
    );
  }

  return (
    <div className="account-completeness protection-screen completeness-screen">
      <div className="page-heading">
        <div>
          <div className="eyebrow">RINGKASAN PERLINDUNGAN</div>
          <h1>Data Completeness</h1>
          <p>Lihat data yang sudah tersedia, temukan yang masih perlu dilengkapi, dan tinjau rentang perlindungan.</p>
        </div>
        <Image
          src="/protection-mascot.png"
          alt="Maskot Insurra"
          width={82}
          height={82}
        />
      </div>

      {error && (
        <div className="alert error" role="alert">
          {error} {error.includes("profile") && <Link href="/onboarding">Complete Profile</Link>}
        </div>
      )}

      {setup && (
        <div className="card account-task-picker">
          <label>
            Konteks pemeriksaan:
            <select value={task} onChange={(event) => setTask(event.target.value)}>
              {setup.tasks.map((item) => (
                <option key={String(item.task_code)} value={String(item.task_code)}>
                  {String(item.label)}
                </option>
              ))}
            </select>
          </label>
          <span className="badge warning">
            KB {setup.verification_status === "VERIFIED" ? "VERIFIED" : "UNVERIFIED"}
          </span>
        </div>
      )}

      {result && (
        <>
          <section className="card account-readiness completeness-score-card">
            <div className="readiness-head">
              <div>
                <div className="eyebrow">READINESS SCORE</div>
                <h2>{result.task_label}</h2>
                <p>
                  Ready: {result.ready_count} of {result.total_count} required data fields ({result.ready_pct}%).
                </p>
              </div>
              <strong>{result.ready_pct}%</strong>
            </div>
            <div className="coverage-track">
              <span style={{ width: `${result.ready_pct}%` }} />
            </div>
            <small>
              Readiness score reflects evidence completeness only, not guaranteed claim approval or visa compliance.
            </small>
          </section>

          {result.visa_gap && (
            <div className={`card account-visa ${result.visa_gap.status === "GAP_FOUND" ? "has-gap" : ""}`}>
              <CalendarDays />
              <div>
                <h2>
                  {result.visa_gap.status === "GAP_FOUND"
                    ? `Potential coverage gap: ${result.visa_gap.gap_days ?? "?"} days`
                    : result.visa_gap.status === "PASS"
                    ? "Coverage dates encompass checked interval"
                    : "Date verification required"}
                </h2>
                <p>{result.visa_gap.explanation}</p>
                <small>
                  Rule status: {result.visa_gap.verification_status}. Computed calendar interval is guidance, not legal or visa counsel.
                </small>
                {result.visa_gap.source_url && (
                  <a href={result.visa_gap.source_url} target="_blank" rel="noreferrer">
                    Official guidance <ArrowRight size={13} />
                  </a>
                )}
              </div>
            </div>
          )}

          <div className="completeness-layout">
          <section className="card completeness-required-panel">
          <div className="section-heading">
            <h2>Required Fields Checklist</h2>
            <Button asChild variant="outline">
              <Link href="/documents">
                <FileText size={16} /> Upload Documents
              </Link>
            </Button>
          </div>

          <div className="account-checklist">
            {result.items.map((item) => (
              <article key={item.field_key} className="card account-check-row">
                <span className={`check-icon ${item.status.toLowerCase()}`}>
                  {item.status === "FOUND" ? (
                    <CheckCircle2 />
                  ) : item.status === "MISSING" ? (
                    <CircleHelp />
                  ) : (
                    <ClipboardCheck />
                  )}
                </span>
                <div>
                  <strong>{item.label}</strong>
                  <p>
                    Status: {item.status === "FOUND" ? "Found" : item.status === "UNVERIFIED" ? "Needs Verification" : item.status === "NOT_APPLICABLE" ? "Not Applicable" : "Missing"}
                    {item.source_page ? `, Page ${item.source_page}` : ""}
                  </p>
                  {item.value !== null && item.value !== undefined && (
                    <small>Value: {String(item.value)}</small>
                  )}
                  {item.suggested_doc && item.status === "MISSING" && (
                    <small>Suggested Document: {item.suggested_doc.replaceAll("_", " ")}</small>
                  )}
                  {item.status === "MISSING" && !["arrival_date", "visa_expiry_date"].includes(item.field_key) && (
                    <div className="manual-field">
                      <input
                        placeholder="Enter value from your document"
                        aria-label={`Enter ${item.label}`}
                        value={manual[item.field_key] ?? ""}
                        onChange={(event) =>
                          setManual((val) => ({ ...val, [item.field_key]: event.target.value }))
                        }
                      />
                      <Button
                        size="sm"
                        disabled={busy || !manual[item.field_key]}
                        onClick={() => void save(item.field_key)}
                      >
                        Confirm Value
                      </Button>
                    </div>
                  )}
                </div>
                <span
                  className={`badge ${
                    item.status === "FOUND" ? "success" : item.status === "MISSING" ? "neutral" : "warning"
                  }`}
                >
                  {item.status.replaceAll("_", " ")}
                </span>
              </article>
            ))}
          </div>
          </section>
          <aside className="completeness-side-column">
            <section className="card completeness-guidance">
              <div className="completeness-side-title"><ClipboardCheck size={20}/><h2>Yang perlu disiapkan</h2></div>
              <p>Dokumen dan informasi berikut ditentukan oleh konteks pemeriksaan yang dipilih.</p>
              {result.items.filter((item) => item.status === "MISSING").length ? (
                result.items.filter((item) => item.status === "MISSING").map((item) => (
                  <div className="completeness-missing" key={item.field_key}><FileText size={17}/><span><strong>{item.label}</strong><small>{item.suggested_doc ? item.suggested_doc.replaceAll("_", " ") : "Informasi belum tersedia"}</small></span><Link href="/documents">Unggah</Link></div>
                ))
              ) : <div className="completeness-all-set"><CheckCircle2 size={18}/> Tidak ada data wajib yang ditandai hilang.</div>}
            </section>
            <section className="card completeness-guidance">
              <div className="completeness-side-title"><CircleHelp size={20}/><h2>Catatan pemeriksaan</h2></div>
              <p>Skor menunjukkan kelengkapan bukti yang tersedia, bukan jaminan klaim atau kepatuhan visa.</p>
              <span className={`badge ${result.verification_status === "VERIFIED" ? "success" : "warning"}`}>Panduan negara: {result.verification_status}</span>
              <small>Versi basis pengetahuan: {result.kb_version}</small>
            </section>
          </aside>
          </div>
        </>
      )}
    </div>
  );
}
