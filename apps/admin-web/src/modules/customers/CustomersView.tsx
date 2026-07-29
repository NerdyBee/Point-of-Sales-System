import { Check, CreditCard, Gift, MessageCircle, Pencil, Plus, RefreshCcw, Search, X } from "lucide-react";
import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import {
  applyApproval,
  createApproval,
  createCustomer,
  fetchBranchOptions,
  fetchCustomerLedger,
  fetchCustomers,
  postCustomerLedger,
  readStoredAuth,
  updateCustomer,
  type ApprovalRequest,
  type BranchOption,
  type Customer,
  type CustomerGroup,
  type CustomerLedgerEntry,
  type CustomerLedgerPayload,
  type CustomerPayload,
  type TerminalOption
} from "../../shared/api/client";
import { StatusBadge } from "../../shared/components/StatusBadge";
import { TablePagination, usePaginatedRows } from "../../shared/components/TablePagination";
import { useTenantSettings } from "../../shared/hooks/useTenantSettings";

const blankCustomer: CustomerPayload = {
  name: "",
  phone: "",
  email: "",
  group: "" as CustomerGroup,
  creditLimit: 0,
  loyaltyPoints: 0,
  notes: ""
};

const groups: CustomerGroup[] = ["Walk-in", "VIP", "Credit account", "Wholesale", "Staff"];
const blankLedger: CustomerLedgerPayload = {
  type: "" as CustomerLedgerPayload["type"],
  amount: 0,
  pointsDelta: 0,
  note: "",
  paymentMethod: "cash",
  paymentReference: "",
  terminalId: ""
};

interface CustomersViewProps {
  approvalHandoff?: ApprovalRequest | null;
  onApprovalHandoffConsumed?: () => void;
}

export function CustomersView({ approvalHandoff, onApprovalHandoffConsumed }: CustomersViewProps) {
  const storedAuth = useMemo(() => readStoredAuth(), []);
  const initialBranchId = storedAuth?.session.branchId ?? storedAuth?.staff.branchId ?? "";
  const initialTerminalId = storedAuth?.session.terminalId ?? "";
  const activeUserId = storedAuth?.staff.id ?? "";
  const [branchId, setBranchId] = useState(initialBranchId);
  const [terminalId, setTerminalId] = useState(initialTerminalId);
  const [branches, setBranches] = useState<BranchOption[]>([]);
  const [terminals, setTerminals] = useState<TerminalOption[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [query, setQuery] = useState("");
  const [groupFilter, setGroupFilter] = useState<CustomerGroup | "">("");
  const [creditStatusFilter, setCreditStatusFilter] = useState("");
  const [selectedCustomer, setSelectedCustomer] = useState<Customer | null>(null);
  const [form, setForm] = useState<CustomerPayload>(blankCustomer);
  const [modalOpen, setModalOpen] = useState(false);
  const [ledgerCustomer, setLedgerCustomer] = useState<Customer | null>(null);
  const [ledgerEntries, setLedgerEntries] = useState<CustomerLedgerEntry[]>([]);
  const [ledgerForm, setLedgerForm] = useState<CustomerLedgerPayload>(blankLedger);
  const [ledgerApprovalId, setLedgerApprovalId] = useState("");
  const [ledgerStartDate, setLedgerStartDate] = useState("");
  const [ledgerEndDate, setLedgerEndDate] = useState("");
  const [ledgerModalOpen, setLedgerModalOpen] = useState(false);
  const [status, setStatus] = useState("Ready");
  const { displayMoney } = useTenantSettings();
  const handledApprovalIdRef = useRef<string | null>(null);

  const creditExposure = useMemo(() => customers.reduce((sum, customer) => sum + customer.outstandingBalance, 0), [customers]);
  const loyaltyLiability = useMemo(() => customers.reduce((sum, customer) => sum + customer.loyaltyPoints, 0), [customers]);
  const filteredCustomers = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return customers.filter((customer) => {
      const matchesQuery = !normalizedQuery || [
        customer.name,
        customer.phone,
        customer.email ?? "",
        customer.group,
        customer.notes ?? "",
        String(customer.loyaltyPoints),
        String(customer.outstandingBalance),
        String(customer.creditLimit)
      ].some((value) => value.toLowerCase().includes(normalizedQuery));
      const matchesGroup = !groupFilter || customer.group === groupFilter;
      const matchesCreditStatus = !creditStatusFilter
        || (creditStatusFilter === "clear" && customer.outstandingBalance <= 0)
        || (creditStatusFilter === "outstanding" && customer.outstandingBalance > 0 && customer.outstandingBalance <= customer.creditLimit)
        || (creditStatusFilter === "over_limit" && customer.outstandingBalance > customer.creditLimit);

      return matchesQuery && matchesGroup && matchesCreditStatus;
    });
  }, [creditStatusFilter, customers, groupFilter, query]);
  const customerPage = usePaginatedRows(filteredCustomers, 10);
  const ledgerPage = usePaginatedRows(ledgerEntries, 8);
  const branchTerminals = useMemo(() => terminals.filter((terminal) => terminal.branchId === branchId), [branchId, terminals]);
  const selectedBranch = useMemo(() => branches.find((branch) => branch.id === branchId) ?? null, [branchId, branches]);
  const branchLocked = Boolean(branchId && branches.length === 1);
  const hasCustomerFilters = Boolean(query || groupFilter || creditStatusFilter);
  const signedLedgerAmount = ledgerForm.type === "payment" || ledgerForm.type === "voucher"
    ? -Math.abs(ledgerForm.amount)
    : Math.abs(ledgerForm.amount);
  const projectedLedgerBalance = ledgerCustomer ? ledgerCustomer.outstandingBalance + signedLedgerAmount : signedLedgerAmount;
  function customerCreditStatus(customer: Customer) {
    if (customer.outstandingBalance > customer.creditLimit) {
      return { label: "Over limit", tone: "danger" as const };
    }
    if (customer.outstandingBalance > 0) {
      return { label: "Outstanding", tone: "warning" as const };
    }
    return { label: "Clear", tone: "success" as const };
  }

  async function loadCustomers(nextQuery = query) {
    try {
      const response = await fetchCustomers(nextQuery);
      setCustomers(response.customers);
      setStatus("Customers synced");
    } catch (error) {
      setCustomers([]);
      setStatus(error instanceof Error ? error.message : "Unable to load customers");
    }
  }

  async function loadBranchOptions() {
    try {
      const response = await fetchBranchOptions();
      setBranches(response.branches);
      setTerminals(response.terminals);

      const resolvedBranchId = branchId || response.branches[0]?.id || "";
      if (!branchId && resolvedBranchId) {
        setBranchId(resolvedBranchId);
      }

      const terminalOptions = response.terminals.filter((terminal) => terminal.branchId === resolvedBranchId);
      const resolvedTerminal = terminalOptions.find((terminal) => terminal.id === terminalId)
        ?? terminalOptions.find((terminal) => terminal.status === "online")
        ?? terminalOptions[0];
      if (!terminalId || resolvedTerminal?.branchId !== resolvedBranchId) {
        setTerminalId(resolvedTerminal?.id ?? "");
      }
    } catch {
      setBranches([]);
      setTerminals([]);
    }
  }

  useEffect(() => {
    void loadBranchOptions();
    void loadCustomers();
  }, []);

  useEffect(() => {
    if (
      !approvalHandoff ||
      approvalHandoff.type !== "customer_credit" ||
      approvalHandoff.entityType !== "customerAccount" ||
      approvalHandoff.status !== "approved" ||
      handledApprovalIdRef.current === approvalHandoff.id
    ) {
      return;
    }

    const customer = customers.find((item) => item.id === approvalHandoff.entityId);
    if (!customer) {
      setStatus(`Approval ${approvalHandoff.id} customer not loaded`);
      return;
    }

    handledApprovalIdRef.current = approvalHandoff.id;

    setLedgerCustomer(customer);
    setLedgerForm({
      type: "credit_sale",
      amount: approvalHandoff.amount,
      pointsDelta: 0,
      note: approvalHandoff.reason
    });
    setLedgerApprovalId(approvalHandoff.id);
    setLedgerModalOpen(true);
    setStatus(`Customer credit approval ready: ${approvalHandoff.id}`);

    void fetchCustomerLedger(customer.id, branchId, activeUserId, ledgerStartDate, ledgerEndDate)
      .then((response) => setLedgerEntries(response.entries))
      .catch(() => setLedgerEntries([]));
    onApprovalHandoffConsumed?.();
  }, [approvalHandoff?.id, customers, branchId]);

  function updateForm<K extends keyof CustomerPayload>(key: K, value: CustomerPayload[K]) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  function updateLedgerForm<K extends keyof CustomerLedgerPayload>(key: K, value: CustomerLedgerPayload[K]) {
    setLedgerForm((current) => ({ ...current, [key]: value }));
    if (key === "type" || key === "amount" || key === "note") {
      setLedgerApprovalId("");
    }
  }

  function changeBranch(nextBranchId: string) {
    const nextTerminals = terminals.filter((terminal) => terminal.branchId === nextBranchId);
    const nextTerminal = nextTerminals.find((terminal) => terminal.status === "online") ?? nextTerminals[0];
    setBranchId(nextBranchId);
    setTerminalId(nextTerminal?.id ?? "");
    setLedgerEntries([]);
    if (ledgerModalOpen) {
      setStatus("Branch changed. Reopen the customer ledger to refresh entries.");
    }
  }

  function editCustomer(customer: Customer) {
    setSelectedCustomer(customer);
    setForm({
      name: customer.name,
      phone: customer.phone,
      email: customer.email ?? "",
      group: customer.group,
      creditLimit: customer.creditLimit,
      loyaltyPoints: customer.loyaltyPoints,
      notes: customer.notes ?? ""
    });
    setModalOpen(true);
  }

  function resetForm() {
    setSelectedCustomer(null);
    setForm(blankCustomer);
    setModalOpen(true);
  }

  function closeModal() {
    setModalOpen(false);
    setSelectedCustomer(null);
    setForm(blankCustomer);
  }

  async function openLedgerModal(customer: Customer, type: CustomerLedgerPayload["type"]) {
    setLedgerCustomer(customer);
    setLedgerForm({
      type,
      amount: type === "payment" ? Math.min(customer.outstandingBalance || 10000, 10000) : type === "credit_sale" ? 10000 : 0,
      pointsDelta: type === "loyalty_adjustment" ? 100 : 0,
      note: type === "payment" ? "Customer account payment" : type === "voucher" ? "Customer voucher" : type === "credit_sale" ? "Manual credit sale" : "Manual loyalty reward",
      paymentMethod: type === "payment" ? "cash" : type === "voucher" ? "voucher" : undefined,
      paymentReference: "",
      terminalId
    });
    setLedgerApprovalId("");
    setLedgerStartDate("");
    setLedgerEndDate("");
    setLedgerModalOpen(true);
    setStatus("Loading customer ledger...");

    try {
      const response = await fetchCustomerLedger(customer.id, branchId, activeUserId);
      setLedgerEntries(response.entries);
      setStatus("Customer ledger loaded");
    } catch (error) {
      setLedgerEntries([]);
      setStatus(error instanceof Error ? error.message : "Unable to load customer ledger");
    }
  }

  function closeLedgerModal() {
    setLedgerModalOpen(false);
    setLedgerCustomer(null);
    setLedgerEntries([]);
    setLedgerForm(blankLedger);
    setLedgerApprovalId("");
    setLedgerStartDate("");
    setLedgerEndDate("");
  }

  async function loadLedgerEntries(customer = ledgerCustomer, nextStartDate = ledgerStartDate, nextEndDate = ledgerEndDate) {
    if (!customer) return;
    setStatus("Loading customer ledger...");

    try {
      const response = await fetchCustomerLedger(customer.id, branchId, activeUserId, nextStartDate, nextEndDate);
      setLedgerEntries(response.entries);
      setStatus("Customer ledger loaded");
    } catch (error) {
      setLedgerEntries([]);
      setStatus(error instanceof Error ? error.message : "Unable to load customer ledger");
    }
  }

  function clearLedgerDateFilters() {
    setLedgerStartDate("");
    setLedgerEndDate("");
    void loadLedgerEntries(ledgerCustomer, "", "");
  }

  function clearCustomerFilters() {
    setQuery("");
    setGroupFilter("");
    setCreditStatusFilter("");
    void loadCustomers("");
  }

  async function saveCustomer(event: FormEvent) {
    event.preventDefault();

    if (!form.group) {
      setStatus("Select a customer group");
      return;
    }

    setStatus(selectedCustomer ? "Updating customer..." : "Creating customer...");

    try {
      const response = selectedCustomer
        ? await updateCustomer(selectedCustomer.id, form, branchId, activeUserId)
        : await createCustomer(form, branchId, activeUserId);
      setCustomers((current) => {
        const existing = current.some((customer) => customer.id === response.customer.id);
        return existing
          ? current.map((customer) => (customer.id === response.customer.id ? response.customer : customer))
          : [response.customer, ...current];
      });
      setStatus(selectedCustomer ? "Customer updated" : "Customer created");
      closeModal();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Unable to save customer");
    }
  }

  async function saveLedgerEntry(event: FormEvent) {
    event.preventDefault();

    if (!ledgerCustomer) {
      return;
    }

    if (!ledgerForm.type) {
      setStatus("Select a ledger entry type");
      return;
    }

    if (!ledgerForm.amount && ledgerForm.type !== "loyalty_adjustment") {
      setStatus("Enter a ledger amount");
      return;
    }

    if (!ledgerForm.note.trim()) {
      setStatus("Enter a ledger note");
      return;
    }

    const signedAmount = ledgerForm.type === "payment" || ledgerForm.type === "voucher"
      ? -Math.abs(ledgerForm.amount)
      : Math.abs(ledgerForm.amount);
    const isCreditSale = ledgerForm.type === "credit_sale" && signedAmount > 0;

    if ((ledgerForm.type === "payment" || ledgerForm.type === "voucher") && ledgerCustomer.outstandingBalance + signedAmount < 0) {
      setStatus("Payment exceeds customer outstanding balance");
      return;
    }

    if (!branchId) {
      setStatus("Select a branch before posting customer ledger entries");
      return;
    }

    if ((ledgerForm.type === "payment" || ledgerForm.type === "voucher") && ledgerForm.paymentMethod === "cash" && !terminalId) {
      setStatus("Select a terminal for cash customer payments");
      return;
    }

    try {
      if (isCreditSale && !ledgerApprovalId.trim()) {
        setStatus("Requesting customer credit approval...");
        const response = await createApproval({
          branchId,
          type: "customer_credit",
          entityType: "customerAccount",
          entityId: ledgerCustomer.id,
          amount: signedAmount,
          reason: ledgerForm.note
        });
        setLedgerApprovalId(response.approval.id);
        setStatus(`Approval requested: ${response.approval.id}`);
        return;
      }

      if (isCreditSale) {
        setStatus("Applying customer credit approval...");
        await applyApproval(
          ledgerApprovalId.trim(),
          "customerAccount",
          ledgerCustomer.id,
          "customer_credit",
          signedAmount,
          ledgerForm.note,
          activeUserId,
          branchId
        );
      } else {
        setStatus("Posting customer ledger...");
      }

      const response = await postCustomerLedger(ledgerCustomer.id, { ...ledgerForm, amount: signedAmount, terminalId: ledgerForm.paymentMethod === "cash" ? terminalId : ledgerForm.terminalId }, branchId, activeUserId);
      setCustomers((current) => current.map((item) => (item.id === response.customer.id ? response.customer : item)));
      setLedgerCustomer(response.customer);
      setLedgerEntries((current) => [response.entry, ...current]);
      setLedgerForm((current) => ({ ...current, amount: 0, pointsDelta: 0, note: "" }));
      setLedgerApprovalId("");
      setStatus(response.movement ? `Customer ledger posted and drawer updated: ${displayMoney(response.movement.expectedCashAfter ?? 0)}` : "Customer ledger posted");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Unable to post customer ledger");
    }
  }

  return (
    <div className="module-view">
      <div className="module-heading">
        <div>
          <p className="eyebrow">Loyalty, receipts and credit control</p>
          <h1>Customers</h1>
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
                {branches.map((branch) => <option key={branch.id} value={branch.id}>{branch.name}</option>)}
              </select>
            )}
          </label>
          <label className="toolbar-select">
            Terminal
            <select value={terminalId} onChange={(event) => setTerminalId(event.target.value)}>
              <option value="">Terminal</option>
              {branchTerminals.map((terminal) => <option key={terminal.id} value={terminal.id}>{terminal.name} - {terminal.status}</option>)}
            </select>
          </label>
          <button className="secondary-button" onClick={() => { void loadBranchOptions(); void loadCustomers(); }}><RefreshCcw size={18} /> Sync</button>
          <button className="primary-button" onClick={resetForm}><Plus size={18} /> Add customer</button>
        </div>
      </div>
      <section className="stats-grid">
        <article className="stat-card">
          <div className="stat-card-top"><span>Customers</span></div>
          <strong>{customers.length}</strong>
          <small>{status}</small>
        </article>
        <article className="stat-card">
          <div className="stat-card-top"><span>Credit exposure</span></div>
          <strong>{displayMoney(creditExposure)}</strong>
          <small>Outstanding balances</small>
        </article>
        <article className="stat-card">
          <div className="stat-card-top"><span>Loyalty points</span></div>
          <strong>{loyaltyLiability}</strong>
          <small>Issued points</small>
        </article>
      </section>
      <section className="panel">
        <div className="panel-header">
          <h2>Customer directory</h2>
          <div className="search-box compact-search">
            <Search size={16} />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") void loadCustomers(query);
              }}
              placeholder="Search customer"
            />
            {query ? <button type="button" onClick={() => setQuery("")} aria-label="Clear customer search"><X size={14} /></button> : null}
          </div>
        </div>
        <div className="table-toolbar customer-filter-toolbar">
          <select value={groupFilter} onChange={(event) => setGroupFilter(event.target.value as CustomerGroup | "")}>
            <option value="">Customer group</option>
            {groups.map((group) => <option key={group} value={group}>{group}</option>)}
          </select>
          <select value={creditStatusFilter} onChange={(event) => setCreditStatusFilter(event.target.value)}>
            <option value="">Credit status</option>
            <option value="clear">Clear</option>
            <option value="outstanding">Outstanding</option>
            <option value="over_limit">Over limit</option>
          </select>
          {hasCustomerFilters ? (
            <button className="secondary-button" type="button" onClick={clearCustomerFilters}>Clear filters</button>
          ) : null}
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr><th>#</th><th>Name</th><th>Phone</th><th>Group</th><th>Loyalty</th><th>Balance</th><th>Credit limit</th><th>Status</th><th>Actions</th></tr>
            </thead>
            <tbody>
              {customerPage.pageRows.length === 0 ? (
                <tr><td colSpan={9}>No customers found.</td></tr>
              ) : customerPage.pageRows.map((customer, index) => {
                const creditStatus = customerCreditStatus(customer);
                return (
                  <tr key={customer.id}>
                    <td className="number-cell">{customerPage.startIndex + index + 1}</td>
                    <td>{customer.name}</td>
                    <td>{customer.phone}</td>
                    <td>{customer.group}</td>
                    <td>{customer.loyaltyPoints} pts</td>
                    <td>{displayMoney(customer.outstandingBalance)}</td>
                    <td>{displayMoney(customer.creditLimit)}</td>
                    <td><StatusBadge label={creditStatus.label} tone={creditStatus.tone} /></td>
                    <td className="row-actions">
                      <button onClick={() => openLedgerModal(customer, "loyalty_adjustment")} aria-label={`Reward ${customer.name}`}><Gift size={16} /></button>
                      <button onClick={() => openLedgerModal(customer, "payment")} aria-label={`Record payment for ${customer.name}`}><MessageCircle size={16} /></button>
                      <button onClick={() => openLedgerModal(customer, "credit_sale")} aria-label={`Post credit sale for ${customer.name}`}><CreditCard size={16} /></button>
                      <button onClick={() => editCustomer(customer)} aria-label={`Edit ${customer.name}`}><Pencil size={16} /></button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <TablePagination
          page={customerPage.page}
          pageCount={customerPage.pageCount}
          pageSize={customerPage.pageSize}
          totalRows={customerPage.totalRows}
          startIndex={customerPage.startIndex}
          visibleCount={customerPage.pageRows.length}
          onPageChange={customerPage.setPage}
          onPageSizeChange={customerPage.setPageSize}
        />
      </section>
      {modalOpen ? (
        <div className="modal-backdrop" role="presentation" onMouseDown={closeModal}>
          <section className="modal-panel customer-modal" role="dialog" aria-modal="true" aria-labelledby="customer-modal-title" onMouseDown={(event) => event.stopPropagation()}>
            <div className="modal-header">
              <div>
                <p className="eyebrow">{selectedCustomer ? "Update customer profile" : "Create customer profile"}</p>
                <h2 id="customer-modal-title">{selectedCustomer ? "Edit customer" : "Add customer"}</h2>
              </div>
              <button className="icon-button" onClick={closeModal} aria-label="Close customer modal"><X size={18} /></button>
            </div>
            <form className="customer-form" onSubmit={saveCustomer}>
              <label>
                Name
                <input value={form.name} onChange={(event) => updateForm("name", event.target.value)} required />
              </label>
              <label>
                Phone
                <input value={form.phone} onChange={(event) => updateForm("phone", event.target.value)} required />
              </label>
              <label>
                Email
                <input value={form.email ?? ""} onChange={(event) => updateForm("email", event.target.value)} />
              </label>
              <label>
                Group
                <select value={form.group} onChange={(event) => updateForm("group", event.target.value as CustomerGroup)}>
                  <option value="">Group</option>
                  {groups.map((group) => <option key={group} value={group}>{group}</option>)}
                </select>
              </label>
              <label>
                Credit limit
                <input min="0" type="number" value={form.creditLimit} onChange={(event) => updateForm("creditLimit", Number(event.target.value))} />
              </label>
              <label>
                Loyalty points
                <input min="0" type="number" value={form.loyaltyPoints} onChange={(event) => updateForm("loyaltyPoints", Number(event.target.value))} />
              </label>
              <label className="wide-field">
                Notes
                <input value={form.notes ?? ""} onChange={(event) => updateForm("notes", event.target.value)} />
              </label>
              <div className="form-summary">
                <span>{selectedCustomer?.group ?? form.group}</span>
                <span>{status}</span>
                <button className="primary-button" type="submit"><Check size={18} /> Save</button>
              </div>
            </form>
          </section>
        </div>
      ) : null}
      {ledgerModalOpen && ledgerCustomer ? (
        <div className="modal-backdrop" role="presentation" onMouseDown={closeLedgerModal}>
          <section className="modal-panel customer-ledger-modal" role="dialog" aria-modal="true" aria-labelledby="customer-ledger-modal-title" onMouseDown={(event) => event.stopPropagation()}>
            <div className="modal-header">
              <div>
                <p className="eyebrow">{ledgerCustomer.group} account</p>
                <h2 id="customer-ledger-modal-title">{ledgerCustomer.name}</h2>
              </div>
              <button className="icon-button" onClick={closeLedgerModal} aria-label="Close customer ledger modal"><X size={18} /></button>
            </div>
            <form className="customer-ledger-form" onSubmit={saveLedgerEntry}>
              <label>
                Entry type
                <select value={ledgerForm.type} onChange={(event) => {
                  updateLedgerForm("type", event.target.value as CustomerLedgerPayload["type"]);
                }}>
                  <option value="">Entry type</option>
                  <option value="payment">Payment</option>
                  <option value="loyalty_adjustment">Loyalty adjustment</option>
                  <option value="voucher">Voucher</option>
                  <option value="credit_sale">Credit sale</option>
                </select>
              </label>
              <label>
                Amount
                <input
                  min="0"
                  max={ledgerForm.type === "payment" || ledgerForm.type === "voucher" ? ledgerCustomer.outstandingBalance : undefined}
                  type="number"
                  value={ledgerForm.amount}
                  onChange={(event) => updateLedgerForm("amount", Number(event.target.value))}
                />
              </label>
              <label>
                Points delta
                <input type="number" value={ledgerForm.pointsDelta} onChange={(event) => updateLedgerForm("pointsDelta", Number(event.target.value))} />
              </label>
              {ledgerForm.type === "payment" || ledgerForm.type === "voucher" ? (
                <>
                  <label>
                    Payment method
                    <select value={ledgerForm.paymentMethod ?? ""} onChange={(event) => updateLedgerForm("paymentMethod", event.target.value as CustomerLedgerPayload["paymentMethod"])}>
                      <option value="">Payment method</option>
                      <option value="cash">Cash</option>
                      <option value="card">Card</option>
                      <option value="bank_transfer">Bank transfer</option>
                      <option value="mobile_money">Mobile money</option>
                      <option value="voucher">Voucher</option>
                    </select>
                  </label>
                  <label>
                    Reference
                    <input value={ledgerForm.paymentReference ?? ""} onChange={(event) => updateLedgerForm("paymentReference", event.target.value)} />
                  </label>
                </>
              ) : null}
              <label>
                Note
                <input value={ledgerForm.note} onChange={(event) => updateLedgerForm("note", event.target.value)} required />
              </label>
              {ledgerForm.type === "credit_sale" ? (
                <>
                  <label className="wide-field">
                    Approved request ID
                    <input value={ledgerApprovalId} onChange={(event) => setLedgerApprovalId(event.target.value)} placeholder="Leave blank to request approval" />
                  </label>
                  <div className="approval-warning">
                    <span>Customer credit approval</span>
                    <strong>{displayMoney(projectedLedgerBalance)}</strong>
                    <small>Current balance {displayMoney(ledgerCustomer.outstandingBalance)} - Limit {displayMoney(ledgerCustomer.creditLimit)}</small>
                  </div>
                </>
              ) : null}
              <div className="customer-ledger-summary wide-field">
                <span>Balance {displayMoney(ledgerCustomer.outstandingBalance)}</span>
                <span>After {displayMoney(projectedLedgerBalance)}</span>
                <button className="primary-button" type="submit">
                  <Check size={18} /> {ledgerForm.type === "credit_sale" && !ledgerApprovalId.trim() ? "Request approval" : "Post entry"}
                </button>
              </div>
              <div className="customer-ledger-list wide-field">
                <div className="table-toolbar customer-ledger-filter-toolbar">
                  <div className="date-range-filter customer-ledger-date-range-filter">
                    <label>
                      <span>Start</span>
                      <input type="date" value={ledgerStartDate} onChange={(event) => setLedgerStartDate(event.target.value)} />
                    </label>
                    <label>
                      <span>End</span>
                      <input type="date" value={ledgerEndDate} onChange={(event) => setLedgerEndDate(event.target.value)} />
                    </label>
                  </div>
                  <button className="secondary-button" type="button" onClick={() => loadLedgerEntries(ledgerCustomer, ledgerStartDate, ledgerEndDate)}>Apply dates</button>
                  {(ledgerStartDate || ledgerEndDate) ? (
                    <button className="secondary-button" type="button" onClick={clearLedgerDateFilters}>Clear dates</button>
                  ) : null}
                </div>
                <div className="table-wrap">
                  <table>
                    <thead><tr><th>#</th><th>Created</th><th>Type</th><th>Note</th><th>Amount</th><th>Balance</th><th>Points</th></tr></thead>
                    <tbody>
                      {ledgerPage.pageRows.length === 0 ? (
                        <tr><td colSpan={7}>No ledger entries yet.</td></tr>
                      ) : ledgerPage.pageRows.map((entry, index) => (
                        <tr key={entry.id}>
                          <td className="number-cell">{ledgerPage.startIndex + index + 1}</td>
                          <td>{new Date(entry.createdAt).toLocaleString()}</td>
                          <td>{entry.type.replace("_", " ")}</td>
                          <td>{entry.note}</td>
                          <td>{displayMoney(entry.amount)}</td>
                          <td>{displayMoney(entry.balanceAfter)}</td>
                          <td>{entry.pointsAfter}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <TablePagination
                  page={ledgerPage.page}
                  pageCount={ledgerPage.pageCount}
                  pageSize={ledgerPage.pageSize}
                  totalRows={ledgerPage.totalRows}
                  startIndex={ledgerPage.startIndex}
                  visibleCount={ledgerPage.pageRows.length}
                  onPageChange={ledgerPage.setPage}
                  onPageSizeChange={ledgerPage.setPageSize}
                />
              </div>
            </form>
          </section>
        </div>
      ) : null}
    </div>
  );
}
