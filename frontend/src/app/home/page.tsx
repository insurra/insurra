"use client";

import Link from "next/link";
import { useState } from "react";
import { api } from "@/lib/api/client";
import { useWorkspace } from "@/lib/workspace";
import { EmergencyNotice, WorkspaceState } from "@/components/valen/workspace";

export default function HomePage() {
  const workspace = useWorkspace();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  if (!workspace.summary) return <WorkspaceState workspace={workspace} />;
  const s = workspace.summary;
  const context = s.context;
  const cards = s.coverages ?? [];
  const warnings = s.warnings ?? [];
  async function decide(
    rule_id: string,
    subject: string,
    decision: "dismiss" | "handled",
  ) {
    if (
      !workspace.headers ||
      (decision === "handled" &&
        !window.confirm(
          "Konfirmasi bahwa langkah ini sudah Anda urus. Peringatan tetap terlihat sampai datanya diperbarui.",
        ))
    )
      return;
    setBusy(true);
    setError(null);
    try {
      await api.request("post", "/api/v1/home/recommendations/decision", {
        headers: workspace.headers,
        body: { rule_id, subject, decision, confirmed: decision === "handled" },
      });
      workspace.refresh();
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Keputusan belum tersimpan.",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="vn">
      <EmergencyNotice info={s.emergency} />
      <header>
        <span className="vn-subtle">
          {context?.synthetic ? "DEMO SINTETIS" : "RUANG KERJA PRIBADI"}
        </span>
        <h1>Halo, {context?.first_name}.</h1>
        <p>
          {context?.country_label} · {context?.city ?? "Kota belum diisi"} ·{" "}
          {context?.occupation_label}
        </p>
        {context?.arrival_date && (
          <p>
            {typeof context.days_since_arrival === "number"
              ? `Hari ke-${context.days_since_arrival} sejak tiba`
              : `Rencana tiba ${context.arrival_date}`}{" "}
            · Visa berakhir {context.visa_expiry_date ?? "belum diisi"}
          </p>
        )}
        <small>
          Tanggal konteks: {context?.today} · {context?.timezone}
        </small>
      </header>
      <nav className="vn-actions" aria-label="Pintasan situasi">
        <Link href="/ask">Tanya polis</Link>
        <Link href="/pathways">Saya perlu berobat</Link>
        {s.active ? (
          <Link href="/claims">Siapkan klaim</Link>
        ) : (
          <button disabled title="Unggah polis terlebih dulu">
            Siapkan klaim
          </button>
        )}
        <Link href="/coverage-needs">Perlindungan apa yang aku butuhkan?</Link>
      </nav>
      {!cards.length && (
        <section className="vn-state">
          <h2>Belum ada perlindungan tersimpan</h2>
          <Link href="/documents">Unggah dokumen pertama</Link>
        </section>
      )}
      <section className="vn-grid" aria-label="Ringkasan perlindungan">
        {[
          {
            label: "Perlindungan aktif",
            count: s.active,
            filter: (c: (typeof cards)[number]) => c.active,
          },
          {
            label: "Berakhir ≤ 30 hari",
            count: s.expiring_30d,
            filter: (c: (typeof cards)[number]) => c.expiring_30d,
          },
          {
            label: "Perlu verifikasi",
            count: s.needs_verification,
            filter: (c: (typeof cards)[number]) => c.needs_verification,
          },
        ].map((card) => (
          <details className="vn-card" key={card.label}>
            <summary>
              <strong>{card.count}</strong>
              {card.label}
            </summary>
            <ul>
              {cards.filter(card.filter).map((c) => (
                <li key={c.id}>
                  <strong>{c.provider ?? "Penyedia belum diisi"}</strong> ·{" "}
                  {c.kind}
                  <p>
                    Negara catatan: {c.country_code} · Akhir{" "}
                    {c.end_date ?? "belum diketahui"}
                  </p>
                </li>
              ))}
            </ul>
          </details>
        ))}
      </section>
      <section>
        <h2>Langkah berikutnya</h2>
        {error && <p role="alert">{error}</p>}
        <div className="vn-list">
          {s.recommendations.map((r) => (
            <article className="vn-card" key={`${r.rule_id}:${r.subject}`}>
              <h3>{r.title}</h3>
              <p>{r.explanation}</p>
              <small>
                Aturan: {r.rule_id}
                {r.handled
                  ? " · Sudah ditandai diurus; periksa pembaruan data."
                  : ""}
              </small>
              {r.source?.source_url ? (
                <a href={r.source.source_url} target="_blank" rel="noreferrer">
                  Sumber aturan · {r.source.checked_at}
                </a>
              ) : (
                <small>
                  Perlu konfirmasi · Sumber aturan belum diverifikasi
                </small>
              )}
              <div className="vn-actions">
                <Link href={r.action_url}>Periksa sekarang</Link>
                <button
                  disabled={busy}
                  onClick={() =>
                    void decide(
                      r.rule_id,
                      r.subject,
                      r.dismissible ? "dismiss" : "handled",
                    )
                  }
                >
                  {r.dismissible ? "Abaikan 7 hari" : "Sudah saya urus"}
                </button>
              </div>
            </article>
          ))}
        </div>
        {!s.recommendations.length && (
          <p>
            Semua beres untuk aturan yang sudah tersedia saat ini. Periksa data
            yang belum terverifikasi.
          </p>
        )}
      </section>
      {warnings.length > 0 && (
        <div className="vn-warnings">
          {warnings.map((w) => (
            <p key={w}>{w}</p>
          ))}
        </div>
      )}
      <p className="vn-subtle">
        Ringkasan dihitung sistem. Data hilang tidak berarti manfaat
        dikecualikan. Pengingat dari layanan tindakan belum tersedia.
      </p>
    </div>
  );
}
