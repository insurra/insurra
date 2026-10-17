"use client";

import "./landing.css";
import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api/client";
import type { components } from "@/lib/api/types.gen";
import { useSession } from "@/lib/session";
import { HomeNav } from "@/components/home/home-nav";
import { HeroSection } from "@/components/home/hero-section";
import { FeatureGrid } from "@/components/home/feature-grid";
import { BottomSection } from "@/components/home/bottom-section";
import { HomeFooter } from "@/components/home/home-footer";
import { DemoDialog } from "@/components/home/demo-dialog";
import type { PersonaType } from "@/components/home/scenario-preview";

type S = components["schemas"];

export default function Home() {
  const router = useRouter();
  const { selectPersona, loading: sessionLoading } = useSession();
  const [persona, setPersona] = useState<PersonaType>("student");
  const [isDemoOpen, setIsDemoOpen] = useState(false);
  const [personas, setPersonas] = useState<S["DemoPersona"][]>([]);

  useEffect(() => {
    let active = true;
    api
      .get("/api/v1/demo/personas")
      .then((list) => {
        if (active) setPersonas(list);
      })
      .catch(() => {
        // Fallback gracefully if API is temporarily unavailable
      });
    return () => {
      active = false;
    };
  }, []);

  const handleLaunchLiveDemo = async () => {
    const target =
      persona === "corporate"
        ? personas.find((p) => p.persona_id === "sinta") ?? personas[0]
        : personas.find((p) => p.persona_id === "raka") ?? personas[0];

    if (!target) {
      router.push("/dashboard");
      return;
    }

    const ok = await selectPersona(target.persona_id);
    if (ok) {
      setIsDemoOpen(false);
      router.push("/dashboard");
    }
  };

  return (
    <div className="lp-root">
      <HomeNav onSelectPersona={(p) => setPersona(p)} />
      <main>
        <HeroSection
          persona={persona}
          onSelectPersona={(p) => setPersona(p)}
          onOpenDemo={() => setIsDemoOpen(true)}
        />
        <FeatureGrid />
        <BottomSection />
      </main>
      <HomeFooter />

      <DemoDialog
        isOpen={isDemoOpen}
        onClose={() => setIsDemoOpen(false)}
        onLaunchLiveDemo={() => void handleLaunchLiveDemo()}
        liveDemoLoading={sessionLoading}
      />
    </div>
  );
}
