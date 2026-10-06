import { Check, CreditCard, FilePlus, RefreshCcw, Search, ShieldCheck, SlidersHorizontal, X } from "lucide-react";
import { FormEvent, useEffect, useMemo, useState } from "react";
import {
  fetchCurrentTenant,
  fetchSubscriptionOverview,
  createSubscriptionInvoice,
  readStoredAuth,
  updateSubscription,
  updateSubscriptionInvoice,
  type SubscriptionInvoiceCreatePayload,
  type SubscriptionInvoice,
  type SubscriptionPlan,
  type SubscriptionPlanOption,
  type SubscriptionStatus,
  type SubscriptionUsage,
  type SubscriptionUpdatePayload,
  type TenantProfile,
  type TenantSubscription
} from "../../shared/api/client";
import { StatusBadge } from "../../shared/components/StatusBadge";
import { StatCard } from "../../shared/components/StatCard";
import { TablePagination, usePaginatedRows } from "../../shared/components/TablePagination";
import { formatMoney } from "../../shared/utils/money";

const fallbackPlans: SubscriptionPlanOption[] = [];
const fallbackUsage: SubscriptionUsage = { branches: 0, users: 0, terminals: 0 };

const blankForm: SubscriptionUpdatePayload = {
  plan: "" as SubscriptionPlan,
  status: "" as SubscriptionStatus,
  billingEmail: "",
  renewalDate: new Date().toISOString(),
  graceEndsAt: "",
  notes: ""
};

const todayValue = new Date().toISOString().slice(0, 10);
const blankInvoiceForm = (): SubscriptionInvoiceCreatePayload => ({
  plan: "" as SubscriptionPlan,
  amount: undefined,
  status: "open",
  issuedAt: dateToIso(todayValue),
  dueAt: dateToIso(new Date(Date.now() + 1000 * 60 * 60 * 24 * 7).toISOString().slice(0, 10)),
  paymentReference: ""
});

function statusTone(status: SubscriptionStatus | SubscriptionInvoice["status"]): "success" | "warning" | "danger" | "info" {
  if (status === "active" || status === "paid") return "success";
  if (status === "trialing" || status === "open" || status === "grace_period" || status === "draft") return "warning";
  if (status === "cancelled" || status === "restricted" || status === "overdue" || status === "void") return "danger";
  return "info";
}

function dateValue(iso?: string) {
  return iso ? iso.slice(0, 10) : "";
}

function dateToIso(value: string) {
  return value ? new Date(`${value}T09:00:00.000Z`).toISOString() : "";
}

export function SubscriptionsView() {
  const storedAuth = useMemo(() => readStoredAuth(), []);
  const activeUserId = storedAuth?.staff.id ?? "";
  const canUseAllBranches = storedAuth?.staff.role === "owner" || storedAuth?.staff.role === "state_manager";
  const activeBranchId = canUseAllBranches ? "" : storedAuth?.session.branchId ?? storedAuth?.staff.branchId ?? "";
  const [tenant, setTenant] = useState<TenantProfile | null>(null);
  const [subscription, setSubscription] = useState<TenantSubscription | null>(null);
  const [plans, setPlans] = useState<SubscriptionPlanOption[]>(fallbackPlans);
  const [usage, setUsage] = useState<SubscriptionUsage>(fallbackUsage);
  const [invoices, setInvoices] = useState<SubscriptionInvoice[]>([]);
  const [form, setForm] = useState<SubscriptionUpdatePayload>(blankForm);
  const [invoiceQuery, setInvoiceQuery] = useState("");
  const [invoiceStatusFilter, setInvoiceStatusFilter] = useState("");
  const [invoicePlanFilter, setInvoicePlanFilter] = useState<SubscriptionPlan | "">("");
  const [invoiceForm, setInvoiceForm] = useState<SubscriptionInvoiceCreatePayload>(blankInvoiceForm);
  const [statusInvoice, setStatusInvoice] = useState<SubscriptionInvoice | null>(null);
  const [statusForm, setStatusForm] = useState<{ status: SubscriptionInvoice["status"] | ""; paymentReference: string }>({
    status: "",
    paymentReference: ""
  });
  const [status, setStatus] = useState("Ready");

  const selectedPlan = useMemo(() => plans.find((plan) => plan.plan === form.plan), [form.plan, plans]);
  const selectedInvoicePlan = useMemo(() => plans.find((plan) => plan.plan === invoiceForm.plan), [invoiceForm.plan, plans]);
  const openBalance = useMemo(() => invoices.filter((invoice) => invoice.status === "open" || invoice.status === "overdue").reduce((sum, invoice) => sum + invoice.amount, 0), [invoices]);
  const paidTotal = useMemo(() => invoices.filter((invoice) => invoice.status === "paid").reduce((sum, invoice) => sum + invoice.amount, 0), [invoices]);
  const filteredInvoices = useMemo(() => {
    const normalizedQuery = invoiceQuery.trim().toLowerCase();

    return invoices.filter((invoice) => {
      const haystack = [
        invoice.invoiceNumber,
        invoice.plan,
        invoice.status,
        invoice.currency,
        invoice.paymentReference
      ].filter(Boolean).join(" ").toLowerCase();

      const matchesQuery = !normalizedQuery || haystack.includes(normalizedQuery);
      const matchesStatus = !invoiceStatusFilter || invoice.status === invoiceStatusFilter;
      const matchesPlan = !invoicePlanFilter || invoice.plan === invoicePlanFilter;

      return matchesQuery && matchesStatus && matchesPlan;
    });
  }, [invoicePlanFilter, invoiceQuery, invoiceStatusFilter, invoices]);
  const invoicePage = usePaginatedRows(filteredInvoices, 10);

  async function loadSubscription() {
    setStatus("Syncing subscription...");

    try {
      if (!activeUserId || (!activeBranchId && !canUseAllBranches)) {
        setTenant(null);
        setSubscription(null);
        setPlans(fallbackPlans);
        setUsage(fallbackUsage);
        setInvoices([]);
        setStatus("Sign in with a branch to load subscription");
        return;
      }

      const [tenantResponse, subscriptionResponse] = await Promise.all([
        fetchCurrentTenant(activeUserId, activeBranchId),
        fetchSubscriptionOverview(activeBranchId)
      ]);
      setTenant(tenantResponse.tenant);
      setSubscription(subscriptionResponse.subscription);
      setPlans(subscriptionResponse.plans);
      setUsage(subscriptionResponse.usage ?? fallbackUsage);
      setInvoices(subscriptionResponse.invoices);
      const nextSubscription = subscriptionResponse.subscription;
      if (nextSubscription) {
        setForm({
          plan: nextSubscription.plan,
          status: nextSubscription.status,
          billingEmail: nextSubscription.billingEmail,
          renewalDate: nextSubscription.renewalDate,
          graceEndsAt: nextSubscription.graceEndsAt ?? "",
          notes: nextSubscription.notes ?? ""
        });
        setInvoiceForm((current) => ({
          ...current,
          plan: current.plan || nextSubscription.plan,
          amount: current.amount ?? nextSubscription.amount
        }));
      }
      setStatus("Subscription synced");
    } catch (error) {
      setTenant(null);
      setSubscription(null);
      setPlans(fallbackPlans);
      setUsage(fallbackUsage);
      setInvoices([]);
      setStatus(error instanceof Error ? error.message : "Unable to load subscription");
    }
  }

  useEffect(() => {
    void loadSubscription();
  }, []);

  function updateForm<K extends keyof SubscriptionUpdatePayload>(key: K, value: SubscriptionUpdatePayload[K]) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  function updateInvoiceForm<K extends keyof SubscriptionInvoiceCreatePayload>(key: K, value: SubscriptionInvoiceCreatePayload[K]) {
    setInvoiceForm((current) => ({ ...current, [key]: value }));
  }

  async function saveSubscription(event: FormEvent) {
    event.preventDefault();

    if (!form.plan || !form.status) {
      setStatus("Select a plan and status");
      return;
    }

    if (!activeUserId || (!activeBranchId && !canUseAllBranches)) {
      setStatus("Sign in with a branch before saving subscription");
      return;
    }

    setStatus("Saving subscription...");

    try {
      const response = await updateSubscription({
        ...form,
        graceEndsAt: form.graceEndsAt || undefined
      }, activeBranchId);
      setSubscription(response.subscription);
      setTenant((current) => current ? { ...current, plan: response.subscription.plan, branchLimit: response.subscription.branchLimit } : current);
      setStatus("Subscription saved");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Unable to save subscription");
    }
  }

  async function markInvoicePaid(invoice: SubscriptionInvoice) {
    setStatusInvoice(invoice);
    setStatusForm({
      status: "paid",
      paymentReference: invoice.paymentReference ?? `MANUAL-${invoice.invoiceNumber}`
    });
  }

  function editInvoiceStatus(invoice: SubscriptionInvoice) {
    setStatusInvoice(invoice);
    setStatusForm({
      status: invoice.status,
      paymentReference: invoice.paymentReference ?? ""
    });
  }

  function closeInvoiceStatusModal() {
    setStatusInvoice(null);
    setStatusForm({ status: "", paymentReference: "" });
  }

  async function saveInvoiceStatus(event: FormEvent) {
    event.preventDefault();

    if (!statusInvoice || !statusForm.status) {
      setStatus("Select an invoice status");
      return;
    }

    if (statusForm.status === "paid" && !statusForm.paymentReference.trim()) {
      setStatus("Enter a payment reference for paid invoices");
      return;
    }

    if (!activeUserId || (!activeBranchId && !canUseAllBranches)) {
      setStatus("Sign in with a branch before updating invoices");
      return;
    }

    setStatus(`Updating ${statusInvoice.invoiceNumber}...`);

    try {
      const response = await updateSubscriptionInvoice(
        statusInvoice.id,
        statusForm.status,
        statusForm.paymentReference.trim() || undefined,
        activeBranchId
      );
      setInvoices((current) => current.map((item) => (item.id === response.invoice.id ? response.invoice : item)));
      closeInvoiceStatusModal();
      setStatus("Invoice status updated");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Unable to update invoice");
    }
  }

  async function createInvoice(event: FormEvent) {
    event.preventDefault();

    if (!invoiceForm.plan) {
      setStatus("Select an invoice plan");
      return;
    }

    if (invoiceForm.status === "paid" && !invoiceForm.paymentReference?.trim()) {
      setStatus("Enter a payment reference for paid invoices");
      return;
    }

    if (!activeUserId || (!activeBranchId && !canUseAllBranches)) {
      setStatus("Sign in with a branch before creating invoices");
      return;
    }

    setStatus("Creating invoice...");

    try {
      const response = await createSubscriptionInvoice({
        ...invoiceForm,
        amount: invoiceForm.amount ?? selectedInvoicePlan?.amount,
        paymentReference: invoiceForm.paymentReference?.trim() || undefined
      }, activeBranchId);
      setInvoices((current) => [response.invoice, ...current]);
      setInvoiceForm(blankInvoiceForm());
      setStatus(`${response.invoice.invoiceNumber} created`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Unable to create invoice");
    }
  }

  function clearInvoiceFilters() {
    setInvoiceQuery("");
    setInvoiceStatusFilter("");
    setInvoicePlanFilter("");
  }

  return (
    <div className="module-view subscription-module">
      <div className="module-heading">
        <div>
          <p className="eyebrow">SaaS administration</p>
          <h1>Subscriptions</h1>
        </div>
        <div className="button-group">
          <button className="secondary-button" onClick={loadSubscription}><RefreshCcw size={18} /> Sync</button>
        </div>
      </div>

      <section className="stats-grid">
        <StatCard label="Current plan" value={subscription?.plan ?? tenant?.plan ?? "Not set"} detail={status} icon={CreditCard} tone="dark" />
        <StatCard label="Plan usage" value={`${usage.branches}/${subscription?.branchLimit ?? tenant?.branchLimit ?? 0}`} detail={`${usage.users}/${subscription?.userLimit ?? 0} users, ${usage.terminals}/${subscription?.terminalLimit ?? 0} terminals`} icon={ShieldCheck} />
        <StatCard label="Open balance" value={formatMoney(openBalance)} detail={`${formatMoney(paidTotal)} paid history`} icon={SlidersHorizontal} />
      </section>

      <form className="settings-workflow subscription-workflow" onSubmit={saveSubscription}>
        <section className="panel subscription-limits-panel">
          <div className="panel-header">
            <h2>Subscription controls</h2>
            {subscription ? <StatusBadge label={subscription.status.replace("_", " ")} tone={statusTone(subscription.status)} /> : null}
          </div>
          <div className="settings-form">
            <label>
              Plan
              <select value={form.plan} onChange={(event) => updateForm("plan", event.target.value as SubscriptionPlan)} required>
                <option value="">Plan</option>
                {plans.map((plan) => <option key={plan.plan} value={plan.plan}>{plan.plan}</option>)}
              </select>
            </label>
            <label>
              Status
              <select value={form.status} onChange={(event) => updateForm("status", event.target.value as SubscriptionStatus)} required>
                <option value="">Status</option>
                <option value="trialing">Trialing</option>
                <option value="active">Active</option>
                <option value="past_due">Past due</option>
                <option value="grace_period">Grace period</option>
                <option value="restricted">Restricted</option>
                <option value="cancelled">Cancelled</option>
              </select>
            </label>
            <label className="wide-field">
              Billing email
              <input type="email" value={form.billingEmail} onChange={(event) => updateForm("billingEmail", event.target.value)} required />
            </label>
            <label>
              Renewal date
              <input type="date" value={dateValue(form.renewalDate)} onChange={(event) => updateForm("renewalDate", dateToIso(event.target.value))} required />
            </label>
            <label>
              Grace ends
              <input type="date" value={dateValue(form.graceEndsAt)} onChange={(event) => updateForm("graceEndsAt", dateToIso(event.target.value))} />
            </label>
            <label className="wide-field">
              Notes
              <input value={form.notes ?? ""} onChange={(event) => updateForm("notes", event.target.value)} />
            </label>
            <div className="form-summary wide-field">
              <span>{selectedPlan ? `${formatMoney(selectedPlan.amount)} monthly, ${selectedPlan.branchLimit} branches, ${selectedPlan.userLimit} users, ${selectedPlan.terminalLimit} terminals` : "Select a plan to apply tenant limits"}</span>
              <button className="primary-button" type="submit"><Check size={18} /> Save subscription</button>
            </div>
          </div>
        </section>

        <section className="panel subscription-plan-table-panel">
          <div className="panel-header">
            <h2>Plan limits</h2>
            <span>{plans.length} plans</span>
          </div>
          <div className="table-wrap">
            <table>
              <thead><tr><th>#</th><th>Plan</th><th>Price</th><th>Branches</th><th>Users</th><th>Terminals</th><th>Storage</th></tr></thead>
              <tbody>
                {plans.map((plan, index) => (
                  <tr key={plan.plan}>
                    <td className="number-cell">{index + 1}</td>
                    <td><strong>{plan.plan}</strong><br /><small>{plan.features.slice(0, 2).join(", ")}</small></td>
                    <td>{formatMoney(plan.amount)}</td>
                    <td>{plan.branchLimit}</td>
                    <td>{plan.userLimit}</td>
                    <td>{plan.terminalLimit}</td>
                    <td>{plan.storageGb} GB</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </form>

      <section className="panel">
        <div className="panel-header">
          <h2>Billing invoices</h2>
          <span>{filteredInvoices.length} of {invoices.length} records</span>
        </div>
        <form className="inline-form subscription-invoice-create" onSubmit={createInvoice}>
          <label>
            Plan
            <select value={invoiceForm.plan} onChange={(event) => updateInvoiceForm("plan", event.target.value as SubscriptionPlan)} required>
              <option value="">Plan</option>
              {plans.map((plan) => <option key={plan.plan} value={plan.plan}>{plan.plan}</option>)}
            </select>
          </label>
          <label>
            Amount
            <input
              type="number"
              min={0}
              value={invoiceForm.amount ?? ""}
              onChange={(event) => updateInvoiceForm("amount", event.target.value ? Number(event.target.value) : undefined)}
              placeholder={selectedInvoicePlan ? String(selectedInvoicePlan.amount) : "0"}
            />
          </label>
          <label>
            Status
            <select value={invoiceForm.status} onChange={(event) => updateInvoiceForm("status", event.target.value as SubscriptionInvoice["status"])}>
              <option value="">Status</option>
              <option value="draft">Draft</option>
              <option value="open">Open</option>
              <option value="paid">Paid</option>
              <option value="overdue">Overdue</option>
            </select>
          </label>
          <label>
            Issued
            <input type="date" value={dateValue(invoiceForm.issuedAt)} onChange={(event) => updateInvoiceForm("issuedAt", dateToIso(event.target.value))} required />
          </label>
          <label>
            Due
            <input type="date" value={dateValue(invoiceForm.dueAt)} onChange={(event) => updateInvoiceForm("dueAt", dateToIso(event.target.value))} required />
          </label>
          <label>
            Reference
            <input value={invoiceForm.paymentReference ?? ""} onChange={(event) => updateInvoiceForm("paymentReference", event.target.value)} required={invoiceForm.status === "paid"} />
          </label>
          <button className="primary-button" type="submit"><FilePlus size={18} /> Create invoice</button>
        </form>
        <div className="table-toolbar subscription-invoice-toolbar">
          <div className="search-box compact-search">
            <Search size={16} />
            <input
              value={invoiceQuery}
              onChange={(event) => setInvoiceQuery(event.target.value)}
              placeholder="Search invoice, reference or plan"
            />
            {invoiceQuery ? (
              <button type="button" onClick={() => setInvoiceQuery("")} aria-label="Clear invoice search"><X size={14} /></button>
            ) : null}
          </div>
          <select value={invoiceStatusFilter} onChange={(event) => setInvoiceStatusFilter(event.target.value)}>
            <option value="">Invoice status</option>
            <option value="draft">Draft</option>
            <option value="open">Open</option>
            <option value="paid">Paid</option>
            <option value="void">Void</option>
            <option value="overdue">Overdue</option>
          </select>
          <select value={invoicePlanFilter} onChange={(event) => setInvoicePlanFilter(event.target.value as SubscriptionPlan | "")}>
            <option value="">Invoice plan</option>
            {plans.map((plan) => <option key={plan.plan} value={plan.plan}>{plan.plan}</option>)}
          </select>
          {(invoiceQuery || invoiceStatusFilter || invoicePlanFilter) ? (
            <button className="secondary-button" type="button" onClick={clearInvoiceFilters}>Clear filters</button>
          ) : null}
        </div>
        <div className="table-wrap">
          <table>
            <thead><tr><th>#</th><th>Invoice</th><th>Plan</th><th>Issued</th><th>Due</th><th>Amount</th><th>Status</th><th>Reference</th><th>Action</th></tr></thead>
            <tbody>
              {invoicePage.pageRows.length === 0 ? (
                <tr><td colSpan={9}>No subscription invoices found.</td></tr>
              ) : invoicePage.pageRows.map((invoice, index) => (
                <tr key={invoice.id}>
                  <td className="number-cell">{invoicePage.startIndex + index + 1}</td>
                  <td><strong>{invoice.invoiceNumber}</strong></td>
                  <td>{invoice.plan}</td>
                  <td>{new Date(invoice.issuedAt).toLocaleDateString()}</td>
                  <td>{new Date(invoice.dueAt).toLocaleDateString()}</td>
                  <td>{formatMoney(invoice.amount, invoice.currency)}</td>
                  <td><StatusBadge label={invoice.status} tone={statusTone(invoice.status)} /></td>
                  <td>{invoice.paymentReference ?? "None"}</td>
                  <td className="row-actions">
                    <button disabled={invoice.status === "paid" || invoice.status === "void"} onClick={() => markInvoicePaid(invoice)}>Mark paid</button>
                    <button disabled={invoice.status === "paid" || invoice.status === "void"} onClick={() => editInvoiceStatus(invoice)}>Update</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <TablePagination
          page={invoicePage.page}
          pageCount={invoicePage.pageCount}
          pageSize={invoicePage.pageSize}
          totalRows={invoicePage.totalRows}
          startIndex={invoicePage.startIndex}
          visibleCount={invoicePage.pageRows.length}
          onPageChange={invoicePage.setPage}
          onPageSizeChange={invoicePage.setPageSize}
        />
      </section>
      {statusInvoice ? (
        <div className="modal-backdrop" role="presentation" onMouseDown={closeInvoiceStatusModal}>
          <section className="modal-panel subscription-modal" role="dialog" aria-modal="true" aria-labelledby="invoice-status-title" onMouseDown={(event) => event.stopPropagation()}>
            <div className="modal-header">
              <div>
                <p className="eyebrow">Billing workflow</p>
                <h2 id="invoice-status-title">Update invoice</h2>
              </div>
              <button className="icon-button" onClick={closeInvoiceStatusModal} aria-label="Close invoice status modal"><X size={18} /></button>
            </div>
            <form className="settings-form" onSubmit={saveInvoiceStatus}>
              <label>
                Invoice
                <span className="locked-select-value">
                  <strong>{statusInvoice.invoiceNumber}</strong>
                  <small>{statusInvoice.plan} - {formatMoney(statusInvoice.amount, statusInvoice.currency)}</small>
                </span>
              </label>
              <label>
                Status
                <select value={statusForm.status} onChange={(event) => setStatusForm((current) => ({ ...current, status: event.target.value as SubscriptionInvoice["status"] }))} required>
                  <option value="">Status</option>
                  <option value="draft">Draft</option>
                  <option value="open">Open</option>
                  <option value="paid">Paid</option>
                  <option value="overdue">Overdue</option>
                  <option value="void">Void</option>
                </select>
              </label>
              <label className="wide-field">
                Payment reference
                <input
                  value={statusForm.paymentReference}
                  onChange={(event) => setStatusForm((current) => ({ ...current, paymentReference: event.target.value }))}
                  placeholder="Bank transfer, Paystack or manual reference"
                />
              </label>
              <div className="form-summary">
                <span>{status}</span>
                <button className="primary-button" type="submit"><Check size={18} /> Save status</button>
              </div>
            </form>
          </section>
        </div>
      ) : null}
    </div>
  );
}
