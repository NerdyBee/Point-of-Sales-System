import { Check, CircleDollarSign, ClipboardCheck, Plus, RefreshCcw, Search, X } from "lucide-react";
import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import {
  applyApproval,
  createApproval,
  createExpense,
  fetchBranchOptions,
  fetchExpenses,
  readStoredAuth,
  updateExpenseStatus,
  type ApprovalRequest,
  type BranchOption,
  type Expense,
  type ExpensePaymentMethodCode,
  type ExpensePayload,
  type ExpenseStatus
} from "../../shared/api/client";
import { StatusBadge } from "../../shared/components/StatusBadge";
import { StatCard } from "../../shared/components/StatCard";
import { TablePagination, usePaginatedRows } from "../../shared/components/TablePagination";
import { useTenantSettings } from "../../shared/hooks/useTenantSettings";
import { dateRangeErrorMessage, hasInvertedDateRange } from "../../shared/utils/dateFilters";

const fallbackBranches: BranchOption[] = [];
const expenseCategories = ["Utilities", "Repairs", "Rent", "Transport", "Marketing", "Supplies", "Staff welfare", "Other"];
const paymentMethods: Array<{ value: ExpensePaymentMethodCode; label: string }> = [
  { value: "cash", label: "Cash" },
  { value: "card", label: "Card" },
  { value: "bank_transfer", label: "Bank transfer" },
  { value: "mobile_money", label: "Mobile money" },
  { value: "voucher", label: "Voucher" }
];

function blankExpense(branchId = ""): ExpensePayload {
  return {
    branchId,
    category: "",
    description: "",
    vendor: "",
    amount: 0,
    paymentMethod: "" as ExpensePaymentMethodCode,
    reference: "",
    status: "" as ExpenseStatus,
    spentAt: new Date().toISOString(),
    note: ""
  };
}

function statusTone(status: ExpenseStatus): "success" | "warning" | "danger" | "info" {
  if (status === "paid" || status === "approved") return "success";
  if (status === "pending_approval" || status === "draft") return "warning";
  if (status === "rejected" || status === "voided") return "danger";
  return "info";
}

interface ExpensesViewProps {
  approvalHandoff?: ApprovalRequest | null;
  onApprovalHandoffConsumed?: () => void;
}

export function ExpensesView({ approvalHandoff, onApprovalHandoffConsumed }: ExpensesViewProps) {
  const storedAuth = useMemo(() => readStoredAuth(), []);
  const canUseAllBranches = storedAuth?.staff.role === "owner" || storedAuth?.staff.role === "state_manager";
  const initialBranchId = canUseAllBranches ? "" : storedAuth?.session.branchId ?? storedAuth?.staff.branchId ?? "";
  const activeUserId = storedAuth?.staff.id ?? "";
  const handledApprovalIdRef = useRef<string | null>(null);
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [branches, setBranches] = useState<BranchOption[]>(fallbackBranches);
  const [branchId, setBranchId] = useState(initialBranchId);
  const [form, setForm] = useState<ExpensePayload>(blankExpense(initialBranchId));
  const [modalOpen, setModalOpen] = useState(false);
  const [statusFilter, setStatusFilter] = useState("");
  const [expenseQuery, setExpenseQuery] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("");
  const [paymentMethodFilter, setPaymentMethodFilter] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [status, setStatus] = useState("Ready");
  const { displayMoney } = useTenantSettings();

  const paidTotal = useMemo(() => expenses.filter((expense) => expense.status === "paid").reduce((sum, expense) => sum + expense.amount, 0), [expenses]);
  const pendingTotal = useMemo(() => expenses.filter((expense) => expense.status === "pending_approval").reduce((sum, expense) => sum + expense.amount, 0), [expenses]);
  const approvedUnpaid = useMemo(() => expenses.filter((expense) => expense.status === "approved").reduce((sum, expense) => sum + expense.amount, 0), [expenses]);
  const rejectedOrVoided = useMemo(() => expenses.filter((expense) => expense.status === "rejected" || expense.status === "voided").reduce((sum, expense) => sum + expense.amount, 0), [expenses]);
  const filteredExpenses = useMemo(() => {
    const normalizedQuery = expenseQuery.trim().toLowerCase();
    return expenses.filter((expense) => {
      const matchesQuery = !normalizedQuery || [
        expense.category,
        expense.description,
        expense.vendor ?? "",
        expense.reference ?? "",
        expense.note ?? "",
        expense.paymentMethod,
        expense.status,
        String(expense.amount)
      ].some((value) => value.toLowerCase().includes(normalizedQuery));
      const matchesCategory = !categoryFilter || expense.category === categoryFilter;
      const matchesPaymentMethod = !paymentMethodFilter || expense.paymentMethod === paymentMethodFilter;
      return matchesQuery && matchesCategory && matchesPaymentMethod;
    });
  }, [categoryFilter, expenseQuery, expenses, paymentMethodFilter]);
  const expensePage = usePaginatedRows(filteredExpenses, 10);
  const selectedBranch = useMemo(() => branches.find((branch) => branch.id === branchId) ?? null, [branchId, branches]);
  const branchLocked = Boolean(branchId && branches.length === 1);

  async function loadExpenses(nextStatus = statusFilter, nextBranchId = branchId, nextStartDate = startDate, nextEndDate = endDate) {
    if (hasInvertedDateRange(nextStartDate, nextEndDate)) {
      setStatus(dateRangeErrorMessage());
      return;
    }

    setStatus("Syncing expenses...");

    try {
      const branchResponse = await fetchBranchOptions();
      setBranches(branchResponse.branches);

      if (!nextBranchId && !canUseAllBranches) {
        setExpenses([]);
        setStatus("Select a branch to load expenses");
        return;
      }

      const response = await fetchExpenses(nextBranchId, nextStatus || "all", activeUserId, nextStartDate, nextEndDate);
      setExpenses(response.expenses);
      setStatus("Expenses synced");
    } catch (error) {
      setBranches(fallbackBranches);
      setExpenses([]);
      setStatus(error instanceof Error ? error.message : "Unable to load expenses");
    }
  }

  useEffect(() => {
    void loadExpenses();
  }, []);

  useEffect(() => {
    if (
      !approvalHandoff ||
      approvalHandoff.type !== "expense" ||
      approvalHandoff.entityType !== "expense" ||
      approvalHandoff.status !== "approved" ||
      handledApprovalIdRef.current === approvalHandoff.id
    ) {
      return;
    }

    if (approvalHandoff.branchId && approvalHandoff.branchId !== branchId) {
      setBranchId(approvalHandoff.branchId);
      setForm(blankExpense(approvalHandoff.branchId));
      setStatusFilter("all");
      void loadExpenses("all", approvalHandoff.branchId);
      return;
    }

    const expense = expenses.find((item) => item.id === approvalHandoff.entityId);
    if (!expense) {
      setStatusFilter("all");
      void loadExpenses("all", approvalHandoff.branchId || branchId);
      setStatus(`Waiting for expense ${approvalHandoff.entityId}`);
      return;
    }

    handledApprovalIdRef.current = approvalHandoff.id;
    void approveExpenseFromHandoff(expense, approvalHandoff);
  }, [approvalHandoff?.id, branchId, expenses]);

  function updateForm<K extends keyof ExpensePayload>(key: K, value: ExpensePayload[K]) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  function closeModal() {
    setModalOpen(false);
    setForm(blankExpense(branchId));
  }

  function changeBranch(nextBranchId: string) {
    setBranchId(nextBranchId);
    setForm(blankExpense(nextBranchId));
    void loadExpenses(statusFilter, nextBranchId);
  }

  function clearExpenseFilters() {
    setExpenseQuery("");
    setCategoryFilter("");
    setPaymentMethodFilter("");
    setStartDate("");
    setEndDate("");
    void loadExpenses(statusFilter, branchId, "", "");
  }

  async function saveExpense(event: FormEvent) {
    event.preventDefault();

    if (!form.category) {
      setStatus("Select an expense category");
      return;
    }

    if (!form.paymentMethod) {
      setStatus("Select a payment method");
      return;
    }

    if (!form.status) {
      setStatus("Select an expense status");
      return;
    }

    if (!form.branchId) {
      setStatus("Select a branch before recording an expense");
      return;
    }

    setStatus("Recording expense...");

    try {
      const response = await createExpense(form, activeUserId);
      setExpenses((current) => [response.expense, ...current]);
      if (response.expense.status === "pending_approval") {
        await createApproval({
          branchId: response.expense.branchId,
          type: "expense",
          entityType: "expense",
          entityId: response.expense.id,
          amount: response.expense.amount,
          reason: response.expense.description
        });
        setStatus("Expense recorded and approval requested");
      } else {
        setStatus("Expense recorded");
      }
      closeModal();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Unable to record expense");
    }
  }

  async function changeStatus(expense: Expense, nextStatus: Extract<ExpenseStatus, "approved" | "paid" | "rejected" | "voided">) {
    setStatus(`Updating ${expense.description}...`);

    try {
      const response = await updateExpenseStatus(
        expense.id,
        nextStatus,
        `${nextStatus.replace("_", " ")} from expenses module`,
        expense.branchId,
        activeUserId
      );
      setExpenses((current) => current.map((item) => (item.id === response.expense.id ? response.expense : item)));
      setStatus(`Expense ${nextStatus.replace("_", " ")}`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Unable to update expense");
    }
  }

  async function approveExpenseFromHandoff(expense: Expense, approval: ApprovalRequest) {
    if (expense.status !== "pending_approval") {
      setStatus(`Expense ${expense.description} is already ${expense.status.replace("_", " ")}`);
      onApprovalHandoffConsumed?.();
      return;
    }

    setStatus(`Applying expense approval ${approval.id}...`);

    try {
      const response = await updateExpenseStatus(
        expense.id,
        "approved",
        approval.reason,
        expense.branchId,
        activeUserId
      );
      await applyApproval(approval.id, "expense", expense.id, "expense", expense.amount, approval.reason, activeUserId, expense.branchId);
      setExpenses((current) => current.map((item) => (item.id === response.expense.id ? response.expense : item)));
      setStatus(`Expense approval applied: ${approval.id}`);
      onApprovalHandoffConsumed?.();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Unable to apply expense approval");
    }
  }

  return (
    <div className="module-view">
      <div className="module-heading">
        <div>
          <p className="eyebrow">Financial controls</p>
          <h1>Expenses</h1>
        </div>
        <div className="button-group">
          <select className="compact-select" value={statusFilter} onChange={(event) => {
            setStatusFilter(event.target.value);
            void loadExpenses(event.target.value);
          }}>
            <option value="">Status</option>
            <option value="draft">Draft</option>
            <option value="pending_approval">Pending approval</option>
            <option value="approved">Approved</option>
            <option value="paid">Paid</option>
            <option value="rejected">Rejected</option>
            <option value="voided">Voided</option>
          </select>
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
                {branches.map((branch) => (
                  <option key={branch.id} value={branch.id}>{branch.name} - {branch.city}</option>
                ))}
              </select>
            )}
          </label>
          <button className="secondary-button" onClick={() => loadExpenses()}><RefreshCcw size={18} /> Sync</button>
          <button className="primary-button" onClick={() => setModalOpen(true)}><Plus size={18} /> Add expense</button>
        </div>
      </div>

      <section className="stats-grid">
        <StatCard label="Paid expenses" value={displayMoney(paidTotal)} detail={status} icon={CircleDollarSign} tone="dark" />
        <StatCard label="Pending approval" value={displayMoney(pendingTotal)} detail="Manager review" icon={ClipboardCheck} />
        <StatCard label="Approved unpaid" value={displayMoney(approvedUnpaid)} detail="Ready to settle" icon={Check} />
        <StatCard label="Rejected or voided" value={displayMoney(rejectedOrVoided)} detail="Blocked from payment" icon={X} />
      </section>

      <section className="panel">
        <div className="panel-header">
          <h2>Expense ledger</h2>
          <span>{filteredExpenses.length} of {expenses.length} records</span>
        </div>
        <div className="table-toolbar expense-filter-toolbar">
          <div className="search-box compact-search">
            <Search size={16} />
            <input value={expenseQuery} onChange={(event) => setExpenseQuery(event.target.value)} placeholder="Search description, vendor, reference or amount" />
            {expenseQuery ? (
              <button type="button" onClick={() => setExpenseQuery("")} aria-label="Clear expense search"><X size={14} /></button>
            ) : null}
          </div>
          <select value={categoryFilter} onChange={(event) => setCategoryFilter(event.target.value)}>
            <option value="">Category</option>
            {expenseCategories.map((category) => <option key={category} value={category}>{category}</option>)}
          </select>
          <select value={paymentMethodFilter} onChange={(event) => setPaymentMethodFilter(event.target.value)}>
            <option value="">Payment method</option>
            {paymentMethods.map((method) => <option key={method.value} value={method.value}>{method.label}</option>)}
          </select>
          <div className="date-range-filter expense-date-range-filter">
            <label>
              <span>Start</span>
              <input type="date" value={startDate} onChange={(event) => setStartDate(event.target.value)} />
            </label>
            <label>
              <span>End</span>
              <input type="date" value={endDate} onChange={(event) => setEndDate(event.target.value)} />
            </label>
          </div>
          <button className="secondary-button" type="button" onClick={() => loadExpenses(statusFilter, branchId, startDate, endDate)}>Apply dates</button>
          {(expenseQuery || categoryFilter || paymentMethodFilter || startDate || endDate) ? (
            <button className="secondary-button" type="button" onClick={clearExpenseFilters}>Clear filters</button>
          ) : null}
        </div>
        <div className="table-wrap">
          <table>
            <thead><tr><th>#</th><th>Date</th><th>Category</th><th>Description</th><th>Vendor</th><th>Method</th><th>Amount</th><th>Status</th><th>Actions</th></tr></thead>
            <tbody>
              {expensePage.pageRows.length === 0 ? (
                <tr><td colSpan={9}>No expenses recorded.</td></tr>
              ) : expensePage.pageRows.map((expense, index) => (
                <tr key={expense.id}>
                  <td className="number-cell">{expensePage.startIndex + index + 1}</td>
                  <td>{new Date(expense.spentAt).toLocaleDateString()}</td>
                  <td>{expense.category}</td>
                  <td><strong>{expense.description}</strong><br /><small>{expense.reference || expense.note || "No reference"}</small></td>
                  <td>{expense.vendor || "None"}</td>
                  <td>{expense.paymentMethod.replace("_", " ")}</td>
                  <td>{displayMoney(expense.amount)}</td>
                  <td><StatusBadge label={expense.status.replace("_", " ")} tone={statusTone(expense.status)} /></td>
                  <td className="row-actions">
                    <button disabled={expense.status !== "pending_approval"} onClick={() => changeStatus(expense, "approved")}>Approve</button>
                    <button disabled={expense.status !== "pending_approval"} onClick={() => changeStatus(expense, "rejected")}>Reject</button>
                    <button disabled={expense.status !== "approved"} onClick={() => changeStatus(expense, "paid")}>Pay</button>
                    <button disabled={expense.status === "paid" || expense.status === "voided"} onClick={() => changeStatus(expense, "voided")}>Void</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <TablePagination
          page={expensePage.page}
          pageCount={expensePage.pageCount}
          pageSize={expensePage.pageSize}
          totalRows={expensePage.totalRows}
          startIndex={expensePage.startIndex}
          visibleCount={expensePage.pageRows.length}
          onPageChange={expensePage.setPage}
          onPageSizeChange={expensePage.setPageSize}
        />
      </section>

      {modalOpen ? (
        <div className="modal-backdrop" role="presentation" onMouseDown={closeModal}>
          <section className="modal-panel branch-modal" role="dialog" aria-modal="true" aria-labelledby="expense-modal-title" onMouseDown={(event) => event.stopPropagation()}>
            <div className="modal-header">
              <div>
                <p className="eyebrow">Record branch cost</p>
                <h2 id="expense-modal-title">Add expense</h2>
              </div>
              <button className="icon-button" onClick={closeModal} aria-label="Close expense modal"><X size={18} /></button>
            </div>
            <form className="branch-form" onSubmit={saveExpense}>
              <label>
                Category
                <select value={form.category} onChange={(event) => updateForm("category", event.target.value)}>
                  <option value="">Category</option>
                  {expenseCategories.map((category) => <option key={category} value={category}>{category}</option>)}
                </select>
              </label>
              <label>
                Payment method
                <select value={form.paymentMethod} onChange={(event) => updateForm("paymentMethod", event.target.value as ExpensePaymentMethodCode)}>
                  <option value="">Payment method</option>
                  {paymentMethods.map((method) => <option key={method.value} value={method.value}>{method.label}</option>)}
                </select>
              </label>
              <label>
                Status
                <select value={form.status} onChange={(event) => updateForm("status", event.target.value as ExpenseStatus)}>
                  <option value="">Status</option>
                  <option value="draft">Draft</option>
                  <option value="pending_approval">Pending approval</option>
                  <option value="approved">Approved</option>
                  <option value="paid">Paid</option>
                </select>
              </label>
              <label>
                Branch
                {branchLocked ? (
                  <span className="locked-select-value">
                    <strong>{selectedBranch?.name ?? branchId}</strong>
                    <small>{selectedBranch?.city ?? "assigned"}</small>
                  </span>
                ) : (
                  <select value={form.branchId} onChange={(event) => updateForm("branchId", event.target.value)} required>
                    <option value="">Branch</option>
                    {branches.map((branch) => (
                      <option key={branch.id} value={branch.id}>{branch.name} - {branch.city}</option>
                    ))}
                  </select>
                )}
              </label>
              <label>
                Amount
                <input min={1} type="number" value={form.amount} onChange={(event) => updateForm("amount", Number(event.target.value))} required />
              </label>
              <label>
                Spent date
                <input
                  type="date"
                  value={form.spentAt.slice(0, 10)}
                  onChange={(event) => {
                    if (!event.target.value) return;
                    updateForm("spentAt", new Date(`${event.target.value}T12:00:00.000`).toISOString());
                  }}
                  required
                />
              </label>
              <label className="wide-field">
                Description
                <input value={form.description} onChange={(event) => updateForm("description", event.target.value)} required />
              </label>
              <label>
                Vendor
                <input value={form.vendor ?? ""} onChange={(event) => updateForm("vendor", event.target.value)} />
              </label>
              <label>
                Reference
                <input value={form.reference ?? ""} onChange={(event) => updateForm("reference", event.target.value)} />
              </label>
              <label className="wide-field">
                Note
                <input value={form.note ?? ""} onChange={(event) => updateForm("note", event.target.value)} />
              </label>
              <div className="form-summary">
                <span>Expenses above NGN 50,000 are queued for approval if marked paid.</span>
                <button className="primary-button" type="submit"><Check size={18} /> Save expense</button>
              </div>
            </form>
          </section>
        </div>
      ) : null}
    </div>
  );
}
