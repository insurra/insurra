"use client";

import { useState } from "react";
import { CheckCircle2, FileCheck2, ShieldAlert, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/lib/auth";
import { getWorkflowHeaders, getWorkflowUrl } from "@/lib/api/workflow-client";

interface VerifyResult {
  verified: boolean;
  original_sha256: string;
  computed_sha256: string;
  byte_length: number;
  status: string;
  detail: string;
  limitation_notice?: string;
}

interface LocalProofReceipt {
  proof_id: string;
  document_title: string;
  document_sha256: string;
  receipt_sha256: string;
  mime_type: string;
  network: string;
  anchoring_type: string;
  timestamp: string;
  verification_statement: string;
  notice: string;
}

export default function DocumentProofPage() {
  const { token: accountToken } = useAuth();
  const [originalHash, setOriginalHash] = useState("");
  const [candidateText, setCandidateText] = useState("");
  const [docTitle, setDocTitle] = useState("Insurance Document");
  const [verifyResult, setVerifyResult] = useState<VerifyResult | null>(null);
  const [receipt, setReceipt] = useState<LocalProofReceipt | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleVerify = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const headers = getWorkflowHeaders(accountToken);
      headers["Content-Type"] = "application/json";
      const res = await fetch(getWorkflowUrl("/api/v1/workflow/proof/verify"), {
        method: "POST",
        headers,
        body: JSON.stringify({
          original_sha256: originalHash.trim(),
          candidate_text: candidateText,
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.message || `HTTP ${res.status}`);
      }
      const data: VerifyResult = await res.json();
      setVerifyResult(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to verify document digest.");
    } finally {
      setLoading(false);
    }
  };

  const handleIssueReceipt = async () => {
    const targetHash = verifyResult?.computed_sha256 || originalHash.trim();
    if (!targetHash) return;
    setLoading(true);
    setError(null);
    try {
      const headers = getWorkflowHeaders(accountToken);
      headers["Content-Type"] = "application/json";
      const res = await fetch(getWorkflowUrl("/api/v1/workflow/proof/anchor"), {
        method: "POST",
        headers,
        body: JSON.stringify({
          document_sha256: targetHash,
          document_title: docTitle.trim() || "Insurance Document",
          mime_type: "text/plain",
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.message || `HTTP ${res.status}`);
      }
      const data: LocalProofReceipt = await res.json();
      setReceipt(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to issue local integrity receipt.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="w-full max-w-4xl mx-auto px-4 py-8 text-slate-900">
      <div className="mb-8">
        <div className="inline-flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-teal-700 bg-teal-50 border border-teal-200 px-3 py-1 rounded-full mb-3">
          <ShieldCheck size={14} /> Local SHA-256 Integrity Proof
        </div>
        <h1 className="text-3xl font-extrabold text-slate-900 tracking-tight mb-2">
          Document Integrity Verification
        </h1>
        <p className="text-sm text-slate-600">
          Verify whether a document matches its recorded SHA-256 cryptographic digest byte-for-byte,
          and issue a local integrity receipt (`LOCAL_INTEGRITY_RECEIPT`). Matching digests prove
          file bytes have not been altered since recording; they do not establish issuer authenticity
          or external blockchain anchoring.
        </p>
      </div>

      {error && (
        <div role="alert" className="mb-6 p-4 rounded-xl bg-red-50 border border-red-200 text-sm text-red-700">
          {error}
        </div>
      )}

      <form onSubmit={handleVerify} className="bg-white border border-slate-200 rounded-2xl p-6 shadow-sm space-y-4 mb-6">
        <div>
          <label htmlFor="proof-doc-title" className="block text-xs font-bold uppercase text-slate-600 mb-1">
            Document Label
          </label>
          <input
            id="proof-doc-title"
            type="text"
            value={docTitle}
            onChange={(e) => setDocTitle(e.target.value)}
            className="w-full rounded-xl border border-slate-300 px-3.5 py-2 text-sm"
          />
        </div>
        <div>
          <label htmlFor="proof-original-hash" className="block text-xs font-bold uppercase text-slate-600 mb-1">
            Recorded SHA-256 Digest
          </label>
          <input
            id="proof-original-hash"
            type="text"
            placeholder="64-character hexadecimal SHA-256 digest"
            value={originalHash}
            onChange={(e) => setOriginalHash(e.target.value)}
            className="w-full rounded-xl border border-slate-300 px-3.5 py-2 text-sm font-mono"
            required
          />
        </div>
        <div>
          <label htmlFor="proof-candidate-text" className="block text-xs font-bold uppercase text-slate-600 mb-1">
            Candidate Content to Verify
          </label>
          <textarea
            id="proof-candidate-text"
            rows={4}
            placeholder="Paste candidate document text..."
            value={candidateText}
            onChange={(e) => setCandidateText(e.target.value)}
            className="w-full rounded-xl border border-slate-300 px-3.5 py-2 text-sm font-mono"
            required
          />
        </div>
        <div className="flex flex-wrap gap-3">
          <Button type="submit" disabled={loading}>
            <FileCheck2 size={16} className="mr-2" />
            Verify SHA-256 Integrity
          </Button>
          <Button type="button" variant="outline" onClick={handleIssueReceipt} disabled={loading || (!originalHash.trim() && !verifyResult)}>
            Issue Local Integrity Receipt
          </Button>
        </div>
      </form>

      {verifyResult && (
        <div className="bg-white border border-slate-200 rounded-2xl p-6 shadow-sm mb-6">
          <div className="flex items-center gap-2 mb-3">
            {verifyResult.verified ? (
              <CheckCircle2 className="text-emerald-600" size={20} />
            ) : (
              <ShieldAlert className="text-amber-600" size={20} />
            )}
            <h2 className="font-bold text-lg text-slate-900">{verifyResult.status}</h2>
          </div>
          <p className="text-sm text-slate-700 mb-3">{verifyResult.detail}</p>
          <div className="text-xs font-mono bg-slate-50 p-3 rounded-xl border border-slate-200 space-y-1 mb-3">
            <div>Recorded SHA-256: {verifyResult.original_sha256}</div>
            <div>Computed SHA-256: {verifyResult.computed_sha256}</div>
            <div>Byte Length: {verifyResult.byte_length}</div>
          </div>
          {verifyResult.limitation_notice && (
            <p className="text-xs text-slate-500">{verifyResult.limitation_notice}</p>
          )}
        </div>
      )}

      {receipt && (
        <div className="bg-white border border-slate-200 rounded-2xl p-6 shadow-sm" data-testid="local-integrity-receipt">
          <div className="flex items-center justify-between mb-3">
            <h2 className="font-bold text-lg text-slate-900">Local Integrity Receipt</h2>
            <span className="text-xs font-bold px-2.5 py-1 rounded-full bg-slate-100 text-slate-800">
              {receipt.anchoring_type}
            </span>
          </div>
          <p className="text-sm text-slate-700 mb-3">{receipt.verification_statement}</p>
          <div className="text-xs font-mono bg-slate-50 p-3 rounded-xl border border-slate-200 space-y-1 mb-3">
            <div>Receipt ID: {receipt.proof_id}</div>
            <div>Document SHA-256: {receipt.document_sha256}</div>
            <div>Receipt SHA-256: {receipt.receipt_sha256}</div>
            <div>Scope: {receipt.network}</div>
            <div>Timestamp: {receipt.timestamp}</div>
          </div>
          <p className="text-xs text-slate-500">{receipt.notice}</p>
        </div>
      )}
    </div>
  );
}
