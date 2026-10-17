"use client";
import { useEffect, useState } from "react";
import { Activity, RefreshCw } from "lucide-react";
import { useSession } from "@/lib/session";
import type { components } from "@/lib/api/types.gen";
import { Button } from "@/components/ui/button";
import { SessionRequired } from "@/components/session-required";
const labels: Record<string, string> = {
  SESSION_CREATED: "Sesi demo dibuat",
  CONSENT_GRANTED: "Persetujuan diberikan",
  CONSENT_REVOKED: "Persetujuan dicabut",
  VISA_GAP_ASSESSED: "Interval perlindungan dihitung",
  PROFILE_UPDATED: "Profil diperbarui",
};
export default function Audit() {
  const { data, loading, getAudit } = useSession();
  const [events, setEvents] = useState<components["schemas"]["AuditEvent"][]>(
    [],
  );
  const [filter, setFilter] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);
  const [pending, setPending] = useState(false);
  const sessionId = data?.session.id;
  useEffect(() => {
    let active = true;
    async function load() {
      try {
        const results = sessionId
          ? await getAudit(filter)
          : await Promise.resolve([]);
        if (active) {
          setEvents(results);
          setError(null);
        }
      } catch (err) {
        if (active)
          setError(
            err instanceof Error ? err.message : "Riwayat gagal dimuat.",
          );
      } finally {
        if (active) setPending(false);
      }
    }
    void load();
    return () => {
      active = false;
    };
  }, [sessionId, filter, revision, getAudit]);
  if (!data) return loading ? null : <SessionRequired />;
  return (
    <>
      <div className="page-heading">
        <div>
          <div className="eyebrow">TRANSPARANSI SETIAP LANGKAH</div>
          <h1>Riwayat aktivitas</h1>
          <p>Catatan aktivitas untuk sesi {data.profile.display_name} ini.</p>
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
      <label className="filter-label">
        Jenis aktivitas
        <select
          value={filter}
          onChange={(e) => {
            setPending(true);
            setFilter(e.target.value);
          }}
        >
          <option value="">Semua aktivitas</option>
          {Object.entries(labels).map(([key, label]) => (
            <option key={key} value={key}>
              {label}
            </option>
          ))}
        </select>
      </label>
      {error && (
        <p role="alert" className="alert error">
          {error}
        </p>
      )}
      <div className="card audit-list" aria-busy={pending}>
        {events.map((event) => (
          <article key={event.id} className="audit-row">
            <div className="audit-icon">
              <Activity size={18} />
            </div>
            <div>
              <h2>{labels[event.event_type] ?? event.event_type}</h2>
              <p>
                {new Intl.DateTimeFormat("id-ID", {
                  dateStyle: "medium",
                  timeStyle: "short",
                  timeZone: "Asia/Jakarta",
                }).format(
                  new Date(
                    event.created_at.endsWith("Z") ||
                      /[+-]\d\d:\d\d$/.test(event.created_at)
                      ? event.created_at
                      : `${event.created_at}Z`,
                  ),
                )}{" "}
                WIB
              </p>
              {event.metadata.gap_days !== undefined && (
                <p>
                  Potensi jeda:{" "}
                  {String(event.metadata.gap_days ?? "Belum diketahui")} hari
                </p>
              )}
            </div>
            <span className="badge success">
              {event.outcome === "SUCCESS" ? "BERHASIL" : event.outcome}
            </span>
          </article>
        ))}
        {!events.length && (
          <p className="muted p-6">Belum ada aktivitas untuk filter ini.</p>
        )}
      </div>
    </>
  );
}
