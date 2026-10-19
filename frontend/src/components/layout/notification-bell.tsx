"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { Bell } from "lucide-react";
import { api } from "@/lib/api/client";
import type { components } from "@/lib/api/types.gen";
import {
  announceNotificationsChanged,
  notificationsChangedEvent,
  safeDeepLink,
  useActor,
} from "@/lib/actor";
import "./shell-extras.css";

type Item = components["schemas"]["Notification"];

export function NotificationBell() {
  const pathname = usePathname();
  const router = useRouter();
  const { headers } = useActor();
  const [count, setCount] = useState<number | null>(null);
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<Item[] | null>(null);
  const [error, setError] = useState(false);
  const root = useRef<HTMLDivElement>(null);

  const loadCount = useCallback(async () => {
    if (!headers) {
      setCount(null);
      return;
    }
    try {
      const result = await api.request("get", "/api/v1/notifications/unread-count", { headers });
      setCount(result.unread_count);
    } catch {
      // Badge stays at its last known value when polling fails.
    }
  }, [headers]);

  const loadItems = useCallback(async () => {
    if (!headers) return;
    setError(false);
    try {
      const page = await api.request("get", "/api/v1/notifications", {
        headers,
        query: { filter: "all", limit: 5, offset: 0 },
      });
      setItems(page.items);
      setCount(page.unread_count);
    } catch {
      setError(true);
    }
  }, [headers]);

  useEffect(() => {
    void Promise.resolve().then(loadCount);
  }, [loadCount, pathname]);

  useEffect(() => {
    const tick = () => {
      if (document.visibilityState === "visible") void loadCount();
    };
    const id = window.setInterval(tick, 60_000);
    document.addEventListener("visibilitychange", tick);
    window.addEventListener(notificationsChangedEvent, tick);
    return () => {
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", tick);
      window.removeEventListener(notificationsChangedEvent, tick);
    };
  }, [loadCount]);

  useEffect(() => {
    if (open) void Promise.resolve().then(loadItems);
  }, [open, loadItems]);

  useEffect(() => {
    if (!open) return;
    const onDown = (event: MouseEvent) => {
      if (root.current && !root.current.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  useEffect(() => {
    void Promise.resolve().then(() => setOpen(false));
  }, [pathname]);

  async function markRead(item: Item) {
    if (!headers || item.is_read) return;
    try {
      await api.request("post", "/api/v1/notifications/{notification_id}/read", {
        headers,
        params: { notification_id: item.id },
      });
      setCount((prev) => (prev !== null ? Math.max(0, prev - 1) : null));
      setItems((prev) =>
        prev ? prev.map((n) => (n.id === item.id ? { ...n, is_read: true } : n)) : prev,
      );
      announceNotificationsChanged();
    } catch {
      setError(true);
    }
  }

  async function openItem(item: Item) {
    await markRead(item);
    const target = safeDeepLink(item.deep_link);
    setOpen(false);
    if (target) router.push(target);
  }

  const label =
    count && count > 0 ? `Notifications, ${count} unread` : "Notifications, none unread";

  return (
    <div className="bell-root" ref={root}>
      <button
        type="button"
        className="figma-topbar-bell bell-button"
        aria-label={label}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls="notification-popover"
        onClick={() => setOpen((value) => !value)}
        data-testid="notification-bell"
      >
        <Bell size={17} aria-hidden="true" />
        {count !== null && count > 0 && (
          <span className="bell-badge" data-testid="unread-badge">
            {count > 99 ? "99+" : count}
          </span>
        )}
      </button>
      {open && (
        <div
          id="notification-popover"
          role="dialog"
          aria-label="Latest notifications"
          className="bell-popover"
        >
          <div className="bell-popover-head">
            <strong>Notifications</strong>
            <Link href="/notifications">View all</Link>
          </div>
          <div aria-live="polite">
            {error && <p className="bell-note">Notifications could not be loaded.</p>}
            {!error && items === null && <p className="bell-note">Loading...</p>}
            {!error && items?.length === 0 && <p className="bell-note">You are all caught up.</p>}
          </div>
          <ul className="bell-list">
            {items?.map((item) => (
              <li key={item.id} className={item.is_read ? "bell-item" : "bell-item unread"}>
                <button type="button" className="bell-item-main" onClick={() => void openItem(item)}>
                  <span className="bell-item-title">{item.title}</span>
                  <span className="bell-item-body">{item.body}</span>
                </button>
                {!item.is_read && (
                  <button
                    type="button"
                    className="bell-item-read"
                    onClick={() => void markRead(item)}
                    aria-label={`Mark "${item.title}" as read`}
                  >
                    Mark read
                  </button>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
