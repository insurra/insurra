"use client";

import Link from "next/link";
import Image from "next/image";
import { useEffect, useState, type FormEvent } from "react";
import {
  ChevronRight,
  Droplet,
  ExternalLink,
  Flame,
  Heart,
  HelpCircle,
  Info,
  MapPin,
  MessageSquare,
  PhoneCall,
  ShieldCheck,
  Siren,
  User,
  Wind,
} from "lucide-react";

import { useSession } from "@/lib/session";
import { getWorkflowUrl } from "@/lib/api/workflow-client";

interface EmergencyContact {
  service_code: string;
  label: string;
  phone_number: string;
  jurisdiction: string;
  verified: boolean;
}

interface EmergencyData {
  country_code: string;
  primary_emergency_number: string;
  contacts: EmergencyContact[];
  disclaimer?: string;
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

const EMERGENCY_SYMPTOMS = [
  {
    id: "chest_pain",
    title: "Severe chest pain",
    subtitle: "Heart attack risk",
    icon: Heart,
    color: "text-rose-600 bg-rose-50 border-rose-200",
  },
  {
    id: "breathing_difficulty",
    title: "Breathing difficulty",
    subtitle: "Trouble breathing",
    icon: Wind,
    color: "text-sky-600 bg-sky-50 border-sky-200",
  },
  {
    id: "major_bleeding",
    title: "Major bleeding",
    subtitle: "Uncontrolled bleeding",
    icon: Droplet,
    color: "text-red-600 bg-red-50 border-red-200",
  },
  {
    id: "head_injury",
    title: "Severe head injury",
    subtitle: "Loss of consciousness",
    icon: User,
    color: "text-indigo-600 bg-indigo-50 border-indigo-200",
  },
  {
    id: "allergic_reaction",
    title: "Severe allergic reaction",
    subtitle: "Facial swelling, trouble breathing",
    icon: Flame,
    color: "text-amber-600 bg-amber-50 border-amber-200",
  },
  {
    id: "other_symptom",
    title: "Other symptom",
    subtitle: "I'm not sure",
    icon: HelpCircle,
    color: "text-slate-600 bg-slate-50 border-slate-200",
  },
];

export default function EmergencyPage() {
  const { data: demoData } = useSession();
  const [country, setCountry] = useState<"CN" | "ID">("CN");
  const [data, setData] = useState<EmergencyData | null>(null);
  const [selectedSymptom, setSelectedSymptom] = useState<string>("chest_pain");
  const [customText, setCustomText] = useState("");
  const [triaging, setTriaging] = useState(false);
  const [triageResult, setTriageResult] = useState<TriageResult | null>(null);

  // Sync profile country via microtask to avoid cascading render warnings
  useEffect(() => {
    const profileCountry = demoData?.profile?.country_code;
    queueMicrotask(() => {
      if (profileCountry === "ID") {
        setCountry("ID");
      } else {
        setCountry("CN");
      }
    });
  }, [demoData]);

  // Load verified emergency contacts
  useEffect(() => {
    let active = true;
    fetch(getWorkflowUrl(`/api/v1/workflow/emergency/contacts?country_code=${country}`))
      .then((r) => r.json())
      .then((res) => {
        if (active) setData(res);
      })
      .catch(() => {
        // Safe fallback if server endpoint offline
        if (active) {
          setData({
            country_code: country,
            primary_emergency_number: country === "CN" ? "120" : "119",
            contacts:
              country === "CN"
                ? [
                    { service_code: "medical", label: "Emergency Medical Service (Ambulance)", phone_number: "120", jurisdiction: "CN", verified: true },
                    { service_code: "police", label: "Police", phone_number: "110", jurisdiction: "CN", verified: true },
                  ]
                : [
                    { service_code: "medical", label: "Pelayanan Medis Darurat (PSC 119)", phone_number: "119", jurisdiction: "ID", verified: true },
                    { service_code: "police", label: "Kepolisian (Polri)", phone_number: "110", jurisdiction: "ID", verified: true },
                  ],
          });
        }
      });

    return () => {
      active = false;
    };
  }, [country]);

  // Handle custom symptom triage
  const handleTriageSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!customText.trim()) return;
    setTriaging(true);
    try {
      const res = await fetch(getWorkflowUrl("/api/v1/workflow/emergency/triage"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: customText.trim(), country_code: country }),
      });
      const result: TriageResult = await res.json();
      setTriageResult(result);
    } catch {
      // Offline fallback: conservative safety check
      setTriageResult({
        has_red_flag: true,
        country_code: country,
        matched_flags: [{ flag_id: "offline_screen", category: "OFFLINE_SAFETY", guidance: "Seek immediate care." }],
        safety_flows: ["EMERGENCY_MEDICAL"],
        recommended_action: "INTERRUPT_NON_EMERGENCY_FLOW",
      });
    } finally {
      setTriaging(false);
    }
  };

  const primaryNumber = data?.primary_emergency_number || (country === "CN" ? "120" : "119");
  const countryName = country === "CN" ? "China" : "Indonesia";
  const cityName = country === "CN" ? "Beijing" : "Jakarta";
  const hospitalName = country === "CN" ? "Peking University Third Hospital" : "RS Cipto Mangunkusumo (RSCM)";

  return (
    <div className="min-h-screen bg-[#f8fafc] text-[#0f172a] pb-20 px-4 sm:px-6 lg:px-8 max-w-7xl mx-auto">
      {/* Page Header */}
      <div className="pt-6 pb-5 flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-200/60 mb-6">
        <div>
          <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight text-slate-900">
            Emergency Guidance
          </h1>
          <p className="text-sm text-slate-500 mt-0.5">
            Get immediate guidance for urgent or life-threatening situations. Your safety comes first.
          </p>
        </div>

        {/* Location toggle */}
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setCountry("CN")}
            className={`px-3 py-1.5 rounded-xl text-xs font-bold transition ${
              country === "CN"
                ? "bg-rose-600 text-white shadow-xs"
                : "bg-white border border-slate-200 text-slate-700 hover:bg-slate-50"
            }`}
          >
            🇨🇳 China (Beijing)
          </button>
          <button
            type="button"
            onClick={() => setCountry("ID")}
            className={`px-3 py-1.5 rounded-xl text-xs font-bold transition ${
              country === "ID"
                ? "bg-rose-600 text-white shadow-xs"
                : "bg-white border border-slate-200 text-slate-700 hover:bg-slate-50"
            }`}
          >
            🇮🇩 Indonesia (Jakarta)
          </button>
        </div>
      </div>

      {/* Main Hero Card */}
      <div className="bg-gradient-to-r from-rose-50/70 via-amber-50/30 to-white rounded-3xl border border-rose-100 p-6 sm:p-7 shadow-xs mb-8 flex flex-col sm:flex-row items-center justify-between gap-6 relative overflow-hidden">
        {/* Mascot Running with Emergency Kit */}
        <div className="shrink-0 relative w-32 h-32 sm:w-36 sm:h-36 drop-shadow-sm">
          <Image
            src="/mascot-emergency-doctor-trans.png"
            alt="Emergency Fox Mascot"
            fill
            className="object-contain"
            priority
          />
        </div>

        {/* Hero Content */}
        <div className="flex-1 space-y-3">
          <div className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-rose-100/70 border border-rose-200 text-rose-800 text-[11px] font-semibold">
            <span className="text-rose-600 font-bold">+</span>
            Emergency &amp; Safety Triage
          </div>

          <h2 className="text-xl sm:text-2xl font-extrabold text-slate-900 leading-snug">
            Are you experiencing a <span className="text-rose-600">medical emergency</span>?
          </h2>

          <p className="text-xs sm:text-sm text-slate-600 leading-relaxed max-w-xl">
            If this is urgent or life-threatening, get immediate guidance and contact emergency services. We&apos;ll help you find the right steps based on your location.
          </p>

          <div className="flex flex-wrap items-center gap-3 pt-1">
            <a
              href={`tel:${primaryNumber}`}
              className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-rose-600 hover:bg-rose-700 text-white font-bold text-xs shadow-xs transition"
            >
              <PhoneCall className="w-4 h-4" />
              Call Emergency Services ({primaryNumber})
            </a>
            <Link
              href="/pathways"
              className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-white border border-slate-200 hover:bg-slate-50 text-slate-700 font-semibold text-xs transition"
            >
              Not an emergency
              <span className="text-slate-400">·</span>
              Continue to Care Pathways
            </Link>
          </div>
        </div>

        {/* Right Info Box */}
        <div className="hidden lg:flex flex-col items-center justify-center p-4 rounded-2xl bg-white/80 border border-rose-100 shadow-2xs max-w-xs text-center space-y-2">
          <div className="w-10 h-10 rounded-full bg-rose-100 text-rose-600 grid place-items-center">
            <Siren className="w-5 h-5 animate-pulse" />
          </div>
          <p className="text-xs text-slate-700 font-medium">
            For life-threatening situations, call emergency services immediately.
          </p>
        </div>
      </div>

      {/* Main Grid: Check Emergency + Right Sidebar */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Left Column (8 cols): Check Emergency & Actions */}
        <div className="lg:col-span-8 space-y-6">
          {/* Section: Check if this is an emergency */}
          <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-xs space-y-4">
            <div>
              <h2 className="text-base font-bold text-slate-900">Check if this is an emergency</h2>
              <p className="text-xs text-slate-500 mt-0.5">
                Select what you&apos;re experiencing or describe your symptoms.
              </p>
            </div>

            {/* 6 Symptom Cards Grid */}
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              {EMERGENCY_SYMPTOMS.map((item) => {
                const Icon = item.icon;
                const isSelected = selectedSymptom === item.id;

                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => {
                      setSelectedSymptom(item.id);
                      setTriageResult(null);
                    }}
                    className={`p-3.5 rounded-2xl border text-left transition cursor-pointer flex flex-col justify-between h-28 ${
                      isSelected
                        ? "border-rose-500 bg-rose-50/40 ring-1 ring-rose-500/30"
                        : "border-slate-200 bg-slate-50/50 hover:bg-white hover:border-slate-300"
                    }`}
                  >
                    <div className={`w-8 h-8 rounded-xl grid place-items-center ${item.color}`}>
                      <Icon className="w-4 h-4" />
                    </div>
                    <div>
                      <span className="font-bold text-xs text-slate-900 block leading-tight">
                        {item.title}
                      </span>
                      <span className="text-[11px] text-slate-500 leading-tight">
                        {item.subtitle}
                      </span>
                    </div>
                  </button>
                );
              })}
            </div>

            {/* Custom Input when 'other_symptom' is selected */}
            {selectedSymptom === "other_symptom" && (
              <div className="space-y-2 pt-2">
                <form onSubmit={handleTriageSubmit} className="flex gap-2">
                  <input
                    type="text"
                    value={customText}
                    onChange={(e) => setCustomText(e.target.value)}
                    placeholder="Describe your symptoms in natural language (e.g. chest pain, severe dizziness)..."
                    className="flex-1 px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-900 focus:outline-none focus:ring-2 focus:ring-rose-500/20 focus:border-rose-500"
                  />
                  <button
                    type="submit"
                    disabled={triaging || !customText.trim()}
                    className="px-4 py-2.5 bg-rose-600 hover:bg-rose-700 disabled:bg-slate-300 text-white font-semibold text-xs rounded-xl shadow-xs transition cursor-pointer"
                  >
                    {triaging ? "Checking..." : "Check Safety"}
                  </button>
                </form>

                {triageResult && (
                  <div className={`p-3 rounded-xl text-xs border ${
                    triageResult.has_red_flag
                      ? "bg-rose-50 border-rose-200 text-rose-900"
                      : "bg-emerald-50 border-emerald-200 text-emerald-900"
                  }`}>
                    <p className="font-bold">
                      {triageResult.has_red_flag ? "Tanda bahaya terdeteksi" : "Tidak ada tanda bahaya darurat langsung"}
                    </p>
                    {triageResult.matched_flags.map((flag) => (
                      <p key={flag.flag_id} className="text-[11px] mt-0.5">{flag.guidance}</p>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Red Alert Banner: Likely emergency – Get immediate help */}
          <div className="bg-rose-50/90 border border-rose-200 rounded-2xl p-6 text-rose-950 shadow-xs space-y-5">
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 rounded-full bg-rose-100 text-rose-600 grid place-items-center shrink-0 mt-0.5">
                <Siren className="w-6 h-6 animate-pulse" />
              </div>
              <div>
                <h3 className="text-base font-bold text-rose-950">
                  Likely emergency – Get immediate help
                </h3>
                <p className="text-xs text-rose-800 mt-0.5">
                  Based on your input, this may be a medical emergency. Please follow these steps now.
                </p>
              </div>
            </div>

            {/* Steps & Emergency Contacts Grid */}
            <div className="grid grid-cols-1 md:grid-cols-12 gap-5 pt-1 items-start">
              {/* Left Column: Numbered Steps (7 cols) */}
              <div className="md:col-span-6 space-y-4">
                <div className="flex items-start gap-3">
                  <span className="w-6 h-6 rounded-full bg-rose-600 text-white font-bold text-xs grid place-items-center shrink-0 mt-0.5">
                    1
                  </span>
                  <div>
                    <span className="font-bold text-xs text-rose-950 block">Call emergency services</span>
                    <span className="text-[11px] text-rose-800 leading-tight">
                      Contact the local emergency number immediately.
                    </span>
                  </div>
                </div>

                <div className="flex items-start gap-3">
                  <span className="w-6 h-6 rounded-full bg-rose-600 text-white font-bold text-xs grid place-items-center shrink-0 mt-0.5">
                    2
                  </span>
                  <div>
                    <span className="font-bold text-xs text-rose-950 block">Go to the nearest emergency facility</span>
                    <span className="text-[11px] text-rose-800 leading-tight">
                      Get to the nearest hospital or emergency department.
                    </span>
                  </div>
                </div>

                <div className="flex items-start gap-3">
                  <span className="w-6 h-6 rounded-full bg-rose-600 text-white font-bold text-xs grid place-items-center shrink-0 mt-0.5">
                    3
                  </span>
                  <div>
                    <span className="font-bold text-xs text-rose-950 block">Inform your insurance (if possible)</span>
                    <span className="text-[11px] text-rose-800 leading-tight">
                      After you are safe, inform your insurer or use the claims center to prepare your claim.
                    </span>
                  </div>
                </div>
              </div>

              {/* Right Column: Emergency Contact Card (6 cols) */}
              <div className="md:col-span-6 bg-white rounded-2xl border border-rose-200/80 p-4 shadow-2xs space-y-3">
                <div className="flex items-center justify-between border-b border-slate-100 pb-2">
                  <div className="flex items-center gap-1.5">
                    <span className="text-base">{country === "CN" ? "🇨🇳" : "🇮🇩"}</span>
                    <div>
                      <span className="font-bold text-xs text-slate-900 block leading-tight">
                        Emergency Contact ({countryName})
                      </span>
                      <span className="text-[10px] text-slate-500">{cityName}, {countryName}</span>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => setCountry(country === "CN" ? "ID" : "CN")}
                    className="text-xs text-rose-600 font-semibold hover:underline"
                  >
                    Change
                  </button>
                </div>

                {/* Medical Emergency Row */}
                <div className="flex items-center justify-between py-1">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="text-lg font-black text-rose-600 tracking-tight">{primaryNumber}</span>
                      <span className="text-xs font-bold text-slate-800">
                        {country === "CN" ? "Emergency Medical Service" : "PSC Medis Darurat"}
                      </span>
                    </div>
                    <span className="text-[11px] text-slate-500 block">Ambulance and emergency care</span>
                  </div>
                  <a
                    href={`tel:${primaryNumber}`}
                    className="px-3.5 py-1.5 rounded-xl border border-rose-600 text-rose-600 hover:bg-rose-50 font-bold text-xs transition"
                  >
                    Call
                  </a>
                </div>

                {/* Police Row */}
                <div className="flex items-center justify-between py-1 border-t border-slate-100">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="text-lg font-black text-sky-700 tracking-tight">110</span>
                      <span className="text-xs font-bold text-slate-800">Police (if needed)</span>
                    </div>
                    <span className="text-[11px] text-slate-500 block">For accidents, safety, or security</span>
                  </div>
                  <a
                    href="tel:110"
                    className="px-3.5 py-1.5 rounded-xl border border-rose-600 text-rose-600 hover:bg-rose-50 font-bold text-xs transition"
                  >
                    Call
                  </a>
                </div>

                {/* Nearby Hospital */}
                <div className="pt-2 border-t border-slate-100 flex items-start justify-between text-xs">
                  <div className="flex items-start gap-2">
                    <MapPin className="w-4 h-4 text-rose-500 shrink-0 mt-0.5" />
                    <div>
                      <span className="font-semibold text-slate-900 block leading-tight">
                        Nearby Emergency Hospital
                      </span>
                      <span className="text-slate-600 font-medium block">{hospitalName}</span>
                      <span className="text-[11px] text-slate-400">2.1 km · 24-hour Emergency Department</span>
                    </div>
                  </div>
                  <a
                    href={`https://maps.google.com/?q=${encodeURIComponent(hospitalName + " " + cityName)}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-xs text-rose-600 font-semibold hover:underline shrink-0 inline-flex items-center gap-1"
                  >
                    View on Map
                    <ExternalLink className="w-3 h-3" />
                  </a>
                </div>
              </div>
            </div>
          </div>

          {/* Important Notice Callout */}
          <div className="p-4 rounded-2xl bg-amber-50/70 border border-amber-200/80 text-amber-950 flex items-start gap-3 shadow-2xs">
            <Info className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
            <div className="text-xs space-y-1">
              <span className="font-bold text-amber-900 block">Important</span>
              <p className="text-amber-800">• This guidance is for general information and does not replace professional medical advice.</p>
              <p className="text-amber-800">• If you are in a different country or city, emergency numbers may be different.</p>
              <p className="text-amber-800">• After you are safe, you can use INSSURA to check your coverage and prepare a claim.</p>
            </div>
          </div>
        </div>

        {/* Right Column (4 cols): Location, Insurance, Next Steps */}
        <div className="lg:col-span-4 space-y-4">
          {/* Card 1: Your Location */}
          <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-xs space-y-3">
            <div className="flex items-center justify-between border-b border-slate-100 pb-2.5">
              <h3 className="font-bold text-sm text-slate-900">Your Location</h3>
              <button
                type="button"
                onClick={() => setCountry(country === "CN" ? "ID" : "CN")}
                className="text-xs text-rose-600 font-semibold hover:underline"
              >
                Edit
              </button>
            </div>

            <div className="flex items-center gap-2 text-xs font-semibold text-slate-800">
              <MapPin className="w-4 h-4 text-rose-500" />
              <span>{cityName}, {countryName}</span>
            </div>

            {/* Map Preview Image */}
            <div className="relative h-28 w-full rounded-xl overflow-hidden border border-slate-200/70 bg-slate-100">
              <Image
                src="/assets/hospitals/map-preview-beijing.jpg"
                alt="Hospital Map Preview"
                fill
                className="object-cover"
              />
            </div>

            <div className="p-3 bg-slate-50 rounded-xl border border-slate-100 flex items-center justify-between">
              <div>
                <span className="font-bold text-xs text-slate-900 block line-clamp-1">{hospitalName}</span>
                <span className="text-[11px] text-slate-500">24-hour Emergency Department</span>
              </div>
              <ChevronRight className="w-4 h-4 text-slate-400" />
            </div>
          </div>

          {/* Card 2: Your Insurance Coverage */}
          <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-xs space-y-3">
            <div className="flex items-center justify-between border-b border-slate-100 pb-2.5">
              <h3 className="font-bold text-sm text-slate-900">Your Insurance Coverage</h3>
              <Link href="/protection" className="text-xs text-emerald-700 font-semibold hover:underline">
                View Details
              </Link>
            </div>

            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <ShieldCheck className="w-5 h-5 text-emerald-600" />
                <span className="font-bold text-xs text-slate-900">Emergency care</span>
              </div>
              <span className="px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800 text-[10px] font-bold">
                Covered
              </span>
            </div>

            <p className="text-xs text-slate-600 leading-relaxed">
              Emergency inpatient and outpatient care is covered under your plan. Subject to policy limits and conditions.
            </p>
          </div>

          {/* Card 3: What to Do Afterward */}
          <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-xs space-y-3">
            <h3 className="font-bold text-sm text-slate-900 border-b border-slate-100 pb-2.5">
              What to Do Afterward
            </h3>

            <div className="space-y-3 text-xs">
              <div className="flex items-start gap-3">
                <span className="w-5 h-5 rounded-full bg-slate-900 text-white font-bold text-[10px] grid place-items-center shrink-0 mt-0.5">
                  1
                </span>
                <div>
                  <span className="font-bold text-slate-900 block">Save medical records</span>
                  <span className="text-slate-500 text-[11px]">Keep invoices, discharge summary, and other documents.</span>
                </div>
              </div>

              <div className="flex items-start gap-3">
                <span className="w-5 h-5 rounded-full bg-slate-900 text-white font-bold text-[10px] grid place-items-center shrink-0 mt-0.5">
                  2
                </span>
                <div>
                  <span className="font-bold text-slate-900 block">Check your coverage</span>
                  <span className="text-slate-500 text-[11px]">Use My Protection to understand what is covered.</span>
                </div>
              </div>

              <div className="flex items-start gap-3">
                <span className="w-5 h-5 rounded-full bg-slate-900 text-white font-bold text-[10px] grid place-items-center shrink-0 mt-0.5">
                  3
                </span>
                <div>
                  <span className="font-bold text-slate-900 block">Prepare a claim</span>
                  <span className="text-slate-500 text-[11px]">Go to Claims Center to start your claim when ready.</span>
                </div>
              </div>
            </div>
          </div>

          {/* Card 4: Need more guidance? */}
          <Link
            href="/ask"
            className="p-4 rounded-2xl bg-white border border-sky-100 shadow-2xs hover:shadow-xs transition flex items-center justify-between group"
          >
            <div className="flex items-center gap-2.5 text-xs">
              <MessageSquare className="w-4 h-4 text-sky-600" />
              <div>
                <span className="font-bold text-slate-900 block">Need more guidance?</span>
                <span className="text-[11px] text-slate-500">Ask INSSURA about your situation</span>
              </div>
            </div>
            <ChevronRight className="w-4 h-4 text-slate-400 group-hover:text-slate-700 transition" />
          </Link>
        </div>
      </div>
    </div>
  );
}
