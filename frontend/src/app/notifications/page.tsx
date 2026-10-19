"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/api/client";
import type { components } from "@/lib/api/types.gen";
import { announceNotificationsChanged, safeDeepLink, useActor } from "@/lib/actor";
import "./notifications.css";

type Item = components["schemas"]["Notification"];
type Filter = components["schemas"]["NotificationFilter"];

const filters: { value: Filter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "unread", label: "Unread" },
  { value: "action_required", label: "Action required" },
  { value: "claims", label: "Claims" },
  { value: "protection", label: "Protection" },
  { value: "system", label: "System" },
];
const categoryLabel: Record<Item["category"], string> = {
  ACTION_REQUIRED: "Action required",
  CLAIMS: "Claims",
  PROTECTION: "Protection",
  SYSTEM: "System",
};
const pageSize = 20;

export default function NotificationsPage() {
  const { headers, mode, loading: actorLoading } = useActor();
  const [filter, setFilter] = useState<Filter>("all");
  const [items, setItems] = useState<Item[]>([]);
  const [total, setTotal] = useState(0);
  const [unread, setUnread] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState("");

  const load = useCallback(
    async (offset: number) => {
      if (!headers) return;
      setLoading(true);
      setError(null);
      try {
        const page = await api.request("get", "/api/v1/notifications", {
          headers,
          query: { filter, limit: pageSize, offset },
        });
        setItems((prev) => (offset === 0 ? page.items : [...prev, ...page.items]));
        setTotal(page.total);
        setUnread(page.unread_count);
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : "Notifications could not be loaded.");
      } finally {
        setLoading(false);
      }
    },
    [headers, filter],
  );

  useEffect(() => {
    void Promise.resolve().then(() => load(0));
  }, [load]);

  async function markRead(item: Item) {
    if (!headers || item.is_read) return;
    try {
      await api.request("post", "/api/v1/notifications/{notification_id}/read", {
        headers,
        params: { notification_id: item.id },
      });
      setUnread((prev) => Math.max(0, prev - 1));
      setItems((prev) => {
        const next = prev.map((n) => (n.id === item.id ? { ...n, is_read: true } : n));
        return filter === "unread" ? next.filter((n) => n.id !== item.id) : next;
      });
      setStatus(`Marked "${item.title}" as read.`);
      announceNotificationsChanged();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not mark as read.");
    }
  }

  async function markAll() {
    if (!headers) return;
    try {
      const result = await api.request("post", "/api/v1/notifications/read-all", { headers });
      setStatus(
        result.updated === 1 ? "1 notification marked as read." : `${result.updated} notifications marked as read.`,
      );
      announceNotificationsChanged();
      await load(0);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not mark all as read.");
    }
  }

  if (actorLoading) return <p role="status">Checking session...</p>;
  if (!headers) return null;

  return (
    <div className="notif-page">
      <header className="notif-head">
        <div>
          <h1>Notifications</h1>
          <p>
            In-app alerts only. Insurra does not send email or text messages from this screen.
            {mode === "demo" && " These are synthetic demo notifications."}
          </p>
        </div>
        <button
          type="button"
          className="notif-btn"
          onClick={() => void markAll()}
          disabled={unread === 0}
        >
          Mark all read
        </button>
      </header>

      <div role="group" aria-label="Filter notifications" className="notif-filters">
        {filters.map((option) => (
          <button
            key={option.value}
            type="button"
            aria-pressed={filter === option.value}
            className={filter === option.value ? "notif-chip active" : "notif-chip"}
            onClick={() => setFilter(option.value)}
          >
            {option.label}
          </button>
        ))}
      </div>

      <p role="status" aria-live="polite" className="notif-status">
        {status || `${unread} unread`}
      </p>
      {error && (
        <div role="alert" className="alert error">
          {error}{" "}
          <button type="button" className="notif-btn" onClick={() => void load(0)}>
            Retry
          </button>
        </div>
      )}
      {loading && items.length === 0 && <p role="status">Loading notifications...</p>}
      {!loading && !error && items.length === 0 && (
        <div className="card notif-empty" data-testid="notifications-empty">
          <h2>No notifications here</h2>
          <p>
            {filter === "all"
              ? "You are all caught up. New alerts appear here when something needs attention."
              : "Nothing matches this filter."}
          </p>
        </div>
      )}
      <ul className="notif-list">
        {items.map((item) => {
          const target = safeDeepLink(item.deep_link);
          return (
            <li key={item.id} className={item.is_read ? "card notif-item" : "card notif-item unread"}>
              <div className="notif-item-body">
                <div className="notif-meta">
                  <span className="badge neutral">{categoryLabel[item.category]}</span>
                  {item.priority === "HIGH" && <span className="badge warning">HIGH PRIORITY</span>}
                  {item.is_demo && <span className="badge neutral">SYNTHETIC DEMO</span>}
                  <time dateTime={item.created_at}>{new Date(item.created_at).toLocaleString()}</time>
                </div>
                <h2>
                  {item.title}
                  {!item.is_read && <span className="notif-unread-dot"> (unread)</span>}
                </h2>
                <p>{item.body}</p>
              </div>
              <div className="notif-actions">
                {target && (
                  <Link href={target} className="notif-btn" onClick={() => void markRead(item)}>
                    Open
                  </Link>
                )}
                {!item.is_read && (
                  <button
                    type="button"
                    className="notif-btn"
                    onClick={() => void markRead(item)}
                    aria-label={`Mark "${item.title}" as read`}
                  >
                    Mark read
                  </button>
                )}
              </div>
            </li>
          );
        })}
      </ul>
      {items.length < total && (
        <button
          type="button"
          className="notif-btn"
          disabled={loading}
          onClick={() => void load(items.length)}
        >
          Load more
        </button>
      )}
    </div>
  );
}
