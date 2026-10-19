"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  AlertTriangle,
  CheckCircle2,
  Edit3,
  ExternalLink,
  FileText,
  Lock,
  Play,
  RefreshCw,
  Shield,
  ShieldAlert,
  ShieldCheck,
  X,
  XCircle,
} from "lucide-react";
import { useSession } from "@/lib/session";
import { useAuth } from "@/lib/auth";
import { api, ApiClientError } from "@/lib/api/client";
import type { components } from "@/lib/api/types.gen";
import { Button } from "@/components/ui/button";
import { SessionRequired } from "@/components/session-required";

type ProposedAction = components["schemas"]["ProposedAction"];

const REJECT_REASONS = [
  "Tidak perlu",
  "Isi salah",
  "Nanti saja",
  "Lainnya",
] as const;

const FIELD_LABELS: Record<string, string> = {
  message: "Isi Pesan",
  reminder_date: "Tanggal Pengingat",
  bank_account_holder: "Nama Pemilik Rekening (Field Formulir Kosong)",
  additional_notes: "Catatan Tambahan Klaim (Field Formulir Kosong)",
  recipient_department: "Divisi Penerima (Field Formulir Kosong)",
  notification_channel: "Kanal Pengingat (Field Formulir Kosong)",
  provider: "Penyedia Asuransi",
  policy_number: "Nomor Polis",
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

const ACTION_TYPE_LABELS: Record<string, string> = {
  claim_submit: "Pengiriman Klaim ke Penyedia (Sandbox)",
  draft_claim_form: "Penyusunan Formulir Klaim",
  draft_message: "Draf Pesan ke Penyedia Asuransi",
  create_reminder: "Pengingat Perpanjangan Perlindungan",
};

export default function ActionsPage() {
  const { data: sessionData, loading: sessionLoading, setConsent } = useSession();
  const { account, token: authToken, loading: authLoading } = useAuth();

  const [actionsList, setActionsList] = useState<ProposedAction[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState(false);
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
          const items = await api.request("get", "/api/v1/actions", {
            headers: { "X-Demo-Session": storedToken },
            query: { seed_demo: true },
          });
          if (active) {
            setActionsList(items);
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
  }, [sessionId, hasDocumentConsent, isAccountMode, revision]);

  const selectedAction =
    actionsList.find((item) => item.id === selectedId) ?? actionsList[0] ?? null;

  const handleSelectAction = (action: ProposedAction) => {
    setSelectedId(action.id);
    setIsEditing(false);
    setL2Checked(false);
    setShowRejectModal(false);
    setFeedback(null);
    setDraftPayload({ ...(action.payload ?? {}) });
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

      setIsEditing(false);
      setFeedback({
        type: "success",
        message:
          isEditing && hasPayloadChanges
            ? "Perubahan disimpan dan tindakan berhasil disetujui. Hash versi terbaru tercatat di server dan log audit."
            : "Tindakan berhasil disetujui dengan hash payload terikat di server.",
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

  const handleTestExecute = async (action: ProposedAction) => {
    const storedToken =
      typeof window !== "undefined"
        ? window.sessionStorage.getItem("insurra.demo-session")
        : null;
    if (!storedToken) return;

    setPending(true);
    setError(null);
    setFeedback(null);
    try {
      const hashToUse = action.approved_payload_sha256 || "0".repeat(64);
      await api.request("post", "/api/v1/actions/{action_id}/execute", {
        headers: { "X-Demo-Session": storedToken },
        params: { action_id: action.id },
        body: {
          approved_payload_sha256: hashToUse,
        },
      });
    } catch (err) {
      if (err instanceof ApiClientError && err.status === 403) {
        setFeedback({
          type: "error",
          message:
            "Server menolak eksekusi (403 ACTION_APPROVAL_REQUIRED): Tindakan belum disetujui. Peristiwa guardrail 'Tindakan tanpa persetujuan diblokir' telah dicatat di Riwayat Audit (SC-11).",
        });
      } else if (err instanceof ApiClientError && err.status === 501) {
        setFeedback({
          type: "success",
          message: `Verifikasi persetujuan server & hash payload (${action.approved_payload_sha256?.slice(0, 12)}...) valid! Eksekutor sandbox berada pada batas kontrak 501.`,
        });
      } else {
        setError(err instanceof Error ? err.message : "Gagal memanggil endpoint eksekusi.");
      }
    } finally {
      setPending(false);
    }
  };

  if (!sessionData && !isAccountMode) {
    if (sessionLoading || authLoading) return null;
    return <SessionRequired />;
  }

  return (
    <div className="space-y-6 max-w-6xl mx-auto pb-16">
      {/* Header */}
      <div className="page-heading flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="eyebrow flex items-center gap-1.5 text-xs font-semibold tracking-wider text-emerald-700 uppercase">
            <ShieldCheck size={14} /> Kendali Penuh di Tangan Pengguna (SC-10 · E8)
          </div>
          <h1 className="text-2xl md:text-3xl font-bold text-slate-900 tracking-tight mt-1">
            Persetujuan Tindakan Agen
          </h1>
          <p className="text-sm text-slate-600 mt-1">
            Periksa, ubah isi draf, setujui dengan konfirmasi berlapis, atau tolak dengan alasan. Tidak ada tindakan yang dieksekusi tanpa persetujuan eksplisit di server.
          </p>
        </div>
        <div className="flex items-center gap-2">
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
                href="/audit?type=guardrail"
                className="inline-flex items-center gap-1 underline font-bold"
              >
                Buka Sorotan Guardrail di Riwayat Audit <ExternalLink size={11} />
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

      {/* Main Layout: Action Queue (Left) & Selected Action Detail (Right) */}
      {loading ? (
        <div className="p-8 text-center text-slate-500 text-sm bg-white rounded-xl border border-slate-200">
          <RefreshCw className="animate-spin inline-block mr-2" size={16} />
          Memuat antrean tindakan...
        </div>
      ) : actionsList.length > 0 ? (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
          {/* Queue List */}
          <div className="lg:col-span-5 bg-white rounded-xl border border-slate-200 shadow-xs divide-y divide-slate-100 overflow-hidden">
            <div className="p-4 bg-slate-50/70 border-b border-slate-100 flex items-center justify-between">
              <span className="text-xs font-bold uppercase tracking-wider text-slate-600">
                Antrean Tindakan ({actionsList.length})
              </span>
              <span className="text-[11px] text-slate-500">
                {actionsList.filter((a) => a.status === "PENDING").length} menunggu keputusan
              </span>
            </div>
            {actionsList.map((item) => {
              const isSelected = selectedAction?.id === item.id;
              const isL2 = item.permission_level === "L2";
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => handleSelectAction(item)}
                  className={`w-full text-left p-4 transition-colors flex flex-col gap-2 ${
                    isSelected
                      ? "bg-emerald-50/60 border-l-4 border-l-emerald-700"
                      : "hover:bg-slate-50"
                  }`}
                >
                  <div className="flex items-center justify-between gap-2 flex-wrap">
                    <span
                      className={`text-[11px] font-bold px-2 py-0.5 rounded uppercase ${
                        isL2
                          ? "bg-amber-100 text-amber-900 border border-amber-300"
                          : "bg-blue-100 text-blue-800"
                      }`}
                    >
                      Tingkat {item.permission_level ?? "L1"}
                    </span>
                    <span
                      className={`text-[11px] font-bold px-2.5 py-0.5 rounded-full uppercase ${
                        item.status === "APPROVED"
                          ? "bg-emerald-100 text-emerald-800"
                          : item.status === "REJECTED"
                            ? "bg-rose-100 text-rose-800"
                            : "bg-amber-100 text-amber-900"
                      }`}
                    >
                      {STATUS_LABELS[item.status] ?? item.status}
                    </span>
                  </div>
                  <div className="text-sm font-bold text-slate-900">
                    {ACTION_TYPE_LABELS[item.action_type] ?? item.action_type}
                  </div>
                  <p className="text-xs text-slate-600 line-clamp-2">{item.preview}</p>
                </button>
              );
            })}
          </div>

          {/* Detail Panel */}
          {selectedAction && (
            <div className="lg:col-span-7 bg-white rounded-xl border border-slate-200 shadow-xs overflow-hidden">
              <div className="p-5 bg-slate-50/70 border-b border-slate-200 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div>
                  <div className="flex items-center gap-2 flex-wrap">
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
                        selectedAction.status === "APPROVED"
                          ? "bg-emerald-100 text-emerald-800"
                          : selectedAction.status === "REJECTED"
                            ? "bg-rose-100 text-rose-800"
                            : "bg-amber-100 text-amber-900"
                      }`}
                    >
                      {STATUS_LABELS[selectedAction.status] ?? selectedAction.status}
                    </span>
                  </div>
                  <h2 className="text-lg font-bold text-slate-900 mt-1.5">
                    {ACTION_TYPE_LABELS[selectedAction.action_type] ?? selectedAction.action_type}
                  </h2>
                </div>
              </div>

              <div className="p-6 space-y-6">
                {/* Immutable Notice if already APPROVED or REJECTED */}
                {selectedAction.status !== "PENDING" && (
                  <div className="p-4 rounded-xl border border-slate-200 bg-slate-50 flex items-start gap-3 text-xs text-slate-700">
                    <Lock size={16} className="text-slate-500 shrink-0 mt-0.5" />
                    <div className="space-y-1">
                      <div className="font-bold text-slate-900">
                        Status Tindakan: {STATUS_LABELS[selectedAction.status]}
                      </div>
                      <p>
                        Payload tidak bisa diubah setelah disetujui; perubahan harus lewat draf baru.
                      </p>
                      {selectedAction.approved_payload_sha256 && (
                        <p className="font-mono text-[11px] text-emerald-800 pt-1">
                          SHA-256 Terikat: {selectedAction.approved_payload_sha256}
                        </p>
                      )}
                      {selectedAction.reason && (
                        <p className="text-rose-800 font-semibold pt-1">
                          Alasan tercatat: {selectedAction.reason}
                        </p>
                      )}
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

                {/* Payload Fields Viewer / Editor */}
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <h3 className="text-xs font-bold uppercase tracking-wider text-slate-500">
                      {isEditing ? "Mode Ubah — Edit Isi Payload" : "Detail Payload Tindakan"}
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
                        <div className="space-y-1 text-xs">
                          <div className="font-bold text-amber-950 uppercase tracking-wide">
                            Konfirmasi Tingkat L2 Diperlukan
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
                      onClick={() => void handleTestExecute(selectedAction)}
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
                        variant="outline"
                        size="sm"
                        disabled={pending}
                        onClick={() => void handleTestExecute(selectedAction)}
                        className="text-xs flex items-center gap-1.5"
                      >
                        <Play size={13} />
                        Eksekusi Versi Disetujui
                      </Button>
                    </div>
                  )
                )}
              </div>
            </div>
          )}
        </div>
      ) : null}

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
