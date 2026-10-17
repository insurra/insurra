"use client";
import { FileText, Info, UploadCloud } from "lucide-react";
import { useSession } from "@/lib/session";
import { SessionRequired } from "@/components/session-required";
export default function Documents() {
  const { data, loading } = useSession();
  if (!data) return loading ? null : <SessionRequired />;
  return (
    <>
      <div className="page-heading">
        <div>
          <div className="eyebrow">SUMBER INFORMASI</div>
          <h1>Dokumen saya</h1>
          <p>Catatan dokumen sintetis milik {data.profile.display_name}.</p>
        </div>
      </div>
      <div className="alert info">
        <Info size={18} />
        Metadata berasal dari catatan demo. Dokumen belum diekstraksi dan bukan
        bukti manfaat.
      </div>
      <div className="document-list">
        {data.record.documents.map((doc) => (
          <article key={doc.id} className="card document-row">
            <div className="policy-icon">
              <FileText />
            </div>
            <div>
              <h2>{doc.original_filename}</h2>
              <p>{doc.document_type} · Sintetis</p>
            </div>
            <span className="badge neutral">MENUNGGU PEMROSESAN</span>
          </article>
        ))}
      </div>
      <div className="upload-placeholder">
        <UploadCloud size={32} />
        <h2>Unggah & pahami dokumen</h2>
        <p>
          Segera hadir pada Fase 2. Unggah, ekstraksi, dan pemeriksaan bukti
          belum aktif.
        </p>
        <span className="badge neutral">FASE BERIKUTNYA</span>
      </div>
    </>
  );
}
