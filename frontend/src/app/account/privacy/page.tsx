"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import {
  Bell,
  Clock,
  Download,
  FileText,
  History,
  LockKeyhole,
  LogOut,
  RefreshCw,
  RotateCcw,
  ShieldAlert,
  ShieldCheck,
  Trash2,
  Unplug,
  User,
} from "lucide-react";
import { api } from "@/lib/api/client";
import type { components } from "@/lib/api/types.gen";
import { useActor, resetDemoSession } from "@/lib/actor";
import { useAuth } from "@/lib/auth";
import { clearProfileCaches } from "@/lib/profile-cache";
import { Button } from "@/components/ui/button";

type Consent = components["schemas"]["PurposeConsent"];
type Inventory = components["schemas"]["AccountInventory"];
type Purpose = components["schemas"]["ConsentPurpose"];
type ConsentHistoryItem = components["schemas"]["ConsentHistoryItem"];
type Preferences = components["schemas"]["Preferences"];
type ConnectedSources = components["schemas"]["ConnectedSources"];

const purposes: { code: Purpose; title: string; description: string }[] = [
  {
    code: "process_documents",
    title: "Document Processing",
    description:
      "Inspects uploaded files and extracts structured insurance data for completeness checking and policy wallet.",
  },
  {
    code: "external_ai",
    title: "External AI Services",
    description:
      "Allows secure calls to external AI providers for entity extraction and policy reasoning. When disabled, external AI requests are blocked.",
  },
  {
    code: "retention",
    title: "Original File Retention",
    description:
      "Stores original document files for download and visual inspection. Revoking retention immediately deletes stored original files.",
  },
  {
    code: "health_profile",
    title: "Voluntary Health Profile",
    description:
      "Stores only the health access needs you choose to share for protection analysis. This consent is separate from external AI. Revoking it deletes those health profile fields.",
  },
];

export default function AccountPrivacy() {
  const router = useRouter();
  const { mode, headers, loading: actorLoading } = useActor();
  const { account, logout } = useAuth();

  const [consents, setConsents] = useState<Consent[]>([]);
  const [history, setHistory] = useState<ConsentHistoryItem[]>([]);
  const [inventory, setInventory] = useState<Inventory | null>(null);
  const [connectedSources, setConnectedSources] = useState<ConnectedSources | null>(null);
  const [preferences, setPreferences] = useState<Preferences | null>(null);

  const [confirmation, setConfirmation] = useState("");
  const [busy, setBusy] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!headers) return;
    setError(null);

    try {
      if (mode === "account") {
        const [grants, items, hist, sources, prefs] = await Promise.all([
          api.request("get", "/api/v1/account/consents", { headers }),
          api.request("get", "/api/v1/account/inventory", { headers }),
          api.request("get", "/api/v1/account/consents/history", { headers }),
          api.request("get", "/api/v1/account/connected-sources", { headers }),
          api.request("get", "/api/v1/preferences", { headers }),
        ]);
        setConsents(grants.consents);
        setInventory(items);
        setHistory(hist.items || []);
        setConnectedSources(sources);
        setPreferences(prefs);
      } else if (mode === "demo") {
        const [demoConsents, prefs] = await Promise.all([
          api.request("get", "/api/v1/consents", { headers }),
          api.request("get", "/api/v1/preferences", { headers }),
        ]);
        setConsents(demoConsents);
        setPreferences(prefs);
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Privacy settings could not be loaded.");
    }
  }, [headers, mode]);

  useEffect(() => {
    if (!actorLoading && headers) {
      void Promise.resolve().then(() => refresh());
    }
  }, [actorLoading, headers, refresh]);

  async function setConsent(purpose: Purpose, granted: boolean) {
    if (!headers) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      if (mode === "account") {
        await api.request("post", "/api/v1/account/consents", {
          headers,
          body: { purpose, granted, policy_version: "1.5" },
        });
      } else {
        await api.request("post", "/api/v1/consents", {
          headers,
          body: { purpose, granted, policy_version: "1.5" },
        });
      }
      await refresh();
      setNotice(
        granted
          ? "Consent granted. Permissions updated."
          : "Consent revoked. Subsequent operations will adhere to updated permissions."
      );
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Consent could not be updated.");
    } finally {
      setBusy(false);
    }
  }

  async function updatePref(key: keyof Preferences, value: boolean) {
    if (!headers || !preferences) return;
    setBusy(true);
    setError(null);
    try {
      const updated = await api.request("put", "/api/v1/preferences", {
        headers,
        body: { [key]: value },
      });
      setPreferences(updated);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Preferences could not be updated.");
    } finally {
      setBusy(false);
    }
  }

  async function downloadExport() {
    if (!headers || mode !== "account") return;
    setExporting(true);
    setError(null);
    try {
      const bundle = await api.request("get", "/api/v1/account/export", { headers });
      const blob = new Blob([JSON.stringify(bundle, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `insurra-account-export-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
      setNotice("Account data export generated and downloaded successfully.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Data export failed.");
    } finally {
      setExporting(false);
    }
  }

  async function deleteData() {
    if (!headers || (confirmation !== "HAPUS" && confirmation !== "DELETE")) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await api.request("delete", "/api/v1/account/data", {
        headers,
        body: { confirm: "HAPUS" },
      });
      clearProfileCaches();
      setConfirmation("");
      await refresh();
      setNotice(
        "All profile data, uploaded files, extracted fields, and consent records have been purged. Audit records remain minimal."
      );
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Data deletion could not be completed.");
    } finally {
      setBusy(false);
    }
  }

  async function handleDemoReset() {
    if (!headers) return;
    setBusy(true);
    setError(null);
    try {
      clearProfileCaches();
      await resetDemoSession(headers);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Demo session could not be reset.");
      setBusy(false);
    }
  }

  if (actorLoading) return <p role="status">Checking session...</p>;

  if (!headers) {
    return (
      <div className="card account-empty" style={{ maxWidth: 600, margin: "40px auto", padding: 32, textAlign: "center" }}>
        <h1>Sign in to manage privacy settings.</h1>
        <p style={{ margin: "12px 0 20px", color: "#526579" }}>
          You can sign in with your account or explore an isolated interactive demo session.
        </p>
        <div style={{ display: "flex", gap: 12, justifyContent: "center" }}>
          <Button asChild>
            <Link href="/auth">Sign In or Register</Link>
          </Button>
          <Button variant="outline" asChild>
            <Link href="/">Explore Demo</Link>
          </Button>
        </div>
      </div>
    );
  }

  const isDemo = mode === "demo";

  return (
    <div className="account-privacy" style={{ maxWidth: 860, margin: "0 auto", display: "flex", flexDirection: "column", gap: 20, paddingBottom: 40 }}>
      <div className="page-heading" style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 16 }}>
        <div>
          <div className="eyebrow" style={{ fontSize: 12, fontWeight: 700, color: "#087f8c", letterSpacing: 0.5 }}>
            {isDemo ? "DEMO PRIVACY CONTROLS" : "YOUR PRIVACY CONTROLS"}
          </div>
          <h1 style={{ fontSize: 26, fontWeight: 800, color: "#102a43", margin: "4px 0 6px" }}>
            Privacy, Consents & Security
          </h1>
          <p style={{ fontSize: 14, color: "#526579", margin: 0 }}>
            {isDemo
              ? "Session-scoped permissions and notification preferences for your interactive demo."
              : "Manage independent consent purposes, notification preferences, inspect data inventory, and request permanent deletion."}
          </p>
        </div>
        <LockKeyhole size={36} color="#087f8c" />
      </div>

      {isDemo && (
        <div className="alert warning" style={{ background: "#fffbe8", border: "1px solid #ffe58f", color: "#7a5500", padding: "12px 16px", borderRadius: 8, display: "flex", gap: 10, alignItems: "center" }}>
          <ShieldAlert size={18} />
          <div>
            <strong>Interactive Demo Mode:</strong> Consents and preferences modified here apply strictly
            to your isolated demo session. No real account data is stored or deleted.
          </div>
        </div>
      )}

      {error && (
        <div className="alert error" role="alert" style={{ background: "#fdf2f2", border: "1px solid #fecaca", color: "#991b1b", padding: "12px 16px", borderRadius: 8 }}>
          {error}
        </div>
      )}
      {notice && (
        <div className="alert success" role="status" style={{ background: "#eaf8f4", border: "1px solid #b7ebd9", color: "#08876f", padding: "12px 16px", borderRadius: 8 }}>
          {notice}
        </div>
      )}

      {/* SECTION 1: Independent Purpose Consents */}
      <section className="card account-privacy-section" style={{ background: "#ffffff", border: "1px solid #d5e0e6", borderRadius: 12, padding: 24 }}>
        <div className="section-heading" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
          <h2 style={{ fontSize: 17, fontWeight: 700, color: "#102a43", margin: 0 }}>Independent Consent Purposes</h2>
          <span className="badge neutral" style={{ background: "#f0f4f8", color: "#334e68", padding: "3px 8px", borderRadius: 4, fontSize: 11, fontWeight: 700 }}>
            POLICY v1.5
          </span>
        </div>
        <div className="consent-list" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {purposes.map((purpose) => {
            const isGranted = consents.find((item) => item.purpose === purpose.code)?.granted ?? false;
            return (
              <label
                key={purpose.code}
                className="consent-toggle"
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "flex-start",
                  gap: 16,
                  padding: "14px 16px",
                  border: "1px solid #e2e8f0",
                  borderRadius: 8,
                  cursor: "pointer",
                  background: isGranted ? "#f8fdfb" : "#ffffff",
                }}
              >
                <span style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                  <strong style={{ fontSize: 14, color: "#102a43" }}>{purpose.title}</strong>
                  <small style={{ fontSize: 12.5, color: "#526579" }}>{purpose.description}</small>
                </span>
                <input
                  type="checkbox"
                  checked={isGranted}
                  disabled={busy}
                  onChange={(event) => void setConsent(purpose.code, event.target.checked)}
                  style={{ width: 18, height: 18, accentColor: "#087f8c", cursor: "pointer", marginTop: 2 }}
                />
              </label>
            );
          })}
        </div>
        <p className="account-note" style={{ fontSize: 12, color: "#627888", marginTop: 14, margin: "14px 0 0" }}>
          Revoking processing or AI stops all subsequent pipeline execution. Revoking retention deletes stored original files.
        </p>
      </section>

      {/* SECTION 2: Notification & AI Preferences */}
      <section className="card account-privacy-section" style={{ background: "#ffffff", border: "1px solid #d5e0e6", borderRadius: 12, padding: 24 }}>
        <div className="section-heading" style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 16 }}>
          <Bell size={18} color="#087f8c" />
          <h2 style={{ fontSize: 17, fontWeight: 700, color: "#102a43", margin: 0 }}>Notification & AI Preferences</h2>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <label style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 14px", border: "1px solid #eef2f5", borderRadius: 8, cursor: "pointer" }}>
            <div>
              <strong style={{ fontSize: 13.5, color: "#102a43", display: "block" }}>In-App Notifications</strong>
              <span style={{ fontSize: 12, color: "#526579" }}>Receive in-app alerts for system events and reminders</span>
            </div>
            <input
              type="checkbox"
              checked={preferences?.in_app_alerts ?? true}
              disabled={busy || !preferences}
              onChange={(e) => void updatePref("in_app_alerts", e.target.checked)}
              style={{ width: 18, height: 18, accentColor: "#087f8c" }}
            />
          </label>

          <label style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 14px", border: "1px solid #eef2f5", borderRadius: 8, cursor: "pointer" }}>
            <div>
              <strong style={{ fontSize: 13.5, color: "#102a43", display: "block" }}>Policy & Coverage Reminders</strong>
              <span style={{ fontSize: 12, color: "#526579" }}>Get notified about upcoming visa and coverage continuity deadlines</span>
            </div>
            <input
              type="checkbox"
              checked={preferences?.reminders ?? true}
              disabled={busy || !preferences}
              onChange={(e) => void updatePref("reminders", e.target.checked)}
              style={{ width: 18, height: 18, accentColor: "#087f8c" }}
            />
          </label>

          <label style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 14px", border: "1px solid #eef2f5", borderRadius: 8, cursor: "pointer" }}>
            <div>
              <strong style={{ fontSize: 13.5, color: "#102a43", display: "block" }}>Claim Status Updates</strong>
              <span style={{ fontSize: 12, color: "#526579" }}>Alerts when claim draft preparation or sandbox tracking status changes</span>
            </div>
            <input
              type="checkbox"
              checked={preferences?.claim_updates ?? true}
              disabled={busy || !preferences}
              onChange={(e) => void updatePref("claim_updates", e.target.checked)}
              style={{ width: 18, height: 18, accentColor: "#087f8c" }}
            />
          </label>

          <label style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 14px", border: "1px solid #eef2f5", borderRadius: 8, cursor: "pointer" }}>
            <div>
              <strong style={{ fontSize: 13.5, color: "#102a43", display: "block" }}>Renewal Alerts</strong>
              <span style={{ fontSize: 12, color: "#526579" }}>Alerts at 60, 30, and 7 days prior to policy expiration</span>
            </div>
            <input
              type="checkbox"
              checked={preferences?.renewal_alerts ?? true}
              disabled={busy || !preferences}
              onChange={(e) => void updatePref("renewal_alerts", e.target.checked)}
              style={{ width: 18, height: 18, accentColor: "#087f8c" }}
            />
          </label>

          <label style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 14px", border: "1px solid #eef2f5", borderRadius: 8, cursor: "pointer" }}>
            <div>
              <strong style={{ fontSize: 13.5, color: "#102a43", display: "block" }}>External AI Processing Acknowledged</strong>
              <span style={{ fontSize: 12, color: "#526579" }}>Consent disclosure for structured policy parsing using LLM gateways</span>
            </div>
            <input
              type="checkbox"
              checked={preferences?.external_ai_disclosure_acknowledged ?? false}
              disabled={busy || !preferences}
              onChange={(e) => void updatePref("external_ai_disclosure_acknowledged", e.target.checked)}
              style={{ width: 18, height: 18, accentColor: "#087f8c" }}
            />
          </label>
        </div>
      </section>

      {/* SECTION 3: Consent History (Account Only) */}
      {!isDemo && (
        <section className="card account-privacy-section" style={{ background: "#ffffff", border: "1px solid #d5e0e6", borderRadius: 12, padding: 24 }}>
          <div className="section-heading" style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 14 }}>
            <History size={18} color="#087f8c" />
            <h2 style={{ fontSize: 17, fontWeight: 700, color: "#102a43", margin: 0 }}>Consent Audit History</h2>
          </div>
          {history.length === 0 ? (
            <p style={{ fontSize: 13, color: "#627888", margin: 0 }}>No consent audit records recorded yet.</p>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {history.slice(0, 5).map((item, idx) => (
                <div
                  key={idx}
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    padding: "8px 12px",
                    background: "#f8fafc",
                    borderRadius: 6,
                    fontSize: 12.5,
                  }}
                >
                  <span style={{ fontWeight: 600, color: "#102a43" }}>
                    {item.purpose}: {item.granted ? "GRANTED" : "REVOKED"}
                  </span>
                  <span style={{ color: "#627888", display: "flex", alignItems: "center", gap: 4 }}>
                    <Clock size={12} />
                    {new Date(item.timestamp).toLocaleString()}
                  </span>
                </div>
              ))}
            </div>
          )}
        </section>
      )}

      {/* SECTION 4: Connected Sources (Account Only) */}
      {!isDemo && (
        <section className="card account-privacy-section" style={{ background: "#ffffff", border: "1px solid #d5e0e6", borderRadius: 12, padding: 24 }}>
          <div className="section-heading" style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
            <Unplug size={18} color="#087f8c" />
            <h2 style={{ fontSize: 17, fontWeight: 700, color: "#102a43", margin: 0 }}>Connected Data Sources</h2>
          </div>
          <p style={{ fontSize: 13, color: "#526579", margin: "0 0 12px" }}>
            External insurance APIs and medical provider connectors.
          </p>
          <div style={{ padding: "14px 16px", background: "#f8fafc", borderRadius: 8, border: "1px dashed #cbd5e1", textAlign: "center" }}>
            <p style={{ fontSize: 13, color: "#627888", margin: 0 }}>
              {connectedSources?.reason || "No external connectors are available or connected."}
            </p>
            <span style={{ fontSize: 11.5, color: "#94a3b8" }}>
              Inssura operates with zero unverified external integrations. All policy data is uploaded or declared directly by you.
            </span>
          </div>
        </section>
      )}

      {/* SECTION 5: Stored Data Inventory (Account Only) */}
      {!isDemo && (
        <section className="card account-privacy-section" style={{ background: "#ffffff", border: "1px solid #d5e0e6", borderRadius: 12, padding: 24 }}>
          <div className="section-heading" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <FileText size={18} color="#087f8c" />
              <h2 style={{ fontSize: 17, fontWeight: 700, color: "#102a43", margin: 0 }}>Stored Data Inventory</h2>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => void downloadExport()}
              disabled={exporting}
              style={{ display: "flex", alignItems: "center", gap: 6 }}
            >
              <Download size={14} />
              {exporting ? "Exporting..." : "Export Data (JSON)"}
            </Button>
          </div>
          <div className="account-inventory" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(130px, 1fr))", gap: 10, margin: "14px 0" }}>
            <span style={{ padding: 12, background: "#f8fafc", borderRadius: 8, fontSize: 11.5, color: "#627888" }}>
              <strong style={{ display: "block", fontSize: 22, color: "#102a43" }}>{inventory?.document_count ?? 0}</strong> documents
            </span>
            <span style={{ padding: 12, background: "#f8fafc", borderRadius: 8, fontSize: 11.5, color: "#627888" }}>
              <strong style={{ display: "block", fontSize: 22, color: "#102a43" }}>{inventory?.structured_field_count ?? 0}</strong> structured fields
            </span>
            <span style={{ padding: 12, background: "#f8fafc", borderRadius: 8, fontSize: 11.5, color: "#627888" }}>
              <strong style={{ display: "block", fontSize: 22, color: "#102a43" }}>{inventory?.coverage_count ?? 0}</strong> coverage records
            </span>
            <span style={{ padding: 12, background: "#f8fafc", borderRadius: 8, fontSize: 11.5, color: "#627888" }}>
              <strong style={{ display: "block", fontSize: 22, color: "#102a43" }}>{inventory?.claim_case_count ?? 0}</strong> claim cases
            </span>
            <span style={{ padding: 12, background: "#f8fafc", borderRadius: 8, fontSize: 11.5, color: "#627888" }}>
              <strong style={{ display: "block", fontSize: 22, color: "#102a43" }}>{inventory?.action_count ?? 0}</strong> actions recorded
            </span>
          </div>
          <div className="account-inventory-list" style={{ marginTop: 12 }}>
            {inventory?.documents.map((doc) => (
              <Link
                href={`/documents/${doc.id}`}
                key={doc.id}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  padding: "8px 0",
                  borderTop: "1px solid #eef2f5",
                  color: "#102a43",
                  fontSize: 13,
                  textDecoration: "none",
                }}
              >
                <FileText size={15} color="#087f8c" />
                <span>{doc.original_filename}</span>
                <span style={{ marginLeft: "auto", fontSize: 11.5, color: "#627888" }}>
                  {doc.original_file_status === "RETAINED" ? "Original file stored" : "Original file not retained"}
                </span>
              </Link>
            ))}
          </div>
        </section>
      )}

      {/* SECTION 6: Session Management */}
      <section className="card account-session-section" style={{ background: "#ffffff", border: "1px solid #d5e0e6", borderRadius: 12, padding: 24, display: "flex", gap: 16, alignItems: "flex-start" }}>
        <User size={24} color="#087f8c" style={{ marginTop: 2 }} />
        <div style={{ flex: 1 }}>
          <h2 style={{ fontSize: 17, fontWeight: 700, color: "#102a43", margin: "0 0 6px" }}>
            {isDemo ? "Active Demo Persona Session" : "Active Account Session"}
          </h2>
          <p style={{ fontSize: 13.5, color: "#526579", margin: "0 0 14px" }}>
            {isDemo
              ? "You are exploring in demo mode. The session is isolated and stored in your browser session storage."
              : `You are signed in as ${account?.display_name ?? account?.email} (${account?.email}). Your session token is stored in your secure session.`}
          </p>
          {!isDemo && (
            <Button
              variant="outline"
              onClick={async () => {
                await logout();
                clearProfileCaches();
                router.push("/");
              }}
              style={{ display: "inline-flex", alignItems: "center", gap: 6 }}
            >
              <LogOut size={15} /> Log Out
            </Button>
          )}
        </div>
      </section>

      {/* SECTION 7: Danger Zone: Delete / Reset */}
      {isDemo ? (
        <section className="card" style={{ background: "#fffdf5", border: "1px solid #fde68a", borderRadius: 12, padding: 24, display: "flex", gap: 16, alignItems: "flex-start" }}>
          <RotateCcw size={24} color="#b45309" style={{ marginTop: 2 }} />
          <div style={{ flex: 1 }}>
            <h2 style={{ fontSize: 17, fontWeight: 700, color: "#92400e", margin: "0 0 6px" }}>
              Reset Demo Session
            </h2>
            <p style={{ fontSize: 13.5, color: "#78350f", margin: "0 0 14px" }}>
              Restart your interactive demo session with fresh persona data (Raka in Shenzhen or Sinta in Jakarta).
              Any temporary documents, claims, or edited profile values will be reset.
            </p>
            <Button
              variant="outline"
              onClick={() => void handleDemoReset()}
              disabled={busy}
              style={{ display: "inline-flex", alignItems: "center", gap: 6, borderColor: "#f59e0b", color: "#92400e" }}
            >
              <RefreshCw size={15} />
              {busy ? "Resetting..." : "Reset Demo Session"}
            </Button>
          </div>
        </section>
      ) : (
        <section className="card account-delete-section" style={{ background: "#fffbfb", border: "1px solid #fecaca", borderRadius: 12, padding: 24, display: "flex", gap: 16, alignItems: "flex-start" }}>
          <Trash2 size={24} color="#dc2626" style={{ marginTop: 2 }} />
          <div style={{ flex: 1 }}>
            <h2 style={{ fontSize: 17, fontWeight: 700, color: "#991b1b", margin: "0 0 6px" }}>
              Delete All Workspace Data
            </h2>
            <p style={{ fontSize: 13.5, color: "#7f1d1d", margin: "0 0 14px" }}>
              Permanently removes your profile, uploaded documents, extracted fields, and coverage data.
              Your account credentials and security audit logs are retained in minimal compliance form.
            </p>
            <div style={{ display: "flex", flexDirection: "column", gap: 10, maxWidth: 360 }}>
              <label style={{ fontSize: 12.5, fontWeight: 600, color: "#991b1b" }}>
                Type HAPUS or DELETE to confirm:
                <input
                  type="text"
                  value={confirmation}
                  onChange={(e) => setConfirmation(e.target.value.toUpperCase())}
                  autoComplete="off"
                  placeholder="HAPUS"
                  style={{
                    display: "block",
                    width: "100%",
                    padding: "8px 12px",
                    marginTop: 6,
                    border: "1px solid #f87171",
                    borderRadius: 6,
                    fontSize: 14,
                  }}
                />
              </label>
              <Button
                variant="destructive"
                disabled={busy || (confirmation !== "HAPUS" && confirmation !== "DELETE")}
                onClick={() => void deleteData()}
                style={{ display: "inline-flex", alignItems: "center", gap: 6, width: "fit-content" }}
              >
                <Trash2 size={15} />
                {busy ? "Deleting..." : "Permanently Delete Data"}
              </Button>
            </div>
          </div>
        </section>
      )}

      <p className="account-note" style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, color: "#627888", margin: "10px 0 0" }}>
        <ShieldCheck size={16} color="#087f8c" />
        Inssura never executes claims, agreements, or external actions on your behalf without explicit authorization.
      </p>
    </div>
  );
}
