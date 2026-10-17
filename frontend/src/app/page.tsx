"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  ArrowRight,
  Check,
  FileSearch,
  Globe2,
  LockKeyhole,
  ShieldCheck,
} from "lucide-react";
import { api } from "@/lib/api/client";
import type { components } from "@/lib/api/types.gen";
import { useSession } from "@/lib/session";
import { Button } from "@/components/ui/button";

type S = components["schemas"];
export default function Home() {
  const { selectPersona, loading, data } = useSession();
  const [personas, setPersonas] = useState<S["DemoPersona"][]>([]);
  const [countries, setCountries] = useState<S["CountryManifest"][]>([]);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();
  useEffect(() => {
    let active = true;
    Promise.all([
      api.get("/api/v1/demo/personas"),
      api.get("/api/v1/countries"),
    ])
      .then(([p, c]) => {
        if (active) {
          setPersonas(p);
          setCountries(c);
        }
      })
      .catch((err) => {
        if (active)
          setError(
            err instanceof Error ? err.message : "Gagal memuat persona.",
          );
      });
    return () => {
      active = false;
    };
  }, []);
  async function start(id: string) {
    if (await selectPersona(id)) router.push("/onboarding");
  }
  return (
    <div className="landing">
      <div className="eyebrow">
        <span className="status-dot" /> LEBIH PAHAM, LEBIH TENANG
      </div>
      <h1>
        Asuransi terasa rumit.
        <br />
        <span>Kita pahami bersama.</span>
      </h1>
      <p className="lead">
        Kenali perlindungan yang kamu punya, temukan hal yang perlu diperiksa,
        dan siapkan langkah berikutnya dengan lebih yakin.
      </p>
      <div className="trust-row">
        <span>
          <LockKeyhole size={15} /> Persetujuan di tanganmu
        </span>
        <span>
          <FileSearch size={16} /> Bukti, bukan asumsi
        </span>
        <span>
          <Globe2 size={16} /> Konteks lintas negara
        </span>
      </div>
      <div className="section-heading">
        <div>
          <h2>Coba pengalaman demo</h2>
          <p>
            Pilih cerita yang ingin kamu jelajahi. Semua data di bawah ini
            sintetis.
          </p>
        </div>
        <span className="badge neutral">TANPA AKUN</span>
      </div>
      {error && (
        <div role="alert" className="alert error">
          {error}
        </div>
      )}
      {!error && !personas.length && (
        <p role="status" className="muted">
          Memuat persona… Jika belum ada data, jalankan make seed.
        </p>
      )}
      <div className="persona-grid">
        {personas.map((p, index) => (
          <article key={p.persona_id} className="persona-card">
            <div className={`persona-visual visual-${index % 2}`}>
              <span className="country-pill">
                <Globe2 size={14} />{" "}
                {countries.find((c) => c.country_code === p.country_code)
                  ?.label ?? p.country_code}
              </span>
              <div className="portrait-letter">
                {p.display_name.slice(0, 1)}
                <ShieldCheck size={37} />
              </div>
              <div className="orbit orbit-one" />
              <div className="orbit orbit-two" />
            </div>
            <div className="persona-body">
              <span className="eyebrow">
                PERSONA {String(index + 1).padStart(2, "0")}
              </span>
              <h3>Kenalan dengan {p.display_name}</h3>
              <p>{p.description}</p>
              <div className="persona-detail">
                <Check size={16} /> Profil & catatan asuransi sintetis
              </div>
              <Button
                className="w-full mt-6"
                disabled={loading}
                onClick={() => void start(p.persona_id)}
              >
                Mulai demo {p.display_name}
                <ArrowRight size={16} />
              </Button>
            </div>
          </article>
        ))}
      </div>
      {data && (
        <p className="return-link">
          Sesi {data.profile.display_name} masih aktif.{" "}
          <Link href="/dashboard">
            Kembali ke ringkasan <ArrowRight size={14} />
          </Link>
        </p>
      )}
      <div className="landing-note">
        <ShieldCheck size={22} />
        <div>
          <strong>Transparan sejak awal.</strong>
          <p>
            Demo ini menampilkan fondasi aplikasi. Ekstraksi dokumen, tanya
            jawab AI, dan pengajuan klaim belum diaktifkan.
          </p>
        </div>
      </div>
    </div>
  );
}
