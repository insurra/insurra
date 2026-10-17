"use client";

import Link from "next/link";

export function HomeFooter() {
  return (
    <footer id="privacy">
      <div className="shell footer-content">
        <span>© 2026 INSURRA. Privacy-first insurance companion.</span>
        <div className="footer-links">
          <Link href="/settings/privacy">Privacy &amp; Security</Link>
          <span>·</span>
          <span>Illustrative data only. Insurance decisions require policy verification.</span>
        </div>
      </div>
    </footer>
  );
}
