"use client";

import { useEffect, useRef, useState } from "react";
import { api } from "@/lib/api/client";
import type { components } from "@/lib/api/types.gen";
import { useWorkspace } from "@/lib/workspace";
import { PathwayConfirmation } from "@/components/valen/pathway-confirmation";
import {
  ConsentNotice,
  EmergencyNotice,
  WorkspaceState,
} from "@/components/valen/workspace";

type Comparison = components["schemas"]["PathwayComparison"];
type Request = components["schemas"]["PathwayComparisonRequest"];

export default function PathwaysPage() {
  const workspace = useWorkspace();
  const [complaint, setComplaint] = useState("");
  const [service, setService] = useState("");
  const [city, setCity] = useState<string | null>(null);
  const [timeframe, setTimeframe] = useState<Request["timeframe"]>("unknown");
  const [result, setResult] = useState<Comparison | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [emergency, setEmergency] = useState(false);
  const [copied, setCopied] = useState(false);
  const [selected, setSelected] = useState<
    components["schemas"]["PathwayOption"] | null
  >(null);
  const [created, setCreated] = useState<string | null>(null);
  const pending = useRef<AbortController | null>(null);
  const country = workspace.summary?.context?.country_code;
  useEffect(() => {
    // An identity/country refresh clears prior decisions and aborts stale responses.
    pending.current?.abort();
    queueMicrotask(() => {
      setResult(null);
      setError(null);
      setEmergency(false);
      setBusy(false);
      setComplaint("");
      setCity(null);
      setService("");
      setSelected(null);
      setCreated(null);
    });
    return () => pending.current?.abort();
  }, [country, workspace.identityKey]);
  useEffect(() => {
    pending.current?.abort();
    queueMicrotask(() => {
      setResult(null);
      setSelected(null);
      setBusy(false);
    });
  }, [workspace.summary]);
  if (!workspace.summary) return <WorkspaceState workspace={workspace} />;
  const summary = workspace.summary;
  const enabled = Boolean(
    summary.context?.process_documents && summary.triage_available,
  );
  async function compare(event: React.FormEvent) {
    event.preventDefault();
    if (!workspace.headers || busy || !enabled || !complaint.trim() || !service)
      return;
    const controller = new AbortController();
    pending.current = controller;
    setBusy(true);
    setResult(null);
    setError(null);
    setEmergency(false);
    setCopied(false);
    try {
      const value = await api.request("post", "/api/v1/pathways/compare", {
        headers: workspace.headers,
        signal: controller.signal,
        body: {
          complaint,
          service_type: service,
          city: city ?? summary.context?.city,
          timeframe,
        },
      });
      if (controller.signal.aborted) return;
      if ("redirect" in value) {
        setEmergency(true);
        setComplaint("");
      } else if (value.context_country_code !== country)
        setError("Konteks berubah. Bandingkan ulang.");
      else {
        setResult(value);
        setComplaint("");
      }
    } catch (cause: unknown) {
      if (!controller.signal.aborted)
        setError(
          cause instanceof Error
            ? cause.message
            : "Perbandingan belum tersedia.",
        );
    } finally {
      if (!controller.signal.aborted) setBusy(false);
    }
  }
  async function copy() {
    if (!result) return;
    try {
      await navigator.clipboard.writeText(
        (result.uncertainties ?? [])
          .map((q) => `${q.label}\n${q.steps.join("\n")}`)
          .join("\n\n"),
      );
      setCopied(true);
    } catch {
      setError(
        "Penyalinan belum diizinkan browser. Pilih dan salin teks pertanyaan di bawah.",
      );
    }
  }
  return (
    <div className="vn">
      {selected && result?.comparison_id && workspace.headers && (
        <PathwayConfirmation
          key={`${result.comparison_id}:${selected.pathway_code}`}
          path={selected}
          comparisonId={result.comparison_id}
          headers={workspace.headers}
          onClose={() => setSelected(null)}
          onCreated={(id) => {
            setCreated(id);
            setSelected(null);
            setResult(null);
          }}
        />
      )}
      <EmergencyNotice info={summary.emergency} />
      {created && (
        <div className="vn-card" role="status">
          <h2>Kasus klaim dibuat</h2>
          <p>Status Draft · ID {created}</p>
          <p>
            Kasus tersimpan. Kesiapan klaim SC-09 belum tersedia; checklist
            belum dapat dibuka.
          </p>
        </div>
      )}
      <header>
        <h1>Mau berobat ke mana?</h1>
        <p>{summary.pathway_help}</p>
      </header>
      {!summary.context?.process_documents && <ConsentNotice />}
      {!summary.triage_available && (
        <div className="vn-state" role="note">
          <strong>Perbandingan belum tersedia</strong>
          <p>
            Basis tanda bahaya negara ini belum terverifikasi. Perbandingan
            dikunci sampai pemeriksaan keselamatan tersedia.
          </p>
        </div>
      )}
      {emergency && (
        <div className="vn-error" role="alert">
          <strong>Kamu menyebut gejala yang bisa darurat.</strong>
          <p>
            Perbandingan dihentikan. Arahan darurat SC-08 belum tersedia;
            periksa layanan darurat setempat segera.
          </p>
        </div>
      )}
      {error && (
        <p className="vn-error" role="alert">
          {error}
        </p>
      )}
      <form className="vn-card vn-form" onSubmit={compare}>
        <label>
          Ceritakan keluhanmu
          <textarea
            value={complaint}
            maxLength={300}
            disabled={!enabled || busy}
            onChange={(e) => setComplaint(e.target.value)}
            placeholder="Sampaikan kebutuhan layanan non-darurat"
          />
        </label>
        <small>{complaint.length}/300 · Tidak disimpan lengkap</small>
        <fieldset disabled={!enabled || busy}>
          <legend>Jenis layanan</legend>
          <div className="vn-chips">
            {(summary.service_types ?? []).map((s) => (
              <button
                key={s.code}
                type="button"
                aria-pressed={service === s.code}
                onClick={() => setService(s.code)}
              >
                {s.label}
              </button>
            ))}
          </div>
          {!(summary.service_types ?? []).length && (
            <p>Jenis layanan belum tersedia dalam KB.</p>
          )}
        </fieldset>
        <label>
          Kota
          <input
            maxLength={100}
            value={city ?? summary.context?.city ?? ""}
            disabled={!enabled || busy}
            onChange={(e) => setCity(e.target.value)}
          />
        </label>
        <label>
          Kapan ingin berobat?
          <select
            value={timeframe}
            disabled={!enabled || busy}
            onChange={(e) =>
              setTimeframe(e.target.value as Request["timeframe"])
            }
          >
            <option value="today">Hari ini</option>
            <option value="this_week">Minggu ini</option>
            <option value="unknown">Belum tahu</option>
          </select>
        </label>
        <button
          className="vn-primary"
          disabled={!enabled || busy || !complaint.trim() || !service}
        >
          {busy ? "Membandingkan…" : "Bandingkan jalur"}
        </button>
        {busy && (
          <button
            type="button"
            onClick={() => {
              pending.current?.abort();
              setBusy(false);
            }}
          >
            Batalkan
          </button>
        )}
      </form>
      {result && (
        <>
          <section aria-label="Perbandingan jalur">
            <h2>Jalur yang dapat diperiksa</h2>
            <div className="vn-grid">
              {result.paths.map((path) => (
                <article className="vn-card" key={path.pathway_code}>
                  <h3>{path.name}</h3>
                  <p>{path.description}</p>
                  {path.best_for_priority && (
                    <div>
                      <span className="vn-badge">
                        Paling sesuai prioritasmu
                      </span>
                      <p>{path.priority_reason}</p>
                    </div>
                  )}
                  <p>
                    {path.coverage_label ??
                      "Perlindungan aktif belum dapat dipastikan"}
                  </p>
                  <small>
                    {path.coverage_status === "MATCHED"
                      ? "Polis aktif ditemukan; syarat layanan tetap perlu diperiksa."
                      : "Perlu dicek · bukan penolakan manfaat."}
                  </small>
                  <h4>Langkah</h4>
                  <ol>
                    {path.steps.map((step, i) => (
                      <li key={i}>{step}</li>
                    ))}
                  </ol>
                  <h4>Syarat</h4>
                  <ul>
                    {path.requirements.map((s, i) => (
                      <li key={i}>{s}</li>
                    ))}
                  </ul>
                  <h4>Perkiraan biaya pribadi</h4>
                  {path.est_out_of_pocket ? (
                    <div>
                      <span className="vn-badge">
                        Estimasi
                        {path.est_out_of_pocket.synthetic
                          ? " · asumsi sintetis demo"
                          : ""}
                      </span>
                      <p>
                        {path.est_out_of_pocket.currency}{" "}
                        {path.est_out_of_pocket.minimum}–
                        {path.est_out_of_pocket.maximum}
                      </p>
                      <a
                        href={
                          path.est_out_of_pocket.source_reference.source_url ??
                          undefined
                        }
                        target="_blank"
                        rel="noreferrer"
                      >
                        Sumber tarif ·{" "}
                        {path.est_out_of_pocket.source_reference.checked_at}
                      </a>
                    </div>
                  ) : (
                    <p>
                      Belum diketahui · tarif atau manfaat belum cukup untuk
                      menghitung.
                    </p>
                  )}
                  <h4>Dokumen yang perlu diperiksa</h4>
                  <ul>
                    {path.docs.map((s, i) => (
                      <li key={i}>{s}</li>
                    ))}
                  </ul>
                  <ul>
                    {path.uncertainties.map((s, i) => (
                      <li key={i}>{s}</li>
                    ))}
                  </ul>
                  {path.sources.map((source, i) => (
                    <div key={i}>
                      {source.source_url ? (
                        <a
                          href={source.source_url}
                          target="_blank"
                          rel="noreferrer"
                        >
                          Sumber panduan
                        </a>
                      ) : (
                        <span>Sumber belum tersedia</span>
                      )}
                      <small>
                        {" "}
                        ·{" "}
                        {source.verification_status === "VERIFIED"
                          ? "Sumber deskripsi diperiksa"
                          : "Belum terverifikasi"}{" "}
                        · {source.checked_at ?? "Tanggal cek belum tersedia"}
                      </small>
                    </div>
                  ))}
                  <button
                    disabled={
                      !path.emergency &&
                      (!path.coverage_id || !result.comparison_id)
                    }
                    title={
                      !path.coverage_id
                        ? "Perlindungan aktif perlu dipastikan sebelum membuat kasus"
                        : undefined
                    }
                    onClick={() => {
                      if (path.emergency) {
                        setResult(null);
                        setEmergency(true);
                      } else setSelected(path);
                    }}
                  >
                    {path.emergency ? "Bantuan darurat" : "Pilih jalur ini"}
                  </button>
                </article>
              ))}
            </div>
          </section>
          <section className="vn-card">
            <h2>Belum pasti</h2>
            {(result.uncertainties ?? []).length ? (
              <ul>
                {(result.uncertainties ?? []).map((q) => (
                  <li key={q.code}>
                    <strong>{q.label}</strong>
                    <p>{q.impact}</p>
                    <ul>
                      {q.steps.map((s, i) => (
                        <li key={i}>{s}</li>
                      ))}
                    </ul>
                  </li>
                ))}
              </ul>
            ) : (
              <p>Semua syarat utama sudah terverifikasi dari dokumenmu.</p>
            )}
            <div className="vn-actions">
              <button
                onClick={copy}
                disabled={!(result.uncertainties ?? []).length}
              >
                Salin pertanyaan untuk klinik
              </button>
              <button disabled title="Draf pengingat SC-10 belum tersedia">
                Buat pengingat cek
              </button>
            </div>
            {copied && <p role="status">Pertanyaan tersalin.</p>}
          </section>
          <div className="vn-warnings">
            {(result.warnings ?? []).map((s, i) => (
              <p key={i}>{s}</p>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
