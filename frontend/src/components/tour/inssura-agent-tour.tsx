"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { ArrowLeft, Bot, CheckCircle2, FileSearch, Loader2, X } from "lucide-react";
import "./agent-tour.css";

export interface TourStep {
  id: string;
  route: string;
  /** CSS selectors tried in order; the first visible match is spotlighted. */
  targets: string[];
  agentName: string;
  title: string;
  description: string;
  mascot: string;
}

export const INSSURA_AGENT_STEPS: TourStep[] = [
  {
    id: "welcome",
    route: "/home",
    targets: ['a.nav-item[href="/home"]'],
    agentName: "Command Center",
    title: "Welcome to Your Insurance Companion",
    description:
      "Meet INSSURA, your personal insurance companion. Let's see how your protection works together.",
    mascot: "/Winking Kangaroo Shield Mascot.png",
  },
  {
    id: "protection",
    route: "/protection",
    targets: ['[data-tour="check-protection"]', 'a.nav-item[href="/protection"]'],
    agentName: "Protection Review Agent",
    title: "Discover what protection you need",
    description:
      "The AI Protection Review Agent analyzes your onboarding profile, needs, and available policies. Try the button below.",
    mascot: "/Winking Kangaroo Shield Mascot.png",
  },
  {
    id: "documents",
    route: "/documents",
    targets: ['[data-tour="upload-document"]', 'a.nav-item[href="/documents"]'],
    agentName: "Document Intelligence Agent",
    title: "Turn documents into insurance intelligence",
    description:
      "Documents are classified, extracted by AI, then verified against sources you can check yourself.",
    mascot: "/Winking Kangaroo Mascot with Document.png",
  },
  {
    id: "ask",
    route: "/ask",
    targets: ['a.nav-item[href="/ask"]'],
    agentName: "Ask INSSURA",
    title: "Ask questions about your actual policies",
    description:
      "Answers come with citations from your policy documents. If a benefit is unverified, INSSURA says so. Pick a sample question.",
    mascot: "/mascot-bubble.png",
  },
  {
    id: "pathways",
    route: "/pathways",
    targets: ['a.nav-item[href="/pathways"]'],
    agentName: "Care Navigator",
    title: "Find the right care path",
    description:
      "INSSURA evaluates service options, coverage terms, and next steps before you visit a care facility.",
    mascot: "/mascot-care-doctor-trans.png",
  },
  {
    id: "claims",
    route: "/claims",
    targets: ['a.nav-item[href="/claims"]'],
    agentName: "Claim Preparation Agent",
    title: "Let INSSURA prepare your claim",
    description:
      "The flow: Claim Readiness → AI Claim Draft → Review → Approval. Nothing is sent without your approval.",
    mascot: "/Cute Mascot with Checklist Clipboard.png",
  },
  {
    id: "proactive",
    route: "/audit",
    targets: ['a.nav-item[href="/audit"]'],
    agentName: "Renewal Agent",
    title: "Your agent works proactively, with your approval",
    description:
      "The Renewal Agent detects potential gaps, proposes actions, then waits for your approval. Everything is recorded in Activity & Audit.",
    mascot: "/mascot-bubble.png",
  },
];

const TOUR_STORAGE_KEY = "inssura_agent_tour_state_v2";
const TOTAL = INSSURA_AGENT_STEPS.length;

export function triggerInssuraTour(stepIndex = 0) {
  if (typeof window === "undefined") return;
  const idx = Math.max(0, Math.min(stepIndex, TOTAL - 1));
  const step = INSSURA_AGENT_STEPS[idx];
  localStorage.setItem(TOUR_STORAGE_KEY, JSON.stringify({ active: true, stepIndex: idx }));
  window.dispatchEvent(
    new CustomEvent("inssura:tour-change", { detail: { active: true, stepIndex: idx } })
  );
  // Full navigation so the shell remounts and picks up the persisted tour state.
  // eslint-disable-next-line @next/next/no-location-assign-relative-destination
  window.location.href = `${step.route}?tour=${step.id}`;
}

/* ------------------------------ Mini live demos ------------------------------ */

const SAMPLE_NOTE = "Illustrative sample, not your data";

function useTimedReveal(count: number, intervalMs = 550) {
  const [shown, setShown] = useState(0);
  const [running, setRunning] = useState(false);
  useEffect(() => {
    if (!running) return;
    if (shown >= count) return;
    const t = setTimeout(() => setShown((n) => n + 1), intervalMs);
    return () => clearTimeout(t);
  }, [running, shown, count, intervalMs]);
  return { shown, running, start: () => setRunning(true), done: running && shown >= count };
}

function ProtectionDemo() {
  const rows: Array<[string, string, string]> = [
    ["Inpatient", "Needs verification", "warn"],
    ["Outpatient", "Unknown", "unknown"],
    ["Emergency evacuation", "Potential gap", "gap"],
  ];
  const { shown, running, start } = useTimedReveal(rows.length + 1);
  return (
    <div className="tour-demo">
      {!running ? (
        <button type="button" className="tour-demo-cta" onClick={start}>
          <FileSearch size={14} /> See AI Analysis
        </button>
      ) : (
        <ul className="tour-demo-list">
          {shown === 0 && (
            <li className="tour-demo-muted">
              <Loader2 size={13} className="tour-spin" /> Analyzing profile, needs &amp; policies…
            </li>
          )}
          {rows.slice(0, Math.max(0, shown - 1)).map(([k, v, tone]) => (
            <li key={k} className="tour-demo-row">
              <span>{k}</span>
              <b className={`tour-tag tour-tag-${tone}`}>{v}</b>
            </li>
          ))}
        </ul>
      )}
      <small className="tour-demo-note">{SAMPLE_NOTE}</small>
    </div>
  );
}

function DocumentsDemo() {
  const fields: Array<[string, string, string]> = [
    ["Document type", "Health insurance policy", "p. 1"],
    ["Validity period", "Read from document", "p. 2"],
    ["Benefit limit", "Needs verification", "p. 4"],
  ];
  const { shown, running, start } = useTimedReveal(fields.length + 1, 650);
  return (
    <div className="tour-demo">
      {!running ? (
        <button type="button" className="tour-demo-cta" onClick={start}>
          <FileSearch size={14} /> Run AI extraction
        </button>
      ) : (
        <>
          <div className="tour-demo-bar">
            <span style={{ width: `${Math.min(100, (shown / (fields.length + 1)) * 100)}%` }} />
          </div>
          <ul className="tour-demo-list">
            {fields.slice(0, Math.max(0, shown - 1)).map(([k, v, src]) => (
              <li key={k} className="tour-demo-row">
                <span>
                  {k}: <b>{v}</b>
                </span>
                <em className="tour-source">{src}</em>
              </li>
            ))}
          </ul>
        </>
      )}
      <small className="tour-demo-note">{SAMPLE_NOTE}</small>
    </div>
  );
}

function ChipDemo({
  items,
  noteLabel,
}: {
  items: Array<{ q: string; a: string; cite: string }>;
  noteLabel?: string;
}) {
  const [sel, setSel] = useState<number | null>(null);
  return (
    <div className="tour-demo">
      <div className="tour-chips">
        {items.map((it, i) => (
          <button
            key={it.q}
            type="button"
            className={`tour-chip ${sel === i ? "active" : ""}`}
            onClick={() => setSel(i)}
          >
            {it.q}
          </button>
        ))}
      </div>
      {sel !== null && (
        <div className="tour-demo-answer" key={sel}>
          <p>{items[sel].a}</p>
          <em className="tour-source">{items[sel].cite}</em>
        </div>
      )}
      <small className="tour-demo-note">{noteLabel ?? SAMPLE_NOTE}</small>
    </div>
  );
}

function ClaimsDemo() {
  const stages = ["Claim Readiness", "AI Claim Draft", "Review", "Approval"];
  const { shown, running, start } = useTimedReveal(stages.length, 700);
  return (
    <div className="tour-demo">
      {!running && (
        <button type="button" className="tour-demo-cta" onClick={start}>
          <FileSearch size={14} /> Turn invoice into claim draft
        </button>
      )}
      {running && (
        <ol className="tour-stepper">
          {stages.map((s, i) => (
            <li key={s} className={i < shown ? "done" : i === shown ? "current" : ""}>
              {i < shown ? <CheckCircle2 size={13} /> : <span className="tour-dotmark" />}
              {s}
              {i === stages.length - 1 && i < shown && (
                <small> awaiting your approval</small>
              )}
            </li>
          ))}
        </ol>
      )}
      <small className="tour-demo-note">{SAMPLE_NOTE}</small>
    </div>
  );
}

function ProactiveDemo() {
  const [approved, setApproved] = useState(false);
  return (
    <div className="tour-demo">
      <ul className="tour-demo-list">
        <li className="tour-demo-row">
          <span>
            <b>Finding:</b> policy nearing expiry, potential continuity gap
          </span>
        </li>
        <li className="tour-demo-row">
          <span>
            <b>Proposed action:</b> prepare a renewal for your review
          </span>
        </li>
      </ul>
      {!approved ? (
        <button type="button" className="tour-demo-cta" onClick={() => setApproved(true)}>
          Approve (sandbox simulation)
        </button>
      ) : (
        <div className="tour-demo-answer">
          <p>
            <CheckCircle2 size={13} /> Sandbox receipt recorded in Activity &amp; Audit. This is a simulation:
            no real action was sent.
          </p>
        </div>
      )}
      <small className="tour-demo-note">{SAMPLE_NOTE}</small>
    </div>
  );
}

function StepDemo({ id }: { id: string }) {
  switch (id) {
    case "protection":
      return <ProtectionDemo />;
    case "documents":
      return <DocumentsDemo />;
    case "ask":
      return (
        <ChipDemo
          items={[
            { q: "Is outpatient covered?", a: "INSSURA answers from your policy clauses and says when something is unverified.", cite: "Citation: policy document, relevant page" },
            { q: "What is the inpatient limit?", a: "Limits are shown exactly as in the document, never guessed.", cite: "Citation: benefit table, relevant page" },
          ]}
        />
      );
    case "pathways":
      return (
        <ChipDemo
          items={[
            { q: "Toothache", a: "Service options, coverage terms, and next steps are tailored to your context.", cite: "Confirm before visiting" },
            { q: "High fever", a: "Triage is reviewed first; if symptoms are urgent, you are directed to emergency help.", cite: "Not a medical diagnosis" },
          ]}
        />
      );
    case "claims":
      return <ClaimsDemo />;
    case "proactive":
      return <ProactiveDemo />;
    default:
      return null;
  }
}

/* --------------------------------- Spotlight --------------------------------- */

interface Box {
  top: number;
  left: number;
  width: number;
  height: number;
}

function findTarget(selectors: string[]): Box | null {
  for (const sel of selectors) {
    const el = document.querySelector(sel) as HTMLElement | null;
    if (!el) continue;
    const r = el.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) continue;
    if (r.bottom < 0 || r.top > window.innerHeight) {
      el.scrollIntoView({ block: "center", behavior: "smooth" });
    }
    return { top: r.top, left: r.left, width: r.width, height: r.height };
  }
  return null;
}

export function InssuraAgentTour() {
  const pathname = usePathname();
  const router = useRouter();
  const [active, setActive] = useState(false);
  const [currentStep, setCurrentStep] = useState(0);
  const [box, setBox] = useState<Box | null>(null);
  const [vp, setVp] = useState({ w: 1200, h: 800 });
  const [cardH, setCardH] = useState(420);
  const cardRef = useRef<HTMLDivElement>(null);

  const persist = useCallback((isActive: boolean, stepIndex: number) => {
    localStorage.setItem(TOUR_STORAGE_KEY, JSON.stringify({ active: isActive, stepIndex }));
  }, []);

  useEffect(() => {
    const sync = () => {
      const tourParam = new URLSearchParams(window.location.search).get("tour");
      const idx = INSSURA_AGENT_STEPS.findIndex((s) => s.id === tourParam);
      if (idx !== -1) {
        setActive(true);
        setCurrentStep(idx);
        persist(true, idx);
        return;
      }
      try {
        const saved = JSON.parse(localStorage.getItem(TOUR_STORAGE_KEY) || "null");
        if (saved?.active) {
          setActive(true);
          setCurrentStep(Math.max(0, Math.min(Number(saved.stepIndex) || 0, TOTAL - 1)));
        }
      } catch {
        /* ignore malformed state */
      }
    };
    sync();
    const onChange = (e: Event) => {
      const d = (e as CustomEvent).detail;
      if (!d) return sync();
      setActive(Boolean(d.active));
      if (typeof d.stepIndex === "number") setCurrentStep(d.stepIndex);
    };
    window.addEventListener("inssura:tour-change", onChange);
    return () => window.removeEventListener("inssura:tour-change", onChange);
  }, [pathname, persist]);

  const step = INSSURA_AGENT_STEPS[currentStep] ?? INSSURA_AGENT_STEPS[0];

  // Track the spotlighted element while the tour is active.
  useEffect(() => {
    if (!active) return;
    let raf = 0;
    let last = "";
    const tick = () => {
      const next = pathname === step.route ? findTarget(step.targets) : null;
      const key = next ? `${next.top}|${next.left}|${next.width}|${next.height}` : "none";
      if (key !== last) {
        last = key;
        setBox(next);
      }
      setVp((v) =>
        v.w === window.innerWidth && v.h === window.innerHeight
          ? v
          : { w: window.innerWidth, h: window.innerHeight }
      );
      const h = cardRef.current?.offsetHeight;
      if (h) setCardH((prev) => (prev === h ? prev : h));
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [active, step, pathname]);

  const close = useCallback(() => {
    setActive(false);
    persist(false, 0);
    window.dispatchEvent(
      new CustomEvent("inssura:tour-change", { detail: { active: false, stepIndex: 0 } })
    );
    const url = new URL(window.location.href);
    if (url.searchParams.has("tour")) {
      url.searchParams.delete("tour");
      router.replace(url.pathname + url.search);
    }
  }, [persist, router]);

  const goTo = useCallback(
    (index: number) => {
      const idx = Math.max(0, Math.min(index, TOTAL - 1));
      const next = INSSURA_AGENT_STEPS[idx];
      setCurrentStep(idx);
      persist(true, idx);
      if (pathname !== next.route) router.push(`${next.route}?tour=${next.id}`);
    },
    [pathname, persist, router]
  );

  useEffect(() => {
    if (!active) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
      else if (e.key === "ArrowRight" && currentStep < TOTAL - 1) goTo(currentStep + 1);
      else if (e.key === "ArrowLeft" && currentStep > 0) goTo(currentStep - 1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [active, currentStep, close, goTo]);

  if (!active) return null;

  const isLast = currentStep === TOTAL - 1;
  const PAD = 6;
  const CARD_W = Math.min(400, vp.w - 24);
  const anchored = box !== null && vp.w >= 768;

  let cardStyle: React.CSSProperties = {};
  let placement: "right" | "below" | "center" = "center";
  if (anchored && box) {
    if (box.left + box.width + 16 + CARD_W <= vp.w) {
      placement = "right";
      cardStyle = {
        left: box.left + box.width + PAD + 14,
        top: Math.max(12, Math.min(box.top - 8, vp.h - cardH - 12)),
      };
    } else {
      placement = "below";
      const below = box.top + box.height + PAD + 14;
      cardStyle = {
        left: Math.max(12, Math.min(box.left, vp.w - CARD_W - 12)),
        top: below + cardH > vp.h ? Math.max(12, box.top - cardH - PAD - 14) : below,
      };
    }
  }

  return (
    <div className="inssura-tour-root" role="dialog" aria-modal="true" aria-labelledby="tour-title">
      {/* Click shield: dims page and blocks interaction with it during the tour */}
      <div className="inssura-tour-shield" onClick={close} />
      {anchored && box ? (
        <div
          className="inssura-tour-spot"
          style={{
            top: box.top - PAD,
            left: box.left - PAD,
            width: box.width + PAD * 2,
            height: box.height + PAD * 2,
          }}
        />
      ) : (
        <div className="inssura-tour-dim" />
      )}
      {anchored && box && (
        <span
          className="inssura-tour-beacon"
          style={{ top: box.top + box.height / 2 - 20, left: box.left + box.width - 44 }}
        />
      )}

      <div
        ref={cardRef}
        className={`inssura-tour-pop ${placement}`}
        style={{ width: CARD_W, ...cardStyle }}
        key={step.id}
      >
        <div className="tour-pop-head">
          <h2 id="tour-title" className="tour-pop-title">
            {step.title}
          </h2>
          <button type="button" className="tour-pop-x" onClick={close} aria-label="Close tour">
            <X size={16} />
          </button>
        </div>
        <p className="tour-pop-desc">{step.description}</p>
        <span className="tour-pop-agent">
          <Bot size={12} /> {step.agentName}
        </span>

        <StepDemo id={step.id} />

        <div className="tour-pop-foot">
          <span className="tour-pop-count" aria-live="polite">
            {currentStep + 1}/{TOTAL}
          </span>
          <div className="inssura-tour-actions">
            {currentStep > 0 && (
              <button
                type="button"
                className="inssura-tour-btn-secondary"
                onClick={() => goTo(currentStep - 1)}
                aria-label="Previous step"
              >
                <ArrowLeft size={14} />
              </button>
            )}
            {!isLast && (
              <button type="button" className="inssura-tour-btn-secondary" onClick={close}>
                Skip
              </button>
            )}
            <button
              type="button"
              className="inssura-tour-btn-primary"
              onClick={() => (isLast ? close() : goTo(currentStep + 1))}
            >
              {isLast ? "Done" : "Next Step"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
