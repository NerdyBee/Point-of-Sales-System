import { ClipboardList, RefreshCcw, Search, ShieldAlert } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { fetchAuditEvents, readStoredAuth, type AuditEvent } from "../../shared/api/client";
import { StatusBadge } from "../../shared/components/StatusBadge";
import { TablePagination, usePaginatedRows } from "../../shared/components/TablePagination";

function actionTone(action: string) {
  if (action.includes("void") || action.includes("closed") || action.includes("status_changed")) return "danger";
  if (action.includes("refund") || action.includes("cash_movement") || action.includes("updated")) return "warning";
  if (action.includes("created") || action.includes("opened") || action.includes("recorded")) return "success";
  return "info";
}

function formatMetadata(metadata: Record<string, unknown>) {
  const entries = Object.entries(metadata);
  if (entries.length === 0) return "No metadata";
  return entries.map(([key, value]) => `${key}: ${Array.isArray(value) ? value.join(", ") : String(value)}`).join(" | ");
}

export function AuditLogView() {
  const storedAuth = useMemo(() => readStoredAuth(), []);
  const activeBranchId = storedAuth?.session.branchId ?? storedAuth?.staff.branchId ?? "";
  const activeUserId = storedAuth?.staff.id ?? "";
  const [events, setEvents] = useState<AuditEvent[]>([]);
  const [selectedEvent, setSelectedEvent] = useState<AuditEvent | null>(null);
  const [query, setQuery] = useState("");
  const [actionFilter, setActionFilter] = useState("");
  const [status, setStatus] = useState("Ready");

  const actionOptions = useMemo(() => ["all", ...Array.from(new Set(events.map((event) => event.action))).sort()], [events]);
  const filteredEvents = useMemo(() => {
    const needle = query.toLowerCase();
    return events
      .filter((event) => !actionFilter || actionFilter === "all" || event.action === actionFilter)
      .filter((event) => `${event.action} ${event.entityType} ${event.entityId} ${event.userId}`.toLowerCase().includes(needle));
  }, [actionFilter, events, query]);
  const eventPage = usePaginatedRows(filteredEvents, 10);
  const sensitiveEvents = useMemo(
    () => events.filter((event) => event.action.includes("void") || event.action.includes("refund") || event.action.includes("closed")).length,
    [events]
  );

  async function loadEvents() {
    setStatus("Syncing audit trail...");

    if (!activeUserId || !activeBranchId) {
      setEvents([]);
      setSelectedEvent(null);
      setStatus("Sign in with a branch to load audit trail");
      return;
    }

    try {
      const response = await fetchAuditEvents(activeUserId, activeBranchId);
      setEvents(response.events);
      setSelectedEvent((current) => response.events.find((event) => event.id === current?.id) ?? response.events[0] ?? null);
      setStatus("Audit trail synced");
    } catch (error) {
      setEvents([]);
      setSelectedEvent(null);
      setStatus(error instanceof Error ? error.message : "Unable to load audit trail");
    }
  }

  useEffect(() => {
    void loadEvents();
  }, []);

  return (
    <div className="module-view">
      <div className="module-heading">
        <div>
          <p className="eyebrow">Permissions, controls and traceability</p>
          <h1>Audit log</h1>
        </div>
        <div className="button-group">
          <select className="compact-select" value={actionFilter} onChange={(event) => setActionFilter(event.target.value)}>
            <option value="">Action</option>
            {actionOptions.map((action) => <option key={action} value={action}>{action.replace("_", " ")}</option>)}
          </select>
          <button className="secondary-button" onClick={loadEvents}><RefreshCcw size={18} /> Sync</button>
        </div>
      </div>

      <section className="stats-grid">
        <article className="stat-card stat-card-dark">
          <div className="stat-card-top"><span>Audit events</span><ClipboardList size={20} /></div>
          <strong>{events.length}</strong>
          <small>{status}</small>
        </article>
        <article className="stat-card">
          <div className="stat-card-top"><span>Sensitive events</span><ShieldAlert size={20} /></div>
          <strong>{sensitiveEvents}</strong>
          <small>Refunds, voids and closures</small>
        </article>
        <article className="stat-card">
          <div className="stat-card-top"><span>Filtered view</span></div>
          <strong>{filteredEvents.length}</strong>
          <small>{!actionFilter || actionFilter === "all" ? "All actions" : actionFilter}</small>
        </article>
      </section>

      <div className="audit-workflow">
        <section className="panel">
          <div className="panel-header">
            <h2>Event stream</h2>
            <div className="search-box compact-search">
              <Search size={16} />
              <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search events" />
            </div>
          </div>
          <div className="audit-stream">
            {eventPage.pageRows.length === 0 ? (
              <div className="empty-state">No audit events match this view.</div>
            ) : (
              eventPage.pageRows.map((event, index) => (
                <button
                  className={selectedEvent?.id === event.id ? "audit-event audit-event-active" : "audit-event"}
                  key={event.id}
                  onClick={() => setSelectedEvent(event)}
                >
                  <div>
                    <strong><span className="number-cell">{eventPage.startIndex + index + 1}</span>{event.action}</strong>
                    <span>{event.entityType} - {event.entityId}</span>
                  </div>
                  <StatusBadge label={event.userId} tone={actionTone(event.action)} />
                  <small>{new Date(event.createdAt).toLocaleString()}</small>
                </button>
              ))
            )}
          </div>
          <TablePagination
            page={eventPage.page}
            pageCount={eventPage.pageCount}
            pageSize={eventPage.pageSize}
            totalRows={eventPage.totalRows}
            startIndex={eventPage.startIndex}
            visibleCount={eventPage.pageRows.length}
            onPageChange={eventPage.setPage}
            onPageSizeChange={eventPage.setPageSize}
          />
        </section>

        <aside className="panel audit-detail-panel">
          <div className="panel-header">
            <h2>Event detail</h2>
            <span>{selectedEvent?.id ?? "No selection"}</span>
          </div>
          {selectedEvent ? (
            <div className="audit-detail">
              <StatusBadge label={selectedEvent.action} tone={actionTone(selectedEvent.action)} />
              <strong>{selectedEvent.entityType}</strong>
              <span>{selectedEvent.entityId}</span>
              <dl>
                <div><dt>User</dt><dd>{selectedEvent.userId}</dd></div>
                <div><dt>Branch</dt><dd>{selectedEvent.branchId ?? "Tenant-wide"}</dd></div>
                <div><dt>Time</dt><dd>{new Date(selectedEvent.createdAt).toLocaleString()}</dd></div>
              </dl>
              <pre>{formatMetadata(selectedEvent.metadata)}</pre>
            </div>
          ) : (
            <div className="empty-state">Select an audit event to inspect details.</div>
          )}
        </aside>
      </div>
    </div>
  );
}
