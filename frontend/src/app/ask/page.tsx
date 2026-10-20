"use client";

import Link from "next/link";
import Image from "next/image";
import { AlertTriangle, ArrowRight, BookOpen, FileText, Layers3, MessageCircle, Send, ShieldCheck } from "lucide-react";
import { useRouter } from "next/navigation";
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
import "./ask.css";

type ToolStep = {
  tool: string;
  status: "COMPLETED" | "SKIPPED" | "PROPOSED";
  summary: string;
};
type ActionProposal = {
  proposal_id: string;
  action_type: string;
  title: string;
  summary: string;
  target_entity?: string | null;
  requires_approval: true;
};
type Citation = components["schemas"]["AnswerCitation"] & {
  language?: string | null;
  explanation_label?: string | null;
};
type Point = Omit<components["schemas"]["AnswerPoint"], "citations"> & {
  citations: Citation[];
};
type Answer = Omit<components["schemas"]["AskAnswer"], "answer_points"> & {
  answer_points: Point[];
  intent?: string;
  tool_steps?: ToolStep[];
  proposals?: ActionProposal[];
};
type Turn = { question: string; answer: Answer | null };
const labels = {
  FROM_DOCUMENT: "Dari dokumen",
  ESTIMATE: "Perkiraan",
  NEEDS_CONFIRMATION: "Perlu konfirmasi",
};

export default function AskPage() {
  const router = useRouter();
  const workspace = useWorkspace();
  const [question, setQuestion] = useState(() => {
    if (typeof window !== "undefined") {
      const prefill = sessionStorage.getItem("insurra_demo_prompt");
      if (prefill) {
        sessionStorage.removeItem("insurra_demo_prompt");
        return prefill;
      }
    }
    return "";
  });
  const [policy, setPolicy] = useState("");
  const [turns, setTurns] = useState<Turn[]>([]);
  const [chat, setChat] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [preparingId, setPreparingId] = useState<string | null>(null);
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
                answer: t.answer as Answer,
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
    setStatus("Analyzing documents…");
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
              ? "Retrieving citations…"
              : "Validating evidence…",
          );
        if (event.event === "answer_point") {
          points.push(event.data as Point);
          setTurns([
            ...base.slice(0, -1),
            {
              question: value,
              answer: {
                answer_points: [...points],
                disposition: "answered",
                intent: "POLICY_QUESTION",
              },
            },
          ]);
        }
        if (event.event === "complete") {
          setTurns([
            ...base.slice(0, -1),
            { question: value, answer: event.data as Answer },
          ]);
          setChat(event.data.chat_session_id ?? null);
          if (storageKey && event.data.chat_session_id)
            sessionStorage.setItem(storageKey, event.data.chat_session_id);
          setStatus("Answer complete. Citations available for review.");
          setQuestion("");
        }
        if (event.event === "redirect") {
          setTurns(base.slice(0, -1));
          setStatus("");
          setError(
            "Red flag or urgent symptoms detected. Policy Q&A is paused. Please review emergency guidance above.",
          );
          router.push("/emergency");
        }
        if (event.event === "error") throw new Error(event.data.message);
      }
    } catch (cause) {
      setTurns(base.slice(0, -1));
      setStatus("");
      setError(
        abort.signal.aborted
          ? "Request cancelled; no completed response was saved."
          : cause instanceof Error
            ? cause.message
            : "Could not retrieve answer. Please try again.",
      );
    } finally {
      setPending(false);
      controller.current = null;
    }
  }
  async function prepareProposal(proposalId: string) {
    if (!workspace.headers || preparingId) return;
    setPreparingId(proposalId);
    setError(null);
    try {
      const response = await fetch(
        `${process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8000"}/api/v1/ask/proposals/${encodeURIComponent(proposalId)}/prepare`,
        {
          method: "POST",
          headers: {
            ...workspace.headers,
            "Content-Type": "application/json",
          },
        },
      );
      const data = (await response.json()) as {
        action_id?: string;
        message?: string;
      };
      if (!response.ok || !data.action_id) {
        throw new Error(data.message ?? "Could not prepare action draft.");
      }
      router.push(`/actions?action=${encodeURIComponent(data.action_id)}`);
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Could not prepare action draft.",
      );
    } finally {
      setPreparingId(null);
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
      setStatus("New conversation ready.");
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "History could not be cleared.",
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
      setFeedback("Feedback saved.");
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Feedback could not be saved.",
      );
    }
  }
  return (
    <div className="vn ask-dashboard" lang="id">
      <header className="ask-hero">
        <h1>Ask INSURRA</h1>
        <p>
          Tanyakan tentang polis, perlindungan, dan langkah berikutnya. Jawaban memerlukan bukti dari dokumen dan aturan yang tersedia.
        </p>
        <span className="ask-context-chip"><ShieldCheck size={18} /> {context?.country_label || "Konteks belum tercatat"} · {context?.city || "Kota belum tercatat"} · {context?.occupation_label || "Status belum tercatat"}<small>{s.coverages?.length ?? 0} polis tercatat</small></span>
      </header>
      <div className="ask-layout"><div className="ask-main">
      <div className="ask-toolbar"><button type="button" onClick={() => void reset()} disabled={pending}>Percakapan baru</button><small>Menghapus memori percakapan saat ini, hingga 10 giliran konteks.</small></div>
      {!hasPolicies && (
        <div className="vn-state">
          <h2>Unggah dokumen polis agar INSURRA dapat meninjau cakupanmu</h2>
          <Link href="/documents">Unggah dokumen</Link>
        </div>
      )}
      {!allowed && <ConsentNotice ai />}
      {!s.triage_available && (
        <div className="vn-warnings" role="note">
          Pemeriksaan tanda bahaya belum tersedia. Tanya polis dihentikan sementara sampai aturan triase terverifikasi tersedia.
        </div>
      )}
      <label className="ask-policy-filter">
        Lingkup polis{" "}
        <select
          aria-label="Filter policy scope"
          value={policy}
          disabled={pending}
          onChange={(e) => setPolicy(e.target.value)}
        >
          <option value="">Semua polis yang tercatat</option>
          {s.coverages?.map((c) => (
            <option key={c.id} value={c.id}>
              {c.kind} · {c.provider ?? "Penyedia belum tercatat"} ·{" "}
              {c.country_code}
            </option>
          ))}
        </select>
      </label>
      <section className="ask-suggestions">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 mb-3">
          <h2 className="m-0">💡 Coba tanyakan…</h2>
          <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
            <span className="text-slate-500 font-medium mr-1">Label bukti:</span>
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-800 border border-emerald-200 font-semibold">
              ✓ Dari dokumen
            </span>
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-sky-50 text-sky-800 border border-sky-200 font-semibold">
              ≈ Perkiraan
            </span>
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-amber-50 text-amber-800 border border-amber-200 font-semibold">
              ? Perlu konfirmasi
            </span>
          </div>
        </div>
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
      </div></section>
      <div
        role="log"
        aria-live="polite"
        aria-label="Conversation history"
        className="vn-list ask-conversation"
      >
        {turns.map((t, index) => (
          <article className="ask-turn" key={index}>
            <div className="ask-user-message">{t.question}</div>
            {t.answer && (
              <div className="ask-answer-heading">
                <Image src="/mascot-logo.png" alt="" width={30} height={30} />
                <strong>Jawaban INSURRA</strong>
                <Link
                  href="/protection"
                  className="ml-auto text-xs text-teal-700 hover:text-teal-900 font-medium inline-flex items-center gap-1"
                  title="Lihat temuan lengkap di My Protection"
                >
                  <ShieldCheck size={13} /> My Protection <ArrowRight size={11} />
                </Link>
              </div>
            )}
            <div className="ask-answer-content">
            {t.answer?.intent && (
              <small
                data-testid="ask-intent"
                className="inline-flex items-center self-start px-2.5 py-0.5 rounded-md bg-slate-200/70 text-slate-700 text-[11px] font-semibold"
              >
                Intent: {t.answer.intent}
              </small>
            )}
            {t.answer?.answer_points.map((point, n) => (
              <section key={n}>
                <span
                  className={`vn-badge ${
                    point.label === "FROM_DOCUMENT"
                      ? "badge-doc"
                      : point.label === "ESTIMATE"
                      ? "badge-estimate"
                      : "badge-confirm"
                  }`}
                >
                  {labels[point.label]}
                </span>
                <p className="vn-message">{point.text}</p>
                {point.citations.map((c, i) => (
                  <div key={i} className="vn-card" data-testid="answer-citation">
                    {c.explanation_label && (
                      <small data-testid="citation-explanation-note" className="text-xs font-semibold text-teal-800">
                        {c.explanation_label}
                      </small>
                    )}
                    <blockquote lang={c.language ?? ""}>{c.quote}</blockquote>
                    <div className="vn-actions">
                      <button
                        onClick={() => setSource(c)}
                        className="inline-flex items-center gap-1.5 text-xs font-semibold text-teal-800 bg-teal-50 hover:bg-teal-100 border border-teal-200 px-3 py-1.5 rounded-lg transition-colors cursor-pointer"
                      >
                        <FileText size={13} />
                        {c.document_name ?? "Document"} · p. {c.page}
                        {c.language ? ` (${c.language})` : ""}
                      </button>
                    </div>
                  </div>
                ))}
              </section>
            ))}
            {t.answer?.tool_steps?.length ? (
              <div className="vn-list" data-testid="ask-tool-steps">
                <small>Agent steps:</small>
                <ul>
                  {t.answer.tool_steps.map((step, idx) => (
                    <li key={`${step.tool}-${idx}`}>
                      <strong>{step.tool}</strong> ({step.status}): {step.summary}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
            {t.answer?.proposals?.map((proposal) => (
              <div
                key={proposal.proposal_id}
                className="vn-card"
                data-testid="ask-action-proposal"
              >
                <strong>{proposal.title}</strong>
                <span className="vn-badge">Requires your approval</span>
                <p>{proposal.summary}</p>
                <div className="vn-actions">
                  <button
                    type="button"
                    className="vn-primary"
                    data-testid="prepare-proposal-btn"
                    disabled={preparingId === proposal.proposal_id}
                    onClick={() => void prepareProposal(proposal.proposal_id)}
                  >
                    {preparingId === proposal.proposal_id
                      ? "Preparing draft…"
                      : "Prepare Action Draft"}
                  </button>
                </div>
              </div>
            ))}
            {t.answer?.numeric_facts?.map((f) => (
              <div key={`${f.coverage_id}:${f.category}`} className="vn-card">
                <div className="flex items-center justify-between">
                  <strong>{f.policy_label}</strong>
                  <span className="vn-badge">{labels[f.label]}</span>
                </div>
                <div className="vn-numbers">
                  <div>
                    Limit{" "}
                    <strong>
                      {f.currency} {f.limit ?? "unknown"}
                    </strong>
                  </div>
                  <div>
                    Used{" "}
                    <strong>
                      {f.currency} {f.used ?? "unknown"}
                    </strong>
                  </div>
                  <div>
                    Remaining{" "}
                    <strong>
                      {f.currency} {f.remaining ?? "unknown"}
                    </strong>
                  </div>
                </div>
                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 mt-2 pt-2 border-t border-slate-100">
                  <small>{f.explanation} Original currency, no automated conversion.</small>
                  <Link
                    href="/protection"
                    className="inline-flex items-center gap-1.5 text-xs font-semibold text-teal-800 hover:text-teal-900 bg-teal-50 hover:bg-teal-100 border border-teal-200 px-2.5 py-1 rounded-md transition-colors shrink-0"
                    title="Buka temuan di My Protection"
                  >
                    <ShieldCheck size={13} />
                    Temuan di My Protection
                    <ArrowRight size={12} />
                  </Link>
                </div>
              </div>
            ))}
            {t.answer?.disposition === "no_match" && (
              <h3>Not found in your documents</h3>
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
              <Link href="/pathways">Compare care pathways</Link>
            )}
            {t.answer?.answer_id && (
              <div className="vn-actions">
                <button onClick={() => void rate(t.answer!, true)}>
                  Helpful
                </button>
                <select
                  aria-label="Feedback reason"
                  value={reason}
                  onChange={(event) =>
                    setReason(event.target.value as typeof reason)
                  }
                >
                  <option value="unclear">Unclear</option>
                  <option value="incorrect_source">Incorrect source cited</option>
                  <option value="missing_detail">Missing details</option>
                  <option value="other">Other reason</option>
                </select>
                <button onClick={() => void rate(t.answer!, false, reason)}>
                  Needs improvement
                </button>
              </div>
            )}
            </div>
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
            placeholder="Tanyakan tentang perlindungan, limit, atau masa tunggu…"
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
            <Send size={16} /> Kirim
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
          ? "Hingga 10 giliran konteks disimpan selama izin retensi aktif."
          : "Konteks percakapan hanya ada dalam sesi ini; teks pertanyaan tidak disimpan di server."}
      </p>
      </div><aside className="ask-sidebar" aria-label="Konteks dan bukti">
        <section className="ask-side-panel">
          <h2><Layers3 size={21} /> Konteks & bukti</h2>
          <p>Informasi yang dapat dipakai saat menjawab pertanyaanmu.</p>
          <div className="ask-side-inner">
            <div className="ask-side-heading">
              <strong>Polis tercatat ({s.coverages?.length ?? 0})</strong>
              <Link href="/protection">Lihat My Protection</Link>
            </div>
            {s.coverages?.length ? (
              s.coverages.map((coverage) => (
                <Link
                  href="/protection"
                  className="ask-policy-item hover:opacity-85 transition-opacity"
                  key={coverage.id}
                  title="Buka temuan polis di My Protection"
                >
                  <span><ShieldCheck size={19} /></span>
                  <div>
                    <strong>{coverage.provider || coverage.kind}</strong>
                    <p>{coverage.kind} · {coverage.country_label || coverage.country_code}</p>
                    <small>{coverage.needs_verification ? "Perlu verifikasi" : coverage.active ? "Aktif" : "Status perlu dicek"}</small>
                  </div>
                </Link>
              ))
            ) : (
              <p>Belum ada polis yang tercatat.</p>
            )}
          </div>
        </section>
        <section className="ask-side-panel"><h2><FileText size={20} /> Sumber jawaban</h2><p>Kutipan dan halaman hanya muncul jika jawaban yang terverifikasi tersedia.</p><div className="ask-side-inner">{turns.flatMap((turn) => turn.answer?.answer_points.flatMap((point) => point.citations) ?? []).slice(-5).map((citation, index) => <button type="button" className="ask-source-item" key={`${citation.document_name}-${citation.page}-${index}`} onClick={() => setSource(citation)}><FileText size={18} /><span>{citation.document_name || "Dokumen"} · hlm. {citation.page}</span><ArrowRight size={15} /></button>)}{!turns.some((turn) => turn.answer?.answer_points.some((point) => point.citations.length)) && <p>Belum ada sumber untuk ditampilkan.</p>}</div></section>
        <section className="ask-side-panel">
          <h2><BookOpen size={20} /> Langkah berikutnya</h2>
          <Link className="ask-next-link" href="/protection">
            <ShieldCheck size={18} /> Temuan My Protection <ArrowRight size={15} />
          </Link>
          <Link className="ask-next-link" href="/documents">
            <FileText size={18} /> Tinjau dokumen <ArrowRight size={15} />
          </Link>
          <Link className="ask-next-link" href="/coverage-needs">
            <ShieldCheck size={18} /> Analisis perlindungan <ArrowRight size={15} />
          </Link>
          <Link className="ask-next-link" href="/pathways">
            <MessageCircle size={18} /> Care pathways <ArrowRight size={15} />
          </Link>
        </section>
        <section className="ask-safety-note"><h2><AlertTriangle size={20} /> Catatan keselamatan</h2><p>Informasi polis bukan nasihat medis. Jika memerlukan pertolongan segera, hubungi layanan darurat setempat.</p><Link href="/emergency">Lihat panduan darurat <ArrowRight size={15} /></Link></section>
        <EmergencyNotice info={s.emergency} />
      </aside></div>
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
