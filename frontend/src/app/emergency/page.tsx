"use client";

import Link from "next/link";
import { useEffect, useState, type FormEvent } from "react";
import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  FileText,
  HeartPulse,
  Phone,
  PhoneCall,
  ShieldAlert,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { useSession } from "@/lib/session";
import { getWorkflowUrl } from "@/lib/api/workflow-client";
import "./emergency.css";

interface Contact {
  service_code: string;
  label: string;
  phone_number: string;
  jurisdiction: string;
  verified: boolean;
}

interface EmergencyContactsData {
  country_code: string;
  primary_emergency_number: string;
  contacts: Contact[];
  mental_health_crisis_line?: {
    label: string;
    phone_number: string;
    available: string;
  };
  source_reference?: string;
  disclaimer: string;
}

interface TriageResult {
  has_red_flag: boolean;
  country_code: string;
  matched_flags: Array<{
    flag_id: string;
    category: string;
    guidance: string;
  }>;
  safety_flows: string[];
  recommended_action: string;
}

export default function EmergencyPage() {
  const { data: demoData } = useSession();
  const [country, setCountry] = useState<string>("CN");
  const [data, setData] = useState<EmergencyContactsData | null>(null);
  const [loading, setLoading] = useState(true);

  // Triage state
  const [symptomText, setSymptomText] = useState("");
  const [triageResult, setTriageResult] = useState<TriageResult | null>(null);
  const [triaging, setTriaging] = useState(false);

  useEffect(() => {
    // Default country from user profile if available
    const profileCountry = demoData?.profile?.country_code;
    if (profileCountry === "ID" || profileCountry === "AU" || profileCountry === "CN") {
      void Promise.resolve().then(() => setCountry(profileCountry));
    }
  }, [demoData]);

  useEffect(() => {
    let active = true;
    void Promise.resolve().then(() => {
      if (active) setLoading(true);
      fetch(getWorkflowUrl(`/api/v1/workflow/emergency/contacts?country_code=${country}`))
        .then((r) => r.json())
        .then((res) => {
          if (active) setData(res);
        })
        .catch((err) => console.error("Error fetching emergency contacts:", err))
        .finally(() => {
          if (active) setLoading(false);
        });
    });

    return () => {
      active = false;
    };
  }, [country]);

  const handleTriageSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!symptomText.trim()) return;
    setTriaging(true);
    try {
      const res = await fetch(getWorkflowUrl("/api/v1/workflow/emergency/triage"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: symptomText.trim(), country_code: country }),
      });
      const result: TriageResult = await res.json();
      setTriageResult(result);
    } catch (err) {
      console.error("Triage error:", err);
    } finally {
      setTriaging(false);
    }
  };

  return (
    <main className="emergency-workspace">
      <div className="emergency-heading">
        <h1>Emergency Guidance & Crisis Lines</h1>
        <p>Your life, safety, and health come first. Never delay medical care for claim preparation or insurance verification.</p>
      </div>

      {/* Critical Alert Banner */}
      <section className="emergency-alert" role="alert">
        <AlertTriangle size={36} aria-hidden="true" />
        <div>
          <h2>If this is a life-threatening medical emergency, call immediately.</h2>
          <p>
            Dial local emergency medical services or proceed directly to the nearest hospital emergency room. INSURRA does not require prior insurance pre-authorization for critical life-saving care.
          </p>
        </div>
      </section>

      {/* Country Switcher */}
      <div className="bg-white border border-slate-200 rounded-2xl p-4 shadow-sm mb-6 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <span className="text-xs font-bold uppercase tracking-wider text-slate-500">
            Select Country / Territory:
          </span>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => { setCountry("CN"); setTriageResult(null); }}
              className={`px-4 py-1.5 text-xs font-bold rounded-lg transition-all cursor-pointer ${
                country === "CN" ? "bg-teal-700 text-white shadow" : "bg-slate-100 text-slate-700 hover:bg-slate-200"
              }`}
            >
              China (CN)
            </button>
            <button
              type="button"
              onClick={() => { setCountry("ID"); setTriageResult(null); }}
              className={`px-4 py-1.5 text-xs font-bold rounded-lg transition-all cursor-pointer ${
                country === "ID" ? "bg-teal-700 text-white shadow" : "bg-slate-100 text-slate-700 hover:bg-slate-200"
              }`}
            >
              Indonesia (ID)
            </button>
            <button
              type="button"
              onClick={() => { setCountry("AU"); setTriageResult(null); }}
              className={`px-4 py-1.5 text-xs font-bold rounded-lg transition-all cursor-pointer ${
                country === "AU" ? "bg-teal-700 text-white shadow" : "bg-slate-100 text-slate-700 hover:bg-slate-200"
              }`}
            >
              Australia (AU)
            </button>
          </div>
        </div>
        <span className="inline-flex items-center gap-1.5 text-xs font-medium text-emerald-800 bg-emerald-50 border border-emerald-200 px-3 py-1 rounded-full">
          <CheckCircle2 size={13} className="text-emerald-600" />
          Source verified against national communications authorities
        </span>
      </div>

      <div className="emergency-grid">
        {/* Card 1: Verified Direct Emergency Numbers */}
        <section className="emergency-card">
          <div className="flex items-center justify-between mb-2">
            <div className="emergency-icon">
              <PhoneCall size={24} aria-hidden="true" />
            </div>
            <span className="text-[11px] font-bold uppercase tracking-wider px-2.5 py-1 rounded-full bg-rose-50 text-rose-700 border border-rose-200">
              Step 1 · Immediate Dispatch
            </span>
          </div>
          <h2>Official Emergency Contacts</h2>
          <p className="text-sm text-slate-500 mb-4">
            Tap any number below to dial emergency dispatch directly from your mobile device.
          </p>

          <div className="space-y-3">
            {loading ? (
              <div className="p-6 text-center text-xs text-slate-500">Loading verified emergency contacts...</div>
            ) : !data?.contacts || data.contacts.length === 0 ? (
              <div
                className="p-4 bg-slate-50 rounded-xl border border-slate-200 text-xs text-slate-600"
                data-testid="emergency-contacts-empty"
              >
                <span className="font-bold text-slate-800">Not available.</span> Verified emergency numbers are not available for this territory. Call local emergency services immediately.
              </div>
            ) : (
              data.contacts.map((item) => (
              <div
                key={item.service_code}
                className="flex items-center justify-between p-3.5 bg-slate-50 rounded-xl border border-slate-200 hover:border-teal-500 transition-colors"
              >
                <div>
                  <div className="font-bold text-slate-900 text-sm">{item.label}</div>
                  <div className="text-xs text-slate-400">{item.jurisdiction}</div>
                </div>
                <a
                  href={`tel:${item.phone_number}`}
                  className="inline-flex items-center gap-1.5 px-4 py-2 bg-rose-600 hover:bg-rose-700 text-white text-sm font-extrabold rounded-lg shadow-sm transition-all"
                >
                  <Phone size={14} /> {item.phone_number}
                </a>
              </div>
            )))}

            {data?.mental_health_crisis_line ? (
              <div className="p-3.5 bg-indigo-50/70 rounded-xl border border-indigo-200 mt-4">
                <div className="flex items-center justify-between">
                  <div>
                    <div className="font-bold text-indigo-950 text-sm">
                      {data.mental_health_crisis_line.label}
                    </div>
                    <div className="text-xs text-indigo-700">
                      {data.mental_health_crisis_line.available}
                    </div>
                  </div>
                  <a
                    href={`tel:${data.mental_health_crisis_line.phone_number}`}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-indigo-700 hover:bg-indigo-800 text-white text-xs font-bold rounded-lg"
                  >
                    <Phone size={12} /> {data.mental_health_crisis_line.phone_number}
                  </a>
                </div>
              </div>
            ) : (
              <div className="p-3.5 bg-slate-50 rounded-xl border border-slate-200 mt-4 text-xs text-slate-600">
                <span className="font-bold text-slate-800">Crisis line: Not available</span> (no verified official crisis hotline in KB for this territory; contact local emergency services).
              </div>
            )}
          </div>
        </section>

        {/* Card 2: Multilingual Red-Flag Triage */}
        <section className="emergency-card">
          <div className="flex items-center justify-between mb-2">
            <div className="emergency-icon">
              <HeartPulse size={24} aria-hidden="true" />
            </div>
            <span className="text-[11px] font-bold uppercase tracking-wider px-2.5 py-1 rounded-full bg-teal-50 text-teal-800 border border-teal-200">
              Step 2 · Symptom Triage
            </span>
          </div>
          <h2>Immediate Red-Flag Symptom Check</h2>
          <p className="text-sm text-slate-500 mb-3">
            Type or select symptoms in English, Bahasa Indonesia, or 中文 to check for critical safety red flags.
          </p>

          <div className="flex flex-wrap gap-1.5 mb-3">
            {[
              "Severe chest pain & shortness of breath",
              "Sesak napas mendadak & nyeri dada",
              "胸口剧痛 / 呼吸困难",
              "High fever with confusion",
            ].map((chip) => (
              <button
                key={chip}
                type="button"
                onClick={() => setSymptomText(chip)}
                className="text-[11px] font-medium px-2.5 py-1 rounded-full bg-slate-100 hover:bg-teal-50 hover:text-teal-800 text-slate-700 border border-slate-200 transition-colors cursor-pointer"
              >
                + {chip}
              </button>
            ))}
          </div>

          <form onSubmit={handleTriageSubmit} className="space-y-3 mb-4">
            <textarea
              rows={3}
              placeholder="e.g. severe chest pain and shortness of breath / sesak napas / 胸口剧痛"
              value={symptomText}
              onChange={(e) => setSymptomText(e.target.value)}
              className="w-full p-3 bg-slate-50 border border-slate-200 rounded-xl text-sm outline-none focus:bg-white focus:border-teal-700"
            />
            <Button
              type="submit"
              disabled={triaging || !symptomText.trim()}
              className="w-full bg-teal-700 hover:bg-teal-800 text-white font-semibold"
            >
              {triaging ? "Evaluating Safety..." : "Check Symptoms for Red Flags"}
            </Button>
          </form>

          {triageResult && (
            <div
              className={`p-4 rounded-xl border ${
                triageResult.has_red_flag
                  ? "bg-rose-50 border-rose-300 text-rose-900"
                  : "bg-emerald-50 border-emerald-200 text-emerald-900"
              }`}
            >
              {triageResult.has_red_flag ? (
                <div>
                  <div className="flex items-center gap-2 font-extrabold text-sm mb-1 text-rose-700">
                    <ShieldAlert size={18} /> CRITICAL RED FLAG DETECTED
                  </div>
                  <p className="text-xs mb-2">
                    {triageResult.matched_flags.map((f) => f.guidance).join(" ")}
                  </p>
                  <p className="text-xs font-bold">
                    Do not delay care. Call {data?.primary_emergency_number || "emergency services"} right now.
                  </p>
                </div>
              ) : (
                <div className="flex items-center gap-2 text-xs font-semibold">
                  <CheckCircle2 size={16} className="text-emerald-600" />
                  No immediate critical red flags matched. If you feel unwell or unsure, seek a doctor promptly.
                </div>
              )}
            </div>
          )}
        </section>

        {/* Card 3: Post-Stabilization Guidance */}
        <section className="emergency-card emergency-after">
          <div className="flex items-center justify-between mb-2">
            <div className="emergency-icon">
              <FileText size={24} aria-hidden="true" />
            </div>
            <span className="text-[11px] font-bold uppercase tracking-wider px-2.5 py-1 rounded-full bg-slate-100 text-slate-700 border border-slate-200">
              Step 3 · Post-Care Claim Handoff
            </span>
          </div>
          <h2>After You Are Safe: Hospital Documents to Collect</h2>
          <p className="text-sm text-slate-600 leading-relaxed mb-4">
            Once you have received emergency care and your condition is stable, ask the hospital billing desk for these 3 documents so INSURRA can prepare your claim:
          </p>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-5">
            <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-200">
              <div className="text-xs font-bold text-slate-900 mb-1">1. Official Invoice / Fapiao</div>
              <p className="text-xs text-slate-600 m-0">
                Request official stamped hospital invoices or electronic medical Fapiao (电子发票).
              </p>
            </div>
            <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-200">
              <div className="text-xs font-bold text-slate-900 mb-1">2. Medical &amp; ER Discharge Notes</div>
              <p className="text-xs text-slate-600 m-0">
                Obtain doctor outpatient diagnosis records or emergency room discharge summaries.
              </p>
            </div>
            <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-200">
              <div className="text-xs font-bold text-slate-900 mb-1">3. Itemized Pharmacy Receipts</div>
              <p className="text-xs text-slate-600 m-0">
                Keep itemized breakdown lists, prescription pharmacy receipts, and payment slips.
              </p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <Button asChild variant="outline" size="sm">
              <Link href="/claims">
                Return to Claims Center <ArrowLeft size={14} className="ml-1 rotate-180" />
              </Link>
            </Button>
            <Button asChild variant="outline" size="sm">
              <Link href="/pathways">
                Compare Non-Emergency Pathways
              </Link>
            </Button>
          </div>
        </section>
      </div>
    </main>
  );
}
