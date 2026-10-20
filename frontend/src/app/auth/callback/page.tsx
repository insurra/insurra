"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ShieldCheck } from "lucide-react";
import { useAuth } from "@/lib/auth";

export default function AuthCallbackPage() {
  const { acceptToken, loginWithSupabase } = useAuth();
  const router = useRouter();
  const [message, setMessage] = useState("Menyiapkan ruang perlindunganmu…");

  useEffect(() => {
    const hash = window.location.hash.slice(1);
    const hashParams = new URLSearchParams(hash);
    const token = hashParams.get("access_token");

    const searchParams = new URLSearchParams(window.location.search);
    const code = searchParams.get("code");
    const errorParam = searchParams.get("error") || hashParams.get("error");

    window.history.replaceState(null, "", "/auth/callback");

    if (errorParam || (!token && !code)) {
      router.replace("/login?error=google");
      return;
    }
    // Check if token is a Supabase JWT (3 base64 parts) or if code is present
    const isSupabase = Boolean(code) || Boolean(token && token.startsWith("ey") && token.split(".").length === 3);

    if (isSupabase) {
      void loginWithSupabase({
        access_token: token || undefined,
        code: code || undefined,
      }).then((result) => {
        if (result.success) {
          router.replace("/account/onboarding");
        } else {
          setMessage(result.error || "Sesi Supabase tidak dapat diverifikasi.");
        }
      });
      return;
    }

    if (token) {
      void acceptToken(token).then((success) => {
        if (success) router.replace("/account/onboarding");
        else setMessage("Session could not be verified. Please sign in again.");
      });
    }
  }, [acceptToken, loginWithSupabase, router]);

  return <main className="callback-page"><div className="callback-mark"><ShieldCheck /></div><h1>Hampir selesai.</h1><p>{message}</p></main>;
}
