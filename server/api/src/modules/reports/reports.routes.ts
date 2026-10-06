import { Router, type Request } from "express";
import {
  auditEvents,
  approvalRequests,
  branches,
  demoProducts,
  expenses,
  cashMovements,
  customerLedger,
  customers,
  paymentRecords,
  registerShifts,
  saleLedger,
  staffMembers
} from "../../shared/data/demoStore";
import { prisma } from "../../shared/db/prisma";
import { canAccessAllBranches, canAccessScopedBranches, resolveBranchScope, requirePermission, requireTenant } from "../../shared/http/tenantContext";

export const reportsRouter = Router();
const useDemoStore = process.env.NODE_ENV === "test";

type ReportPeriod = "today" | "week" | "month" | "year" | "all";

const reportPeriodLabels: Record<ReportPeriod, string> = {
  today: "Today",
  week: "This week",
  month: "This month",
  year: "This year",
  all: "All time"
};

function getReportPeriod(value: unknown): ReportPeriod {
  return value === "week" || value === "month" || value === "year" || value === "all" ? value : "today";
}

function requestedBranch(req: Request) {
  const queryBranchId = req.query.branchId?.toString();
  if (queryBranchId) return queryBranchId;
  const headerBranchId = req.header("x-branch-id");
  if (headerBranchId) return headerBranchId;
  if (canAccessAllBranches(req.tenantContext!) || canAccessScopedBranches(req.tenantContext!)) return undefined;
  return req.tenantContext!.branchId;
}

function isServiceCategory(category: string) {
  return category.trim().toLowerCase() === "services";
}

function startOfToday(now: Date) {
  return new Date(now.getFullYear(), now.getMonth(), now.getDate());
}

function startOfWeek(now: Date) {
  const start = startOfToday(now);
  const day = start.getDay();
  const mondayOffset = day === 0 ? -6 : 1 - day;
  start.setDate(start.getDate() + mondayOffset);
  return start;
}

function startOfPeriod(period: ReportPeriod, now = new Date()) {
  if (period === "today") return startOfToday(now);
  if (period === "week") return startOfWeek(now);
  if (period === "month") return new Date(now.getFullYear(), now.getMonth(), 1);
  if (period === "year") return new Date(now.getFullYear(), 0, 1);
  return null;
}

function isWithinReportPeriod(createdAt: string, period: ReportPeriod) {
  const start = startOfPeriod(period);
  return start ? new Date(createdAt) >= start : true;
}

function parseReportDate(value: unknown, endOfDay = false) {
  if (typeof value !== "string" || !value.trim()) return null;
  const normalized = value.includes("T")
    ? value
    : `${value.trim()}T${endOfDay ? "23:59:59.999" : "00:00:00.000"}`;
  const date = new Date(normalized);
  return Number.isNaN(date.getTime()) ? null : date;
}

function reportWindow(req: Request, period: ReportPeriod) {
  const startDate = parseReportDate(req.query.startDate);
  const endDate = parseReportDate(req.query.endDate, true);
  const hasCustomDate = Boolean(req.query.startDate || req.query.endDate);

  if (hasCustomDate && ((req.query.startDate && !startDate) || (req.query.endDate && !endDate))) {
    return { error: "Invalid report date filter" as const };
  }

  const start = startDate ?? startOfPeriod(period);
  const end = endDate;

  if (start && end && end < start) {
    return { error: "Report end date must be after start date" as const };
  }

  const label = hasCustomDate
    ? `${start ? start.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "Beginning"} - ${end ? end.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "Today"}`
    : reportPeriodLabels[period];

  return { start, end, label };
}

function isWithinReportWindow(createdAt: string, window: { start?: Date | null; end?: Date | null }) {
  const date = new Date(createdAt);
  return (!window.start || date >= window.start) && (!window.end || date <= window.end);
}

function findReportProduct(products: ReportProduct[], tenantId: string, branchId: string, productId: string) {
  return products.find((item) => item.tenantId === tenantId && item.branchId === branchId && item.id === productId);
}

async function branchBelongsToTenant(tenantId: string, branchId: string) {
  if (useDemoStore) {
    return branches.some((branch) => branch.tenantId === tenantId && branch.id === branchId);
  }

  const branch = await prisma.branch.findFirst({ where: { tenantId, id: branchId }, select: { id: true } });
  return Boolean(branch);
}

function formatShortDate(date: Date) {
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function buildSalesTrend(sales: ReportSale[], period: ReportPeriod) {
  if (period === "today") {
    return Array.from({ length: 7 }, (_, index) => {
      const hour = 8 + index * 2;
      const amount = sales
        .filter((sale) => new Date(sale.createdAt).getHours() <= hour)
        .reduce((sum, sale) => sum + Math.round((sale.summary.total - sale.refundTotal) / 7), 0);
      return { label: `${hour.toString().padStart(2, "0")}:00`, amount };
    });
  }

  if (period === "week") {
    const start = startOfWeek(new Date());
    return Array.from({ length: 7 }, (_, index) => {
      const bucketDate = new Date(start);
      bucketDate.setDate(start.getDate() + index);
      const amount = sales
        .filter((sale) => {
          const saleDate = new Date(sale.createdAt);
          return saleDate.getFullYear() === bucketDate.getFullYear() && saleDate.getMonth() === bucketDate.getMonth() && saleDate.getDate() === bucketDate.getDate();
        })
        .reduce((sum, sale) => sum + sale.summary.total - sale.refundTotal, 0);
      return { label: bucketDate.toLocaleDateString("en-US", { weekday: "short" }), amount };
    });
  }

  if (period === "month") {
    const now = new Date();
    const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
    const bucketCount = Math.ceil(daysInMonth / 7);
    return Array.from({ length: bucketCount }, (_, index) => {
      const startDay = index * 7 + 1;
      const endDay = Math.min(startDay + 6, daysInMonth);
      const amount = sales
        .filter((sale) => {
          const saleDate = new Date(sale.createdAt);
          return saleDate.getFullYear() === now.getFullYear() && saleDate.getMonth() === now.getMonth() && saleDate.getDate() >= startDay && saleDate.getDate() <= endDay;
        })
        .reduce((sum, sale) => sum + sale.summary.total - sale.refundTotal, 0);
      return { label: `${startDay}-${endDay}`, amount };
    });
  }

  if (period === "year") {
    const now = new Date();
    return Array.from({ length: 12 }, (_, month) => {
      const amount = sales
        .filter((sale) => {
          const saleDate = new Date(sale.createdAt);
          return saleDate.getFullYear() === now.getFullYear() && saleDate.getMonth() === month;
        })
        .reduce((sum, sale) => sum + sale.summary.total - sale.refundTotal, 0);
      return { label: new Date(now.getFullYear(), month, 1).toLocaleDateString("en-US", { month: "short" }), amount };
    });
  }

  const monthTotals = sales.reduce<Record<string, { label: string; amount: number }>>((summary, sale) => {
    const saleDate = new Date(sale.createdAt);
    const key = `${saleDate.getFullYear()}-${saleDate.getMonth()}`;
    const current = summary[key] ?? { label: formatShortDate(new Date(saleDate.getFullYear(), saleDate.getMonth(), 1)), amount: 0 };
    current.amount += sale.summary.total - sale.refundTotal;
    summary[key] = current;
    return summary;
  }, {});
  return Object.values(monthTotals).slice(-12);
}

type ReportLine = {
  productId: string;
  name: string;
  quantity: number;
  subtotal: number;
  discount: number;
  vat: number;
  total: number;
};

type ReportSale = {
  tenantId: string;
  branchId: string;
  cashierId: string;
  status: string;
  refundTotal: number;
  createdAt: string;
  summary: {
    subtotal: number;
    discount: number;
    serviceCharge: number;
    vat: number;
    total: number;
    lines: ReportLine[];
  };
};

type ReportProduct = {
  id: string;
  tenantId: string;
  branchId: string;
  name: string;
  sku: string;
  category: string;
  stock: number;
  reorderPoint: number;
  cost: number;
};

function parseSaleSummary(value: unknown): ReportSale["summary"] {
  const summary = value as Partial<ReportSale["summary"]> | null;
  return {
    subtotal: Number(summary?.subtotal ?? 0),
    discount: Number(summary?.discount ?? 0),
    serviceCharge: Number(summary?.serviceCharge ?? 0),
    vat: Number(summary?.vat ?? 0),
    total: Number(summary?.total ?? 0),
    lines: Array.isArray(summary?.lines)
      ? summary.lines.map((line) => ({
        productId: String((line as ReportLine).productId),
        name: String((line as ReportLine).name),
        quantity: Number((line as ReportLine).quantity ?? 0),
        subtotal: Number((line as ReportLine).subtotal ?? 0),
        discount: Number((line as ReportLine).discount ?? 0),
        vat: Number((line as ReportLine).vat ?? 0),
        total: Number((line as ReportLine).total ?? 0)
      }))
      : []
  };
}

async function loadReportSources(tenantId: string) {
  if (useDemoStore) {
    return {
      sales: saleLedger,
      products: demoProducts,
      shifts: registerShifts,
      cashMovements,
      customerLedger,
      customers,
      staff: staffMembers,
      payments: paymentRecords,
      expenses,
      approvals: approvalRequests,
      audits: auditEvents
    };
  }

  const [sales, products, shifts, movementRecords, customerRecords, ledgerRecords, staff, payments, expenseRecords, approvals, audits] = await Promise.all([
    prisma.completedSale.findMany({ where: { tenantId } }),
    prisma.product.findMany({ where: { tenantId } }),
    prisma.registerShift.findMany({ where: { tenantId } }),
    prisma.cashMovement.findMany({ where: { tenantId } }),
    prisma.customer.findMany({ where: { tenantId } }),
    prisma.customerLedgerEntry.findMany({ where: { tenantId } }),
    prisma.staffMember.findMany({ where: { tenantId } }),
    prisma.paymentRecord.findMany({ where: { tenantId } }),
    prisma.expense.findMany({ where: { tenantId } }),
    prisma.approvalRequest.findMany({ where: { tenantId } }),
    prisma.auditEvent.findMany({ where: { tenantId } })
  ]);

  return {
    sales: sales.map((sale): ReportSale => ({
      tenantId: sale.tenantId,
      branchId: sale.branchId,
      cashierId: sale.cashierId,
      status: sale.status,
      refundTotal: sale.refundTotal,
      createdAt: sale.createdAt.toISOString(),
      summary: parseSaleSummary(sale.summary)
    })),
    products: products.map((product): ReportProduct => ({
      id: product.id,
      tenantId: product.tenantId,
      branchId: product.branchId,
      name: product.name,
      sku: product.sku,
      category: product.category,
      stock: product.stock,
      reorderPoint: product.reorderPoint,
      cost: product.cost
    })),
    shifts: shifts.map((shift) => ({ tenantId: shift.tenantId, branchId: shift.branchId, status: shift.status, expectedCash: shift.expectedCash })),
    cashMovements: movementRecords.map((movement) => ({
      id: movement.id,
      tenantId: movement.tenantId,
      branchId: movement.branchId,
      type: movement.type,
      amount: movement.amount,
      reason: movement.reason,
      createdBy: movement.createdBy,
      createdAt: movement.createdAt.toISOString()
    })),
    customers: customerRecords.map((customer) => ({
      id: customer.id,
      tenantId: customer.tenantId,
      loyaltyPoints: customer.loyaltyPoints,
      creditLimit: customer.creditLimit,
      outstandingBalance: customer.outstandingBalance
    })),
    customerLedger: ledgerRecords.map((entry) => ({
      id: entry.id,
      tenantId: entry.tenantId,
      branchId: entry.branchId,
      customerId: entry.customerId,
      type: entry.type,
      amount: entry.amount,
      pointsDelta: entry.pointsDelta,
      balanceAfter: entry.balanceAfter,
      pointsAfter: entry.pointsAfter,
      createdAt: entry.createdAt.toISOString()
    })),
    staff: staff.map((member) => ({ id: member.id, tenantId: member.tenantId, branchId: member.branchId, name: member.name, role: member.role, active: member.active })),
    payments: payments.map((payment) => ({ tenantId: payment.tenantId, branchId: payment.branchId, method: payment.method, amount: payment.amount, createdAt: payment.createdAt.toISOString() })),
    expenses: expenseRecords.map((expense) => ({ tenantId: expense.tenantId, branchId: expense.branchId, status: expense.status, category: expense.category, amount: expense.amount, spentAt: expense.spentAt.toISOString() })),
    approvals: approvals.map((approval) => ({
      id: approval.id,
      tenantId: approval.tenantId,
      branchId: approval.branchId,
      type: approval.type,
      entityType: approval.entityType,
      entityId: approval.entityId,
      amount: approval.amount,
      reason: approval.reason,
      status: approval.status,
      requestedBy: approval.requestedBy,
      createdAt: approval.createdAt.toISOString()
    })),
    audits: audits.map((event) => ({ tenantId: event.tenantId, branchId: event.branchId ?? undefined, createdAt: event.createdAt.toISOString() }))
  };
}

reportsRouter.get("/dashboard", requireTenant, requirePermission("reports.profit.view"), async (req, res) => {
  const requestedBranchId = requestedBranch(req);
  const scope = resolveBranchScope(req.tenantContext!, requestedBranchId);
  if (scope.forbidden || (!canAccessAllBranches(req.tenantContext!) && !canAccessScopedBranches(req.tenantContext!) && !scope.branchId)) {
    res.status(403).json({ error: "Branch access denied" });
    return;
  }

  const effectiveScope = !requestedBranchId && scope.branchScopeIds?.length ? { ...scope, branchId: undefined } : scope;
  const branchId = effectiveScope.branchId;
  const period = getReportPeriod(req.query.period);
  const window = reportWindow(req, period);
  if ("error" in window) {
    res.status(400).json({ error: window.error });
    return;
  }
  const tenantId = req.tenantContext!.tenantId;

  if (branchId) {
    const validBranch = await branchBelongsToTenant(tenantId, branchId);
    if (!validBranch) {
      res.status(404).json({ error: "Report branch not found for this tenant" });
      return;
    }
  }

  const sources = await loadReportSources(tenantId);
  const branchScopeIds = !branchId ? effectiveScope.branchScopeIds : undefined;
  const branchMatches = (recordBranchId?: string) => {
    if (branchId) return recordBranchId === branchId;
    if (branchScopeIds?.length) return Boolean(recordBranchId && branchScopeIds.includes(recordBranchId));
    return true;
  };
  const branchSales = sources.sales.filter((sale) => {
    const tenantMatch = sale.tenantId === tenantId;
    return tenantMatch && branchMatches(sale.branchId);
  });
  const periodSales = branchSales.filter((sale) => isWithinReportWindow(sale.createdAt, window));
  const activeSales = periodSales.filter((sale) => sale.status !== "voided");
  const totalSales = activeSales.reduce((sum, sale) => sum + sale.summary.total - sale.refundTotal, 0);
  const taxSummary = activeSales.reduce((summary, sale) => {
    const retainedRatio = sale.summary.total > 0 ? Math.max((sale.summary.total - sale.refundTotal) / sale.summary.total, 0) : 1;
    summary.subtotal += Math.round(sale.summary.subtotal * retainedRatio);
    summary.discountTotal += Math.round(sale.summary.discount * retainedRatio);
    summary.serviceChargeTotal += Math.round(sale.summary.serviceCharge * retainedRatio);
    summary.vatTotal += Math.round(sale.summary.vat * retainedRatio);
    return summary;
  }, { subtotal: 0, discountTotal: 0, serviceChargeTotal: 0, vatTotal: 0 });
  const orderCount = activeSales.length;
  const averageTransaction = orderCount ? Math.round(totalSales / orderCount) : 0;
  const grossProfit = activeSales.reduce((sum, sale) => {
    const saleProfit = sale.summary.lines.reduce((lineSum, line) => {
      const product = findReportProduct(sources.products, tenantId, sale.branchId, line.productId);
      const cost = product ? product.cost * line.quantity : 0;
      return lineSum + line.total - cost;
    }, 0);
    return sum + saleProfit - sale.refundTotal;
  }, 0);
  const periodExpenses = sources.expenses
    .filter((expense) => expense.tenantId === tenantId)
    .filter((expense) => branchMatches(expense.branchId))
    .filter((expense) => expense.status === "paid")
    .filter((expense) => isWithinReportWindow(expense.spentAt, window));
  const expenseTotal = periodExpenses.reduce((sum, expense) => sum + expense.amount, 0);
  const lowStock = sources.products
    .filter((product) => product.tenantId === tenantId)
    .filter((product) => branchMatches(product.branchId))
    .filter((product) => !isServiceCategory(product.category))
    .filter((product) => product.stock <= product.reorderPoint)
    .map((product) => ({
      id: product.id,
      name: product.name,
      sku: product.sku,
      stock: product.stock,
      reorderPoint: product.reorderPoint
    }));
  const openRegisterCash = sources.shifts
    .filter((shift) => shift.tenantId === tenantId && shift.status === "open")
    .filter((shift) => branchMatches(shift.branchId))
    .reduce((sum, shift) => sum + shift.expectedCash, 0);
  const periodCashMovements = sources.cashMovements
    .filter((movement) => movement.tenantId === tenantId)
    .filter((movement) => branchMatches(movement.branchId))
    .filter((movement) => isWithinReportWindow(movement.createdAt, window));
  const cashMovementIn = periodCashMovements
    .filter((movement) => movement.type === "cash_in" || movement.type === "paid_in")
    .reduce((sum, movement) => sum + movement.amount, 0);
  const cashMovementOut = periodCashMovements
    .filter((movement) => movement.type === "cash_out" || movement.type === "paid_out")
    .reduce((sum, movement) => sum + movement.amount, 0);
  const cashMovementNet = cashMovementIn - cashMovementOut;
  const scopedCustomerLedger = sources.customerLedger
    .filter((entry) => entry.tenantId === tenantId)
    .filter((entry) => branchMatches(entry.branchId));
  const scopedCustomerIds = new Set(scopedCustomerLedger.map((entry) => entry.customerId));
  const hasCustomerBranchScope = Boolean(branchId || branchScopeIds?.length);
  const tenantCustomers = sources.customers
    .filter((customer) => customer.tenantId === tenantId)
    .filter((customer) => !hasCustomerBranchScope || scopedCustomerIds.has(customer.id));
  const latestScopedCustomerLedger = scopedCustomerLedger.reduce<Map<string, (typeof scopedCustomerLedger)[number]>>((latest, entry) => {
    const current = latest.get(entry.customerId);
    if (!current || new Date(entry.createdAt).getTime() >= new Date(current.createdAt).getTime()) {
      latest.set(entry.customerId, entry);
    }
    return latest;
  }, new Map());
  const customerOutstandingBalance = hasCustomerBranchScope
    ? Array.from(latestScopedCustomerLedger.values()).reduce((sum, entry) => sum + entry.balanceAfter, 0)
    : tenantCustomers.reduce((sum, customer) => sum + customer.outstandingBalance, 0);
  const customerCreditLimit = tenantCustomers.reduce((sum, customer) => sum + customer.creditLimit, 0);
  const customerLoyaltyPoints = hasCustomerBranchScope
    ? Array.from(latestScopedCustomerLedger.values()).reduce((sum, entry) => sum + entry.pointsAfter, 0)
    : tenantCustomers.reduce((sum, customer) => sum + customer.loyaltyPoints, 0);
  const periodCustomerLedger = sources.customerLedger
    .filter((entry) => entry.tenantId === tenantId)
    .filter((entry) => branchMatches(entry.branchId))
    .filter((entry) => isWithinReportWindow(entry.createdAt, window));
  const customerAccountPayments = periodCustomerLedger
    .filter((entry) => entry.type === "payment" || entry.type === "voucher")
    .reduce((sum, entry) => sum + Math.abs(entry.amount), 0);
  const customerAccountCreditIssued = periodCustomerLedger
    .filter((entry) => entry.type === "credit_sale")
    .reduce((sum, entry) => sum + Math.max(entry.amount, 0), 0);
  const hourlySales = buildSalesTrend(activeSales, period);
  const staffPerformance = sources.staff
    .filter((member) => member.tenantId === tenantId)
    .filter((member) => branchMatches(member.branchId))
    .map((member) => ({
      id: member.id,
      name: member.name,
      role: member.role,
      salesTotal: activeSales.filter((sale) => sale.cashierId === member.id).reduce((sum, sale) => sum + sale.summary.total - sale.refundTotal, 0),
      status: member.active ? "active" : "inactive"
    }));
  const paymentMix = sources.payments
    .filter((payment) => payment.tenantId === tenantId)
    .filter((payment) => branchMatches(payment.branchId))
    .filter((payment) => isWithinReportWindow(payment.createdAt, window))
    .reduce<Record<string, number>>((summary, payment) => {
      summary[payment.method] = (summary[payment.method] ?? 0) + payment.amount;
      return summary;
    }, {});
  const categoryPerformance = activeSales
    .flatMap((sale) => sale.summary.lines.map((line) => ({ ...line, branchId: sale.branchId })))
    .reduce<Record<string, { category: string; quantity: number; sales: number; cost: number; profit: number }>>((summary, line) => {
      const product = findReportProduct(sources.products, tenantId, line.branchId, line.productId);
      const category = product?.category ?? "Uncategorized";
      const cost = product ? product.cost * line.quantity : 0;
      const current = summary[category] ?? { category, quantity: 0, sales: 0, cost: 0, profit: 0 };
      current.quantity += line.quantity;
      current.sales += line.total;
      current.cost += cost;
      current.profit += line.total - cost;
      summary[category] = current;
      return summary;
    }, {});
  const categorySales = Object.values(categoryPerformance).sort((left, right) => right.sales - left.sales);
  const topProducts = Object.values(
    activeSales
      .flatMap((sale) => sale.summary.lines.map((line) => ({ ...line, branchId: sale.branchId })))
      .reduce<Record<string, { id: string; name: string; quantity: number; sales: number; profit: number }>>((summary, line) => {
        const product = findReportProduct(sources.products, tenantId, line.branchId, line.productId);
        const key = `${line.branchId}:${line.productId}`;
        const current = summary[key] ?? { id: line.productId, name: line.name, quantity: 0, sales: 0, profit: 0 };
        current.quantity += line.quantity;
        current.sales += line.total;
        current.profit += line.total - (product ? product.cost * line.quantity : 0);
        summary[key] = current;
        return summary;
      }, {})
  ).sort((left, right) => right.sales - left.sales);
  const pendingApprovals = sources.approvals
    .filter((approval) => approval.tenantId === tenantId)
    .filter((approval) => branchMatches(approval.branchId))
    .filter((approval) => approval.status === "pending");

  res.json({
    period,
    periodLabel: window.label,
    summary: {
      totalSales,
      taxableSales: Math.max(taxSummary.subtotal - taxSummary.discountTotal, 0),
      discountTotal: taxSummary.discountTotal,
      serviceChargeTotal: taxSummary.serviceChargeTotal,
      vatTotal: taxSummary.vatTotal,
      orderCount,
      averageTransaction,
      grossProfit,
      expenseTotal,
      netProfit: grossProfit - expenseTotal,
      lowStockCount: lowStock.length,
      openRegisterCash,
      cashMovementIn,
      cashMovementOut,
      cashMovementNet,
      customerCount: tenantCustomers.length,
      customerOutstandingBalance,
      customerCreditLimit,
      customerLoyaltyPoints,
      customerAccountPayments,
      customerAccountCreditIssued,
      auditEventCount: sources.audits
        .filter((event) => event.tenantId === tenantId)
        .filter((event) => branchMatches(event.branchId))
        .filter((event) => isWithinReportWindow(event.createdAt, window)).length,
      pendingApprovalCount: pendingApprovals.length,
      pendingApprovalValue: pendingApprovals.reduce((sum, approval) => sum + approval.amount, 0),
      highPriorityApprovalCount: pendingApprovals.filter((approval) => approval.amount >= 100000).length
    },
    hourlySales,
    lowStock,
    staffPerformance,
    paymentMix,
    categorySales,
    topProducts: topProducts.slice(0, 5),
    cashMovements: periodCashMovements
      .sort((left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime())
      .slice(0, 10)
      .map((movement) => ({
        id: movement.id,
        type: movement.type,
        amount: movement.amount,
        reason: movement.reason,
        createdBy: movement.createdBy,
        createdAt: movement.createdAt
      })),
    approvals: pendingApprovals.slice(0, 5).map((approval) => ({
      id: approval.id,
      type: approval.type,
      entityType: approval.entityType,
      entityId: approval.entityId,
      amount: approval.amount,
      reason: approval.reason,
      requestedBy: approval.requestedBy,
      createdAt: approval.createdAt
    }))
  });
});
