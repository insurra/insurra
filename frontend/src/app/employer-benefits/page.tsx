"use client";

import Link from "next/link";
import { Briefcase, ChevronRight, Info } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function EmployerBenefitsPage() {
  return (
    <div className="protection-screen">
      <nav aria-label="Breadcrumb" className="protection-breadcrumb">
        <Link href="/protection">My Protection</Link>
        <ChevronRight size={14} className="breadcrumb-separator" />
        <span aria-current="page">Employer Benefits</span>
      </nav>

      <div className="page-heading">
        <div>
          <div className="eyebrow">CORPORATE &amp; WORKPLACE COVERAGE</div>
          <h1>Employer Benefits</h1>
          <p>Manage corporate group health plans, corporate subsidies, and workplace policy limits.</p>
        </div>
      </div>

      <div className="card account-empty" style={{ margin: "28px 0", padding: "48px 24px" }}>
        <Briefcase size={44} color="#0ea58a" />
        <h2>Workplace Coverage Integration</h2>
        <p>
          Corporate benefits and employer health fund coordination are being verified against country rules.
          You can upload your corporate policy certificate in Documents to extract your current benefit schedule.
        </p>
        <div style={{ display: "flex", gap: "12px", marginTop: "14px" }}>
          <Button asChild>
            <Link href="/documents">
              Upload Employer Policy
            </Link>
          </Button>
          <Button asChild variant="outline">
            <Link href="/protection">
              Back to My Protection
            </Link>
          </Button>
        </div>
      </div>

      <div className="alert info">
        <Info size={17} />
        Employer benefits can be coordinated with personal policies or national health plans (e.g. KAPJ in Indonesia or Private Health extras in Australia).
      </div>
    </div>
  );
}
