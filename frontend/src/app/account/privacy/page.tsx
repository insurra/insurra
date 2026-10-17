"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { FileText, LockKeyhole, LogOut, ShieldCheck, Trash2, User } from "lucide-react";
import { api } from "@/lib/api/client";
import type { components } from "@/lib/api/types.gen";
import { useAuth } from "@/lib/auth";
import { Button } from "@/components/ui/button";

type Consent = components["schemas"]["PurposeConsent"];
type Inventory = components["schemas"]["AccountInventory"];
type Purpose = components["schemas"]["ConsentPurpose"];

const purposes: { code: Purpose; title: string; description: string }[] = [
  {
    code: "process_documents",
    title: "Document Processing",
    description: "Inspects uploaded files and extracts structured insurance data for completeness checking.",
  },
  {
    code: "external_ai",
    title: "External AI Services",
    description: "Allows secure calls to external AI providers for entity extraction. When disabled, external AI requests are blocked.",
  },
  {
    code: "retention",
    title: "Original File Retention",
    description: "Stores original document files for download and visual side-by-side inspection. Revoking retention deletes stored original files.",
  },
];

export default function AccountPrivacy() {
  const router = useRouter();
  const { account, token, loading, logout } = useAuth();
  const [consents, setConsents] = useState<Consent[]>([]);
  const [inventory, setInventory] = useState<Inventory | null>(null);
  const [confirmation, setConfirmation] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!token) return;
    const headers = { Authorization: `Bearer ${token}` };
    const [grants, items] = await Promise.all([
      api.request("get", "/api/v1/account/consents", { headers }),
      api.request("get", "/api/v1/account/inventory", { headers }),
    ]);
    setConsents(grants.consents);
    setInventory(items);
  }, [token]);

  useEffect(() => {
    void Promise.resolve()
      .then(refresh)
      .catch((cause: unknown) => {
        setError(cause instanceof Error ? cause.message : "Privacy settings could not be loaded.");
      });
  }, [refresh]);

  async function setConsent(purpose: Purpose, granted: boolean) {
    if (!token) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await api.request("post", "/api/v1/account/consents", {
        headers: { Authorization: `Bearer ${token}` },
        body: { purpose, granted, policy_version: "1.5" },
      });
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

  async function deleteData() {
    if (!token || confirmation !== "HAPUS") return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await api.request("delete", "/api/v1/account/data", {
        headers: { Authorization: `Bearer ${token}` },
        body: { confirm: "HAPUS" },
      });
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

  if (loading) return <p role="status">Checking account session...</p>;
  if (!account || !token) {
    return (
      <div className="card account-empty">
        <h1>Sign in to manage privacy settings.</h1>
        <Button asChild>
          <Link href="/auth">Sign In or Register</Link>
        </Button>
      </div>
    );
  }

  return (
    <div className="account-privacy">
      <div className="page-heading">
        <div>
          <div className="eyebrow">YOUR PRIVACY CONTROLS</div>
          <h1>Privacy & Data Management</h1>
          <p>
            Manage independent consent purposes, inspect your data inventory, and request permanent deletion.
          </p>
        </div>
        <LockKeyhole size={40} />
      </div>

      {error && (
        <div className="alert error" role="alert">
          {error}
        </div>
      )}
      {notice && (
        <div className="alert success" role="status">
          {notice}
        </div>
      )}

      <section className="card account-privacy-section">
        <div className="section-heading">
          <h2>Independent Consent Purposes</h2>
          <span className="badge neutral">POLICY v1.5</span>
        </div>
        <div className="consent-list">
          {purposes.map((purpose) => (
            <label key={purpose.code} className="consent-toggle">
              <span>
                <strong>{purpose.title}</strong>
                <small>{purpose.description}</small>
              </span>
              <input
                type="checkbox"
                checked={consents.find((item) => item.purpose === purpose.code)?.granted ?? false}
                disabled={busy}
                onChange={(event) => void setConsent(purpose.code, event.target.checked)}
              />
            </label>
          ))}
        </div>
        <p className="account-note">
          Revoking processing or AI stops all subsequent pipeline execution. Revoking retention deletes stored original files.
          To delete all structured data, use the permanent deletion control below.
        </p>
      </section>

      <section className="card account-privacy-section">
        <div className="section-heading">
          <h2>Stored Data Inventory</h2>
          <FileText size={20} />
        </div>
        <div className="account-inventory">
          <span>
            <strong>{inventory?.document_count ?? 0}</strong> documents
          </span>
          <span>
            <strong>{inventory?.structured_field_count ?? 0}</strong> structured fields
          </span>
          <span>
            <strong>{inventory?.coverage_count ?? 0}</strong> coverage records
          </span>
          <span>
            <strong>{inventory?.claim_case_count ?? 0}</strong> claim cases
          </span>
        </div>
        <div className="account-inventory-list">
          {inventory?.documents.map((document) => (
            <Link href={`/documents/${document.id}`} key={document.id}>
              <FileText size={16} /> {document.original_filename}
              <span>
                {document.original_file_status === "RETAINED" ? "Original file stored" : "Original file not retained"}
              </span>
            </Link>
          ))}
        </div>
      </section>

      <section className="card account-session-section">
        <User size={24} className="session-icon" />
        <div className="session-content">
          <h2>Active Account Session</h2>
          <p>
            You are signed in as <strong>{account?.display_name ?? account?.email}</strong> ({account?.email}).
            Your authentication token is stored securely in your browser session.
          </p>
          <div className="session-actions">
            <Button
              variant="outline"
              onClick={async () => {
                await logout();
                router.push("/");
              }}
            >
              <LogOut size={16} /> Log Out
            </Button>
          </div>
        </div>
      </section>

      <section className="card account-delete-section">
        <Trash2 />
        <div>
          <h2>Delete all workspace data</h2>
          <p>
            This action permanently removes your profile, uploaded documents, extracted text, and coverage data.
            Your account credentials and security audit logs are retained. This action cannot be reversed.
          </p>
          <label>
            Type HAPUS to confirm deletion:
            <input
              value={confirmation}
              onChange={(event) => setConfirmation(event.target.value)}
              autoComplete="off"
              placeholder="HAPUS"
            />
          </label>
          <Button
            variant="outline"
            disabled={busy || confirmation !== "HAPUS"}
            onClick={() => void deleteData()}
          >
            <Trash2 size={16} /> Delete My Data
          </Button>
        </div>
      </section>

      <p className="account-note">
        <ShieldCheck size={14} /> Insurra never executes claims, agreements, or external actions on your behalf without explicit authorization.
      </p>
    </div>
  );
}
