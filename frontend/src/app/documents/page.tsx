"use client";

import { FileText, Info, UploadCloud } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { useSession } from "@/lib/session";
import { SessionRequired } from "@/components/session-required";
import AccountDocuments from "@/app/account/documents/page";

export default function DocumentsPage() {
  const { account, token } = useAuth();
  const { data, loading } = useSession();

  // If user is authenticated with an account, display real document upload and review workspace
  if (token && account) {
    return <AccountDocuments />;
  }

  // Fallback for demo session persona
  if (!data) return loading ? null : <SessionRequired />;

  return (
    <>
      <div className="page-heading">
        <div>
          <div className="eyebrow">INFORMATION SOURCES</div>
          <h1>My Documents</h1>
          <p>Synthetic document records for {data.profile.display_name}.</p>
        </div>
      </div>
      <div className="alert info">
        <Info size={18} />
        Metadata is derived from demo records. Documents are not extracted yet and do not constitute proof of benefits.
      </div>
      <div className="document-list">
        {data.record.documents.map((doc) => (
          <article key={doc.id} className="card document-row">
            <div className="policy-icon">
              <FileText />
            </div>
            <div>
              <h2>{doc.original_filename}</h2>
              <p>
                {doc.document_type}, Record country: {data.record.country_code}, Synthetic
              </p>
            </div>
            <span className="badge neutral">AWAITING PROCESSING</span>
          </article>
        ))}
      </div>
      <div className="upload-placeholder">
        <UploadCloud size={32} />
        <h2>Upload and Extract Documents</h2>
        <p>
          Real document ingestion is enabled in your personal workspace. Sign in to upload and review actual policies.
        </p>
        <span className="badge neutral">ACCOUNT WORKSPACE</span>
      </div>
    </>
  );
}
