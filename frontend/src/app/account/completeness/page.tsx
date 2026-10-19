"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { ArrowRight, CalendarDays, FileText, Info, ShieldCheck } from "lucide-react";
import { api } from "@/lib/api/client";
import type { components } from "@/lib/api/types.gen";
import { useAuth } from "@/lib/auth";
import { useUserContext } from "@/lib/user-context";

type Setup = components["schemas"]["AccountSetup"];
type Result = components["schemas"]["AccountCompleteness"];

const labelForStatus: Record<string, string> = {
  FOUND: "Confirmed",
  UNVERIFIED: "Needs review",
  MISSING: "Missing",
  NOT_APPLICABLE: "Not applicable",
};

export default function AccountCompleteness() {
  const { token } = useAuth();
  const userCtx = useUserContext();
  const [setup, setSetup] = useState<Setup | null>(null);
  const [task, setTask] = useState("");
  const [result, setResult] = useState<Result | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!token) return;
    let active = true;
    const headers = { Authorization: `Bearer ${token}` };
    api
      .request("get", "/api/v1/account/profile", { headers })
      .then((profile) => {
        if (!profile.profile) throw new Error("Complete your profile to check protection continuity.");
        return api.request("get", "/api/v1/account/setup/{country_code}", {
          params: { country_code: profile.profile.country_code },
          headers,
        });
      })
      .then((value) => {
        if (!active) return;
        setSetup(value);
        const continuityTask = value.tasks.find((item) => item.task_code === "coverage_continuity");
        setTask(String(continuityTask?.task_code ?? value.tasks[0]?.task_code ?? ""));
        setError(null);
      })
      .catch((err: unknown) => {
        if (active) setError(err instanceof Error ? err.message : "Unable to load your profile context.");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [token]);

  useEffect(() => {
    if (!token || !task) return;
    let active = true;
    const loadResult = () => {
      void api
        .request("get", "/api/v1/account/completeness", {
        query: { task },
        headers: { Authorization: `Bearer ${token}` },
      })
      .then((value) => {
        if (active) {
          setResult(value);
          setError(null);
        }
      })
      .catch((err: unknown) => {
        if (active) setError(err instanceof Error ? err.message : "Unable to load this check.");
      });
    };
    loadResult();
    window.addEventListener("focus", loadResult);
    return () => {
      active = false;
      window.removeEventListener("focus", loadResult);
    };
  }, [token, task]);

  const dateItems = useMemo(
    () => new Map((result?.items ?? []).map((item) => [item.field_key, item])),
    [result],
  );
  const continuity = result?.coverage_continuity ?? result?.visa_gap;
  const suggestedDocuments = useMemo(() => {
    const unique = new Map<string, { key: string; label: string; status: string }>();
    const documentTypeLabels = new Map(
      (setup?.document_types ?? []).map((documentType) => [
        String(documentType.code),
        String(documentType.label),
      ]),
    );
    for (const item of result?.items ?? []) {
      if (!item.suggested_doc) continue;
      unique.set(item.suggested_doc, {
        key: item.suggested_doc,
        label: documentTypeLabels.get(item.suggested_doc) ?? item.suggested_doc.replaceAll("_", " "),
        status: "Suggested",
      });
    }
    return [...unique.values()];
  }, [result, setup]);

  const pageCountry = setup?.country_label ?? userCtx.residenceCountry ?? "your selected country";
  const dateValue = (key: string) => {
    const value = dateItems.get(key)?.value;
    return typeof value === "string" ? value : null;
  };

  return (
    <main style={{ maxWidth: 1240, margin: "0 auto", padding: "18px 8px 56px" }}>
      <header style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 20, flexWrap: "wrap", marginBottom: 24 }}>
        <div>
          <h1 style={{ margin: 0, color: "#10223c", fontSize: 28, fontWeight: 800 }}>Protection Completeness &amp; Continuity</h1>
          <p style={{ margin: "7px 0 0", color: "#64748b", fontSize: 14 }}>Review the information and dates available for your selected task.</p>
        </div>
        {setup && setup.tasks.length > 0 && (
          <label style={{ display: "grid", gap: 5, color: "#64748b", fontSize: 12, fontWeight: 600 }}>
            Check
            <select value={task} onChange={(event) => setTask(event.target.value)} style={{ minWidth: 230, padding: "10px 12px", border: "1px solid #dbe4ee", borderRadius: 12, color: "#10223c", background: "#fff" }}>
              {setup.tasks.map((item) => (
                <option key={String(item.task_code)} value={String(item.task_code)}>{String(item.label)}</option>
              ))}
            </select>
          </label>
        )}
      </header>

      {error && <div role="alert" style={{ padding: 14, marginBottom: 18, border: "1px solid #fed7aa", borderRadius: 12, background: "#fff7ed", color: "#9a3412" }}>{error}</div>}
      {loading && <p role="status" style={{ color: "#64748b" }}>Loading your country and task data…</p>}

      {!loading && setup && result && (
        <>
          <section style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) minmax(280px, .75fr)", gap: 18, marginBottom: 18 }}>
            <article style={{ padding: 24, border: "1px solid #dcebe8", borderRadius: 18, background: "linear-gradient(110deg,#edfbf7,#f7fcff)" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10, color: "#087f69", fontSize: 13, fontWeight: 700 }}><ShieldCheck size={19} /> {result.task_label}</div>
              <h2 style={{ margin: "18px 0 8px", color: "#10223c", fontSize: 21 }}>Status Kelengkapan dan Kontinuitas Perlindungan</h2>
              <p style={{ margin: 0, color: "#64748b", lineHeight: 1.6 }}>Country context: {pageCountry}. This check uses dates and records available in your account; it does not determine immigration compliance.</p>
              <div style={{ display: "flex", alignItems: "flex-start", gap: 10, marginTop: 20, padding: 14, borderRadius: 12, background: "rgba(255,255,255,.8)", color: "#334155" }}>
                <Info size={17} style={{ flex: "0 0 auto", color: "#087f69", marginTop: 2 }} />
                <span>{result.verification_status === "VERIFIED" ? "Task requirements have verified source metadata." : "Country requirements are not verified. Missing items are not treated as mandatory."}</span>
              </div>
            </article>

            <article style={{ padding: 22, border: "1px solid #e2e8f0", borderRadius: 18, background: "#fff" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 9, color: "#64748b", fontSize: 13, fontWeight: 700 }}><CalendarDays size={17} /> DATE REVIEW</div>
              <h3 style={{ margin: "16px 0 12px", color: "#10223c", fontSize: 18 }}>Coverage continuity</h3>
              {continuity ? (
                <>
                  <strong style={{ display: "block", color: continuity.status === "POTENTIAL_COVERAGE_GAP" ? "#b45309" : "#10223c", fontSize: 15 }}>{continuity.status.replaceAll("_", " ")}</strong>
                  <p style={{ margin: "8px 0", color: "#64748b", lineHeight: 1.55 }}>{continuity.explanation}</p>
                  {continuity.gap_days !== null && continuity.gap_days !== undefined && <p style={{ margin: "8px 0", color: "#334155" }}>Date difference: <strong>{continuity.gap_days} calendar days</strong></p>}
                  <p style={{ margin: "8px 0 0", color: "#64748b", fontSize: 12 }}>Institution requirement: {continuity.requirement_status.replaceAll("_", " ")}</p>
                  {continuity.source_url && <a href={continuity.source_url} target="_blank" rel="noreferrer" style={{ display: "inline-block", marginTop: 10, color: "#087f69", fontSize: 13 }}>View rule source</a>}
                </>
              ) : (
                <p style={{ margin: 0, color: "#64748b", lineHeight: 1.55 }}>No continuity result is available for this task yet.</p>
              )}
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginTop: 18 }}>
                {["coverage_start_date", "coverage_end_date", "arrival_date", "visa_expiry_date"].map((key) => (
                  <div key={key} style={{ padding: 11, borderRadius: 10, background: "#f8fafc" }}>
                    <span style={{ display: "block", color: "#64748b", fontSize: 11 }}>{dateItems.get(key)?.label ?? key.replaceAll("_", " ")}</span>
                    <strong style={{ display: "block", marginTop: 4, color: "#26374d", fontSize: 12 }}>{dateValue(key) ?? "Not provided"}</strong>
                  </div>
                ))}
              </div>
            </article>
          </section>

          <section style={{ display: "grid", gridTemplateColumns: "minmax(0, 1.3fr) minmax(280px, .7fr)", gap: 18 }}>
            <article style={{ padding: 22, border: "1px solid #e2e8f0", borderRadius: 18, background: "#fff" }}>
              <h3 style={{ margin: "0 0 6px", color: "#10223c", fontSize: 18 }}>Data points for this check</h3>
              <p style={{ margin: "0 0 16px", color: "#64748b", fontSize: 13 }}>Context: {pageCountry}. Items come from country configuration and your account records; unverified entries are not requirements.</p>
              {result.items.length ? result.items.map((item) => (
                <div key={item.field_key} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 16, padding: "13px 0", borderTop: "1px solid #eef2f6" }}>
                  <div><strong style={{ display: "block", color: "#26374d", fontSize: 14 }}>{item.label}</strong><span style={{ display: "block", marginTop: 4, color: "#64748b", fontSize: 12 }}>{item.value === null || item.value === undefined ? "No confirmed value" : String(item.value)}</span>{item.document_id && <Link href={`/documents/${item.document_id}`} style={{ display: "inline-block", marginTop: 5, color: "#087f69", fontSize: 11 }}>Review source{item.source_page ? ` · page ${item.source_page}` : ""}</Link>}</div>
                  <span style={{ whiteSpace: "nowrap", color: item.status === "FOUND" ? "#087f69" : "#64748b", fontSize: 12, fontWeight: 700 }}>{labelForStatus[item.status] ?? item.status}</span>
                </div>
              )) : <p style={{ color: "#64748b", fontSize: 13 }}>No verified checklist requirements are configured for this task.</p>}
            </article>

            <aside style={{ display: "grid", alignContent: "start", gap: 16 }}>
              <article style={{ padding: 22, border: "1px solid #e2e8f0", borderRadius: 18, background: "#fff" }}>
                <h3 style={{ display: "flex", alignItems: "center", gap: 8, margin: "0 0 8px", color: "#10223c", fontSize: 17 }}><FileText size={17} color="#087f69" /> Suggested documents</h3>
                <p style={{ margin: "0 0 14px", color: "#64748b", fontSize: 12 }}>Suggestions are not requirements unless supported by a verified institutional source.</p>
                {suggestedDocuments.length ? suggestedDocuments.map((document) => (
                  <div key={document.key} style={{ display: "flex", justifyContent: "space-between", gap: 12, padding: "10px 0", borderTop: "1px solid #eef2f6", color: "#334155", fontSize: 13 }}><span>{document.label}</span><span style={{ color: "#64748b", fontSize: 11 }}>{labelForStatus[document.status] ?? document.status}</span></div>
                )) : <p style={{ color: "#64748b", fontSize: 13 }}>No document suggestions are configured for this context.</p>}
                <Link href="/documents" style={{ display: "inline-flex", alignItems: "center", gap: 8, marginTop: 12, color: "#087f69", fontSize: 13, fontWeight: 700, textDecoration: "none" }}>Open document review and upload <ArrowRight size={15} /></Link>
              </article>
              <article style={{ padding: 20, border: "1px solid #dcebe8", borderRadius: 18, background: "#f2fbf8" }}>
                <h3 style={{ margin: "0 0 7px", color: "#10223c", fontSize: 15 }}>How this check works</h3>
                <p style={{ margin: 0, color: "#526579", fontSize: 12, lineHeight: 1.6 }}>Date differences are calculated from confirmed dates. An institution requirement is reported only when a current, verified source is available. A date difference alone is not a visa or immigration violation.</p>
                {result.coverage_continuity?.source_url && <a href={result.coverage_continuity.source_url} target="_blank" rel="noreferrer" style={{ display: "inline-block", marginTop: 10, color: "#087f69", fontSize: 12 }}>Source ({result.coverage_continuity.verification_status})</a>}
              </article>
            </aside>
          </section>
        </>
      )}
    </main>
  );
}
