"use client";

import Link from "next/link";
import Image from "next/image";
import { usePathname, useRouter } from "next/navigation";
import {
  Activity,
  ArrowLeftRight,
  ArrowUpRight,
  ClipboardCheck,
  FileText,
  HeartPulse,
  LayoutDashboard,
  LogOut,
  MessageSquareText,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  LockKeyhole,
} from "lucide-react";
import { useSession } from "@/lib/session";
import { useAuth } from "@/lib/auth";
import { cn } from "@/lib/utils";

const navigation = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/protection", label: "My Protection", icon: ShieldCheck },
  { href: "/documents", label: "Documents", icon: FileText },
  {
    href: "/ask-policy",
    label: "Ask INSURRA",
    icon: MessageSquareText,
    soon: true,
  },
  { href: "/care", label: "Care Pathways", icon: HeartPulse, soon: true },
  {
    href: "/claims",
    label: "Claims Center",
    icon: ClipboardCheck,
    soon: true,
  },
  {
    href: "/audit",
    label: "Activity & Audit",
    icon: Activity,
  },
  { href: "/settings/privacy", label: "Settings & Privacy", icon: LockKeyhole },
];

const accountNavigation = [
  { href: "/account", label: "Dashboard", icon: LayoutDashboard },
  { href: "/protection", label: "My Protection", icon: ShieldCheck },
  { href: "/documents", label: "Documents", icon: FileText },
  {
    href: "/ask-policy",
    label: "Ask INSURRA",
    icon: MessageSquareText,
    soon: true,
  },
  { href: "/care", label: "Care Pathways", icon: HeartPulse, soon: true },
  {
    href: "/claims",
    label: "Claims Center",
    icon: ClipboardCheck,
    soon: true,
  },
  {
    href: "/audit",
    label: "Activity & Audit",
    icon: Activity,
  },
  { href: "/settings/privacy", label: "Settings & Privacy", icon: LockKeyhole },
];

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const publicPage =
    pathname === "/" ||
    pathname === "/login" ||
    pathname === "/auth" ||
    pathname === "/onboarding" ||
    pathname === "/account/onboarding" ||
    pathname === "/auth/callback";
  if (publicPage) return <>{children}</>;
  return <PrivateShell pathname={pathname}>{children}</PrivateShell>;
}

function PrivateShell({
  pathname,
  children,
}: {
  pathname: string;
  children: React.ReactNode;
}) {
  const router = useRouter();
  const { data, loading, error, clearSession } = useSession();
  const { account, token, logout } = useAuth();
  const accountMode =
    Boolean(token && account) ||
    pathname.startsWith("/account") ||
    pathname === "/completeness" ||
    pathname === "/settings/privacy" ||
    pathname === "/policies" ||
    pathname === "/family";

  const items = accountMode ? accountNavigation : navigation;

  const isNavActive = (href: string) => {
    if (href === pathname) return true;
    if (href === "/protection") {
      return (
        pathname === "/protection" ||
        pathname.startsWith("/policies") ||
        pathname.startsWith("/completeness") ||
        pathname.startsWith("/family") ||
        pathname.startsWith("/coverage") ||
        pathname.startsWith("/employer-benefits")
      );
    }
    if (href === "/documents") {
      return pathname === "/documents" || pathname.startsWith("/documents/");
    }
    if (href === "/dashboard" || href === "/account") {
      return pathname === "/dashboard" || pathname === "/account";
    }
    return false;
  };

  const pageTitle =
    pathname === "/protection"
      ? "My Protection"
      : pathname === "/policies"
      ? "Policy Wallet"
      : pathname === "/completeness"
      ? "Data Completeness"
      : pathname === "/family"
      ? "Family Coverage"
      : pathname === "/documents" || pathname.startsWith("/documents/")
      ? "Documents"
      : pathname === "/coverage"
      ? "Coverage Needs"
      : pathname === "/employer-benefits"
      ? "Employer Benefits"
      : pathname === "/audit"
      ? "Activity & Audit"
      : pathname === "/settings/privacy"
      ? "Settings & Privacy"
      : pathname === "/onboarding"
      ? "User Context"
      : items.find((item) => item.href === pathname)?.label ?? "Dashboard";

  return (
    <div className="app-frame">
      <a className="skip-link" href="#main-content">
        Skip to content
      </a>
      <aside className="sidebar">
        <Link href="/" className="brand">
          <Image
            src="/Inssura%20Kangaroo%20Shield%20Logo.png"
            width={130}
            height={58}
            alt="Insurra"
            className="brand-image"
          />
        </Link>
        <div className="workspace-label">YOUR INSURANCE COMPANION</div>
        <nav aria-label="Main Navigation" className="main-nav">
          {items.map(({ href, label, icon: Icon, ...rest }) => (
            <Link
              key={href}
              href={href}
              aria-current={isNavActive(href) ? "page" : undefined}
              className={cn("nav-item", isNavActive(href) && "active")}
            >
              <Icon size={19} />
              <span>{label}</span>
              {"soon" in rest && Boolean(rest.soon) && (
                <span className="nav-dot" aria-label="Upcoming phase" />
              )}
            </Link>
          ))}
          {!accountMode && (
            <Link
              href="/audit"
              aria-current={pathname === "/audit" ? "page" : undefined}
              className={cn(
                "nav-item mobile-utility",
                pathname === "/audit" && "active"
              )}
            >
              <Activity size={18} />
              Audit History
            </Link>
          )}
          {!accountMode && (
            <Link
              href="/onboarding"
              aria-current={pathname === "/onboarding" ? "page" : undefined}
              className={cn(
                "nav-item mobile-utility",
                pathname === "/onboarding" && "active"
              )}
            >
              <SlidersHorizontal size={18} />
              Privacy & Consent
            </Link>
          )}
        </nav>
        <div className="sidebar-bottom">
          <div className="help-card">
            <Sparkles size={21} />
            <strong>Understand your coverage.</strong>
            <p>One place for insurance clarity, backed by document evidence.</p>
            <Link href={accountMode ? "/settings/privacy" : "/onboarding"}>
              Manage Consent <ArrowUpRight size={15} />
            </Link>
          </div>
          {!accountMode && (
            <Link
              className={cn("nav-item", pathname === "/audit" && "active")}
              href="/audit"
            >
              <Activity size={18} />
              Audit History
            </Link>
          )}
          {!accountMode && (
            <Link
              className={cn("nav-item", pathname === "/onboarding" && "active")}
              href="/onboarding"
            >
              <SlidersHorizontal size={18} />
              Privacy & Consent
            </Link>
          )}
          <div className="sidebar-foot">
            <span className="status-dot" />{" "}
            {accountMode ? "AUTHENTICATED ACCOUNT" : "SYNTHETIC DEMO"}{" "}
            <span>v0.2</span>
          </div>
        </div>
      </aside>
      <div className="app-column">
        <header className="topbar">
          <div className="breadcrumb">
            Workspace <span>/</span> <strong>{pageTitle}</strong>
          </div>
          <div className="topbar-right">
            <span className="demo-badge">
              {accountMode ? "AUTHENTICATED" : "DEMO SESSION"}
            </span>

            {accountMode ? (
              <Link
                href="/onboarding?mode=edit"
                className="topbar-profile-btn"
                title="My Profile"
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 8,
                  textDecoration: "none",
                  padding: "4px 10px 4px 4px",
                  borderRadius: 999,
                  background: "#f0f6f8",
                  border: "1px solid #dce7eb",
                  transition: "all 0.15s ease",
                }}
              >
                <div
                  className="avatar small"
                  style={{ margin: 0 }}
                  aria-label={account?.display_name ?? "User"}
                >
                  {(account?.display_name ?? "U").slice(0, 1)}
                </div>
                <span style={{ fontSize: 12, fontWeight: 750, color: "#19354b" }}>
                  My Profile
                </span>
              </Link>
            ) : (
              <div
                className="avatar small"
                title={data?.profile.display_name ?? "User"}
                aria-label={data?.profile.display_name ?? "User"}
              >
                {(data?.profile.display_name ?? "U").slice(0, 1)}
              </div>
            )}

            {accountMode ? (
              <button
                type="button"
                onClick={async () => {
                  await logout();
                  router.push("/");
                }}
                className="topbar-logout-btn"
                title="Log out of account"
              >
                <LogOut size={14} />
                <span>Log out</span>
              </button>
            ) : (
              <div className="demo-topbar-actions">
                <Link href="/" className="persona-switch">
                  <ArrowLeftRight size={14} />
                  <span>Switch Persona</span>
                </Link>
                <button
                  type="button"
                  onClick={() => {
                    clearSession();
                    router.push("/");
                  }}
                  className="topbar-logout-btn"
                  title="Exit demo session"
                >
                  <LogOut size={14} />
                  <span>Exit Demo</span>
                </button>
              </div>
            )}
          </div>
        </header>
        <main id="main-content" className="main-content">
          {!accountMode && error && (
            <div role="alert" className="alert error">
              {error}
            </div>
          )}
          {!accountMode && loading && (
            <div className="loading-bar" role="status">
              Connecting session...
            </div>
          )}
          {children}
        </main>
        <footer className="page-footer">
          <span>
            <ShieldCheck size={14} />{" "}
            {accountMode
              ? "Your data remains under your explicit control."
              : "Synthetic demo persona."}{" "}
            Not medical or legal advice.
          </span>
          <span>Insurra AI Companion</span>
        </footer>
      </div>
    </div>
  );
}
