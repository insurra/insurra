"use client";

import { useEffect, useState } from "react";
import {
  Activity,
  ChevronLeft,
  ChevronRight,
  Clock,
  Cpu,
  Eye,
  RefreshCw,
  ShieldAlert,
  ShieldCheck,
  X,
} from "lucide-react";
import { api } from "@/lib/api/client";
import type { components } from "@/lib/api/types.gen";
import { useAuth } from "@/lib/auth";
import { useSession } from "@/lib/session";
import { Button } from "@/components/ui/button";
import { SessionRequired } from "@/components/session-required";

type AuditEvent = components["schemas"]["AuditEvent"];
type AuditCategory = NonNullable<AuditEvent["category"]>;

const PAGE_SIZE = 20;

const labels: Record<string, string> = {
  SESSION_CREATED: "Sesi demo dibuat",
  CONSENT_GRANTED: "Persetujuan diberikan",
  CONSENT_REVOKED: "Persetujuan dicabut",
  VISA_GAP_ASSESSED: "Interval perlindungan dihitung",
  PROFILE_UPDATED: "Profil diperbarui",
  profile_update: "Sinkronisasi profil",
  CONSENT_CHANGED: "Persetujuan diubah",
  CONSENTS_DECIDED: "Keputusan persetujuan awal",
  DOCUMENT_UPLOADED: "Dokumen diunggah & diekstrak",
  INJECTION_FLAGGED: "Instruksi mencurigakan disaring",
  FIELD_REVIEWED: "Hasil ekstraksi dikonfirmasi",
  FIELD_PROVIDED: "Data polis dilengkapi manual",
  DOCUMENT_DELETED: "Dokumen dihapus",
  DATA_DELETED: "Seluruh data dihapus",
  FAMILY_MEMBER_ADDED: "Anggota keluarga ditambahkan",
  FAMILY_MEMBER_DELETED: "Anggota keluarga dihapus",
  ANSWER: "Jawaban Tanya Polis",
  COMPARE: "Perbandingan jalur layanan",
  ACTION: "Keputusan tindakan agen",
  GUARDRAIL: "Peringatan guardrail keamanan",
  DELETION: "Penghapusan data",
};

const categoryLabels: Record<AuditCategory, string> = {
  answer: "Jawaban & Analisis",
  compare: "Perbandingan Jalur",
  action: "Tindakan Agen",
  guardrail: "Guardrail Keamanan",
  deletion: "Penghapusan Data",
  consent: "Persetujuan & Privasi",
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

export default function Audit() {
  const { account, token: accountToken, loading: authLoading } = useAuth();
  const { data, loading: sessionLoading, getAudit } = useSession();

  const [events, setEvents] = useState<AuditEvent[]>([]);
  const [filter, setFilter] = useState("");
  const [page, setPage] = useState(0);
  const [selectedEvent, setSelectedEvent] = useState<AuditEvent | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);
  const [pending, setPending] = useState(false);

  const isAccountMode = Boolean(account && accountToken);
  const sessionId = data?.session.id;

  useEffect(() => {
    let active = true;
    async function load() {
      try {
        const isCategoryFilter = filter.startsWith("cat:");
        const categoryValue = isCategoryFilter
          ? (filter.slice(4) as AuditCategory)
          : undefined;
        const eventTypeValue = !isCategoryFilter && filter ? filter : undefined;

        let results: AuditEvent[] = [];
        if (isAccountMode && accountToken) {
          results = await api.request("get", "/api/v1/account/audit", {
            headers: { Authorization: `Bearer ${accountToken}` },
            query: {
              event_type: eventTypeValue,
              type: categoryValue,
              limit: PAGE_SIZE,
              offset: page * PAGE_SIZE,
            },
          });
        } else if (sessionId) {
          if (eventTypeValue && page === 0) {
            results = await getAudit(eventTypeValue);
          } else {
            results = await getAudit({
              event_type: eventTypeValue,
              type: categoryValue,
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
          setError(
            err instanceof Error ? err.message : "Riwayat gagal dimuat.",
          );
        }
      } finally {
        if (active) setPending(false);
      }
    }
    void load();
    return () => {
      active = false;
    };
  }, [isAccountMode, accountToken, sessionId, filter, page, revision, getAudit]);

  if (!isAccountMode && !data) {
    return authLoading || sessionLoading ? null : <SessionRequired />;
  }

  const displayName = isAccountMode
    ? (account?.display_name ?? account?.email ?? "Akun")
    : (data?.profile.display_name ?? "Demo");

  return (
    <>
      <div className="page-heading">
        <div>
          <div className="eyebrow">TRANSPARANSI SETIAP LANGKAH</div>
          <h1>Riwayat aktivitas</h1>
          <p>
            Catatan keputusan dan pemanggilan tool agen untuk sesi {displayName}{" "}
            ini (hanya-baca &amp; tersamar).
          </p>
        </div>
        <Button
          variant="outline"
          disabled={pending}
          onClick={() => {
            setPending(true);
            setRevision((v) => v + 1);
          }}
        >
          <RefreshCw size={15} />
          Muat ulang
        </Button>
      </div>

      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          alignItems: "center",
          justifyContent: "space-between",
          gap: "12px",
          marginBottom: "20px",
        }}
      >
        <label className="filter-label" style={{ marginBottom: 0 }}>
          Jenis aktivitas
          <select
            value={filter}
            onChange={(e) => {
              setPending(true);
              setPage(0);
              setSelectedEvent(null);
              setFilter(e.target.value);
            }}
          >
            <option value="">Semua aktivitas</option>
            <optgroup label="Peristiwa spesifik">
              {Object.entries(labels).map(([key, label]) => (
                <option key={key} value={key}>
                  {label}
                </option>
              ))}
            </optgroup>
            <optgroup label="Kategori keputusan agen">
              {(Object.entries(categoryLabels) as [AuditCategory, string][]).map(
                ([catKey, catLabel]) => (
                  <option key={`cat:${catKey}`} value={`cat:${catKey}`}>
                    Kategori: {catLabel}
                  </option>
                ),
              )}
            </optgroup>
          </select>
        </label>

        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "8px",
            fontSize: "12px",
            color: "#526579",
          }}
        >
          <ShieldCheck size={15} style={{ color: "#16805d" }} />
          <span>
            Mode Hanya-Baca · Nomor polis/kartu tersamar (****1234) · Tanpa isi
            dokumen/prompt sistem
          </span>
        </div>
      </div>

      {error && (
        <p role="alert" className="alert error">
          {error}
        </p>
      )}

      <div className="card audit-list" aria-busy={pending}>
        {events.map((event) => {
          const isGuardrail =
            event.category === "guardrail" ||
            event.event_type === "INJECTION_FLAGGED";
          const tools = event.tools_called ?? [];
          const category = event.category ?? "answer";

          return (
            <article
              key={event.id}
              className="audit-row"
              style={{
                alignItems: "flex-start",
                borderLeft: isGuardrail ? "3px solid #d97706" : undefined,
                paddingLeft: isGuardrail ? "12px" : undefined,
              }}
            >
              <div
                className="audit-icon"
                style={{
                  marginTop: "2px",
                  background: isGuardrail ? "#faf1dc" : undefined,
                  color: isGuardrail ? "#8b6419" : undefined,
                }}
              >
                {isGuardrail ? (
                  <ShieldAlert size={18} />
                ) : (
                  <Activity size={18} />
                )}
              </div>

              <div style={{ flex: 1, minWidth: 0 }}>
                <div
                  style={{
                    display: "flex",
                    flexWrap: "wrap",
                    alignItems: "center",
                    gap: "8px",
                    marginBottom: "4px",
                  }}
                >
                  <h2>{labels[event.event_type] ?? event.event_type}</h2>
                  {event.source_screen && (
                    <span className="badge neutral">{event.source_screen}</span>
                  )}
                  <span
                    className={`badge ${isGuardrail ? "warning" : "neutral"}`}
                  >
                    {categoryLabels[category] ?? category.toUpperCase()}
                  </span>
                  {event.approval_status && (
                    <span
                      className={`badge ${
                        event.approval_status === "APPROVED"
                          ? "success"
                          : "warning"
                      }`}
                    >
                      Persetujuan: {event.approval_status}
                    </span>
                  )}
                </div>

                <p
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "6px",
                    color: "#627485",
                    fontSize: "11px",
                  }}
                >
                  <Clock size={12} />
                  <strong>{formatRelativeTime(event.created_at)}</strong>
                  <span>·</span>
                  <span>{formatAbsoluteTime(event.created_at)}</span>
                </p>

                <div
                  style={{
                    marginTop: "10px",
                    display: "grid",
                    gap: "6px",
                    fontSize: "12px",
                    color: "#334e68",
                  }}
                >
                  {event.input_summary && (
                    <div>
                      <strong style={{ color: "#102a43" }}>
                        Ringkasan Input:{" "}
                      </strong>
                      <span>{event.input_summary}</span>
                    </div>
                  )}

                  {tools.length > 0 && (
                    <div
                      style={{
                        display: "flex",
                        flexWrap: "wrap",
                        alignItems: "center",
                        gap: "6px",
                      }}
                    >
                      <strong style={{ color: "#102a43" }}>
                        Tool Dipanggil:{" "}
                      </strong>
                      {tools.map((tool) => (
                        <span
                          key={tool}
                          style={{
                            display: "inline-flex",
                            alignItems: "center",
                            gap: "4px",
                            padding: "2px 8px",
                            borderRadius: "999px",
                            background: "#eaf5f1",
                            color: "#08735f",
                            fontSize: "11px",
                            fontWeight: 600,
                            fontFamily: "monospace",
                          }}
                        >
                          <Cpu size={11} />
                          {tool}
                        </span>
                      ))}
                    </div>
                  )}

                  {event.result_summary && (
                    <div>
                      <strong style={{ color: "#102a43" }}>
                        Ringkasan Hasil:{" "}
                      </strong>
                      <span>{event.result_summary}</span>
                    </div>
                  )}

                  {event.reason && (
                    <div>
                      <strong style={{ color: "#102a43" }}>Alasan Agen: </strong>
                      <span>{event.reason}</span>
                    </div>
                  )}

                  {event.metadata.gap_days !== undefined && (
                    <p style={{ fontSize: "11px", marginTop: "2px" }}>
                      Potensi jeda:{" "}
                      {String(event.metadata.gap_days ?? "Belum diketahui")}{" "}
                      hari
                    </p>
                  )}
                </div>
              </div>

              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "flex-end",
                  gap: "8px",
                  marginLeft: "auto",
                }}
              >
                <span className="badge success">
                  {event.outcome === "SUCCESS" ? "BERHASIL" : event.outcome}
                </span>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() =>
                    setSelectedEvent(
                      selectedEvent?.id === event.id ? null : event,
                    )
                  }
                >
                  <Eye size={14} />
                  {selectedEvent?.id === event.id ? "Tutup" : "Detail"}
                </Button>
              </div>
            </article>
          );
        })}

        {!events.length && (
          <div className="muted p-6" style={{ textAlign: "center" }}>
            <p style={{ fontWeight: 600, color: "#334e68" }}>
              Belum ada aktivitas agen.
            </p>
            <p style={{ fontSize: "11px", marginTop: "4px" }}>
              Belum ada aktivitas untuk filter ini.
            </p>
          </div>
        )}
      </div>

      {selectedEvent && (
        <section
          className="card"
          aria-label="Detail Entri Audit"
          style={{ marginTop: "20px", padding: "22px" }}
        >
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              marginBottom: "14px",
            }}
          >
            <div>
              <span className="eyebrow">DETAIL KEPUTUSAN AGEN</span>
              <h2 style={{ marginTop: "4px" }}>
                {labels[selectedEvent.event_type] ?? selectedEvent.event_type}
              </h2>
            </div>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setSelectedEvent(null)}
            >
              <X size={16} /> Tutup
            </Button>
          </div>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
              gap: "12px",
              fontSize: "12px",
            }}
          >
            <div>
              <strong>ID Peristiwa:</strong>
              <p style={{ fontFamily: "monospace" }}>{selectedEvent.id}</p>
            </div>
            <div>
              <strong>Waktu Absolut &amp; Relatif:</strong>
              <p>
                {formatAbsoluteTime(selectedEvent.created_at)} (
                {formatRelativeTime(selectedEvent.created_at)})
              </p>
            </div>
            <div>
              <strong>Layar Asal:</strong>
              <p>{selectedEvent.source_screen ?? "-"}</p>
            </div>
            <div>
              <strong>Status Persetujuan:</strong>
              <p>
                {selectedEvent.approval_status ??
                  "Tidak memerlukan persetujuan tindakan keluar"}
              </p>
            </div>
          </div>
        </section>
      )}

      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginTop: "18px",
        }}
      >
        <span style={{ fontSize: "12px", color: "#627485" }}>
          Halaman {page + 1} · Maksimal {PAGE_SIZE} entri per halaman
        </span>
        <div style={{ display: "flex", gap: "8px" }}>
          <Button
            variant="outline"
            size="sm"
            disabled={page === 0 || pending}
            onClick={() => {
              setPending(true);
              setPage((p) => Math.max(0, p - 1));
            }}
          >
            <ChevronLeft size={14} /> Sebelumnya
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled={events.length < PAGE_SIZE || pending}
            onClick={() => {
              setPending(true);
              setPage((p) => p + 1);
            }}
          >
            Berikutnya <ChevronRight size={14} />
          </Button>
        </div>
      </div>
    </>
  );
}

