"use client";

import Link from "next/link";
import Image from "next/image";
import { LogOut } from "lucide-react";
import { useAuth } from "@/lib/auth";

interface HomeNavProps {
  onSelectPersona?: (persona: "student" | "corporate") => void;
}

export function HomeNav({ onSelectPersona }: HomeNavProps) {
  const { account, logout, loading } = useAuth();
  const signedIn = !loading && !!account;
  const firstName = (
    account?.display_name ??
    account?.email?.split("@")[0] ??
    ""
  ).split(" ")[0];

  return (
    <header className="shell nav" id="top">
      <Link href="#top" className="brand" aria-label="INSSURA home">
        <Image
          src="/mascot-logo.png"
          alt="Inssura · Your AI Insurance Companion"
          width={1774}
          height={887}
          className="brand-lockup"
          priority
        />
      </Link>

      <nav className="navlinks" aria-label="Main navigation">
        <a href="#features">What it does</a>
        <a
          href="#scenarios"
          onClick={() => onSelectPersona?.("student")}
        >
          For Students
        </a>
        <a
          href="#scenarios"
          onClick={() => onSelectPersona?.("corporate")}
        >
          For Professionals
        </a>
        <a href="#privacy">Privacy</a>
      </nav>

      <div className="navend">
        <span className="lang">🌐&nbsp; EN⌄</span>
        {signedIn ? (
          <>
            <Link href="/home" className="login user-chip">
              {firstName ? `${firstName}'s workspace` : "Workspace"}
            </Link>
            <button
              type="button"
              className="login-ghost"
              onClick={() => void logout()}
              title="Log out"
            >
              <LogOut size={16} aria-hidden="true" />
            </button>
          </>
        ) : (
          <Link href="/auth" className="login">
            Log in
          </Link>
        )}
      </div>
    </header>
  );
}
