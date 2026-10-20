"use client";

import Link from "next/link";
import Image from "next/image";
import { usePathname, useRouter } from "next/navigation";
import { useEffect } from "react";
import {
  Activity,
  Bell,
  ChevronDown,
  ClipboardCheck,
  FileText,
  HeartPulse,
  Home,
  LogOut,
  PhoneCall,
  ShieldCheck,
  Sparkles,
  Settings,
  User,
} from "lucide-react";
import { useSession } from "@/lib/session";
import { useAuth } from "@/lib/auth";
import { useUserContext } from "@/lib/user-context";
import { SessionRequired } from "@/components/session-required";
import { signInUrl } from "@/lib/safe-redirect";
import { cn } from "@/lib/utils";
import { NotificationBell } from "@/components/layout/notification-bell";
import { DemoBanner } from "@/components/layout/demo-banner";

// Account-only routes send visitors without an account to sign in.
const accountOnlyRoute = (pathname: string) =>
  pathname.startsWith("/account") ||
  pathname === "/completeness" ||
  pathname === "/policies" ||
  pathname === "/family";

// Safety guidance stays reachable without a session.
const sessionFreeRoute = (pathname: string) => pathname === "/emergency";

const navigation = [
  { href: "/home", label: "Home", icon: Home },
  { href: "/protection", label: "My Protection", icon: ShieldCheck },
  { href: "/claims", label: "Claims Center", icon: ClipboardCheck },
  { href: "/documents", label: "Documents", icon: FileText },
  { href: "/ask", label: "Ask INSURRA", icon: Sparkles },
  { href: "/pathways", label: "Care Pathways", icon: HeartPulse },
  { href: "/audit", label: "Activity & Audit", icon: Activity },
  { href: "/settings/privacy", label: "Settings & Privacy", icon: Settings },
];

const accountNavigation = [
  { href: "/home", label: "Home", icon: Home },
  { href: "/protection", label: "My Protection", icon: ShieldCheck },
  { href: "/claims", label: "Claims Center", icon: ClipboardCheck },
  { href: "/documents", label: "Documents", icon: FileText },
  { href: "/ask", label: "Ask INSURRA", icon: Sparkles },
  { href: "/pathways", label: "Care Pathways", icon: HeartPulse },
  { href: "/audit", label: "Activity & Audit", icon: Activity },
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
  const { data, loading, error } = useSession();
  const { account, token, loading: authLoading, logout } = useAuth();
  const { residenceCountry, countryFlag } = useUserContext();
  const accountMode =
    Boolean(token && account) ||
    pathname.startsWith("/account") ||
    pathname === "/completeness" ||
    pathname === "/policies" ||
    pathname === "/family";

  const items = accountMode ? accountNavigation : navigation;
  const demoMode = !accountMode && Boolean(data);

  const sessionsReady = !authLoading && !loading;
  const hasAccount = Boolean(token && account);
  const needsSignIn = sessionsReady && !hasAccount && accountOnlyRoute(pathname);
  const needsSession =
    sessionsReady && !hasAccount && !data && !accountOnlyRoute(pathname) && !sessionFreeRoute(pathname);

  useEffect(() => {
    if (!needsSignIn) return;
    router.replace(signInUrl(`${pathname}${window.location.search}`));
  }, [needsSignIn, pathname, router]);

  const isNavActive = (href: string) => {
    if (href === pathname) return true;
    if (href === "/home") {
      return pathname === "/home" || pathname === "/dashboard" || pathname === "/account";
    }
    if (href === "/protection") {
      return (
        pathname === "/protection" ||
        pathname.startsWith("/policies") ||
        pathname.startsWith("/completeness") ||
        pathname.startsWith("/family") ||
        pathname.startsWith("/coverage") ||
        pathname.startsWith("/coverage-needs") ||
        pathname.startsWith("/employer-benefits")
      );
    }
    if (href === "/claims") {
      return pathname === "/claims" || pathname.startsWith("/claims/") || pathname === "/actions";
    }
    if (href === "/documents") {
      return pathname === "/documents" || pathname.startsWith("/documents/");
    }
    if (href === "/ask") {
      return pathname === "/ask" || pathname === "/ask-policy";
    }
    if (href === "/pathways") {
      return pathname === "/pathways" || pathname === "/care";
    }
    if (href === "/audit") {
      return pathname === "/audit";
    }
    if (href === "/settings/privacy") {
      return (
        pathname === "/settings/privacy" ||
        pathname === "/account/privacy" ||
        pathname.startsWith("/settings")
      );
    }
    return false;
  };

  const pageTitle =
    pathname === "/home" || pathname === "/dashboard" || pathname === "/account"
      ? "Home"
      : pathname === "/protection"
      ? "My Protection"
      : pathname.startsWith("/claims/")
      ? "Claim Detail"
      : pathname === "/claims"
      ? "Claims Center"
      : pathname === "/actions"
      ? "Action Approvals"
      : pathname === "/emergency"
      ? "Emergency Guidance"
      : pathname === "/products/compare"
      ? "Insurance Product Comparison"
      : pathname === "/policies"
      ? "Policy Wallet"
      : pathname === "/completeness"
      ? "Data Completeness"
      : pathname === "/family"
      ? "Family Coverage"
      : pathname === "/documents" || pathname.startsWith("/documents/")
      ? "Documents"
      : pathname === "/coverage-needs" || pathname === "/coverage"
      ? "Coverage Needs"
      : pathname === "/employer-benefits"
      ? "Employer Benefits"
      : pathname === "/ask" || pathname === "/ask-policy"
      ? "Ask INSURRA"
      : pathname === "/pathways" || pathname === "/care"
      ? "Care Pathways"
      : pathname === "/audit"
      ? "Activity & Audit"
      : pathname === "/notifications"
      ? "Notifications"
      : pathname === "/profile"
      ? "Profile"
      : pathname.startsWith("/settings") || pathname === "/account/privacy"
      ? "Settings & Privacy"
      : pathname === "/onboarding"
      ? "User Context"
      : items.find((item) => item.href === pathname)?.label ?? "Dashboard";

  const breadcrumbParent = pathname.startsWith("/claims/") || pathname === "/actions"
    ? { href: "/claims", label: "Claims Center" }
    : pathname === "/policies" || pathname === "/employer-benefits" || pathname === "/coverage-needs" || pathname === "/completeness" || pathname === "/family"
    ? { href: "/protection", label: "My Protection" }
    : pathname === "/products/compare"
    ? { href: "/policies", label: "Policy Wallet" }
    : null;
  const workspaceHref = "/home";

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
        </nav>
        <div className="sidebar-bottom">
          <div className="sidebar-bottom-nav" style={{ display: "flex", flexDirection: "column", gap: 4, marginBottom: 12 }}>
            <Link
              href="/notifications"
              aria-current={pathname === "/notifications" ? "page" : undefined}
              className={cn("nav-item", pathname === "/notifications" && "active")}
              style={{ display: "flex", alignItems: "center", gap: 10 }}
            >
              <Bell size={19} />
              <span>Notifications</span>
            </Link>
            <Link
              href="/profile"
              aria-current={pathname === "/profile" ? "page" : undefined}
              className={cn("nav-item", pathname === "/profile" && "active")}
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
          <nav className="breadcrumb" aria-label="Breadcrumb">
            <Link href={workspaceHref}>Workspace</Link>
            <span>/</span>
            {breadcrumbParent && (
              <>
                <Link href={breadcrumbParent.href}>{breadcrumbParent.label}</Link>
                <span>/</span>
              </>
            )}
            <strong aria-current="page">{pageTitle}</strong>
          </nav>
          <div className="topbar-right" style={{ display: "flex", alignItems: "center", gap: 14 }}>
            {/* Country Selector from Active Context */}
            <div className="figma-topbar-country" title={`Active Country: ${residenceCountry}`}>
              <span style={{ fontSize: 15 }}>{countryFlag}</span>
              <span>{residenceCountry}</span>
              <ChevronDown size={14} color="#64748b" />
            </div>

            {/* Emergency SOS Quick Button */}
            <Link
              href="/emergency"
              className="inline-flex items-center gap-1.5 px-3.5 py-1.5 bg-rose-600 hover:bg-rose-700 text-white text-xs font-extrabold rounded-full shadow-sm transition-all"
              title="Emergency Guidance & Crisis Lines"
            >
              <PhoneCall size={13} />
              <span>Emergency SOS</span>
            </Link>

            {/* Notification Bell */}
            <NotificationBell />

            {/* User Profile Avatar */}
            <Link href="/profile" title="Profile" aria-label="Profile">
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

            {accountMode && (
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
            )}
          </div>
        </header>
        {demoMode && <DemoBanner />}
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
          {needsSignIn ? null : needsSession ? <SessionRequired /> : children}
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
