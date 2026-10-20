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
          <div className="eyebrow">DISCOVER NEXT STEPS</div>
          <h1>{title}</h1>
        </div>
        <span className="badge neutral">PHASE 2</span>
      </div>
      <div className="empty-state card">
        <div className="empty-icon">
          <Construction size={28} />
        </div>
        <h2>In Preparation</h2>
        <p>{description}</p>
        <div className="placeholder-note">
          <ShieldCheck size={18} />
          This feature is not yet active. No AI processing or actions have been executed.
        </div>
        <Button variant="outline" asChild>
          <Link href="/home">
            <ArrowLeft size={16} />
            Back to Home
          </Link>
        </Button>
      </div>
    </>
  );
}
