"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ShieldCheck } from "lucide-react";
import { useAuth } from "@/lib/auth";

export default function AuthCallbackPage() {
  const { acceptToken } = useAuth();
  const router = useRouter();
  const [message, setMessage] = useState("Menyiapkan ruang perlindunganmu…");

  useEffect(() => {
    const token = new URLSearchParams(window.location.hash.slice(1)).get("access_token");
    window.history.replaceState(null, "", "/auth/callback");
    if (!token) {
      router.replace("/login?error=google");
      return;
    }
    void acceptToken(token).then((success) => {
      if (success) router.replace("/auth");
      else setMessage("Sesi tidak dapat diverifikasi. Silakan masuk kembali.");
    });
  }, [acceptToken, router]);

  return <main className="callback-page"><div className="callback-mark"><ShieldCheck /></div><h1>Hampir selesai.</h1><p>{message}</p></main>;
}
