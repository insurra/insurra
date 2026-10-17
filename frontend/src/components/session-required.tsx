import "@/app/dashboard/dashboard.css";
import Link from "next/link";
import Image from "next/image";
import { ArrowRight } from "lucide-react";

export function SessionRequired() {
  return (
    <div className="dx-empty">
      <Image src="/mascot-shield.png" alt="" width={120} height={110} />
      <h1>Start with a demo profile.</h1>
      <p>Pick the demo to see a profile and its insurance protection.</p>
      <Link href="/" className="dx-link">
        Back to start <ArrowRight size={16} aria-hidden="true" />
      </Link>
    </div>
  );
}
