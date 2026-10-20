"use client";

import Link from "next/link";
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
      <p>Use an authenticated account or choose an active persona.</p>
      <Link href="/auth">Sign in</Link>
      <Link href="/">Select persona</Link>
    </div>
  );
}
export function ConsentNotice({ ai = false }: { ai?: boolean }) {
  return (
    <div className="vn-state" role="note">
      <p>
        Enable document processing permission{ai ? " and external AI" : ""} before proceeding.
      </p>
      <Link href="/settings/privacy">Privacy &amp; Permissions</Link>
      <small>
        Manage external AI and document data retention via privacy controls.
      </small>
    </div>
  );
}
