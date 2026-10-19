"use client";

import "./landing.css";
import { useState } from "react";
import { HomeNav } from "@/components/home/home-nav";
import { HeroSection } from "@/components/home/hero-section";
import { DemoPersonas } from "@/components/home/demo-personas";
import { FeatureGrid } from "@/components/home/feature-grid";
import { BottomSection } from "@/components/home/bottom-section";
import { HomeFooter } from "@/components/home/home-footer";
import type { PersonaType } from "@/components/home/scenario-preview";

export default function Home() {
  const [persona, setPersona] = useState<PersonaType>("student");

  const scrollToDemo = () => {
    document.getElementById("demo")?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  return (
    <div className="lp-root">
      <HomeNav onSelectPersona={(p) => setPersona(p)} />
      <main>
        <HeroSection
          persona={persona}
          onSelectPersona={(p) => setPersona(p)}
          onOpenDemo={scrollToDemo}
        />
        <DemoPersonas />
        <FeatureGrid />
        <BottomSection />
      </main>
      <HomeFooter />
    </div>
  );
}
