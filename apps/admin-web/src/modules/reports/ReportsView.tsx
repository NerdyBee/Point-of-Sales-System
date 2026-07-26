import { Download, FileBarChart, RefreshCcw, TrendingUp, WalletCards } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { fetchBranchOptions, fetchDashboardReport, readStoredAuth, type BranchOption, type DashboardReport, type ReportPeriod } from "../../shared/api/client";
import { StatCard } from "../../shared/components/StatCard";
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
  approvals: []
};

function csvEscape(value: string | number) {
  return `"${String(value).replaceAll("\"", "\"\"")}"`;
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
      ["section", "name", "quantity", "sales", "cost", "profit"],
      ...report.categorySales.map((item) => ["category", item.category, item.quantity, item.sales, item.cost, item.profit]),
      ...report.topProducts.map((item) => ["product", item.name, item.quantity, item.sales, "", item.profit]),
      ...paymentRows.map(([method, amount]) => ["payment", method, "", amount, "", ""])
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
      </section>

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
                {report.categorySales.length === 0 ? (
                  <tr><td colSpan={6}>No category sales for this period.</td></tr>
                ) : report.categorySales.map((item, index) => (
                  <tr key={item.category}><td className="number-cell">{index + 1}</td><td>{item.category}</td><td>{item.quantity}</td><td>{displayMoney(item.sales)}</td><td>{displayMoney(item.cost)}</td><td>{displayMoney(item.profit)}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
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
                {report.topProducts.length === 0 ? (
                  <tr><td colSpan={5}>No product sales for this period.</td></tr>
                ) : report.topProducts.map((item, index) => (
                  <tr key={item.id}><td className="number-cell">{index + 1}</td><td>{item.name}</td><td>{item.quantity}</td><td>{displayMoney(item.sales)}</td><td>{displayMoney(item.profit)}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section className="panel">
          <div className="panel-header">
            <h2>Controls</h2>
            <span>Approvals and stock</span>
          </div>
          <div className="stack">
            <div className="list-row"><div><strong>Pending approvals</strong><span>Manager queue</span></div><b>{report.summary.pendingApprovalCount}</b></div>
            <div className="list-row"><div><strong>Approval value</strong><span>Open exposure</span></div><b>{displayMoney(report.summary.pendingApprovalValue)}</b></div>
            <div className="list-row"><div><strong>Low stock</strong><span>Needs reorder</span></div><b>{report.summary.lowStockCount}</b></div>
            <div className="list-row"><div><strong>Audit events</strong><span>Control trail</span></div><b>{report.summary.auditEventCount}</b></div>
          </div>
        </section>
      </div>
    </div>
  );
}
