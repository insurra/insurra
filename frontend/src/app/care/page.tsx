import Link from "next/link";
import { ComingNext } from "@/components/coming-next";
export default function Page() {
  return (
    <>
    <ComingNext
      title="Navigasi layanan"
      description="Perbandingan jalur layanan akan menampilkan sumber dan ketidakpastian, tanpa diagnosis atau perkiraan biaya yang dibuat-buat."
    />
    <p><Link href="/emergency">Butuh pertolongan segera? Buka arahan darurat.</Link></p>
    </>
  );
}
