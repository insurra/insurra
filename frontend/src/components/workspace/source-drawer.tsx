"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { api } from "@/lib/api/client";
import type { components } from "@/lib/api/types.gen";

type Citation = components["schemas"]["AnswerCitation"] & {
  language?: string | null;
  explanation_label?: string | null;
};

export function SourceDrawer({
  citation,
  headers,
  onClose,
}: {
  citation: Citation;
  headers: Record<string, string>;
  onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [text, setText] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    dialog.current?.showModal();
    const controller = new AbortController();
    api
      .request("get", "/api/v1/ask/sources/{document_id}/{page}", {
        headers,
        params: { document_id: citation.doc, page: citation.page },
        signal: controller.signal,
      })
      .then((value) => {
        if (!controller.signal.aborted) {
          if (!value.text.includes(citation.quote))
            setError(
              "Quote has changed or no longer matches the source page. Start a new question.",
            );
          else setText(value.text);
        }
      })
      .catch((cause: unknown) => {
        if (!controller.signal.aborted)
          setError(
            cause instanceof Error ? cause.message : "Source page is not available.",
          );
      });
    return () => controller.abort();
  }, [citation, headers]);
  const position = text?.indexOf(citation.quote) ?? -1;
  return (
    <dialog
      ref={dialog}
      className="vn-source-dialog"
      aria-labelledby="source-title"
      onCancel={onClose}
    >
      <div className="vn-list">
        <h2 id="source-title">
          {citation.document_name ?? "Document"} · p. {citation.page}
        </h2>
        <button onClick={onClose}>Close source</button>
        {error ? (
          <p role="alert">{error}</p>
        ) : text ? (
          <>
            <span className="vn-badge">
              Exact substring verified against retained source page
            </span>
            {citation.language && (
              <span className="vn-badge" data-testid="citation-language">
                Source language: {citation.language}
              </span>
            )}
            {citation.explanation_label && (
              <span className="vn-badge" data-testid="citation-explanation-label">
                {citation.explanation_label}
              </span>
            )}
            <blockquote lang={citation.language ?? ""}>{citation.quote}</blockquote>
            <details>
              <summary>Original page text</summary>
              <pre>
                {text.slice(0, position)}
                <mark>{citation.quote}</mark>
                {text.slice(position + citation.quote.length)}
              </pre>
            </details>
            <Link
              href={`/documents/${encodeURIComponent(citation.doc)}#page-${citation.page}`}
            >
              Open document · page {citation.page}
            </Link>
          </>
        ) : (
          <p role="status">Verifying source page and retention permissions…</p>
        )}
      </div>
    </dialog>
  );
}
