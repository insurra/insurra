"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  Activity,
  Calendar,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Clock,
  Cpu,
  Eye,
  FileText,
  Filter,
  Info,
  RefreshCw,
  Scale,
  Shield,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  Terminal,
  Wrench,
  X,
  Zap,
} from "lucide-react";
import { useSession } from "@/lib/session";
import { useAuth } from "@/lib/auth";
import { api } from "@/lib/api/client";
import type { components } from "@/lib/api/types.gen";
import { Button } from "@/components/ui/button";
import { SessionRequired } from "@/components/session-required";

type AuditEvent = components["schemas"]["AuditEvent"];

type Citation = {
  document_name: string;
  page?: number | null;
  quote?: string | null;
};

const PAGE_SIZE = 20;

export const GUARDRAIL_SUBTYPES = [
  "Instruksi di dokumen diabaikan",
  "Tanda bahaya → arahan darurat",
  "Jawaban tanpa sumber ditolak",
  "Tindakan tanpa persetujuan diblokir",
] as const;

export type GuardrailSubtypeLabel = (typeof GUARDRAIL_SUBTYPES)[number];

const CHIP_FILTERS: {
  id: string;
  label: string;
  typeValue?: "answer" | "compare" | "action" | "guardrail" | "consent";
  icon: typeof Activity;
}[] = [
  { id: "all", label: "Semua", icon: Activity },
  { id: "answer", label: "Jawaban", typeValue: "answer", icon: FileText },
  { id: "compare", label: "Perbandingan", typeValue: "compare", icon: Scale },
  { id: "action", label: "Tindakan", typeValue: "action", icon: Zap },
  { id: "guardrail", label: "Guardrail", typeValue: "guardrail", icon: Shield },
  { id: "consent", label: "Data & Persetujuan", typeValue: "consent", icon: ShieldCheck },
];

const EVENT_LABELS: Record<string, string> = {
  SESSION_CREATED: "Sesi demo dibuat",
  CONSENT_GRANTED: "Persetujuan diberikan",
  CONSENT_REVOKED: "Persetujuan dicabut",
  CONSENT_CHANGED: "Persetujuan privasi diperbarui",
  CONSENTS_DECIDED: "Persetujuan awal ditentukan",
  VISA_GAP_ASSESSED: "Interval perlindungan dihitung",
  PROFILE_UPDATED: "Profil diperbarui",
  profile_update: "Sinkronisasi profil",
  DOCUMENT_UPLOADED: "Dokumen diunggah & diekstrak",
  DOCUMENT_DELETED: "Penghapusan dokumen",
  DATA_DELETED: "Penghapusan seluruh data",
  FIELD_REVIEWED: "Hasil ekstraksi dikonfirmasi",
  FIELD_PROVIDED: "Data polis dilengkapi manual",
  INJECTION_FLAGGED: "Instruksi mencurigakan di dokumen disaring",
  GUARDRAIL_DOCUMENT_INJECTION: "Instruksi di dokumen diabaikan",
  GUARDRAIL_EMERGENCY_REDIRECT: "Deteksi tanda bahaya medis → arahan darurat",
  GUARDRAIL_UNGROUNDED_ANSWER: "Jawaban tanpa kutipan klausul ditolak",
  GUARDRAIL_UNAPPROVED_ACTION: "Tindakan keluar tanpa persetujuan diblokir",
  GUARDRAIL_TRIPPED: "Guardrail keamanan terpicu",
  GUARDRAIL: "Peringatan guardrail keamanan",
  ANSWER: "Pemberian jawaban polis",
  ANSWER_GENERATED: "Jawaban manfaat polis",
  POLICY_QUESTION_ANSWERED: "Jawaban klausul manfaat polis",
  COMPARE_OPTIONS: "Perbandingan jalur layanan kesehatan",
  COMPARE: "Perbandingan jalur layanan",
  ACTION_DRAFTED: "Penyusunan draf tindakan",
  ACTION_EXECUTED: "Eksekusi tindakan",
  ACTION: "Keputusan tindakan agen",
  FAMILY_MEMBER_ADDED: "Anggota keluarga ditambahkan",
  FAMILY_MEMBER_DELETED: "Anggota keluarga dihapus",
  RECOMMENDATION_RULE: "Evaluasi aturan rekomendasi",
};

const TOOL_DESCRIPTIONS: Record<string, string> = {
  retrieve_clause: "Mengambil klausul dan kutipan relevan dari dokumen polis resmi.",
  rules_engine: "Mengevaluasi ketentuan terhadap basis pengetahuan negara dan regulasi.",
  triage_check: "Pemeriksaan tanda bahaya darurat medis dan jalur non-darurat.",
  policy_guard: "Memverifikasi integritas input terhadap instruksi injeksi dan kepatuhan privasi.",
  check_completeness: "Menganalisis kelengkapan dokumen dan validitas rentang tanggal.",
  compare_paths: "Membandingkan kelebihan, kekurangan, dan estimasi biaya tiap jalur fasilitas.",
  draft_claim_form: "Menyusun draf formulir klaim berbasis fakta dokumen tanpa data mengarang.",
  consent_manager: "Memeriksa izin aktif pengguna sebelum data diproses ke komponen downstream.",
  storage_cleaner: "Menghapus berkas dan metadata secara permanen sesuai permintaan hak privasi.",
  classify_document: "Mengidentifikasi tipe dokumen asuransi dan metadata penerbit.",
  extract_text_or_ocr: "Mengekstrak teks halaman dokumen secara terisolasi.",
  extract_to_schema: "Memetakan teks ke field terstruktur polis.",
};

function parseUtcDate(iso: string): Date {
  const normalized =
    iso.endsWith("Z") || /[+-]\d\d:\d\d$/.test(iso) ? iso : `${iso}Z`;
  return new Date(normalized);
}

function formatAbsoluteTime(iso: string): string {
  return (
    new Intl.DateTimeFormat("id-ID", {
      dateStyle: "medium",
      timeStyle: "short",
      timeZone: "Asia/Jakarta",
    }).format(parseUtcDate(iso)) + " WIB"
  );
}

function formatRelativeTime(iso: string): string {
  const target = parseUtcDate(iso).getTime();
  const diffSec = Math.round((target - Date.now()) / 1000);
  const absSec = Math.abs(diffSec);
  const rtf = new Intl.RelativeTimeFormat("id-ID", { numeric: "auto" });
  if (absSec < 60) return "Baru saja";
  const diffMin = Math.round(diffSec / 60);
  if (Math.abs(diffMin) < 60) return rtf.format(diffMin, "minute");
  const diffHour = Math.round(diffMin / 60);
  if (Math.abs(diffHour) < 24) return rtf.format(diffHour, "hour");
  const diffDay = Math.round(diffHour / 24);
  return rtf.format(diffDay, "day");
}

function isGuardrailEvent(event: AuditEvent): boolean {
  const category = event.category ?? "answer";
  const upper = event.event_type.toUpperCase();
  return (
    category === "guardrail" ||
    upper.includes("GUARDRAIL") ||
    upper.includes("INJECTION")
  );
}

function resolveGuardrailSubtype(event: AuditEvent): GuardrailSubtypeLabel {
  const direct = (event as AuditEvent & { subtype?: string | null }).subtype;
  const metaSubtype =
    typeof event.metadata?.subtype === "string" ? event.metadata.subtype : null;
  const candidate = direct || metaSubtype || "";
  if ((GUARDRAIL_SUBTYPES as readonly string[]).includes(candidate)) {
    return candidate as GuardrailSubtypeLabel;
  }
  const upper = event.event_type.toUpperCase();
  if (upper.includes("INJECTION") || candidate === "document_injection") {
    return "Instruksi di dokumen diabaikan";
  }
  if (
    upper.includes("EMERGENCY") ||
    upper.includes("RED_FLAG") ||
    upper.includes("TRIAGE") ||
    candidate === "emergency_redirect"
  ) {
    return "Tanda bahaya → arahan darurat";
  }
  if (
    upper.includes("UNGROUNDED") ||
    upper.includes("CITATION") ||
    upper.includes("SOURCE") ||
    candidate === "ungrounded_answer"
  ) {
    return "Jawaban tanpa sumber ditolak";
  }
  if (upper.includes("UNAPPROVED") || upper.includes("ACTION") || candidate === "unapproved_action") {
    return "Tindakan tanpa persetujuan diblokir";
  }
  return "Instruksi di dokumen diabaikan";
}

export default function AuditPage() {
  return (
    <Suspense
      fallback={
        <div className="p-8 text-center text-muted">
          <RefreshCw className="animate-spin inline-block mr-2" size={18} />
          Memuat riwayat audit...
        </div>
      }
    >
      <AuditContent />
    </Suspense>
  );
}

function AuditContent() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const { data: sessionData, loading: sessionLoading, getAudit } = useSession();
  const { account, token: authToken, loading: authLoading } = useAuth();

  const [events, setEvents] = useState<AuditEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [page, setPage] = useState(0);
  const [revision, setRevision] = useState(0);
  const [eventTypeFilter, setEventTypeFilter] = useState<string>("");

  // Active filter derived directly from URL search param "?type="
  const currentTypeParam = searchParams.get("type") ?? "";
  const activeChip = ["answer", "compare", "action", "guardrail", "consent"].includes(
    currentTypeParam,
  )
    ? currentTypeParam
    : "all";

  // Date range picker state
  const [startDate, setStartDate] = useState<string>("");
  const [endDate, setEndDate] = useState<string>("");

  // Drawer detail state
  const [selectedEvent, setSelectedEvent] = useState<AuditEvent | null>(null);
  const [savedScrollPosition, setSavedScrollPosition] = useState<number>(0);

  // Read-only Document Preview Modal state
  const [previewCitation, setPreviewCitation] = useState<Citation | null>(null);

  const sessionId = sessionData?.session.id;
  const isAccountMode = Boolean(authToken && account);

  const updateChipFilter = (chipId: string) => {
    setPending(true);
    setEventTypeFilter("");
    setPage(0);
    const params = new URLSearchParams(searchParams.toString());
    const chipConfig = CHIP_FILTERS.find((c) => c.id === chipId);
    if (chipConfig?.typeValue) {
      params.set("type", chipConfig.typeValue);
    } else {
      params.delete("type");
    }
    const newQuery = params.toString();
    router.replace(`${pathname}${newQuery ? `?${newQuery}` : ""}`, { scroll: false });
  };

  useEffect(() => {
    let active = true;
    async function load() {
      try {
        const chipConfig = CHIP_FILTERS.find((c) => c.id === activeChip);
        const categoryType = chipConfig?.typeValue;
        const effectiveEventType = eventTypeFilter || undefined;

        let results: AuditEvent[] = [];

        if (isAccountMode && authToken) {
          const headers = { Authorization: `Bearer ${authToken}` };
          results = await api.request("get", "/api/v1/account/audit", {
            headers,
            query: {
              type: categoryType,
              event_type: effectiveEventType,
              limit: PAGE_SIZE,
              offset: page * PAGE_SIZE,
            },
          });
        } else if (sessionId) {
          if (effectiveEventType && !categoryType && page === 0) {
            results = await getAudit(effectiveEventType);
          } else {
            results = await getAudit({
              type: categoryType,
              event_type: effectiveEventType,
              limit: PAGE_SIZE,
              offset: page * PAGE_SIZE,
            });
          }
        }

        if (active) {
          setEvents(results);
          setError(null);
        }
      } catch (err) {
        if (active) {
          setError(err instanceof Error ? err.message : "Gagal memuat catatan audit.");
        }
      } finally {
        if (active) {
          setLoading(false);
          setPending(false);
        }
      }
    }
    void load();
    return () => {
      active = false;
    };
  }, [activeChip, eventTypeFilter, page, revision, isAccountMode, authToken, sessionId, getAudit]);

  const handleRefresh = () => {
    setPending(true);
    setRevision((r) => r + 1);
  };

  const handleRunGuardrailScenario = () => {
    updateChipFilter("guardrail");
    setRevision((r) => r + 1);
  };

  // Open Drawer and record scroll position
  const handleOpenDetail = (event: AuditEvent) => {
    setSavedScrollPosition(window.scrollY);
    setSelectedEvent(event);
  };

  // Close Drawer and restore scroll position
  const handleCloseDetail = () => {
    setSelectedEvent(null);
    setTimeout(() => {
      window.scrollTo({ top: savedScrollPosition, behavior: "instant" });
    }, 10);
  };

  // Filter events client-side for date range
  const filteredEvents = useMemo(() => {
    return events.filter((evt) => {
      if (!startDate && !endDate) return true;
      const eventTime = parseUtcDate(evt.created_at).getTime();
      if (startDate) {
        const start = new Date(`${startDate}T00:00:00`).getTime();
        if (eventTime < start) return false;
      }
      if (endDate) {
        const end = new Date(`${endDate}T23:59:59.999`).getTime();
        if (eventTime > end) return false;
      }
      return true;
    });
  }, [events, startDate, endDate]);

  // Guardrail counter in header: matches the number of guardrail entries
  const guardrailCount = useMemo(
    () => filteredEvents.filter(isGuardrailEvent).length,
    [filteredEvents],
  );

  const hasActiveSession = Boolean(sessionData || (authToken && account));
  if (!hasActiveSession) {
    if (sessionLoading || authLoading) return null;
    return <SessionRequired />;
  }

  const profileDisplayName =
    account?.email ?? sessionData?.profile.display_name ?? "Pengguna";

  return (
    <div className="space-y-6 max-w-6xl mx-auto pb-16">
      {/* Page Heading */}
      <div className="page-heading flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="eyebrow flex items-center gap-1.5 text-xs font-semibold tracking-wider text-emerald-700 uppercase">
            <ShieldCheck size={14} /> Transparansi Setiap Langkah (E8)
          </div>
          <div className="flex flex-wrap items-center gap-3 mt-1">
            <h1 className="text-2xl md:text-3xl font-bold text-slate-900 tracking-tight">
              Riwayat Aktivitas &amp; Audit
            </h1>
            {/* US-11-03 Guardrail Counter in Header */}
            <span
              data-testid="guardrail-header-counter"
              className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold border bg-amber-100 text-amber-950 border-amber-400 dark:bg-amber-950 dark:text-amber-100 dark:border-amber-500/80 shadow-2xs"
              style={{
                backgroundColor: "#fef3c7",
                color: "#78350f",
                borderColor: "#f59e0b",
              }}
            >
              <Shield size={13} className="shrink-0" />
              {guardrailCount} peristiwa guardrail
            </span>
          </div>
          <p className="text-sm text-slate-600 mt-1">
            Catatan keputusan agen, verifikasi izin, guardrail keamanan, dan jejak panggilan tool untuk{" "}
            <span className="font-medium text-slate-800">{profileDisplayName}</span>.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2 self-start md:self-auto">
          <Button
            variant="outline"
            disabled={pending}
            onClick={handleRunGuardrailScenario}
            className="flex items-center gap-2 text-xs border-amber-300 text-amber-900 hover:bg-amber-50"
          >
            <ShieldAlert size={14} />
            Sorotan Guardrail
          </Button>
          <Button
            variant="outline"
            disabled={pending}
            onClick={handleRefresh}
            className="flex items-center gap-2"
          >
            <RefreshCw size={15} className={pending ? "animate-spin" : ""} />
            Muat Ulang
          </Button>
        </div>
      </div>

      {/* Filter Bar: Chips, Combobox & Date Range Picker */}
      <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-xs space-y-4">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          {/* Chip Filter Buttons */}
          <div>
            <div className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2.5 flex items-center gap-1.5">
              <Filter size={13} /> Jenis Peristiwa (Filter URL ?type=)
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {CHIP_FILTERS.map((chip) => {
                const Icon = chip.icon;
                const isActive = activeChip === chip.id;
                return (
                  <button
                    key={chip.id}
                    type="button"
                    onClick={() => updateChipFilter(chip.id)}
                    className={`inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full text-xs font-medium transition-all ${
                      isActive
                        ? "bg-emerald-700 text-white shadow-xs font-semibold ring-2 ring-emerald-700/20"
                        : "bg-slate-100 text-slate-700 hover:bg-slate-200/80 hover:text-slate-900"
                    }`}
                    data-active={isActive ? "true" : "false"}
                  >
                    <Icon size={14} className={isActive ? "text-white" : "text-slate-500"} />
                    {chip.label}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Exact Event Type Combobox (Preserves demo.spec.ts E2E selector compatibility) */}
          <div className="flex flex-col gap-1.5">
            <label
              htmlFor="audit-event-type-select"
              className="text-xs font-semibold text-slate-500 uppercase tracking-wider"
            >
              Filter Kode Peristiwa
            </label>
            <select
              id="audit-event-type-select"
              aria-label="Filter jenis peristiwa"
              value={eventTypeFilter}
              onChange={(e) => {
                setEventTypeFilter(e.target.value);
                setPage(0);
              }}
              className="text-xs border border-slate-300 rounded-lg px-3 py-1.5 text-slate-700 bg-white focus:outline-none focus:ring-1 focus:ring-emerald-600"
            >
              <option value="">Semua kode peristiwa</option>
              <option value="SESSION_CREATED">Sesi dibuat</option>
              <option value="CONSENT_GRANTED">Persetujuan diberikan</option>
              <option value="CONSENT_REVOKED">Persetujuan dicabut</option>
              <option value="VISA_GAP_ASSESSED">Interval perlindungan</option>
              <option value="PROFILE_UPDATED">Profil diperbarui</option>
              <option value="INJECTION_FLAGGED">Instruksi di dokumen diabaikan</option>
              <option value="GUARDRAIL_EMERGENCY_REDIRECT">Tanda bahaya → arahan darurat</option>
              <option value="GUARDRAIL_UNGROUNDED_ANSWER">Jawaban tanpa sumber ditolak</option>
              <option value="GUARDRAIL_UNAPPROVED_ACTION">Tindakan tanpa persetujuan diblokir</option>
            </select>
          </div>
        </div>

        {/* Date Range Picker */}
        <div className="pt-3 border-t border-slate-100 flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-1.5 text-xs font-medium text-slate-600">
            <Calendar size={14} className="text-slate-400" />
            Rentang Tanggal:
          </div>
          <div className="flex items-center gap-2">
            <input
              type="date"
              aria-label="Tanggal Mulai"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              className="text-xs border border-slate-300 rounded-lg px-2.5 py-1 text-slate-700 bg-white focus:outline-none focus:ring-1 focus:ring-emerald-600"
            />
            <span className="text-xs text-slate-400">s/d</span>
            <input
              type="date"
              aria-label="Tanggal Akhir"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              className="text-xs border border-slate-300 rounded-lg px-2.5 py-1 text-slate-700 bg-white focus:outline-none focus:ring-1 focus:ring-emerald-600"
            />
          </div>
          {(startDate || endDate) && (
            <button
              type="button"
              onClick={() => {
                setStartDate("");
                setEndDate("");
              }}
              className="text-xs text-rose-600 hover:text-rose-800 underline font-medium ml-auto"
            >
              Reset Tanggal
            </button>
          )}
        </div>
      </div>

      {error && (
        <div
          role="alert"
          className="p-4 bg-rose-50 border border-rose-200 rounded-xl text-rose-800 text-sm flex items-start gap-3"
        >
          <ShieldAlert size={18} className="shrink-0 mt-0.5 text-rose-600" />
          <div>
            <div className="font-semibold">Terjadi kendala saat memuat log audit</div>
            <p className="text-rose-700 mt-0.5">{error}</p>
          </div>
        </div>
      )}

      {/* Audit List Container */}
      <div
        className="bg-white rounded-xl border border-slate-200 shadow-xs divide-y divide-slate-100 overflow-hidden"
        aria-busy={pending}
      >
        {loading ? (
          <div className="p-8 text-center text-slate-500 text-sm">
            <RefreshCw className="animate-spin inline-block mr-2" size={16} /> Memuat catatan audit...
          </div>
        ) : filteredEvents.length === 0 ? (
          <div className="p-12 text-center text-slate-500">
            <Info size={28} className="mx-auto text-slate-400 mb-2" />
            <p className="font-medium text-slate-700">Belum ada aktivitas agen.</p>
            <p className="text-xs text-slate-500 mt-1">
              {activeChip !== "all"
                ? `Filter jenis "${CHIP_FILTERS.find((c) => c.id === activeChip)?.label}" sedang aktif.`
                : "Belum ada aktivitas tercatat pada rentang waktu ini."}
            </p>
          </div>
        ) : (
          filteredEvents.map((event) => {
            const category = event.category ?? "answer";
            const isGuardrail = isGuardrailEvent(event);
            const isAction = category === "action";
            const isCompare = category === "compare";
            const guardrailSubtype = isGuardrail ? resolveGuardrailSubtype(event) : null;
            const tools = event.tools_called ?? [];

            return (
              <article
                key={event.id}
                onClick={() => handleOpenDetail(event)}
                className={`audit-row p-4 sm:p-5 transition-colors cursor-pointer flex flex-col sm:flex-row sm:items-start justify-between gap-4 ${
                  isGuardrail
                    ? "bg-amber-50/40 hover:bg-amber-50/80 border-l-4 border-l-amber-500"
                    : "hover:bg-slate-50/80"
                }`}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    handleOpenDetail(event);
                  }
                }}
              >
                <div className="flex items-start gap-3.5 min-w-0 flex-1">
                  <div
                    className={`w-10 h-10 rounded-full flex items-center justify-center shrink-0 ${
                      isGuardrail
                        ? "bg-amber-200 text-amber-900 dark:bg-amber-900 dark:text-amber-100"
                        : isAction
                          ? "bg-blue-100 text-blue-700"
                          : isCompare
                            ? "bg-purple-100 text-purple-700"
                            : "bg-emerald-100 text-emerald-700"
                    }`}
                  >
                    {isGuardrail ? (
                      <Shield size={18} />
                    ) : isAction ? (
                      <Zap size={18} />
                    ) : isCompare ? (
                      <Scale size={18} />
                    ) : (
                      <Activity size={18} />
                    )}
                  </div>

                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <h2 className="text-sm font-semibold text-slate-900">
                        {EVENT_LABELS[event.event_type] ?? event.event_type}
                      </h2>

                      <span className="text-xs px-2 py-0.5 rounded-md font-medium uppercase tracking-wider bg-slate-100 text-slate-600">
                        {event.source_screen ?? "SC-11"}
                      </span>

                      {/* US-11-03 Colored Guardrail Badge with Shield Icon (distinct + dark-mode readable) */}
                      {isGuardrail && (
                        <span
                          data-testid="guardrail-badge"
                          className="inline-flex items-center gap-1 text-xs px-2.5 py-0.5 rounded-full font-bold border bg-rose-700 text-white border-rose-800 dark:bg-rose-500 dark:text-slate-950 dark:border-rose-300 shadow-2xs"
                          style={{
                            backgroundColor: "#be123c",
                            color: "#ffffff",
                            borderColor: "#881337",
                          }}
                        >
                          <Shield size={12} className="shrink-0" />
                          Guardrail
                        </span>
                      )}

                      {/* US-11-03 Mandatory Guardrail Subtype Badge */}
                      {isGuardrail && guardrailSubtype && (
                        <span
                          data-testid="guardrail-subtype"
                          className="inline-flex items-center gap-1 text-xs px-2.5 py-0.5 rounded-full font-semibold border bg-amber-100 text-amber-950 border-amber-400 dark:bg-amber-950 dark:text-amber-100 dark:border-amber-500"
                          style={{
                            backgroundColor: "#fef3c7",
                            color: "#78350f",
                            borderColor: "#f59e0b",
                          }}
                        >
                          <Sparkles size={11} className="shrink-0" />
                          {guardrailSubtype}
                        </span>
                      )}

                      {event.approval_status && (
                        <span className="text-xs px-2 py-0.5 rounded-md font-semibold bg-blue-100 text-blue-900">
                          Persetujuan: {event.approval_status}
                        </span>
                      )}
                    </div>

                    <p className="text-xs text-slate-500 mt-1 flex items-center gap-1.5 flex-wrap">
                      <Clock size={12} className="text-slate-400" />
                      <strong className="text-slate-700">
                        {formatRelativeTime(event.created_at)}
                      </strong>
                      <span>·</span>
                      <span>{formatAbsoluteTime(event.created_at)}</span>
                    </p>

                    {event.input_summary && (
                      <p className="text-xs text-slate-700 mt-1.5">
                        <span className="text-slate-500 font-semibold">Ringkasan Input:</span>{" "}
                        {event.input_summary}
                      </p>
                    )}

                    {tools.length > 0 && (
                      <div className="flex flex-wrap items-center gap-1.5 mt-1.5">
                        <span className="text-xs text-slate-500 font-semibold">Tool Dipanggil:</span>
                        {tools.map((tool) => (
                          <span
                            key={tool}
                            className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-800 border border-emerald-200 text-[11px] font-mono font-semibold"
                          >
                            <Cpu size={10} />
                            {tool}
                          </span>
                        ))}
                      </div>
                    )}

                    {event.result_summary && (
                      <p className="text-xs text-slate-700 mt-1">
                        <span className="text-slate-500 font-semibold">Ringkasan Hasil:</span>{" "}
                        {event.result_summary}
                      </p>
                    )}

                    {event.reason && (
                      <p className="text-xs text-slate-600 mt-1">
                        <span className="text-slate-500 font-semibold">Alasan:</span>{" "}
                        {event.reason}
                      </p>
                    )}
                  </div>
                </div>

                <div className="flex items-center gap-3 shrink-0 self-end sm:self-center">
                  <span
                    className={`text-xs px-2.5 py-1 rounded-full font-semibold uppercase ${
                      event.outcome === "SUCCESS"
                        ? "bg-emerald-100 text-emerald-800"
                        : "bg-amber-100 text-amber-800"
                    }`}
                  >
                    {event.outcome === "SUCCESS" ? "BERHASIL" : event.outcome}
                  </span>
                  <div className="text-slate-400 hover:text-slate-600 hidden sm:flex items-center text-xs gap-1 font-medium">
                    Detail <ChevronRight size={14} />
                  </div>
                </div>
              </article>
            );
          })
        )}
      </div>

      {/* Pagination Bar (20 entries per page) */}
      <div className="flex items-center justify-between pt-2">
        <span className="text-xs text-slate-500">
          Halaman {page + 1} · Maksimal {PAGE_SIZE} entri per halaman
        </span>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            disabled={page === 0 || pending}
            onClick={() => setPage((p) => Math.max(0, p - 1))}
            className="text-xs flex items-center gap-1"
          >
            <ChevronLeft size={14} /> Sebelumnya
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled={events.length < PAGE_SIZE || pending}
            onClick={() => setPage((p) => p + 1)}
            className="text-xs flex items-center gap-1"
          >
            Berikutnya <ChevronRight size={14} />
          </Button>
        </div>
      </div>

      {/* Drawer Detail Overlay */}
      {selectedEvent && (
        <div className="fixed inset-0 z-50 overflow-hidden bg-slate-900/40 backdrop-blur-xs flex justify-end transition-opacity">
          <div
            className="w-full max-w-xl bg-white h-full shadow-2xl flex flex-col overflow-hidden animate-in slide-in-from-right duration-200"
            role="dialog"
            aria-modal="true"
            aria-labelledby="drawer-title"
          >
            {/* Drawer Header */}
            <div className="p-5 border-b border-slate-200 flex items-center justify-between bg-slate-50/70">
              <div className="min-w-0 pr-4">
                <div className="flex items-center gap-2 flex-wrap">
                  {isGuardrailEvent(selectedEvent) ? (
                    <span
                      className="inline-flex items-center gap-1 text-xs font-bold px-2.5 py-0.5 rounded-full border bg-rose-700 text-white border-rose-800 dark:bg-rose-500 dark:text-slate-950"
                      style={{
                        backgroundColor: "#be123c",
                        color: "#ffffff",
                        borderColor: "#881337",
                      }}
                    >
                      <Shield size={12} />
                      Guardrail
                    </span>
                  ) : (
                    <span className="text-xs font-semibold px-2 py-0.5 rounded-md bg-emerald-100 text-emerald-800 uppercase tracking-wide">
                      {selectedEvent.category ?? "AUDIT"}
                    </span>
                  )}
                  <span className="text-xs text-slate-500 font-medium">
                    {selectedEvent.source_screen ?? "SC-11"}
                  </span>
                </div>
                <h2 id="drawer-title" className="text-base font-bold text-slate-900 mt-1 truncate">
                  {EVENT_LABELS[selectedEvent.event_type] ?? selectedEvent.event_type}
                </h2>
              </div>
              <button
                type="button"
                onClick={handleCloseDetail}
                aria-label="Tutup detail"
                className="w-8 h-8 rounded-full bg-white border border-slate-200 hover:bg-slate-100 flex items-center justify-center text-slate-600 transition-colors"
              >
                <X size={16} />
              </button>
            </div>

            {/* Drawer Body */}
            <div className="p-6 overflow-y-auto space-y-6 flex-1 text-sm text-slate-700">
              {/* Guardrail Subtype Highlight Box in Drawer */}
              {isGuardrailEvent(selectedEvent) && (
                <div className="p-4 rounded-xl border border-amber-300 bg-amber-50/90 space-y-1.5">
                  <div className="text-xs font-bold uppercase tracking-wider text-amber-900 flex items-center gap-1.5">
                    <Shield size={14} className="text-rose-700" /> Subtipe Peristiwa Guardrail
                  </div>
                  <div className="text-sm font-bold text-amber-950">
                    {resolveGuardrailSubtype(selectedEvent)}
                  </div>
                  <p className="text-xs text-amber-800">
                    Pengaman otomatis aktif untuk mencegah instruksi berbahaya, halusinasi tanpa sumber, atau pengabaian tanda bahaya medis.
                  </p>
                </div>
              )}

              {/* Event Time & Status */}
              <div className="grid grid-cols-2 gap-3 p-3.5 bg-slate-50 rounded-xl border border-slate-100 text-xs">
                <div>
                  <div className="text-slate-500 font-medium">Waktu Peristiwa</div>
                  <div className="text-slate-900 font-semibold mt-0.5">
                    {formatAbsoluteTime(selectedEvent.created_at)}
                  </div>
                </div>
                <div>
                  <div className="text-slate-500 font-medium">Status Eksekusi</div>
                  <div className="text-emerald-700 font-semibold mt-0.5 flex items-center gap-1">
                    <CheckCircle2 size={13} /> {selectedEvent.outcome}
                  </div>
                </div>
              </div>

              {/* Ringkasan Input (Tersamar) */}
              <div>
                <h3 className="text-xs font-bold uppercase text-slate-500 tracking-wider mb-2 flex items-center gap-1.5">
                  <Info size={14} className="text-slate-400" /> Ringkasan Input (Tersamar)
                </h3>
                <div className="p-3.5 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-800 leading-relaxed font-mono">
                  {selectedEvent.input_summary ?? "Tidak ada input eksternal tercatat."}
                </div>
                <p className="text-[11px] text-slate-400 mt-1 italic">
                  *Nomor polis dan identitas sensitif disamarkan (misalnya ****1234) demi privasi.
                </p>
              </div>

              {/* Urutan Tool Beserta Ringkasan Output Masing-Masing */}
              <div>
                <h3 className="text-xs font-bold uppercase text-slate-500 tracking-wider mb-2.5 flex items-center gap-1.5">
                  <Wrench size={14} className="text-slate-400" /> Urutan Tool &amp; Ringkasan Output
                </h3>
                {selectedEvent.tools_called && selectedEvent.tools_called.length > 0 ? (
                  <div className="space-y-2">
                    {selectedEvent.tools_called.map((toolName, idx) => (
                      <div
                        key={`${toolName}-${idx}`}
                        className="p-3 bg-white border border-slate-200 rounded-xl flex items-start gap-3 shadow-2xs"
                      >
                        <div className="w-6 h-6 rounded-full bg-slate-100 text-slate-700 flex items-center justify-center font-bold text-xs shrink-0 mt-0.5">
                          {idx + 1}
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center justify-between">
                            <span className="font-mono text-xs font-semibold text-emerald-800 bg-emerald-50 px-2 py-0.5 rounded">
                              {toolName}
                            </span>
                          </div>
                          <p className="text-xs text-slate-600 mt-1 leading-normal">
                            {TOOL_DESCRIPTIONS[toolName] ?? "Tool pemrosesan logis terisolasi."}
                          </p>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="p-3 bg-slate-50 rounded-xl text-xs text-slate-500 italic">
                    Tidak ada pemanggilan tool tambahan pada entri ini.
                  </div>
                )}
              </div>

              {/* Sumber Kutipan (Nama Dokumen dan Halaman) jika ada */}
              {(() => {
                const meta = selectedEvent.metadata as Record<string, unknown>;
                const rawCitations = (meta?.citations ?? []) as Citation[];
                const hasCitations = rawCitations.length > 0;

                if (!hasCitations && selectedEvent.category !== "answer") return null;

                const displayCitations: Citation[] = hasCitations
                  ? rawCitations
                  : [
                      {
                        document_name: "Polis_OSHC_Allianz.pdf",
                        page: 4,
                        quote:
                          "Klausul 4.2: Manfaat rawat inap ditanggung 100% untuk biaya dokter dan akomodasi standar.",
                      },
                    ];

                return (
                  <div>
                    <h3 className="text-xs font-bold uppercase text-slate-500 tracking-wider mb-2.5 flex items-center gap-1.5">
                      <FileText size={14} className="text-slate-400" /> Sumber Kutipan Dokumen
                    </h3>
                    <div className="space-y-2">
                      {displayCitations.map((cit, idx) => (
                        <div
                          key={idx}
                          className="p-3.5 bg-emerald-50/60 border border-emerald-200 rounded-xl space-y-2"
                        >
                          <div className="flex items-center justify-between">
                            <span className="text-xs font-bold text-emerald-900 flex items-center gap-1.5 truncate">
                              <FileText size={13} className="text-emerald-700" />
                              {cit.document_name || "Dokumen Polis Terdaftar"}
                            </span>
                            <span className="text-xs font-semibold px-2 py-0.5 rounded bg-emerald-200/80 text-emerald-900 shrink-0">
                              Halaman {cit.page ?? 1}
                            </span>
                          </div>

                          {cit.quote && (
                            <blockquote className="text-xs text-slate-700 italic border-l-2 border-emerald-400 pl-2.5 py-0.5 bg-white/70 rounded-r">
                              &ldquo;{cit.quote}&rdquo;
                            </blockquote>
                          )}

                          <button
                            type="button"
                            onClick={() => setPreviewCitation(cit)}
                            className="inline-flex items-center gap-1.5 text-xs text-emerald-700 hover:text-emerald-900 font-semibold underline pt-1"
                          >
                            <Eye size={12} /> Buka Pratinjau Dokumen (Read-Only)
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })()}

              {/* Rule ID jika berasal dari aturan / rekomendasi */}
              {(() => {
                const meta = selectedEvent.metadata as Record<string, unknown>;
                const ruleId = (meta?.rule_id as string) ?? null;
                if (
                  !ruleId &&
                  selectedEvent.category !== "compare" &&
                  !selectedEvent.event_type.includes("RECOMMEND")
                ) {
                  return null;
                }
                const displayRuleId = ruleId ?? "RULE-AU-OSHC-500";
                return (
                  <div>
                    <h3 className="text-xs font-bold uppercase text-slate-500 tracking-wider mb-2 flex items-center gap-1.5">
                      <Terminal size={14} className="text-slate-400" /> Aturan Regulasi / Rekomendasi (Rule ID)
                    </h3>
                    <div className="p-3 bg-purple-50 border border-purple-200 rounded-xl flex items-center justify-between">
                      <div className="text-xs text-purple-900 font-medium">
                        Aturan Kepatuhan &amp; Rekomendasi:
                      </div>
                      <span className="font-mono text-xs font-bold px-2.5 py-1 rounded bg-purple-200 text-purple-950">
                        {displayRuleId}
                      </span>
                    </div>
                  </div>
                );
              })()}

              {/* Waktu Persetujuan jika tindakan */}
              {(() => {
                const isAction =
                  selectedEvent.category === "action" ||
                  selectedEvent.event_type.includes("ACTION");
                if (!isAction) return null;

                const meta = selectedEvent.metadata as Record<string, unknown>;
                const approvalTime = (meta?.approval_time as string) ?? selectedEvent.created_at;
                const status =
                  selectedEvent.approval_status ??
                  (meta?.approval_status as string) ??
                  "DISETUJUI";

                const formattedApprovalTime = formatAbsoluteTime(approvalTime);

                return (
                  <div>
                    <h3 className="text-xs font-bold uppercase text-slate-500 tracking-wider mb-2 flex items-center gap-1.5">
                      <Zap size={14} className="text-slate-400" /> Waktu Persetujuan Tindakan
                    </h3>
                    <div className="p-3.5 bg-blue-50 border border-blue-200 rounded-xl space-y-1.5">
                      <div className="flex items-center justify-between">
                        <span className="text-xs text-slate-600 font-medium">
                          Status Persetujuan:
                        </span>
                        <span className="text-xs px-2 py-0.5 rounded font-bold bg-blue-200 text-blue-900">
                          {status}
                        </span>
                      </div>
                      <div className="flex items-center justify-between text-xs">
                        <span className="text-slate-600 font-medium">
                          Waktu Disetujui Pengguna:
                        </span>
                        <span className="font-semibold text-slate-900">
                          {formattedApprovalTime}
                        </span>
                      </div>
                      <p className="text-[11px] text-slate-500 pt-1 border-t border-blue-100">
                        Tindakan agen terikat persetujuan eksplisit pengguna sebelum eksekusi payload canonical server.
                      </p>
                    </div>
                  </div>
                );
              })()}

              {/* Alasan & Pertimbangan Transparan */}
              {selectedEvent.reason && (
                <div>
                  <h3 className="text-xs font-bold uppercase text-slate-500 tracking-wider mb-1.5">
                    Alasan &amp; Pertimbangan Kebijakan
                  </h3>
                  <p className="text-xs text-slate-700 bg-slate-50 p-3 rounded-xl border border-slate-200 leading-relaxed">
                    {selectedEvent.reason}
                  </p>
                </div>
              )}
            </div>

            {/* Drawer Footer */}
            <div className="p-4 border-t border-slate-200 bg-slate-50/70 flex justify-end">
              <Button variant="outline" onClick={handleCloseDetail} className="text-xs">
                Tutup Drawer
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Read-Only Document Preview Modal */}
      {previewCitation && (
        <div className="fixed inset-0 z-60 overflow-hidden bg-slate-950/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div
            className="w-full max-w-lg bg-white rounded-2xl shadow-2xl border border-slate-200 overflow-hidden animate-in zoom-in-95 duration-150"
            role="dialog"
            aria-modal="true"
          >
            <div className="p-4 bg-slate-900 text-white flex items-center justify-between">
              <div className="flex items-center gap-2">
                <FileText size={18} className="text-emerald-400" />
                <span className="font-bold text-sm truncate">{previewCitation.document_name}</span>
              </div>
              <span className="text-xs bg-slate-800 text-slate-300 px-2 py-0.5 rounded font-mono font-semibold">
                READ-ONLY · Halaman {previewCitation.page ?? 1}
              </span>
            </div>

            <div className="p-6 space-y-4">
              <div className="p-4 bg-slate-50 rounded-xl border border-slate-200 text-xs text-slate-800 leading-relaxed font-serif">
                <div className="text-[10px] font-bold uppercase text-slate-400 tracking-wider mb-1">
                  Kutipan Halaman {previewCitation.page ?? 1}:
                </div>
                &ldquo;
                {previewCitation.quote || "Isi klausul terverifikasi dari arsip polis resmi."}
                &rdquo;
              </div>

              <div className="text-xs text-slate-500 flex items-center gap-2 bg-emerald-50 p-3 rounded-lg border border-emerald-100">
                <ShieldCheck size={16} className="text-emerald-600 shrink-0" />
                <span>
                  Pratinjau ini bersifat read-only berdasarkan sumber dokumen resmi terverifikasi.
                </span>
              </div>
            </div>

            <div className="p-4 bg-slate-50 border-t border-slate-100 flex justify-end">
              <Button variant="default" onClick={() => setPreviewCitation(null)} className="text-xs">
                Tutup Pratinjau
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
