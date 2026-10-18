"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { api } from "@/lib/api/client";
import type { components } from "@/lib/api/types.gen";
import { useWorkspace } from "@/lib/workspace";
import {
  ConsentNotice,
  EmergencyNotice,
  WorkspaceState,
} from "@/components/valen/workspace";

type Need = components["schemas"]["CoverageNeed"];
const statusLabel = {
  OWNED: "Sudah punya",
  NOT_OWNED: "Belum punya",
  NEEDS_CHECK: "Perlu dicek",
};
export default function CoverageNeedsPage() {
  const workspace = useWorkspace();
  const [needs, setNeeds] = useState<Need[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    if (workspace.summary?.context?.process_documents && workspace.headers) {
      api
        .request("get", "/api/v1/coverage-needs", {
          headers: workspace.headers,
          signal: controller.signal,
        })
        .then((value) => {
          if (!controller.signal.aborted) {
            setNeeds(value);
            setError(null);
          }
        })
        .catch((cause: unknown) => {
          if (!controller.signal.aborted) {
            setNeeds(null);
            setError(
              cause instanceof Error
                ? cause.message
                : "Kebutuhan belum dapat diperiksa.",
            );
          }
        });
    }
    return () => controller.abort();
  }, [workspace.headers, workspace.summary]);
  if (!workspace.summary) return <WorkspaceState workspace={workspace} />;
  const s = workspace.summary;
  return (
    <div className="vn">
      <EmergencyNotice info={s.emergency} />
      <header>
        <h1>Perlindungan yang kamu butuhkan di {s.context?.country_label}</h1>
        <p>
          {s.context?.country_label} · {s.context?.occupation_label}
        </p>
        <Link href="/onboarding?mode=edit">Ubah situasi saya</Link>
      </header>
      {!s.context?.process_documents ? (
        <ConsentNotice />
      ) : (
        <>
          {error && (
            <div className="vn-error" role="alert">
              {error}
              <button onClick={workspace.refresh}>Coba lagi</button>
            </div>
          )}
          {!needs && !error && (
            <p role="status">Memeriksa aturan dan dokumen…</p>
          )}
          {needs && (
            <>
              <p>
                {needs.filter((n) => n.ownership_status === "OWNED").length}{" "}
                dari {needs.length} sudah punya
              </p>
              {!needs.length && (
                <p>
                  Segera hadir · Aturan untuk konteks ini belum tersedia. Hasil
                  kosong bukan jaminan perlindungan lengkap.
                </p>
              )}
              {(["REQUIRED", "RECOMMENDED"] as const).map((level) => (
                <section key={level}>
                  <h2>
                    {level === "REQUIRED"
                      ? "Wajib"
                      : "Disarankan / perlu konfirmasi"}
                  </h2>
                  <div className="vn-list">
                    {needs
                      .filter((n) => n.requirement_level === level)
                      .map((n) => (
                        <article key={n.need_code} className="vn-card">
                          <h3>{n.label}</h3>
                          <span className="vn-badge">
                            {statusLabel[n.ownership_status]}
                          </span>
                          <p>{n.explanation}</p>
                          {!n.requirement_confirmed && (
                            <small>
                              Dasar kebutuhan perlu konfirmasi; bukan penetapan
                              kewajiban hukum.
                            </small>
                          )}
                          {n.source_reference?.source_url ? (
                            <a
                              href={n.source_reference.source_url}
                              rel="noreferrer"
                              target="_blank"
                            >
                              Sumber aturan ·{" "}
                              {n.source_reference.checked_at ??
                                "tanggal cek belum tersedia"}
                            </a>
                          ) : (
                            <small>
                              Sumber dan tanggal cek belum diverifikasi.
                            </small>
                          )}
                          {n.visa_assessment && (
                            <div className="vn-warnings">
                              {typeof n.visa_assessment.gap_days ===
                              "number" ? (
                                <p>
                                  Ada jeda {n.visa_assessment.gap_days} hari
                                  (potensi; periksa bukti dan syarat visa).
                                </p>
                              ) : (
                                <p>
                                  Tanggal belum lengkap atau belum
                                  terverifikasi.
                                </p>
                              )}
                              <small>
                                {n.visa_assessment.assessment_status ===
                                "NEEDS_VERIFICATION"
                                  ? "Perlu verifikasi. "
                                  : ""}
                                Memakai perhitungan interval SC-04 yang sama.
                              </small>
                              <p>
                                <Link href="/completeness?task=visa_cover">
                                  Periksa jeda di Cek Kelengkapan
                                </Link>
                              </p>
                            </div>
                          )}
                          {n.exclusion && (
                            <blockquote>
                              {n.exclusion.original_text} · hal.{" "}
                              {n.exclusion.page_number}
                            </blockquote>
                          )}
                          <ul>
                            {n.verification_steps?.map((step) => (
                              <li key={step}>{step}</li>
                            ))}
                          </ul>
                          <Link href={n.action_url ?? "/documents"}>
                            {n.ownership_status === "OWNED"
                              ? "Lihat polis"
                              : n.ownership_status === "NEEDS_CHECK"
                                ? "Cek sekarang"
                                : "Periksa dokumen / pelajari langkah"}
                          </Link>
                        </article>
                      ))}
                  </div>
                </section>
              ))}
            </>
          )}
        </>
      )}
      <p className="vn-subtle">
        Status “Belum punya” berarti tidak ditemukan dalam dokumen yang
        tersedia, bukan putusan bahwa manfaat dikecualikan. Tidak ada
        rekomendasi produk atau penyedia tertentu.
      </p>
    </div>
  );
}
