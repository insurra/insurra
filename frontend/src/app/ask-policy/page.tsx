import Link from "next/link";
import { ComingNext } from "@/components/coming-next";
export default function Page() {
  return (
    <>
      <ComingNext
        title="Tanya polis"
        description="Tanya jawab berbahasa Indonesia dengan kutipan asli dan nomor halaman akan hadir setelah ekstraksi dokumen siap."
      />
      <p><Link href="/emergency">Butuh pertolongan segera? Buka arahan darurat.</Link></p>
    </>
  );
}
