import Link from "next/link";
import { ArrowRight, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
export function SessionRequired() {
  return (
    <div className="empty-state card">
      <div className="empty-icon">
        <ShieldCheck />
      </div>
      <h1>Mulai dari ceritamu.</h1>
      <p>
        Pilih persona demo untuk melihat profil dan perlindungan asuransinya.
      </p>
      <Button asChild>
        <Link href="/">
          Pilih persona <ArrowRight size={16} />
        </Link>
      </Button>
    </div>
  );
}
