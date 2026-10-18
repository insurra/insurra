"use client";

import Image from "next/image";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { ArrowRight, CheckCircle2, ChevronRight, ClipboardCheck, FileText, Info, UploadCloud } from "lucide-react";
import { api } from "@/lib/api/client";
import type { components } from "@/lib/api/types.gen";
import { useAuth } from "@/lib/auth";
import { Button } from "@/components/ui/button";

type Document = components["schemas"]["AccountDocumentSummary"];
type Setup = components["schemas"]["AccountSetup"];

export default function AccountDocuments() {
  const { account, token, loading } = useAuth();
  const [documents, setDocuments] = useState<Document[]>([]);
  const [setup, setSetup] = useState<Setup | null>(null);
  const [kind, setKind] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!token) return;
    const headers = { Authorization: `Bearer ${token}` };
    const [profile, list] = await Promise.all([
      api.request("get", "/api/v1/account/profile", { headers }),
      api.request("get", "/api/v1/account/documents", { headers }),
    ]);
    setDocuments(list);
    if (profile.profile) {
      const country = await api.request("get", "/api/v1/account/setup/{country_code}", {
        params: { country_code: profile.profile.country_code },
        headers,
      });
      setSetup(country);
      setKind((current) => current || country.document_types[0]?.code || "other");
    }
  }, [token]);

  useEffect(() => {
    void Promise.resolve()
      .then(refresh)
      .catch((cause: unknown) => {
        setError(cause instanceof Error ? cause.message : "Documents could not be loaded.");
      });
  }, [refresh]);

  async function upload() {
    if (!file || !token || !kind) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const body = new FormData();
      body.append("file", file);
      body.append("kind", kind);
      const result = await api.request("post", "/api/v1/account/documents", {
        body,
        headers: { Authorization: `Bearer ${token}` },
      });
      setNotice(
        result.status === "COMPLETED"
          ? "Document ingested successfully. Review all extracted values before saving."
          : "Document uploaded, but extraction failed. Open details to inspect the error."
      );
      setFile(null);
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Document upload failed.");
    } finally {
      setBusy(false);
    }
  }

  if (loading) return <p role="status">Checking account session...</p>;
  if (!account || !token) {
    return (
      <div className="card account-empty">
        <h1>Sign in to view your documents.</h1>
        <Button asChild>
          <Link href="/auth">Sign In or Register</Link>
        </Button>
      </div>
    );
  }

  return (
    <div className="account-documents protection-screen documents-screen">
      <nav aria-label="Breadcrumb" className="protection-breadcrumb">
        <Link href="/protection">My Protection</Link>
        <ChevronRight size={14} className="breadcrumb-separator" />
        <span aria-current="page">Documents</span>
      </nav>

      <div className="page-heading">
        <div>
          <div className="eyebrow">DOCUMENT REPOSITORY</div>
          <h1>Documents</h1>
          <p>Upload policy documents, extract structured records, and inspect source evidence.</p>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: "14px" }}>
          <Button asChild variant="outline">
            <Link href="/completeness">
              <ClipboardCheck size={16} /> Check Completeness
            </Link>
          </Button>
          <Image
            src="/protection-mascot.png"
            width={84}
            height={84}
            alt="Insurra Mascot"
          />
        </div>
      </div>

      <div className="alert info">
        <Info size={18} /> Document content is treated as untrusted evidence, not instructions.
        Extracted fields remain unverified until reviewed and confirmed by you.
      </div>

      <div className="documents-workspace">
      <section className="card account-upload documents-upload-panel">
        <div className="upload-icon">
          <UploadCloud />
        </div>
        <div>
          <h2>Upload &amp; Extract</h2>
          <p>PDF, JPG, or PNG up to 10 MB per file.</p>
        </div>
        {!setup && (
          <div className="alert warning">
            Please complete your <Link href="/onboarding">profile</Link> before uploading documents.
          </div>
        )}
        <div className="form-grid">
          <label>
            Document Category
            <select value={kind} disabled={!setup} onChange={(event) => setKind(event.target.value)}>
              {setup?.document_types.map((item) => (
                <option key={item.code} value={item.code}>
                  {item.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            Select File
            <input
              type="file"
              accept=".pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png"
              disabled={!setup}
              onChange={(event) => setFile(event.target.files?.[0] ?? null)}
            />
          </label>
        </div>
        {file && <div className="selected-file"><FileText size={18} /><span>{file.name}<small>{(file.size / 1024 / 1024).toFixed(2)} MB</small></span></div>}
        <Button disabled={!file || !setup || busy} onClick={() => void upload()}>
          {busy ? "Processing extraction..." : "Upload and Extract"}
          <ArrowRight size={16} />
        </Button>
        <small>
          Requires document processing and external AI consent. Original files are retained only if retention consent is active.
        </small>
      </section>

      <section className="documents-results">
        <div className="documents-results-head">
          <div>
            <span className="eyebrow">PERSONAL ARCHIVE</span>
            <h2>My Documents</h2>
          </div>
          <span className="badge neutral">{documents.length} {documents.length === 1 ? "document" : "documents"}</span>
        </div>
        {!documents.length && (
          <div className="card account-empty">
            <FileText />
            <h2>No documents uploaded yet</h2>
            <p>Uploaded documents will appear here along with their extraction status.</p>
          </div>
        )}
        <div className="document-list">
          {documents.map((document) => (
            <Link href={`/documents/${document.id}`} key={document.id} className="card document-row account-document-row">
              <span className="policy-icon"><FileText /></span>
              <span><strong>{document.original_filename}</strong><small>{document.kind.replaceAll("_", " ")} · {document.country_code} · {(document.size_bytes / 1024).toFixed(0)} KB</small></span>
              <span className={`badge ${document.status === "COMPLETED" ? "warning" : "neutral"}`}>
                {document.status === "COMPLETED" ? "Needs Review" : "Extraction Failed"}
              </span>
              <ArrowRight size={16} />
            </Link>
          ))}
        </div>
        <div className="documents-trust-note">
          <CheckCircle2 size={17} /> Extracted facts are candidate information. Review source pages and confirm details before relying on them.
        </div>
      </section>
      </div>

      {error && (
        <div className="alert error" role="alert">
          {error} {error.includes("consent") && <Link href="/settings/privacy">Manage Consent</Link>}
        </div>
      )}
      {notice && (
        <div className="alert success" role="status">
          {notice}
        </div>
      )}

    </div>
  );
}
