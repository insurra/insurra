import Link from "next/link";
import { ArrowLeft, Construction, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
export function ComingNext({
  title,
  description,
}: {
  title: string;
  description: string;
}) {
  return (
    <>
      <div className="page-heading">
        <div>
          <div className="eyebrow">KENALI LANGKAH BERIKUTNYA</div>
          <h1>{title}</h1>
        </div>
        <span className="badge neutral">FASE 2</span>
      </div>
      <div className="empty-state card">
        <div className="empty-icon">
          <Construction size={28} />
        </div>
        <h2>Sedang disiapkan.</h2>
        <p>{description}</p>
        <div className="placeholder-note">
          <ShieldCheck size={18} />
          Fitur ini belum aktif. Tidak ada pemrosesan AI atau tindakan yang
          dijalankan.
        </div>
        <Button variant="outline" asChild>
          <Link href="/dashboard">
            <ArrowLeft size={16} />
            Kembali ke ringkasan
          </Link>
        </Button>
      </div>
    </>
  );
}
