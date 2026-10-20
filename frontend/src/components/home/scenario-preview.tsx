"use client";

import Image from "next/image";
import {
  ArrowRight,
  AlertTriangle,
  FileText,
  Calendar,
  Building,
  Plus,
  Search,
  CheckSquare,
} from "lucide-react";

export type PersonaType = "student" | "corporate";

interface ScenarioPreviewProps {
  persona: PersonaType;
  onSelectPersona: (p: PersonaType) => void;
  onOpenDemo?: () => void;
  demoLoading?: boolean;
}

const personaData = {
  student: {
    question: "Will my coverage still be valid after I extend my visa?",
    title: "Your Coverage Snapshot",
    label1: "Insurance cover ends",
    value1: "30 Jun 2027",
    icon1: "file",
    label2: "Visa ends",
    value2: "31 Jul 2027",
    icon2: "calendar",
    greenWidth: "62%",
    orangeWidth: "22%",
    timeNote: "● 31 days potentially uncovered",
    insightTitle: "Your insurance could end before your visa.",
    insightDetail: "Inssura helps you spot timing gaps early and understand what to do next.",
  },
  corporate: {
    question: "Should I use company insurance or BPJS for outpatient care?",
    title: "Your Benefit Coordination",
    label1: "Corporate outpatient used",
    value1: "70%",
    icon1: "building",
    label2: "BPJS primary facility",
    value2: "Active",
    icon2: "plus",
    greenWidth: "70%",
    orangeWidth: "30%",
    timeNote: "● 30% of illustrative employer limit remains",
    insightTitle: "Two coverage sources identified.",
    insightDetail:
      "Check eligible services, provider networks, and coordination rules before choosing a payment pathway.",
  },
};

export function ScenarioPreview({
  persona,
  onSelectPersona,
  onOpenDemo,
  demoLoading = false,
}: ScenarioPreviewProps) {
  const current = personaData[persona];

  return (
    <div className="card-wrap" id="scenarios">
      <div className="panel">
        <div className="switcher" role="tablist" aria-label="Insurance scenarios">
          <button
            type="button"
            className={persona === "student" ? "active" : ""}
            role="tab"
            aria-selected={persona === "student"}
            onClick={() => onSelectPersona("student")}
          >
            <span aria-hidden="true">🎓</span> Global &amp; Student
          </button>
          <button
            type="button"
            className={persona === "corporate" ? "active" : ""}
            role="tab"
            aria-selected={persona === "corporate"}
            onClick={() => onSelectPersona("corporate")}
          >
            <span aria-hidden="true">💼</span> Employee &amp; Corporate
          </button>
        </div>

        <div className="speech">
          <div className="mascot" aria-hidden="true">
            <Image
              src="/mascot-bubble.png"
              alt=""
              width={42}
              height={42}
              className="mascot-face"
            />
          </div>
          <div className="question">{current.question}</div>
        </div>

        <div className="snapshot">
          <div className="snaphead">
            <span>{current.title}</span>
            <span className="sample">ILLUSTRATIVE EXAMPLE</span>
          </div>

          <div className="metricrow">
            <div className="metric">
              <span className="metricicon" aria-hidden="true">
                {current.icon1 === "file" ? (
                  <FileText size={18} />
                ) : (
                  <Building size={18} />
                )}
              </span>
              <div>
                <div className="metriclabel">{current.label1}</div>
                <div className="metricval">{current.value1}</div>
              </div>
            </div>

            <div className="metric">
              <span className="metricicon" aria-hidden="true">
                {current.icon2 === "calendar" ? (
                  <Calendar size={18} />
                ) : (
                  <Plus size={18} />
                )}
              </span>
              <div>
                <div className="metriclabel">{current.label2}</div>
                <div className="metricval">{current.value2}</div>
              </div>
            </div>
          </div>

          <div
            className="timeline"
            aria-label="Illustrative coverage timeline graphic"
          >
            <div
              className="green"
              style={{ width: current.greenWidth }}
            />
            <div
              className="orange"
              style={{ width: current.orangeWidth }}
            />
          </div>

          <div className="timelabel">{current.timeNote}</div>

          <div
            className="insight"
            role="button"
            tabIndex={demoLoading ? -1 : 0}
            aria-disabled={demoLoading}
            onClick={demoLoading ? undefined : onOpenDemo}
            onKeyDown={(e) => {
              if (!demoLoading && (e.key === "Enter" || e.key === " ")) {
                e.preventDefault();
                onOpenDemo?.();
              }
            }}
          >
            <div className="warn" aria-hidden="true">
              <AlertTriangle size={18} />
            </div>
            <div>
              <strong>{current.insightTitle}</strong>
              <small>{current.insightDetail}</small>
            </div>
            <div className="arrow" aria-hidden="true">
              <ArrowRight size={18} />
            </div>
          </div>

          <div className="foot-actions">
            <div className="tiny">
              <FileText size={16} aria-hidden="true" />
              <span>Understand coverage</span>
            </div>
            <div className="tiny">
              <Search size={16} aria-hidden="true" />
              <span>Verify gaps</span>
            </div>
            <div className="tiny">
              <CheckSquare size={16} aria-hidden="true" />
              <span>Take action</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
