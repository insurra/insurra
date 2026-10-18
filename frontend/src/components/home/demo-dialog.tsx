"use client";

import { useEffect, useState } from "react";
import { X, Play } from "lucide-react";

interface DemoDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onLaunchLiveDemo?: () => void;
  liveDemoLoading?: boolean;
}

const steps = [
  {
    kicker: "INTERACTIVE DEMO",
    title: "Understand your policies",
    body: "INSURRA turns uploaded documents into structured coverage details and source-linked evidence.",
    chip: "Synthetic scenario · Understand",
  },
  {
    kicker: "INTERACTIVE DEMO",
    title: "Find what needs attention",
    body: "INSURRA compares the available information with your personal context and flags what needs verification.",
    chip: "Synthetic scenario · Verify",
  },
  {
    kicker: "INTERACTIVE DEMO",
    title: "Review your next action",
    body: "Prepare supporting documents, review the proposal, and approve any sandbox action before it runs.",
    chip: "Synthetic scenario · Take action",
  },
];

export function DemoDialog({
  isOpen,
  onClose,
  onLaunchLiveDemo,
  liveDemoLoading,
}: DemoDialogProps) {
  const [step, setStep] = useState(0);

  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onClose]);

  const handleClose = () => {
    setStep(0);
    onClose();
  };

  if (!isOpen) return null;

  const current = steps[step];

  return (
    <div
      className="modal-bg visible"
      role="presentation"
      onClick={(e) => {
        if (e.target === e.currentTarget) handleClose();
      }}
    >
      <div
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="modalTitle"
      >
        <button
          type="button"
          className="close"
          onClick={handleClose}
          aria-label="Close dialog"
        >
          <X size={18} aria-hidden="true" />
        </button>

        <div className="smallcap">{current.kicker}</div>
        <h2 id="modalTitle">{current.title}</h2>
        <p id="modalBody">{current.body}</p>

        <div className="demo-dots" aria-label={`Step ${step + 1} of ${steps.length}`}>
          {steps.map((_, idx) => (
            <span
              key={idx}
              className={idx <= step ? "on" : ""}
            />
          ))}
        </div>

        <div className="status-chip">{current.chip}</div>

        <div className="modal-action">
          {step > 0 ? (
            <button
              type="button"
              className="secondary"
              onClick={() => setStep((s) => Math.max(0, s - 1))}
            >
              Previous
            </button>
          ) : (
            <button type="button" className="secondary" onClick={handleClose}>
              Close
            </button>
          )}

          {step < steps.length - 1 ? (
            <button
              type="button"
              className="primary"
              onClick={() => setStep((s) => s + 1)}
            >
              Next →
            </button>
          ) : (
            <button
              type="button"
              className="primary"
              onClick={() => {
                if (onLaunchLiveDemo) {
                  onLaunchLiveDemo();
                } else {
                  onClose();
                }
              }}
              disabled={liveDemoLoading}
            >
              <Play size={14} aria-hidden="true" />
              {liveDemoLoading ? "Loading demo..." : "Explore Live Dashboard"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
