import { Building2, Check, MonitorCog, Pencil, Plus, RefreshCcw, Search, X } from "lucide-react";
import { FormEvent, useEffect, useMemo, useState } from "react";
import {
  createBranch,
  createTerminal,
  fetchBranches,
  fetchCurrentTenant,
  readStoredAuth,
  updateBranch,
  updateTerminal,
  type BranchPayload,
  type BranchProfile,
  type BranchStatus,
  type TerminalDevice,
  type TerminalPayload,
  type TerminalStatus,
  type TenantProfile
} from "../../shared/api/client";
import { StatusBadge } from "../../shared/components/StatusBadge";
import { TablePagination, usePaginatedRows } from "../../shared/components/TablePagination";

const fallbackTenant: Pick<TenantProfile, "branchLimit" | "settings" | "plan"> = {
  plan: "Free Trial",
  branchLimit: 0,
  settings: {
    businessName: "",
    defaultBranchId: "",
    defaultTaxRate: 0.075,
    serviceChargeEnabled: false,
    serviceChargeRate: 0,
    currency: "NGN",
    productCategories: [],
    receiptFooter: "",
    whatsappReceipts: false,
    paymentMethods: { cash: true, card: false, bankTransfer: false, mobileMoney: false },
    hardware: { printer: "", cashDrawer: false, barcodeScanner: false }
  }
};

const blankBranch: BranchPayload = {
  name: "",
  address: "",
  city: "",
  phone: "",
  status: "" as BranchStatus
};

const blankTerminal: TerminalPayload = {
  branchId: "",
  name: "",
  deviceCode: "",
  status: "" as TerminalStatus,
  appVersion: ""
};

function statusTone(status: BranchStatus | TerminalStatus): "success" | "warning" | "danger" | "info" {
  if (status === "active" || status === "online") return "success";
  if (status === "maintenance") return "warning";
  if (status === "paused") return "danger";
  return "info";
}

export function BranchesView() {
  const storedAuth = useMemo(() => readStoredAuth(), []);
  const activeUserId = storedAuth?.staff.id ?? "";
  const activeBranchId = storedAuth?.session.branchId ?? storedAuth?.staff.branchId ?? "";
  const canCreateBranches = storedAuth?.staff.role === "owner";
  const [branches, setBranches] = useState<BranchProfile[]>([]);
  const [terminals, setTerminals] = useState<TerminalDevice[]>([]);
  const [selectedBranch, setSelectedBranch] = useState<BranchProfile | null>(null);
  const [selectedTerminal, setSelectedTerminal] = useState<TerminalDevice | null>(null);
  const [branchForm, setBranchForm] = useState<BranchPayload>(blankBranch);
  const [terminalForm, setTerminalForm] = useState<TerminalPayload>(blankTerminal);
  const [branchModalOpen, setBranchModalOpen] = useState(false);
  const [terminalModalOpen, setTerminalModalOpen] = useState(false);
  const [branchQuery, setBranchQuery] = useState("");
  const [branchStatusFilter, setBranchStatusFilter] = useState<BranchStatus | "">("");
  const [terminalQuery, setTerminalQuery] = useState("");
  const [terminalStatusFilter, setTerminalStatusFilter] = useState<TerminalStatus | "">("");
  const [terminalBranchFilter, setTerminalBranchFilter] = useState("");
  const [tenantProfile, setTenantProfile] = useState<Pick<TenantProfile, "branchLimit" | "settings" | "plan">>(fallbackTenant);
  const [status, setStatus] = useState("Ready");

  const activeBranchCount = useMemo(() => branches.filter((branch) => branch.status === "active").length, [branches]);
  const onlineTerminalCount = useMemo(() => terminals.filter((terminal) => terminal.status === "online").length, [terminals]);
  const terminalCoverage = useMemo(() => new Set(terminals.map((terminal) => terminal.branchId)).size, [terminals]);
  const selectedBranchOnlineTerminals = useMemo(
    () => selectedBranch ? terminals.filter((terminal) => terminal.branchId === selectedBranch.id && terminal.status === "online").length : 0,
    [selectedBranch, terminals]
  );
  const filteredBranches = useMemo(() => {
    const query = branchQuery.trim().toLowerCase();
    return branches
      .filter((branch) => !branchStatusFilter || branch.status === branchStatusFilter)
      .filter((branch) => {
        if (!query) return true;
        return [branch.name, branch.address, branch.city, branch.phone].some((value) => value.toLowerCase().includes(query));
      });
  }, [branchQuery, branchStatusFilter, branches]);
  const filteredTerminals = useMemo(() => {
    const query = terminalQuery.trim().toLowerCase();
    return terminals
      .filter((terminal) => !terminalStatusFilter || terminal.status === terminalStatusFilter)
      .filter((terminal) => !terminalBranchFilter || terminal.branchId === terminalBranchFilter)
      .filter((terminal) => {
        if (!query) return true;
        return [terminal.name, terminal.deviceCode, terminal.appVersion, branchName(terminal.branchId)].some((value) => value.toLowerCase().includes(query));
      });
  }, [terminalQuery, terminalStatusFilter, terminalBranchFilter, terminals, branches]);
  const branchPage = usePaginatedRows(filteredBranches, 10);
  const terminalPage = usePaginatedRows(filteredTerminals, 8);

  async function loadBranches() {
    setStatus("Syncing branches...");

    try {
      const [response, tenantResponse] = await Promise.all([fetchBranches(), fetchCurrentTenant(activeUserId, activeBranchId || undefined)]);
      setBranches(response.branches);
      setTerminals(response.terminals);
      setTenantProfile(tenantResponse.tenant);
      setStatus("Branches synced");
    } catch (error) {
      setBranches([]);
      setTerminals([]);
      setTenantProfile(fallbackTenant);
      setStatus(error instanceof Error ? error.message : "Unable to load branches");
    }
  }

  useEffect(() => {
    void loadBranches();
  }, []);

  function openBranchModal(branch?: BranchProfile) {
    setSelectedBranch(branch ?? null);
    setBranchForm(branch ? {
      name: branch.name,
      address: branch.address,
      city: branch.city,
      phone: branch.phone,
      status: branch.status
    } : blankBranch);
    setBranchModalOpen(true);
  }

  function openTerminalModal(terminal?: TerminalDevice, branchId = "") {
    setSelectedTerminal(terminal ?? null);
    setTerminalForm(terminal ? {
      branchId: terminal.branchId,
      name: terminal.name,
      deviceCode: terminal.deviceCode,
      status: terminal.status,
      appVersion: terminal.appVersion
    } : { ...blankTerminal, branchId });
    setTerminalModalOpen(true);
  }

  function closeBranchModal() {
    setBranchModalOpen(false);
    setSelectedBranch(null);
    setBranchForm(blankBranch);
  }

  function closeTerminalModal() {
    setTerminalModalOpen(false);
    setSelectedTerminal(null);
    setTerminalForm(blankTerminal);
  }

  function updateBranchForm<K extends keyof BranchPayload>(key: K, value: BranchPayload[K]) {
    setBranchForm((current) => ({ ...current, [key]: value }));
  }

  function updateTerminalForm<K extends keyof TerminalPayload>(key: K, value: TerminalPayload[K]) {
    setTerminalForm((current) => ({ ...current, [key]: value }));
  }

  function applyBranchUpdate(branch: BranchProfile) {
    setBranches((current) => current.some((item) => item.id === branch.id)
      ? current.map((item) => (item.id === branch.id ? branch : item))
      : [branch, ...current]);
  }

  function applyTerminalUpdate(terminal: TerminalDevice) {
    setTerminals((current) => current.some((item) => item.id === terminal.id)
      ? current.map((item) => (item.id === terminal.id ? terminal : item))
      : [terminal, ...current]);
  }

  async function saveBranch(event: FormEvent) {
    event.preventDefault();

    if (!branchForm.status) {
      setStatus("Select a branch status");
      return;
    }

    const activatingBranch = branchForm.status === "active" && selectedBranch?.status !== "active";
    if (tenantProfile.branchLimit > 0 && activatingBranch && activeBranchCount >= tenantProfile.branchLimit) {
      setStatus("Active branch limit reached for this plan");
      return;
    }

    if (selectedBranch?.id === tenantProfile.settings.defaultBranchId && branchForm.status === "paused") {
      setStatus("Default branch cannot be paused");
      return;
    }

    if (selectedBranch && selectedBranch.status === "active" && branchForm.status === "paused" && selectedBranchOnlineTerminals > 0) {
      setStatus("Move online terminals offline before pausing this branch");
      return;
    }

    setStatus(selectedBranch ? "Updating branch..." : "Creating branch...");

    try {
      const response = selectedBranch ? await updateBranch(selectedBranch.id, branchForm) : await createBranch(branchForm, activeBranchId);
      applyBranchUpdate(response.branch);
      setStatus(selectedBranch ? "Branch updated" : "Branch created");
      closeBranchModal();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Unable to save branch");
    }
  }

  async function saveTerminal(event: FormEvent) {
    event.preventDefault();

    if (!terminalForm.branchId) {
      setStatus("Select a branch");
      return;
    }

    if (!terminalForm.status) {
      setStatus("Select a terminal status");
      return;
    }

    const assignedBranch = branches.find((branch) => branch.id === terminalForm.branchId);
    if (terminalForm.status === "online" && assignedBranch?.status !== "active") {
      setStatus("Online terminals require an active branch");
      return;
    }

    setStatus(selectedTerminal ? "Updating terminal..." : "Provisioning terminal...");

    try {
      const response = selectedTerminal ? await updateTerminal(selectedTerminal.id, terminalForm, selectedTerminal.branchId) : await createTerminal(terminalForm);
      applyTerminalUpdate(response.terminal);
      setStatus(selectedTerminal ? "Terminal updated" : "Terminal provisioned");
      closeTerminalModal();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Unable to save terminal");
    }
  }

  function branchTerminalCount(branchId: string) {
    return terminals.filter((terminal) => terminal.branchId === branchId).length;
  }

  function branchName(branchId: string) {
    return branches.find((branch) => branch.id === branchId)?.name ?? branchId;
  }

  function clearBranchFilters() {
    setBranchQuery("");
    setBranchStatusFilter("");
  }

  function clearTerminalFilters() {
    setTerminalQuery("");
    setTerminalBranchFilter("");
    setTerminalStatusFilter("");
  }

  return (
    <div className="module-view">
      <div className="module-heading">
        <div>
          <p className="eyebrow">Locations and terminal provisioning</p>
          <h1>Branches</h1>
        </div>
        <div className="button-group">
          <button className="secondary-button" onClick={loadBranches}><RefreshCcw size={18} /> Sync</button>
          <button className="secondary-button" onClick={() => openTerminalModal()}><MonitorCog size={18} /> Add terminal</button>
          {canCreateBranches ? <button className="primary-button" onClick={() => openBranchModal()}><Plus size={18} /> Add branch</button> : null}
        </div>
      </div>

      <section className="stats-grid">
        <article className="stat-card stat-card-dark">
          <div className="stat-card-top"><span>Active branches</span><Building2 size={20} /></div>
          <strong>{activeBranchCount}/{tenantProfile.branchLimit}</strong>
          <small>{tenantProfile.plan} plan</small>
        </article>
        <article className="stat-card">
          <div className="stat-card-top"><span>Terminals</span><MonitorCog size={20} /></div>
          <strong>{terminals.length}</strong>
          <small>{onlineTerminalCount} online</small>
        </article>
        <article className="stat-card">
          <div className="stat-card-top"><span>Coverage</span></div>
          <strong>{terminalCoverage}/{branches.length}</strong>
          <small>Branches with terminals</small>
        </article>
      </section>

      <div className="branches-workflow">
        <section className="panel">
          <div className="panel-header">
            <h2>Branch directory</h2>
            <span>{filteredBranches.length} of {branches.length} locations</span>
          </div>
          <div className="table-toolbar branch-filter-toolbar">
            <div className="search-box compact-search">
              <Search size={16} />
              <input value={branchQuery} onChange={(event) => setBranchQuery(event.target.value)} placeholder="Search branch, city or phone" />
              {branchQuery ? (
                <button type="button" onClick={() => setBranchQuery("")} aria-label="Clear branch search"><X size={14} /></button>
              ) : null}
            </div>
            <select value={branchStatusFilter} onChange={(event) => setBranchStatusFilter(event.target.value as BranchStatus | "")}>
              <option value="">Branch status</option>
              <option value="active">Active</option>
              <option value="paused">Paused</option>
            </select>
            {(branchQuery || branchStatusFilter) ? (
              <button className="secondary-button" type="button" onClick={clearBranchFilters}>Clear filters</button>
            ) : null}
          </div>
          <div className="table-wrap">
            <table>
              <thead><tr><th>#</th><th>Branch</th><th>City</th><th>Phone</th><th>Terminals</th><th>Status</th><th>Actions</th></tr></thead>
              <tbody>
                {branchPage.pageRows.length === 0 ? (
                  <tr><td colSpan={7}>No branches found.</td></tr>
                ) : branchPage.pageRows.map((branch, index) => (
                  <tr key={branch.id}>
                    <td className="number-cell">{branchPage.startIndex + index + 1}</td>
                    <td><strong>{branch.name}</strong><br /><small>{branch.address}</small></td>
                    <td>{branch.city}</td>
                    <td>{branch.phone}</td>
                    <td>{branchTerminalCount(branch.id)}</td>
                    <td>
                      <StatusBadge label={branch.id === tenantProfile.settings.defaultBranchId ? `${branch.status} default` : branch.status} tone={statusTone(branch.status)} />
                    </td>
                    <td className="row-actions">
                      <button onClick={() => openBranchModal(branch)} aria-label={`Edit ${branch.name}`}><Pencil size={16} /></button>
                      <button onClick={() => openTerminalModal(undefined, branch.id)}><MonitorCog size={16} /> Terminal</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <TablePagination
            page={branchPage.page}
            pageCount={branchPage.pageCount}
            pageSize={branchPage.pageSize}
            totalRows={branchPage.totalRows}
            startIndex={branchPage.startIndex}
            visibleCount={branchPage.pageRows.length}
            onPageChange={branchPage.setPage}
            onPageSizeChange={branchPage.setPageSize}
          />
        </section>

        <section className="panel">
          <div className="panel-header">
            <h2>Terminal fleet</h2>
            <span>{filteredTerminals.length} devices</span>
          </div>
          <div className="table-toolbar terminal-filter-toolbar">
            <div className="search-box compact-search">
              <Search size={16} />
              <input value={terminalQuery} onChange={(event) => setTerminalQuery(event.target.value)} placeholder="Search terminal, device or version" />
              {terminalQuery ? (
                <button type="button" onClick={() => setTerminalQuery("")} aria-label="Clear terminal search"><X size={14} /></button>
              ) : null}
            </div>
            <select value={terminalBranchFilter} onChange={(event) => setTerminalBranchFilter(event.target.value)}>
              <option value="">Terminal branch</option>
              {branches.map((branch) => <option key={branch.id} value={branch.id}>{branch.name}</option>)}
            </select>
            <select value={terminalStatusFilter} onChange={(event) => setTerminalStatusFilter(event.target.value as TerminalStatus | "")}>
              <option value="">Terminal status</option>
              <option value="online">Online</option>
              <option value="offline">Offline</option>
              <option value="maintenance">Maintenance</option>
            </select>
            {(terminalQuery || terminalBranchFilter || terminalStatusFilter) ? (
              <button className="secondary-button" type="button" onClick={clearTerminalFilters}>Clear filters</button>
            ) : null}
          </div>
          <div className="table-wrap">
            <table>
              <thead><tr><th>#</th><th>Terminal</th><th>Branch</th><th>Device code</th><th>Version</th><th>Last seen</th><th>Status</th><th>Actions</th></tr></thead>
              <tbody>
                {terminalPage.pageRows.length === 0 ? (
                  <tr><td colSpan={8}>No terminals provisioned.</td></tr>
                ) : terminalPage.pageRows.map((terminal, index) => (
                  <tr key={terminal.id}>
                    <td className="number-cell">{terminalPage.startIndex + index + 1}</td>
                    <td><strong>{terminal.name}</strong></td>
                    <td>{branchName(terminal.branchId)}</td>
                    <td>{terminal.deviceCode}</td>
                    <td>{terminal.appVersion}</td>
                    <td>{terminal.lastSeenAt ? new Date(terminal.lastSeenAt).toLocaleString() : "Not checked in"}</td>
                    <td><StatusBadge label={terminal.status} tone={statusTone(terminal.status)} /></td>
                    <td className="row-actions">
                      <button onClick={() => openTerminalModal(terminal)} aria-label={`Edit ${terminal.name}`}><Pencil size={16} /></button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <TablePagination
            page={terminalPage.page}
            pageCount={terminalPage.pageCount}
            pageSize={terminalPage.pageSize}
            totalRows={terminalPage.totalRows}
            startIndex={terminalPage.startIndex}
            visibleCount={terminalPage.pageRows.length}
            onPageChange={terminalPage.setPage}
            onPageSizeChange={terminalPage.setPageSize}
          />
        </section>
      </div>

      {branchModalOpen ? (
        <div className="modal-backdrop" role="presentation" onMouseDown={closeBranchModal}>
          <section className="modal-panel branch-modal" role="dialog" aria-modal="true" aria-labelledby="branch-modal-title" onMouseDown={(event) => event.stopPropagation()}>
            <div className="modal-header">
              <div>
                <p className="eyebrow">{selectedBranch ? "Update location" : "Create location"}</p>
                <h2 id="branch-modal-title">{selectedBranch ? "Edit branch" : "Add branch"}</h2>
              </div>
              <button className="icon-button" onClick={closeBranchModal} aria-label="Close branch modal"><X size={18} /></button>
            </div>
            <form className="branch-form" onSubmit={saveBranch}>
              <label>
                Branch name
                <input value={branchForm.name} onChange={(event) => updateBranchForm("name", event.target.value)} required />
              </label>
              <label>
                City
                <input value={branchForm.city} onChange={(event) => updateBranchForm("city", event.target.value)} required />
              </label>
              <label>
                Phone
                <input value={branchForm.phone} onChange={(event) => updateBranchForm("phone", event.target.value)} required />
              </label>
              <label>
                Status
                <select value={branchForm.status} onChange={(event) => updateBranchForm("status", event.target.value as BranchStatus)}>
                  <option value="">Status</option>
                  <option value="active">Active</option>
                  <option value="paused">Paused</option>
                </select>
              </label>
              <label className="wide-field">
                Address
                <input value={branchForm.address} onChange={(event) => updateBranchForm("address", event.target.value)} required />
              </label>
              <div className="form-summary">
                <span>{status}</span>
                <button className="primary-button" type="submit"><Check size={18} /> Save branch</button>
              </div>
            </form>
          </section>
        </div>
      ) : null}

      {terminalModalOpen ? (
        <div className="modal-backdrop" role="presentation" onMouseDown={closeTerminalModal}>
          <section className="modal-panel branch-modal" role="dialog" aria-modal="true" aria-labelledby="terminal-modal-title" onMouseDown={(event) => event.stopPropagation()}>
            <div className="modal-header">
              <div>
                <p className="eyebrow">{selectedTerminal ? "Update terminal" : "Provision terminal"}</p>
                <h2 id="terminal-modal-title">{selectedTerminal ? "Edit terminal" : "Add terminal"}</h2>
              </div>
              <button className="icon-button" onClick={closeTerminalModal} aria-label="Close terminal modal"><X size={18} /></button>
            </div>
            <form className="branch-form" onSubmit={saveTerminal}>
              <label>
                Branch
                <select value={terminalForm.branchId} onChange={(event) => updateTerminalForm("branchId", event.target.value)} required>
                  <option value="">Branch</option>
                  {branches.map((branch) => (
                    <option key={branch.id} value={branch.id} disabled={terminalForm.status === "online" && branch.status !== "active"}>
                      {branch.name}{branch.status !== "active" ? " - paused" : ""}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Terminal name
                <input value={terminalForm.name} onChange={(event) => updateTerminalForm("name", event.target.value)} required />
              </label>
              <label>
                Device code
                <input value={terminalForm.deviceCode} onChange={(event) => updateTerminalForm("deviceCode", event.target.value.toUpperCase())} required />
              </label>
              <label>
                Status
                <select value={terminalForm.status} onChange={(event) => updateTerminalForm("status", event.target.value as TerminalStatus)}>
                  <option value="">Status</option>
                  <option value="online">Online</option>
                  <option value="offline">Offline</option>
                  <option value="maintenance">Maintenance</option>
                </select>
              </label>
              <label className="wide-field">
                App version
                <input value={terminalForm.appVersion} onChange={(event) => updateTerminalForm("appVersion", event.target.value)} required />
              </label>
              <div className="form-summary">
                <span>{status}</span>
                <button className="primary-button" type="submit"><Check size={18} /> Save terminal</button>
              </div>
            </form>
          </section>
        </div>
      ) : null}
    </div>
  );
}
