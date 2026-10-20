"use client";

import { useCallback, useEffect, useState } from "react";
import {
  Activity,
  Clock,
  Eye,
  FileCheck2,
  FileText,
  RefreshCw,
  Search,
  ShieldCheck,
  User,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/lib/auth";
import {
  getWorkflowHeaders,
  getWorkflowUrl,
  type WorkflowAuditEvent,
  type WorkflowAuditTimelineResponse,
} from "@/lib/api/workflow-client";

export default function AuditPage() {
  const { account, token: accountToken } = useAuth();

  const [events, setEvents] = useState<WorkflowAuditEvent[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Filters
  const [categoryTab, setCategoryTab] = useState<string>("ALL");
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedEvent, setSelectedEvent] = useState<WorkflowAuditEvent | null>(null);

  const loadAuditTimeline = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const headers = getWorkflowHeaders(accountToken);
      const params = new URLSearchParams();
      if (categoryTab !== "ALL") params.set("category", categoryTab);
      if (searchQuery.trim()) params.set("q", searchQuery.trim());
      params.set("limit", "50");

      const res = await fetch(getWorkflowUrl(`/api/v1/workflow/audit/timeline?${params.toString()}`), { headers });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data: WorkflowAuditTimelineResponse = await res.json();
      setEvents(data.events || []);
      setTotal(data.total || 0);
    } catch (err) {
      console.error("Error loading audit timeline:", err);
      setError("Failed to load audit events.");
    } finally {
      setLoading(false);
    }
  }, [categoryTab, searchQuery, accountToken]);

  useEffect(() => {
    void Promise.resolve().then(loadAuditTimeline);
  }, [loadAuditTimeline]);

  const getCategoryBadgeClass = (category: string) => {
    switch (category) {
      case "CLAIMS":
        return "bg-teal-50 text-teal-700 border-teal-200";
      case "ACTIONS":
        return "bg-indigo-50 text-indigo-700 border-indigo-200";
      case "DOCUMENTS":
        return "bg-sky-50 text-sky-700 border-sky-200";
      case "SECURITY":
        return "bg-amber-50 text-amber-700 border-amber-200";
      default:
        return "bg-slate-100 text-slate-700 border-slate-200";
    }
  };

  return (
    <div className="w-full max-w-7xl mx-auto px-4 py-8 text-slate-900">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-8">
        <div>
          <h1 className="text-3xl font-extrabold text-slate-900 tracking-tight mb-1">
            Activity &amp; Audit Trail
          </h1>
          <p className="text-sm text-slate-500">
            Immutable log of all user decisions, evidence confirmations, draft generations, and sandbox executions.
          </p>
        </div>
        <div className="flex items-center gap-3">
          {account ? (
            <span className="inline-flex items-center gap-1.5 text-xs font-bold text-blue-700 bg-blue-50 border border-blue-200 px-3 py-1.5 rounded-full">
              <User size={13} /> {account.display_name || account.email}
            </span>
          ) : (
            <span className="inline-flex items-center gap-1.5 text-xs font-bold text-teal-800 bg-teal-50 border border-teal-200 px-3 py-1.5 rounded-full">
              <ShieldCheck size={13} /> Sesi Audit Log
            </span>
          )}
          <Button
            variant="outline"
            size="sm"
            onClick={loadAuditTimeline}
            disabled={loading}
            className="flex items-center gap-1.5 text-xs font-semibold"
          >
            <RefreshCw size={13} className={loading ? "animate-spin" : ""} /> Refresh
          </Button>
        </div>
      </div>

      {error && (
        <div className="p-3.5 mb-6 bg-red-50 border border-red-200 text-red-700 text-xs font-semibold rounded-xl">
          {error}
        </div>
      )}

      {/* Filter Tabs & Search */}
      <div className="bg-white border border-slate-200 rounded-2xl p-4 shadow-sm mb-6">
        <div className="flex flex-col md:flex-row gap-4 items-stretch md:items-center justify-between">
          {/* Tabs */}
          <div className="flex items-center gap-2 overflow-x-auto pb-1 md:pb-0">
            {["ALL", "CLAIMS", "ACTIONS", "DOCUMENTS", "SECURITY"].map((cat) => (
              <button
                key={cat}
                type="button"
                onClick={() => setCategoryTab(cat)}
                className={`px-3.5 py-1.5 text-xs font-bold rounded-lg transition-all ${
                  categoryTab === cat
                    ? "bg-teal-700 text-white shadow-sm"
                    : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                }`}
              >
                {cat}
              </button>
            ))}
          </div>

          {/* Search */}
          <div className="relative min-w-[260px]">
            <input
              type="text"
              placeholder="Search audit events by summary, actor, or ref..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-9 pr-3 py-1.5 text-xs bg-slate-50 border border-slate-200 rounded-lg text-slate-800 outline-none focus:bg-white focus:border-teal-700"
            />
            <Search size={14} className="absolute left-3 top-2 text-slate-400" />
          </div>
        </div>
      </div>

      {/* Timeline List */}
      <div className="bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden">
        <div className="p-4 border-b border-slate-100 bg-slate-50/50 flex items-center justify-between">
          <span className="text-xs font-bold uppercase tracking-wider text-slate-500">
            Audit Events ({total})
          </span>
          <span className="text-xs text-slate-400">Cryptographically ordered</span>
        </div>

        {loading && (
          <div className="py-20 text-center text-slate-400 text-sm">
            <RefreshCw className="animate-spin inline-block text-teal-700 mb-2" size={24} />
            <p>Loading audit timeline...</p>
          </div>
        )}

        {!loading && events.length === 0 && (
          <div className="py-20 text-center text-slate-400">
            <Clock size={32} className="mx-auto mb-2 opacity-30" />
            <p className="font-semibold text-slate-600 text-sm">No audit events match your filter</p>
          </div>
        )}

        {!loading && (
          <div className="divide-y divide-slate-100">
            {events.map((ev) => (
              <div
                key={ev.id}
                data-testid={`audit-event-${ev.id}`}
                className="p-5 hover:bg-slate-50/70 transition-colors flex items-start justify-between gap-4"
              >
                <div className="flex items-start gap-4">
                  <div className="w-10 h-10 rounded-xl bg-slate-100 text-slate-600 grid place-items-center flex-shrink-0 mt-0.5">
                    {ev.category === "CLAIMS" ? (
                      <FileText size={18} className="text-teal-700" />
                    ) : ev.category === "ACTIONS" ? (
                      <FileCheck2 size={18} className="text-indigo-700" />
                    ) : ev.category === "SECURITY" ? (
                      <ShieldCheck size={18} className="text-amber-700" />
                    ) : (
                      <Activity size={18} className="text-slate-600" />
                    )}
                  </div>
                  <div>
                    <div className="flex flex-wrap items-center gap-2 mb-1">
                      <span className="font-bold text-slate-900 text-sm">{ev.title}</span>
                      <span
                        className={`text-[10px] font-bold uppercase tracking-wider border rounded px-2 py-0.5 ${getCategoryBadgeClass(
                          ev.category
                        )}`}
                      >
                        {ev.category}
                      </span>
                      <span className="text-[10px] font-semibold text-slate-500 bg-slate-100 px-1.5 py-0.5 rounded">
                        {ev.actor_type}
                      </span>
                      {ev.synthetic && (
                        <span
                          data-testid="audit-synthetic-badge"
                          className="text-[10px] font-semibold text-amber-800 bg-amber-100 px-1.5 py-0.5 rounded"
                        >
                          SIMULASI
                        </span>
                      )}
                      {ev.source_table && (
                        <span className="text-[10px] font-mono text-slate-400">
                          {ev.source_table}
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-slate-600 leading-relaxed mb-2">{ev.summary}</p>
                    <div className="flex items-center gap-4 text-[11px] text-slate-400 font-mono">
                      <span>Event: {ev.event_type}</span>
                      {ev.receipt_ref && <span>Receipt: {ev.receipt_ref}</span>}
                    </div>
                  </div>
                </div>

                <div className="text-right flex-shrink-0">
                  <span className="text-xs text-slate-400 block mb-2 font-medium">
                    {new Date(String(ev.created_at)).toLocaleString("en-US", {
                      month: "short",
                      day: "numeric",
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </span>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setSelectedEvent(ev)}
                    className="text-xs h-7 px-2.5 text-slate-600 hover:text-slate-900"
                  >
                    <Eye size={12} className="mr-1" /> Inspector
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Event Details Inspector Modal */}
      {selectedEvent && (
        <div
          className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-50 grid place-items-center p-4"
          onClick={() => setSelectedEvent(null)}
        >
          <div
            className="bg-white rounded-2xl max-w-xl w-full p-6 shadow-2xl border border-slate-200"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between pb-4 border-b border-slate-100 mb-4">
              <div>
                <h3 className="font-bold text-slate-900 text-base">{selectedEvent.title}</h3>
                <span className="text-xs text-slate-400 font-mono">{selectedEvent.id}</span>
              </div>
              <button
                type="button"
                onClick={() => setSelectedEvent(null)}
                className="text-slate-400 hover:text-slate-600"
              >
                <X size={18} />
              </button>
            </div>

            <div className="space-y-4 text-xs">
              <div>
                <span className="font-semibold text-slate-500 uppercase block mb-1">Summary</span>
                <p className="text-slate-800 bg-slate-50 p-3 rounded-lg border border-slate-100">
                  {selectedEvent.summary}
                </p>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="bg-slate-50 p-3 rounded-lg border border-slate-100">
                  <span className="text-slate-400 uppercase font-semibold block mb-0.5">Actor Type</span>
                  <strong className="text-slate-800">{selectedEvent.actor_type}</strong>
                </div>
                <div className="bg-slate-50 p-3 rounded-lg border border-slate-100">
                  <span className="text-slate-400 uppercase font-semibold block mb-0.5">Timestamp</span>
                  <strong className="text-slate-800">
                    {new Date(String(selectedEvent.created_at)).toLocaleString()}
                  </strong>
                </div>
              </div>

              {selectedEvent.details && Object.keys(selectedEvent.details).length > 0 && (
                <div>
                  <span className="font-semibold text-slate-500 uppercase block mb-1">
                    Sanitized Event Details JSON
                  </span>
                  <pre className="font-mono bg-slate-900 text-slate-200 p-3 rounded-lg max-h-48 overflow-auto">
                    {JSON.stringify(selectedEvent.details, null, 2)}
                  </pre>
                </div>
              )}
            </div>

            <div className="flex justify-end pt-4 border-t border-slate-100 mt-6">
              <Button size="sm" onClick={() => setSelectedEvent(null)}>
                Close Inspector
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
