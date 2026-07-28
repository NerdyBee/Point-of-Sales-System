import { AlertTriangle, ClipboardCheck, Download, FileBarChart, RefreshCcw, TrendingUp, WalletCards } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { fetchBranchOptions, fetchDashboardReport, readStoredAuth, type BranchOption, type DashboardReport, type ReportPeriod } from "../../shared/api/client";
import { StatCard } from "../../shared/components/StatCard";
import { TablePagination, usePaginatedRows } from "../../shared/components/TablePagination";
import { useTenantSettings } from "../../shared/hooks/useTenantSettings";

const periods: Array<{ value: ReportPeriod; label: string }> = [
  { value: "today", label: "Daily" },
  { value: "week", label: "Weekly" },
  { value: "month", label: "Monthly" },
  { value: "year", label: "Yearly" },
  { value: "all", label: "All time" }
];

const fallbackBranches: BranchOption[] = [];

const emptyReport: DashboardReport = {
  period: "today",
  periodLabel: "Today",
  summary: {
    totalSales: 0,
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
  const { displayMoney } = useTenantSettings();
  const paymentRows = useMemo(() => Object.entries(report.paymentMix).sort(([, left], [, right]) => right - left), [report.paymentMix]);
  const hourlyPeak = useMemo(() => Math.max(1, ...report.hourlySales.map((item) => item.amount)), [report.hourlySales]);
  const lowStockRows = useMemo(
    () => [...report.lowStock].sort((left, right) => (left.stock - left.reorderPoint) - (right.stock - right.reorderPoint)),
    [report.lowStock]
  );
  const staffRows = useMemo(() => [...report.staffPerformance].sort((left, right) => right.salesTotal - left.salesTotal), [report.staffPerformance]);
  const categoryRows = useMemo(() => report.categorySales, [report.categorySales]);
  const topProductRows = useMemo(() => report.topProducts, [report.topProducts]);
  const cashMovementRows = useMemo(() => report.cashMovements, [report.cashMovements]);
  const approvalRows = useMemo(() => report.approvals, [report.approvals]);
  const staffPage = usePaginatedRows(staffRows, 10);
  const categoryPage = usePaginatedRows(categoryRows, 10);
  const lowStockPage = usePaginatedRows(lowStockRows, 10);
  const topProductPage = usePaginatedRows(topProductRows, 10);
  const cashMovementPage = usePaginatedRows(cashMovementRows, 10);
  const approvalPage = usePaginatedRows(approvalRows, 10);

  async function loadReport(nextPeriod = period, nextBranchId = branchId) {
    setStatus("Building report...");

    try {
      const branchResponse = await fetchBranchOptions();
      setBranches(branchResponse.branches);

      if (!nextBranchId) {
        setReport(emptyReport);
        setStatus("Select a branch to build reports");
        return;
      }

      const response = await fetchDashboardReport(nextBranchId, nextPeriod || "today", activeUserId);
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
      ...report.categorySales.map((item) => ["category", item.category, item.quantity, item.sales, item.cost, item.profit]),
      ...report.topProducts.map((item) => ["product", item.name, item.quantity, item.sales, "", item.profit]),
      ...paymentRows.map(([method, amount]) => ["payment", method, "", amount, "", ""]),
      ...report.cashMovements.map((item) => ["cash_movement", item.type, "", item.amount, "", "", `${item.reason}; created by ${item.createdBy}`]),
      ...report.hourlySales.map((item) => ["sales_trend", item.label, "", item.amount, "", ""]),
      ...lowStockRows.map((item) => ["low_stock", item.name, item.stock, "", "", "", `SKU ${item.sku}; reorder ${item.reorderPoint}`]),
      ...staffRows.map((item) => ["staff", item.name, "", item.salesTotal, "", "", `${item.role}; ${item.status}`]),
      ...report.approvals.map((item) => ["approval", item.reason, "", item.amount, "", "", `${item.type}; ${item.entityType}; requested by ${item.requestedBy}`])
    ];
    const csv = rows.map((row) => row.map((cell) => csvEscape(cell)).join(",")).join("\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `naijapos-report-${report.period}-${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(url);
    setStatus("Report exported");
  }

  function changeBranch(nextBranchId: string) {
    setBranchId(nextBranchId);
    void loadReport(period, nextBranchId);
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
            <select value={branchId} onChange={(event) => changeBranch(event.target.value)}>
              <option value="">Branch</option>
              {branches.map((branch) => <option key={branch.id} value={branch.id}>{branch.name}</option>)}
            </select>
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
          <button className="primary-button" onClick={exportCsv}><Download size={18} /> Export CSV</button>
        </div>
      </div>

      <section className="stats-grid">
        <StatCard label="Net sales" value={displayMoney(report.summary.totalSales)} detail={status} icon={FileBarChart} tone="dark" />
        <StatCard label="Gross profit" value={displayMoney(report.summary.grossProfit)} detail="Sales less product cost" icon={TrendingUp} />
        <StatCard label="Net profit" value={displayMoney(report.summary.netProfit)} detail={`${displayMoney(report.summary.expenseTotal)} expenses`} icon={WalletCards} />
        <StatCard label="Orders" value={String(report.summary.orderCount)} detail={report.periodLabel} icon={FileBarChart} />
        <StatCard label="Avg transaction" value={displayMoney(report.summary.averageTransaction)} detail="Per order value" icon={TrendingUp} />
        <StatCard label="Register cash" value={displayMoney(report.summary.openRegisterCash)} detail="Open register balance" icon={WalletCards} />
        <StatCard label="Cash movement net" value={displayMoney(report.summary.cashMovementNet)} detail={`${displayMoney(report.summary.cashMovementIn)} in / ${displayMoney(report.summary.cashMovementOut)} out`} icon={WalletCards} />
        <StatCard label="Approvals" value={String(report.summary.pendingApprovalCount)} detail={`${report.summary.highPriorityApprovalCount} high priority`} icon={ClipboardCheck} />
        <StatCard label="Low stock" value={String(report.summary.lowStockCount)} detail="Products below reorder point" icon={AlertTriangle} />
      </section>

      <div className="content-grid">
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
      </div>

      <div className="content-grid">
        <section className="panel">
          <div className="panel-header">
            <h2>Sales by category</h2>
            <span>{report.categorySales.length} categories</span>
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
      </div>

      <div className="content-grid">
        <section className="panel">
          <div className="panel-header">
            <h2>Top products</h2>
            <span>Revenue leaders</span>
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

      <section className="panel">
        <div className="panel-header">
          <h2>Approval queue</h2>
          <span>{report.approvals.length} pending</span>
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
    </div>
  );
}
