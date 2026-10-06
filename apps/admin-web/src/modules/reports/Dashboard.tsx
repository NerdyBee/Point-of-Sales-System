import { Banknote, ClipboardCheck, PackageSearch, ReceiptText, RefreshCcw, ShieldAlert, ShoppingBasket, TrendingUp, WalletCards } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { fetchBranchOptions, fetchDashboardReport, readStoredAuth, type BranchOption, type DashboardReport, type ReportPeriod } from "../../shared/api/client";
import { StatCard } from "../../shared/components/StatCard";
import { TablePagination, usePaginatedRows } from "../../shared/components/TablePagination";
import { useTenantSettings } from "../../shared/hooks/useTenantSettings";

const defaultBranchId = "";
const fallbackBranches: BranchOption[] = [];

const fallbackReport: DashboardReport = {
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

const reportPeriodOptions: Array<{ value: ReportPeriod; label: string }> = [
  { value: "today", label: "Daily" },
  { value: "week", label: "Weekly" },
  { value: "month", label: "Monthly" },
  { value: "year", label: "Yearly" },
  { value: "all", label: "All time" }
];

function formatLabel(value: string) {
  return value.replaceAll("_", " ");
}

function formatStaffStatus(status: "active" | "inactive") {
  return status === "active" ? "Active" : "Inactive";
}

interface DashboardProps {
  onNewSale?: () => void;
  onOpenApprovals?: () => void;
  onOpenAudit?: () => void;
  onOpenInventory?: () => void;
  onOpenRegisters?: () => void;
}

export function Dashboard({ onNewSale, onOpenApprovals, onOpenAudit, onOpenInventory, onOpenRegisters }: DashboardProps) {
  const storedAuth = useMemo(() => readStoredAuth(), []);
  const activeUserId = storedAuth?.staff.id ?? "";
  const canUseAllBranches = storedAuth?.staff.role === "owner" || storedAuth?.staff.role === "state_manager";
  const initialBranchId = canUseAllBranches ? "" : storedAuth?.session.branchId ?? storedAuth?.staff.branchId ?? defaultBranchId;
  const [report, setReport] = useState<DashboardReport>(fallbackReport);
  const [branchId, setBranchId] = useState(initialBranchId);
  const [branches, setBranches] = useState<BranchOption[]>(fallbackBranches);
  const [reportPeriod, setReportPeriod] = useState<ReportPeriod | "">("");
  const [status, setStatus] = useState("Ready");
  const { displayMoney } = useTenantSettings();
  const maxHourlySale = useMemo(() => Math.max(...report.hourlySales.map((item) => item.amount), 1), [report.hourlySales]);
  const paymentRows = useMemo(() => Object.entries(report.paymentMix).sort(([, left], [, right]) => right - left), [report.paymentMix]);
  const maxCategorySale = useMemo(() => Math.max(...report.categorySales.map((item) => item.sales), 1), [report.categorySales]);
  const selectedBranch = useMemo(() => branches.find((branch) => branch.id === branchId), [branchId, branches]);
  const branchLocked = Boolean(branchId && branches.length === 1);
  const staffRows = useMemo(() => [...report.staffPerformance].sort((left, right) => right.salesTotal - left.salesTotal), [report.staffPerformance]);
  const staffPage = usePaginatedRows(staffRows, 10);

  async function loadDashboard(nextBranchId = branchId, nextPeriod = reportPeriod) {
    setStatus("Syncing dashboard...");

    try {
      if (!nextBranchId && !canUseAllBranches) {
        setBranches([]);
        setReport(fallbackReport);
        setStatus("Select a branch");
        return;
      }

      const [branchResponse, response] = await Promise.all([
        fetchBranchOptions(),
        fetchDashboardReport(nextBranchId, nextPeriod || "today", activeUserId)
      ]);
      setBranches(branchResponse.branches.length ? branchResponse.branches : fallbackBranches);
      setReport(response);
      setStatus(nextBranchId ? `${response.periodLabel} synced` : `${response.periodLabel} synced across accessible branches`);
    } catch (error) {
      setBranches(fallbackBranches);
      setReport(fallbackReport);
      setStatus(error instanceof Error ? error.message : "Unable to load dashboard");
    }
  }

  useEffect(() => {
    void loadDashboard();
  }, [reportPeriod, branchId]);

  function changeBranch(nextBranchId: string) {
    setBranchId(nextBranchId);
  }

  return (
    <div className="module-view">
      <div className="module-heading">
        <div>
          <p className="eyebrow">Owner dashboard</p>
          <h1>Executive overview</h1>
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
                <option value="">{canUseAllBranches ? "All accessible branches" : "Branch"}</option>
                {branches.map((branch) => <option key={branch.id} value={branch.id}>{branch.name}</option>)}
              </select>
            )}
          </label>
          <select className="compact-select" value={reportPeriod} onChange={(event) => setReportPeriod(event.target.value as ReportPeriod | "")}>
            <option value="">Period</option>
            {reportPeriodOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
          </select>
          <button className="secondary-button" onClick={() => void loadDashboard()}><RefreshCcw size={18} /> Sync</button>
          <button className="primary-button" onClick={onNewSale}>
            <ReceiptText size={18} />
            New sale
          </button>
        </div>
      </div>

      <section className="stats-grid">
        <StatCard label="Total sales" value={displayMoney(report.summary.totalSales)} detail={status} icon={Banknote} />
        <StatCard label="VAT collected" value={displayMoney(report.summary.vatTotal)} detail={`${displayMoney(report.summary.serviceChargeTotal)} service charge`} icon={ReceiptText} />
        <StatCard label="Orders" value={String(report.summary.orderCount)} detail={report.periodLabel} icon={ShoppingBasket} />
        <StatCard label="Avg. transaction" value={displayMoney(report.summary.averageTransaction)} detail="Selected period" icon={TrendingUp} />
        <StatCard label="Net profit" value={displayMoney(report.summary.netProfit)} detail={`${displayMoney(report.summary.expenseTotal)} expenses`} icon={Banknote} tone="dark" />
        <StatCard label="Pending approvals" value={String(report.summary.pendingApprovalCount)} detail={displayMoney(report.summary.pendingApprovalValue)} icon={ClipboardCheck} />
        <StatCard label="Credit exposure" value={displayMoney(report.summary.customerOutstandingBalance)} detail={`${report.summary.customerCount} customer accounts`} icon={WalletCards} />
        <StatCard label="Account payments" value={displayMoney(report.summary.customerAccountPayments)} detail={`${displayMoney(report.summary.customerAccountCreditIssued)} credit issued`} icon={WalletCards} />
        <StatCard label="Cash movement net" value={displayMoney(report.summary.cashMovementNet)} detail={`${displayMoney(report.summary.cashMovementIn)} in / ${displayMoney(report.summary.cashMovementOut)} out`} icon={Banknote} />
      </section>

      <div className="content-grid">
        <section className="panel wide-panel">
          <div className="panel-header">
            <h2>{report.period === "today" ? "Hourly sales trends" : "Period sales trends"}</h2>
            <span>{report.periodLabel} - {report.summary.auditEventCount} audit events</span>
          </div>
          <div className="bar-chart" aria-label="Hourly sales chart">
            {report.hourlySales.map((item) => (
              <div className="bar-column" key={item.label}>
                <div className="bar" style={{ height: `${Math.max((item.amount / maxHourlySale) * 100, item.amount ? 8 : 2)}%` }} />
                <span>{item.label}</span>
              </div>
            ))}
          </div>
        </section>

        <section className="panel">
          <div className="panel-header">
            <h2>Low stock alerts</h2>
            <button className="icon-button" onClick={onOpenInventory} aria-label="Open inventory"><PackageSearch size={18} /></button>
          </div>
          <div className="stack">
            {report.lowStock.length === 0 ? (
              <div className="empty-state">No low stock items.</div>
            ) : (
              report.lowStock.map((product) => (
                <div className="list-row" key={product.id}>
                  <div>
                    <strong>{product.name}</strong>
                    <span>{product.sku} - reorder at {product.reorderPoint}</span>
                  </div>
                  <div className="row-action-stack">
                    <b>{product.stock}</b>
                    <button onClick={onOpenInventory}>Restock</button>
                  </div>
                </div>
              ))
            )}
          </div>
        </section>
      </div>

      <div className="content-grid">
        <section className="panel">
          <div className="panel-header">
            <h2>Category margin</h2>
            <span>{report.categorySales.length} categories</span>
          </div>
          <div className="stack">
            {report.categorySales.length === 0 ? (
              <div className="empty-state">No category sales yet.</div>
            ) : (
              report.categorySales.map((category) => (
                <div className="report-progress-row" key={category.category}>
                  <div>
                    <strong>{category.category}</strong>
                    <span>{category.quantity} sold - {displayMoney(category.profit)} profit</span>
                  </div>
                  <b>{displayMoney(category.sales)}</b>
                  <div className="report-progress-track"><span style={{ width: `${Math.max((category.sales / maxCategorySale) * 100, 4)}%` }} /></div>
                </div>
              ))
            )}
          </div>
        </section>

        <section className="panel">
          <div className="panel-header">
            <h2>Top products</h2>
            <span>By sales value</span>
          </div>
          <div className="stack">
            {report.topProducts.length === 0 ? (
              <div className="empty-state">No product sales yet.</div>
            ) : (
              report.topProducts.map((product) => (
                <div className="list-row" key={product.id}>
                  <div>
                    <strong>{product.name}</strong>
                    <span>{product.quantity} sold - {displayMoney(product.profit)} profit</span>
                  </div>
                  <b>{displayMoney(product.sales)}</b>
                </div>
              ))
            )}
          </div>
        </section>
      </div>

      <div className="content-grid">
        <section className="panel">
          <div className="panel-header">
            <h2>Staff performance</h2>
            <span>{selectedBranch ? `${selectedBranch.name}, ${selectedBranch.city}` : "Selected branch"}</span>
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr><th>#</th><th>Staff</th><th>Role</th><th>Sales</th><th>Status</th></tr>
              </thead>
              <tbody>
                {staffPage.pageRows.length === 0 ? (
                  <tr><td colSpan={5}>No staff sales for this period.</td></tr>
                ) : staffPage.pageRows.map((member, index) => (
                  <tr key={member.id}>
                    <td className="number-cell">{staffPage.startIndex + index + 1}</td>
                    <td>{member.name}</td>
                    <td>{member.role}</td>
                    <td>{displayMoney(member.salesTotal)}</td>
                    <td>{formatStaffStatus(member.status)}</td>
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

        <section className="panel">
          <div className="panel-header">
            <h2>Payment mix</h2>
            <WalletCards size={20} />
          </div>
          <div className="stack">
            <div className="list-row">
              <div>
                <strong>Open register cash</strong>
                <span>Expected drawer cash</span>
              </div>
              <div className="row-action-stack">
                <b>{displayMoney(report.summary.openRegisterCash)}</b>
                <button onClick={onOpenRegisters}>Review</button>
              </div>
            </div>
            {paymentRows.length === 0 ? (
              <div className="empty-state">No payment records yet.</div>
            ) : (
              paymentRows.map(([method, amount]) => (
                <div className="list-row" key={method}>
                  <div>
                    <strong>{method.replace("_", " ")}</strong>
                    <span>Recorded payments</span>
                  </div>
                  <b>{displayMoney(amount)}</b>
                </div>
              ))
            )}
          </div>
        </section>
      </div>

      <div className="content-grid">
        <section className="panel">
          <div className="panel-header">
            <h2>Approval queue</h2>
            <button className="secondary-button" onClick={onOpenApprovals}>
              <ClipboardCheck size={16} />
              {report.summary.highPriorityApprovalCount} high priority
            </button>
          </div>
          <div className="stack">
            {report.approvals.length === 0 ? (
              <div className="empty-state">No pending approval requests.</div>
            ) : (
              report.approvals.map((approval) => (
                <div className="list-row dashboard-approval-row" key={approval.id}>
                  <div>
                    <strong>{formatLabel(approval.type)}</strong>
                    <span>{approval.entityType} - {approval.entityId}</span>
                    <small>{approval.reason}</small>
                  </div>
                  <div className="row-action-stack">
                    <b>{displayMoney(approval.amount)}</b>
                    <button onClick={onOpenApprovals}>Open</button>
                  </div>
                </div>
              ))
            )}
          </div>
        </section>

        <section className="panel">
          <div className="panel-header">
            <h2>Cash movements</h2>
            <button className="secondary-button" onClick={onOpenRegisters}>
              <Banknote size={16} />
              Register
            </button>
          </div>
          <div className="stack">
            <div className="list-row">
              <div>
                <strong>Net movement</strong>
                <span>{displayMoney(report.summary.cashMovementIn)} in - {displayMoney(report.summary.cashMovementOut)} out</span>
              </div>
              <b>{displayMoney(report.summary.cashMovementNet)}</b>
            </div>
            {report.cashMovements.length === 0 ? (
              <div className="empty-state">No cash movements for this period.</div>
            ) : (
              report.cashMovements.map((movement) => (
                <div className="list-row dashboard-approval-row" key={movement.id}>
                  <div>
                    <strong>{formatLabel(movement.type)}</strong>
                    <span>{movement.reason}</span>
                    <small>{movement.createdBy} - {new Date(movement.createdAt).toLocaleString()}</small>
                  </div>
                  <b>{displayMoney(movement.amount)}</b>
                </div>
              ))
            )}
          </div>
        </section>
      </div>

      <div className="content-grid">
        <section className="panel">
          <div className="panel-header">
            <h2>Control alerts</h2>
            <ShieldAlert size={20} />
          </div>
          <div className="stack">
            <div className="list-row">
              <div>
                <strong>Approval exposure</strong>
                <span>Pending request value</span>
              </div>
              <div className="row-action-stack">
                <b>{displayMoney(report.summary.pendingApprovalValue)}</b>
                <button onClick={onOpenApprovals}>Manage</button>
              </div>
            </div>
            <div className="list-row">
              <div>
                <strong>Audit events</strong>
                <span>Tenant control trail</span>
              </div>
              <div className="row-action-stack">
                <b>{report.summary.auditEventCount}</b>
                <button onClick={onOpenAudit}>Inspect</button>
              </div>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
