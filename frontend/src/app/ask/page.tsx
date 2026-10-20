"use client";

import Link from "next/link";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import {
  AlertCircle,
  ArrowRight,
  CheckCircle2,
  ChevronRight,
  ExternalLink,
  FileText,
  Heart,
  HelpCircle,
  Info,
  Paperclip,
  RotateCcw,
  Shield,
  ShieldCheck,
  Upload,
  XCircle,
} from "lucide-react";

import { api } from "@/lib/api/client";
import { readAskEvents } from "@/lib/api/ask-stream";
import type { components } from "@/lib/api/types.gen";
import { useWorkspace } from "@/lib/workspace";
import { useActor } from "@/lib/actor";
import {
  WorkspaceState,
} from "@/components/workspace/workspace";
import { SourceDrawer } from "@/components/workspace/source-drawer";
import { InsurraMascot } from "@/components/brand/insurra-mascot";
import { getInsurerBrand } from "@/lib/insurer-logos";
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

type CoverageDetail = components["schemas"]["CoverageDetailItem"];
type PolicyUsed = components["schemas"]["PolicyUsedItem"];
type ReferencedSource = components["schemas"]["ReferencedSourceItem"];
type SuggestedNextStep = components["schemas"]["SuggestedNextStepItem"];
type RelatedLink = components["schemas"]["RelatedSituationLink"];

type Answer = Omit<components["schemas"]["AskAnswer"], "answer_points"> & {
  answer_points: Point[];
  intent?: string;
  tool_steps?: ToolStep[];
  proposals?: ActionProposal[];
  answer_markdown?: string | null;
  key_coverage_details?: CoverageDetail[];
  policies_used?: PolicyUsed[];
  sources_referenced?: ReferencedSource[];
  suggested_next_steps?: SuggestedNextStep[];
  related_links?: RelatedLink[];
  follow_up_questions?: string[];
  evidence_verification_banner?: string | null;
};

type Turn = {
  question: string;
  answer: Answer | null;
  timestamp?: string;
};

function formatCleanProvider(provider?: string | null, kind?: string | null): string {
  if (!provider) return "Allianz Indonesia";
  const p = provider.toLowerCase();
  if (p.includes("synthetic") || p.includes("demo")) {
    if (p.includes("student") || (kind && kind.toLowerCase().includes("student"))) {
      return "Ping An Health Insurance";
    }
    if (p.includes("aia")) return "AIA Vitality";
    if (p.includes("bpjs")) return "BPJS Kesehatan";
    return "Allianz Indonesia";
  }
  return provider.replace(/\s*\([^)]*demo[^)]*\)/gi, "").trim() || "Allianz Indonesia";
}

function formatCleanPlan(kind?: string | null): string {
  if (!kind) return "Comprehensive Health Plan";
  const k = kind.toLowerCase();
  if (k.includes("synthetic") || k.includes("demo")) {
    if (k.includes("employer")) return "Employer Group Health Plan";
    if (k.includes("student")) return "Student Health Protection Plan";
    return "Comprehensive Health Plan";
  }
  return kind.replace(/\s*\([^)]*(?:synthetic|demo)[^)]*\)/gi, "").trim() || "Comprehensive Health Plan";
}

// Default seed conversation for Sinta persona matching exact design mockup
const SINTA_INITIAL_TURN: Turn = {
  question: "Does my insurance cover dental treatment?",
  timestamp: "10:24 AM",
  answer: {
    disposition: "answered",
    intent: "POLICY_QUESTION",
    answer_markdown:
      "Based on your verified policies, your employer health insurance covers **preventive and basic dental treatment**, such as routine check-ups, scaling, and simple fillings, with an **annual limit of IDR 2,000,000**.\n\nMajor dental treatments, such as orthodontics, cosmetic procedures, and implants, **are not covered under this plan**.",
    evidence_verification_banner:
      "Answer based on your policies · This answer uses 2 verified documents from your Policy Wallet.",
    key_coverage_details: [
      { status: "COVERED", text: "Covered: routine check-up, scaling, simple filling" },
      { status: "LIMIT", text: "Annual limit: IDR 2,000,000 per year" },
      { status: "NOT_COVERED", text: "Not covered: orthodontics, cosmetic treatment, implants" },
      { status: "INFO", text: "Applies to: outpatient and dental clinic visits within the network" },
    ],
    answer_points: [
      {
        text: "Based on your verified policies, your employer health insurance covers preventive and basic dental treatment with annual limit of IDR 2,000,000.",
        label: "FROM_DOCUMENT",
        citations: [
          {
            doc: "c4711c36-9f41-59a6-987b-f479828e3d50",
            page: 6,
            quote:
              "Covers preventive dental care including routine check-up, scaling, and basic filling, with annual limit of IDR 2,000,000.",
            document_name: "Employer Benefits Guide",
            explanation_label: "PT Teknologi Maju",
          },
          {
            doc: "c4711c36-9f41-59a6-987b-f479828e3d50",
            page: 14,
            quote:
              "Orthodontic treatment, cosmetic dental procedures, and dental implants are excluded from coverage.",
            document_name: "Group Health Insurance Policy",
            explanation_label: "Allianz Indonesia",
          },
        ],
      },
    ],
    policies_used: [
      {
        policy_id: "allianz-emp-1",
        provider: "Allianz Indonesia",
        plan_name: "Employer Health Insurance",
        status: "Active",
        verification_status: "Verified",
        date_range: "1 Jan 2025 – 31 Dec 2025",
        logo_key: "id-insurer-allianz",
      },
      {
        policy_id: "aia-vitality-1",
        provider: "AIA Vitality",
        plan_name: "Personal Health Insurance",
        status: "Active",
        verification_status: "Verified",
        date_range: "1 Mar 2024 – 28 Feb 2026",
        logo_key: "id-insurer-aia",
      },
    ],
    sources_referenced: [
      {
        doc_id: "c4711c36-9f41-59a6-987b-f479828e3d50",
        document_name: "Employer Benefits Guide",
        organization: "PT Teknologi Maju",
        location: "Page 6 · Dental Benefits",
        page: 6,
        quote:
          "Covers preventive dental care including routine check-up, scaling, and basic filling, with annual limit of IDR 2,000,000.",
      },
      {
        doc_id: "c4711c36-9f41-59a6-987b-f479828e3d50",
        document_name: "Group Health Insurance Policy",
        organization: "Allianz Indonesia",
        location: "Page 14 · Exclusions",
        page: 14,
        quote:
          "Orthodontic treatment, cosmetic dental procedures, and dental implants are excluded from coverage.",
      },
    ],
    suggested_next_steps: [
      {
        title: "Check Dental Coverage Details",
        description: "View benefit limits, exclusions, and network.",
        action_url: "/protection",
        icon_type: "shield",
        action_type: "navigate",
      },
      {
        title: "Explore Dental Care Options",
        description: "See suitable insurance options if you need additional coverage.",
        action_url: "/pathways",
        icon_type: "heart",
        action_type: "navigate",
      },
      {
        title: "Create a Claim Draft",
        description: "Start preparing your dental claim with required documents.",
        action_url: "/claims",
        icon_type: "file",
        action_type: "navigate",
      },
    ],
    related_links: [
      {
        title: "View Dental Coverage in My Protection",
        url: "/protection",
        icon_type: "shield",
      },
      {
        title: "See Full Benefits in Policy Wallet",
        url: "/policies",
        icon_type: "document",
      },
      {
        title: "Explore Dental Care Options (if needed)",
        url: "/pathways",
        icon_type: "heart",
      },
      {
        title: "How to Claim Dental Treatment",
        url: "/claims",
        icon_type: "file",
      },
    ],
    follow_up_questions: [
      "How do I claim outpatient benefits?",
      "What documents do I need for a claim?",
      "When does my policy expire?",
    ],
  },
};

function renderInline(text: string) {
  return text.split("\n").map((line, li) => (
    <span key={li}>
      {li > 0 && <br />}
      {line.split(/(\*\*[^*]+\*\*)/g).map((part, i) =>
        part.startsWith("**") && part.endsWith("**") && part.length > 4 ? (
          <strong key={i}>{part.slice(2, -2)}</strong>
        ) : (
          part
        ),
      )}
    </span>
  ));
}

export default function AskPage() {
  const router = useRouter();
  const workspace = useWorkspace();
  const { demo } = useActor();

  const isSinta =
    Boolean(demo?.profile?.display_name?.toLowerCase().includes("sinta"));

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
  const [grantingConsent, setGrantingConsent] = useState(false);

  const [policy, setPolicy] = useState("");
  const [turns, setTurns] = useState<Turn[]>(() => (isSinta ? [SINTA_INITIAL_TURN] : []));
  const [chat, setChat] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [preparingId, setPreparingId] = useState<string | null>(null);
  const [status, setStatus] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [source, setSource] = useState<Citation | null>(null);

  const inputRef = useRef<HTMLInputElement | null>(null);
  const lastQuestionRef = useRef("");
  const controller = useRef<AbortController | null>(null);
  const identity = workspace.identityKey;
  const context = workspace.summary?.context;
  const storageKey = identity ? `insurra.policy-chat.${identity}` : null;

  useEffect(() => {
    return () => {
      controller.current?.abort();
    };
  }, []);

  useEffect(() => {
    const abort = new AbortController();
    const saved = storageKey ? sessionStorage.getItem(storageKey) : null;

    if (
      saved &&
      workspace.headers &&
      context?.process_documents &&
      context?.external_ai
    ) {
      api
        .request("get", "/api/v1/ask/sessions/{chat_session_id}", {
          headers: workspace.headers,
          params: { chat_session_id: saved },
          signal: abort.signal,
        })
        .then((history) => {
          if (!abort.signal.aborted && history.turns?.length) {
            setChat(history.chat_session_id);
            setTurns(
              history.turns.map((t) => ({
                question: t.question,
                answer: t.answer as Answer,
                timestamp: "Just now",
              }))
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
  const allowed = Boolean(context?.process_documents && context?.external_ai);
  const hasPolicies = Boolean(s.coverages?.length);
  const triageAvailable = s.triage_available !== false;
  const canAsk = hasPolicies && allowed && triageAvailable && !pending;

  // Grab the latest active turn's answer for the right sidebar
  const latestAnswer = turns.length > 0 ? turns[turns.length - 1].answer : null;

  function askAnother() {
    setQuestion("");
    inputRef.current?.focus();
  }

  async function grantAllConsent() {
    setGrantingConsent(true);
    try {
      const demoToken =
        typeof window !== "undefined"
          ? sessionStorage.getItem("insurra.demo-session")
          : null;
      if (demoToken) {
        await api.post("/api/v1/consents", demoToken, {
          purpose: "process_documents",
          granted: true,
          policy_version: "1.5",
        });
        await api.post("/api/v1/consents", demoToken, {
          purpose: "external_ai",
          granted: true,
          policy_version: "1.5",
        });
      } else if (workspace.headers?.Authorization) {
        const rawToken = workspace.headers.Authorization.replace(/^Bearer\s+/i, "");
        await api.post("/api/v1/account/consents", rawToken, {
          purpose: "process_documents",
          granted: true,
          policy_version: "1.5",
        });
        await api.post("/api/v1/account/consents", rawToken, {
          purpose: "external_ai",
          granted: true,
          policy_version: "1.5",
        });
      }
      workspace.refresh();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to grant consent."
      );
    } finally {
      setGrantingConsent(false);
    }
  }

  async function send(overrideValue?: string) {
    const value = ((overrideValue ?? question) || lastQuestionRef.current).trim();
    if (!value || pending) return;
    lastQuestionRef.current = value;

    if (!allowed) {
      const demoToken =
        typeof window !== "undefined"
          ? sessionStorage.getItem("insurra.demo-session")
          : null;
      if (demoToken) {
        try {
          await api.post("/api/v1/consents", demoToken, {
            purpose: "process_documents",
            granted: true,
            policy_version: "1.5",
          });
          await api.post("/api/v1/consents", demoToken, {
            purpose: "external_ai",
            granted: true,
            policy_version: "1.5",
          });
        } catch {
          // ignore if already granted
        }
      } else {
        setError(
          "Please enable Document Processing and External AI permissions before asking."
        );
        return;
      }
    }

    if (!workspace.headers) return;
    const abort = new AbortController();
    controller.current = abort;
    setPending(true);
    setError(null);
    setStatus("Analyzing policy documents…");

    const nowFormatted = new Date().toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
    });

    const base = [
      ...turns,
      { question: value, answer: null, timestamp: nowFormatted },
    ].slice(-10);
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
        if (event.event === "progress") {
          setStatus(
            event.data.stage === "retrieving"
              ? "Retrieving clauses from retained pages…"
              : "Validating citations & financial limits…"
          );
        }
        if (event.event === "answer_point") {
          points.push(event.data as Point);
          setTurns([
            ...base.slice(0, -1),
            {
              question: value,
              timestamp: nowFormatted,
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
            { question: value, timestamp: nowFormatted, answer: event.data as Answer },
          ]);
          setChat(event.data.chat_session_id ?? null);
          if (storageKey && event.data.chat_session_id)
            sessionStorage.setItem(storageKey, event.data.chat_session_id);
          setStatus("");
          setQuestion("");
        }
        if (event.event === "redirect") {
          setTurns(base.slice(0, -1));
          setStatus("");
          setQuestion("");
          setError(
            "Red flag or urgent symptoms detected. Policy Q&A is paused. Please review emergency guidance."
          );
          router.push("/emergency");
        }
        if (event.event === "error") throw new Error(event.data.message);
      }
    } catch (cause) {
      if (abort.signal.aborted && controller.current !== abort) return;
      setTurns(base.slice(0, -1));
      setStatus("");
      setError(
        abort.signal.aborted
          ? "Request cancelled; no answer recorded."
          : cause instanceof Error
          ? cause.message
          : "Could not retrieve answer. Please try again."
      );
    } finally {
      if (controller.current === abort) {
        setPending(false);
        controller.current = null;
      }
    }
  }

  function cancelRequest() {
    controller.current?.abort();
    controller.current = null;
    setPending(false);
    setStatus("");
    setTurns((current) =>
      current.length && current[current.length - 1].answer === null
        ? current.slice(0, -1)
        : current,
    );
    setError("Request cancelled; no answer recorded.");
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
        cause instanceof Error ? cause.message : "History could not be cleared."
      );
    }
  }

  async function prepareProposal(proposalId: string) {
    if (!workspace.headers || preparingId) return;
    setPreparingId(proposalId);
    setError(null);
    try {
      const data = await api.request(
        "post",
        "/api/v1/ask/proposals/{proposal_id}/prepare",
        {
          headers: workspace.headers,
          params: { proposal_id: proposalId },
        }
      );
      router.push(`/actions?action=${encodeURIComponent(data.action_id)}`);
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Could not prepare action draft."
      );
    } finally {
      setPreparingId(null);
    }
  }

  return (
    <div className="vn ask-dashboard-container" lang="en">
      {/* ====================================================================
          Top Hero Banner with Mascot & Cityscape
          ==================================================================== */}
      <section className="ask-top-banner">
        <div className="ask-banner-art-overlay" />
        <div className="ask-banner-inner">
          <div className="ask-banner-left">
            <h1 className="ask-banner-title">Ask INSSURA</h1>
            <p className="ask-banner-subtitle">
              Your context-aware insurance assistant.
            </p>
            <p className="ask-banner-desc">
              Get clear, personalized answers based on your policies, documents,
              and latest protection analysis.
            </p>

            <div className="ask-banner-pills-wrap">
              <div className="flex items-center justify-between gap-3 text-xs text-slate-500 mb-1">
                <div className="flex items-center gap-2">
                  <span className="font-semibold text-slate-700">Scope:</span>
                  <select
                    aria-label="Filter policy scope"
                    className="bg-white/80 border border-slate-200 rounded-md px-2 py-0.5 text-xs text-slate-700 font-medium outline-none focus:border-teal-500"
                    value={policy}
                    onChange={(e) => setPolicy(e.target.value)}
                    disabled={pending}
                  >
                    <option value="">All active policies</option>
                    {s.coverages?.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.provider || c.kind} · {c.country_label || c.country_code}
                      </option>
                    ))}
                  </select>
                </div>
                <button
                  type="button"
                  className="inline-flex items-center gap-1 text-slate-600 hover:text-slate-900 font-medium px-2 py-0.5 rounded hover:bg-white/60 transition"
                  onClick={() => void reset()}
                  disabled={pending}
                >
                  <RotateCcw size={12} /> New chat
                </button>
              </div>

              <div className="ask-pills-row">
                <button
                  type="button"
                  className="ask-prompt-pill"
                  onClick={() => void send("Does my insurance cover dental treatment?")}
                  disabled={pending}
                >
                  Does my insurance cover dental treatment?
                </button>
                <button
                  type="button"
                  className="ask-prompt-pill"
                  onClick={() => void send("How do I claim outpatient benefits?")}
                  disabled={pending}
                >
                  How do I claim outpatient benefits?
                </button>
                <button
                  type="button"
                  className="ask-prompt-pill"
                  onClick={() => void send("What documents do I need for a claim?")}
                  disabled={pending}
                >
                  What documents do I need for a claim?
                </button>
              </div>
              <div className="ask-pills-row">
                <button
                  type="button"
                  className="ask-prompt-pill"
                  onClick={() => void send("When does my policy expire?")}
                  disabled={pending}
                >
                  When does my policy expire?
                </button>
                <button
                  type="button"
                  className="ask-prompt-pill"
                  onClick={() => void send("What is not covered in my plan?")}
                  disabled={pending}
                >
                  What is not covered in my plan?
                </button>
                <button
                  type="button"
                  className="ask-prompt-pill"
                  onClick={() => void send("Compare my two policies")}
                  disabled={pending}
                >
                  Compare my two policies
                </button>
              </div>
            </div>
          </div>

          <div className="ask-banner-right">
            <div className="ask-mascot-speech-bubble">
              Ask anything about your insurance! ❤️
            </div>
            <Image
              src="/mascot-bubble.png"
              alt="INSSURA Assistant Mascot"
              width={140}
              height={140}
              priority
              className="ask-banner-mascot-art"
            />
          </div>
        </div>
      </section>

      {/* Enable AI & Document Analysis Permission Banner if needed */}
      {!allowed && (
        <div className="ask-consent-banner">
          <div className="ask-consent-left">
            <ShieldCheck className="text-teal-600 shrink-0" size={22} />
            <div>
              <h4 className="font-semibold text-slate-800 text-sm">
                Enable AI & Document Analysis
              </h4>
              <p className="text-xs text-slate-600 m-0">
                INSSURA AI needs permission to read your policy clauses and answer with external AI.
              </p>
            </div>
          </div>
          <button
            type="button"
            className="ask-consent-btn"
            disabled={grantingConsent}
            onClick={() => void grantAllConsent()}
          >
            {grantingConsent ? "Enabling…" : "Enable AI & Policy Access"}
          </button>
        </div>
      )}

      {!triageAvailable && (
        <div className="p-3 bg-amber-50 border border-amber-200 text-amber-800 text-xs rounded-xl mx-4 mb-3" role="alert">
          Pemeriksaan tanda bahaya belum tersedia untuk wilayah ini. Tanya jawab dinonaktifkan demi keselamatan.
        </div>
      )}

      {/* ====================================================================
          Main Grid Layout: Chat Stream (Left) + Intelligence Panels (Right)
          ==================================================================== */}
      <div className="ask-content-grid">
        {/* Chat Conversation Column */}
        <div className="ask-chat-column" role="log" aria-live="polite">
          {turns.map((turn, tIdx) => (
            <article key={tIdx} className="ask-turn-wrapper">
              {/* User Message Bubble */}
              <div className="ask-user-row">
                <div className="ask-user-bubble">
                  {turn.question}
                  {turn.timestamp && (
                    <div className="ask-user-timestamp">{turn.timestamp}</div>
                  )}
                </div>
                <div className="ask-user-avatar">
                  <Image
                    src="/protection-hero-person.png"
                    alt="User Avatar"
                    width={34}
                    height={34}
                    className="w-full h-full object-cover"
                  />
                </div>
              </div>

              {/* Assistant Response Card */}
              {turn.answer && (
                <div className="ask-bot-row">
                  <div className="ask-bot-avatar">
                    <InsurraMascot variant="assistant" size={26} decorative />
                  </div>

                  <div className="ask-bot-card">
                    {/* Main Formatted Text */}
                    <div className="ask-answer-text">
                      {turn.answer.disposition === "no_match" && (
                        <h3 className="text-sm font-bold text-slate-800 mb-2">
                          Not found in your documents
                        </h3>
                      )}
                      {turn.answer.answer_markdown ? (
                        turn.answer.answer_markdown
                          .split("\n\n")
                          .map((para, pIdx) => (
                            <p key={pIdx}>{renderInline(para)}</p>
                          ))
                      ) : (
                        turn.answer.answer_points?.map((pt, pIdx) => (
                          <p key={pIdx}>{pt.text}</p>
                        ))
                      )}
                    </div>

                    {/* Verification Green Pill Banner */}
                    <div className="ask-verification-banner">
                      <div className="ask-verification-left">
                        <CheckCircle2
                          size={18}
                          className="ask-verification-icon"
                        />
                        <div>
                          <h4 className="ask-verification-title">
                            Answer based on your policies
                          </h4>
                          <p className="ask-verification-sub">
                            {turn.answer.evidence_verification_banner ||
                              "This answer uses 2 verified documents from your Policy Wallet."}
                          </p>
                        </div>
                      </div>
                      <span className="ask-verification-time">
                        {turn.timestamp || "10:24 AM"}
                      </span>
                    </div>

                    {/* Key Coverage Details Box */}
                    {turn.answer.key_coverage_details &&
                      turn.answer.key_coverage_details.length > 0 && (
                        <div className="ask-key-details-card">
                          <h3 className="ask-key-details-header">
                            Key coverage details
                          </h3>
                          <ul className="ask-key-details-list">
                            {turn.answer.key_coverage_details.map((detail, dIdx) => (
                              <li key={dIdx} className="ask-key-details-item">
                                <span className="ask-key-icon-wrap">
                                  {detail.status === "COVERED" && (
                                    <CheckCircle2 size={16} className="text-emerald-500" />
                                  )}
                                  {detail.status === "LIMIT" && (
                                    <AlertCircle size={16} className="text-amber-500" />
                                  )}
                                  {detail.status === "NOT_COVERED" && (
                                    <XCircle size={16} className="text-rose-500" />
                                  )}
                                  {(detail.status === "CONDITION" || detail.status === "INFO") && (
                                    <Info size={16} className="text-sky-500" />
                                  )}
                                </span>
                                <span>{detail.text}</span>
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}

                    {/* Citations Grid */}
                    {turn.answer.answer_points?.some((pt) => pt.citations?.length > 0) && (
                      <div className="ask-citations-section">
                        <div className="ask-citations-header">
                          <h3 className="ask-citations-title">Citations</h3>
                          <span className="ask-citations-badge">
                            {turn.answer.answer_points.reduce(
                              (sum, pt) => sum + (pt.citations?.length || 0),
                              0
                            )}{" "}
                            sources
                          </span>
                        </div>

                        <div className="ask-citations-grid">
                          {turn.answer.answer_points
                            .flatMap((pt) => pt.citations || [])
                            .map((c, cIdx) => (
                              <button
                                type="button"
                                key={cIdx}
                                className="ask-citation-card text-left cursor-pointer"
                                onClick={() => setSource(c)}
                                aria-label={`${c.document_name || "Dokumen"} · p. ${c.page}`}
                                title="Click to view full page source"
                              >
                                <span className="sr-only">
                                  {c.document_name || "Dokumen"} · p. {c.page}
                                </span>
                                <div className="ask-citation-top">
                                  <div className="flex items-center gap-2">
                                    <span className="ask-citation-num-badge">
                                      {cIdx + 1}
                                    </span>
                                    <div className="ask-citation-meta">
                                      <h4 className="ask-citation-doc-name">
                                        {c.document_name || "Policy Document"}
                                      </h4>
                                      {c.explanation_label && (
                                        <p className="ask-citation-org">
                                          {c.explanation_label}
                                        </p>
                                      )}
                                      <p className="ask-citation-location">
                                        Page {c.page}
                                      </p>
                                    </div>
                                  </div>
                                  <ExternalLink
                                    size={14}
                                    className="ask-citation-open-btn"
                                  />
                                </div>
                                <blockquote className="ask-citation-quote">
                                  &ldquo;{c.quote}&rdquo;
                                </blockquote>
                              </button>
                            ))}
                        </div>
                      </div>
                    )}

                    {/* Action Proposals if any */}
                    {turn.answer.proposals && turn.answer.proposals.length > 0 && (
                      <div className="mt-2 p-3.5 bg-amber-50/70 border border-amber-200 rounded-xl flex flex-col gap-2">
                        {turn.answer.proposals.map((prop) => (
                          <div
                            key={prop.proposal_id}
                            className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3"
                          >
                            <div>
                              <strong className="text-xs font-bold text-amber-950 block">
                                {prop.title}
                              </strong>
                              <p className="text-xs text-amber-900 m-0">
                                {prop.summary}
                              </p>
                            </div>
                            <button
                              type="button"
                              className="px-3 py-1.5 bg-teal-600 hover:bg-teal-700 text-white rounded-lg text-xs font-semibold shrink-0 transition"
                              disabled={preparingId === prop.proposal_id}
                              onClick={() => void prepareProposal(prop.proposal_id)}
                            >
                              {preparingId === prop.proposal_id
                                ? "Preparing…"
                                : "Prepare Action Draft"}
                            </button>
                          </div>
                        ))}
                      </div>
                    )}

                    {/* Related to your situation links */}
                    {turn.answer.related_links && turn.answer.related_links.length > 0 && (
                      <div className="ask-related-section">
                        <h4 className="ask-related-title">
                          Related to your situation
                        </h4>
                        <div className="ask-related-links-row">
                          {turn.answer.related_links.map((link, lIdx) => (
                            <Link
                              key={lIdx}
                              href={link.url}
                              className="ask-related-link-card"
                            >
                              <div className="ask-related-link-left">
                                {link.icon_type === "shield" && (
                                  <Shield size={15} className="text-teal-600" />
                                )}
                                {link.icon_type === "document" && (
                                  <FileText size={15} className="text-sky-600" />
                                )}
                                {link.icon_type === "heart" && (
                                  <Heart size={15} className="text-rose-500" />
                                )}
                                {link.icon_type === "file" && (
                                  <CheckCircle2 size={15} className="text-emerald-600" />
                                )}
                                <span>{link.title}</span>
                              </div>
                              <ArrowRight
                                size={13}
                                className="ask-related-link-arrow"
                              />
                            </Link>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Interactive Follow-up Question Chips */}
                    {turn.answer.follow_up_questions && turn.answer.follow_up_questions.length > 0 && (
                      <div className="ask-followups-wrap">
                        <div className="ask-followups-label">Suggested follow-ups:</div>
                        <div className="ask-followups-chips">
                          {turn.answer.follow_up_questions.map((fq, fIdx) => (
                            <button
                              key={fIdx}
                              type="button"
                              className="ask-followup-chip"
                              onClick={() => void send(fq)}
                              disabled={pending}
                            >
                              <span>{fq}</span>
                              <ArrowRight size={12} className="ask-followup-chip-arrow" />
                            </button>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </article>
          ))}

          {/* Status / Pending Indicator */}
          {pending && (
            <div className="ask-bot-row">
              <div className="ask-bot-avatar">
                <InsurraMascot variant="assistant" size={24} decorative />
              </div>
              <div className="ask-bot-card animate-pulse">
                <div className="flex items-center gap-2 text-xs font-semibold text-teal-800">
                  <div className="w-2 h-2 rounded-full bg-teal-500 animate-ping" />
                  {status || "Thinking and searching your policies…"}
                </div>
              </div>
            </div>
          )}

          {error && (
            <div className="p-3 bg-rose-50 border border-rose-200 text-rose-800 text-xs rounded-xl flex items-center justify-between" role="alert">
              <span>{error}</span>
              <button
                type="button"
                className="underline font-bold"
                aria-label="Coba lagi"
                onClick={() => void send(question || lastQuestionRef.current)}
              >
                Coba lagi
              </button>
            </div>
          )}

          {/* Bottom Floating Input Bar */}
          <div className="ask-input-bar-container">
            {!hasPolicies && (
              <div
                className="mb-2 p-3 bg-amber-50/90 border border-amber-200 rounded-xl flex items-center justify-between text-xs text-amber-900 shadow-sm"
                role="alert"
              >
                <div className="flex items-center gap-2">
                  <AlertCircle size={16} className="text-amber-600 shrink-0" />
                  <span>
                    Belum ada dokumen polis aktif terdaftar. Unggah dokumen polis Anda agar Insurra AI dapat memeriksa klausa &amp; manfaat asuransi Anda.
                  </span>
                </div>
                <Link
                  href="/documents"
                  className="ml-3 px-3 py-1 bg-amber-600 hover:bg-amber-700 text-white font-medium rounded-lg shrink-0 transition"
                >
                  Unggah Polis
                </Link>
              </div>
            )}
            <form
              className="ask-input-bar"
              onSubmit={(e) => {
                e.preventDefault();
                void send();
              }}
            >
              <button
                type="button"
                className="ask-input-clip-btn"
                title="Attach or upload policy document"
                onClick={() => router.push("/documents")}
              >
                <Paperclip size={18} />
              </button>

              <input
                ref={inputRef}
                type="text"
                aria-label="Your question"
                className="ask-text-input"
                placeholder={
                  !hasPolicies
                    ? "Unggah dokumen polis di Policy Wallet untuk mulai bertanya…"
                    : "Tanyakan apapun seputar perlindungan atau klaim polis Anda…"
                }
                value={question}
                disabled={!canAsk || pending}
                onChange={(e) => setQuestion(e.target.value)}
              />

              {pending ? (
                <button
                  key="cancel-request"
                  type="button"
                  className="ask-send-btn px-2 text-xs"
                  aria-label="Batalkan"
                  onClick={cancelRequest}
                >
                  Batalkan
                </button>
              ) : (
                <button
                  key="send-question"
                  type="submit"
                  className="ask-send-btn"
                  disabled={!hasPolicies || !question.trim() || pending || !triageAvailable}
                  title="Send question"
                  aria-label="Kirim"
                >
                  <ArrowRight size={17} />
                  <span className="sr-only">Kirim</span>
                </button>
              )}
            </form>
          </div>
        </div>

        {/* Right Sidebar Column */}
        <aside className="ask-sidebar-column">
          {/* 1. Policies Used in This Answer */}
          <div className="ask-side-card">
            <div className="ask-side-card-header">
              <h3 className="ask-side-card-title">
                Policies Used in This Answer
              </h3>
              <Link href="/policies" className="ask-side-card-link">
                View all <ChevronRight size={14} />
              </Link>
            </div>

            <div className="flex flex-col gap-2">
              {latestAnswer?.policies_used && latestAnswer.policies_used.length > 0 ? (
                latestAnswer.policies_used.map((pol, idx) => {
                  const cleanProv = formatCleanProvider(pol.provider, pol.plan_name);
                  const cleanPlan = formatCleanPlan(pol.plan_name);
                  const brand = getInsurerBrand(cleanProv);
                  return (
                    <Link
                      key={idx}
                      href="/policies"
                      className="ask-sidebar-policy-item"
                    >
                      <div className="ask-sidebar-policy-left">
                        <div className="ask-policy-logo-box">
                          {(brand?.markUrl || brand?.logoUrl) ? (
                            <Image
                              src={brand.markUrl || brand.logoUrl}
                              alt={brand.name}
                              width={24}
                              height={24}
                              className="object-contain"
                            />
                          ) : (
                            <Shield size={18} className="text-teal-600" />
                          )}
                        </div>
                        <div className="ask-policy-info-wrap">
                          <span className="ask-policy-name-txt">
                            {cleanPlan}
                          </span>
                          <span className="ask-policy-provider-txt">
                            {cleanProv}
                            <span className="ask-verified-mini-pill">
                              <CheckCircle2 size={11} /> Verified
                            </span>
                          </span>
                          <span className="ask-policy-date-txt">
                            {pol.status} · {pol.date_range}
                          </span>
                        </div>
                      </div>
                      <ChevronRight size={14} className="text-slate-400" />
                    </Link>
                  );
                })
              ) : s.coverages?.length ? (
                s.coverages.slice(0, 2).map((c) => {
                  const cleanProv = formatCleanProvider(c.provider, c.kind);
                  const cleanPlan = formatCleanPlan(c.kind);
                  const brand = getInsurerBrand(cleanProv);
                  return (
                    <Link
                      key={c.id}
                      href="/policies"
                      className="ask-sidebar-policy-item"
                    >
                      <div className="ask-sidebar-policy-left">
                        <div className="ask-policy-logo-box">
                          {(brand?.markUrl || brand?.logoUrl) ? (
                            <Image
                              src={brand.markUrl || brand.logoUrl}
                              alt={brand.name}
                              width={24}
                              height={24}
                              className="object-contain"
                            />
                          ) : (
                            <Shield size={18} className="text-teal-600" />
                          )}
                        </div>
                        <div className="ask-policy-info-wrap">
                          <span className="ask-policy-name-txt">
                            {cleanPlan}
                          </span>
                          <span className="ask-policy-provider-txt">
                            {cleanProv}
                            <span className="ask-verified-mini-pill">
                              <CheckCircle2 size={11} /> Verified
                            </span>
                          </span>
                          <span className="ask-policy-date-txt">
                            {c.active ? "Active" : "Under review"} · {c.start_date || "2025"} – {c.end_date || "Present"}
                          </span>
                        </div>
                      </div>
                      <ChevronRight size={14} className="text-slate-400" />
                    </Link>
                  );
                })
              ) : (
                <p className="text-xs text-slate-500 m-0">
                  No active policies recorded.
                </p>
              )}
            </div>
          </div>

          {/* 2. Sources Referenced */}
          <div className="ask-side-card">
            <div className="ask-side-card-header">
              <h3 className="ask-side-card-title">Sources Referenced</h3>
              <Link href="/documents" className="ask-side-card-link">
                View all <ChevronRight size={14} />
              </Link>
            </div>

            <div className="flex flex-col gap-2">
              {latestAnswer?.sources_referenced &&
              latestAnswer.sources_referenced.length > 0 ? (
                latestAnswer.sources_referenced.map((src, idx) => (
                  <button
                    key={idx}
                    type="button"
                    className="ask-sidebar-source-item"
                    onClick={() =>
                      setSource({
                        doc: src.doc_id || "c4711c36-9f41-59a6-987b-f479828e3d50",
                        page: src.page,
                        quote: src.quote || "",
                        document_name: src.document_name,
                        explanation_label: src.organization,
                      })
                    }
                  >
                    <div className="ask-sidebar-source-left">
                      <div className="ask-sidebar-source-icon">
                        <FileText size={16} />
                      </div>
                      <div>
                        <div className="ask-sidebar-source-title">
                          {src.document_name}
                        </div>
                        {src.organization && (
                          <div className="ask-sidebar-source-sub">
                            {src.organization}
                          </div>
                        )}
                        <div className="ask-sidebar-source-loc">
                          {src.location}
                        </div>
                      </div>
                    </div>
                    <ChevronRight size={14} className="text-slate-400" />
                  </button>
                ))
              ) : (
                <p className="text-xs text-slate-500 m-0">
                  Sources will be displayed when an answer is provided.
                </p>
              )}
            </div>
          </div>

          {/* 3. Suggested Next Steps */}
          <div className="ask-side-card">
            <h3 className="ask-side-card-title">Suggested Next Steps</h3>

            <div className="flex flex-col gap-2">
              {latestAnswer?.suggested_next_steps &&
              latestAnswer.suggested_next_steps.length > 0 ? (
                latestAnswer.suggested_next_steps.map((step, idx) => (
                  <Link
                    key={idx}
                    href={step.action_url}
                    className="ask-step-item"
                  >
                    <div className="ask-step-left">
                      <div
                        className={`ask-step-icon-wrap ${
                          step.icon_type === "shield"
                            ? "bg-emerald-50 text-emerald-600"
                            : step.icon_type === "heart"
                            ? "bg-purple-50 text-purple-600"
                            : "bg-amber-50 text-amber-600"
                        }`}
                      >
                        {step.icon_type === "shield" && <ShieldCheck size={16} />}
                        {step.icon_type === "heart" && <Heart size={16} />}
                        {step.icon_type === "file" && <FileText size={16} />}
                      </div>
                      <div>
                        <div className="ask-step-title">{step.title}</div>
                        <div className="ask-step-desc">
                          {step.description}
                        </div>
                      </div>
                    </div>
                    <ChevronRight size={14} className="text-slate-400" />
                  </Link>
                ))
              ) : (
                <>
                  <Link href="/protection" className="ask-step-item">
                    <div className="ask-step-left">
                      <div className="ask-step-icon-wrap bg-emerald-50 text-emerald-600">
                        <ShieldCheck size={16} />
                      </div>
                      <div>
                        <div className="ask-step-title">
                          Check Protection Findings
                        </div>
                        <div className="ask-step-desc">
                          Review analyzed benefits and coverage gaps.
                        </div>
                      </div>
                    </div>
                    <ChevronRight size={14} className="text-slate-400" />
                  </Link>
                  <Link href="/pathways" className="ask-step-item">
                    <div className="ask-step-left">
                      <div className="ask-step-icon-wrap bg-purple-50 text-purple-600">
                        <Heart size={16} />
                      </div>
                      <div>
                        <div className="ask-step-title">
                          Explore Care Pathways
                        </div>
                        <div className="ask-step-desc">
                          Compare non-emergency care options.
                        </div>
                      </div>
                    </div>
                    <ChevronRight size={14} className="text-slate-400" />
                  </Link>
                </>
              )}
            </div>
          </div>

          {/* 4. Lavender Help Card */}
          <div className="ask-help-card">
            <div className="ask-help-header">
              <div className="ask-help-icon">
                <Info size={18} />
              </div>
              <h4 className="ask-help-title">Not sure or need more details?</h4>
            </div>
            <p className="ask-help-text">
              You can upload a document, or ask a more specific question such as
              the type of treatment, provider, or cost.
            </p>
            <div className="ask-help-actions">
              <Link href="/documents" className="ask-help-btn" aria-label="Upload document">
                <Upload size={14} /> Upload document
              </Link>
              <button
                type="button"
                className="ask-help-btn"
                onClick={askAnother}
              >
                <HelpCircle size={14} /> Ask Another Question
              </button>
            </div>
          </div>
        </aside>
      </div>

      {/* Source Citation Drawer */}
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
