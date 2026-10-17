"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  ArrowRight,
  Check,
  CheckCircle2,
  FileSearch,
  Globe2,
  LockKeyhole,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import { api } from "@/lib/api/client";
import type { components } from "@/lib/api/types.gen";
import { useAuth } from "@/lib/auth";
import { useSession } from "@/lib/session";
import { Button } from "@/components/ui/button";

type S = components["schemas"];

function GoogleMark() {
  return <span className="google-mark" aria-hidden="true">G</span>;
}

export default function Home() {
  const { selectPersona, loading, data } = useSession();
  const { account, googleLoginUrl } = useAuth();
  const [personas, setPersonas] = useState<S["DemoPersona"][]>([]);
  const [countries, setCountries] = useState<S["CountryManifest"][]>([]);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  useEffect(() => {
    let active = true;
    Promise.all([api.get("/api/v1/demo/personas"), api.get("/api/v1/countries")])
      .then(([nextPersonas, nextCountries]) => {
        if (active) {
          setPersonas(nextPersonas);
          setCountries(nextCountries);
        }
      })
      .catch((cause) => {
        if (active) setError(cause instanceof Error ? cause.message : "Gagal memuat demo.");
      });
    return () => {
      active = false;
    };
  }, []);

  async function start(id: string) {
    if (await selectPersona(id)) router.push("/onboarding");
  }

  return (
    <div className="cover-page">
      <header className="cover-nav">
        <Link href="/" className="brand cover-brand">
          <span className="brand-mark"><ShieldCheck size={25} strokeWidth={1.8} /></span>
          insurra<span className="brand-dot">.</span>
        </Link>
        <div className="cover-nav-actions">
          <a href="#demo">Coba sebagai tamu</a>
          {account ? (
            <Link className="account-chip" href="/dashboard">
              <span className="avatar small">{(account.display_name ?? account.email ?? "A").slice(0, 1)}</span>
              {account.display_name ?? account.email ?? "Akun saya"}
            </Link>
          ) : (
            <Button asChild variant="outline" size="lg"><Link href="/login">Masuk</Link></Button>
          )}
        </div>
      </header>

      <main>
        <section className="cover-hero">
          <div className="hero-copy">
            <div className="eyebrow"><Sparkles size={14} /> INSURANCE, MADE HUMAN</div>
            <h1>Protection made <span>simple.</span></h1>
            <p className="hero-lead">Understand your policy, explore your options, and make informed decisions with confidence.</p>
            <div className="hero-actions">
              <Button asChild size="lg"><a href={googleLoginUrl}><GoogleMark /> Lanjutkan dengan Google</a></Button>
              <Button asChild variant="outline" size="lg"><a href="#demo">Jelajahi sebagai tamu <ArrowRight /></a></Button>
            </div>
            <div className="hero-trust">
              <span><LockKeyhole /> Data tetap dalam kendalimu</span>
              <span><CheckCircle2 /> Transparan, tanpa asumsi</span>
            </div>
          </div>
          <div className="hero-visual" aria-label="Pratinjau ringkasan perlindungan">
            <div className="visual-glow" />
            <div className="protection-card">
              <div className="protection-card-head">
                <span className="protection-icon"><ShieldCheck /></span>
                <span className="badge success">PROTECTED</span>
              </div>
              <p>Your protection overview</p>
              <strong>Clearer choices.<br />Calmer decisions.</strong>
              <div className="coverage-row"><span>Policy readiness</span><b>82%</b></div>
              <div className="coverage-track"><span /></div>
              <div className="mini-stats">
                <div><span>Documents</span><strong>04</strong></div>
                <div><span>Next review</span><strong>12 Oct</strong></div>
              </div>
            </div>
            <div className="assistant-bubble"><Sparkles /> Evidence first, always.</div>
          </div>
        </section>

        <section className="cover-values">
          <div><FileSearch /><strong>Bukti, bukan tebakan</strong><span>Jawaban terhubung dengan dokumen.</span></div>
          <div><Globe2 /><strong>Konteks lintas negara</strong><span>Memahami situasi tempatmu berada.</span></div>
          <div><LockKeyhole /><strong>Privasi sejak awal</strong><span>Persetujuan selalu ada di tanganmu.</span></div>
        </section>

        <section id="demo" className="demo-section">
          <div className="section-heading demo-heading">
            <div>
              <div className="eyebrow">COBA TANPA AKUN</div>
              <h2>Mulai dari sebuah cerita.</h2>
              <p>Semua data berikut sintetis dan aman untuk dieksplorasi.</p>
            </div>
            <span className="badge neutral">GUEST MODE</span>
          </div>
          {error && <div role="alert" className="alert error">{error}</div>}
          {!error && !personas.length && <p role="status">Memuat persona demo…</p>}
          <div className="persona-grid">
            {personas.map((persona, index) => (
              <article key={persona.persona_id} className="persona-card">
                <div className={`persona-visual visual-${index % 2}`}>
                  <span className="country-pill"><Globe2 /> {countries.find((country) => country.country_code === persona.country_code)?.label ?? persona.country_code}</span>
                  <div className="portrait-letter">{persona.display_name.slice(0, 1)}<ShieldCheck /></div>
                  <div className="orbit orbit-one" /><div className="orbit orbit-two" />
                </div>
                <div className="persona-body">
                  <span className="eyebrow">PERSONA {String(index + 1).padStart(2, "0")}</span>
                  <h3>Kenalan dengan {persona.display_name}</h3>
                  <p>{persona.description}</p>
                  <div className="persona-detail"><Check /> Profil & catatan sintetis</div>
                  <Button className="w-full mt-6" disabled={loading} onClick={() => void start(persona.persona_id)}>
                    Mulai demo {persona.display_name}<ArrowRight />
                  </Button>
                </div>
              </article>
            ))}
          </div>
          {data && <p className="return-link">Sesi {data.profile.display_name} masih aktif. <Link href="/dashboard">Kembali ke ringkasan <ArrowRight /></Link></p>}
        </section>
      </main>
      <footer className="cover-footer"><span>© 2026 Insurra</span><span>Bukan nasihat medis, hukum, atau finansial.</span></footer>
    </div>
  );
}
