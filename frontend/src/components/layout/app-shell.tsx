"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Activity,
  ArrowLeftRight,
  ArrowUpRight,
  ClipboardCheck,
  FileText,
  HeartPulse,
  LayoutDashboard,
  MessageSquareText,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
} from "lucide-react";
import { useSession } from "@/lib/session";
import { cn } from "@/lib/utils";

const navigation = [
  { href: "/dashboard", label: "Ringkasan", icon: LayoutDashboard },
  { href: "/documents", label: "Dokumen saya", icon: FileText },
  {
    href: "/ask-policy",
    label: "Tanya polis",
    icon: MessageSquareText,
    soon: true,
  },
  {
    href: "/coverage",
    label: "Cek perlindungan",
    icon: ShieldCheck,
    soon: true,
  },
  { href: "/care", label: "Navigasi layanan", icon: HeartPulse, soon: true },
  {
    href: "/claims",
    label: "Persiapan klaim",
    icon: ClipboardCheck,
    soon: true,
  },
];

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { data, loading, error } = useSession();
  const pageTitle =
    navigation.find((item) => item.href === pathname)?.label ??
    (pathname === "/audit"
      ? "Riwayat aktivitas"
      : pathname === "/onboarding"
        ? "Privasi & persetujuan"
        : "Selamat datang");
  return (
    <div className="app-frame">
      <a className="skip-link" href="#main-content">
        Langsung ke konten
      </a>
      <aside className="sidebar">
        <Link href="/" className="brand">
          <span className="brand-mark">
            <ShieldCheck size={25} strokeWidth={1.8} />
          </span>
          insurra<span className="brand-dot">.</span>
        </Link>
        <div className="workspace-label">PENDAMPING ASURANSI ANDA</div>
        <nav aria-label="Navigasi utama" className="main-nav">
          {navigation.map(({ href, label, icon: Icon, soon }) => (
            <Link
              key={href}
              href={href}
              aria-current={pathname === href ? "page" : undefined}
              className={cn("nav-item", pathname === href && "active")}
            >
              <Icon size={19} />
              <span>{label}</span>
              {soon && (
                <span className="nav-dot" aria-label="Fase berikutnya" />
              )}
            </Link>
          ))}
          <Link
            href="/audit"
            aria-current={pathname === "/audit" ? "page" : undefined}
            className={cn(
              "nav-item mobile-utility",
              pathname === "/audit" && "active",
            )}
          >
            <Activity size={18} />
            Riwayat aktivitas
          </Link>
          <Link
            href="/onboarding"
            aria-current={pathname === "/onboarding" ? "page" : undefined}
            className={cn(
              "nav-item mobile-utility",
              pathname === "/onboarding" && "active",
            )}
          >
            <SlidersHorizontal size={18} />
            Privasi & persetujuan
          </Link>
        </nav>
        <div className="sidebar-bottom">
          <div className="help-card">
            <Sparkles size={21} />
            <strong>Kenali perlindunganmu.</strong>
            <p>Satu tempat untuk memahami asuransi, tanpa tebakan.</p>
            <Link href="/onboarding">
              Atur persetujuan <ArrowUpRight size={15} />
            </Link>
          </div>
          <Link
            className={cn("nav-item", pathname === "/audit" && "active")}
            href="/audit"
          >
            <Activity size={18} />
            Riwayat aktivitas
          </Link>
          <Link
            className={cn("nav-item", pathname === "/onboarding" && "active")}
            href="/onboarding"
          >
            <SlidersHorizontal size={18} />
            Privasi & persetujuan
          </Link>
          <div className="sidebar-foot">
            <span className="status-dot" /> DEMO SINTETIS <span>v0.1</span>
          </div>
        </div>
      </aside>
      <div className="app-column">
        <header className="topbar">
          <div className="breadcrumb">
            Ruang pribadi <span>/</span> <strong>{pageTitle}</strong>
          </div>
          <div className="topbar-right">
            <span className="demo-badge">DEMO · FASE 1</span>
            <Link href="/" className="persona-switch">
              <ArrowLeftRight size={15} />
              <span>Ganti persona</span>
            </Link>
            <div
              className="avatar small"
              aria-label={data?.profile.display_name ?? "Demo"}
            >
              {data?.profile.display_name.slice(0, 1) ?? "D"}
            </div>
          </div>
        </header>
        <main id="main-content" className="main-content">
          {error && (
            <div role="alert" className="alert error">
              {error}
            </div>
          )}
          {loading && (
            <div className="loading-bar" role="status">
              Menghubungkan sesi…
            </div>
          )}
          {children}
        </main>
        <footer className="page-footer">
          <span>
            <ShieldCheck size={14} /> Data demo sintetis. Bukan nasihat medis
            atau hukum.
          </span>
          <span>AI Insurance Companion · Phase 1</span>
        </footer>
      </div>
    </div>
  );
}
