import { Check, Gift, MessageCircle, Pencil, Plus, RefreshCcw, Search, X } from "lucide-react";
import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import {
  applyApproval,
  createApproval,
  createCustomer,
  fetchCustomerLedger,
  fetchCustomers,
  postCustomerLedger,
  readStoredAuth,
  updateCustomer,
  type ApprovalRequest,
  type Customer,
  type CustomerGroup,
  type CustomerLedgerEntry,
  type CustomerLedgerPayload,
  type CustomerPayload
} from "../../shared/api/client";
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
  amount: 10000,
  pointsDelta: 0,
  note: "Customer account payment"
};

interface CustomersViewProps {
  approvalHandoff?: ApprovalRequest | null;
  onApprovalHandoffConsumed?: () => void;
}

export function CustomersView({ approvalHandoff, onApprovalHandoffConsumed }: CustomersViewProps) {
  const storedAuth = useMemo(() => readStoredAuth(), []);
  const activeBranchId = storedAuth?.session.branchId ?? storedAuth?.staff.branchId ?? "";
  const activeUserId = storedAuth?.staff.id ?? "";
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [query, setQuery] = useState("");
  const [selectedCustomer, setSelectedCustomer] = useState<Customer | null>(null);
  const [form, setForm] = useState<CustomerPayload>(blankCustomer);
  const [modalOpen, setModalOpen] = useState(false);
  const [ledgerCustomer, setLedgerCustomer] = useState<Customer | null>(null);
  const [ledgerEntries, setLedgerEntries] = useState<CustomerLedgerEntry[]>([]);
  const [ledgerForm, setLedgerForm] = useState<CustomerLedgerPayload>(blankLedger);
  const [ledgerApprovalId, setLedgerApprovalId] = useState("");
  const [ledgerModalOpen, setLedgerModalOpen] = useState(false);
  const [status, setStatus] = useState("Ready");
  const { displayMoney } = useTenantSettings();
  const handledApprovalIdRef = useRef<string | null>(null);

  const creditExposure = useMemo(() => customers.reduce((sum, customer) => sum + customer.outstandingBalance, 0), [customers]);
  const loyaltyLiability = useMemo(() => customers.reduce((sum, customer) => sum + customer.loyaltyPoints, 0), [customers]);
  const customerPage = usePaginatedRows(customers, 10);
  const ledgerCreditAmount = Math.abs(ledgerForm.amount);
  const projectedLedgerBalance = ledgerCustomer ? ledgerCustomer.outstandingBalance + ledgerCreditAmount : ledgerCreditAmount;

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

  useEffect(() => {
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

    void fetchCustomerLedger(customer.id, activeBranchId, activeUserId)
      .then((response) => setLedgerEntries(response.entries))
      .catch(() => setLedgerEntries([]));
    onApprovalHandoffConsumed?.();
  }, [approvalHandoff?.id, customers]);

  function updateForm<K extends keyof CustomerPayload>(key: K, value: CustomerPayload[K]) {
    setForm((current) => ({ ...current, [key]: value }));
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
      amount: type === "payment" ? Math.min(customer.outstandingBalance || 10000, 10000) : 0,
      pointsDelta: type === "loyalty_adjustment" ? 100 : 0,
      note: type === "payment" ? "Customer account payment" : type === "voucher" ? "Customer voucher" : "Manual loyalty reward"
    });
    setLedgerApprovalId("");
    setLedgerModalOpen(true);
    setStatus("Loading customer ledger...");

    try {
      const response = await fetchCustomerLedger(customer.id, activeBranchId, activeUserId);
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
        ? await updateCustomer(selectedCustomer.id, form, activeBranchId, activeUserId)
        : await createCustomer(form, activeBranchId, activeUserId);
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

    const signedAmount = ledgerForm.type === "payment" || ledgerForm.type === "voucher"
      ? -Math.abs(ledgerForm.amount)
      : Math.abs(ledgerForm.amount);
    const isCreditSale = ledgerForm.type === "credit_sale" && signedAmount > 0;

    try {
      if (isCreditSale && !ledgerApprovalId.trim()) {
        setStatus("Requesting customer credit approval...");
        const response = await createApproval({
          branchId: activeBranchId,
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
          activeBranchId
        );
      } else {
        setStatus("Posting customer ledger...");
      }

      const response = await postCustomerLedger(ledgerCustomer.id, { ...ledgerForm, amount: signedAmount }, activeBranchId, activeUserId);
      setCustomers((current) => current.map((item) => (item.id === response.customer.id ? response.customer : item)));
      setLedgerCustomer(response.customer);
      setLedgerEntries((current) => [response.entry, ...current]);
      setLedgerForm((current) => ({ ...current, amount: 0, pointsDelta: 0, note: "" }));
      setLedgerApprovalId("");
      setStatus("Customer ledger posted");
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
          <button className="secondary-button" onClick={() => loadCustomers()}><RefreshCcw size={18} /> Sync</button>
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
          </div>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr><th>#</th><th>Name</th><th>Phone</th><th>Group</th><th>Loyalty</th><th>Balance</th><th>Credit limit</th><th>Actions</th></tr>
            </thead>
            <tbody>
              {customerPage.pageRows.length === 0 ? (
                <tr><td colSpan={8}>No customers found.</td></tr>
              ) : customerPage.pageRows.map((customer, index) => (
                <tr key={customer.id}>
                  <td className="number-cell">{customerPage.startIndex + index + 1}</td>
                  <td>{customer.name}</td>
                  <td>{customer.phone}</td>
                  <td>{customer.group}</td>
                  <td>{customer.loyaltyPoints} pts</td>
                  <td>{displayMoney(customer.outstandingBalance)}</td>
                  <td>{displayMoney(customer.creditLimit)}</td>
                  <td className="row-actions">
                    <button onClick={() => openLedgerModal(customer, "loyalty_adjustment")} aria-label={`Reward ${customer.name}`}><Gift size={16} /></button>
                    <button onClick={() => openLedgerModal(customer, "payment")} aria-label={`Record payment for ${customer.name}`}><MessageCircle size={16} /></button>
                    <button onClick={() => editCustomer(customer)} aria-label={`Edit ${customer.name}`}><Pencil size={16} /></button>
                  </td>
                </tr>
              ))}
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
                  <option value="" disabled>Group</option>
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
                  setLedgerForm((current) => ({ ...current, type: event.target.value as CustomerLedgerPayload["type"] }));
                  setLedgerApprovalId("");
                }}>
                  <option value="" disabled>Entry type</option>
                  <option value="payment">Payment</option>
                  <option value="loyalty_adjustment">Loyalty adjustment</option>
                  <option value="voucher">Voucher</option>
                  <option value="credit_sale">Credit sale</option>
                </select>
              </label>
              <label>
                Amount
                <input min="0" type="number" value={ledgerForm.amount} onChange={(event) => setLedgerForm((current) => ({ ...current, amount: Number(event.target.value) }))} />
              </label>
              <label>
                Points delta
                <input type="number" value={ledgerForm.pointsDelta} onChange={(event) => setLedgerForm((current) => ({ ...current, pointsDelta: Number(event.target.value) }))} />
              </label>
              <label>
                Note
                <input value={ledgerForm.note} onChange={(event) => setLedgerForm((current) => ({ ...current, note: event.target.value }))} required />
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
                <span>{ledgerCustomer.loyaltyPoints} pts</span>
                <button className="primary-button" type="submit">
                  <Check size={18} /> {ledgerForm.type === "credit_sale" && !ledgerApprovalId.trim() ? "Request approval" : "Post entry"}
                </button>
              </div>
              <div className="customer-ledger-list wide-field">
                {ledgerEntries.length === 0 ? (
                  <div className="empty-state">No ledger entries yet.</div>
                ) : (
                  ledgerEntries.map((entry) => (
                    <div className="list-row" key={entry.id}>
                      <div>
                        <strong>{entry.type.replace("_", " ")}</strong>
                        <span>{entry.note} - {new Date(entry.createdAt).toLocaleString()}</span>
                      </div>
                      <b>{displayMoney(entry.amount)}</b>
                    </div>
                  ))
                )}
              </div>
            </form>
          </section>
        </div>
      ) : null}
    </div>
  );
}
