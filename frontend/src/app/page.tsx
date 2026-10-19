"use client";

import "./landing.css";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useSession } from "@/lib/session";
import { HomeNav } from "@/components/home/home-nav";
import { HeroSection } from "@/components/home/hero-section";
import { FeatureGrid } from "@/components/home/feature-grid";
import { BottomSection } from "@/components/home/bottom-section";
import { HomeFooter } from "@/components/home/home-footer";
import type { PersonaType } from "@/components/home/scenario-preview";

export default function Home() {
  const router = useRouter();
  const { selectPersona } = useSession();
  const [persona, setPersona] = useState<PersonaType>("student");
  const [isLaunching, setIsLaunching] = useState(false);
  const [demoError, setDemoError] = useState<string | null>(null);

  const handleLaunchLiveDemo = async () => {
    if (isLaunching) return;
    setIsLaunching(true);
    setDemoError(null);
    const ok = await selectPersona(persona === "corporate" ? "sinta" : "raka");
    if (ok) {
      router.push("/home");
    } else {
      setDemoError("Demo could not be launched. Please try again.");
      setIsLaunching(false);
    }
  };

  return (
    <div className="lp-root">
      <HomeNav onSelectPersona={(p) => setPersona(p)} />
      <main>
        <HeroSection
          persona={persona}
          onSelectPersona={(p) => setPersona(p)}
          onOpenDemo={() => void handleLaunchLiveDemo()}
          demoLoading={isLaunching}
          demoError={demoError}
        />
        <FeatureGrid />
        <BottomSection />
      </main>
      <HomeFooter />

    </div>
  );
}
