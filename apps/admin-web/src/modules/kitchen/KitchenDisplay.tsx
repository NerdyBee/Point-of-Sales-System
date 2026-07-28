import { BellRing, CheckCircle2, Clock, RefreshCcw, X, Zap } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import {
  fetchBranchOptions,
  fetchPrepTickets,
  readStoredAuth,
  updatePrepTicketItemStatus,
  updatePrepTicketPriority,
  updatePrepTicketStatus,
  type BranchOption,
  type PrepStation,
  type PrepTicket,
  type PrepTicketStatus
} from "../../shared/api/client";
import { StatusBadge } from "../../shared/components/StatusBadge";
import { TablePagination, usePaginatedRows } from "../../shared/components/TablePagination";

const fallbackBranches: BranchOption[] = [];

const statusTone: Record<PrepTicketStatus, "success" | "warning" | "danger" | "info"> = {
  new: "warning",
  accepted: "info",
  preparing: "info",
  ready: "success",
  served: "success",
  cancelled: "danger"
};

const statusLabel: Record<PrepTicketStatus, string> = {
  new: "New",
  accepted: "Accepted",
  preparing: "Preparing",
  ready: "Ready",
  served: "Served",
  cancelled: "Cancelled"
};

function elapsedMinutes(createdAt: string) {
  return Math.max(0, Math.round((Date.now() - new Date(createdAt).getTime()) / 60000));
}

export function KitchenDisplay() {
  const storedAuth = useMemo(() => readStoredAuth(), []);
  const stationUserId = storedAuth?.staff.id ?? "";
  const [tickets, setTickets] = useState<PrepTicket[]>([]);
  const [branches, setBranches] = useState<BranchOption[]>(fallbackBranches);
  const [branchId, setBranchId] = useState(storedAuth?.session.branchId ?? storedAuth?.staff.branchId ?? "");
  const [station, setStation] = useState<PrepStation | "All">("All");
  const [ticketStatusFilter, setTicketStatusFilter] = useState<PrepTicketStatus | "">("");
  const [alertsOpen, setAlertsOpen] = useState(false);
  const [status, setStatus] = useState("Ready");

  const counts = useMemo(() => {
    return tickets.reduce(
      (acc, ticket) => ({
        ...acc,
        [ticket.status]: acc[ticket.status] + 1
      }),
      { new: 0, accepted: 0, preparing: 0, ready: 0, served: 0, cancelled: 0 } as Record<PrepTicketStatus, number>
    );
  }, [tickets]);
  const stationLoad = useMemo(() => {
    return tickets.reduce(
      (acc, ticket) => ({
        ...acc,
        [ticket.station]: acc[ticket.station] + ticket.items.filter((item) => item.status !== "ready" && item.status !== "served" && item.status !== "cancelled").length
      }),
      { Kitchen: 0, Bar: 0, Counter: 0 } as Record<PrepStation, number>
    );
  }, [tickets]);
  const sortedTickets = useMemo(
    () =>
      [...tickets].sort((left, right) => {
        if (left.priority !== right.priority) return left.priority === "rush" ? -1 : 1;
        return new Date(left.createdAt).getTime() - new Date(right.createdAt).getTime();
      }),
    [tickets]
  );
  const rushCount = useMemo(() => tickets.filter((ticket) => ticket.priority === "rush" && ticket.status !== "served" && ticket.status !== "cancelled").length, [tickets]);
  const alertTickets = useMemo(
    () => tickets.filter((ticket) => ticket.status === "ready" || elapsedMinutes(ticket.createdAt) >= 15),
    [tickets]
  );
  const ticketPage = usePaginatedRows(sortedTickets, 8);
  const alertPage = usePaginatedRows(alertTickets, 8);

  async function loadTickets(nextStation = station, nextBranchId = branchId, nextStatusFilter = ticketStatusFilter) {
    try {
      const branchResponse = await fetchBranchOptions();
      setBranches(branchResponse.branches);

      if (!nextBranchId) {
        setTickets([]);
        setStatus("Select a branch to load prep tickets");
        return;
      }

      const response = await fetchPrepTickets(nextBranchId, nextStation, stationUserId, nextStatusFilter);
      setTickets(response.tickets);
      setStatus("Tickets synced");
    } catch (error) {
      setBranches(fallbackBranches);
      setTickets([]);
      setStatus(error instanceof Error ? error.message : "Unable to load tickets");
    }
  }

  useEffect(() => {
    void loadTickets();
  }, []);

  async function changeTicketStatus(ticketId: string, nextStatus: PrepTicketStatus) {
    if (!branchId) {
      setStatus("Select a branch before updating tickets");
      return;
    }

    setStatus(`Updating ${ticketId}...`);

    try {
      const ticket = tickets.find((item) => item.id === ticketId);
      const response = await updatePrepTicketStatus(ticketId, nextStatus, `Marked ${statusLabel[nextStatus]}`, branchId, stationUserId, ticket?.station ?? station);
      setTickets((current) => current.map((ticket) => (ticket.id === response.ticket.id ? response.ticket : ticket)));
      setStatus(`${response.ticket.id} is ${statusLabel[response.ticket.status]}`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Unable to update ticket");
    }
  }

  async function changeItemStatus(ticketId: string, itemId: string, nextStatus: Exclude<PrepTicketStatus, "served" | "cancelled">) {
    if (!branchId) {
      setStatus("Select a branch before updating ticket items");
      return;
    }

    setStatus(`Updating ${itemId}...`);

    try {
      const ticket = tickets.find((item) => item.id === ticketId);
      const response = await updatePrepTicketItemStatus(ticketId, itemId, nextStatus, `Item marked ${statusLabel[nextStatus]}`, branchId, stationUserId, ticket?.station ?? station);
      setTickets((current) => current.map((ticket) => (ticket.id === response.ticket.id ? response.ticket : ticket)));
      setStatus(`${response.ticket.id} item is ${statusLabel[nextStatus]}`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Unable to update item");
    }
  }

  async function changeTicketPriority(ticket: PrepTicket) {
    if (!branchId) {
      setStatus("Select a branch before updating priority");
      return;
    }

    const nextPriority = ticket.priority === "rush" ? "normal" : "rush";
    setStatus(`${nextPriority === "rush" ? "Escalating" : "Normalizing"} ${ticket.id}...`);

    try {
      const response = await updatePrepTicketPriority(ticket.id, nextPriority, `Marked ${nextPriority}`, branchId, stationUserId, ticket.station);
      setTickets((current) => current.map((item) => (item.id === response.ticket.id ? response.ticket : item)));
      setStatus(`${response.ticket.id} priority is ${response.ticket.priority}`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Unable to update priority");
    }
  }

  function changeStation(nextStation: PrepStation | "All") {
    setStation(nextStation);
    void loadTickets(nextStation, branchId, ticketStatusFilter);
  }

  function changeBranch(nextBranchId: string) {
    setBranchId(nextBranchId);
    void loadTickets(station, nextBranchId, ticketStatusFilter);
  }

  function changeStatusFilter(nextStatus: PrepTicketStatus | "") {
    setTicketStatusFilter(nextStatus);
    void loadTickets(station, branchId, nextStatus);
  }

  return (
    <div className="module-view">
      <div className="module-heading">
        <div>
          <p className="eyebrow">Real-time order routing</p>
          <h1>Kitchen and bar display</h1>
        </div>
        <div className="button-group">
          <label className="toolbar-select">
            Branch
            <select value={branchId} onChange={(event) => changeBranch(event.target.value)}>
              <option value="">Branch</option>
              {branches.map((branch) => (
                <option key={branch.id} value={branch.id}>{branch.name} - {branch.city}</option>
              ))}
            </select>
          </label>
          <label className="toolbar-select">
            Status
            <select value={ticketStatusFilter} onChange={(event) => changeStatusFilter(event.target.value as PrepTicketStatus | "")}>
              <option value="">Status</option>
              {(Object.keys(statusLabel) as PrepTicketStatus[]).map((item) => (
                <option key={item} value={item}>{statusLabel[item]}</option>
              ))}
            </select>
          </label>
          <button className="secondary-button" onClick={() => void loadTickets()}><RefreshCcw size={18} /> Sync</button>
          <button className="primary-button" onClick={() => setAlertsOpen(true)}><BellRing size={18} /> Station alerts</button>
        </div>
      </div>
      <section className="stats-grid">
        <article className="stat-card">
          <div className="stat-card-top"><span>New</span></div>
          <strong>{counts.new}</strong>
          <small>{status}</small>
        </article>
        <article className="stat-card">
          <div className="stat-card-top"><span>Preparing</span></div>
          <strong>{counts.preparing}</strong>
          <small>Active production</small>
        </article>
        <article className="stat-card">
          <div className="stat-card-top"><span>Ready</span></div>
          <strong>{counts.ready}</strong>
          <small>Notify waiters</small>
        </article>
        <article className="stat-card">
          <div className="stat-card-top"><span>Rush</span><Zap size={20} /></div>
          <strong>{rushCount}</strong>
          <small>Priority tickets</small>
        </article>
        <article className="stat-card">
          <div className="stat-card-top"><span>Station load</span></div>
          <strong>{station === "All" ? stationLoad.Kitchen + stationLoad.Bar + stationLoad.Counter : stationLoad[station]}</strong>
          <small>Open prep items</small>
        </article>
      </section>
      <div className="station-tabs">
        {(["All", "Kitchen", "Bar", "Counter"] as Array<PrepStation | "All">).map((item) => (
          <button className={station === item ? "active" : ""} key={item} onClick={() => changeStation(item)}>
            {item}
          </button>
        ))}
      </div>
      <section className="ticket-grid">
        {tickets.length === 0 ? (
          <div className="empty-state">No prep tickets for this station.</div>
        ) : ticketPage.pageRows.map((ticket, index) => (
          <article className={`ticket-card ${ticket.priority === "rush" ? "ticket-rush" : ""}`} key={ticket.id}>
            <div className="panel-header">
              <div>
                <h2><span className="number-cell">{ticketPage.startIndex + index + 1}</span>{ticket.id}</h2>
                <span>{ticket.tableLabel} - {ticket.station} - {ticket.serviceType.replace("_", " ")}</span>
                {ticket.tableOrderId ? <small>{ticket.tableOrderId}</small> : null}
              </div>
              <div className="ticket-heading-actions">
                {ticket.priority === "rush" ? <StatusBadge label="Rush" tone="danger" /> : null}
                <StatusBadge
                  label={statusLabel[ticket.status]}
                  tone={statusTone[ticket.status]}
                />
              </div>
            </div>
            <ul>
              {ticket.items.map((item) => (
                <li key={item.id}>
                  <div>
                    <strong>{item.quantity}x {item.productName}</strong>
                    {item.modifiers.length ? <span>{item.modifiers.join(", ")}</span> : null}
                    {item.note ? <em>{item.note}</em> : null}
                  </div>
                  <div className="ticket-item-actions">
                    <StatusBadge label={statusLabel[item.status]} tone={statusTone[item.status]} />
                    <button onClick={() => changeItemStatus(ticket.id, item.id, "preparing")} disabled={item.status === "preparing" || item.status === "ready"}>Prep</button>
                    <button onClick={() => changeItemStatus(ticket.id, item.id, "ready")} disabled={item.status === "ready"}><CheckCircle2 size={15} /></button>
                  </div>
                </li>
              ))}
            </ul>
            <div className="ticket-footer">
              <span><Clock size={14} /> {elapsedMinutes(ticket.createdAt)}m</span>
              <div className="ticket-actions">
                <button onClick={() => changeTicketStatus(ticket.id, "accepted")} disabled={ticket.status !== "new"}>Accept</button>
                <button onClick={() => changeTicketStatus(ticket.id, "preparing")} disabled={ticket.status === "ready" || ticket.status === "served"}>Prep</button>
                <button onClick={() => changeTicketPriority(ticket)} disabled={ticket.status === "served" || ticket.status === "cancelled"}>
                  <Zap size={16} /> {ticket.priority === "rush" ? "Normal" : "Rush"}
                </button>
                <button onClick={() => changeTicketStatus(ticket.id, "ready")} disabled={ticket.status === "ready" || ticket.status === "served"}>
                  <CheckCircle2 size={16} /> Ready
                </button>
                <button onClick={() => changeTicketStatus(ticket.id, "served")} disabled={ticket.status !== "ready"}>
                  Served
                </button>
                <button onClick={() => changeTicketStatus(ticket.id, "cancelled")} disabled={ticket.status === "served" || ticket.status === "cancelled"}>
                  Cancel
                </button>
              </div>
            </div>
          </article>
        ))}
      </section>
      {tickets.length > 0 ? (
        <TablePagination
          page={ticketPage.page}
          pageCount={ticketPage.pageCount}
          pageSize={ticketPage.pageSize}
          totalRows={ticketPage.totalRows}
          startIndex={ticketPage.startIndex}
          visibleCount={ticketPage.pageRows.length}
          onPageChange={ticketPage.setPage}
          onPageSizeChange={ticketPage.setPageSize}
        />
      ) : null}
      {alertsOpen ? (
        <div className="modal-backdrop" role="presentation" onMouseDown={() => setAlertsOpen(false)}>
          <section className="modal-panel terminal-modal" role="dialog" aria-modal="true" aria-labelledby="station-alerts-title" onMouseDown={(event) => event.stopPropagation()}>
            <div className="modal-header">
              <div>
                <p className="eyebrow">Kitchen controls</p>
                <h2 id="station-alerts-title">Station alerts</h2>
              </div>
              <button className="icon-button" onClick={() => setAlertsOpen(false)} aria-label="Close station alerts"><X size={18} /></button>
            </div>
            <div className="station-alert-panel">
              <div className="discount-preview">
                <span>{alertTickets.length} active alerts</span>
                <strong>{counts.ready} ready</strong>
                <small>{stationLoad.Kitchen} kitchen - {stationLoad.Bar} bar - {stationLoad.Counter} counter open prep items</small>
              </div>
              <div className="stack">
                {alertTickets.length === 0 ? (
                  <div className="empty-state">No station alerts right now.</div>
                ) : (
                  alertPage.pageRows.map((ticket, index) => (
                    <div className="list-row" key={ticket.id}>
                      <div>
                        <strong><span className="number-cell">{alertPage.startIndex + index + 1}</span>{ticket.id} - {ticket.tableLabel}</strong>
                        <span>{ticket.station} - {ticket.tableOrderId ?? "walk-in"} - {elapsedMinutes(ticket.createdAt)}m - {ticket.items.length} items</span>
                      </div>
                      <StatusBadge label={statusLabel[ticket.status]} tone={statusTone[ticket.status]} />
                    </div>
                  ))
                )}
              </div>
              {alertTickets.length > 0 ? (
                <TablePagination
                  page={alertPage.page}
                  pageCount={alertPage.pageCount}
                  pageSize={alertPage.pageSize}
                  totalRows={alertPage.totalRows}
                  startIndex={alertPage.startIndex}
                  visibleCount={alertPage.pageRows.length}
                  onPageChange={alertPage.setPage}
                  onPageSizeChange={alertPage.setPageSize}
                />
              ) : null}
            </div>
          </section>
        </div>
      ) : null}
    </div>
  );
}
