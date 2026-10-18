"use client";

import Image from "next/image";
import Link from "next/link";
import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertCircle,
  ArrowRight,
  Briefcase,
  Check,
  Compass,
  Edit2,
  Globe2,
  Heart,
  MapPin,
  Shield,
  ShieldCheck,
  Sparkles,
  Users,
  Wallet,
} from "lucide-react";
import { api } from "@/lib/api/client";
import type { components } from "@/lib/api/types.gen";
import { useAuth } from "@/lib/auth";
import "@/app/onboarding/onboarding.css";

type ProfileData = components["schemas"]["ProfileData"];
type AccountProfileState = components["schemas"]["AccountProfileState"];
type CountryCode = "AU" | "ID";

const DEFAULT_PROFILE: ProfileData = {
  display_name: "",
  residence_context: "ABROAD",
  country_code: "AU",
  city: "Melbourne",
  occupation: "STUDENT",
  timezone: "Australia/Melbourne",
  employment_status: "",
  institution_name: "",
  dependents: ["None"],
  owned_coverage: ["OSHC"],
  priorities: ["low_cost", "speed"],
  budget_range: "$50 - $150 / month",
  currency: "AUD",
  arrival_date: "2026-02-15",
  visa_expiry_date: "2027-03-15",
};

const AUSTRALIA_CITIES = ["Melbourne", "Sydney", "Brisbane", "Perth", "Adelaide", "Canberra"];
const INDONESIA_CITIES = ["Jakarta", "Surabaya", "Bandung", "Medan", "Yogyakarta", "Bali"];

const DEPENDENT_OPTIONS = [
  { id: "None", label: "Hanya Saya Sendiri", sub: "Tidak ada tanggungan tambahan" },
  { id: "Spouse", label: "Pasangan", sub: "Suami / Istri / Partner" },
  { id: "Children", label: "Anak", sub: "Tanggungan anak di bawah 18 tahun" },
  { id: "Parents", label: "Orang Tua", sub: "Orang tua atau tanggungan keluarga senior" },
];

const COVERAGE_OPTIONS_AU = [
  { id: "OSHC", label: "OSHC (Student Health Cover)", sub: "Wajib visa pelajar Australia (Condition 8501)" },
  { id: "EMPLOYER", label: "Employer Corporate Health", sub: "Asuransi kesehatan kelompok dari kantor" },
  { id: "PERSONAL_HEALTH", label: "Australian Private Health", sub: "Polis asuransi swasta Australia (Medibank, Bupa, dll)" },
  { id: "TRAVEL", label: "Travel Insurance", sub: "Polis asuransi perjalanan internasional aktif" },
  { id: "BPJS", label: "BPJS Kesehatan (Indonesia)", sub: "Keanggotaan aktif JKN dari Indonesia" },
  { id: "NOT_SURE", label: "Belum Yakin / Perlu Dicek", sub: "Saya belum tahu persis rincian polis saya" },
];

const COVERAGE_OPTIONS_ID = [
  { id: "BPJS", label: "BPJS Kesehatan (JKN)", sub: "Jaminan Kesehatan Nasional wajib Indonesia" },
  { id: "EMPLOYER", label: "Asuransi Kantor / Korporat", sub: "Fasilitas rawat inap dan rawat jalan perusahaan" },
  { id: "PERSONAL_HEALTH", label: "Asuransi Kesehatan Swasta", sub: "Polis individu murni atau unit link swasta" },
  { id: "TRAVEL", label: "Asuransi Perjalanan", sub: "Asuransi proteksi perjalanan luar atau domestik" },
  { id: "LIFE", label: "Asuransi Jiwa & Keluarga", sub: "Proteksi jiwa dan antisipasi risiko masa depan" },
  { id: "NOT_SURE", label: "Belum Yakin / Perlu Dicek", sub: "Saya ingin Insurra memeriksa dokumen saya nanti" },
];

const PRIORITY_OPTIONS = [
  {
    id: "low_cost",
    label: "Biaya Lebih Hemat",
    sub: "Meminimalkan out-of-pocket expenses dan biaya excess saat berobat",
  },
  {
    id: "speed",
    label: "Kecepatan & Kemudahan",
    sub: "Klaim kilat, direct billing di klinik/RS, dan proses serba digital",
  },
  {
    id: "choice",
    label: "Bebas Pilih Dokter & RS",
    sub: "Bebas konsultasi dengan dokter spesialis dan rawat inap di RS swasta",
  },
  {
    id: "family",
    label: "Keamanan Keluarga",
    sub: "Jaminan kesehatan lengkap dan perlindungan terpadu untuk keluarga",
  },
];

const BUDGET_OPTIONS_AU = [
  { id: "none", label: "Tidak ada anggaran tambahan", sub: "Hanya mengandalkan asuransi yang ada" },
  { id: "low", label: "< $50 / bulan", sub: "Proteksi dasar untuk menutup celah selisih" },
  { id: "mid", label: "$50 - $150 / bulan", sub: "Perlindungan seimbang rawat jalan dan gigi" },
  { id: "high", label: "$150 - $300 / bulan", sub: "Asuransi komprehensif rawat inap RS swasta" },
  { id: "top", label: "> $300 / bulan", sub: "Proteksi kelas premium dan limit tinggi" },
];

const BUDGET_OPTIONS_ID = [
  { id: "none", label: "Tidak ada anggaran tambahan", sub: "Hanya mengandalkan asuransi yang ada" },
  { id: "low", label: "< Rp 250.000 / bulan", sub: "Proteksi dasar pelengkap BPJS" },
  { id: "mid", label: "Rp 250.000 - Rp 750.000 / bulan", sub: "Perlindungan rawat jalan & gigi standar" },
  { id: "high", label: "Rp 750.000 - Rp 1.500.000 / bulan", sub: "Asuransi kesehatan swasta reguler" },
  { id: "top", label: "> Rp 1.500.000 / bulan", sub: "Proteksi kamar VIP & limit tahunan tinggi" },
];

interface SuggestedDocItem {
  id: string;
  kind: string;
  title: string;
  badge: "Wajib Visa" | "Wajib" | "Rekomendasi";
  badgeType: "visa-req" | "mandatory" | "recommended";
  description: string;
  sourceUrl?: string;
  sourceLabel?: string;
}

function AccountOnboardingContent() {
  const { account, token } = useAuth();

  // Profile data
  const [profile, setProfile] = useState<ProfileData>(DEFAULT_PROFILE);
  const [, setBusy] = useState(false);
  const [draftSaved, setDraftSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Conversational chat state
  // Steps: 1: Residence, 2: Location/Status/Visa, 3: Dependents, 4: Coverage, 5: Priorities, 6: Budget, 7: Finished
  const [activeStep, setActiveStep] = useState<number>(1);
  const [, setMaxCompletedStep] = useState<number>(0);
  const [isTyping, setIsTyping] = useState<boolean>(false);
  const [isCompleted, setIsCompleted] = useState<boolean>(false);

  // Temporary state for multi-input steps (Step 2, 3, 4, 5)
  const [customCity, setCustomCity] = useState<string>("");
  const [tempArrivalDate, setTempArrivalDate] = useState<string>("2026-02-15");
  const [tempVisaExpiry, setTempVisaExpiry] = useState<string>("2027-03-15");

  const chatScrollRef = useRef<HTMLDivElement>(null);

  // Load existing profile / draft on start
  useEffect(() => {
    if (!token) return;
    let active = true;

    api
      .request("get", "/api/v1/account/profile", {
        headers: { Authorization: `Bearer ${token}` },
      })
      .then((state: AccountProfileState) => {
        if (!active) return;
        const source = (state.profile ?? state.draft ?? {}) as Partial<ProfileData>;
        const isAU = (source.country_code || "AU") === "AU";
        const merged: ProfileData = {
          ...DEFAULT_PROFILE,
          ...source,
          display_name: source.display_name || account?.display_name || "",
          residence_context: source.residence_context || (isAU ? "ABROAD" : "DOMESTIC"),
          country_code: (source.country_code as CountryCode) || "AU",
          city: source.city || (isAU ? "Melbourne" : "Jakarta"),
          currency: (source.currency as "AUD" | "IDR") || (isAU ? "AUD" : "IDR"),
          arrival_date: source.arrival_date || (isAU ? "2026-02-15" : null),
          visa_expiry_date: source.visa_expiry_date || (isAU ? "2027-03-15" : null),
        };
        setProfile(merged);
        setCustomCity(merged.city || "");
        if (merged.arrival_date) setTempArrivalDate(merged.arrival_date);
        if (merged.visa_expiry_date) setTempVisaExpiry(merged.visa_expiry_date);

        if (state.completed) {
          setIsCompleted(true);
          setActiveStep(7);
          setMaxCompletedStep(6);
        }
      })
      .catch(() => {
        // Fallback default profile
      });

    return () => {
      active = false;
    };
  }, [token, account?.display_name]);

  // Auto-scroll chat to bottom
  const scrollToBottom = () => {
    setTimeout(() => {
      if (chatScrollRef.current) {
        chatScrollRef.current.scrollTo({
          top: chatScrollRef.current.scrollHeight,
          behavior: "smooth",
        });
      }
    }, 80);
  };

  useEffect(() => {
    scrollToBottom();
  }, [activeStep, isTyping, isCompleted]);

  // Autosave draft helper
  async function persistDraft(updatedData: ProfileData) {
    if (!token) return;
    try {
      await api.request("put", "/api/v1/account/profile/draft", {
        headers: { Authorization: `Bearer ${token}` },
        body: updatedData,
      });
      setDraftSaved(true);
      setTimeout(() => setDraftSaved(false), 2000);
    } catch {
      // Ignore background draft errors
    }
  }

  // Final submission of profile to complete onboarding
  async function completeOnboarding(profileToSave = profile) {
    setError(null);
    setBusy(true);

    try {
      if (token) {
        await api.request("put", "/api/v1/account/profile", {
          headers: { Authorization: `Bearer ${token}` },
          body: profileToSave,
        });
      }
      setIsCompleted(true);
      setActiveStep(7);
      setMaxCompletedStep(6);
      return true;
    } catch (cause: unknown) {
      setError(cause instanceof Error ? cause.message : "Gagal menyimpan profil. Silakan coba lagi.");
      return false;
    } finally {
      setBusy(false);
    }
  }

  // Derived suggested documents list based on profile
  const suggestedDocsList = useMemo<SuggestedDocItem[]>(() => {
    const list: SuggestedDocItem[] = [];
    const isAU = profile.country_code === "AU";
    const isStudent = profile.occupation === "STUDENT";
    const owned = profile.owned_coverage || [];
    const notSure = owned.includes("NOT_SURE");

    if (isAU) {
      if (isStudent || owned.includes("OSHC")) {
        list.push({
          id: "oshc_certificate",
          kind: "oshc_certificate",
          title: "Sertifikat Polis OSHC",
          badge: "Wajib Visa",
          badgeType: "visa-req",
          description: "Dari provider OSHC Australia (Allianz, Medibank, Bupa, NIB, atau AHM)",
          sourceUrl: "https://immi.homeaffairs.gov.au/visas/getting-a-visa/visa-listing/student-500#Eligibility",
          sourceLabel: "Kepatuhan Visa Condition 8501",
        });
      }

      list.push({
        id: "visa_grant_notice",
        kind: "visa_grant_notice",
        title: "Visa Grant Notice",
        badge: "Rekomendasi",
        badgeType: "recommended",
        description: "Surat pemberitahuan resmi izin visa dari Department of Home Affairs Australia",
      });

      if (owned.includes("OSHC") || isStudent) {
        list.push({
          id: "policy_booklet",
          kind: "policy_booklet",
          title: "Buku Panduan Polis OSHC",
          badge: "Rekomendasi",
          badgeType: "recommended",
          description: "Memuat daftar jadwal manfaat (MBS), rincian limit, dan pengecualian rawat inap",
        });
      }

      if (owned.includes("EMPLOYER")) {
        list.push({
          id: "employer_policy",
          kind: "employer_policy",
          title: "Sertifikat Polis Kantor (Employer)",
          badge: "Rekomendasi",
          badgeType: "recommended",
          description: "Dari portal HR atau buku manfaat asuransi korporat perusahaan",
        });
      }

      if (notSure && list.length < 3) {
        list.push({
          id: "other",
          kind: "other",
          title: "Kartu Asuransi / Bukti Pendaftaran",
          badge: "Rekomendasi",
          badgeType: "recommended",
          description: "Foto atau kartu digital apa pun untuk diverifikasi oleh sistem Insurra",
        });
      }
    } else {
      // Indonesia
      list.push({
        id: "bpjs_card",
        kind: "bpjs_card",
        title: "Kartu BPJS Kesehatan",
        badge: "Wajib",
        badgeType: "mandatory",
        description: "Dari aplikasi Mobile JKN (screenshot kartu digital) atau scan kartu fisik",
        sourceUrl: "https://bpjs-kesehatan.go.id",
        sourceLabel: "Portal Resmi BPJS Kesehatan",
      });

      if (owned.includes("EMPLOYER")) {
        list.push({
          id: "employer_policy",
          kind: "employer_policy",
          title: "Polis Asuransi Kantor / Korporat",
          badge: "Rekomendasi",
          badgeType: "recommended",
          description: "Dari portal HR perusahaan atau buku panduan manfaat karyawan",
        });
      }

      if (owned.includes("PERSONAL_HEALTH") || owned.includes("LIFE")) {
        list.push({
          id: "policy_booklet",
          kind: "policy_booklet",
          title: "Buku Polis Asuransi Pribadi",
          badge: "Rekomendasi",
          badgeType: "recommended",
          description: "Dari aplikasi asuransi atau surat konfirmasi polis yang masih aktif",
        });
      }

      if (notSure && list.length < 3) {
        list.push({
          id: "insurance_card",
          kind: "insurance_card",
          title: "Kartu Asuransi / Bukti Kepesertaan",
          badge: "Rekomendasi",
          badgeType: "recommended",
          description: "Foto dokumen asuransi apa pun yang Anda miliki saat ini",
        });
      }
    }

    return list.slice(0, 4);
  }, [profile]);

  // Transition to next chat step with typing delay
  function advanceToStep(nextStep: number, updatedProfile: ProfileData) {
    setProfile(updatedProfile);
    void persistDraft(updatedProfile);
    setMaxCompletedStep((prev) => Math.max(prev, activeStep));

    setIsTyping(true);
    setTimeout(() => {
      setIsTyping(false);
      setActiveStep(nextStep);
    }, 450);
  }

  // Handlers for interactive questions:

  // Step 1: Residence Context
  function handleSelectResidence(context: "ABROAD" | "DOMESTIC") {
    const isAbroad = context === "ABROAD";
    const targetCountry: CountryCode = isAbroad ? "AU" : "ID";
    const updated: ProfileData = {
      ...profile,
      residence_context: context,
      country_code: targetCountry,
      city: isAbroad ? "Melbourne" : "Jakarta",
      currency: isAbroad ? "AUD" : "IDR",
      timezone: isAbroad ? "Australia/Melbourne" : "Asia/Jakarta",
      owned_coverage: isAbroad ? ["OSHC"] : ["BPJS"],
      budget_range: isAbroad ? "$50 - $150 / month" : "Rp 250.000 - Rp 750.000 / month",
    };
    advanceToStep(2, updated);
  }

  // Step 2: Location & Status
  function handleSubmitStep2() {
    const finalCity = (customCity || profile.city || (profile.country_code === "AU" ? "Melbourne" : "Jakarta")).trim();
    if (!finalCity) {
      setError("Silakan tentukan kota tempat tinggalmu.");
      return;
    }

    if (profile.residence_context === "ABROAD" && profile.country_code === "AU") {
      if (!tempArrivalDate || !tempVisaExpiry) {
        setError("Tanggal kedatangan dan masa berlaku visa wajib diisi untuk domisili luar negeri.");
        return;
      }
      if (tempVisaExpiry <= tempArrivalDate) {
        setError("Masa berlaku visa harus lebih lama dari tanggal kedatangan.");
        return;
      }
    }

    setError(null);
    const updated: ProfileData = {
      ...profile,
      city: finalCity,
      arrival_date: profile.residence_context === "ABROAD" ? tempArrivalDate : null,
      visa_expiry_date: profile.residence_context === "ABROAD" ? tempVisaExpiry : null,
    };
    advanceToStep(3, updated);
  }

  // Step 3: Dependents
  function toggleDependent(id: string) {
    let current = [...(profile.dependents || [])];
    if (id === "None") {
      current = ["None"];
    } else {
      current = current.filter((item) => item !== "None");
      if (current.includes(id)) {
        current = current.filter((item) => item !== id);
      } else {
        current.push(id);
      }
      if (current.length === 0) current = ["None"];
    }
    setProfile({ ...profile, dependents: current });
  }

  function handleSubmitStep3() {
    if (!profile.dependents || profile.dependents.length === 0) {
      setError("Silakan pilih siapa saja yang ikut dilindungi.");
      return;
    }
    setError(null);
    advanceToStep(4, profile);
  }

  // Step 4: Existing Coverage
  function toggleCoverage(id: string) {
    let current = [...(profile.owned_coverage || [])];
    if (id === "NOT_SURE") {
      current = ["NOT_SURE"];
    } else {
      current = current.filter((item) => item !== "NOT_SURE");
      if (current.includes(id)) {
        current = current.filter((item) => item !== id);
      } else {
        current.push(id);
      }
      if (current.length === 0) current = ["NOT_SURE"];
    }
    setProfile({ ...profile, owned_coverage: current });
  }

  function handleSubmitStep4() {
    if (!profile.owned_coverage || profile.owned_coverage.length === 0) {
      setError("Silakan pilih asuransi yang kamu miliki, atau pilih 'Belum yakin'.");
      return;
    }
    setError(null);
    advanceToStep(5, profile);
  }

  // Step 5: Priorities
  function togglePriority(id: string) {
    let current = [...(profile.priorities || [])];
    if (current.includes(id)) {
      current = current.filter((item) => item !== id);
    } else {
      if (current.length >= 2) {
        current = [current[1], id];
      } else {
        current.push(id);
      }
    }
    setProfile({ ...profile, priorities: current });
  }

  function handleSubmitStep5() {
    setError(null);
    advanceToStep(6, profile);
  }

  // Step 6: Budget
  async function handleSelectBudget(budgetLabel: string) {
    const updated: ProfileData = {
      ...profile,
      budget_range: budgetLabel,
    };
    setProfile(updated);
    setIsTyping(true);
    await completeOnboarding(updated);
    setIsTyping(false);
  }

  // Jump back to re-answer a step
  function jumpToStep(targetStep: number) {
    setError(null);
    setActiveStep(targetStep);
  }

  // Display Name of User
  const userName = profile.display_name || account?.display_name || "Sahabat Insurra";
  const isAU = profile.country_code === "AU";

  // Calculate live completion percentage
  const completionPct = Math.min(100, Math.round(((Math.min(activeStep, 6) - 1) / 5) * 100));

  return (
    <div className="chat-onboarding-shell">
      {/* ---------------- Topbar ---------------- */}
      <header className="chat-topbar">
        <Link href="/" className="onboarding-brand">
          <Image
            src="/Inssura Kangaroo Shield Logo.png"
            alt="Insurra"
            width={120}
            height={36}
            className="onboarding-brand-logo"
            priority
          />
        </Link>

        {/* Companion Online Badge */}
        <div className="chat-companion-badge">
          <Image
            src="/protection-mascot.png"
            alt="Insurra AI"
            width={32}
            height={32}
            className="chat-companion-avatar"
          />
          <div className="chat-companion-info">
            <span className="chat-companion-name">Insurra AI Guide</span>
            <span className="chat-companion-status">
              <span className="status-dot-pulse" /> Pendamping Aktif
            </span>
          </div>
        </div>

        {/* Progress Tracker */}
        <div className="chat-progress-wrap">
          <div className="chat-progress-track" title={`${completionPct}% Selesai`}>
            <div className="chat-progress-fill" style={{ width: `${isCompleted ? 100 : Math.max(16, completionPct)}%` }} />
          </div>
          <span className="chat-step-label">
            {isCompleted ? "Lengkap" : `Langkah ${Math.min(activeStep, 6)} dari 6`}
          </span>
          <Link href="/dashboard" className="onboarding-exit-btn">
            Lewati ke Dashboard
          </Link>
        </div>
      </header>

      {/* ---------------- Main Content Grid ---------------- */}
      <main className="chat-main-grid">
        {/* Left Column: Interactive Chat Stream */}
        <section className="chat-stream-container">
          <div className="chat-stream-header">
            <div className="chat-stream-title">
              <Compass size={17} color="#0ea58a" />
              <span>Percakapan Konteks Perlindungan</span>
              <span className="badge">Interaktif</span>
            </div>
            {draftSaved && <span className="autosave-pill"><Check size={12} /> Tersimpan otomatis</span>}
          </div>

          <div className="chat-messages-scroll" ref={chatScrollRef}>
            {/* ---------------- TURN 1: GREETING & RESIDENCE CONTEXT ---------------- */}
            <div className="chat-turn assistant-turn">
              <div className="assistant-message-row">
                <div className="assistant-avatar-wrap">
                  <Image src="/protection-mascot.png" alt="Insurra AI" width={40} height={40} className="assistant-avatar-img" />
                </div>
                <div className="assistant-bubble">
                  <p>
                    Halo <strong>{userName}</strong>! 👋 Senang bertemu denganmu.
                  </p>
                  <p>
                    Saya adalah asisten AI yang akan mendampingi perlindungan asuransimu. Agar kita bisa menyesuaikan aturan visa, jenis dokumen, dan manfaat klaim tanpa ribet, yuk kita lengkapi profilmu lewat obrolan singkat ini.
                  </p>
                  <p>
                    Pertama, <strong>di mana kamu tinggal saat ini?</strong>
                  </p>
                </div>
              </div>

              {/* Active Interactive Box for Step 1 */}
              {activeStep === 1 && (
                <div className="chat-interactive-box">
                  <div className="interactive-title">Pilih Wilayah Tempat Tinggalmu:</div>
                  <div className="chat-options-grid">
                    <button
                      type="button"
                      className={`chat-option-card ${profile.residence_context === "ABROAD" ? "selected" : ""}`}
                      onClick={() => handleSelectResidence("ABROAD")}
                    >
                      <span className="chat-option-icon">🌏</span>
                      <div className="chat-option-text">
                        <h4>Tinggal di Luar Negeri</h4>
                        <p>Australia (OSHC, Visa Condition 8501, kepatuhan imigrasi internasional)</p>
                      </div>
                    </button>
                    <button
                      type="button"
                      className={`chat-option-card ${profile.residence_context === "DOMESTIC" ? "selected" : ""}`}
                      onClick={() => handleSelectResidence("DOMESTIC")}
                    >
                      <span className="chat-option-icon">🏠</span>
                      <div className="chat-option-text">
                        <h4>Tinggal di Indonesia</h4>
                        <p>Domestik (Integrasi BPJS Kesehatan / JKN, koordinasi manfaat KAPJ, asuransi swasta)</p>
                      </div>
                    </button>
                  </div>
                </div>
              )}
            </div>

            {/* User Response to Step 1 */}
            {activeStep > 1 && (
              <div className="chat-turn user-turn">
                <div className="user-message-row">
                  <div className="user-bubble">
                    <span>
                      {profile.residence_context === "ABROAD" ? "🌏 Saya tinggal di Luar Negeri (Australia)" : "🏠 Saya tinggal di Indonesia"}
                    </span>
                    <div className="user-bubble-actions">
                      <button type="button" className="btn-edit-answer" onClick={() => jumpToStep(1)}>
                        <Edit2 size={11} /> Ubah
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* ---------------- TURN 2: LOCATION, STATUS & VISA ---------------- */}
            {activeStep >= 2 && (
              <div className="chat-turn assistant-turn">
                <div className="assistant-message-row">
                  <div className="assistant-avatar-wrap">
                    <Image src="/protection-mascot.png" alt="Insurra AI" width={40} height={40} className="assistant-avatar-img" />
                  </div>
                  <div className="assistant-bubble">
                    <p>
                      {profile.residence_context === "ABROAD" ? (
                        <>Bagus! Tinggal di luar negeri memerlukan perhatian ekstra pada ketentuan visa dan perlindungan medis. Di kota mana kamu berbasis di Australia?</>
                      ) : (
                        <>Bagus! Untuk di Indonesia, sistem akan menyesuaikan koordinasi manfaat BPJS Kesehatan dan asuransi swasta. Di kota mana kamu berdomisili?</>
                      )}
                    </p>
                    <p>Silakan lengkapi kota dan status aktivitasmu di bawah ya:</p>
                  </div>
                </div>

                {activeStep === 2 && (
                  <div className="chat-interactive-box">
                    <div className="interactive-title">Detail Lokasi & Status:</div>

                    {/* Country Toggle */}
                    <div className="chat-inline-field">
                      <label>Negara Tempat Tinggal:</label>
                      <div className="chat-pills-row">
                        <button
                          type="button"
                          className={`chat-pill-btn ${profile.country_code === "AU" ? "active" : ""}`}
                          onClick={() => {
                            setProfile({ ...profile, country_code: "AU", currency: "AUD", city: "Melbourne" });
                            setCustomCity("Melbourne");
                          }}
                        >
                          🇦🇺 Australia (AU)
                        </button>
                        <button
                          type="button"
                          className={`chat-pill-btn ${profile.country_code === "ID" ? "active" : ""}`}
                          onClick={() => {
                            setProfile({ ...profile, country_code: "ID", currency: "IDR", city: "Jakarta" });
                            setCustomCity("Jakarta");
                          }}
                        >
                          🇮🇩 Indonesia (ID)
                        </button>
                      </div>
                    </div>

                    {/* City quick pills + Input */}
                    <div className="chat-inline-field">
                      <label>Kota Tempat Tinggal:</label>
                      <div className="chat-pills-row">
                        {(isAU ? AUSTRALIA_CITIES : INDONESIA_CITIES).map((c) => (
                          <button
                            key={c}
                            type="button"
                            className={`chat-pill-btn ${(customCity || profile.city) === c ? "active" : ""}`}
                            onClick={() => {
                              setCustomCity(c);
                              setProfile({ ...profile, city: c });
                            }}
                          >
                            {c}
                          </button>
                        ))}
                      </div>
                      <input
                        type="text"
                        placeholder="Atau ketik nama kota lainnya..."
                        className="chat-text-input"
                        value={customCity}
                        onChange={(e) => {
                          setCustomCity(e.target.value);
                          setProfile({ ...profile, city: e.target.value });
                        }}
                      />
                    </div>

                    {/* Occupation Pills */}
                    <div className="chat-inline-field">
                      <label>Status / Pekerjaan Utama:</label>
                      <div className="chat-pills-row">
                        <button
                          type="button"
                          className={`chat-pill-btn ${profile.occupation === "STUDENT" ? "active" : ""}`}
                          onClick={() => setProfile({ ...profile, occupation: "STUDENT" })}
                        >
                          🎓 Pelajar / Mahasiswa (Student)
                        </button>
                        <button
                          type="button"
                          className={`chat-pill-btn ${profile.occupation === "EMPLOYEE" ? "active" : ""}`}
                          onClick={() => setProfile({ ...profile, occupation: "EMPLOYEE" })}
                        >
                          💼 Profesional / Pekerja
                        </button>
                        <button
                          type="button"
                          className={`chat-pill-btn ${profile.occupation === "OTHER" ? "active" : ""}`}
                          onClick={() => setProfile({ ...profile, occupation: "OTHER" })}
                        >
                          🧳 Working Holiday / Lainnya
                        </button>
                      </div>
                    </div>

                    {/* Visa Dates (if Abroad) */}
                    {profile.residence_context === "ABROAD" && isAU && (
                      <div style={{ background: "#f8fafb", padding: "14px", borderRadius: "14px", border: "1px solid #e5eff2", marginBottom: "16px" }}>
                        <div style={{ fontSize: "12px", fontWeight: "750", color: "#16584a", marginBottom: "8px", display: "flex", alignItems: "center", gap: "6px" }}>
                          <Shield size={14} /> Tanggal Kedatangan & Masa Berlaku Visa (Kepatuhan Condition 8501):
                        </div>
                        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px" }}>
                          <div>
                            <label style={{ fontSize: "11px", color: "#556c80" }}>Tanggal Kedatangan di Australia:</label>
                            <input
                              type="date"
                              className="chat-text-input"
                              value={tempArrivalDate}
                              onChange={(e) => setTempArrivalDate(e.target.value)}
                            />
                          </div>
                          <div>
                            <label style={{ fontSize: "11px", color: "#556c80" }}>Tanggal Berakhir Visa:</label>
                            <input
                              type="date"
                              className="chat-text-input"
                              value={tempVisaExpiry}
                              onChange={(e) => setTempVisaExpiry(e.target.value)}
                            />
                          </div>
                        </div>
                      </div>
                    )}

                    {error && (
                      <div style={{ color: "#d93838", fontSize: "12.5px", marginBottom: "12px", display: "flex", alignItems: "center", gap: "6px" }}>
                        <AlertCircle size={15} /> {error}
                      </div>
                    )}

                    <button type="button" className="chat-submit-btn" onClick={handleSubmitStep2}>
                      Lanjut ke Tanggungan Keluarga <ArrowRight size={15} />
                    </button>
                  </div>
                )}
              </div>
            )}

            {/* User Response to Step 2 */}
            {activeStep > 2 && (
              <div className="chat-turn user-turn">
                <div className="user-message-row">
                  <div className="user-bubble">
                    <span>
                      📍 {profile.city}, {isAU ? "Australia 🇦🇺" : "Indonesia 🇮🇩"} · {profile.occupation}
                    </span>
                    {profile.residence_context === "ABROAD" && profile.visa_expiry_date && (
                      <span className="user-subtext">Visa aktif hingga: {profile.visa_expiry_date}</span>
                    )}
                    <div className="user-bubble-actions">
                      <button type="button" className="btn-edit-answer" onClick={() => jumpToStep(2)}>
                        <Edit2 size={11} /> Ubah
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* ---------------- TURN 3: DEPENDENTS ---------------- */}
            {activeStep >= 3 && (
              <div className="chat-turn assistant-turn">
                <div className="assistant-message-row">
                  <div className="assistant-avatar-wrap">
                    <Image src="/protection-mascot.png" alt="Insurra AI" width={40} height={40} className="assistant-avatar-img" />
                  </div>
                  <div className="assistant-bubble">
                    <p>
                      Dicatat! Sekarang mengenai orang terdekatmu. <strong>Siapa saja yang ikut dilindungi dalam tanggunganmu?</strong>
                    </p>
                    <p>
                      Kamu bisa memilih lebih dari satu jika ada pasangan, anak, atau orang tua yang tinggal bersamamu.
                    </p>
                  </div>
                </div>

                {activeStep === 3 && (
                  <div className="chat-interactive-box">
                    <div className="interactive-title">Pilih Anggota Keluarga yang Dilindungi:</div>
                    <div className="chat-options-grid">
                      {DEPENDENT_OPTIONS.map((dep) => {
                        const isSelected = (profile.dependents || []).includes(dep.id);
                        return (
                          <button
                            key={dep.id}
                            type="button"
                            className={`chat-option-card ${isSelected ? "selected" : ""}`}
                            onClick={() => toggleDependent(dep.id)}
                          >
                            <span className="chat-option-icon">
                              {dep.id === "None" ? "👤" : dep.id === "Spouse" ? "💍" : dep.id === "Children" ? "👶" : "👵"}
                            </span>
                            <div className="chat-option-text">
                              <h4>{dep.label}</h4>
                              <p>{dep.sub}</p>
                            </div>
                          </button>
                        );
                      })}
                    </div>

                    <div style={{ marginTop: "16px" }}>
                      <button type="button" className="chat-submit-btn" onClick={handleSubmitStep3}>
                        Konfirmasi Tanggungan <ArrowRight size={15} />
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* User Response to Step 3 */}
            {activeStep > 3 && (
              <div className="chat-turn user-turn">
                <div className="user-message-row">
                  <div className="user-bubble">
                    <span>
                      👨‍👩‍👧 {(profile.dependents || []).map((d) => (d === "None" ? "Hanya saya sendiri" : d === "Spouse" ? "Pasangan" : d === "Children" ? "Anak" : "Orang tua")).join(", ")}
                    </span>
                    <div className="user-bubble-actions">
                      <button type="button" className="btn-edit-answer" onClick={() => jumpToStep(3)}>
                        <Edit2 size={11} /> Ubah
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* ---------------- TURN 4: EXISTING COVERAGE ---------------- */}
            {activeStep >= 4 && (
              <div className="chat-turn assistant-turn">
                <div className="assistant-message-row">
                  <div className="assistant-avatar-wrap">
                    <Image src="/protection-mascot.png" alt="Insurra AI" width={40} height={40} className="assistant-avatar-img" />
                  </div>
                  <div className="assistant-bubble">
                    <p>
                      Sip! Berikutnya, <strong>asuransi apa saja yang sudah kamu miliki saat ini?</strong>
                    </p>
                    <p>
                      Pilih semua yang sedang aktif. Bila kamu belum yakin nomor atau jenis polisnya, pilih <em>Belum Yakin</em> dan Insurra akan membantumu memeriksa berkas nanti.
                    </p>
                  </div>
                </div>

                {activeStep === 4 && (
                  <div className="chat-interactive-box">
                    <div className="interactive-title">Pilih Asuransi yang Sudah Ada:</div>
                    <div className="chat-options-grid">
                      {(isAU ? COVERAGE_OPTIONS_AU : COVERAGE_OPTIONS_ID).map((cov) => {
                        const isSelected = (profile.owned_coverage || []).includes(cov.id);
                        return (
                          <button
                            key={cov.id}
                            type="button"
                            className={`chat-option-card ${isSelected ? "selected" : ""}`}
                            onClick={() => toggleCoverage(cov.id)}
                          >
                            <span className="chat-option-icon">
                              {cov.id === "OSHC" || cov.id === "BPJS" ? "🛡️" : cov.id === "EMPLOYER" ? "🏢" : cov.id === "TRAVEL" ? "✈️" : cov.id === "NOT_SURE" ? "❓" : "🩺"}
                            </span>
                            <div className="chat-option-text">
                              <h4>{cov.label}</h4>
                              <p>{cov.sub}</p>
                            </div>
                          </button>
                        );
                      })}
                    </div>

                    <div style={{ marginTop: "16px" }}>
                      <button type="button" className="chat-submit-btn" onClick={handleSubmitStep4}>
                        Simpan Asuransi & Lanjut <ArrowRight size={15} />
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* User Response to Step 4 */}
            {activeStep > 4 && (
              <div className="chat-turn user-turn">
                <div className="user-message-row">
                  <div className="user-bubble">
                    <span>
                      🛡️ {(profile.owned_coverage || []).join(", ")}
                    </span>
                    <div className="user-bubble-actions">
                      <button type="button" className="btn-edit-answer" onClick={() => jumpToStep(4)}>
                        <Edit2 size={11} /> Ubah
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* ---------------- TURN 5: PRIORITIES ---------------- */}
            {activeStep >= 5 && (
              <div className="chat-turn assistant-turn">
                <div className="assistant-message-row">
                  <div className="assistant-avatar-wrap">
                    <Image src="/protection-mascot.png" alt="Insurra AI" width={40} height={40} className="assistant-avatar-img" />
                  </div>
                  <div className="assistant-bubble">
                    <p>
                      Hampir selesai! <strong>Apa prioritas utama kamu saat membutuhkan proteksi kesehatan?</strong>
                    </p>
                    <p>Pilih hingga 2 hal yang paling krusial untukmu:</p>
                  </div>
                </div>

                {activeStep === 5 && (
                  <div className="chat-interactive-box">
                    <div className="interactive-title">Pilih Hingga 2 Prioritas:</div>
                    <div className="chat-options-grid">
                      {PRIORITY_OPTIONS.map((prio) => {
                        const isSelected = (profile.priorities || []).includes(prio.id);
                        return (
                          <button
                            key={prio.id}
                            type="button"
                            className={`chat-option-card ${isSelected ? "selected" : ""}`}
                            onClick={() => togglePriority(prio.id)}
                          >
                            <span className="chat-option-icon">
                              {prio.id === "low_cost" ? "💰" : prio.id === "speed" ? "⚡" : prio.id === "choice" ? "🏥" : "❤️"}
                            </span>
                            <div className="chat-option-text">
                              <h4>{prio.label}</h4>
                              <p>{prio.sub}</p>
                            </div>
                          </button>
                        );
                      })}
                    </div>

                    <div style={{ marginTop: "16px" }}>
                      <button type="button" className="chat-submit-btn" onClick={handleSubmitStep5}>
                        Lanjut ke Anggaran <ArrowRight size={15} />
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* User Response to Step 5 */}
            {activeStep > 5 && (
              <div className="chat-turn user-turn">
                <div className="user-message-row">
                  <div className="user-bubble">
                    <span>
                      🎯 {(profile.priorities || []).map((p) => PRIORITY_OPTIONS.find((opt) => opt.id === p)?.label || p).join(", ")}
                    </span>
                    <div className="user-bubble-actions">
                      <button type="button" className="btn-edit-answer" onClick={() => jumpToStep(5)}>
                        <Edit2 size={11} /> Ubah
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* ---------------- TURN 6: BUDGET RANGE ---------------- */}
            {activeStep >= 6 && (
              <div className="chat-turn assistant-turn">
                <div className="assistant-message-row">
                  <div className="assistant-avatar-wrap">
                    <Image src="/protection-mascot.png" alt="Insurra AI" width={40} height={40} className="assistant-avatar-img" />
                  </div>
                  <div className="assistant-bubble">
                    <p>
                      Pertanyaan terakhir! <strong>Berapa perkiraan anggaran bulanan tambahan yang ingin kamu alokasikan</strong> untuk menutup celah perlindungan kesehatan?
                    </p>
                  </div>
                </div>

                {activeStep === 6 && (
                  <div className="chat-interactive-box">
                    <div className="interactive-title">Pilih Kisaran Anggaran Bulanan:</div>
                    <div className="chat-options-grid">
                      {(isAU ? BUDGET_OPTIONS_AU : BUDGET_OPTIONS_ID).map((b) => {
                        const isSelected = profile.budget_range === b.label;
                        return (
                          <button
                            key={b.id}
                            type="button"
                            className={`chat-option-card ${isSelected ? "selected" : ""}`}
                            onClick={() => {
                              setProfile({ ...profile, budget_range: b.label });
                            }}
                          >
                            <span className="chat-option-icon">💵</span>
                            <div className="chat-option-text">
                              <h4>{b.label}</h4>
                              <p>{b.sub}</p>
                            </div>
                          </button>
                        );
                      })}
                    </div>

                    <div style={{ marginTop: "16px" }}>
                      <button
                        type="button"
                        className="chat-submit-btn"
                        onClick={() => void handleSelectBudget(profile.budget_range || (isAU ? "$50 - $150 / month" : "Rp 250.000 - Rp 750.000 / month"))}
                      >
                        Selesaikan Pemetaan & Rekomendasi <Sparkles size={15} />
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* User Response to Step 6 */}
            {activeStep >= 7 && (
              <div className="chat-turn user-turn">
                <div className="user-message-row">
                  <div className="user-bubble">
                    <span>💳 {profile.budget_range}</span>
                  </div>
                </div>
              </div>
            )}

            {/* ---------------- TYPING ANIMATION ---------------- */}
            {isTyping && (
              <div className="chat-turn assistant-turn">
                <div className="assistant-message-row">
                  <div className="assistant-avatar-wrap">
                    <Image src="/protection-mascot.png" alt="Insurra AI" width={40} height={40} className="assistant-avatar-img" />
                  </div>
                  <div className="typing-bubble">
                    <div className="typing-dot" />
                    <div className="typing-dot" />
                    <div className="typing-dot" />
                  </div>
                </div>
              </div>
            )}

            {/* ---------------- TURN 7: COMPLETION & SUGGESTED DOCS ---------------- */}
            {isCompleted && (
              <div className="chat-turn assistant-turn">
                <div className="assistant-message-row">
                  <div className="assistant-avatar-wrap">
                    <Image src="/protection-mascot.png" alt="Insurra AI" width={40} height={40} className="assistant-avatar-img" />
                  </div>
                  <div className="assistant-bubble" style={{ background: "#ffffff", border: "1.5px solid #a4ddce" }}>
                    <p>
                      🎉 <strong>Profil Perlindunganmu Berhasil Dipetakan!</strong>
                    </p>
                    <p>
                      Semua data telah tersimpan aman di database. Berdasarkan status domisili di <strong>{profile.city}, {isAU ? "Australia" : "Indonesia"}</strong>, berikut adalah berkas dokumen yang disarankan untuk diunggah agar Insurra bisa menganalisis isi polis, limit, dan masa tunggu secara otomatis:
                    </p>

                    {/* Suggested Docs List inside Chat Bubble */}
                    <div className="chat-docs-preview-list" style={{ marginTop: "14px" }}>
                      {suggestedDocsList.map((doc) => (
                        <div key={doc.id} className="chat-doc-preview-item">
                          <div>
                            <span className={`doc-card-badge ${doc.badgeType}`} style={{ marginBottom: "4px" }}>
                              {doc.badge}
                            </span>
                            <h5>{doc.title}</h5>
                            <p>{doc.description}</p>
                          </div>
                          <Link
                            href={`/documents?kind=${doc.kind}`}
                            className="chat-submit-btn"
                            style={{ padding: "8px 14px", fontSize: "12px", whiteSpace: "nowrap" }}
                          >
                            Unggah <ArrowRight size={13} />
                          </Link>
                        </div>
                      ))}
                    </div>

                    {/* Action buttons */}
                    <div className="chat-completion-actions">
                      <Link href="/dashboard" className="chat-submit-btn">
                        Lanjut ke Dashboard <ArrowRight size={15} />
                      </Link>
                      <Link href="/documents" className="onboarding-exit-btn">
                        Buka Ruang Dokumen (/documents)
                      </Link>
                      <button type="button" className="onboarding-exit-btn" onClick={() => jumpToStep(1)}>
                        Ulangi Pertanyaan
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
        </section>

        {/* Right Column: Live Protection Profile Sidebar */}
        <aside className="live-profile-card">
          <div className="live-card-head">
            <div className="live-user-snippet">
              <div className="live-user-avatar">
                {userName.charAt(0).toUpperCase()}
              </div>
              <div className="live-user-text">
                <h3>{userName}</h3>
                <p>{account?.email || "Akun Terverifikasi"}</p>
              </div>
            </div>
            <span className={`badge ${isCompleted ? "success" : "neutral"}`}>
              {isCompleted ? "Lengkap" : "Draft"}
            </span>
          </div>

          {/* Completion Progress Gauge */}
          <div className="live-completion-meter">
            <div className="meter-header">
              <span>Kelengkapan Konteks</span>
              <strong>{isCompleted ? "100%" : `${completionPct}%`}</strong>
            </div>
            <div className="meter-bar-track">
              <div className="meter-bar-fill" style={{ width: `${isCompleted ? 100 : Math.max(16, completionPct)}%` }} />
            </div>
          </div>

          {/* Real-time Profile Facts */}
          <div className="live-facts-list">
            <div className="live-fact-item">
              <span className="live-fact-label">
                <Globe2 size={15} /> Wilayah Domisili
              </span>
              <span className="live-fact-val">
                {profile.residence_context === "ABROAD" ? "Luar Negeri (AU)" : "Domestik (ID)"}
              </span>
            </div>

            <div className="live-fact-item">
              <span className="live-fact-label">
                <MapPin size={15} /> Kota & Negara
              </span>
              <span className="live-fact-val">
                {profile.city || "-"}{isAU ? " 🇦🇺" : " 🇮🇩"}
              </span>
            </div>

            <div className="live-fact-item">
              <span className="live-fact-label">
                <Briefcase size={15} /> Status / Profesi
              </span>
              <span className="live-fact-val">
                {profile.occupation || "-"}
              </span>
            </div>

            <div className="live-fact-item">
              <span className="live-fact-label">
                <Users size={15} /> Tanggungan
              </span>
              <span className="live-fact-val">
                {(profile.dependents || []).length ? (profile.dependents || []).join(", ") : "-"}
              </span>
            </div>

            <div className="live-fact-item">
              <span className="live-fact-label">
                <ShieldCheck size={15} /> Asuransi Dimiliki
              </span>
              <span className="live-fact-val">
                {(profile.owned_coverage || []).length ? (profile.owned_coverage || []).join(", ") : "-"}
              </span>
            </div>

            <div className="live-fact-item">
              <span className="live-fact-label">
                <Heart size={15} /> Prioritas
              </span>
              <span className="live-fact-val">
                {(profile.priorities || []).length ? (profile.priorities || []).join(", ") : "-"}
              </span>
            </div>

            <div className="live-fact-item">
              <span className="live-fact-label">
                <Wallet size={15} /> Anggaran
              </span>
              <span className="live-fact-val">
                {profile.budget_range || "-"}
              </span>
            </div>
          </div>

          {/* Footer note */}
          <div className="live-card-footer">
            <span>Privasi aman & data terenkripsi</span>
            <span className="autosave-pill">
              <Check size={12} /> Real-time
            </span>
          </div>
        </aside>
      </main>
    </div>
  );
}

export default function AccountOnboarding() {
  return (
    <Suspense fallback={<div className="narrow-page"><p>Memuat pendamping onboarding…</p></div>}>
      <AccountOnboardingContent />
    </Suspense>
  );
}
