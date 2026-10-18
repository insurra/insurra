"use client";

import Link from "next/link";
import Image from "next/image";
import { usePathname, useRouter } from "next/navigation";
import {
  Activity,
  Bell,
  ChevronDown,
  ClipboardCheck,
  FileText,
  HeartPulse,
  Home,
  LogOut,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  Settings,
  User,
} from "lucide-react";
import { useSession } from "@/lib/session";
import { useAuth } from "@/lib/auth";
import { cn } from "@/lib/utils";

const navigation = [
  { href: "/dashboard", label: "Home", icon: Home },
  { href: "/protection", label: "My Protection", icon: ShieldCheck },
  { href: "/documents", label: "Documents", icon: FileText },
  {
    href: "/ask-policy",
    label: "Ask INSURRA",
    icon: Sparkles,
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
  { href: "/settings/privacy", label: "Settings & Privacy", icon: Settings },
];

const accountNavigation = [
  { href: "/account", label: "Home", icon: Home },
  { href: "/protection", label: "My Protection", icon: ShieldCheck },
  { href: "/documents", label: "Documents", icon: FileText },
  {
    href: "/ask-policy",
    label: "Ask INSURRA",
    icon: Sparkles,
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
  { href: "/settings/privacy", label: "Settings & Privacy", icon: Settings },
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
          <div className="sidebar-bottom-nav" style={{ display: "flex", flexDirection: "column", gap: 4, marginBottom: 12 }}>
            <Link
              href="/dashboard"
              className={cn("nav-item", pathname === "/notifications" && "active")}
              style={{ display: "flex", alignItems: "center", gap: 10 }}
            >
              <Bell size={19} />
              <span>Notifications</span>
              <span style={{ width: 6, height: 6, borderRadius: "50%", background: "#ef4444", marginLeft: "auto" }} />
            </Link>
            <Link
              href="/onboarding?mode=edit"
              className={cn("nav-item", pathname.startsWith("/onboarding") && "active")}
              style={{ display: "flex", alignItems: "center", gap: 10 }}
            >
              <User size={19} />
              <span>Profile</span>
            </Link>
          </div>
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
          <div className="topbar-right" style={{ display: "flex", alignItems: "center", gap: 14 }}>
            {/* Country Selector as in design */}
            <div className="figma-topbar-country" title="Active Country Region">
              <span style={{ fontSize: 15 }}>🇸🇬</span>
              <span>Singapore</span>
              <ChevronDown size={14} color="#64748b" />
            </div>

            {/* Notification Bell */}
            <div className="figma-topbar-bell" title="Notifications">
              <Bell size={17} />
              <span className="dot" />
            </div>

            {/* User Profile Avatar */}
            <Link href="/onboarding?mode=edit" title="User Profile">
              <div
                style={{
                  width: 36,
                  height: 36,
                  borderRadius: "50%",
                  border: "1.5px solid #0ea58a",
                  background: "#eaf8f4",
                  color: "#08876f",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontWeight: 800,
                  fontSize: 14,
                }}
              >
                {(account?.display_name ?? data?.profile.display_name ?? "U").slice(0, 1).toUpperCase()}
              </div>
            </Link>

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
