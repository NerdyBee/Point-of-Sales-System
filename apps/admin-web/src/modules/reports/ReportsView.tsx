import { AlertTriangle, ClipboardCheck, Download, FileBarChart, Printer, RefreshCcw, Search, TrendingUp, WalletCards, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { fetchBranchOptions, fetchDashboardReport, readStoredAuth, type BranchOption, type DashboardReport, type ReportPeriod } from "../../shared/api/client";
import { StatCard } from "../../shared/components/StatCard";
import { TablePagination, usePaginatedRows } from "../../shared/components/TablePagination";
import { useTenantSettings } from "../../shared/hooks/useTenantSettings";

type ReportFocus = "sales" | "inventory" | "staff" | "cash" | "customers" | "approvals";

const periods: Array<{ value: ReportPeriod; label: string }> = [
  { value: "today", label: "Daily" },
  { value: "week", label: "Weekly" },
  { value: "month", label: "Monthly" },
  { value: "year", label: "Yearly" },
  { value: "all", label: "All time" }
];

const reportFocusOptions: Array<{ value: ReportFocus; label: string }> = [
  { value: "sales", label: "Sales" },
  { value: "inventory", label: "Inventory" },
  { value: "staff", label: "Staff" },
  { value: "cash", label: "Cash movements" },
  { value: "customers", label: "Customer accounts" },
  { value: "approvals", label: "Approvals" }
];

const fallbackBranches: BranchOption[] = [];

const emptyReport: DashboardReport = {
  period: "today",
  periodLabel: "Today",
  summary: {
    totalSales: 0,
    taxableSales: 0,
    discountTotal: 0,
    serviceChargeTotal: 0,
    vatTotal: 0,
    orderCount: 0,
    averageTransaction: 0,
    grossProfit: 0,
    expenseTotal: 0,
    netProfit: 0,
    lowStockCount: 0,
    openRegisterCash: 0,
    cashMovementIn: 0,
    cashMovementOut: 0,
    cashMovementNet: 0,
    customerCount: 0,
    customerOutstandingBalance: 0,
    customerCreditLimit: 0,
    customerLoyaltyPoints: 0,
    customerAccountPayments: 0,
    customerAccountCreditIssued: 0,
    auditEventCount: 0,
    pendingApprovalCount: 0,
    pendingApprovalValue: 0,
    highPriorityApprovalCount: 0
  },
  hourlySales: [],
  lowStock: [],
  staffPerformance: [],
  paymentMix: {},
  categorySales: [],
  topProducts: [],
  cashMovements: [],
  approvals: []
};

function csvEscape(value: string | number) {
  return `"${String(value).replaceAll("\"", "\"\"")}"`;
}

function htmlEscape(value: string | number) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("\"", "&quot;")
    .replaceAll("'", "&#39;");
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
}

function formatStaffStatus(status: "active" | "inactive") {
  return status === "active" ? "Active" : "Inactive";
}

export function ReportsView() {
  const storedAuth = useMemo(() => readStoredAuth(), []);
  const activeUserId = storedAuth?.staff.id ?? "";
  const initialBranchId = storedAuth?.session.branchId ?? storedAuth?.staff.branchId ?? "";
  const [period, setPeriod] = useState<ReportPeriod | "">("");
  const [branchId, setBranchId] = useState(initialBranchId);
  const [branches, setBranches] = useState<BranchOption[]>(fallbackBranches);
  const [report, setReport] = useState<DashboardReport>(emptyReport);
  const [status, setStatus] = useState("Ready");
  const [reportFocus, setReportFocus] = useState<ReportFocus | "">("");
  const [searchTerm, setSearchTerm] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const { displayMoney } = useTenantSettings();
  const normalizedSearch = searchTerm.trim().toLowerCase();
  const paymentRows = useMemo(() => Object.entries(report.paymentMix).sort(([, left], [, right]) => right - left), [report.paymentMix]);
  const hourlyPeak = useMemo(() => Math.max(1, ...report.hourlySales.map((item) => item.amount)), [report.hourlySales]);
  const lowStockRows = useMemo(
    () => [...report.lowStock]
      .sort((left, right) => (left.stock - left.reorderPoint) - (right.stock - right.reorderPoint))
      .filter((item) => !normalizedSearch || [item.name, item.sku, String(item.stock), String(item.reorderPoint)].some((value) => value.toLowerCase().includes(normalizedSearch))),
    [report.lowStock, normalizedSearch]
  );
  const staffRows = useMemo(
    () => [...report.staffPerformance]
      .sort((left, right) => right.salesTotal - left.salesTotal)
      .filter((item) => !normalizedSearch || [item.name, item.role, item.status].some((value) => value.toLowerCase().includes(normalizedSearch))),
    [report.staffPerformance, normalizedSearch]
  );
  const categoryRows = useMemo(
    () => report.categorySales.filter((item) => !normalizedSearch || [item.category, String(item.quantity), String(item.sales), String(item.profit)].some((value) => value.toLowerCase().includes(normalizedSearch))),
    [report.categorySales, normalizedSearch]
  );
  const topProductRows = useMemo(
    () => report.topProducts.filter((item) => !normalizedSearch || [item.name, String(item.quantity), String(item.sales), String(item.profit)].some((value) => value.toLowerCase().includes(normalizedSearch))),
    [report.topProducts, normalizedSearch]
  );
  const cashMovementRows = useMemo(
    () => report.cashMovements.filter((item) => !normalizedSearch || [item.type, item.reason, item.createdBy, item.createdAt, String(item.amount)].some((value) => value.toLowerCase().includes(normalizedSearch))),
    [report.cashMovements, normalizedSearch]
  );
  const approvalRows = useMemo(
    () => report.approvals.filter((item) => !normalizedSearch || [item.type, item.entityType, item.entityId, item.reason, item.requestedBy, item.createdAt, String(item.amount)].some((value) => value.toLowerCase().includes(normalizedSearch))),
    [report.approvals, normalizedSearch]
  );
  const staffPage = usePaginatedRows(staffRows, 10);
  const categoryPage = usePaginatedRows(categoryRows, 10);
  const lowStockPage = usePaginatedRows(lowStockRows, 10);
  const topProductPage = usePaginatedRows(topProductRows, 10);
  const cashMovementPage = usePaginatedRows(cashMovementRows, 10);
  const approvalPage = usePaginatedRows(approvalRows, 10);
  const selectedBranch = useMemo(() => branches.find((branch) => branch.id === branchId) ?? null, [branchId, branches]);
  const branchLocked = Boolean(branchId && branches.length === 1);

  async function loadReport(nextPeriod = period, nextBranchId = branchId, nextStartDate = startDate, nextEndDate = endDate) {
    setStatus("Building report...");

    try {
      const branchResponse = await fetchBranchOptions();
      setBranches(branchResponse.branches);

      if (!nextBranchId) {
        setReport(emptyReport);
        setStatus("Select a branch to build reports");
        return;
      }

      const response = await fetchDashboardReport(nextBranchId, nextPeriod || "today", activeUserId, {
        startDate: nextStartDate,
        endDate: nextEndDate
      });
      setReport(response);
      setStatus(`${response.periodLabel} report ready`);
    } catch (error) {
      setBranches(fallbackBranches);
      setReport(emptyReport);
      setStatus(error instanceof Error ? error.message : "Unable to build report");
    }
  }

  useEffect(() => {
    void loadReport();
  }, []);

  function exportCsv() {
    const rows = [
      ["section", "name", "quantity", "sales", "cost", "profit", "meta"],
      ...(shouldShow("sales") ? categoryRows.map((item) => ["category", item.category, item.quantity, item.sales, item.cost, item.profit]) : []),
      ...(shouldShow("sales") ? topProductRows.map((item) => ["product", item.name, item.quantity, item.sales, "", item.profit]) : []),
      ...(shouldShow("sales") ? paymentRows.map(([method, amount]) => ["payment", method, "", amount, "", ""]) : []),
      ...(shouldShow("sales") ? report.hourlySales.map((item) => ["sales_trend", item.label, "", item.amount, "", ""]) : []),
      ...(shouldShow("sales") ? [
        ["tax_summary", "taxable_sales", "", report.summary.taxableSales, "", "", `${report.summary.discountTotal} discounts`],
        ["tax_summary", "vat_collected", "", report.summary.vatTotal, "", "", `${report.summary.serviceChargeTotal} service charge`]
      ] : []),
      ...(shouldShow("cash") ? cashMovementRows.map((item) => ["cash_movement", item.type, "", item.amount, "", "", `${item.reason}; created by ${item.createdBy}`]) : []),
      ...(shouldShow("customers") ? [
        ["customer_accounts", "outstanding_balance", report.summary.customerCount, report.summary.customerOutstandingBalance, "", "", `${report.summary.customerLoyaltyPoints} loyalty points; ${report.summary.customerCreditLimit} credit limit`],
        ["customer_accounts", "payments_received", "", report.summary.customerAccountPayments, "", "", `${report.summary.customerAccountCreditIssued} credit issued`]
      ] : []),
      ...(shouldShow("inventory") ? lowStockRows.map((item) => ["low_stock", item.name, item.stock, "", "", "", `SKU ${item.sku}; reorder ${item.reorderPoint}`]) : []),
      ...(shouldShow("staff") ? staffRows.map((item) => ["staff", item.name, "", item.salesTotal, "", "", `${item.role}; ${item.status}`]) : []),
      ...(shouldShow("approvals") ? approvalRows.map((item) => ["approval", item.reason, "", item.amount, "", "", `${item.type}; ${item.entityType}; requested by ${item.requestedBy}`]) : [])
    ];
    const csv = rows.map((row) => row.map((cell) => csvEscape(cell)).join(",")).join("\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url;
    const dateLabel = [startDate || report.period, endDate || new Date().toISOString().slice(0, 10)].join("-to-").replaceAll(" ", "-");
    link.download = `naijapos-report-${dateLabel}.csv`;
    link.click();
    URL.revokeObjectURL(url);
    setStatus("Report exported");
  }

  function printReport() {
    const branchLabel = selectedBranch ? `${selectedBranch.name}, ${selectedBranch.city}` : branchId || "All authorized branches";
    const generatedAt = new Date().toLocaleString();
    const focusLabel = reportFocusOptions.find((item) => item.value === reportFocus)?.label ?? "All sections";
    const row = (cells: Array<string | number>) => `<tr>${cells.map((cell) => `<td>${htmlEscape(cell)}</td>`).join("")}</tr>`;
    const money = (amount: number) => displayMoney(amount);
    const sections: string[] = [
      `<section><h2>Summary</h2><table><tbody>
        ${row(["Net sales", money(report.summary.totalSales), "Orders", report.summary.orderCount])}
        ${row(["Gross profit", money(report.summary.grossProfit), "Net profit", money(report.summary.netProfit)])}
        ${row(["Expenses", money(report.summary.expenseTotal), "Average transaction", money(report.summary.averageTransaction)])}
        ${row(["Taxable sales", money(report.summary.taxableSales), "VAT collected", money(report.summary.vatTotal)])}
        ${row(["Discounts", money(report.summary.discountTotal), "Service charge", money(report.summary.serviceChargeTotal)])}
        ${row(["Open register cash", money(report.summary.openRegisterCash), "Cash movement net", money(report.summary.cashMovementNet)])}
        ${row(["Credit exposure", money(report.summary.customerOutstandingBalance), "Pending approvals", report.summary.pendingApprovalCount])}
      </tbody></table></section>`
    ];

    if (shouldShow("sales")) {
      sections.push(`<section><h2>Sales By Category</h2><table><thead><tr><th>#</th><th>Category</th><th>Qty</th><th>Sales</th><th>Cost</th><th>Profit</th></tr></thead><tbody>${
        categoryRows.length ? categoryRows.map((item, index) => row([index + 1, item.category, item.quantity, money(item.sales), money(item.cost), money(item.profit)])).join("") : row(["", "No category sales", "", "", "", ""])
      }</tbody></table></section>`);
      sections.push(`<section><h2>Top Products</h2><table><thead><tr><th>#</th><th>Product</th><th>Qty</th><th>Sales</th><th>Profit</th></tr></thead><tbody>${
        topProductRows.length ? topProductRows.map((item, index) => row([index + 1, item.name, item.quantity, money(item.sales), money(item.profit)])).join("") : row(["", "No product sales", "", "", ""])
      }</tbody></table></section>`);
      sections.push(`<section><h2>Payment Mix</h2><table><thead><tr><th>#</th><th>Method</th><th>Amount</th></tr></thead><tbody>${
        paymentRows.length ? paymentRows.map(([method, amount], index) => row([index + 1, method.replaceAll("_", " "), money(amount)])).join("") : row(["", "No payments recorded", ""])
      }</tbody></table></section>`);
    }

    if (shouldShow("inventory")) {
      sections.push(`<section><h2>Low Stock Watch</h2><table><thead><tr><th>#</th><th>Product</th><th>SKU</th><th>Stock</th><th>Reorder</th></tr></thead><tbody>${
        lowStockRows.length ? lowStockRows.map((item, index) => row([index + 1, item.name, item.sku, item.stock, item.reorderPoint])).join("") : row(["", "No low-stock products", "", "", ""])
      }</tbody></table></section>`);
    }

    if (shouldShow("staff")) {
      sections.push(`<section><h2>Staff Performance</h2><table><thead><tr><th>#</th><th>Staff</th><th>Role</th><th>Sales</th><th>Status</th></tr></thead><tbody>${
        staffRows.length ? staffRows.map((item, index) => row([index + 1, item.name, item.role, money(item.salesTotal), formatStaffStatus(item.status)])).join("") : row(["", "No staff sales", "", "", ""])
      }</tbody></table></section>`);
    }

    if (shouldShow("customers")) {
      sections.push(`<section><h2>Customer Accounts</h2><table><tbody>
        ${row(["Customer accounts", report.summary.customerCount, "Outstanding balance", money(report.summary.customerOutstandingBalance)])}
        ${row(["Payments received", money(report.summary.customerAccountPayments), "Credit issued", money(report.summary.customerAccountCreditIssued)])}
        ${row(["Loyalty points", report.summary.customerLoyaltyPoints, "Credit limits", money(report.summary.customerCreditLimit)])}
      </tbody></table></section>`);
    }

    if (shouldShow("cash")) {
      sections.push(`<section><h2>Cash Movements</h2><table><thead><tr><th>#</th><th>Created</th><th>Type</th><th>Reason</th><th>Amount</th><th>Created by</th></tr></thead><tbody>${
        cashMovementRows.length ? cashMovementRows.map((item, index) => row([index + 1, formatDate(item.createdAt), item.type.replaceAll("_", " "), item.reason, money(item.amount), item.createdBy])).join("") : row(["", "No cash movements", "", "", "", ""])
      }</tbody></table></section>`);
    }

    if (shouldShow("approvals")) {
      sections.push(`<section><h2>Approval Queue</h2><table><thead><tr><th>#</th><th>Type</th><th>Reason</th><th>Amount</th><th>Requested by</th><th>Created</th></tr></thead><tbody>${
        approvalRows.length ? approvalRows.map((item, index) => row([index + 1, item.type.replaceAll("_", " "), item.reason, money(item.amount), item.requestedBy, formatDate(item.createdAt)])).join("") : row(["", "No pending approvals", "", "", "", ""])
      }</tbody></table></section>`);
    }

    const printWindow = window.open("", "_blank", "width=1120,height=820");
    if (!printWindow) {
      setStatus("Allow popups to print this report");
      return;
    }

    printWindow.document.write(`<!doctype html>
<html>
  <head>
    <title>NaijaPOS ${htmlEscape(report.periodLabel)} Report</title>
    <style>
      * { box-sizing: border-box; }
      body { color: #080326; font-family: Arial, sans-serif; margin: 0; padding: 28px; }
      header { border-bottom: 3px solid #080326; display: flex; justify-content: space-between; gap: 24px; margin-bottom: 20px; padding-bottom: 16px; }
      h1, h2, p { margin: 0; }
      h1 { font-size: 26px; }
      h2 { font-size: 16px; margin: 18px 0 8px; }
      p, span { color: #4b5563; font-size: 12px; }
      .meta { display: grid; gap: 4px; text-align: right; }
      table { border-collapse: collapse; page-break-inside: avoid; width: 100%; }
      th, td { border-bottom: 1px solid #d7dde8; font-size: 12px; padding: 8px; text-align: left; vertical-align: top; }
      th { background: #f3f6fa; color: #4b5563; text-transform: uppercase; }
      section { margin-bottom: 14px; }
      @media print { body { padding: 12mm; } }
    </style>
  </head>
  <body>
    <header>
      <div>
        <p>Operational reporting</p>
        <h1>NaijaPOS ${htmlEscape(report.periodLabel)} Report</h1>
        <p>${htmlEscape(branchLabel)} - ${htmlEscape(focusLabel)}</p>
      </div>
      <div class="meta">
        <span>Generated ${htmlEscape(generatedAt)}</span>
        <span>${htmlEscape(status)}</span>
      </div>
    </header>
    ${sections.join("")}
  </body>
</html>`);
    printWindow.document.close();
    printWindow.focus();
    printWindow.print();
    setStatus("Print report opened");
  }

  function changeBranch(nextBranchId: string) {
    setBranchId(nextBranchId);
    void loadReport(period, nextBranchId);
  }

  function shouldShow(focus: ReportFocus) {
    return !reportFocus || reportFocus === focus;
  }

  function clearReportFilters() {
    setSearchTerm("");
    setReportFocus("");
    setStartDate("");
    setEndDate("");
    void loadReport(period, branchId, "", "");
  }

  return (
    <div className="module-view">
      <div className="module-heading">
        <div>
          <p className="eyebrow">Operational reporting</p>
          <h1>Reports</h1>
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
          <select className="compact-select" value={period} onChange={(event) => {
            const nextPeriod = event.target.value as ReportPeriod | "";
            setPeriod(nextPeriod);
            void loadReport(nextPeriod, branchId);
          }}>
            <option value="">Period</option>
            {periods.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
          </select>
          <button className="secondary-button" onClick={() => loadReport()}><RefreshCcw size={18} /> Sync</button>
          <button className="secondary-button" onClick={printReport}><Printer size={18} /> Print/PDF</button>
          <button className="primary-button" onClick={exportCsv}><Download size={18} /> Export CSV</button>
        </div>
      </div>

      <div className="table-toolbar reports-filter-toolbar">
        <div className="search-box compact-search">
          <Search size={16} />
          <input value={searchTerm} onChange={(event) => setSearchTerm(event.target.value)} placeholder="Search reports, staff, SKU, reason or amount" />
          {searchTerm ? (
            <button type="button" onClick={() => setSearchTerm("")} aria-label="Clear report search"><X size={14} /></button>
          ) : null}
        </div>
        <select value={reportFocus} onChange={(event) => setReportFocus(event.target.value as ReportFocus | "")}>
          <option value="">Report section</option>
          {reportFocusOptions.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
        </select>
        <div className="date-range-filter">
          <label>
            <span>Start</span>
            <input type="date" value={startDate} onChange={(event) => setStartDate(event.target.value)} />
          </label>
          <label>
            <span>End</span>
            <input type="date" value={endDate} onChange={(event) => setEndDate(event.target.value)} />
          </label>
        </div>
        <button className="secondary-button" type="button" onClick={() => loadReport(period, branchId)}>Apply dates</button>
        {(searchTerm || reportFocus || startDate || endDate) ? (
          <button className="secondary-button" type="button" onClick={clearReportFilters}>Clear filters</button>
        ) : null}
      </div>

      <section className="stats-grid">
        <StatCard label="Net sales" value={displayMoney(report.summary.totalSales)} detail={status} icon={FileBarChart} tone="dark" />
        <StatCard label="Taxable sales" value={displayMoney(report.summary.taxableSales)} detail={`${displayMoney(report.summary.discountTotal)} discounts`} icon={FileBarChart} />
        <StatCard label="VAT collected" value={displayMoney(report.summary.vatTotal)} detail={`${displayMoney(report.summary.serviceChargeTotal)} service charge`} icon={FileBarChart} />
        <StatCard label="Gross profit" value={displayMoney(report.summary.grossProfit)} detail="Sales less product cost" icon={TrendingUp} />
        <StatCard label="Net profit" value={displayMoney(report.summary.netProfit)} detail={`${displayMoney(report.summary.expenseTotal)} expenses`} icon={WalletCards} />
        <StatCard label="Orders" value={String(report.summary.orderCount)} detail={report.periodLabel} icon={FileBarChart} />
        <StatCard label="Avg transaction" value={displayMoney(report.summary.averageTransaction)} detail="Per order value" icon={TrendingUp} />
        <StatCard label="Register cash" value={displayMoney(report.summary.openRegisterCash)} detail="Open register balance" icon={WalletCards} />
        <StatCard label="Cash movement net" value={displayMoney(report.summary.cashMovementNet)} detail={`${displayMoney(report.summary.cashMovementIn)} in / ${displayMoney(report.summary.cashMovementOut)} out`} icon={WalletCards} />
        <StatCard label="Credit exposure" value={displayMoney(report.summary.customerOutstandingBalance)} detail={`${report.summary.customerCount} customer accounts`} icon={WalletCards} />
        <StatCard label="Account payments" value={displayMoney(report.summary.customerAccountPayments)} detail={`${displayMoney(report.summary.customerAccountCreditIssued)} credit issued`} icon={WalletCards} />
        <StatCard label="Loyalty liability" value={String(report.summary.customerLoyaltyPoints)} detail={`${displayMoney(report.summary.customerCreditLimit)} credit limits`} icon={TrendingUp} />
        <StatCard label="Approvals" value={String(report.summary.pendingApprovalCount)} detail={`${report.summary.highPriorityApprovalCount} high priority`} icon={ClipboardCheck} />
        <StatCard label="Low stock" value={String(report.summary.lowStockCount)} detail="Products below reorder point" icon={AlertTriangle} />
      </section>

      {shouldShow("sales") || shouldShow("staff") ? (
      <div className="content-grid">
        {shouldShow("sales") && (
        <section className="panel">
          <div className="panel-header">
            <h2>Sales trend</h2>
            <span>{report.periodLabel}</span>
          </div>
          <div className="stack">
            {report.hourlySales.length === 0 ? <div className="empty-state">No sales trend for this period.</div> : report.hourlySales.map((item) => (
              <div className="report-progress-row" key={item.label}>
                <div>
                  <strong>{item.label}</strong>
                  <span>{displayMoney(item.amount)}</span>
                </div>
                <div className="report-progress-track"><span style={{ width: `${Math.max(3, (item.amount / hourlyPeak) * 100)}%` }} /></div>
              </div>
            ))}
          </div>
        </section>
        )}

        {shouldShow("staff") && (
        <section className="panel">
          <div className="panel-header">
            <h2>Staff performance</h2>
            <span>{staffRows.length} staff</span>
          </div>
          <div className="table-wrap">
            <table>
              <thead><tr><th>#</th><th>Staff</th><th>Role</th><th>Sales</th><th>Status</th></tr></thead>
              <tbody>
                {staffPage.pageRows.length === 0 ? (
                  <tr><td colSpan={5}>No staff sales for this period.</td></tr>
                ) : staffPage.pageRows.map((item, index) => (
                  <tr key={item.id}>
                    <td className="number-cell">{staffPage.startIndex + index + 1}</td>
                    <td>{item.name}</td>
                    <td>{item.role}</td>
                    <td>{displayMoney(item.salesTotal)}</td>
                    <td><span className={`status-badge ${item.status === "active" ? "status-success" : "status-warning"}`}>{formatStaffStatus(item.status)}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <TablePagination
            page={staffPage.page}
            pageCount={staffPage.pageCount}
            pageSize={staffPage.pageSize}
            totalRows={staffPage.totalRows}
            startIndex={staffPage.startIndex}
            visibleCount={staffPage.pageRows.length}
            onPageChange={staffPage.setPage}
            onPageSizeChange={staffPage.setPageSize}
          />
        </section>
        )}
      </div>
      ) : null}

      {shouldShow("sales") || shouldShow("inventory") ? (
      <div className="content-grid">
        {shouldShow("sales") && (
        <section className="panel">
          <div className="panel-header">
            <h2>Sales by category</h2>
            <span>{categoryRows.length} categories</span>
          </div>
          <div className="table-wrap">
            <table>
              <thead><tr><th>#</th><th>Category</th><th>Qty</th><th>Sales</th><th>Cost</th><th>Profit</th></tr></thead>
              <tbody>
                {categoryPage.pageRows.length === 0 ? (
                  <tr><td colSpan={6}>No category sales for this period.</td></tr>
                ) : categoryPage.pageRows.map((item, index) => (
                  <tr key={item.category}><td className="number-cell">{categoryPage.startIndex + index + 1}</td><td>{item.category}</td><td>{item.quantity}</td><td>{displayMoney(item.sales)}</td><td>{displayMoney(item.cost)}</td><td>{displayMoney(item.profit)}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
          <TablePagination
            page={categoryPage.page}
            pageCount={categoryPage.pageCount}
            pageSize={categoryPage.pageSize}
            totalRows={categoryPage.totalRows}
            startIndex={categoryPage.startIndex}
            visibleCount={categoryPage.pageRows.length}
            onPageChange={categoryPage.setPage}
            onPageSizeChange={categoryPage.setPageSize}
          />
        </section>
        )}

        {shouldShow("inventory") && (
        <section className="panel">
          <div className="panel-header">
            <h2>Low-stock watch</h2>
            <span>{lowStockRows.length} products</span>
          </div>
          <div className="table-wrap">
            <table>
              <thead><tr><th>#</th><th>Product</th><th>SKU</th><th>Stock</th><th>Reorder</th></tr></thead>
              <tbody>
                {lowStockPage.pageRows.length === 0 ? (
                  <tr><td colSpan={5}>No low-stock products for this branch.</td></tr>
                ) : lowStockPage.pageRows.map((item, index) => (
                  <tr key={item.id}>
                    <td className="number-cell">{lowStockPage.startIndex + index + 1}</td>
                    <td>{item.name}</td>
                    <td>{item.sku}</td>
                    <td>{item.stock}</td>
                    <td>{item.reorderPoint}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <TablePagination
            page={lowStockPage.page}
            pageCount={lowStockPage.pageCount}
            pageSize={lowStockPage.pageSize}
            totalRows={lowStockPage.totalRows}
            startIndex={lowStockPage.startIndex}
            visibleCount={lowStockPage.pageRows.length}
            onPageChange={lowStockPage.setPage}
            onPageSizeChange={lowStockPage.setPageSize}
          />
        </section>
        )}
      </div>
      ) : null}

      {shouldShow("sales") && (
      <div className="content-grid">
        <section className="panel">
          <div className="panel-header">
            <h2>Top products</h2>
            <span>{topProductRows.length} revenue leaders</span>
          </div>
          <div className="table-wrap">
            <table>
              <thead><tr><th>#</th><th>Product</th><th>Qty</th><th>Sales</th><th>Profit</th></tr></thead>
              <tbody>
                {topProductPage.pageRows.length === 0 ? (
                  <tr><td colSpan={5}>No product sales for this period.</td></tr>
                ) : topProductPage.pageRows.map((item, index) => (
                  <tr key={item.id}><td className="number-cell">{topProductPage.startIndex + index + 1}</td><td>{item.name}</td><td>{item.quantity}</td><td>{displayMoney(item.sales)}</td><td>{displayMoney(item.profit)}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
          <TablePagination
            page={topProductPage.page}
            pageCount={topProductPage.pageCount}
            pageSize={topProductPage.pageSize}
            totalRows={topProductPage.totalRows}
            startIndex={topProductPage.startIndex}
            visibleCount={topProductPage.pageRows.length}
            onPageChange={topProductPage.setPage}
            onPageSizeChange={topProductPage.setPageSize}
          />
        </section>

        <section className="panel">
          <div className="panel-header">
            <h2>Payment summary</h2>
            <span>{report.periodLabel}</span>
          </div>
          <div className="stack">
            {paymentRows.length === 0 ? <div className="empty-state">No payments recorded.</div> : paymentRows.map(([method, amount]) => (
              <div className="list-row" key={method}>
                <div><strong>{method.replace("_", " ")}</strong><span>Collected</span></div>
                <b>{displayMoney(amount)}</b>
              </div>
            ))}
          </div>
        </section>
      </div>
      )}

      {shouldShow("customers") && (
      <section className="panel">
        <div className="panel-header">
          <h2>Customer account report</h2>
          <span>{report.periodLabel}</span>
        </div>
        <div className="category-summary-strip">
          <span><strong>{report.summary.customerCount}</strong><small>customer accounts</small></span>
          <span><strong>{displayMoney(report.summary.customerOutstandingBalance)}</strong><small>outstanding balance</small></span>
          <span><strong>{displayMoney(report.summary.customerAccountPayments)}</strong><small>payments received</small></span>
          <span><strong>{displayMoney(report.summary.customerAccountCreditIssued)}</strong><small>credit issued</small></span>
          <span><strong>{report.summary.customerLoyaltyPoints}</strong><small>loyalty points</small></span>
          <span><strong>{displayMoney(report.summary.customerCreditLimit)}</strong><small>total credit limit</small></span>
        </div>
      </section>
      )}

      {shouldShow("approvals") && (
      <section className="panel">
        <div className="panel-header">
          <h2>Approval queue</h2>
          <span>{approvalRows.length} pending</span>
        </div>
        <div className="table-wrap">
          <table>
            <thead><tr><th>#</th><th>Type</th><th>Reason</th><th>Amount</th><th>Requested by</th><th>Created</th></tr></thead>
            <tbody>
              {approvalPage.pageRows.length === 0 ? (
                <tr><td colSpan={6}>No pending approvals for this branch.</td></tr>
              ) : approvalPage.pageRows.map((item, index) => (
                <tr key={item.id}>
                  <td className="number-cell">{approvalPage.startIndex + index + 1}</td>
                  <td><span className="status-badge status-info">{item.type.replace("_", " ")}</span></td>
                  <td>{item.reason}</td>
                  <td>{displayMoney(item.amount)}</td>
                  <td>{item.requestedBy}</td>
                  <td>{formatDate(item.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
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
      )}

      {shouldShow("cash") && (
      <section className="panel">
        <div className="panel-header">
          <h2>Cash movement report</h2>
          <span>{cashMovementRows.length} recent</span>
        </div>
        <div className="table-wrap">
          <table>
            <thead><tr><th>#</th><th>Created</th><th>Type</th><th>Reason</th><th>Amount</th><th>Created by</th></tr></thead>
            <tbody>
              {cashMovementPage.pageRows.length === 0 ? (
                <tr><td colSpan={6}>No cash movements for this report period.</td></tr>
              ) : cashMovementPage.pageRows.map((item, index) => {
                const incoming = item.type === "cash_in" || item.type === "paid_in";
                return (
                  <tr key={item.id}>
                    <td className="number-cell">{cashMovementPage.startIndex + index + 1}</td>
                    <td>{formatDate(item.createdAt)}</td>
                    <td><span className={`status-badge ${incoming ? "status-success" : "status-warning"}`}>{item.type.replace("_", " ")}</span></td>
                    <td>{item.reason}</td>
                    <td><strong>{incoming ? "+" : "-"}{displayMoney(item.amount)}</strong></td>
                    <td>{item.createdBy}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <TablePagination
          page={cashMovementPage.page}
          pageCount={cashMovementPage.pageCount}
          pageSize={cashMovementPage.pageSize}
          totalRows={cashMovementPage.totalRows}
          startIndex={cashMovementPage.startIndex}
          visibleCount={cashMovementPage.pageRows.length}
          onPageChange={cashMovementPage.setPage}
          onPageSizeChange={cashMovementPage.setPageSize}
        />
      </section>
      )}
    </div>
  );
}
