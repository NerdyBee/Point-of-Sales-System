import { Check, ClipboardCheck, Plus, RefreshCcw, Search, ShieldAlert, X } from "lucide-react";
import { FormEvent, useEffect, useMemo, useState } from "react";
import {
  createApproval,
  decideApproval,
  fetchApprovals,
  fetchBranchOptions,
  readStoredAuth,
  type ApprovalPayload,
  type ApprovalRequest,
  type ApprovalStatus,
  type ApprovalType,
  type BranchOption
} from "../../shared/api/client";
import { StatusBadge } from "../../shared/components/StatusBadge";
import { TablePagination, usePaginatedRows } from "../../shared/components/TablePagination";
import { useTenantSettings } from "../../shared/hooks/useTenantSettings";

const approvalTypes: ApprovalType[] = ["discount", "void", "refund", "cash_movement", "register_close", "stock_adjustment", "customer_credit", "expense"];
const approvalStatuses: ApprovalStatus[] = ["pending", "approved", "rejected", "applied"];
type ApprovalSourceModule = "sales" | "salesHistory" | "inventory" | "registers" | "customers" | "expenses";
const fallbackBranches: BranchOption[] = [];

function blankApproval(branchId = ""): ApprovalPayload {
  return {
    branchId,
    type: "" as ApprovalType,
    entityType: "",
    entityId: "",
    amount: 0,
    reason: ""
  };
}

function statusTone(status: ApprovalStatus): "success" | "warning" | "danger" | "info" {
  if (status === "approved") return "success";
  if (status === "rejected") return "danger";
  if (status === "applied") return "info";
  return "warning";
}

function formatLabel(value: string) {
  return value.replaceAll("_", " ");
}

function sourceLabel(approval: ApprovalRequest) {
  if (approval.entityType === "saleDraft") return "POS terminal";
  if (approval.entityType === "sale") return "Sales history";
  if (approval.entityType === "registerShift") return "Register";
  if (approval.entityType === "productStock" || approval.entityType === "stockCount") return "Inventory";
  if (approval.entityType === "customerAccount") return "Customers";
  if (approval.entityType === "expense") return "Expenses";
  return approval.entityType;
}

function sourceModule(approval: ApprovalRequest): ApprovalSourceModule {
  if (approval.entityType === "saleDraft") return "sales";
  if (approval.entityType === "sale") return "salesHistory";
  if (approval.entityType === "registerShift") return "registers";
  if (approval.entityType === "productStock" || approval.entityType === "stockCount") return "inventory";
  if (approval.entityType === "expense") return "expenses";
  return "customers";
}

function priorityLabel(amount: number) {
  if (amount >= 100000) return "High";
  if (amount >= 50000) return "Medium";
  return "Normal";
}

function priorityTone(amount: number): "success" | "warning" | "danger" | "info" {
  if (amount >= 100000) return "danger";
  if (amount >= 50000) return "warning";
  return "info";
}

function ageLabel(createdAt: string) {
  const ageMinutes = Math.max(Math.floor((Date.now() - new Date(createdAt).getTime()) / 60000), 0);
  if (ageMinutes < 1) return "Just now";
  if (ageMinutes < 60) return `${ageMinutes} min`;
  return `${Math.floor(ageMinutes / 60)} hr`;
}

interface ApprovalsViewProps {
  onOpenSource?: (module: ApprovalSourceModule, approval: ApprovalRequest) => void;
}

export function ApprovalsView({ onOpenSource }: ApprovalsViewProps) {
  const storedAuth = useMemo(() => readStoredAuth(), []);
  const initialBranchId = storedAuth?.session.branchId ?? storedAuth?.staff.branchId ?? "";
  const activeUserId = storedAuth?.staff.id ?? "";
  const [approvals, setApprovals] = useState<ApprovalRequest[]>([]);
  const [branches, setBranches] = useState<BranchOption[]>(fallbackBranches);
  const [branchId, setBranchId] = useState(initialBranchId);
  const [selectedApproval, setSelectedApproval] = useState<ApprovalRequest | null>(null);
  const [statusFilter, setStatusFilter] = useState<ApprovalStatus | "all" | "">("pending");
  const [typeFilter, setTypeFilter] = useState<ApprovalType | "all" | "">("");
  const [sourceFilter, setSourceFilter] = useState("");
  const [priorityFilter, setPriorityFilter] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [query, setQuery] = useState("");
  const [decisionNote, setDecisionNote] = useState("Manager reviewed request");
  const [requestModalOpen, setRequestModalOpen] = useState(false);
  const [requestForm, setRequestForm] = useState<ApprovalPayload>(blankApproval(initialBranchId));
  const [status, setStatus] = useState("Ready");
  const { displayMoney } = useTenantSettings();

  const filteredApprovals = useMemo(() => {
    const needle = query.toLowerCase();
    return approvals.filter((approval) => {
      const haystack = `${approval.type} ${approval.entityType} ${approval.entityId} ${approval.reason} ${approval.requestedBy}`.toLowerCase();
      const matchesQuery = haystack.includes(needle);
      const matchesSource = !sourceFilter || sourceLabel(approval) === sourceFilter;
      const matchesPriority = !priorityFilter || priorityLabel(approval.amount) === priorityFilter;
      return matchesQuery && matchesSource && matchesPriority;
    });
  }, [approvals, priorityFilter, query, sourceFilter]);
  const sourceOptions = useMemo(() => Array.from(new Set(approvals.map(sourceLabel))).sort(), [approvals]);
  const approvalPage = usePaginatedRows(filteredApprovals, 10);
  const selectedBranch = useMemo(() => branches.find((branch) => branch.id === branchId) ?? null, [branchId, branches]);
  const branchLocked = Boolean(branchId && branches.length === 1);
  const pendingCount = useMemo(() => approvals.filter((approval) => approval.status === "pending").length, [approvals]);
  const decidedToday = useMemo(() => {
    const today = new Date().toISOString().slice(0, 10);
    return approvals.filter((approval) => {
      const decidedAt = approval.decidedAt ?? (approval.status === "applied" ? approval.createdAt : "");
      return decidedAt.startsWith(today);
    }).length;
  }, [approvals]);
  const pendingValue = useMemo(
    () => approvals.filter((approval) => approval.status === "pending").reduce((sum, approval) => sum + approval.amount, 0),
    [approvals]
  );
  const highPriorityCount = useMemo(() => approvals.filter((approval) => approval.status === "pending" && approval.amount >= 100000).length, [approvals]);

  async function loadApprovals(nextStatus = statusFilter, nextType = typeFilter, nextBranchId = branchId, nextStartDate = startDate, nextEndDate = endDate) {
    setStatus("Syncing approvals...");

    try {
      const branchResponse = await fetchBranchOptions();
      setBranches(branchResponse.branches);

      if (!nextBranchId) {
        setApprovals([]);
        setSelectedApproval(null);
        setStatus("Select a branch to load approvals");
        return;
      }

      const response = await fetchApprovals(nextStatus || "all", nextType || "all", nextBranchId, activeUserId, nextStartDate, nextEndDate);
      setApprovals(response.approvals);
      setSelectedApproval((current) => response.approvals.find((approval) => approval.id === current?.id) ?? response.approvals[0] ?? null);
      setStatus("Approvals synced");
    } catch (error) {
      setBranches(fallbackBranches);
      setApprovals([]);
      setSelectedApproval(null);
      setStatus(error instanceof Error ? error.message : "Unable to load approvals");
    }
  }

  useEffect(() => {
    void loadApprovals();
  }, []);

  useEffect(() => {
    setDecisionNote(selectedApproval?.status === "pending" ? "Manager reviewed request" : selectedApproval?.decisionNote ?? "Manager reviewed request");
  }, [selectedApproval?.id]);

  function approvalMatchesFilters(approval: ApprovalRequest, nextStatus = statusFilter, nextType = typeFilter) {
    const statusMatches = !nextStatus || nextStatus === "all" || approval.status === nextStatus;
    const typeMatches = !nextType || nextType === "all" || approval.type === nextType;
    return statusMatches && typeMatches;
  }

  function updateRequestForm<K extends keyof ApprovalPayload>(key: K, value: ApprovalPayload[K]) {
    setRequestForm((current) => ({ ...current, [key]: value }));
  }

  function closeRequestModal() {
    setRequestModalOpen(false);
    setRequestForm(blankApproval(branchId));
  }

  function changeBranch(nextBranchId: string) {
    setBranchId(nextBranchId);
    setRequestForm(blankApproval(nextBranchId));
    void loadApprovals(statusFilter, typeFilter, nextBranchId);
  }

  function clearQueueFilters() {
    setQuery("");
    setSourceFilter("");
    setPriorityFilter("");
    setStartDate("");
    setEndDate("");
    void loadApprovals(statusFilter, typeFilter, branchId, "", "");
  }

  async function submitApproval(event: FormEvent) {
    event.preventDefault();

    if (!requestForm.type) {
      setStatus("Select an approval type");
      return;
    }

    if (!requestForm.branchId) {
      setStatus("Select a branch before requesting approval");
      return;
    }

    if (!requestForm.entityType.trim() || !requestForm.entityId.trim()) {
      setStatus("Enter the source entity for this approval");
      return;
    }

    setStatus("Creating approval request...");

    try {
      const response = await createApproval(requestForm);
      setApprovals((current) => [response.approval, ...current]);
      setSelectedApproval(response.approval);
      setStatus("Approval request created");
      closeRequestModal();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Unable to create approval request");
    }
  }

  async function handleDecision(decision: "approved" | "rejected") {
    if (!selectedApproval) return;
    if (!branchId) {
      setStatus("Select a branch before deciding approvals");
      return;
    }
    setStatus(decision === "approved" ? "Approving request..." : "Rejecting request...");

    try {
      const response = await decideApproval(selectedApproval.id, decision, decisionNote, branchId, activeUserId);
      setApprovals((current) => {
        const nextApprovals = current
          .map((approval) => (approval.id === response.approval.id ? response.approval : approval))
          .filter((approval) => approvalMatchesFilters(approval));
        setSelectedApproval(approvalMatchesFilters(response.approval) ? response.approval : nextApprovals[0] ?? null);
        return nextApprovals;
      });
      setStatus(decision === "approved" ? "Request approved" : "Request rejected");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Unable to decide approval");
    }
  }

  return (
    <div className="module-view">
      <div className="module-heading">
        <div>
          <p className="eyebrow">Manager controls and sensitive actions</p>
          <h1>Approvals</h1>
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
                <option value="">Branch</option>
                {branches.map((branch) => (
                  <option key={branch.id} value={branch.id}>{branch.name} - {branch.city}</option>
                ))}
              </select>
            )}
          </label>
          <button className="secondary-button" onClick={() => loadApprovals()}><RefreshCcw size={18} /> Sync</button>
          <button className="primary-button" onClick={() => setRequestModalOpen(true)}><Plus size={18} /> New request</button>
        </div>
      </div>

      <section className="stats-grid">
        <article className="stat-card stat-card-dark">
          <div className="stat-card-top"><span>Pending approvals</span><ClipboardCheck size={20} /></div>
          <strong>{pendingCount}</strong>
          <small>{status}</small>
        </article>
        <article className="stat-card">
          <div className="stat-card-top"><span>Pending value</span></div>
          <strong>{displayMoney(pendingValue)}</strong>
          <small>Requests awaiting manager action</small>
        </article>
        <article className="stat-card">
          <div className="stat-card-top"><span>Decided</span></div>
          <strong>{decidedToday}</strong>
          <small>Approved or rejected in queue</small>
        </article>
        <article className="stat-card">
          <div className="stat-card-top"><span>High priority</span><ShieldAlert size={20} /></div>
          <strong>{highPriorityCount}</strong>
          <small>Pending requests over threshold</small>
        </article>
      </section>

      <div className="approvals-workflow">
        <section className="panel">
          <div className="panel-header">
            <h2>Approval queue</h2>
            <div className="button-group">
              <select className="compact-select" value={statusFilter} onChange={(event) => {
                const nextStatus = event.target.value as ApprovalStatus | "all" | "";
                setStatusFilter(nextStatus);
                void loadApprovals(nextStatus, typeFilter);
              }}>
                <option value="">Status</option>
                {approvalStatuses.map((option) => <option key={option} value={option}>{formatLabel(option)}</option>)}
              </select>
              <select className="compact-select" value={typeFilter} onChange={(event) => {
                const nextType = event.target.value as ApprovalType | "all" | "";
                setTypeFilter(nextType);
                void loadApprovals(statusFilter, nextType);
              }}>
                <option value="">Type</option>
                {approvalTypes.map((option) => <option key={option} value={option}>{formatLabel(option)}</option>)}
              </select>
            </div>
          </div>
          <div className="search-box approvals-search">
            <Search size={16} />
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search approvals" />
            {query ? (
              <button type="button" onClick={() => setQuery("")} aria-label="Clear approval search"><X size={14} /></button>
            ) : null}
          </div>
          <div className="table-toolbar approval-filter-toolbar">
            <select value={sourceFilter} onChange={(event) => setSourceFilter(event.target.value)}>
              <option value="">Source</option>
              {sourceOptions.map((source) => <option key={source} value={source}>{source}</option>)}
            </select>
            <select value={priorityFilter} onChange={(event) => setPriorityFilter(event.target.value)}>
              <option value="">Priority</option>
              <option value="High">High</option>
              <option value="Medium">Medium</option>
              <option value="Normal">Normal</option>
            </select>
            <div className="date-range-filter approval-date-range-filter">
              <label>
                <span>Start</span>
                <input type="date" value={startDate} onChange={(event) => setStartDate(event.target.value)} />
              </label>
              <label>
                <span>End</span>
                <input type="date" value={endDate} onChange={(event) => setEndDate(event.target.value)} />
              </label>
            </div>
            <button className="secondary-button" type="button" onClick={() => loadApprovals(statusFilter, typeFilter, branchId, startDate, endDate)}>Apply dates</button>
            {(query || sourceFilter || priorityFilter || startDate || endDate) ? (
              <button className="secondary-button" type="button" onClick={clearQueueFilters}>Clear filters</button>
            ) : null}
          </div>
          <div className="approval-list">
            {approvalPage.pageRows.length === 0 ? (
              <div className="empty-state">No approvals match this queue.</div>
            ) : (
              approvalPage.pageRows.map((approval, index) => (
                <button className={selectedApproval?.id === approval.id ? "approval-row approval-row-active" : "approval-row"} key={approval.id} onClick={() => setSelectedApproval(approval)}>
                  <div>
                    <strong><span className="number-cell">{approvalPage.startIndex + index + 1}</span>{formatLabel(approval.type)}</strong>
                    <span>{sourceLabel(approval)} - {approval.entityId}</span>
                    <small>{approval.reason}</small>
                  </div>
                  <b>{displayMoney(approval.amount)}</b>
                  <div className="approval-row-badges">
                    <StatusBadge label={approval.status} tone={statusTone(approval.status)} />
                    <StatusBadge label={priorityLabel(approval.amount)} tone={priorityTone(approval.amount)} />
                    <span>{ageLabel(approval.createdAt)}</span>
                  </div>
                </button>
              ))
            )}
          </div>
          <TablePagination
            page={approvalPage.page}
            pageCount={approvalPage.pageCount}
            pageSize={approvalPage.pageSize}
            totalRows={approvalPage.totalRows}
            startIndex={approvalPage.startIndex}
            visibleCount={approvalPage.pageRows.length}
            onPageChange={approvalPage.setPage}
            onPageSizeChange={approvalPage.setPageSize}
          />
        </section>

        <aside className="panel approval-detail-panel">
          <div className="panel-header">
            <h2>Request detail</h2>
            <span>{selectedApproval?.id ?? "No selection"}</span>
          </div>
          {selectedApproval ? (
            <div className="approval-detail">
              <StatusBadge label={selectedApproval.status} tone={statusTone(selectedApproval.status)} />
              <strong>{formatLabel(selectedApproval.type)}</strong>
              <span>{selectedApproval.reason}</span>
              <dl>
                <div><dt>Source</dt><dd>{sourceLabel(selectedApproval)}</dd></div>
                <div><dt>Entity</dt><dd>{selectedApproval.entityType} - {selectedApproval.entityId}</dd></div>
                <div><dt>Amount</dt><dd>{displayMoney(selectedApproval.amount)}</dd></div>
                <div><dt>Priority</dt><dd>{priorityLabel(selectedApproval.amount)}</dd></div>
                <div><dt>Requested by</dt><dd>{selectedApproval.requestedBy}</dd></div>
                <div><dt>Requested</dt><dd>{new Date(selectedApproval.createdAt).toLocaleString()}</dd></div>
                <div><dt>Age</dt><dd>{ageLabel(selectedApproval.createdAt)}</dd></div>
                <div><dt>Decided by</dt><dd>{selectedApproval.decidedBy ?? "Pending"}</dd></div>
                <div><dt>Decision</dt><dd>{selectedApproval.decisionNote ?? "Pending manager decision"}</dd></div>
              </dl>
              <button className="secondary-button wide-field" disabled={selectedApproval.status === "pending" || selectedApproval.status === "rejected"} onClick={() => onOpenSource?.(sourceModule(selectedApproval), selectedApproval)}>
                Open {sourceLabel(selectedApproval)}
              </button>
              <label>
                Manager note
                <input value={decisionNote} onChange={(event) => setDecisionNote(event.target.value)} disabled={selectedApproval.status !== "pending"} />
              </label>
              <div className="approval-actions">
                <button className="primary-button" disabled={selectedApproval.status !== "pending"} onClick={() => handleDecision("approved")}><Check size={18} /> Approve</button>
                <button className="danger-button" disabled={selectedApproval.status !== "pending"} onClick={() => handleDecision("rejected")}><X size={18} /> Reject</button>
              </div>
            </div>
          ) : (
            <div className="empty-state">Select an approval request to inspect details.</div>
          )}
        </aside>
      </div>

      {requestModalOpen ? (
        <div className="modal-backdrop" role="presentation" onMouseDown={closeRequestModal}>
          <section className="modal-panel approval-modal" role="dialog" aria-modal="true" aria-labelledby="approval-modal-title" onMouseDown={(event) => event.stopPropagation()}>
            <div className="modal-header">
              <div>
                <p className="eyebrow">Sensitive action</p>
                <h2 id="approval-modal-title">New approval request</h2>
              </div>
              <button className="icon-button" onClick={closeRequestModal} aria-label="Close approval modal"><X size={18} /></button>
            </div>
            <form className="approval-form" onSubmit={submitApproval}>
              <label>
                Type
                <select value={requestForm.type} onChange={(event) => updateRequestForm("type", event.target.value as ApprovalType)}>
                  <option value="">Type</option>
                  {approvalTypes.map((type) => <option key={type} value={type}>{formatLabel(type)}</option>)}
                </select>
              </label>
              <label>
                Amount
                <input type="number" min={0} value={requestForm.amount} onChange={(event) => updateRequestForm("amount", Number(event.target.value))} />
              </label>
              <label>
                Entity type
                <input value={requestForm.entityType} onChange={(event) => updateRequestForm("entityType", event.target.value)} required />
              </label>
              <label>
                Entity ID
                <input value={requestForm.entityId} onChange={(event) => updateRequestForm("entityId", event.target.value)} required />
              </label>
              <label className="wide-field">
                Reason
                <input value={requestForm.reason} onChange={(event) => updateRequestForm("reason", event.target.value)} required />
              </label>
              <div className="form-summary">
                <span>{formatLabel(requestForm.type)}</span>
                <span>{displayMoney(requestForm.amount)}</span>
                <button className="primary-button" type="submit"><Check size={18} /> Request</button>
              </div>
            </form>
          </section>
        </div>
      ) : null}
    </div>
  );
}
