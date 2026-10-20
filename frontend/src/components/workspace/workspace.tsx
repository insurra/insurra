"use client";

import Link from "next/link";
import type { components } from "@/lib/api/types.gen";
import type { useWorkspace } from "@/lib/workspace";
import "./workspace.css";

type Workspace = ReturnType<typeof useWorkspace>;
export function WorkspaceState({ workspace }: { workspace: Workspace }) {
  if (workspace.loading)
    return <p role="status">Loading protection context…</p>;
  if (workspace.error)
    return (
      <div className="vn-state" role="alert">
        <h1>Data Unavailable</h1>
        <p>{workspace.error}</p>
        <button onClick={workspace.refresh}>Try again</button>
        <Link href="/onboarding">Review profile</Link>
      </div>
    );
  return (
    <div className="vn-state">
      <h1>Sign in to access your protection workspace</h1>
      <p>Use an authenticated account or choose an active demo persona.</p>
      <Link href="/auth">Sign in</Link>
      <Link href="/">Select demo</Link>
    </div>
  );
}
export function EmergencyNotice({
  info,
}: {
  info?: components["schemas"]["EmergencyInfo"];
}) {
  return (
    <aside className="vn-emergency" aria-label="Emergency Assistance">
      <strong>
        {info?.label ?? "Emergency? Check local emergency services."}
      </strong>
      {info?.available && info.phone_number ? (
        <a href={`tel:${info.phone_number}`}>Call {info.phone_number}</a>
      ) : (
        <p>
          If you require immediate medical attention, contact local emergency services immediately.
          Policy checks do not replace emergency care.
        </p>
      )}
      {info?.source_url && (
        <a href={info.source_url} target="_blank" rel="noreferrer">
          Official source · {info.checked_at}
        </a>
      )}
      <small>Full emergency escalation is available via topbar Emergency SOS.</small>
    </aside>
  );
}
export function ConsentNotice({ ai = false }: { ai?: boolean }) {
  return (
    <div className="vn-state" role="note">
      <p>
        Enable document processing{ai ? " and external AI" : ""} permissions before proceeding.
      </p>
      <Link href="/settings/privacy">Settings & Privacy</Link>
      <small>
        Manage external AI and document data retention in your privacy controls.
      </small>
    </div>
  );
}
