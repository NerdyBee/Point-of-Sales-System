import { Ban, MessageCircle, Printer, RefreshCcw, RotateCcw, Search, X } from "lucide-react";
import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import {
  applyApproval,
  createApproval,
  fetchBranchOptions,
  fetchSales,
  queueReceiptDelivery,
  readStoredAuth,
  refundSale,
  voidSale,
  type ApprovalRequest,
  type BranchOption,
  type CompletedSale,
  type SaleStatus
} from "../../shared/api/client";
import { StatusBadge } from "../../shared/components/StatusBadge";
import { TablePagination, usePaginatedRows } from "../../shared/components/TablePagination";
import { formatMoney, type CurrencyCode } from "../../shared/utils/money";
import { printReceipt } from "./receiptPrint";

const statusOptions: SaleStatus[] = ["completed", "partially_refunded", "refunded", "voided"];
const fallbackBranches: BranchOption[] = [];
const paymentFilterOptions = ["cash", "card", "bank_transfer", "mobile_money", "customer_credit", "voucher"];

function formatSaleDateTime(value: string) {
  return new Date(value).toLocaleString([], {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit"
  });
}

function saleTone(status: SaleStatus) {
  if (status === "completed") return "success";
  if (status === "voided") return "danger";
  if (status === "refunded") return "info";
  return "warning";
}

interface SalesHistoryViewProps {
  approvalHandoff?: ApprovalRequest | null;
  onApprovalHandoffConsumed?: () => void;
}

export function SalesHistoryView({ approvalHandoff, onApprovalHandoffConsumed }: SalesHistoryViewProps) {
  const storedAuth = useMemo(() => readStoredAuth(), []);
  const canUseAllBranches = storedAuth?.staff.role === "owner" || storedAuth?.staff.role === "state_manager";
  const initialBranchId = canUseAllBranches ? "" : storedAuth?.session.branchId ?? storedAuth?.staff.branchId ?? "";
  const activeUserId = storedAuth?.staff.id ?? "";
  const activePermissions = storedAuth?.staff.permissions ?? [];
  const canRefundSale = activePermissions.includes("sale.refund");
  const canVoidSale = activePermissions.includes("sale.void");
  const [sales, setSales] = useState<CompletedSale[]>([]);
  const [selectedSale, setSelectedSale] = useState<CompletedSale | null>(null);
  const [branchId, setBranchId] = useState(initialBranchId);
  const [branches, setBranches] = useState<BranchOption[]>(fallbackBranches);
  const [statusFilter, setStatusFilter] = useState<SaleStatus | "all" | "">("");
  const [query, setQuery] = useState("");
  const [paymentFilter, setPaymentFilter] = useState("");
  const [cashierFilter, setCashierFilter] = useState("");
  const [customerFilter, setCustomerFilter] = useState("");
  const [refundAmount, setRefundAmount] = useState(0);
  const [actionReason, setActionReason] = useState("Customer request");
  const [actionApprovalId, setActionApprovalId] = useState("");
  const [status, setStatus] = useState("Ready");
  const handledApprovalIdRef = useRef<string | null>(null);

  const filteredSales = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return sales.filter((sale) => {
      const matchesQuery = !needle || [
        sale.id,
        sale.terminalId,
        sale.cashierId,
        sale.customer?.name ?? "",
        sale.customer?.phone ?? "",
        sale.tableId ?? "",
        sale.tableOrderId ?? "",
        sale.status,
        ...sale.summary.lines.map((line) => `${line.name} ${line.productId}`),
        ...sale.payments.map((payment) => `${payment.method} ${payment.reference ?? ""} ${payment.amount}`)
      ].some((value) => value.toLowerCase().includes(needle));
      const matchesPayment = !paymentFilter || sale.payments.some((payment) => payment.method === paymentFilter);
      const matchesCashier = !cashierFilter || sale.cashierId === cashierFilter;
      const matchesCustomer =
        !customerFilter ||
        (customerFilter === "walk_in" && !sale.customer) ||
        (customerFilter === "account" && Boolean(sale.customer)) ||
        (customerFilter === "credit" && sale.payments.some((payment) => payment.method === "customer_credit"));

      return matchesQuery && matchesPayment && matchesCashier && matchesCustomer;
    });
  }, [cashierFilter, customerFilter, paymentFilter, query, sales]);
  const cashierOptions = useMemo(() => Array.from(new Set(sales.map((sale) => sale.cashierId))).sort(), [sales]);
  const completedTotal = useMemo(() => sales.filter((sale) => sale.status === "completed").reduce((sum, sale) => sum + sale.summary.total, 0), [sales]);
  const refundTotal = useMemo(() => sales.reduce((sum, sale) => sum + sale.refundTotal, 0), [sales]);
  const salesPage = usePaginatedRows(filteredSales, 10);
  const selectedBranch = useMemo(() => branches.find((branch) => branch.id === branchId) ?? null, [branchId, branches]);
  const branchLocked = Boolean(branchId && branches.length === 1);
  const activeCurrency = (selectedSale?.receipt.currency ?? sales[0]?.receipt.currency ?? "NGN") as CurrencyCode;
  const displayMoney = (amount: number, currency: CurrencyCode = activeCurrency) => formatMoney(amount, currency);
  const receiptMoney = (sale: CompletedSale, amount: number) => formatMoney(amount, sale.receipt.currency);

  async function loadSales(nextStatus = statusFilter, nextBranchId = branchId) {
    setStatus("Syncing sales...");

    try {
      const branchResponse = await fetchBranchOptions();
      setBranches(branchResponse.branches);

      if (!nextBranchId && !canUseAllBranches) {
        setSales([]);
        setSelectedSale(null);
        setRefundAmount(0);
        setStatus("Select a branch to load sales");
        return;
      }

      const response = await fetchSales(nextBranchId, nextStatus || "all", activeUserId);
      setSales(response.sales);
      setSelectedSale((current) => response.sales.find((sale) => sale.id === current?.id) ?? response.sales[0] ?? null);
      setRefundAmount(response.sales[0]?.summary.total ?? 0);
      setStatus(nextBranchId ? "Sales synced" : "Sales synced across accessible branches");
    } catch (error) {
      setBranches((current) => (current.length > 0 ? current : fallbackBranches));
      setSales([]);
      setSelectedSale(null);
      setStatus(error instanceof Error ? error.message : "Unable to load sales");
    }
  }

  useEffect(() => {
    void loadSales("all", initialBranchId);
  }, []);

  useEffect(() => {
    if (!approvalHandoff || approvalHandoff.entityType !== "sale" || approvalHandoff.status !== "approved" || handledApprovalIdRef.current === approvalHandoff.id) {
      return;
    }

    if (approvalHandoff.branchId && approvalHandoff.branchId !== branchId) {
      setBranchId(approvalHandoff.branchId);
      void loadSales(statusFilter, approvalHandoff.branchId);
      return;
    }

    setQuery(approvalHandoff.entityId);
    setActionApprovalId(approvalHandoff.id);
    setActionReason(approvalHandoff.reason);
    const sale = sales.find((item) => item.id === approvalHandoff.entityId);
    if (!sale) {
      setStatus(`Waiting for receipt ${approvalHandoff.entityId}`);
      return;
    }

    handledApprovalIdRef.current = approvalHandoff.id;
    setSelectedSale(sale);
    setRefundAmount(Math.min(approvalHandoff.amount, Math.max(sale.summary.total - sale.refundTotal, 0)));
    setStatus(`${approvalHandoff.type.replace("_", " ")} approval ready: ${approvalHandoff.id}`);
    onApprovalHandoffConsumed?.();
  }, [approvalHandoff?.id, branchId, sales, statusFilter]);

  function changeBranch(nextBranchId: string) {
    setBranchId(nextBranchId);
    setQuery("");
    setPaymentFilter("");
    setCashierFilter("");
    setCustomerFilter("");
    setActionApprovalId("");
    void loadSales(statusFilter, nextBranchId);
  }

  function chooseSale(sale: CompletedSale) {
    setSelectedSale(sale);
    setRefundAmount(Math.max(sale.summary.total - sale.refundTotal, 0));
    setActionReason(sale.status === "completed" ? "Customer request" : sale.refundReason ?? sale.voidReason ?? "Manager review");
    setActionApprovalId("");
  }

  function clearSalesFilters() {
    setQuery("");
    setPaymentFilter("");
    setCashierFilter("");
    setCustomerFilter("");
  }

  async function submitRefund(event: FormEvent) {
    event.preventDefault();

    if (!selectedSale) return;

    if (!activeUserId) {
      setStatus("Sign in before requesting receipt actions");
      return;
    }

    if (!actionApprovalId.trim()) {
      setStatus("Requesting refund approval...");

      try {
        const response = await createApproval({
          branchId: selectedSale.branchId,
          type: "refund",
          entityType: "sale",
          entityId: selectedSale.id,
          amount: refundAmount,
          reason: actionReason
        });
        setStatus(`Refund approval requested: ${response.approval.id}`);
      } catch (error) {
        setStatus(error instanceof Error ? error.message : "Unable to request refund approval");
      }
      return;
    }

    if (!canRefundSale) {
      setStatus("Your role can request refund approval, but cannot apply approved refunds");
      return;
    }

    setStatus("Applying approved refund...");

    try {
      const approvalResponse = await applyApproval(actionApprovalId.trim(), "sale", selectedSale.id, "refund", refundAmount, actionReason, activeUserId, selectedSale.branchId);
      const response = await refundSale(selectedSale.id, refundAmount, actionReason, selectedSale.branchId, activeUserId, approvalResponse.approval.id);
      setSales((current) => current.map((sale) => (sale.id === response.sale.id ? response.sale : sale)));
      setSelectedSale((current) => (current?.id === response.sale.id ? response.sale : current));
      setActionApprovalId("");
      setStatus("Refund recorded");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Unable to refund sale");
    }
  }

  async function submitVoid() {
    if (!selectedSale) return;

    if (!activeUserId) {
      setStatus("Sign in before requesting receipt actions");
      return;
    }

    if (!actionApprovalId.trim()) {
      setStatus("Requesting void approval...");

      try {
        const response = await createApproval({
          branchId: selectedSale.branchId,
          type: "void",
          entityType: "sale",
          entityId: selectedSale.id,
          amount: selectedSale.summary.total,
          reason: actionReason
        });
        setStatus(`Void approval requested: ${response.approval.id}`);
      } catch (error) {
        setStatus(error instanceof Error ? error.message : "Unable to request void approval");
      }
      return;
    }

    if (!canVoidSale) {
      setStatus("Your role can request void approval, but cannot apply approved voids");
      return;
    }

    setStatus("Applying approved void...");

    try {
      const approvalResponse = await applyApproval(actionApprovalId.trim(), "sale", selectedSale.id, "void", selectedSale.summary.total, actionReason, activeUserId, selectedSale.branchId);
      const response = await voidSale(selectedSale.id, actionReason, selectedSale.branchId, activeUserId, approvalResponse.approval.id);
      setSales((current) => current.map((sale) => (sale.id === response.sale.id ? response.sale : sale)));
      setSelectedSale((current) => (current?.id === response.sale.id ? response.sale : current));
      setActionApprovalId("");
      setStatus("Sale voided");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Unable to void sale");
    }
  }

  async function reprintReceipt() {
    if (!selectedSale?.receipt.printEnabled) {
      setStatus("No printer was captured for this receipt");
      return;
    }

    const printStarted = printReceipt({
      saleId: selectedSale.id,
      terminalId: selectedSale.terminalId,
      cashierId: selectedSale.cashierId,
      customerName: selectedSale.customer?.name,
      tableLabel: selectedSale.tableId,
      createdAt: selectedSale.createdAt,
      summary: selectedSale.summary,
      payments: selectedSale.payments,
      receipt: selectedSale.receipt,
      label: "Reprint"
    });
    setStatus(printStarted ? "Printing receipt reprint..." : "Allow pop-ups to reprint this receipt");

    try {
      await queueReceiptDelivery(selectedSale.id, "print", selectedSale.branchId, activeUserId);
      setStatus(`Reprint queued for ${selectedSale.receipt.printerName}`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Unable to queue receipt reprint");
    }
  }

  async function resendWhatsappReceipt() {
    if (!selectedSale?.receipt.whatsappEnabled) {
      setStatus("WhatsApp receipts were off for this sale");
      return;
    }

    setStatus("Queueing WhatsApp receipt...");

    try {
      await queueReceiptDelivery(selectedSale.id, "whatsapp", selectedSale.branchId, activeUserId);
      setStatus(`WhatsApp receipt queued for ${selectedSale.customer?.phone ?? "walk-in customer"}`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Unable to queue WhatsApp receipt");
    }
  }

  return (
    <div className="module-view">
      <div className="module-heading">
        <div>
          <p className="eyebrow">Receipts, refunds and voids</p>
          <h1>Sales history</h1>
        </div>
        <div className="button-group">
          {branchLocked ? (
            <span className="locked-select-value locked-select-value-compact">
              <strong>{selectedBranch?.name ?? branchId}</strong>
              <small>{selectedBranch?.city ?? "assigned"}</small>
            </span>
          ) : (
            <select className="compact-select" value={branchId} onChange={(event) => changeBranch(event.target.value)}>
              <option value="">{canUseAllBranches ? "All accessible branches" : "Branch"}</option>
              {branches.map((branch) => <option key={branch.id} value={branch.id}>{branch.name}</option>)}
            </select>
          )}
          <select className="compact-select" value={statusFilter} onChange={(event) => {
            const nextStatus = event.target.value as SaleStatus | "all" | "";
            setStatusFilter(nextStatus);
            void loadSales(nextStatus, branchId);
          }}>
            <option value="">Status</option>
            {statusOptions.map((option) => <option key={option} value={option}>{option.replace("_", " ")}</option>)}
          </select>
          <button className="secondary-button" onClick={() => loadSales(statusFilter, branchId)}><RefreshCcw size={18} /> Sync</button>
        </div>
      </div>

      <section className="stats-grid">
        <article className="stat-card">
          <div className="stat-card-top"><span>Loaded receipts</span></div>
          <strong>{sales.length}</strong>
          <small>{status}</small>
        </article>
        <article className="stat-card stat-card-dark">
          <div className="stat-card-top"><span>Completed sales</span></div>
          <strong>{displayMoney(completedTotal)}</strong>
          <small>Current filter view</small>
        </article>
        <article className="stat-card">
          <div className="stat-card-top"><span>Refund exposure</span></div>
          <strong>{displayMoney(refundTotal)}</strong>
          <small>Refunded value</small>
        </article>
      </section>

      <div className="sales-history-workflow">
        <section className="panel">
          <div className="panel-header">
            <h2>Receipt ledger</h2>
            <span>{filteredSales.length} of {sales.length} receipts</span>
          </div>
          <div className="table-toolbar sales-history-filter-toolbar">
            <div className="search-box compact-search">
              <Search size={16} />
              <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search receipt, customer, item or payment ref" />
              {query ? (
                <button type="button" onClick={() => setQuery("")} aria-label="Clear sales search"><X size={14} /></button>
              ) : null}
            </div>
            <select value={paymentFilter} onChange={(event) => setPaymentFilter(event.target.value)}>
              <option value="">Payment method</option>
              {paymentFilterOptions.map((method) => <option key={method} value={method}>{method.replace("_", " ")}</option>)}
            </select>
            <select value={cashierFilter} onChange={(event) => setCashierFilter(event.target.value)}>
              <option value="">Cashier</option>
              {cashierOptions.map((cashierId) => <option key={cashierId} value={cashierId}>{cashierId}</option>)}
            </select>
            <select value={customerFilter} onChange={(event) => setCustomerFilter(event.target.value)}>
              <option value="">Customer type</option>
              <option value="walk_in">Walk-in</option>
              <option value="account">Customer account</option>
              <option value="credit">Credit sale</option>
            </select>
            {(query || paymentFilter || cashierFilter || customerFilter) ? (
              <button className="secondary-button" type="button" onClick={clearSalesFilters}>Clear filters</button>
            ) : null}
          </div>
          <div className="table-wrap">
            <table>
              <thead><tr><th>#</th><th>Receipt</th><th>Customer</th><th>Terminal</th><th>Total</th><th>Refunded</th><th>Status</th><th>Date / time</th></tr></thead>
              <tbody>
                {salesPage.pageRows.length === 0 ? (
                  <tr><td colSpan={8}>No sales recorded yet. Complete a POS sale to populate this ledger.</td></tr>
                ) : (
                  salesPage.pageRows.map((sale, index) => (
                    <tr className={selectedSale?.id === sale.id ? "table-row-active" : ""} key={sale.id} onClick={() => chooseSale(sale)}>
                      <td className="number-cell">{salesPage.startIndex + index + 1}</td>
                      <td>{sale.id}</td>
                      <td>{sale.customer?.name ?? "Walk-in"}</td>
                      <td>{sale.terminalId}</td>
                      <td>{receiptMoney(sale, sale.summary.total)}</td>
                      <td>{receiptMoney(sale, sale.refundTotal)}</td>
                      <td><StatusBadge label={sale.status.replace("_", " ")} tone={saleTone(sale.status)} /></td>
                      <td>{formatSaleDateTime(sale.createdAt)}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
          <TablePagination
            page={salesPage.page}
            pageCount={salesPage.pageCount}
            pageSize={salesPage.pageSize}
            totalRows={salesPage.totalRows}
            startIndex={salesPage.startIndex}
            visibleCount={salesPage.pageRows.length}
            onPageChange={salesPage.setPage}
            onPageSizeChange={salesPage.setPageSize}
          />
        </section>

        <aside className="panel sales-detail-panel">
          <div className="panel-header">
            <h2>Receipt detail</h2>
            <span>{selectedSale?.id ?? "No selection"}</span>
          </div>
          {selectedSale ? (
            <>
              <div className="receipt-summary">
                <strong>{receiptMoney(selectedSale, selectedSale.summary.total)}</strong>
                <StatusBadge label={selectedSale.status.replace("_", " ")} tone={saleTone(selectedSale.status)} />
                <span>{selectedSale.cashierId} on {selectedSale.terminalId}</span>
                <span>{selectedSale.customer ? `${selectedSale.customer.name} - ${selectedSale.customer.group}` : "Walk-in customer"}</span>
                {selectedSale.tableId ? <span>{selectedSale.tableId}{selectedSale.tableOrderId ? ` - ${selectedSale.tableOrderId}` : ""}</span> : null}
              </div>
              <div className="receipt-profile-card">
                <div>
                  <span>Receipt profile</span>
                  <strong>{selectedSale.receipt.businessName}</strong>
                  <small>{selectedSale.receipt.taxId ?? "No tax ID"}</small>
                </div>
                <div>
                  <span>Delivery</span>
                  <strong>{selectedSale.receipt.printEnabled ? "Print ready" : "No printer"}</strong>
                  <small>{selectedSale.receipt.printerName ?? selectedSale.receipt.currency}</small>
                  <small>{selectedSale.receipt.whatsappEnabled ? "WhatsApp enabled" : "WhatsApp off"}</small>
                </div>
                <small>{selectedSale.receipt.footer}</small>
                <div className="receipt-actions">
                  <button className="secondary-button" disabled={!selectedSale.receipt.printEnabled} onClick={reprintReceipt}>
                    <Printer size={15} /> Reprint
                  </button>
                  <button className="secondary-button" disabled={!selectedSale.receipt.whatsappEnabled} onClick={resendWhatsappReceipt}>
                    <MessageCircle size={15} /> WhatsApp
                  </button>
                </div>
              </div>
              {selectedSale.customer ? (
                <div className="receipt-customer-card">
                  <div>
                    <span>Customer account</span>
                    <strong>{selectedSale.customer.phone}</strong>
                  </div>
                  <div>
                    <span>Loyalty</span>
                    <strong>{selectedSale.customer.loyaltyPoints} pts</strong>
                  </div>
                  <div>
                    <span>Balance</span>
                    <strong>{receiptMoney(selectedSale, selectedSale.customer.outstandingBalance)}</strong>
                  </div>
                </div>
              ) : null}
              <div className="stack">
                {selectedSale.summary.lines.map((line) => (
                  <div className="list-row" key={`${selectedSale.id}-${line.productId}`}>
                    <div>
                      <strong>{line.name}</strong>
                      <span>{line.quantity} x {receiptMoney(selectedSale, Math.round(line.subtotal / line.quantity))}</span>
                    </div>
                    <b>{receiptMoney(selectedSale, line.total)}</b>
                  </div>
                ))}
              </div>
              <div className="payment-mini-list">
                {selectedSale.payments.map((payment) => (
                  <span key={payment.id}>{payment.method.replace("_", " ")} {receiptMoney(selectedSale, payment.amount)}</span>
                ))}
              </div>
              <form className="sales-action-form" onSubmit={submitRefund}>
                <label>
                  Action reason
                  <input value={actionReason} onChange={(event) => setActionReason(event.target.value)} required />
                </label>
                <label>
                  Refund amount
                  <input type="number" min={1} max={selectedSale.summary.total - selectedSale.refundTotal} value={refundAmount} onChange={(event) => setRefundAmount(Number(event.target.value))} required />
                </label>
                {canRefundSale || canVoidSale ? (
                  <label>
                    Approved request ID
                    <input value={actionApprovalId} onChange={(event) => setActionApprovalId(event.target.value)} placeholder="Blank requests approval" />
                  </label>
                ) : null}
                <div className="approval-warning wide-field">
                  <span>Receipt action requires approval</span>
                  <strong>{receiptMoney(selectedSale, actionApprovalId.trim() ? refundAmount : Math.max(refundAmount, selectedSale.summary.total))}</strong>
                  <small>{actionApprovalId.trim() && (canRefundSale || canVoidSale) ? "Approved action will be posted" : "Manager approval request will be created"}</small>
                </div>
                <button className="secondary-button" disabled={selectedSale.status === "voided" || selectedSale.status === "refunded" || (actionApprovalId.trim().length > 0 && !canRefundSale)} type="submit">
                  <RotateCcw size={18} /> {actionApprovalId.trim() && canRefundSale ? "Apply refund" : "Request refund"}
                </button>
                <button className="danger-button" disabled={selectedSale.status !== "completed" || (actionApprovalId.trim().length > 0 && !canVoidSale)} type="button" onClick={submitVoid}>
                  <Ban size={18} /> {actionApprovalId.trim() && canVoidSale ? "Apply void" : "Request void"}
                </button>
              </form>
            </>
          ) : (
            <div className="empty-state">Select a receipt to inspect payments and actions.</div>
          )}
        </aside>
      </div>
    </div>
  );
}
