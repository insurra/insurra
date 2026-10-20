"use client";

import Link from "next/link";
import Image from "next/image";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import {
  Activity,
  Bell,
  ChevronDown,
  ChevronRight,
  ClipboardCheck,
  FileText,
  HeartPulse,
  Home,
  LifeBuoy,
  LogOut,
  PanelLeftClose,
  PanelLeftOpen,
  PhoneCall,
  Search,
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
import { InsurraMascot } from "@/components/brand/insurra-mascot";
import { InssuraAgentTour, triggerInssuraTour } from "@/components/tour/inssura-agent-tour";
import "./shell-extras.css";

// Account-only routes send visitors without an account to sign in.
const accountOnlyRoute = (pathname: string) => pathname.startsWith("/account");

// Safety guidance stays reachable without a session.
const sessionFreeRoute = (pathname: string) => pathname === "/emergency";

const navigation = [
  { href: "/home", label: "Home", icon: Home },
  { href: "/protection", label: "My Protection", icon: ShieldCheck },
  { href: "/claims", label: "Claims Center", icon: ClipboardCheck },
  { href: "/documents", label: "Documents", icon: FileText },
  { href: "/ask", label: "Ask Inssura", icon: Sparkles },
  { href: "/pathways", label: "Care Pathways", icon: HeartPulse },
  { href: "/audit", label: "Activity & Audit", icon: Activity },
  { href: "/settings/privacy", label: "Settings & Privacy", icon: Settings },
];

const accountNavigation = [
  { href: "/home", label: "Home", icon: Home },
  { href: "/protection", label: "My Protection", icon: ShieldCheck },
  { href: "/claims", label: "Claims Center", icon: ClipboardCheck },
  { href: "/documents", label: "Documents", icon: FileText },
  { href: "/ask", label: "Ask Inssura", icon: Sparkles },
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
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

  useEffect(() => {
    const saved = localStorage.getItem("insurra_sidebar_collapsed");
    queueMicrotask(() => {
      if (saved !== null) {
        setSidebarCollapsed(saved === "true");
      } else if (typeof window !== "undefined" && window.innerWidth <= 768) {
        setSidebarCollapsed(true);
      }
    });
  }, []);

  const toggleSidebar = () => {
    setSidebarCollapsed((prev) => {
      const next = !prev;
      localStorage.setItem("insurra_sidebar_collapsed", String(next));
      return next;
    });
  };

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "b") {
        const target = e.target as HTMLElement | null;
        if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable)) {
          return;
        }
        e.preventDefault();
        toggleSidebar();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  useEffect(() => {
    if (typeof window !== "undefined" && window.innerWidth <= 760) {
      queueMicrotask(() => setSidebarCollapsed(true));
    }
  }, [pathname]);

  const accountMode = Boolean(token && account) || pathname.startsWith("/account");

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
      ? "Family Protection"
      : pathname === "/documents" || pathname.startsWith("/documents/")
      ? "Documents"
      : pathname === "/coverage-needs" || pathname === "/coverage"
      ? "Coverage Needs"
      : pathname === "/employer-benefits"
      ? "Employer Benefits"
      : pathname === "/ask" || pathname === "/ask-policy"
      ? "Ask Inssura"
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
    <div className={cn("app-frame", sidebarCollapsed && "sidebar-is-collapsed")}>
      <a className="skip-link" href="#main-content">
        Skip to content
      </a>

      {/* Mobile drawer backdrop */}
      {!sidebarCollapsed && (
        <div
          className="sidebar-backdrop"
          onClick={() => setSidebarCollapsed(true)}
          aria-hidden="true"
        />
      )}

      <aside className={cn("sidebar", sidebarCollapsed && "collapsed")}>
        <div className="sidebar-brand-row">
          <Link href="/" className="brand" title="Inssura">
            <span className="brand-full">
              <Image
                src="/Inssura%20Kangaroo%20Shield%20Logo.png"
                width={124}
                height={55}
                alt="Inssura"
                className="brand-image"
                priority
              />
            </span>
            <span className="brand-mini">
              <InsurraMascot
                variant="shield"
                size={36}
                decorative
                className="brand-icon"
                priority
              />
            </span>
          </Link>
          <button
            type="button"
            onClick={() => setSidebarCollapsed(true)}
            className="sidebar-close-btn"
            title="Close Menu"
            aria-label="Close Menu"
          >
            <PanelLeftClose size={18} />
          </button>
        </div>
        <div className="workspace-label">YOUR INSURANCE COMPANION</div>
        <nav aria-label="Main Navigation" className="main-nav">
          {items.map(({ href, label, icon: Icon, ...rest }) => {
            const active = isNavActive(href);
            return (
              <div key={href} className="nav-group">
                <Link
                  href={href}
                  aria-current={active ? "page" : undefined}
                  className={cn("nav-item", active && "active")}
                  title={label}
                  aria-label={label}
                >
                  <Icon size={19} className="nav-icon" />
                  <span className="nav-label">{label}</span>
                  {"soon" in rest && Boolean(rest.soon) && (
                    <span className="nav-dot" aria-label="Upcoming phase" />
                  )}
                </Link>
                {href === "/protection" && active && (
                  <div className="subnav-container">
                    {[
                      { href: "/protection", label: "Overview" },
                      { href: "/policies", label: "Policy Wallet" },
                      { href: "/family", label: "Family Protection" },
                      { href: "/employer-benefits", label: "Employer Benefits" },
                      { href: "/completeness", label: "Data Completeness" },
                    ].map((sub) => {
                      const isSubActive = pathname === sub.href;
                      return (
                        <Link
                          key={sub.href}
                          href={sub.href}
                          className={cn("subnav-item", isSubActive && "active")}
                        >
                          {sub.label}
                        </Link>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </nav>
        <div className="sidebar-bottom">
          {/* Professional Help & Emergency Widget */}
          <div className="sidebar-help-card">
            <div className="sidebar-help-header">
              <div className="sidebar-help-icon">
                <LifeBuoy size={16} />
              </div>
              <div className="sidebar-help-text">
                <span className="sidebar-help-title">Need Help?</span>
                <span className="sidebar-help-subtitle">Emergency & guidance</span>
              </div>
            </div>
            <Link href="/emergency" className="sidebar-help-link">
              <span>Help Center</span>
              <span aria-hidden="true">→</span>
            </Link>
          </div>
          <div className="sidebar-bottom-nav">
            <Link
              href="/notifications"
              aria-current={pathname === "/notifications" ? "page" : undefined}
              className={cn("nav-item", pathname === "/notifications" && "active")}
              title="Notifications"
              aria-label="Notifications"
            >
              <Bell size={19} className="nav-icon" />
              <span className="nav-label">Notifications</span>
            </Link>
            <Link
              href="/profile"
              aria-current={pathname === "/profile" ? "page" : undefined}
              className={cn("nav-item", pathname === "/profile" && "active")}
              title="Profile"
              aria-label="Profile"
            >
              <User size={19} className="nav-icon" />
              <span className="nav-label">Profile</span>
            </Link>
          </div>
          <div
            className="sidebar-foot"
            title={accountMode ? "AUTHENTICATED ACCOUNT v0.2" : "INTERACTIVE PREVIEW v0.2"}
          >
            <div className="sidebar-foot-status">
              <span className="status-dot" />
              <span className="sidebar-foot-text">
                {accountMode ? "AUTHENTICATED ACCOUNT" : "INTERACTIVE PREVIEW"}
              </span>
            </div>
            <span className="sidebar-version">v0.2</span>
          </div>
        </div>
      </aside>

      <div className={cn("app-column", sidebarCollapsed && "expanded")}>
        <header className="topbar">
          <div className="topbar-left">
            <button
              type="button"
              onClick={toggleSidebar}
              className={cn("topbar-toggle-btn", sidebarCollapsed && "is-collapsed")}
              title={sidebarCollapsed ? "Open Sidebar Menu (Ctrl+B)" : "Close Sidebar Menu (Ctrl+B)"}
              aria-label={sidebarCollapsed ? "Open Sidebar Menu" : "Close Sidebar Menu"}
            >
              {sidebarCollapsed ? (
                <>
                  <PanelLeftOpen size={18} />
                  <span className="topbar-toggle-text">Menu</span>
                </>
              ) : (
                <PanelLeftClose size={18} />
              )}
            </button>
            <div className="topbar-divider" />
            <nav className="breadcrumb" aria-label="Breadcrumb">
              <Link href={workspaceHref} className="breadcrumb-item">
                Workspace
              </Link>
              <ChevronRight size={13} className="breadcrumb-sep" />
              {breadcrumbParent && (
                <>
                  <Link href={breadcrumbParent.href} className="breadcrumb-item">
                    {breadcrumbParent.label}
                  </Link>
                  <ChevronRight size={13} className="breadcrumb-sep" />
                </>
              )}
              <strong className="breadcrumb-active" aria-current="page">
                {pageTitle}
              </strong>
            </nav>
          </div>
          {/* Search bar matching Figma UI */}
          <div style={{ flex: 1, maxWidth: 520, margin: "0 20px" }}>
            <div style={{ position: "relative", width: "100%" }}>
              <Search
                size={16}
                style={{
                  position: "absolute",
                  left: 14,
                  top: "50%",
                  transform: "translateY(-50%)",
                  color: "#94a3b8",
                }}
              />
              <input
                type="text"
                placeholder='Search anything... (e.g. "my visa coverage", "dental in China", "add policy")'
                style={{
                  width: "100%",
                  padding: "8px 14px 8px 38px",
                  borderRadius: 12,
                  border: "1px solid #e2e8f0",
                  background: "#ffffff",
                  fontSize: 13,
                  outline: "none",
                  color: "#1e293b",
                }}
                readOnly
              />
            </div>
          </div>
          <div className="topbar-right" style={{ display: "flex", alignItems: "center", gap: 14 }}>
            {/* Agent Guided Tour Launcher */}
            <button
              type="button"
              onClick={() => triggerInssuraTour(0)}
              className="topbar-agent-tour-btn"
              title="Explore all Inssura AI Agents and Features"
            >
              <Sparkles size={14} className="text-teal-600 animate-pulse" />
              <span>Agent Tour</span>
              <span className="topbar-tour-pill">7 Steps</span>
            </button>

            {/* Country Selector from Active Context */}
            <div className="figma-topbar-country" title={`Active Country: ${residenceCountry}`}>
              <span className="country-flag-icon">{countryFlag}</span>
              <span className="country-name-text">{residenceCountry}</span>
              <ChevronDown size={13} className="country-arrow" />
            </div>

            {/* Emergency SOS Quick Button */}
            <Link
              href="/emergency"
              className="topbar-sos-btn"
              title="Emergency Guidance & Crisis Lines"
            >
              <span className="sos-pulse-ring" />
              <PhoneCall size={13} />
              <span>Emergency SOS</span>
            </Link>

            {/* Notification Bell */}
            <NotificationBell />

            {/* User Profile Avatar */}
            <Link href="/profile" title="Profile" aria-label="Profile" className="topbar-avatar-link">
              <div className="topbar-avatar-badge">
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
        <main
          id="main-content"
          className={cn("main-content", pathname === "/home" && "home-main-content")}
        >
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
              : "Data panduan terverifikasi."}{" "}
            Not medical or legal advice.
          </span>
          <span>Inssura AI Companion</span>
        </footer>
      </div>
      <InssuraAgentTour />
    </div>
  );
}
