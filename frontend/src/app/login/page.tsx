"use client";

import Link from "next/link";
import Image from "next/image";
import { Suspense, useEffect } from "react";
import { ArrowLeft, ArrowRight, CheckCircle2, LockKeyhole } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { useAuth } from "@/lib/auth";
import { Button } from "@/components/ui/button";

export default function LoginPage() {
  return (
    <Suspense
      fallback={
        <main className="callback-page">
          <p>Preparing authentication...</p>
        </main>
      }
    >
      <LoginContent />
    </Suspense>
  );
}

function LoginContent() {
  const { account, googleLoginUrl } = useAuth();
  const router = useRouter();
  const searchParams = useSearchParams();
  const failed = searchParams.get("error") === "google";

  useEffect(() => {
    // A prior OAuth failure can leave its query string behind after an existing
    // account session is restored. Do not show a failure beside a signed-in state.
    if (account && failed) router.replace("/login");
  }, [account, failed, router]);

  return (
    <main className="auth-page">
      <section className="auth-story">
        <Link href="/" className="brand auth-brand">
          <Image
            src="/Inssura%20Kangaroo%20Shield%20Logo.png"
            width={150}
            height={75}
            alt="Insurra"
            className="brand-image"
          />
        </Link>
        <div>
          <span className="eyebrow">YOUR INSURANCE COMPANION</span>
          <h1>Clarity starts with one secure step.</h1>
          <p>Understand your coverage, preserve progress, and return at any time.</p>
          <Image
            src="/Winking%20Kangaroo%20Hugging%20a%20Heart.png"
            alt="Insurra Kangaroo Mascot Hugging a Heart"
            width={245}
            height={217}
            className="auth-mascot"
          />
        </div>
        <ul>
          <li>
            <CheckCircle2 /> One unified account for your entire insurance journey
          </li>
          <li>
            <CheckCircle2 /> Explicit, revocable privacy and consent permissions
          </li>
          <li>
            <CheckCircle2 /> Evidence-grounded policy facts, zero invented claims
          </li>
        </ul>
      </section>
      <section className="auth-panel">
        <div className="auth-box">
          <Link href="/" className="back-link">
            <ArrowLeft /> Back
          </Link>
          <span className="auth-lock">
            <LockKeyhole />
          </span>
          <h2>{account ? "You are signed in." : "Welcome to Insurra."}</h2>
          <p>
            {account
              ? `Continue as ${account.display_name ?? account.email ?? "Member"}.`
              : "Sign in with Google or your credentials to access your private workspace."}
          </p>
          {failed && (
            <div className="alert error" role="alert">
              Google sign-in was not completed. Please try again.
            </div>
          )}
          {account ? (
            <Button asChild size="lg" className="auth-button">
              <Link href="/account">
                Open Workspace <ArrowRight />
              </Link>
            </Button>
          ) : (
            <>
              <Button asChild variant="outline" size="lg" className="auth-button google-button">
                <a href={googleLoginUrl}>
                  <span className="google-mark">G</span> Continue with Google
                </a>
              </Button>
              <div className="auth-divider">
                <span>or</span>
              </div>
              <Button asChild size="lg" className="auth-button">
                <Link href="/auth">
                  Email & Password Sign In <ArrowRight />
                </Link>
              </Button>
            </>
          )}
          <div className="auth-divider">
            <span>or</span>
          </div>
          <Button asChild variant="ghost" size="lg" className="auth-button">
            <Link href="/#demo">Continue with Demo Persona</Link>
          </Button>
          <p className="auth-terms">
            By continuing, you agree to Insurra Terms of Use and Privacy Policy.
          </p>
        </div>
      </section>
    </main>
  );
}
