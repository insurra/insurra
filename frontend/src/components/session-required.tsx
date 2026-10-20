"use client";

import "@/app/dashboard/dashboard.css";
import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";
import { ArrowRight } from "lucide-react";
import { signInUrl } from "@/lib/safe-redirect";

export function SessionRequired() {
  const pathname = usePathname();
  return (
    <div className="dx-empty" data-testid="session-required">
      <Image src="/mascot-shield.png" alt="" width={120} height={110} />
      <h1>Choose how to continue.</h1>
      <p>
        Halaman ini memerlukan sesi aktif. Coba profil simulasi interaktif, atau masuk untuk menggunakan akun Anda sendiri.
      </p>
      <div style={{ display: "flex", gap: 16, flexWrap: "wrap", justifyContent: "center" }}>
        <Link href="/#demo" className="dx-link">
          Try Demo <ArrowRight size={16} aria-hidden="true" />
        </Link>
        <Link href={signInUrl(pathname || "/")} className="dx-link">
          Sign in <ArrowRight size={16} aria-hidden="true" />
        </Link>
      </div>
    </div>
  );
}
