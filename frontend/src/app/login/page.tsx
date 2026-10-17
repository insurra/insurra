"use client";

import Link from "next/link";
import { Suspense } from "react";
import { ArrowLeft, ArrowRight, CheckCircle2, LockKeyhole, ShieldCheck } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { useAuth } from "@/lib/auth";
import { Button } from "@/components/ui/button";

export default function LoginPage() {
  return <Suspense fallback={<main className="callback-page"><p>Menyiapkan halaman masuk…</p></main>}><LoginContent /></Suspense>;
}

function LoginContent() {
  const { account, googleLoginUrl } = useAuth();
  const failed = useSearchParams().get("error") === "google";
  return (
    <main className="auth-page">
      <section className="auth-story">
        <Link href="/" className="brand auth-brand"><ShieldCheck /> insurra<span className="brand-dot">.</span></Link>
        <div>
          <span className="eyebrow">YOUR INSURANCE COMPANION</span>
          <h1>Clarity starts with one secure step.</h1>
          <p>Pahami perlindunganmu, simpan progres, dan kembali kapan saja.</p>
        </div>
        <ul>
          <li><CheckCircle2 /> Satu akun untuk seluruh perjalanan perlindunganmu</li>
          <li><CheckCircle2 /> Persetujuan dan privasi yang dapat kamu kendalikan</li>
          <li><CheckCircle2 /> Informasi berbasis bukti, bukan asumsi</li>
        </ul>
      </section>
      <section className="auth-panel">
        <div className="auth-box">
          <Link href="/" className="back-link"><ArrowLeft /> Kembali</Link>
          <span className="auth-lock"><LockKeyhole /></span>
          <h2>{account ? "Kamu sudah masuk." : "Selamat datang."}</h2>
          <p>{account ? `Lanjutkan sebagai ${account.display_name ?? account.email ?? "pengguna"}.` : "Masuk dengan Google untuk menyimpan progresmu secara aman."}</p>
          {failed && <div className="alert error" role="alert">Google login belum berhasil. Silakan coba kembali.</div>}
          {account ? (
            <Button asChild size="lg" className="auth-button"><Link href="/dashboard">Buka ruang perlindungan <ArrowRight /></Link></Button>
          ) : (
            <Button asChild variant="outline" size="lg" className="auth-button google-button"><a href={googleLoginUrl}><span className="google-mark">G</span> Lanjutkan dengan Google</a></Button>
          )}
          <div className="auth-divider"><span>atau</span></div>
          <Button asChild variant="ghost" size="lg" className="auth-button"><Link href="/#demo">Lanjutkan sebagai tamu</Link></Button>
          <p className="auth-terms">Dengan melanjutkan, kamu menyetujui Ketentuan Penggunaan dan Kebijakan Privasi Insurra.</p>
        </div>
      </section>
    </main>
  );
}
