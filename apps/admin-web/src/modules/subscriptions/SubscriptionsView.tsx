import { Check, CreditCard, RefreshCcw, ShieldCheck, SlidersHorizontal } from "lucide-react";
import { FormEvent, useEffect, useMemo, useState } from "react";
import {
  fetchCurrentTenant,
  fetchSubscriptionOverview,
  readStoredAuth,
  updateSubscription,
  updateSubscriptionInvoice,
  type SubscriptionInvoice,
  type SubscriptionPlan,
  type SubscriptionPlanOption,
  type SubscriptionStatus,
  type SubscriptionUpdatePayload,
  type TenantProfile,
  type TenantSubscription
} from "../../shared/api/client";
import { StatusBadge } from "../../shared/components/StatusBadge";
import { StatCard } from "../../shared/components/StatCard";
import { TablePagination, usePaginatedRows } from "../../shared/components/TablePagination";
import { formatMoney } from "../../shared/utils/money";

const fallbackPlans: SubscriptionPlanOption[] = [];

const blankForm: SubscriptionUpdatePayload = {
  plan: "" as SubscriptionPlan,
  status: "" as SubscriptionStatus,
  billingEmail: "",
  renewalDate: new Date().toISOString(),
  graceEndsAt: "",
  notes: ""
};

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
  const activeBranchId = storedAuth?.session.branchId ?? storedAuth?.staff.branchId ?? "";
  const [tenant, setTenant] = useState<TenantProfile | null>(null);
  const [subscription, setSubscription] = useState<TenantSubscription | null>(null);
  const [plans, setPlans] = useState<SubscriptionPlanOption[]>(fallbackPlans);
  const [invoices, setInvoices] = useState<SubscriptionInvoice[]>([]);
  const [form, setForm] = useState<SubscriptionUpdatePayload>(blankForm);
  const [status, setStatus] = useState("Ready");

  const selectedPlan = useMemo(() => plans.find((plan) => plan.plan === form.plan), [form.plan, plans]);
  const openBalance = useMemo(() => invoices.filter((invoice) => invoice.status === "open" || invoice.status === "overdue").reduce((sum, invoice) => sum + invoice.amount, 0), [invoices]);
  const paidTotal = useMemo(() => invoices.filter((invoice) => invoice.status === "paid").reduce((sum, invoice) => sum + invoice.amount, 0), [invoices]);
  const invoicePage = usePaginatedRows(invoices, 10);

  async function loadSubscription() {
    setStatus("Syncing subscription...");

    try {
      if (!activeUserId || !activeBranchId) {
        setTenant(null);
        setSubscription(null);
        setPlans(fallbackPlans);
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
      setInvoices(subscriptionResponse.invoices);
      if (subscriptionResponse.subscription) {
        setForm({
          plan: subscriptionResponse.subscription.plan,
          status: subscriptionResponse.subscription.status,
          billingEmail: subscriptionResponse.subscription.billingEmail,
          renewalDate: subscriptionResponse.subscription.renewalDate,
          graceEndsAt: subscriptionResponse.subscription.graceEndsAt ?? "",
          notes: subscriptionResponse.subscription.notes ?? ""
        });
      }
      setStatus("Subscription synced");
    } catch (error) {
      setTenant(null);
      setSubscription(null);
      setPlans(fallbackPlans);
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

  async function saveSubscription(event: FormEvent) {
    event.preventDefault();

    if (!form.plan || !form.status) {
      setStatus("Select a plan and status");
      return;
    }

    if (!activeUserId || !activeBranchId) {
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
    if (!activeUserId || !activeBranchId) {
      setStatus("Sign in with a branch before updating invoices");
      return;
    }

    setStatus(`Updating ${invoice.invoiceNumber}...`);

    try {
      const response = await updateSubscriptionInvoice(invoice.id, "paid", `MANUAL-${invoice.invoiceNumber}`, activeBranchId);
      setInvoices((current) => current.map((item) => (item.id === response.invoice.id ? response.invoice : item)));
      setStatus("Invoice marked paid");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Unable to update invoice");
    }
  }

  return (
    <div className="module-view">
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
        <StatCard label="Branch limit" value={`${tenant?.activeBranches ?? 0}/${subscription?.branchLimit ?? tenant?.branchLimit ?? 0}`} detail="Active branches" icon={ShieldCheck} />
        <StatCard label="Open balance" value={formatMoney(openBalance)} detail={`${formatMoney(paidTotal)} paid history`} icon={SlidersHorizontal} />
      </section>

      <form className="settings-workflow" onSubmit={saveSubscription}>
        <section className="panel">
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
              <span>{selectedPlan ? `${formatMoney(selectedPlan.amount)} monthly, ${selectedPlan.branchLimit} branches, ${selectedPlan.terminalLimit} terminals` : "Select a plan to apply tenant limits"}</span>
              <button className="primary-button" type="submit"><Check size={18} /> Save subscription</button>
            </div>
          </div>
        </section>

        <section className="panel">
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
          <span>{invoices.length} records</span>
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
    </div>
  );
}
