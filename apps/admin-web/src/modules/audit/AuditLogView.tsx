import { ClipboardList, Download, RefreshCcw, Search, ShieldAlert, UserRound, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { fetchAuditEvents, fetchBranchOptions, readStoredAuth, type AuditEvent, type BranchOption } from "../../shared/api/client";
import { StatusBadge } from "../../shared/components/StatusBadge";
import { TablePagination, usePaginatedRows } from "../../shared/components/TablePagination";
import { dateRangeErrorMessage, hasInvertedDateRange } from "../../shared/utils/dateFilters";

function actionTone(action: string) {
  if (action.includes("void") || action.includes("closed") || action.includes("status_changed") || action.includes("login_failed") || action.includes("security_reset")) return "danger";
  if (action.includes("refund") || action.includes("cash_movement") || action.includes("updated") || action.includes("security_updated")) return "warning";
  if (action.includes("created") || action.includes("opened") || action.includes("recorded")) return "success";
  return "info";
}

function formatMetadata(metadata: Record<string, unknown>) {
  const entries = Object.entries(metadata);
  if (entries.length === 0) return "No metadata";
  return entries.map(([key, value]) => `${key}: ${Array.isArray(value) ? value.join(", ") : String(value)}`).join(" | ");
}

function csvEscape(value: string | number) {
  return `"${String(value).replaceAll("\"", "\"\"")}"`;
}

export function AuditLogView() {
  const storedAuth = useMemo(() => readStoredAuth(), []);
  const canUseAllBranches = storedAuth?.staff.role === "owner" || storedAuth?.staff.role === "state_manager";
  const initialBranchId = canUseAllBranches ? "" : storedAuth?.session.branchId ?? storedAuth?.staff.branchId ?? "";
  const activeUserId = storedAuth?.staff.id ?? "";
  const [branchId, setBranchId] = useState(initialBranchId);
  const [branches, setBranches] = useState<BranchOption[]>([]);
  const [events, setEvents] = useState<AuditEvent[]>([]);
  const [selectedEvent, setSelectedEvent] = useState<AuditEvent | null>(null);
  const [query, setQuery] = useState("");
  const [actionFilter, setActionFilter] = useState("");
  const [actorFilter, setActorFilter] = useState("");
  const [entityFilter, setEntityFilter] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [status, setStatus] = useState("Ready");

  const actionOptions = useMemo(() => Array.from(new Set(events.map((event) => event.action))).sort(), [events]);
  const actorOptions = useMemo(() => Array.from(new Set(events.map((event) => event.userId))).sort(), [events]);
  const entityOptions = useMemo(() => Array.from(new Set(events.map((event) => event.entityType))).sort(), [events]);
  const filteredEvents = useMemo(() => {
    const needle = query.toLowerCase();
    return events
      .filter((event) => {
        const haystack = [
          event.action,
          event.entityType,
          event.entityId,
          event.userId,
          event.branchId,
          formatMetadata(event.metadata)
        ].filter(Boolean).join(" ").toLowerCase();
        const matchesQuery = !needle || haystack.includes(needle);
        const matchesAction = !actionFilter || event.action === actionFilter;
        const matchesActor = !actorFilter || event.userId === actorFilter;
        const matchesEntity = !entityFilter || entityFilter === "all" || event.entityType === entityFilter;
        return matchesQuery && matchesAction && matchesActor && matchesEntity;
      });
  }, [actionFilter, actorFilter, entityFilter, events, query]);
  const eventPage = usePaginatedRows(filteredEvents, 10);
  const selectedBranch = useMemo(() => branches.find((branch) => branch.id === branchId) ?? null, [branchId, branches]);
  const branchLocked = Boolean(branchId && branches.length === 1);
  const sensitiveEvents = useMemo(
    () => events.filter((event) =>
      event.action.includes("void") ||
      event.action.includes("refund") ||
      event.action.includes("closed") ||
      event.action.includes("login_failed") ||
      event.action.includes("security_")
    ).length,
    [events]
  );

  async function loadEvents(nextStartDate = startDate, nextEndDate = endDate, nextBranchId = branchId, nextActorFilter = actorFilter, nextActionFilter = actionFilter) {
    if (hasInvertedDateRange(nextStartDate, nextEndDate)) {
      setStatus(dateRangeErrorMessage());
      return;
    }

    setStatus("Syncing audit trail...");

    if (!activeUserId) {
      setEvents([]);
      setSelectedEvent(null);
      setStatus("Sign in to load audit trail");
      return;
    }

    try {
      const [branchResponse, auditResponse] = await Promise.all([
        fetchBranchOptions(),
        fetchAuditEvents(nextActorFilter, nextBranchId, nextActionFilter, nextStartDate, nextEndDate)
      ]);
      setBranches(branchResponse.branches);
      setEvents(auditResponse.events);
      setSelectedEvent((current) => auditResponse.events.find((event) => event.id === current?.id) ?? auditResponse.events[0] ?? null);
      setStatus("Audit trail synced");
    } catch (error) {
      setEvents([]);
      setSelectedEvent(null);
      setStatus(error instanceof Error ? error.message : "Unable to load audit trail");
    }
  }

  function changeActionFilter(nextActionFilter: string) {
    setActionFilter(nextActionFilter);
    void loadEvents(startDate, endDate, branchId, actorFilter, nextActionFilter);
  }

  function changeActorFilter(nextActorFilter: string) {
    setActorFilter(nextActorFilter);
    void loadEvents(startDate, endDate, branchId, nextActorFilter, actionFilter);
  }

  function clearEventFilters() {
    setQuery("");
    setActionFilter("");
    setActorFilter("");
    setEntityFilter("");
    setStartDate("");
    setEndDate("");
    void loadEvents("", "", branchId, "", "");
  }

  function changeBranch(nextBranchId: string) {
    setBranchId(nextBranchId);
    void loadEvents(startDate, endDate, nextBranchId, actorFilter, actionFilter);
  }

  function exportCsv() {
    const rows = [
      ["number", "created_at", "user_id", "branch_id", "action", "entity_type", "entity_id", "metadata"],
      ...filteredEvents.map((event, index) => [
        index + 1,
        new Date(event.createdAt).toLocaleString(),
        event.userId,
        event.branchId ?? "Tenant-wide",
        event.action,
        event.entityType,
        event.entityId,
        formatMetadata(event.metadata)
      ])
    ];
    const csv = rows.map((row) => row.map((cell) => csvEscape(cell)).join(",")).join("\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `naijapos-audit-${startDate || "all"}-to-${endDate || new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(url);
    setStatus("Audit trail exported");
  }

  useEffect(() => {
    void loadEvents();
  }, []);

  useEffect(() => {
    setSelectedEvent((current) => filteredEvents.find((event) => event.id === current?.id) ?? filteredEvents[0] ?? null);
  }, [filteredEvents]);

  return (
    <div className="module-view">
      <div className="module-heading">
        <div>
          <p className="eyebrow">Permissions, controls and traceability</p>
          <h1>Audit log</h1>
        </div>
        <div className="button-group">
          <label className="toolbar-select">
            Branch
            {branchLocked ? (
              <span className="locked-select-value locked-select-value-compact">
                <strong>{selectedBranch?.name ?? branchId}</strong>
                <small>{selectedBranch?.city ?? "assigned"}</small>
              </span>
            ) : (
              <select value={branchId} onChange={(event) => changeBranch(event.target.value)}>
                <option value="">{canUseAllBranches ? "All accessible branches" : "Branch"}</option>
                {branches.map((branch) => <option key={branch.id} value={branch.id}>{branch.name} - {branch.city}</option>)}
              </select>
            )}
          </label>
          <select className="compact-select" value={actionFilter} onChange={(event) => changeActionFilter(event.target.value)}>
            <option value="">Action</option>
            {actionOptions.map((action) => <option key={action} value={action}>{action.replace("_", " ")}</option>)}
          </select>
          <select className="compact-select" value={actorFilter} onChange={(event) => changeActorFilter(event.target.value)}>
            <option value="">Actor</option>
            {actorOptions.map((actor) => <option key={actor} value={actor}>{actor}</option>)}
          </select>
          <button className="secondary-button" onClick={() => loadEvents(startDate, endDate, branchId, actorFilter, actionFilter)}><RefreshCcw size={18} /> Sync</button>
          <button className="primary-button" onClick={exportCsv} disabled={filteredEvents.length === 0}><Download size={18} /> Export CSV</button>
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
          <small>Security, refunds, voids and closures</small>
        </article>
        <article className="stat-card">
          <div className="stat-card-top"><span>Actors</span><UserRound size={20} /></div>
          <strong>{actorOptions.length}</strong>
          <small>{!actorFilter || actorFilter === "all" ? "All users" : actorFilter}</small>
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
            {query ? (
              <button type="button" onClick={() => setQuery("")} aria-label="Clear event search"><X size={14} /></button>
            ) : null}
          </div>
          </div>
          <div className="table-toolbar audit-filter-toolbar">
            <select value={entityFilter} onChange={(event) => setEntityFilter(event.target.value)}>
              <option value="">Entity type</option>
              {entityOptions.map((entity) => <option key={entity} value={entity}>{entity.replace("_", " ")}</option>)}
            </select>
            <div className="date-range-filter audit-date-range-filter">
              <label>
                <span>Start</span>
                <input type="date" value={startDate} onChange={(event) => setStartDate(event.target.value)} />
              </label>
              <label>
                <span>End</span>
                <input type="date" value={endDate} onChange={(event) => setEndDate(event.target.value)} />
              </label>
            </div>
            <button className="secondary-button" type="button" onClick={() => loadEvents(startDate, endDate, branchId, actorFilter, actionFilter)}>Apply dates</button>
            {(query || actionFilter || actorFilter || entityFilter || startDate || endDate) ? (
              <button className="secondary-button" type="button" onClick={clearEventFilters}>Clear filters</button>
            ) : null}
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
