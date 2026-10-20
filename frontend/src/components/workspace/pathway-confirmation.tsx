"use client";

import { useEffect, useRef, useState } from "react";
import { api } from "@/lib/api/client";
import type { components } from "@/lib/api/types.gen";

type Path = components["schemas"]["PathwayOption"];
export function PathwayConfirmation({
  path,
  comparisonId,
  headers,
  onClose,
  onCreated,
}: {
  path: Path;
  comparisonId: string;
  headers: Record<string, string>;
  onClose: () => void;
  onCreated: (id: string) => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const sending = useRef(false);
  const key = useRef<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    dialog.current?.showModal();
  }, []);
  async function confirm() {
    if (sending.current || !path.coverage_id || path.emergency) return;
    sending.current = true;
    setBusy(true);
    setError(null);
    key.current ??= crypto.randomUUID();
    try {
      const result = await api.request("post", "/api/v1/claims", {
        headers: { ...headers, "Idempotency-Key": key.current },
        body: {
          path: path.pathway_code,
          coverage_id: path.coverage_id,
          comparison_id: comparisonId,
        },
      });
      onCreated(result.claim_case_id);
    } catch (cause: unknown) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Claim case could not be created. Please try again.",
      );
    } finally {
      sending.current = false;
      setBusy(false);
    }
  }
  return (
    <dialog
      ref={dialog}
      className="vn-source-dialog"
      aria-labelledby="pathway-confirm-title"
      onCancel={(event) => {
        event.preventDefault();
        if (!sending.current) onClose();
      }}
    >
      <div className="vn">
        <h2 id="pathway-confirm-title">Confirm Care Pathway</h2>
        <h3>{path.name}</h3>
        <p>{path.coverage_label}</p>
        <ul>
          {path.docs.map((doc, i) => (
            <li key={i}>{doc}</li>
          ))}
        </ul>
        {path.direct_billing === true && (
          <p>
            You may not need to file a claim yourself if direct billing applies. Please still keep
            all original receipts and medical records.
          </p>
        )}
        <p>
          Creating a Draft claim case saves your selected pathway and filtered guidance.
          It does not submit any claims or book appointments.
        </p>
        {error && (
          <p role="alert" className="vn-error">
            {error}
          </p>
        )}
        <div className="vn-actions">
          <button className="vn-primary" disabled={busy} onClick={confirm}>
            {busy ? "Creating case..." : "Create Claim Case"}
          </button>
          <button disabled={busy} onClick={onClose}>
            Cancel
          </button>
        </div>
      </div>
    </dialog>
  );
}
