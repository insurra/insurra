"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { api } from "@/lib/api/client";
import { readAskEvents } from "@/lib/api/ask-stream";
import type { components } from "@/lib/api/types.gen";
import { useWorkspace } from "@/lib/workspace";
import {
  ConsentNotice,
  EmergencyNotice,
  WorkspaceState,
} from "@/components/workspace/workspace";
import { SourceDrawer } from "@/components/workspace/source-drawer";

type Answer = components["schemas"]["AskAnswer"];
type Citation = components["schemas"]["AnswerCitation"];
type Point = components["schemas"]["AnswerPoint"];
type Turn = { question: string; answer: Answer | null };
const labels = {
  FROM_DOCUMENT: "Dari dokumen",
  ESTIMATE: "Estimasi",
  NEEDS_CONFIRMATION: "Perlu konfirmasi",
};

export default function AskPage() {
  const workspace = useWorkspace();
  const [question, setQuestion] = useState("");
  const [policy, setPolicy] = useState("");
  const [turns, setTurns] = useState<Turn[]>([]);
  const [chat, setChat] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [status, setStatus] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [source, setSource] = useState<Citation | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [reason, setReason] = useState<
    "unclear" | "incorrect_source" | "missing_detail" | "other"
  >("unclear");
  const controller = useRef<AbortController | null>(null);
  const identity = workspace.identityKey;
  const context = workspace.summary?.context;
  const storageKey = identity ? `insurra.policy-chat.${identity}` : null;
  useEffect(() => {
    const abort = new AbortController();
    const saved = storageKey ? sessionStorage.getItem(storageKey) : null;
    queueMicrotask(() => {
      if (!abort.signal.aborted) {
        setTurns([]);
        setChat(null);
        setSource(null);
      }
    });
    if (
      saved &&
      workspace.headers &&
      context?.process_documents &&
      context.external_ai
    ) {
      api
        .request("get", "/api/v1/ask/sessions/{chat_session_id}", {
          headers: workspace.headers,
          params: { chat_session_id: saved },
          signal: abort.signal,
        })
        .then((history) => {
          if (!abort.signal.aborted) {
            setChat(history.chat_session_id);
            setTurns(
              history.turns.map((t) => ({
                question: t.question,
                answer: t.answer,
              })),
            );
          }
        })
        .catch(() => {
          if (!abort.signal.aborted && storageKey)
            sessionStorage.removeItem(storageKey);
        });
    }
    return () => {
      abort.abort();
      controller.current?.abort();
    };
  }, [
    storageKey,
    workspace.headers,
    context?.country_code,
    context?.process_documents,
    context?.external_ai,
    context?.retention,
  ]);
  if (!workspace.summary) return <WorkspaceState workspace={workspace} />;
  const s = workspace.summary;
  const allowed = Boolean(context?.process_documents && context.external_ai);
  const hasPolicies = Boolean(s.coverages?.length);
  const canAsk = allowed && hasPolicies && s.triage_available;
  async function send(value = question) {
    if (!workspace.headers || !canAsk || !value.trim() || pending) return;
    const abort = new AbortController();
    controller.current = abort;
    setPending(true);
    setError(null);
    setStatus("Memeriksa dokumen…");
    setQuestion(value);
    const base = [...turns, { question: value, answer: null }].slice(-10);
    setTurns(base);
    const points: Point[] = [];
    try {
      const stream = await api.stream("post", "/api/v1/ask", {
        headers: workspace.headers,
        signal: abort.signal,
        body: {
          question: value,
          coverage_id: policy || null,
          ...(chat ? { chat_session_id: chat } : {}),
        },
      });
      for await (const event of readAskEvents(stream, abort.signal)) {
        if (event.event === "progress")
          setStatus(
            event.data.stage === "retrieving"
              ? "Mencari kutipan…"
              : "Memvalidasi bukti…",
          );
        if (event.event === "answer_point") {
          points.push(event.data);
          setTurns([
            ...base.slice(0, -1),
            {
              question: value,
              answer: { answer_points: [...points], disposition: "answered" },
            },
          ]);
        }
        if (event.event === "complete") {
          setTurns([
            ...base.slice(0, -1),
            { question: value, answer: event.data },
          ]);
          setChat(event.data.chat_session_id ?? null);
          if (storageKey && event.data.chat_session_id)
            sessionStorage.setItem(storageKey, event.data.chat_session_id);
          setStatus("Jawaban selesai. Kutipan dapat diperiksa.");
          setQuestion("");
        }
        if (event.event === "redirect") {
          setTurns(base.slice(0, -1));
          setStatus("");
          setError(
            "Tanda bahaya terdeteksi. Jawaban polis dihentikan. Periksa bantuan darurat di atas. Arahan darurat SC-08 belum tersedia.",
          );
        }
        if (event.event === "error") throw new Error(event.data.message);
      }
    } catch (cause) {
      setTurns(base.slice(0, -1));
      setStatus("");
      setError(
        abort.signal.aborted
          ? "Permintaan dibatalkan; tidak ada jawaban selesai yang disimpan."
          : cause instanceof Error
            ? cause.message
            : "Belum bisa menjawab. Coba ulangi.",
      );
    } finally {
      setPending(false);
      controller.current = null;
    }
  }
  async function reset() {
    if (pending) return;
    try {
      if (chat && workspace.headers)
        await api.delete("/api/v1/ask/sessions/{chat_session_id}", {
          headers: workspace.headers,
          params: { chat_session_id: chat },
        });
      if (storageKey) sessionStorage.removeItem(storageKey);
      setChat(null);
      setTurns([]);
      setError(null);
      setStatus("Percakapan baru siap.");
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Riwayat belum dapat dihapus.",
      );
    }
  }
  async function rate(
    result: Answer,
    helpful: boolean,
    reason?: "unclear" | "incorrect_source" | "missing_detail" | "other",
  ) {
    if (!workspace.headers || !result.chat_session_id || !result.answer_id)
      return;
    try {
      await api.request(
        "post",
        "/api/v1/ask/sessions/{chat_session_id}/feedback",
        {
          headers: workspace.headers,
          params: { chat_session_id: result.chat_session_id },
          body: {
            answer_id: result.answer_id,
            helpful,
            reason: reason ?? null,
          },
        },
      );
      setFeedback("Umpan balik tersimpan.");
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Umpan balik belum tersimpan.",
      );
    }
  }
  return (
    <div className="vn" lang="id">
      <EmergencyNotice info={s.emergency} />
      <header>
        <h1>Tanya polis</h1>
        <p>
          Jawaban berdasarkan dokumen yang kamu unggah, bukan nasihat medis.
        </p>
        <button onClick={() => void reset()} disabled={pending}>
          Mulai percakapan baru
        </button>
        <small>
          Percakapan baru menghapus riwayat percakapan ini. Maksimal 10 giliran
          konteks.
        </small>
      </header>
      {!hasPolicies && (
        <div className="vn-state">
          <h2>Unggah polis dulu supaya aku bisa menjawab</h2>
          <Link href="/documents">Unggah dokumen</Link>
        </div>
      )}
      {!allowed && <ConsentNotice ai />}
      {!s.triage_available && (
        <div className="vn-warnings" role="note">
          Pemeriksaan tanda bahaya belum tersedia. Tanya polis dihentikan sampai
          konfigurasi triase terverifikasi tersedia.
        </div>
      )}
      <label>
        Tanya tentang{" "}
        <select
          aria-label="Tanya tentang"
          value={policy}
          disabled={pending}
          onChange={(e) => setPolicy(e.target.value)}
        >
          <option value="">Semua perlindungan saya</option>
          {s.coverages?.map((c) => (
            <option key={c.id} value={c.id}>
              {c.kind} · {c.provider ?? "penyedia belum diisi"} ·{" "}
              {c.country_code}
            </option>
          ))}
        </select>
      </label>
      <div className="vn-chips" aria-label="Contoh pertanyaan">
        {s.question_examples?.map((q) => (
          <button
            key={q}
            disabled={!canAsk || pending}
            onClick={() => setQuestion(q)}
          >
            {q}
          </button>
        ))}
      </div>
      <div
        role="log"
        aria-live="polite"
        aria-label="Riwayat percakapan"
        className="vn-list"
      >
        {turns.map((t, index) => (
          <article className="vn-card" key={index}>
            <h2>{t.question}</h2>
            {t.answer?.answer_points.map((point, n) => (
              <section key={n}>
                <span className="vn-badge">{labels[point.label]}</span>
                <p className="vn-message">{point.text}</p>
                <div className="vn-actions">
                  {point.citations.map((c, i) => (
                    <button key={i} onClick={() => setSource(c)}>
                      {c.document_name ?? "Dokumen"} · hal. {c.page}
                    </button>
                  ))}
                </div>
              </section>
            ))}
            {t.answer?.numeric_facts?.map((f) => (
              <div key={`${f.coverage_id}:${f.category}`} className="vn-card">
                <strong>{f.policy_label}</strong>
                <span className="vn-badge">{labels[f.label]}</span>
                <div className="vn-numbers">
                  <div>
                    Limit{" "}
                    <strong>
                      {f.currency} {f.limit ?? "tidak diketahui"}
                    </strong>
                  </div>
                  <div>
                    Terpakai{" "}
                    <strong>
                      {f.currency} {f.used ?? "tidak diketahui"}
                    </strong>
                  </div>
                  <div>
                    Sisa{" "}
                    <strong>
                      {f.currency} {f.remaining ?? "tidak diketahui"}
                    </strong>
                  </div>
                </div>
                <small>{f.explanation} Mata uang asli, tanpa konversi.</small>
              </div>
            ))}
            {t.answer?.disposition === "no_match" && (
              <h3>Tidak ditemukan di dokumen</h3>
            )}
            {t.answer?.warnings?.map((w) => (
              <p key={w}>{w}</p>
            ))}
            {t.answer?.verification_steps?.length ? (
              <ul>
                {t.answer.verification_steps.map((step) => (
                  <li key={step}>{step}</li>
                ))}
              </ul>
            ) : null}
            {t.answer?.disposition === "declined" && (
              <Link href="/pathways">Bandingkan jalur berobat</Link>
            )}
            {t.answer?.answer_id && (
              <div className="vn-actions">
                <button onClick={() => void rate(t.answer!, true)}>
                  Membantu
                </button>
                <select
                  aria-label="Alasan umpan balik"
                  value={reason}
                  onChange={(event) =>
                    setReason(event.target.value as typeof reason)
                  }
                >
                  <option value="unclear">Belum jelas</option>
                  <option value="incorrect_source">Sumber kurang tepat</option>
                  <option value="missing_detail">Detail kurang</option>
                  <option value="other">Alasan lain</option>
                </select>
                <button onClick={() => void rate(t.answer!, false, reason)}>
                  Kurang tepat
                </button>
              </div>
            )}
          </article>
        ))}
      </div>
      <form
        className="vn-form"
        onSubmit={(e) => {
          e.preventDefault();
          void send();
        }}
      >
        <label>
          Pertanyaan Anda
          <textarea
            maxLength={500}
            value={question}
            disabled={!canAsk || pending}
            onChange={(e) => setQuestion(e.target.value)}
          />
        </label>
        <small>
          {question.length}/500 karakter · Maksimal 20 pertanyaan per jam
        </small>
        <div className="vn-actions">
          <button
            className="vn-primary"
            disabled={!canAsk || !question.trim() || pending}
          >
            Kirim
          </button>
          {pending && (
            <button type="button" onClick={() => controller.current?.abort()}>
              Batalkan
            </button>
          )}
          {error && question && (
            <button
              type="button"
              disabled={pending || !canAsk}
              onClick={() => void send()}
            >
              Coba lagi
            </button>
          )}
        </div>
      </form>
      {status && <p role="status">{status}</p>}
      {feedback && <p role="status">{feedback}</p>}
      {error && (
        <p role="alert" className="vn-error">
          {error}
        </p>
      )}
      <p className="vn-subtle">
        {context?.retention
          ? "Riwayat maksimal 10 giliran disimpan dengan persetujuan retensi aktif."
          : "Riwayat percakapan hanya berada di memori tab; tidak disimpan sebagai teks di server."}
      </p>
      {source && workspace.headers && (
        <SourceDrawer
          citation={source}
          headers={workspace.headers}
          onClose={() => setSource(null)}
        />
      )}
    </div>
  );
}
