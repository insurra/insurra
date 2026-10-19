"use client";

import Link from "next/link";
import Image from "next/image";
import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { ArrowLeft, Check, ExternalLink, FileText, Info, Trash2 } from "lucide-react";
import { api } from "@/lib/api/client";
import type { components } from "@/lib/api/types.gen";
import { config } from "@/lib/config";
import { useAuth } from "@/lib/auth";
import { Button } from "@/components/ui/button";

type Detail = components["schemas"]["AccountDocumentDetail"];
type Field = components["schemas"]["AccountField"];

export default function AccountDocumentDetail() {
  const id = useParams<{ id: string }>().id;
  const router = useRouter();
  const { account, token, loading } = useAuth();
  const [document, setDocument] = useState<Detail | null>(null);
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [fileUrl, setFileUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!token) return;
    const value = await api.request("get", "/api/v1/account/documents/{document_id}", {
      params: { document_id: id },
      headers: { Authorization: `Bearer ${token}` },
    });
    setDocument(value);
    setEdits(
      Object.fromEntries(
        value.fields.map((field) => [field.id, typeof field.value === "string" ? field.value : ""])
      )
    );
  }, [id, token]);

  useEffect(() => {
    void Promise.resolve()
      .then(refresh)
      .catch((cause: unknown) => {
        setError(cause instanceof Error ? cause.message : "Document could not be found.");
      });
  }, [refresh]);

  useEffect(() => () => {
    if (fileUrl) URL.revokeObjectURL(fileUrl);
  }, [fileUrl]);

  useEffect(() => {
    if (!document || !/^#page-\d+$/.test(window.location.hash)) return;
    const target = window.document.getElementById(window.location.hash.slice(1));
    if (target instanceof HTMLDetailsElement) {
      target.open = true;
      target.scrollIntoView();
    }
  }, [document]);

  async function openOriginal() {
    if (!token || !document) return;
    setError(null);
    try {
      const response = await fetch(
        `${config.apiBaseUrl}/api/v1/account/documents/${encodeURIComponent(id)}/file`,
        {
          headers: { Authorization: `Bearer ${token}` },
          cache: "no-store",
        }
      );
      if (!response.ok) {
        throw new Error("Original file is not retained or retention consent was revoked.");
      }
      const blob = await response.blob();
      if (fileUrl) URL.revokeObjectURL(fileUrl);
      setFileUrl(URL.createObjectURL(blob));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "File could not be displayed.");
    }
  }

  async function review(field: Field) {
    if (!token) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await api.request("patch", "/api/v1/account/fields/{field_id}", {
        params: { field_id: field.id },
        headers: { Authorization: `Bearer ${token}` },
        body: { value: edits[field.id] ?? "", confirm: true },
      });
      setNotice("Field verified and provenance audit record saved.");
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Field update could not be saved.");
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (
      !token ||
      !document ||
      !window.confirm(`Permanently delete ${document.original_filename} and all extracted values?`)
    ) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await api.request("delete", "/api/v1/account/documents/{document_id}", {
        params: { document_id: id },
        headers: { Authorization: `Bearer ${token}` },
        body: { confirm: "HAPUS" },
      });
      router.push("/documents");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Document could not be deleted.");
      setBusy(false);
    }
  }

  if (loading) return <p role="status">Checking account session...</p>;
  if (!account || !token) {
    return (
      <div className="card account-empty">
        <h1>Sign in to view document details.</h1>
        <Button asChild>
          <Link href="/auth">Sign In or Register</Link>
        </Button>
      </div>
    );
  }

  return (
    <div className="account-detail">
      <Link href="/documents" className="back-link">
        <ArrowLeft size={16} /> All Documents
      </Link>
      {error && (
        <div className="alert error" role="alert">
          {error}
        </div>
      )}
      {notice && (
        <div className="alert success" role="status">
          {notice}
        </div>
      )}
      {!document ? (
        <p role="status">Loading document...</p>
      ) : (
        <>
          <div className="page-heading">
            <div>
              <div className="eyebrow">EVIDENCE REVIEW</div>
              <h1>{document.original_filename}</h1>
              <p>
                {document.kind.replaceAll("_", " ")} ({document.country_code}) {document.pages.length} pages: {document.status}
              </p>
            </div>
            <span className="badge warning">NEEDS VERIFICATION</span>
          </div>

          {document.injection_flag && (
            <div className="alert warning">
              <Info size={18} /> Prompt injection defense: Suspicious instructions were detected in this document and ignored during AI extraction. Always inspect the raw evidence.
            </div>
          )}
          {document.error_code && (
            <div className="alert error">
              Extraction warning: {document.error_code}. Extracted text and pages remain available for manual review below.
            </div>
          )}

          <div className="account-detail-grid">
            <section className="card">
              <div className="section-heading">
                <h2>Source Pages & Evidence</h2>
                {document.original_file_status === "RETAINED" && (
                  <Button variant="outline" onClick={() => void openOriginal()}>
                    <ExternalLink size={16} /> Open Original File
                  </Button>
                )}
              </div>
              {document.original_file_status === "DELETED" && (
                <p className="account-note">
                  Original files and source pages are not retained. Reviewed structured fields remain available.
                </p>
              )}
              {fileUrl &&
                (document.mime_type === "application/pdf" ? (
                  <iframe src={fileUrl} title="Original PDF Preview" className="account-file-preview" />
                ) : (
                  <Image
                    src={fileUrl}
                    alt="Original Document Preview"
                    width={600}
                    height={440}
                    unoptimized
                    className="account-file-preview"
                  />
                ))}
              {document.pages.map((page, index) => (
                <details key={index} id={`page-${String(page.page_no ?? index + 1)}`} className="account-source-page">
                  <summary>
                    <FileText size={16} /> Page {String(page.page_no ?? index + 1)} {page.ocr_used ? "(OCR)" : "(Native text)"}
                  </summary>
                  <pre>{String(page.text ?? "No readable text found on this page.")}</pre>
                </details>
              ))}
            </section>

            <section className="card">
              <h2>Extracted Structured Fields</h2>
              <p>
                Compare each extracted value against the source page text. Confirming values establishes user provenance.
              </p>
              {!document.fields.length && (
                <div className="account-empty">
                  <Info />
                  <strong>No structured fields extracted.</strong>
                  <p>Document content did not match candidate insurance fields.</p>
                </div>
              )}
              {document.fields.map((field) => (
                <div className="review-field" key={field.id}>
                  <div>
                    <strong>{field.field_key.replaceAll("_", " ")}</strong>
                    <span className={`badge ${field.confirmed_by_user ? "success" : "warning"}`}>
                      {field.confirmed_by_user ? "VERIFIED" : "NEEDS VERIFICATION"}
                    </span>
                  </div>
                  <small>
                    Source: page {field.source_page ?? "N/A"}, {field.source_type.replaceAll("_", " ")}
                  </small>
                  {field.previous_value !== null && field.previous_value !== undefined && (
                    <small>Previous value: {String(field.previous_value)}</small>
                  )}
                  <div className="review-input">
                    <input
                      value={edits[field.id] ?? ""}
                      onChange={(event) =>
                        setEdits((current) => ({ ...current, [field.id]: event.target.value }))
                      }
                      aria-label={`Value for ${field.field_key}`}
                    />
                    <Button disabled={busy || !edits[field.id]} onClick={() => void review(field)}>
                      <Check size={16} /> Confirm
                    </Button>
                  </div>
                </div>
              ))}
            </section>
          </div>

          <div className="account-danger-line">
            <span>Delete this document and all associated page text and structured fields.</span>
            <Button variant="outline" disabled={busy} onClick={() => void remove()}>
              <Trash2 size={16} /> Delete Document
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
