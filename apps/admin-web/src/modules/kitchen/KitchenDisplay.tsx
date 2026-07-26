import { BellRing, CheckCircle2, Clock, RefreshCcw, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import {
  fetchBranchOptions,
  fetchPrepTickets,
  readStoredAuth,
  updatePrepTicketItemStatus,
  updatePrepTicketStatus,
  type BranchOption,
  type PrepStation,
  type PrepTicket,
  type PrepTicketStatus
} from "../../shared/api/client";
import { StatusBadge } from "../../shared/components/StatusBadge";

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
  const alertTickets = useMemo(
    () => tickets.filter((ticket) => ticket.status === "ready" || elapsedMinutes(ticket.createdAt) >= 15),
    [tickets]
  );

  async function loadTickets(nextStation = station, nextBranchId = branchId) {
    try {
      const branchResponse = await fetchBranchOptions();
      setBranches(branchResponse.branches);

      if (!nextBranchId) {
        setTickets([]);
        setStatus("Select a branch to load prep tickets");
        return;
      }

      const response = await fetchPrepTickets(nextBranchId, nextStation, stationUserId);
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

  function changeStation(nextStation: PrepStation | "All") {
    setStation(nextStation);
    void loadTickets(nextStation);
  }

  function changeBranch(nextBranchId: string) {
    setBranchId(nextBranchId);
    void loadTickets(station, nextBranchId);
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
        ) : tickets.map((ticket) => (
          <article className="ticket-card" key={ticket.id}>
            <div className="panel-header">
              <div>
                <h2>{ticket.id}</h2>
                <span>{ticket.tableLabel} - {ticket.station} - {ticket.serviceType.replace("_", " ")}</span>
                {ticket.tableOrderId ? <small>{ticket.tableOrderId}</small> : null}
              </div>
              <StatusBadge
                label={statusLabel[ticket.status]}
                tone={statusTone[ticket.status]}
              />
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
                <button onClick={() => changeTicketStatus(ticket.id, "ready")} disabled={ticket.status === "ready" || ticket.status === "served"}>
                  <CheckCircle2 size={16} /> Ready
                </button>
                <button onClick={() => changeTicketStatus(ticket.id, "served")} disabled={ticket.status !== "ready"}>
                  Served
                </button>
              </div>
            </div>
          </article>
        ))}
      </section>
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
                  alertTickets.map((ticket) => (
                    <div className="list-row" key={ticket.id}>
                      <div>
                        <strong>{ticket.id} - {ticket.tableLabel}</strong>
                        <span>{ticket.station} - {ticket.tableOrderId ?? "walk-in"} - {elapsedMinutes(ticket.createdAt)}m - {ticket.items.length} items</span>
                      </div>
                      <StatusBadge label={statusLabel[ticket.status]} tone={statusTone[ticket.status]} />
                    </div>
                  ))
                )}
              </div>
            </div>
          </section>
        </div>
      ) : null}
    </div>
  );
}
