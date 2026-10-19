"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { api } from "@/lib/api/client";
import type { components } from "@/lib/api/types.gen";

type Citation = components["schemas"]["AnswerCitation"];
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
              "Kutipan telah berubah atau tidak lagi cocok. Mulai pertanyaan baru.",
            );
          else setText(value.text);
        }
      })
      .catch((cause: unknown) => {
        if (!controller.signal.aborted)
          setError(
            cause instanceof Error ? cause.message : "Sumber belum tersedia.",
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
          {citation.document_name ?? "Dokumen"} · hal. {citation.page}
        </h2>
        <button onClick={onClose}>Tutup sumber</button>
        {error ? (
          <p role="alert">{error}</p>
        ) : text ? (
          <>
            <span className="vn-badge">
              Kutipan cocok dengan halaman sumber saat ini
            </span>
            <blockquote lang="">{citation.quote}</blockquote>
            <details>
              <summary>Halaman asli</summary>
              <pre>
                {text.slice(0, position)}
                <mark>{citation.quote}</mark>
                {text.slice(position + citation.quote.length)}
              </pre>
            </details>
            <Link
              href={`/documents/${encodeURIComponent(citation.doc)}#page-${citation.page}`}
            >
              Buka dokumen · halaman {citation.page}
            </Link>
          </>
        ) : (
          <p role="status">Memeriksa halaman dan persetujuan…</p>
        )}
      </div>
    </dialog>
  );
}
