"use client";

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import {
  AlertTriangle,
  Bell,
  CalendarPlus,
  CheckCircle2,
  Clock,
  Copy,
  Download,
  Edit3,
  ExternalLink,
  FileText,
  Inbox,
  Lock,
  Mail,
  Play,
  RefreshCw,
  RotateCcw,
  Send,
  Shield,
  ShieldAlert,
  ShieldCheck,
  X,
  XCircle,
} from "lucide-react";
import { useSession } from "@/lib/session";
import { useAuth } from "@/lib/auth";
import { api, ApiClientError } from "@/lib/api/client";
import { config } from "@/lib/config";
import type { components } from "@/lib/api/types.gen";
import { Button } from "@/components/ui/button";
import { SessionRequired } from "@/components/session-required";

type ProposedAction = components["schemas"]["ProposedAction"];
type QueueTab = "PENDING" | "COMPLETED" | "REJECTED";

const REJECT_REASONS = [
  "Tidak perlu",
  "Isi salah",
  "Nanti saja",
  "Lainnya",
] as const;

const FIELD_LABELS: Record<string, string> = {
  message: "Isi Pesan / Email / Pengingat",
  reminder_date: "Tanggal Pengingat",
  bank_account_holder: "Nama Pemilik Rekening (Field Formulir Kosong)",
  additional_notes: "Catatan Tambahan Klaim (Field Formulir Kosong)",
  recipient_department: "Divisi Penerima (Field Formulir Kosong)",
  notification_channel: "Kanal Pengingat (Field Formulir Kosong)",
  provider: "Penyedia Asuransi",
  policy_number: "Nomor Polis (Tersamar)",
  diagnosis_code: "Kode Diagnosis",
  claim_amount: "Nominal Klaim",
  policy_end_date: "Tanggal Akhir Polis",
  visa_expiry_date: "Tanggal Akhir Visa",
};

const EDITABLE_PAYLOAD_KEYS = [
  "message",
  "reminder_date",
  "bank_account_holder",
  "additional_notes",
  "recipient_department",
  "notification_channel",
  "provider",
  "policy_number",
  "diagnosis_code",
  "claim_amount",
  "policy_end_date",
  "visa_expiry_date",
] as const;

const STATUS_LABELS: Record<string, string> = {
  PENDING: "Menunggu",
  APPROVED: "Disetujui",
  REJECTED: "Ditolak",
  COMPLETED: "Selesai",
  FAILED: "Gagal",
};

const ACTION_TYPE_META: Record<
  string,
  {
    categoryLabel: string;
    title: string;
    permissionBadge: string;
    previewHeading: string;
    icon: typeof FileText;
  }
> = {
  create_reminder: {
    categoryLabel: "Pengingat",
    title: "Pengingat Perpanjangan Perlindungan",
    permissionBadge: "L1 · Siapkan draf",
    previewHeading: "Pratinjau Isi Pengingat Lengkap",
    icon: Bell,
  },
  draft_message: {
    categoryLabel: "Draf pesan",
    title: "Draf Pesan ke Penyedia Asuransi",
    permissionBadge: "L1 · Siapkan draf",
    previewHeading: "Pratinjau Isi Email / Pesan Lengkap",
    icon: Mail,
  },
  draft_claim_form: {
    categoryLabel: "Formulir klaim",
    title: "Penyusunan Formulir Klaim",
    permissionBadge: "L1 · Siapkan draf",
    previewHeading: "Pratinjau Isi Formulir Klaim Lengkap",
    icon: FileText,
  },
  submit_claim_sandbox: {
    categoryLabel: "Kirim klaim ke penyedia (sandbox)",
    title: "Kirim Klaim ke Penyedia (Sandbox)",
    permissionBadge: "L2 · Jalankan setelah persetujuan",
    previewHeading: "Pratinjau Isi Formulir & Pengiriman Klaim (Sandbox)",
    icon: Send,
  },
  claim_submit: {
    categoryLabel: "Kirim klaim ke penyedia (sandbox)",
    title: "Kirim Klaim ke Penyedia (Sandbox)",
    permissionBadge: "L2 · Jalankan setelah persetujuan",
    previewHeading: "Pratinjau Isi Formulir & Pengiriman Klaim (Sandbox)",
    icon: Send,
  },
};

function formatRelativeDateId(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  const diffSec = Math.round((Date.now() - date.getTime()) / 1000);
  if (diffSec < 60) return "Baru saja";
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin} menit lalu`;
  const diffHour = Math.floor(diffMin / 60);
  if (diffHour < 24) return `${diffHour} jam lalu`;
  const diffDay = Math.floor(diffHour / 24);
  return `${diffDay} hari lalu`;
}

function formatAbsoluteDateId(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return new Intl.DateTimeFormat("id-ID", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(date);
}

function formatDateTimeId(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return new Intl.DateTimeFormat("id-ID", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(date);
}

function triggerBrowserDownload(filename: string, content: BlobPart, mimeType: string) {
  if (typeof window === "undefined") return;
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  URL.revokeObjectURL(url);
}

function ActionsPageContent() {
  const searchParams = useSearchParams();
  const forceEmpty = searchParams.get("empty") === "true";

  const { data: sessionData, loading: sessionLoading, setConsent } = useSession();
  const { account, token: authToken, loading: authLoading } = useAuth();

  const [actionsList, setActionsList] = useState<ProposedAction[]>([]);
  const [activeTab, setActiveTab] = useState<QueueTab>("PENDING");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState(false);
  const [copiedText, setCopiedText] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<{
    type: "success" | "warning" | "error";
    message: string;
  } | null>(null);
  const [revision, setRevision] = useState(0);

  // Mode Ubah (Edit Mode) state
  const [isEditing, setIsEditing] = useState(false);
  const [draftPayload, setDraftPayload] = useState<Record<string, unknown>>({});

  // L2 Confirmation state ("Saya sudah memeriksa isinya")
  const [l2Checked, setL2Checked] = useState(false);

  // Reject Dialog state
  const [showRejectModal, setShowRejectModal] = useState(false);
  const [selectedRejectReason, setSelectedRejectReason] = useState<string>("Isi salah");
  const [customRejectReason, setCustomRejectReason] = useState<string>("");

  const sessionId = sessionData?.session.id;
  const hasDocumentConsent = Boolean(sessionData?.consent.processing_consent);
  const isAccountMode = Boolean(authToken && account);

  useEffect(() => {
    let active = true;
    async function load() {
      if (!sessionId && !isAccountMode) {
        if (active) setLoading(false);
        return;
      }
      if (sessionId && !hasDocumentConsent) {
        if (active) setLoading(false);
        return;
      }
      try {
        const storedToken =
          typeof window !== "undefined"
            ? window.sessionStorage.getItem("insurra.demo-session")
            : null;
        if (storedToken) {
          const items = forceEmpty
            ? []
            : await api.request("get", "/api/v1/actions", {
                headers: { "X-Demo-Session": storedToken },
                query: { seed_demo: true, include_empty: true },
              });
          if (active) {
            setActionsList(items);
            const pendingCount = items.filter((a) => a.status === "PENDING").length;
            if (typeof window !== "undefined") {
              window.sessionStorage.setItem(
                "insurra.pending-actions-count",
                String(pendingCount),
              );
              window.dispatchEvent(
                new CustomEvent("insurra:actions-updated", {
                  detail: { pendingCount },
                }),
              );
            }
            setSelectedId((prev) =>
              prev && items.some((a) => a.id === prev) ? prev : (items[0]?.id ?? null),
            );
            setError(null);
          }
        }
      } catch (err) {
        if (active) {
          setError(err instanceof Error ? err.message : "Gagal memuat antrean tindakan.");
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
  }, [sessionId, hasDocumentConsent, isAccountMode, revision, forceEmpty]);

  const pendingItems = actionsList.filter((item) => item.status === "PENDING");
  const completedItems = actionsList.filter(
    (item) =>
      item.status === "APPROVED" ||
      item.status === "COMPLETED" ||
      item.status === "FAILED",
  );
  const rejectedItems = actionsList.filter((item) => item.status === "REJECTED");

  const filteredItems =
    activeTab === "PENDING"
      ? pendingItems
      : activeTab === "COMPLETED"
        ? completedItems
        : rejectedItems;

  const selectedAction =
    filteredItems.find((item) => item.id === selectedId) ??
    actionsList.find((item) => item.id === selectedId) ??
    filteredItems[0] ??
    null;

  const handleSelectAction = (action: ProposedAction) => {
    setSelectedId(action.id);
    setIsEditing(false);
    setL2Checked(false);
    setShowRejectModal(false);
    setCopiedText(false);
    setFeedback(null);
    setDraftPayload({ ...(action.payload ?? {}) });
  };

  const handleTabChange = (tab: QueueTab) => {
    setActiveTab(tab);
    setIsEditing(false);
    setL2Checked(false);
    setCopiedText(false);
    const listForTab =
      tab === "PENDING"
        ? pendingItems
        : tab === "COMPLETED"
          ? completedItems
          : rejectedItems;
    if (listForTab.length > 0 && !listForTab.some((i) => i.id === selectedId)) {
      setSelectedId(listForTab[0].id);
      setDraftPayload({ ...(listForTab[0].payload ?? {}) });
    }
  };

  const handleStartEdit = () => {
    if (!selectedAction || selectedAction.status !== "PENDING") return;
    setDraftPayload({ ...(selectedAction.payload ?? {}) });
    setIsEditing(true);
    setFeedback(null);
  };

  const handleCancelEdit = () => {
    if (!selectedAction) return;
    setDraftPayload({ ...(selectedAction.payload ?? {}) });
    setIsEditing(false);
  };

  const documentSourcedFields: string[] = Array.isArray(
    selectedAction?.payload?.document_sourced_fields,
  )
    ? (selectedAction.payload.document_sourced_fields as string[])
    : [];

  const modifiedDocFields = documentSourcedFields.filter((key) => {
    if (!isEditing || !selectedAction?.payload) return false;
    return String(draftPayload[key] ?? "") !== String(selectedAction.payload[key] ?? "");
  });

  const hasPayloadChanges = (() => {
    if (!isEditing || !selectedAction?.payload) return false;
    return EDITABLE_PAYLOAD_KEYS.some(
      (key) =>
        key in (selectedAction.payload ?? {}) &&
        String(draftPayload[key] ?? "") !== String(selectedAction.payload?.[key] ?? ""),
    );
  })();

  const submitApprove = async (action: ProposedAction, confirmed: boolean) => {
    const storedToken =
      typeof window !== "undefined"
        ? window.sessionStorage.getItem("insurra.demo-session")
        : null;
    if (!storedToken) return;

    setPending(true);
    setError(null);
    setFeedback(null);
    try {
      const editedPayloadToSend =
        isEditing && hasPayloadChanges
          ? ({
              ...(action.payload ?? {}),
              ...draftPayload,
              preview: String(draftPayload.message || action.preview).slice(0, 240),
            } as unknown as Record<string, never>)
          : undefined;

      await api.request("post", "/api/v1/actions/{action_id}/approve", {
        headers: { "X-Demo-Session": storedToken },
        params: { action_id: action.id },
        body: {
          edited_payload: editedPayloadToSend,
          reason:
            isEditing && hasPayloadChanges
              ? "Pengguna mengubah isi draf lalu menyetujui tindakan."
              : "Disetujui oleh pengguna setelah memeriksa isi draf.",
          confirmed,
        },
      });

      const approvedDetail = await api.request("get", "/api/v1/actions/{action_id}", {
        headers: { "X-Demo-Session": storedToken },
        params: { action_id: action.id },
      });

      if (approvedDetail.approved_payload_sha256) {
        const executed = await api.request(
          "post",
          "/api/v1/actions/{action_id}/execute",
          {
            headers: { "X-Demo-Session": storedToken },
            params: { action_id: action.id },
            body: {
              approved_payload_sha256: approvedDetail.approved_payload_sha256,
            },
          },
        );
        const execResult = (executed.execution_result ?? {}) as Record<string, unknown>;
        if (
          executed.action_type === "create_reminder" &&
          typeof execResult.ics_content === "string"
        ) {
          triggerBrowserDownload(
            String(execResult.ics_filename || `pengingat-${action.id.slice(0, 8)}.ics`),
            execResult.ics_content,
            "text/calendar;charset=utf-8",
          );
        }
      }

      setIsEditing(false);
      setActiveTab("COMPLETED");
      setSelectedId(action.id);
      setFeedback({
        type: "success",
        message:
          isEditing && hasPayloadChanges
            ? "Perubahan disimpan, disetujui, dan dieksekusi dengan versi terbaru. Status menjadi Selesai dan tercatat di log audit."
            : "Tindakan berhasil disetujui dan dijalankan. Status menjadi Selesai dan bukti eksekusi tercatat di Riwayat Audit.",
      });
      setRevision((r) => r + 1);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Gagal menyetujui tindakan.");
      setPending(false);
    }
  };

  const submitReject = async (action: ProposedAction) => {
    const storedToken =
      typeof window !== "undefined"
        ? window.sessionStorage.getItem("insurra.demo-session")
        : null;
    if (!storedToken) return;

    const finalReason =
      selectedRejectReason === "Lainnya"
        ? customRejectReason.trim() || "Lainnya"
        : selectedRejectReason;

    setPending(true);
    setError(null);
    setFeedback(null);
    try {
      await api.request("post", "/api/v1/actions/{action_id}/reject", {
        headers: { "X-Demo-Session": storedToken },
        params: { action_id: action.id },
        body: {
          reason: finalReason,
          confirmed: false,
        },
      });
      setShowRejectModal(false);
      setIsEditing(false);
      setFeedback({
        type: "warning",
        message: `Tindakan ditolak dengan alasan "${finalReason}" dan telah dicatat di Riwayat Audit.`,
      });
      setRevision((r) => r + 1);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Gagal menolak tindakan.");
      setPending(false);
    }
  };

  const handleExecuteAction = async (
    action: ProposedAction,
    options?: { tamperHash?: boolean; simulateFailure?: boolean },
  ) => {
    const storedToken =
      typeof window !== "undefined"
        ? window.sessionStorage.getItem("insurra.demo-session")
        : null;
    if (!storedToken) return;

    setPending(true);
    setError(null);
    setFeedback(null);
    try {
      const hashToUse = options?.tamperHash
        ? "f".repeat(64)
        : action.approved_payload_sha256 || "0".repeat(64);
      const executed = await api.request(
        "post",
        "/api/v1/actions/{action_id}/execute",
        {
          headers: { "X-Demo-Session": storedToken },
          params: { action_id: action.id },
          query: options?.simulateFailure ? { simulate_failure: true } : undefined,
          body: {
            approved_payload_sha256: hashToUse,
          },
        },
      );
      setSelectedId(executed.id);
      if (executed.status === "FAILED") {
        setFeedback({
          type: "error",
          message: `Eksekusi gagal: ${executed.failure_reason ?? "Kendala layanan sementara."} Gunakan tombol "Coba lagi".`,
        });
      } else {
        setFeedback({
          type: "success",
          message:
            action.status === "COMPLETED"
              ? "Eksekusi idempoten terverifikasi: menekan tombol dua kali tidak menghasilkan efek ganda atau duplikasi log audit."
              : "Tindakan berhasil dieksekusi dan status menjadi Selesai.",
        });
      }
      setRevision((r) => r + 1);
    } catch (err) {
      if (err instanceof ApiClientError && err.status === 403) {
        setFeedback({
          type: "error",
          message: options?.tamperHash
            ? "Eksekusi dibatalkan (403 APPROVED_PAYLOAD_MISMATCH): Hash payload tidak cocok dengan versi yang disetujui. Audit guardrail telah tercatat."
            : "Server menolak eksekusi (403 ACTION_APPROVAL_REQUIRED): Tindakan belum disetujui. Peristiwa guardrail 'Tindakan tanpa persetujuan diblokir' telah dicatat di Riwayat Audit (SC-11).",
        });
      } else {
        setError(err instanceof Error ? err.message : "Gagal memanggil endpoint eksekusi.");
      }
    } finally {
      setPending(false);
    }
  };

  const handleDownloadIcs = async (action: ProposedAction) => {
    const execResult = (action.execution_result ?? {}) as Record<string, unknown>;
    if (typeof execResult.ics_content === "string") {
      triggerBrowserDownload(
        String(execResult.ics_filename || `pengingat-${action.id.slice(0, 8)}.ics`),
        execResult.ics_content,
        "text/calendar;charset=utf-8",
      );
      return;
    }
    const storedToken =
      typeof window !== "undefined"
        ? window.sessionStorage.getItem("insurra.demo-session")
        : null;
    if (!storedToken) return;
    const res = await fetch(`${config.apiBaseUrl}/api/v1/actions/${action.id}/ics`, {
      headers: { "X-Demo-Session": storedToken },
    });
    if (res.ok) {
      const text = await res.text();
      triggerBrowserDownload(
        `pengingat-${action.id.slice(0, 8)}.ics`,
        text,
        "text/calendar;charset=utf-8",
      );
    }
  };

  const handleDownloadPdf = async (action: ProposedAction) => {
    const storedToken =
      typeof window !== "undefined"
        ? window.sessionStorage.getItem("insurra.demo-session")
        : null;
    if (!storedToken) return;
    const res = await fetch(`${config.apiBaseUrl}/api/v1/actions/${action.id}/pdf`, {
      headers: { "X-Demo-Session": storedToken },
    });
    if (res.ok) {
      const bytes = await res.arrayBuffer();
      triggerBrowserDownload(
        `ringkasan-klaim-${action.id.slice(0, 8)}.pdf`,
        bytes,
        "application/pdf",
      );
    }
  };

  const handleCopyMessageText = async (textToCopy: string) => {
    if (typeof navigator !== "undefined" && navigator.clipboard) {
      await navigator.clipboard.writeText(textToCopy);
      setCopiedText(true);
      setTimeout(() => setCopiedText(false), 2500);
    }
  };

  const handleCreateSandboxSubmissionFromForm = async (action: ProposedAction) => {
    const storedToken =
      typeof window !== "undefined"
        ? window.sessionStorage.getItem("insurra.demo-session")
        : null;
    if (!storedToken) return;

    setPending(true);
    setError(null);
    setFeedback(null);
    try {
      const created = await api.request("post", "/api/v1/actions", {
        headers: { "X-Demo-Session": storedToken },
        body: {
          action_type: "claim_submit",
          title: "Kirim klaim ke penyedia (sandbox) — Lanjutan Formulir Klaim",
          reason:
            "Dibuat dari formulir klaim yang telah selesai untuk dikirim ke penyedia (sandbox)",
          source_screen: "SC-10 · Persetujuan Tindakan",
          permission_level: "L2",
          payload: {
            ...(action.payload ?? {}),
            source_claim_form_action_id: action.id,
            claim_form_status: "COMPLETED",
            sandbox: true,
            provider_sandbox_label: `${String(action.payload?.provider ?? "Penyedia Asuransi")} — Sandbox – bukan penyedia nyata`,
            summary_action: "Klaim akan dikirim ke penyedia (sandbox)",
          } as unknown as Record<string, never>,
        },
      });
      setActiveTab("PENDING");
      setSelectedId(created.id);
      setFeedback({
        type: "success",
        message:
          "Tindakan baru 'Kirim klaim ke penyedia (sandbox)' (Tingkat L2 · SANDBOX) berhasil dibuat dari formulir klaim yang telah selesai.",
      });
      setRevision((r) => r + 1);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Gagal membuat tindakan pengiriman sandbox.",
      );
      setPending(false);
    }
  };

  const handleAdvanceSandboxStatus = async (claimRef: string) => {
    const storedToken =
      typeof window !== "undefined"
        ? window.sessionStorage.getItem("insurra.demo-session")
        : null;
    if (!storedToken || !claimRef) return;

    setPending(true);
    setError(null);
    try {
      const res = await fetch(
        `${config.apiBaseUrl}/api/v1/sandbox/insurer/claims/${encodeURIComponent(claimRef)}?advance=true`,
        {
          headers: { "X-Demo-Session": storedToken },
        },
      );
      if (res.ok) {
        const data = (await res.json()) as {
          claim_ref: string;
          status: string;
          claim_case_status_label?: string;
        };
        setFeedback({
          type: "success",
          message: `[SANDBOX] Status klaim ${data.claim_ref} diperbarui menjadi: ${data.claim_case_status_label ?? data.status}.`,
        });
        setRevision((r) => r + 1);
      }
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Gagal memperbarui status simulasi sandbox.",
      );
    } finally {
      setPending(false);
    }
  };

  const handleExportSandboxLogs = async (format: "json" | "csv") => {
    const storedToken =
      typeof window !== "undefined"
        ? window.sessionStorage.getItem("insurra.demo-session")
        : null;
    if (!storedToken) return;

    try {
      const res = await fetch(
        `${config.apiBaseUrl}/api/v1/sandbox/insurer/logs?format=${format}`,
        {
          headers: { "X-Demo-Session": storedToken },
        },
      );
      if (!res.ok) return;
      const text = await res.text();
      triggerBrowserDownload(
        `sandbox-execution-logs.${format}`,
        text,
        format === "csv" ? "text/csv;charset=utf-8" : "application/json;charset=utf-8",
      );
      setFeedback({
        type: "success",
        message: `[SANDBOX] Log operasi sandbox (${format.toUpperCase()}) berhasil diekspor (memuat timestamp, action_id, dan claim_ref tanpa data pribadi mentah).`,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Gagal mengekspor log sandbox.");
    }
  };

  const handleTestForbiddenActionType = async () => {
    const storedToken =
      typeof window !== "undefined"
        ? window.sessionStorage.getItem("insurra.demo-session")
        : null;
    if (!storedToken) return;

    setPending(true);
    setError(null);
    setFeedback(null);
    try {
      await api.request("post", "/api/v1/actions", {
        headers: { "X-Demo-Session": storedToken },
        body: {
          action_type: "auto_pay_third_party",
          permission_level: "L3",
          reason: "Upaya otomatis membayar tagihan pihak ketiga tanpa izin",
          source_screen: "SC-09 · Kesiapan Klaim",
        },
      });
    } catch (err) {
      if (err instanceof ApiClientError && err.status === 403) {
        setFeedback({
          type: "error",
          message:
            "Server menolak pembuatan tindakan di luar daftar yang diizinkan / tingkat L3 (403 ACTION_TYPE_FORBIDDEN). Peristiwa guardrail tercatat di Riwayat Audit (SC-11).",
        });
      } else {
        setError(err instanceof Error ? err.message : "Gagal menguji guardrail tipe tindakan.");
      }
    } finally {
      setPending(false);
    }
  };

  if (!sessionData && !isAccountMode) {
    if (sessionLoading || authLoading) return null;
    return <SessionRequired />;
  }

  const selectedExecResult = (selectedAction?.execution_result ?? {}) as Record<
    string,
    unknown
  >;

  return (
    <div className="space-y-6 max-w-6xl mx-auto pb-16">
      {/* Header & Navigation Badge */}
      <div className="page-heading flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="eyebrow flex items-center gap-2 text-xs font-semibold tracking-wider text-emerald-700 uppercase">
            <ShieldCheck size={14} />
            <span>Antrean Tindakan &amp; Persetujuan (SC-10 · E8)</span>
            <span
              data-testid="actions-nav-badge"
              className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-amber-100 text-amber-950 border border-amber-300 text-[11px] font-extrabold"
            >
              Menunggu:{" "}
              <strong data-testid="pending-actions-count">{pendingItems.length}</strong>
            </span>
          </div>
          <h1 className="text-2xl md:text-3xl font-bold text-slate-900 tracking-tight mt-1">
            Antrean Tindakan Menunggu Persetujuan
          </h1>
          <p className="text-sm text-slate-600 mt-1">
            Semua draf yang disiapkan agen (pengingat, draf pesan, formulir klaim, pengiriman klaim sandbox) berkumpul di satu tempat. Tidak ada tindakan yang dijalankan tanpa keputusan eksplisit Anda.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            data-testid="btn-export-sandbox-json"
            disabled={pending}
            onClick={() => void handleExportSandboxLogs("json")}
            className="text-xs border-emerald-300 text-emerald-900 hover:bg-emerald-50 flex items-center gap-1.5"
          >
            <Download size={13} />
            Ekspor log sandbox (JSON)
          </Button>
          <Button
            variant="outline"
            size="sm"
            data-testid="btn-export-sandbox-csv"
            disabled={pending}
            onClick={() => void handleExportSandboxLogs("csv")}
            className="text-xs border-emerald-300 text-emerald-900 hover:bg-emerald-50 flex items-center gap-1.5"
          >
            <Download size={13} />
            Ekspor log sandbox (CSV)
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled={pending}
            onClick={() => void handleTestForbiddenActionType()}
            className="text-xs border-amber-300 text-amber-950 hover:bg-amber-50 flex items-center gap-1.5"
          >
            <Shield size={13} />
            Simulasi Tool Terlarang (L3)
          </Button>
          <Link
            href="/audit"
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg border border-slate-300 bg-white text-xs font-semibold text-slate-700 hover:bg-slate-50"
          >
            Lihat Riwayat Audit (SC-11) <ExternalLink size={13} />
          </Link>
          <Button
            variant="outline"
            disabled={pending}
            onClick={() => {
              setPending(true);
              setRevision((r) => r + 1);
            }}
            className="flex items-center gap-1.5 text-xs"
          >
            <RefreshCw size={14} className={pending ? "animate-spin" : ""} />
            Muat Ulang
          </Button>
        </div>
      </div>

      {/* Permission Levels Legend Banner (L0 - L3) */}
      <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-200 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2.5 text-xs">
        <div className="p-2.5 rounded-lg bg-white border border-slate-200/80">
          <span className="font-bold text-slate-700">L0 · Baca / Jelaskan:</span>{" "}
          <span className="text-slate-600">Tanpa persetujuan, tidak masuk antrean.</span>
        </div>
        <div className="p-2.5 rounded-lg bg-white border border-blue-200">
          <span className="font-bold text-blue-900">L1 · Siapkan Draf:</span>{" "}
          <span className="text-slate-600">Masuk antrean, tanpa efek keluar aplikasi.</span>
        </div>
        <div className="p-2.5 rounded-lg bg-white border border-amber-300">
          <span className="font-bold text-amber-950">L2 · Jalankan:</span>{" "}
          <span className="text-slate-600">Hanya setelah persetujuan eksplisit &amp; cek isi.</span>
        </div>
        <div className="p-2.5 rounded-lg bg-white border border-rose-200">
          <span className="font-bold text-rose-900">L3 · Dilarang Server:</span>{" "}
          <span className="text-slate-600">Membayar/mengubah polis/kontak pihak ke-3 otomatis.</span>
        </div>
      </div>

      {/* Consent Gate if demo consent not yet granted */}
      {sessionData && !hasDocumentConsent && (
        <div className="p-6 bg-amber-50 border border-amber-200 rounded-xl flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="space-y-1">
            <div className="text-sm font-bold text-amber-950 flex items-center gap-2">
              <ShieldAlert size={18} className="text-amber-700" />
              Persetujuan Pemrosesan Dokumen Diperlukan
            </div>
            <p className="text-xs text-amber-900">
              Untuk meninjau dan memutuskan draf tindakan agen, aktifkan izin pemrosesan dokumen pada sesi ini.
            </p>
          </div>
          <Button
            variant="default"
            onClick={() => void setConsent(true)}
            className="shrink-0 text-xs"
          >
            Aktifkan Izin &amp; Muat Tindakan
          </Button>
        </div>
      )}

      {error && (
        <div
          role="alert"
          className="p-4 bg-rose-50 border border-rose-200 rounded-xl text-rose-800 text-sm flex items-start gap-3"
        >
          <ShieldAlert size={18} className="shrink-0 mt-0.5 text-rose-600" />
          <div>
            <div className="font-semibold">Kendala Pemrosesan Tindakan</div>
            <p className="text-rose-700 mt-0.5 text-xs">{error}</p>
          </div>
        </div>
      )}

      {feedback && (
        <div
          role="status"
          className={`p-4 rounded-xl border text-xs flex items-start justify-between gap-3 ${
            feedback.type === "success"
              ? "bg-emerald-50 border-emerald-200 text-emerald-900"
              : feedback.type === "warning"
                ? "bg-amber-50 border-amber-200 text-amber-900"
                : "bg-rose-50 border-rose-300 text-rose-900"
          }`}
        >
          <div className="flex items-start gap-2.5">
            {feedback.type === "success" ? (
              <CheckCircle2 size={16} className="text-emerald-700 shrink-0 mt-0.5" />
            ) : (
              <Shield size={16} className="text-rose-700 shrink-0 mt-0.5" />
            )}
            <div className="space-y-1">
              <p className="font-semibold">{feedback.message}</p>
              <Link
                href="/audit"
                className="inline-flex items-center gap-1 underline font-bold"
              >
                Lihat Bukti Eksekusi &amp; Guardrail di Riwayat Audit (SC-11){" "}
                <ExternalLink size={11} />
              </Link>
            </div>
          </div>
          <button
            type="button"
            onClick={() => setFeedback(null)}
            className="text-slate-500 hover:text-slate-800"
          >
            <X size={14} />
          </button>
        </div>
      )}

      {/* Tabs: Menunggu (default), Selesai, Ditolak */}
      <div
        role="tablist"
        aria-label="Filter status antrean tindakan"
        className="flex flex-wrap items-center gap-2 border-b border-slate-200 pb-3"
      >
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === "PENDING"}
          data-testid="tab-menunggu"
          onClick={() => handleTabChange("PENDING")}
          className={`px-4 py-2 rounded-xl text-xs font-bold transition-colors flex items-center gap-2 ${
            activeTab === "PENDING"
              ? "bg-slate-900 text-white shadow-xs"
              : "bg-white text-slate-600 border border-slate-200 hover:bg-slate-50"
          }`}
        >
          <span>Menunggu</span>
          <span
            className={`px-2 py-0.5 rounded-full text-[11px] font-extrabold ${
              activeTab === "PENDING"
                ? "bg-amber-400 text-slate-950"
                : "bg-amber-100 text-amber-900"
            }`}
          >
            {pendingItems.length}
          </span>
        </button>

        <button
          type="button"
          role="tab"
          aria-selected={activeTab === "COMPLETED"}
          data-testid="tab-selesai"
          onClick={() => handleTabChange("COMPLETED")}
          className={`px-4 py-2 rounded-xl text-xs font-bold transition-colors flex items-center gap-2 ${
            activeTab === "COMPLETED"
              ? "bg-slate-900 text-white shadow-xs"
              : "bg-white text-slate-600 border border-slate-200 hover:bg-slate-50"
          }`}
        >
          <span>Selesai</span>
          <span
            className={`px-2 py-0.5 rounded-full text-[11px] font-extrabold ${
              activeTab === "COMPLETED"
                ? "bg-emerald-400 text-slate-950"
                : "bg-slate-100 text-slate-700"
            }`}
          >
            {completedItems.length}
          </span>
        </button>

        <button
          type="button"
          role="tab"
          aria-selected={activeTab === "REJECTED"}
          data-testid="tab-ditolak"
          onClick={() => handleTabChange("REJECTED")}
          className={`px-4 py-2 rounded-xl text-xs font-bold transition-colors flex items-center gap-2 ${
            activeTab === "REJECTED"
              ? "bg-slate-900 text-white shadow-xs"
              : "bg-white text-slate-600 border border-slate-200 hover:bg-slate-50"
          }`}
        >
          <span>Ditolak</span>
          <span
            className={`px-2 py-0.5 rounded-full text-[11px] font-extrabold ${
              activeTab === "REJECTED"
                ? "bg-rose-400 text-slate-950"
                : "bg-slate-100 text-slate-700"
            }`}
          >
            {rejectedItems.length}
          </span>
        </button>
      </div>

      {/* Main Content: Empty State or Queue List + Detail Panel */}
      {loading ? (
        <div className="p-8 text-center text-slate-500 text-sm bg-white rounded-xl border border-slate-200">
          <RefreshCw className="animate-spin inline-block mr-2" size={16} />
          Memuat antrean tindakan...
        </div>
      ) : filteredItems.length === 0 ? (
        <div
          data-testid="actions-empty-state"
          className="p-12 text-center bg-white rounded-2xl border border-slate-200 shadow-xs space-y-3"
        >
          <div className="w-12 h-12 rounded-2xl bg-slate-100 text-slate-500 flex items-center justify-center mx-auto">
            <Inbox size={24} />
          </div>
          <h2 className="text-base font-bold text-slate-900">
            Tidak ada tindakan yang menunggu.
          </h2>
          <p className="text-xs text-slate-500 max-w-md mx-auto">
            {activeTab === "PENDING"
              ? "Seluruh draf tindakan agen telah diputuskan atau belum ada draf baru dari pemeriksaan dokumen dan jalur layanan."
              : activeTab === "COMPLETED"
                ? "Belum ada tindakan yang disetujui atau selesai dijalankan pada sesi ini."
                : "Belum ada tindakan yang ditolak pada sesi ini."}
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
          {/* Queue List */}
          <div className="lg:col-span-5 bg-white rounded-xl border border-slate-200 shadow-xs divide-y divide-slate-100 overflow-hidden">
            <div className="p-4 bg-slate-50/70 border-b border-slate-100 flex items-center justify-between">
              <span className="text-xs font-bold uppercase tracking-wider text-slate-600">
                Daftar Kartu Tindakan ({filteredItems.length})
              </span>
              <span className="text-[11px] text-slate-500">
                Klik kartu untuk pratinjau &amp; eksekusi
              </span>
            </div>
            {filteredItems.map((item) => {
              const isSelected = selectedAction?.id === item.id;
              const isL2 = item.permission_level === "L2";
              const isSandboxAction =
                item.action_type === "claim_submit" ||
                item.action_type === "submit_claim_sandbox";
              const meta = ACTION_TYPE_META[item.action_type] ?? {
                categoryLabel: item.action_type,
                title: item.title ?? item.action_type,
                permissionBadge: `Tingkat ${item.permission_level ?? "L1"}`,
                previewHeading: "Pratinjau Payload Lengkap",
                icon: FileText,
              };
              const TypeIcon = meta.icon;
              const cardTitle = item.title ?? meta.title;
              const cardReason =
                item.reason ??
                String(
                  item.payload?.reason ??
                    "Dibuat oleh agen berdasarkan pemeriksaan dokumen dan aturan polis",
                );

              return (
                <button
                  key={item.id}
                  type="button"
                  data-testid="action-queue-card"
                  onClick={() => handleSelectAction(item)}
                  className={`w-full text-left p-4 transition-colors flex flex-col gap-2.5 ${
                    isSelected
                      ? "bg-emerald-50/60 border-l-4 border-l-emerald-700"
                      : "hover:bg-slate-50"
                  }`}
                >
                  {/* Top Badges: Type Icon + Label, SANDBOX Badge, Permission Level, Status */}
                  <div className="flex items-center justify-between gap-2 flex-wrap">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <span className="inline-flex items-center gap-1.5 text-[11px] font-bold px-2.5 py-0.5 rounded-md bg-slate-100 text-slate-800">
                        <TypeIcon size={13} className="text-emerald-700 shrink-0" />
                        <span>{meta.categoryLabel}</span>
                      </span>
                      {isSandboxAction && (
                        <span
                          data-testid="sandbox-badge"
                          className="text-[10px] font-extrabold px-2 py-0.5 rounded bg-indigo-900 text-white tracking-wider uppercase"
                        >
                          SANDBOX
                        </span>
                      )}
                    </div>

                    <div className="flex items-center gap-1.5 flex-wrap">
                      <span
                        className={`text-[11px] font-bold px-2 py-0.5 rounded uppercase ${
                          isL2
                            ? "bg-amber-100 text-amber-950 border border-amber-300"
                            : "bg-blue-100 text-blue-800"
                        }`}
                      >
                        Izin {item.permission_level ?? "L1"}
                      </span>
                      <span
                        className={`text-[11px] font-bold px-2.5 py-0.5 rounded-full uppercase ${
                          item.status === "APPROVED" || item.status === "COMPLETED"
                            ? "bg-emerald-100 text-emerald-800"
                            : item.status === "REJECTED" || item.status === "FAILED"
                              ? "bg-rose-100 text-rose-800"
                              : "bg-amber-100 text-amber-900"
                        }`}
                      >
                        {STATUS_LABELS[item.status] ?? item.status}
                      </span>
                    </div>
                  </div>

                  {/* Stale > 14 days badge */}
                  {item.is_stale && (
                    <div
                      data-testid="stale-action-badge"
                      className="inline-flex items-center gap-1.5 self-start px-2.5 py-0.5 rounded-md bg-amber-50 border border-amber-300 text-amber-900 text-[11px] font-bold"
                    >
                      <Clock size={12} className="text-amber-700 shrink-0" />
                      <span>{item.stale_label ?? "Mungkin sudah tidak relevan"}</span>
                    </div>
                  )}

                  {/* Card Title */}
                  <div className="text-sm font-bold text-slate-900">{cardTitle}</div>

                  {/* Card Reason */}
                  <p className="text-xs text-slate-700 bg-slate-50 p-2 rounded-lg border border-slate-200/80">
                    <span className="font-semibold text-slate-900">Alasan: </span>
                    {cardReason}
                  </p>

                  {/* Execution Timestamp or Failure Reason on Card */}
                  {item.status === "COMPLETED" && item.executed_at && (
                    <div className="text-[11px] font-semibold text-emerald-800 bg-emerald-50 border border-emerald-200 px-2.5 py-1 rounded-md flex items-center gap-1.5">
                      <CheckCircle2 size={12} className="shrink-0" />
                      <span>Selesai dieksekusi: {formatDateTimeId(item.executed_at)}</span>
                    </div>
                  )}
                  {item.status === "FAILED" && (
                    <div className="text-[11px] font-semibold text-rose-800 bg-rose-50 border border-rose-200 px-2.5 py-1 rounded-md flex items-center gap-1.5">
                      <AlertTriangle size={12} className="shrink-0" />
                      <span>Gagal: {item.failure_reason ?? "Klik untuk mencoba lagi"}</span>
                    </div>
                  )}

                  {/* Footer Meta: Source Screen & Created Date */}
                  <div className="flex items-center justify-between gap-2 text-[11px] text-slate-500 pt-0.5">
                    <span className="font-medium text-slate-700 bg-slate-100 px-2 py-0.5 rounded">
                      {item.source_screen ?? "SC-04 · Cek Kelengkapan Data"}
                    </span>
                    <span title={item.created_at}>
                      {formatRelativeDateId(item.created_at)} ·{" "}
                      {formatAbsoluteDateId(item.created_at)}
                    </span>
                  </div>
                </button>
              );
            })}
          </div>

          {/* Detail Panel */}
          {selectedAction && (
            <div className="lg:col-span-7 bg-white rounded-xl border border-slate-200 shadow-xs overflow-hidden">
              <div className="p-5 bg-slate-50/70 border-b border-slate-200 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div className="space-y-1.5">
                  <div className="flex items-center gap-2 flex-wrap">
                    {(selectedAction.action_type === "claim_submit" ||
                      selectedAction.action_type === "submit_claim_sandbox") && (
                      <span
                        data-testid="detail-sandbox-badge"
                        className="text-xs font-extrabold px-2.5 py-0.5 rounded bg-indigo-900 text-white tracking-wider uppercase"
                      >
                        SANDBOX
                      </span>
                    )}
                    <span
                      className={`text-xs font-bold px-2.5 py-0.5 rounded uppercase ${
                        selectedAction.permission_level === "L2"
                          ? "bg-amber-100 text-amber-950 border border-amber-300"
                          : "bg-blue-100 text-blue-900"
                      }`}
                    >
                      Izin {selectedAction.permission_level ?? "L1"}
                    </span>
                    <span className="text-xs px-2 py-0.5 rounded bg-slate-200/70 text-slate-700 font-medium">
                      {selectedAction.source_screen ?? "SC-10"}
                    </span>
                    <span
                      data-testid="action-detail-status"
                      className={`text-xs font-bold px-2.5 py-0.5 rounded-full uppercase ${
                        selectedAction.status === "APPROVED" ||
                        selectedAction.status === "COMPLETED"
                          ? "bg-emerald-100 text-emerald-800"
                          : selectedAction.status === "REJECTED" ||
                              selectedAction.status === "FAILED"
                            ? "bg-rose-100 text-rose-800"
                            : "bg-amber-100 text-amber-900"
                      }`}
                    >
                      {STATUS_LABELS[selectedAction.status] ?? selectedAction.status}
                    </span>
                    {selectedAction.is_stale && (
                      <span className="text-xs font-bold px-2.5 py-0.5 rounded bg-amber-100 text-amber-900 border border-amber-300">
                        {selectedAction.stale_label ?? "Mungkin sudah tidak relevan"}
                      </span>
                    )}
                  </div>
                  <h2 className="text-lg font-bold text-slate-900">
                    {selectedAction.title ??
                      ACTION_TYPE_META[selectedAction.action_type]?.title ??
                      selectedAction.action_type}
                  </h2>
                  <p className="text-xs text-slate-600">
                    <strong>Alasan pembuatan:</strong>{" "}
                    {selectedAction.reason ??
                      String(selectedAction.payload?.reason ?? "-")}
                  </p>
                </div>
              </div>

              <div className="p-6 space-y-6">
                {/* Immutable Notice if already APPROVED / COMPLETED / FAILED / REJECTED */}
                {selectedAction.status !== "PENDING" && (
                  <div className="p-4 rounded-xl border border-slate-200 bg-slate-50 flex items-start gap-3 text-xs text-slate-700">
                    <Lock size={16} className="text-slate-500 shrink-0 mt-0.5" />
                    <div className="space-y-1 w-full">
                      <div className="flex items-center justify-between flex-wrap gap-2">
                        <span className="font-bold text-slate-900">
                          Status Akhir: {STATUS_LABELS[selectedAction.status]}
                        </span>
                        {selectedAction.executed_at && (
                          <span
                            data-testid="action-executed-at"
                            className="text-emerald-800 font-semibold"
                          >
                            Waktu eksekusi: {formatDateTimeId(selectedAction.executed_at)}
                          </span>
                        )}
                      </div>
                      <p>
                        Payload tidak bisa diubah setelah disetujui; perubahan harus lewat draf baru.
                      </p>
                      {selectedAction.approved_payload_sha256 && (
                        <p className="font-mono text-[11px] text-emerald-800 pt-1 break-all">
                          SHA-256 Terikat: {selectedAction.approved_payload_sha256}
                        </p>
                      )}
                      {selectedAction.reason && (
                        <p className="text-slate-800 font-semibold pt-1">
                          Alasan: {selectedAction.reason}
                        </p>
                      )}
                    </div>
                  </div>
                )}

                {/* Failed State Banner + "Coba lagi" Button (US-10-03) */}
                {selectedAction.status === "FAILED" && (
                  <div
                    role="alert"
                    data-testid="execution-failed-box"
                    className="p-4 rounded-xl border-2 border-rose-300 bg-rose-50 text-rose-950 text-xs flex flex-col sm:flex-row sm:items-center justify-between gap-3"
                  >
                    <div className="space-y-1">
                      <div className="font-bold flex items-center gap-1.5">
                        <AlertTriangle size={15} className="text-rose-700" />
                        Eksekusi Tindakan Gagal
                      </div>
                      <p>{selectedAction.failure_reason ?? "Terjadi kendala saat menjalankan tindakan."}</p>
                    </div>
                    <Button
                      variant="default"
                      size="sm"
                      data-testid="btn-retry-execute"
                      disabled={pending}
                      onClick={() => void handleExecuteAction(selectedAction)}
                      className="shrink-0 text-xs bg-rose-700 hover:bg-rose-800 text-white flex items-center gap-1.5"
                    >
                      <RotateCcw size={13} />
                      Coba lagi
                    </Button>
                  </div>
                )}

                {/* US-10-03 & US-10-04 Execution Output & Artifact Controls when COMPLETED */}
                {selectedAction.status === "COMPLETED" && (
                  <div
                    data-testid="execution-artifacts-panel"
                    className="p-5 rounded-xl border-2 border-emerald-300 bg-emerald-50/60 space-y-4"
                  >
                    <div className="flex items-center justify-between flex-wrap gap-2">
                      <div className="flex items-center gap-2 text-xs font-bold text-emerald-950 uppercase tracking-wide">
                        <CheckCircle2 size={16} className="text-emerald-700" />
                        <span>Hasil Eksekusi Tindakan (Data Sensitif Tersamar)</span>
                      </div>
                      {selectedAction.executed_at && (
                        <span className="text-[11px] font-semibold text-emerald-900">
                          Dieksekusi: {formatDateTimeId(selectedAction.executed_at)}
                        </span>
                      )}
                    </div>

                    {/* 1. Pengingat (.ics download + Google Calendar) */}
                    {selectedAction.action_type === "create_reminder" && (
                      <div className="space-y-3 text-xs">
                        <p className="text-emerald-900">
                          File kalender <strong>.ics</strong> telah disiapkan untuk tanggal{" "}
                          <strong>{String(selectedExecResult.reminder_date ?? selectedAction.payload?.reminder_date ?? "-")}</strong>{" "}
                          tanpa memuat nomor polis lengkap, NIK, paspor, atau visa.
                        </p>
                        <div className="flex flex-wrap items-center gap-2.5">
                          <Button
                            variant="default"
                            size="sm"
                            data-testid="btn-download-ics"
                            onClick={() => void handleDownloadIcs(selectedAction)}
                            className="text-xs flex items-center gap-1.5"
                          >
                            <Download size={14} />
                            Unduh File .ics
                          </Button>
                          {typeof selectedExecResult.google_calendar_url === "string" && (
                            <a
                              href={selectedExecResult.google_calendar_url}
                              target="_blank"
                              rel="noopener noreferrer"
                              data-testid="btn-google-calendar"
                              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg border border-emerald-400 bg-white text-xs font-bold text-emerald-900 hover:bg-emerald-100"
                            >
                              <CalendarPlus size={14} />
                              Tambah ke Google Calendar
                            </a>
                          )}
                        </div>
                      </div>
                    )}

                    {/* 2. Draf Pesan (mailto + Salin teks) */}
                    {selectedAction.action_type === "draft_message" && (
                      <div className="space-y-3 text-xs">
                        <p className="text-emerald-900">
                          Aplikasi tidak mengirim email sendiri. Gunakan tombol di bawah untuk membuka aplikasi email Anda dengan subjek dan isi sesuai versi yang disetujui:
                        </p>
                        <div className="flex flex-wrap items-center gap-2.5">
                          <a
                            href={String(selectedExecResult.mailto_url ?? "mailto:")}
                            data-testid="btn-open-mailto"
                            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-emerald-700 text-white text-xs font-bold hover:bg-emerald-800"
                          >
                            <Mail size={14} />
                            Buka di aplikasi email
                          </a>
                          <Button
                            variant="outline"
                            size="sm"
                            data-testid="btn-copy-message"
                            onClick={() =>
                              void handleCopyMessageText(
                                String(
                                  selectedExecResult.copy_text ??
                                    selectedAction.payload?.message ??
                                    "",
                                ),
                              )
                            }
                            className="text-xs flex items-center gap-1.5 bg-white"
                          >
                            <Copy size={13} />
                            {copiedText ? "Teks Tersalin!" : "Salin teks"}
                          </Button>
                        </div>
                      </div>
                    )}

                    {/* 3. Formulir Klaim (PDF Ringkasan + Daftar Lampiran + Kirim ke penyedia sandbox) */}
                    {selectedAction.action_type === "draft_claim_form" && (
                      <div className="space-y-3 text-xs">
                        <p className="text-emerald-900">
                          Ringkasan klaim PDF beserta daftar lampiran telah dibuat dengan nomor polis tersamar (<strong>{String(selectedAction.payload?.policy_number ?? "****1234")}</strong>).
                        </p>
                        {Array.isArray(selectedExecResult.attachments_list) && (
                          <div className="p-3 rounded-lg bg-white border border-emerald-200 space-y-1">
                            <div className="font-bold text-slate-800">
                              Daftar Lampiran Klaim:
                            </div>
                            <ul className="list-disc list-inside text-slate-700 space-y-0.5">
                              {(selectedExecResult.attachments_list as string[]).map(
                                (att, idx) => (
                                  <li key={idx}>{att}</li>
                                ),
                              )}
                            </ul>
                          </div>
                        )}
                        <div className="flex flex-wrap items-center gap-2.5">
                          <Button
                            variant="default"
                            size="sm"
                            data-testid="btn-download-pdf"
                            onClick={() => void handleDownloadPdf(selectedAction)}
                            className="text-xs flex items-center gap-1.5"
                          >
                            <Download size={14} />
                            Unduh PDF Ringkasan Klaim
                          </Button>
                          <Button
                            variant="outline"
                            size="sm"
                            data-testid="btn-create-sandbox-action"
                            disabled={pending}
                            onClick={() =>
                              void handleCreateSandboxSubmissionFromForm(selectedAction)
                            }
                            className="text-xs flex items-center gap-1.5 bg-white border-amber-400 text-amber-950 hover:bg-amber-50 font-bold"
                          >
                            <Send size={13} />
                            Kirim ke penyedia (sandbox)
                          </Button>
                        </div>
                      </div>
                    )}

                    {/* 4. Kirim Klaim ke Penyedia (Sandbox) — US-10-04 */}
                    {(selectedAction.action_type === "claim_submit" ||
                      selectedAction.action_type === "submit_claim_sandbox") && (
                      <div
                        data-testid="sandbox-submission-result"
                        className="p-4 rounded-xl bg-white border-2 border-indigo-200 space-y-3.5 text-xs"
                      >
                        <div className="flex items-center justify-between flex-wrap gap-2">
                          <div className="flex items-center gap-2">
                            <span className="text-[11px] font-extrabold px-2.5 py-0.5 rounded bg-indigo-900 text-white tracking-wider uppercase">
                              SANDBOX
                            </span>
                            <span className="font-bold text-slate-900">
                              {String(
                                selectedExecResult.provider_label ??
                                  selectedAction.payload?.provider_label ??
                                  "Sandbox – bukan penyedia nyata",
                              )}
                            </span>
                          </div>
                          <span className="text-[11px] font-bold px-2.5 py-0.5 rounded-full bg-emerald-100 text-emerald-900">
                            Status Awal: {String(selectedExecResult.initial_status ?? selectedExecResult.status ?? "Diterima")}
                          </span>
                        </div>

                        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                          <div className="p-2.5 rounded-lg bg-slate-50 border border-slate-200">
                            <div className="text-[10px] uppercase font-bold text-slate-500">
                              Nomor Klaim Sandbox (claim_ref)
                            </div>
                            <div
                              data-testid="sandbox-claim-ref"
                              className="text-sm font-extrabold font-mono text-indigo-950 mt-0.5"
                            >
                              {String(selectedExecResult.claim_ref ?? "-")}
                            </div>
                          </div>
                          <div className="p-2.5 rounded-lg bg-slate-50 border border-slate-200">
                            <div className="text-[10px] uppercase font-bold text-slate-500">
                              Status Kasus Klaim
                            </div>
                            <div
                              data-testid="sandbox-case-status"
                              className="text-sm font-extrabold text-emerald-800 mt-0.5"
                            >
                              {String(
                                selectedExecResult.claim_case_status_label ??
                                  selectedExecResult.status ??
                                  "Diajukan",
                              )}
                            </div>
                          </div>
                          <div className="p-2.5 rounded-lg bg-slate-50 border border-slate-200">
                            <div className="text-[10px] uppercase font-bold text-slate-500">
                              Waktu Pengiriman
                            </div>
                            <div className="text-xs font-semibold text-slate-800 mt-0.5">
                              {formatDateTimeId(
                                String(
                                  selectedExecResult.submitted_at ??
                                    selectedAction.executed_at ??
                                    "",
                                ),
                              )}
                            </div>
                          </div>
                        </div>

                        {/* Simulated Timeline (Diajukan -> Diproses -> Disetujui / Ditolak) */}
                        {Array.isArray(selectedExecResult.status_timeline) && (
                          <div className="p-3 rounded-lg bg-indigo-50/60 border border-indigo-200 space-y-2">
                            <div className="flex items-center justify-between flex-wrap gap-2">
                              <span className="font-bold text-indigo-950">
                                Simulasi Progres Status Sandbox (≤ 1 menit):
                              </span>
                              {typeof selectedExecResult.claim_ref === "string" && (
                                <Button
                                  variant="outline"
                                  size="sm"
                                  data-testid="btn-advance-sandbox-status"
                                  disabled={pending}
                                  onClick={() =>
                                    void handleAdvanceSandboxStatus(
                                      String(selectedExecResult.claim_ref),
                                    )
                                  }
                                  className="h-7 px-2.5 text-[11px] bg-white border-indigo-300 text-indigo-950 hover:bg-indigo-100"
                                >
                                  Simulasikan Status Berikutnya (Diajukan → Diproses → Disetujui)
                                </Button>
                              )}
                            </div>
                            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                              {(
                                selectedExecResult.status_timeline as Array<
                                  Record<string, unknown>
                                >
                              ).map((stepObj, idx) => (
                                <div
                                  key={idx}
                                  className="p-2 rounded bg-white border border-indigo-100 text-[11px]"
                                >
                                  <div className="font-bold text-indigo-950">
                                    {idx + 1}. {String(stepObj.status ?? "-")}
                                  </div>
                                  <div className="text-slate-600 mt-0.5">
                                    {String(stepObj.note ?? "")}
                                  </div>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}

                        {/* Sent Attachment References (document_id + sha256) */}
                        {Array.isArray(selectedExecResult.attachments_sent) && (
                          <div className="p-3 rounded-lg bg-slate-50 border border-slate-200 space-y-1.5">
                            <div className="font-bold text-slate-800">
                              Referensi Lampiran Terkirim (document_id &amp; sha256, tanpa file mentah):
                            </div>
                            <ul className="space-y-1 font-mono text-[11px] text-slate-700">
                              {(
                                selectedExecResult.attachments_sent as Array<
                                  Record<string, unknown>
                                >
                              ).map((att, idx) => (
                                <li key={idx} className="break-all">
                                  • doc_id: {String(att.document_id ?? "-")} | sha256:{" "}
                                  {String(att.sha256 ?? "-")}
                                </li>
                              ))}
                            </ul>
                          </div>
                        )}

                        <div className="flex flex-wrap items-center gap-2.5 pt-1">
                          <Link
                            href={`/claims?case_id=${encodeURIComponent(
                              String(
                                selectedExecResult.claim_case_id ??
                                  selectedAction.payload?.claim_case_id ??
                                  "",
                              ),
                            )}&claim_ref=${encodeURIComponent(
                              String(selectedExecResult.claim_ref ?? ""),
                            )}`}
                            data-testid="btn-lihat-kasus"
                            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-indigo-900 text-white text-xs font-bold hover:bg-indigo-950"
                          >
                            Lihat kasus <ExternalLink size={13} />
                          </Link>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => void handleDownloadPdf(selectedAction)}
                            className="text-xs flex items-center gap-1.5 bg-white"
                          >
                            <Download size={13} />
                            Unduh PDF Ringkasan Klaim
                          </Button>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => void handleExportSandboxLogs("json")}
                            className="text-xs flex items-center gap-1.5 bg-white border-emerald-400 text-emerald-950"
                          >
                            <Download size={13} />
                            Ekspor log sandbox (JSON)
                          </Button>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => void handleExportSandboxLogs("csv")}
                            className="text-xs flex items-center gap-1.5 bg-white border-emerald-400 text-emerald-950"
                          >
                            <Download size={13} />
                            Ekspor log sandbox (CSV)
                          </Button>
                        </div>
                      </div>
                    )}

                    {/* Idempotency & Hash Guardrail Verification Controls */}
                    <div className="pt-3 border-t border-emerald-200/80 flex flex-wrap items-center justify-between gap-2">
                      <span className="text-[11px] text-emerald-900">
                        Verifikasi keamanan eksekusi server:
                      </span>
                      <div className="flex flex-wrap items-center gap-2">
                        <Button
                          variant="outline"
                          size="sm"
                          data-testid="btn-execute-idempotent"
                          disabled={pending}
                          onClick={() => void handleExecuteAction(selectedAction)}
                          className="text-[11px] bg-white h-7 px-2.5"
                        >
                          Jalankan Ulang (Uji Idempoten)
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          data-testid="btn-test-hash-mismatch"
                          disabled={pending}
                          onClick={() =>
                            void handleExecuteAction(selectedAction, { tamperHash: true })
                          }
                          className="text-[11px] bg-white border-amber-300 text-amber-950 h-7 px-2.5"
                        >
                          Uji Hash Tidak Cocok (403)
                        </Button>
                      </div>
                    </div>
                  </div>
                )}

                {/* Document-Sourced Modification Warning Banner */}
                {isEditing && modifiedDocFields.length > 0 && (
                  <div
                    role="alert"
                    data-testid="doc-field-edit-warning"
                    className="p-4 rounded-xl border border-amber-400 bg-amber-50 text-amber-950 text-xs flex items-start gap-3"
                  >
                    <AlertTriangle size={18} className="text-amber-700 shrink-0 mt-0.5" />
                    <div className="space-y-1">
                      <div className="font-bold">
                        Peringatan: Field Bersumber dari Dokumen Diubah
                      </div>
                      <p>
                        Anda mengubah field yang diekstrak dari dokumen resmi (
                        <strong>
                          {modifiedDocFields.map((f) => FIELD_LABELS[f] ?? f).join(", ")}
                        </strong>
                        ). Mengubah nilai sumber dokumen dapat menyebabkan ketidaksesuaian saat verifikasi klaim.
                      </p>
                    </div>
                  </div>
                )}

                {/* Pratinjau Payload Lengkap (Isi Email / Pengingat / Formulir) */}
                <div
                  data-testid="action-payload-preview"
                  className="p-4 rounded-xl bg-slate-900 text-slate-100 space-y-2.5"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[11px] font-bold uppercase tracking-wider text-emerald-400">
                      {ACTION_TYPE_META[selectedAction.action_type]?.previewHeading ??
                        "Pratinjau Payload Lengkap (Data Pribadi Tersamar)"}
                    </span>
                    <span className="text-[11px] px-2 py-0.5 rounded bg-slate-800 text-slate-300 font-mono">
                      Polis: {String(selectedAction.payload?.policy_number ?? "****1234")}
                    </span>
                  </div>
                  <p className="text-xs text-slate-200 leading-relaxed whitespace-pre-wrap font-mono">
                    {String(
                      (isEditing ? draftPayload.message : selectedAction.payload?.message) ??
                        selectedAction.preview,
                    )}
                  </p>
                </div>

                {/* Payload Fields Viewer / Editor */}
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <h3 className="text-xs font-bold uppercase tracking-wider text-slate-500">
                      {isEditing ? "Mode Ubah — Edit Isi Payload" : "Rincian Field Payload"}
                    </h3>
                    {isEditing && (
                      <button
                        type="button"
                        onClick={handleCancelEdit}
                        className="text-xs text-slate-500 hover:text-slate-800 underline"
                      >
                        Batalkan Mode Ubah
                      </button>
                    )}
                  </div>

                  <div className="grid grid-cols-1 gap-3.5">
                    {EDITABLE_PAYLOAD_KEYS.map((fieldKey) => {
                      const payloadObj = (selectedAction.payload ?? {}) as Record<string, unknown>;
                      if (!(fieldKey in payloadObj)) return null;

                      const isDocSourced = documentSourcedFields.includes(fieldKey);
                      const currentVal = String(
                        (isEditing ? draftPayload[fieldKey] : payloadObj[fieldKey]) ?? "",
                      );
                      const originalVal = String(payloadObj[fieldKey] ?? "");
                      const isModifiedDocField =
                        isEditing && isDocSourced && currentVal !== originalVal;

                      return (
                        <div
                          key={fieldKey}
                          className={`p-3.5 rounded-xl border ${
                            isModifiedDocField
                              ? "border-amber-400 bg-amber-50/50"
                              : "border-slate-200 bg-slate-50/60"
                          }`}
                        >
                          <div className="flex items-center justify-between gap-2 mb-1.5">
                            <label
                              htmlFor={`field-${fieldKey}`}
                              className="text-xs font-bold text-slate-800"
                            >
                              {FIELD_LABELS[fieldKey] ?? fieldKey}
                            </label>
                            {isDocSourced ? (
                              <span className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded bg-emerald-100 text-emerald-900">
                                <FileText size={10} /> Sumber Dokumen
                              </span>
                            ) : (
                              <span className="text-[10px] font-semibold px-2 py-0.5 rounded bg-slate-200 text-slate-700">
                                Dapat Diedit
                              </span>
                            )}
                          </div>

                          {isEditing ? (
                            fieldKey === "message" || fieldKey === "additional_notes" ? (
                              <textarea
                                id={`field-${fieldKey}`}
                                rows={3}
                                value={currentVal}
                                onChange={(e) =>
                                  setDraftPayload((prev) => ({
                                    ...prev,
                                    [fieldKey]: e.target.value,
                                  }))
                                }
                                className="w-full text-xs border border-slate-300 rounded-lg p-2.5 bg-white text-slate-900 focus:outline-none focus:ring-2 focus:ring-emerald-600"
                              />
                            ) : (
                              <input
                                id={`field-${fieldKey}`}
                                type={fieldKey.includes("date") ? "date" : "text"}
                                value={currentVal}
                                onChange={(e) =>
                                  setDraftPayload((prev) => ({
                                    ...prev,
                                    [fieldKey]: e.target.value,
                                  }))
                                }
                                placeholder="Kosong — klik untuk mengisi..."
                                className="w-full text-xs border border-slate-300 rounded-lg px-3 py-2 bg-white text-slate-900 focus:outline-none focus:ring-2 focus:ring-emerald-600"
                              />
                            )
                          ) : (
                            <div className="text-xs text-slate-800 font-mono whitespace-pre-wrap">
                              {currentVal || (
                                <span className="italic text-slate-400">
                                  (Kosong — klik Ubah untuk melengkapi)
                                </span>
                              )}
                            </div>
                          )}

                          {isModifiedDocField && (
                            <p className="text-[11px] text-amber-800 font-semibold mt-1.5 flex items-center gap-1">
                              <AlertTriangle size={12} />
                              Peringatan: Nilai berbeda dari dokumen sumber ({originalVal}).
                            </p>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>

                {/* L2 Confirmation Section when Action is PENDING and L2 */}
                {selectedAction.status === "PENDING" &&
                  selectedAction.permission_level === "L2" && (
                    <div
                      data-testid="l2-confirmation-box"
                      className="p-4 rounded-xl border-2 border-amber-300 bg-amber-50/70 space-y-3"
                    >
                      <div className="flex items-start gap-2.5">
                        <ShieldAlert size={18} className="text-amber-800 shrink-0 mt-0.5" />
                        <div className="space-y-2 text-xs w-full">
                          <div className="flex items-center justify-between flex-wrap gap-2">
                            <span className="font-bold text-amber-950 uppercase tracking-wide">
                              Konfirmasi Tingkat L2 Diperlukan
                            </span>
                            {(selectedAction.action_type === "claim_submit" ||
                              selectedAction.action_type === "submit_claim_sandbox") && (
                              <span className="text-[10px] font-extrabold px-2 py-0.5 rounded bg-indigo-900 text-white tracking-wider uppercase">
                                SANDBOX – BUKAN PENYEDIA NYATA
                              </span>
                            )}
                          </div>
                          <p className="text-amber-900 font-medium">
                            Ringkasan dampak:{" "}
                            <strong>
                              {String(
                                selectedAction.payload?.summary_action ??
                                  "Klaim akan dikirim ke penyedia (sandbox)",
                              )}
                            </strong>
                          </p>
                          {(selectedAction.action_type === "claim_submit" ||
                            selectedAction.action_type === "submit_claim_sandbox") && (
                            <div className="p-3 rounded-lg bg-white border border-amber-200 space-y-1.5 text-slate-800">
                              <div>
                                <strong>Penyedia tujuan:</strong>{" "}
                                {String(
                                  selectedAction.payload?.provider ??
                                    "Allianz Care Australia",
                                )}{" "}
                                <span className="inline-block px-1.5 py-0.5 rounded bg-indigo-100 text-indigo-950 font-bold text-[10px]">
                                  Sandbox – bukan penyedia nyata
                                </span>
                              </div>
                              <div>
                                <strong>Ringkasan isi:</strong> Polis{" "}
                                {String(selectedAction.payload?.policy_number ?? "****1234")} ·
                                Diagnosis{" "}
                                {String(selectedAction.payload?.diagnosis_code ?? "-")} ·
                                Nominal{" "}
                                {String(selectedAction.payload?.claim_amount ?? "-")}
                              </div>
                              {Array.isArray(selectedAction.payload?.attachments) && (
                                <div>
                                  <strong>Daftar lampiran (referensi document_id &amp; sha256):</strong>
                                  <ul className="list-disc list-inside font-mono text-[11px] text-slate-700 mt-0.5 space-y-0.5">
                                    {(
                                      selectedAction.payload?.attachments as Array<
                                        Record<string, unknown>
                                      >
                                    ).map((att, idx) => (
                                      <li key={idx} className="break-all">
                                        {String(att.filename ?? att.document_id ?? "-")} (sha256:{" "}
                                        {String(att.sha256 ?? "-").slice(0, 16)}...)
                                      </li>
                                    ))}
                                  </ul>
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      </div>
                      <label className="flex items-center gap-2.5 cursor-pointer text-xs font-bold text-slate-900 pt-1">
                        <input
                          type="checkbox"
                          checked={l2Checked}
                          onChange={(e) => setL2Checked(e.target.checked)}
                          className="w-4 h-4 rounded border-amber-400 text-emerald-700 focus:ring-emerald-600"
                        />
                        <span>Saya sudah memeriksa isinya</span>
                      </label>
                    </div>
                  )}

                {/* Decision Buttons: Setujui, Ubah, Tolak (Only when PENDING) */}
                {selectedAction.status === "PENDING" ? (
                  <div className="pt-4 border-t border-slate-200 flex flex-wrap items-center justify-between gap-3">
                    <div className="flex flex-wrap items-center gap-2.5">
                      <Button
                        variant="default"
                        disabled={
                          pending ||
                          (selectedAction.permission_level === "L2" && !l2Checked)
                        }
                        onClick={() =>
                          void submitApprove(
                            selectedAction,
                            selectedAction.permission_level === "L2" ? l2Checked : true,
                          )
                        }
                        className="flex items-center gap-1.5 text-xs"
                      >
                        <CheckCircle2 size={15} />
                        Setujui
                      </Button>

                      {!isEditing && (
                        <Button
                          variant="outline"
                          disabled={pending}
                          onClick={handleStartEdit}
                          className="flex items-center gap-1.5 text-xs"
                        >
                          <Edit3 size={14} />
                          Ubah
                        </Button>
                      )}

                      <Button
                        variant="outline"
                        disabled={pending}
                        onClick={() => setShowRejectModal(true)}
                        className="flex items-center gap-1.5 text-xs border-rose-300 text-rose-700 hover:bg-rose-50"
                      >
                        <XCircle size={14} />
                        Tolak
                      </Button>
                    </div>

                    {/* Guardrail Test Button for unapproved execution */}
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={pending}
                      onClick={() => void handleExecuteAction(selectedAction)}
                      className="text-xs text-amber-900 hover:bg-amber-100 flex items-center gap-1.5"
                    >
                      <Shield size={13} />
                      Uji Eksekusi Tanpa Persetujuan (403)
                    </Button>
                  </div>
                ) : (
                  selectedAction.status === "APPROVED" && (
                    <div className="pt-4 border-t border-slate-200 flex items-center justify-between gap-3">
                      <span className="text-xs text-emerald-800 font-semibold flex items-center gap-1.5">
                        <CheckCircle2 size={15} /> Disetujui — Tombol Ubah dikunci demi integritas hash payload.
                      </span>
                      <Button
                        variant="default"
                        size="sm"
                        disabled={pending}
                        onClick={() => void handleExecuteAction(selectedAction)}
                        className="text-xs flex items-center gap-1.5"
                      >
                        <Play size={13} />
                        Jalankan Tindakan
                      </Button>
                    </div>
                  )
                )}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Dialog Tolak Modal */}
      {showRejectModal && selectedAction && (
        <div className="fixed inset-0 z-50 bg-slate-950/50 backdrop-blur-xs flex items-center justify-center p-4">
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="reject-modal-title"
            className="w-full max-w-md bg-white rounded-2xl shadow-2xl border border-slate-200 overflow-hidden"
          >
            <div className="p-4 bg-slate-50 border-b border-slate-200 flex items-center justify-between">
              <h3 id="reject-modal-title" className="text-sm font-bold text-slate-900">
                Tolak Tindakan Agen
              </h3>
              <button
                type="button"
                onClick={() => setShowRejectModal(false)}
                className="text-slate-500 hover:text-slate-800"
              >
                <X size={16} />
              </button>
            </div>
            <div className="p-5 space-y-4 text-xs">
              <p className="text-slate-600">
                Pilih alasan penolakan untuk dicatat secara transparan di Riwayat Audit:
              </p>
              <div className="space-y-2">
                {REJECT_REASONS.map((reasonOption) => (
                  <label
                    key={reasonOption}
                    className={`flex items-center gap-2.5 p-3 rounded-xl border cursor-pointer ${
                      selectedRejectReason === reasonOption
                        ? "border-rose-500 bg-rose-50/60 font-bold text-rose-950"
                        : "border-slate-200 hover:bg-slate-50 text-slate-700"
                    }`}
                  >
                    <input
                      type="radio"
                      name="reject-reason"
                      value={reasonOption}
                      checked={selectedRejectReason === reasonOption}
                      onChange={() => setSelectedRejectReason(reasonOption)}
                    />
                    <span>{reasonOption}</span>
                  </label>
                ))}
              </div>
              {selectedRejectReason === "Lainnya" && (
                <input
                  type="text"
                  value={customRejectReason}
                  onChange={(e) => setCustomRejectReason(e.target.value)}
                  placeholder="Tuliskan alasan penolakan..."
                  className="w-full border border-slate-300 rounded-lg px-3 py-2 text-xs"
                />
              )}
            </div>
            <div className="p-4 bg-slate-50 border-t border-slate-200 flex justify-end gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setShowRejectModal(false)}
                className="text-xs"
              >
                Batal
              </Button>
              <Button
                variant="default"
                size="sm"
                disabled={pending}
                onClick={() => void submitReject(selectedAction)}
                className="text-xs bg-rose-700 hover:bg-rose-800 text-white"
              >
                Konfirmasi Tolak
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default function ActionsPage() {
  return (
    <Suspense
      fallback={
        <div className="p-8 text-center text-slate-500 text-sm">
          Memuat antrean tindakan...
        </div>
      }
    >
      <ActionsPageContent />
    </Suspense>
  );
}
