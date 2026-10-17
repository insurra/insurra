"use client";

import Image from "next/image";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { ArrowRight, FileText, Info, UploadCloud } from "lucide-react";
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
    <div className="account-documents">
      <div className="page-heading">
        <div>
          <div className="eyebrow">POLICY EVIDENCE</div>
          <h1>My Documents</h1>
          <p>Files and extraction results are isolated strictly to your account.</p>
        </div>
        <Image
          src="/Winking%20Kangaroo%20Mascot%20with%20Document.png"
          width={140}
          height={94}
          alt="Insurra Kangaroo Mascot with Document"
        />
      </div>

      <div className="alert info">
        <Info size={18} /> Document content is treated as untrusted evidence, not instructions.
        Extracted fields remain unverified until reviewed and confirmed by you.
      </div>

      <section className="card account-upload">
        <div className="upload-icon">
          <UploadCloud />
        </div>
        <div>
          <h2>Upload Insurance Document</h2>
          <p>Supported: PDF, JPG, PNG. Maximum 10 MB. PDF up to 30 pages.</p>
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
        <Button disabled={!file || !setup || busy} onClick={() => void upload()}>
          {busy ? "Processing Document..." : "Upload and Extract"}
          <ArrowRight size={16} />
        </Button>
        <small>
          Requires document processing and external AI consent grants. Original files are retained only if file retention consent is active.
        </small>
      </section>

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

      <div className="section-heading">
        <h2>Ingested Documents</h2>
        <span className="badge neutral">{documents.length} files</span>
      </div>

      {!documents.length && (
        <div className="card account-empty">
          <FileText />
          <h2>No documents uploaded yet.</h2>
          <p>Upload your policy certificate, member card, or visa grant notice to begin.</p>
        </div>
      )}

      <div className="document-list">
        {documents.map((document) => (
          <Link
            href={`/documents/${document.id}`}
            key={document.id}
            className="card document-row account-document-row"
          >
            <span className="policy-icon">
              <FileText />
            </span>
            <span>
              <strong>{document.original_filename}</strong>
              <small>
                {document.kind.replaceAll("_", " ")} ({document.country_code}) {(document.size_bytes / 1024).toFixed(0)} KB
              </small>
            </span>
            <span className={`badge ${document.status === "COMPLETED" ? "warning" : "neutral"}`}>
              {document.status === "COMPLETED" ? "NEEDS REVIEW" : "PROCESSING FAILED"}
            </span>
            <ArrowRight size={16} />
          </Link>
        ))}
      </div>
    </div>
  );
}
