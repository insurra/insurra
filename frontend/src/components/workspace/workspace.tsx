"use client";

import Link from "next/link";
import type { components } from "@/lib/api/types.gen";
import type { useWorkspace } from "@/lib/workspace";
import "./workspace.css";

type Workspace = ReturnType<typeof useWorkspace>;
export function WorkspaceState({ workspace }: { workspace: Workspace }) {
  if (workspace.loading)
    return <p role="status">Memuat konteks perlindungan…</p>;
  if (workspace.error)
    return (
      <div className="vn-state" role="alert">
        <h1>Data belum tersedia</h1>
        <p>{workspace.error}</p>
        <button onClick={workspace.refresh}>Coba lagi</button>
        <Link href="/onboarding">Periksa profil</Link>
      </div>
    );
  return (
    <div className="vn-state">
      <h1>Masuk untuk membuka perlindungan Anda</h1>
      <p>Gunakan akun atau sesi demo yang sudah tersedia.</p>
      <Link href="/auth">Masuk</Link>
      <Link href="/">Pilih demo</Link>
    </div>
  );
}
export function EmergencyNotice({
  info,
}: {
  info?: components["schemas"]["EmergencyInfo"];
}) {
  return (
    <aside className="vn-emergency" aria-label="Bantuan darurat">
      <strong>
        {info?.label ?? "Darurat? Periksa layanan darurat setempat."}
      </strong>
      {info?.available && info.phone_number ? (
        <a href={`tel:${info.phone_number}`}>Hubungi {info.phone_number}</a>
      ) : (
        <p>
          Jika membutuhkan bantuan segera, periksa layanan darurat setempat.
          Pemeriksaan polis tidak menggantikan bantuan darurat.
        </p>
      )}
      {info?.source_url && (
        <a href={info.source_url} target="_blank" rel="noreferrer">
          Sumber resmi · {info.checked_at}
        </a>
      )}
      <small>Arahan darurat SC-08 belum tersedia di aplikasi ini.</small>
    </aside>
  );
}
export function ConsentNotice({ ai = false }: { ai?: boolean }) {
  return (
    <div className="vn-state" role="note">
      <p>
        Aktifkan persetujuan pemrosesan dokumen{ai ? " dan external AI" : ""}{" "}
        sebelum melanjutkan.
      </p>
      <Link href="/settings/privacy">Privasi & Data Saya</Link>
      <small>
        Demo: kelola external_ai melalui API persetujuan; kontrol demo lama
        hanya mengatur dokumen.
      </small>
    </div>
  );
}
