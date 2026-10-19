"use client";

import Link from "next/link";
import Image from "next/image";
import { ArrowRight, Lock, ShieldCheck, UserCheck } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { ScenarioPreview, PersonaType } from "./scenario-preview";

interface HeroSectionProps {
  persona: PersonaType;
  onSelectPersona: (p: PersonaType) => void;
  onOpenDemo: () => void;
}

export function HeroSection({
  persona,
  onSelectPersona,
  onOpenDemo,
}: HeroSectionProps) {
  const { account, loading } = useAuth();
  const signedIn = !loading && !!account;

  return (
    <section className="hero">
      <div className="hero-panorama-bg" aria-hidden="true">
        <Image
          src="/hero-panorama-natural.jpg"
          alt="Insurra Travel and Coverage Panorama"
          fill
          priority
          sizes="100vw"
          className="hero-bg-img"
        />
        <div className="hero-gradient-overlay" />
      </div>

      <div className="shell herogrid">
        <div className="copy">
          <div className="badge">
            <span className="spark" aria-hidden="true">✧</span> AI INSURANCE COMPANION
          </div>

          <h1>
            You have insurance.
            <em>Are you actually covered?</em>
          </h1>

          <p className="subtitle">
            From overseas visa compliance to corporate benefits and personal
            policies, Insurra unifies your coverage, uncovers hidden gaps, and
            guides your claims.
          </p>

          <div className="actions">
            {signedIn ? (
              <Link href="/home" className="primary">
                Open workspace <ArrowRight size={16} aria-hidden="true" />
              </Link>
            ) : (
              <Link href="/auth?action=register" className="primary">
                Get Started <ArrowRight size={16} aria-hidden="true" />
              </Link>
            )}
            <a
              href="#demo"
              className="secondary"
              onClick={(event) => {
                event.preventDefault();
                onOpenDemo();
              }}
            >
              Try Interactive Demo
            </a>
          </div>

          <div className="trust">
            <span>
              <Lock size={15} aria-hidden="true" /> Private by design
            </span>
            <span>
              <ShieldCheck size={15} aria-hidden="true" /> Evidence-based
            </span>
            <span>
              <UserCheck size={15} aria-hidden="true" /> You&apos;re in control
            </span>
          </div>
        </div>

        <ScenarioPreview
          persona={persona}
          onSelectPersona={onSelectPersona}
          onOpenDemo={onOpenDemo}
        />
      </div>

      <div className="hero-wave" aria-hidden="true">
        <svg viewBox="0 0 1440 60" fill="none" preserveAspectRatio="none">
          <path
            d="M0,22 C360,50 720,10 1080,35 C1260,48 1380,26 1440,22 L1440,60 L0,60 Z"
            fill="#ffffff"
          />
        </svg>
      </div>
    </section>
  );
}
