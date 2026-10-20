"use client";

import * as React from "react";
import { AlertTriangle, CheckCircle2, Info, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";

type Tone = "info" | "success" | "warning" | "error";

type DialogRequest = {
  id: number;
  kind: "alert" | "confirm";
  title: string;
  message: string;
  tone: Tone;
  confirmLabel: string;
  cancelLabel: string;
  resolve: (value: boolean) => void;
};

type Options = {
  title?: string;
  tone?: Tone;
  confirmLabel?: string;
  cancelLabel?: string;
};

let enqueue: ((req: DialogRequest) => void) | null = null;
let nextId = 1;

function open(kind: DialogRequest["kind"], message: string, opts: Options = {}) {
  return new Promise<boolean>((resolve) => {
    const tone = opts.tone ?? (kind === "confirm" ? "warning" : "error");
    const req: DialogRequest = {
      id: nextId++,
      kind,
      message,
      tone,
      title:
        opts.title ??
        (kind === "confirm"
          ? "Konfirmasi tindakan"
          : tone === "success"
            ? "Berhasil"
            : tone === "info"
              ? "Informasi"
              : "Tindakan belum bisa dilanjutkan"),
      confirmLabel: opts.confirmLabel ?? (kind === "confirm" ? "Ya, lanjutkan" : "Mengerti"),
      cancelLabel: opts.cancelLabel ?? "Batal",
      resolve,
    };
    if (enqueue) enqueue(req);
    else resolve(kind === "confirm" ? false : true);
  });
}

/** Styled replacement for window.alert. */
export function showAlert(message: string, opts?: Options): Promise<boolean> {
  return open("alert", message, opts);
}

/** Styled replacement for window.confirm. Resolves true when confirmed. */
export function showConfirm(message: string, opts?: Options): Promise<boolean> {
  return open("confirm", message, opts);
}

const toneStyles: Record<Tone, { icon: React.ElementType; className: string }> = {
  info: { icon: Info, className: "bg-sky-50 text-sky-600" },
  success: { icon: CheckCircle2, className: "bg-emerald-50 text-emerald-600" },
  warning: { icon: AlertTriangle, className: "bg-amber-50 text-amber-600" },
  error: { icon: XCircle, className: "bg-rose-50 text-rose-600" },
};

export function AppDialogHost() {
  const [queue, setQueue] = React.useState<DialogRequest[]>([]);
  const current = queue[0];
  const confirmRef = React.useRef<HTMLButtonElement>(null);

  React.useEffect(() => {
    enqueue = (req) => setQueue((q) => [...q, req]);
    return () => {
      enqueue = null;
    };
  }, []);

  const close = React.useCallback(
    (value: boolean) => {
      if (!current) return;
      current.resolve(value);
      setQueue((q) => q.slice(1));
    },
    [current],
  );

  React.useEffect(() => {
    if (!current) return;
    confirmRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close(current.kind === "alert");
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [current, close]);

  if (!current) return null;
  const { icon: Icon, className } = toneStyles[current.tone];
  const destructive = current.kind === "confirm" && current.tone === "error";

  return (
    <div
      className="fixed inset-0 z-[1000] flex items-center justify-center bg-slate-900/40 p-4 backdrop-blur-sm"
      onClick={() => close(current.kind === "alert")}
    >
      <div
        role={current.kind === "confirm" ? "alertdialog" : "dialog"}
        aria-modal="true"
        aria-labelledby={`app-dialog-title-${current.id}`}
        aria-describedby={`app-dialog-msg-${current.id}`}
        className="w-full max-w-md rounded-[var(--radius-card)] border border-slate-200 bg-white p-6 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex gap-4">
          <div
            className={`flex size-11 shrink-0 items-center justify-center rounded-full ${className}`}
          >
            <Icon className="size-5" />
          </div>
          <div className="min-w-0 flex-1">
            <h2
              id={`app-dialog-title-${current.id}`}
              className="text-base font-semibold text-slate-900"
            >
              {current.title}
            </h2>
            <p
              id={`app-dialog-msg-${current.id}`}
              className="mt-1.5 text-sm leading-relaxed text-slate-600"
            >
              {current.message}
            </p>
          </div>
        </div>
        <div className="mt-6 flex justify-end gap-2">
          {current.kind === "confirm" && (
            <Button variant="outline" size="lg" className="px-4" onClick={() => close(false)}>
              {current.cancelLabel}
            </Button>
          )}
          <Button
            ref={confirmRef}
            size="lg"
            variant={destructive ? "destructive" : "default"}
            className="px-4"
            onClick={() => close(true)}
          >
            {current.confirmLabel}
          </Button>
        </div>
      </div>
    </div>
  );
}
