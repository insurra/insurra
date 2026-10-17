"use client";
import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowRight,
  Check,
  FileCheck2,
  LockKeyhole,
  ShieldCheck,
} from "lucide-react";
import { useSession } from "@/lib/session";
import { Button } from "@/components/ui/button";
import { SessionRequired } from "@/components/session-required";
export default function Onboarding() {
  const { data, loading, setConsent } = useSession();
  const [checked, setChecked] = useState(false);
  const router = useRouter();
  if (!data) return loading ? null : <SessionRequired />;
  async function grant() {
    if (await setConsent(true)) router.push("/dashboard");
  }
  return (
    <div className="narrow-page">
      <div className="eyebrow">
        LANGKAH 01 <span className="muted">/ 02</span>
      </div>
      <h1>Kendali tetap di tanganmu.</h1>
      <p className="lead">
        Halo, {data.profile.display_name}. Sebelum melanjutkan, kenali bagaimana
        data demo kamu digunakan.
      </p>
      <div className="card consent-card">
        <div className="consent-heading">
          <div className="empty-icon">
            <LockKeyhole />
          </div>
          <span
            className={`badge ${data.consent.processing_consent ? "success" : "neutral"}`}
          >
            {data.consent.processing_consent
              ? "PERSETUJUAN AKTIF"
              : "BELUM DISETUJUI"}
          </span>
        </div>
        <h2>Persetujuan pemrosesan</h2>
        <p>
          Persetujuan diperlukan untuk pemrosesan dokumen dan fitur AI saat
          tersedia. Data sintetis yang sudah disiapkan tetap dapat dilihat tanpa
          persetujuan.
        </p>
        <div className="consent-point">
          <FileCheck2 size={21} />
          <div>
            <strong>Jelas tujuan penggunaannya</strong>
            <p>
              Membaca dokumen dan membantu memahami perlindungan. Pada fase ini,
              belum ada dokumen yang diproses atau dikirim ke penyedia AI.
            </p>
          </div>
        </div>
        <div className="consent-point">
          <ShieldCheck size={21} />
          <div>
            <strong>Tidak ada tindakan tanpa persetujuan</strong>
            <p>
              Pembuatan proposal tidak berarti persetujuan eksekusi. Tidak ada
              pengajuan klaim pada demo ini.
            </p>
          </div>
        </div>
        <div className="consent-point">
          <Check size={21} />
          <div>
            <strong>Bisa dicabut kapan saja</strong>
            <p>
              Perubahan tersimpan di backend dan dicatat dalam riwayat aktivitas
              sesi.
            </p>
          </div>
        </div>
        {data.consent.processing_consent ? (
          <div className="consent-actions">
            <Button asChild>
              <Link href="/dashboard">
                Lihat ringkasan <ArrowRight size={16} />
              </Link>
            </Button>
            <Button
              variant="outline"
              disabled={loading}
              onClick={() => void setConsent(false)}
            >
              Cabut persetujuan
            </Button>
          </div>
        ) : (
          <>
            <label className="checkbox-label">
              <input
                type="checkbox"
                checked={checked}
                onChange={(e) => setChecked(e.target.checked)}
              />{" "}
              <span>
                Saya secara eksplisit menyetujui pemrosesan data untuk fitur
                dokumen dan AI.
              </span>
            </label>
            <Button
              className="w-full"
              disabled={!checked || loading}
              onClick={() => void grant()}
            >
              Setuju & lanjutkan <ArrowRight size={16} />
            </Button>
            <Link href="/dashboard" className="text-link consent-skip">
              Lihat data demo tanpa persetujuan
            </Link>
          </>
        )}
      </div>
    </div>
  );
}
