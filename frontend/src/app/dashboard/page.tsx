"use client";
import Link from "next/link";
import {
  ArrowDownToLine,
  ArrowRight,
  ArrowUpRight,
  CalendarDays,
  CircleHelp,
  FileText,
  Globe2,
  Info,
  Shield,
  ShieldCheck,
} from "lucide-react";
import { useSession } from "@/lib/session";
import { formatDate } from "@/lib/presentation";
import { Button } from "@/components/ui/button";
import { SessionRequired } from "@/components/session-required";
export default function Dashboard() {
  const { data, loading } = useSession();
  if (!data) return loading ? null : <SessionRequired />;
  const { profile, record, assessment, consent } = data;
  return (
    <>
      <div className="page-heading">
        <div>
          <div className="eyebrow">RUANG PERLINDUNGANMU</div>
          <h1>
            Selamat datang, {profile.display_name}
            <span className="hello-dot">.</span>
          </h1>
          <p>Gambaran yang lebih jelas untuk langkah yang lebih pasti.</p>
        </div>
        <Button asChild variant="outline">
          <Link href="/documents">
            <FileText size={16} /> Lihat dokumen
          </Link>
        </Button>
      </div>
      <div className="profile-strip">
        <div className="avatar">{profile.display_name.slice(0, 1)}</div>
        <div>
          <strong>{profile.display_name}</strong>
          <span>
            {profile.occupation === "STUDENT"
              ? "Mahasiswa"
              : profile.occupation === "EMPLOYEE"
                ? "Karyawan"
                : "Lainnya"}{" "}
            · {profile.city ?? "Kota belum diisi"}
          </span>
        </div>
        <span className="profile-divider" />
        <span className="profile-context">
          <Globe2 size={17} />
          {profile.country_code} ·{" "}
          {profile.residence_context === "ABROAD"
            ? "Tinggal di luar negeri"
            : "Tinggal di dalam negeri"}
        </span>
        <span className="badge neutral ml-auto">DATA SINTETIS</span>
      </div>
      {!consent.processing_consent && (
        <div className="alert info">
          <Info size={18} />
          <span>
            Pemrosesan belum disetujui. Kamu tetap bisa melihat data demo.
          </span>
          <Link href="/onboarding">
            Atur persetujuan <ArrowRight size={14} />
          </Link>
        </div>
      )}
      <div className="stats-grid">
        <div className="stat card">
          <div className="stat-label">
            Polis tercatat <Shield size={18} />
          </div>
          <strong>{record.policies.length.toString().padStart(2, "0")}</strong>
          <span>Dalam catatan asuransimu</span>
        </div>
        <div className="stat card">
          <div className="stat-label">
            Dokumen demo <FileText size={18} />
          </div>
          <strong>{record.documents.length.toString().padStart(2, "0")}</strong>
          <span>Belum melalui ekstraksi</span>
        </div>
        <div className="stat card">
          <div className="stat-label">
            Verifikasi manfaat <CircleHelp size={18} />
          </div>
          <strong className="text-stat">Perlu diperiksa</strong>
          <span>Belum ada bukti manfaat terverifikasi</span>
        </div>
      </div>
      <div className="dashboard-grid">
        <section className="policies-section">
          <div className="section-heading">
            <h2>Perlindungan yang tercatat</h2>
            <span className="muted small-text">
              Diperbarui {formatDate(record.updated_at)}
            </span>
          </div>
          <div className="policy-list">
            {record.policies.map((policy) => (
              <article key={policy.id} className="card policy-card">
                <div className="policy-top">
                  <div className="policy-icon">
                    <ShieldCheck size={24} />
                  </div>
                  <div>
                    <h3>{policy.policy_type}</h3>
                    <p>{policy.provider_name ?? "Penyedia belum diketahui"}</p>
                  </div>
                  <span className="badge warning">BELUM DIVERIFIKASI</span>
                </div>
                <p className="policy-name">
                  {policy.policy_name ?? "Nama polis belum tersedia"}
                </p>
                <div className="policy-dates">
                  <div>
                    <span>Mulai perlindungan</span>
                    <strong>{formatDate(policy.coverage_start_date)}</strong>
                  </div>
                  <ArrowRight size={16} />
                  <div>
                    <span>Akhir perlindungan</span>
                    <strong>{formatDate(policy.coverage_end_date)}</strong>
                  </div>
                </div>
                <div className="benefits-list">
                  {policy.coverage_items.map((item) => (
                    <div key={item.coverage_code}>
                      <span>{item.benefit_name}</span>
                      <span className="unknown-label">
                        <CircleHelp size={13} />
                        {item.coverage_status === "UNKNOWN"
                          ? "Belum diketahui"
                          : item.coverage_status === "COVERED"
                            ? "Ditanggung"
                            : "Tidak ditanggung"}
                      </span>
                    </div>
                  ))}
                </div>
                <div className="policy-bottom">
                  <span>
                    <Info size={13} /> Catatan sintetis, bukan kutipan polis
                  </span>
                  <Link href="/documents">
                    Lihat sumber <ArrowUpRight size={14} />
                  </Link>
                </div>
              </article>
            ))}
          </div>
        </section>
        <aside className="insights-column">
          <section className="assessment-card">
            <div className="assessment-icon">
              <CalendarDays size={22} />
            </div>
            <div className="eyebrow">PEMERIKSAAN INTERVAL</div>
            <h2>
              {assessment.applicable
                ? "Perlindungan & masa tinggal"
                : "Konteks perlindunganmu"}
            </h2>
            {assessment.applicable ? (
              <>
                {assessment.gap_days !== null &&
                assessment.gap_days !== undefined ? (
                  <div className="gap-value">
                    <strong>{assessment.gap_days}</strong>
                    <span>hari potensi jeda</span>
                  </div>
                ) : (
                  <p>Tanggal perlu dilengkapi.</p>
                )}
                {assessment.gap_periods.map((gap) => (
                  <p className="gap-period" key={gap.start_date}>
                    {formatDate(gap.start_date)}
                    <br />— {formatDate(gap.end_date)}
                  </p>
                ))}
                <span className="badge warning">PERLU VERIFIKASI</span>
              </>
            ) : (
              <div className="not-applicable">
                <ShieldCheck size={26} />
                <strong>Tidak berlaku</strong>
                <span>Penilaian interval visa</span>
              </div>
            )}
            <p className="assessment-explanation">{assessment.explanation}</p>
            {assessment.rule_source && (
              <div className="rule-source">
                KB {assessment.rule_source.country_code} · v
                {assessment.rule_source.kb_version} ·{" "}
                {assessment.rule_source.verification_status === "UNVERIFIED"
                  ? "Aturan belum diverifikasi"
                  : "Aturan diverifikasi"}
              </div>
            )}
          </section>
          <section className="card next-step">
            <div className="eyebrow">LANGKAH KECIL BERIKUTNYA</div>
            <h3>Mulai dari dokumenmu.</h3>
            <p>
              Periksa catatan yang tersedia dan hal yang masih perlu
              dikonfirmasi.
            </p>
            <Link href="/documents">
              Buka dokumen <ArrowRight size={16} />
            </Link>
            <ArrowDownToLine className="decorative-icon" size={50} />
          </section>
        </aside>
      </div>
      <div className="footnote">
        <Info size={16} />
        <p>
          Informasi yang belum ditemukan bukan berarti tidak ditanggung. Selalu
          konfirmasi manfaat dan ketentuan pada dokumen asli atau penyedia
          asuransi.
        </p>
      </div>
    </>
  );
}
