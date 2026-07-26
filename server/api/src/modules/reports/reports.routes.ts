import { Router } from "express";
import {
  auditEvents,
  approvalRequests,
  branches,
  demoProducts,
  expenses,
  paymentRecords,
  registerShifts,
  saleLedger,
  staffMembers
} from "../../shared/data/demoStore";
import { prisma } from "../../shared/db/prisma";
import { resolveBranchScope, requirePermission, requireTenant } from "../../shared/http/tenantContext";

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
    total: Number(summary?.total ?? 0),
    lines: Array.isArray(summary?.lines)
      ? summary.lines.map((line) => ({
        productId: String((line as ReportLine).productId),
        name: String((line as ReportLine).name),
        quantity: Number((line as ReportLine).quantity ?? 0),
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
      staff: staffMembers,
      payments: paymentRecords,
      expenses,
      approvals: approvalRequests,
      audits: auditEvents
    };
  }

  const [sales, products, shifts, staff, payments, expenseRecords, approvals, audits] = await Promise.all([
    prisma.completedSale.findMany({ where: { tenantId } }),
    prisma.product.findMany({ where: { tenantId } }),
    prisma.registerShift.findMany({ where: { tenantId } }),
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
    audits: audits.map((event) => ({ tenantId: event.tenantId, createdAt: event.createdAt.toISOString() }))
  };
}

reportsRouter.get("/dashboard", requireTenant, requirePermission("reports.profit.view"), async (req, res) => {
  const scope = resolveBranchScope(req.tenantContext!, req.query.branchId?.toString());
  if (scope.forbidden) {
    res.status(403).json({ error: "Branch access denied" });
    return;
  }

  const branchId = scope.branchId;
  const period = getReportPeriod(req.query.period);
  const tenantId = req.tenantContext!.tenantId;

  if (branchId) {
    const validBranch = await branchBelongsToTenant(tenantId, branchId);
    if (!validBranch) {
      res.status(404).json({ error: "Report branch not found for this tenant" });
      return;
    }
  }

  const sources = await loadReportSources(tenantId);
  const branchSales = sources.sales.filter((sale) => {
    const tenantMatch = sale.tenantId === tenantId;
    const branchMatch = branchId ? sale.branchId === branchId : true;
    return tenantMatch && branchMatch;
  });
  const periodSales = branchSales.filter((sale) => isWithinReportPeriod(sale.createdAt, period));
  const activeSales = periodSales.filter((sale) => sale.status !== "voided");
  const totalSales = activeSales.reduce((sum, sale) => sum + sale.summary.total - sale.refundTotal, 0);
  const orderCount = activeSales.length;
  const averageTransaction = orderCount ? Math.round(totalSales / orderCount) : 0;
  const grossProfit = activeSales.reduce((sum, sale) => {
    const saleProfit = sale.summary.lines.reduce((lineSum, line) => {
      const product = sources.products.find((item) => item.tenantId === tenantId && item.id === line.productId);
      const cost = product ? product.cost * line.quantity : 0;
      return lineSum + line.total - cost;
    }, 0);
    return sum + saleProfit - sale.refundTotal;
  }, 0);
  const periodExpenses = sources.expenses
    .filter((expense) => expense.tenantId === tenantId)
    .filter((expense) => !branchId || expense.branchId === branchId)
    .filter((expense) => expense.status === "paid")
    .filter((expense) => isWithinReportPeriod(expense.spentAt, period));
  const expenseTotal = periodExpenses.reduce((sum, expense) => sum + expense.amount, 0);
  const lowStock = sources.products
    .filter((product) => product.tenantId === tenantId)
    .filter((product) => !branchId || product.branchId === branchId)
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
    .filter((shift) => !branchId || shift.branchId === branchId)
    .reduce((sum, shift) => sum + shift.expectedCash, 0);
  const hourlySales = buildSalesTrend(activeSales, period);
  const staffPerformance = sources.staff
    .filter((member) => member.tenantId === tenantId)
    .filter((member) => !branchId || member.branchId === branchId)
    .map((member) => ({
      id: member.id,
      name: member.name,
      role: member.role,
      salesTotal: activeSales.filter((sale) => sale.cashierId === member.id).reduce((sum, sale) => sum + sale.summary.total - sale.refundTotal, 0),
      status: member.active ? "Active" : "Inactive"
    }));
  const paymentMix = sources.payments
    .filter((payment) => payment.tenantId === tenantId)
    .filter((payment) => !branchId || payment.branchId === branchId)
    .filter((payment) => isWithinReportPeriod(payment.createdAt, period))
    .reduce<Record<string, number>>((summary, payment) => {
      summary[payment.method] = (summary[payment.method] ?? 0) + payment.amount;
      return summary;
    }, {});
  const categoryPerformance = activeSales
    .flatMap((sale) => sale.summary.lines)
    .reduce<Record<string, { category: string; quantity: number; sales: number; cost: number; profit: number }>>((summary, line) => {
      const product = sources.products.find((item) => item.tenantId === tenantId && item.id === line.productId);
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
      .flatMap((sale) => sale.summary.lines)
      .reduce<Record<string, { id: string; name: string; quantity: number; sales: number; profit: number }>>((summary, line) => {
        const product = sources.products.find((item) => item.tenantId === tenantId && item.id === line.productId);
        const current = summary[line.productId] ?? { id: line.productId, name: line.name, quantity: 0, sales: 0, profit: 0 };
        current.quantity += line.quantity;
        current.sales += line.total;
        current.profit += line.total - (product ? product.cost * line.quantity : 0);
        summary[line.productId] = current;
        return summary;
      }, {})
  ).sort((left, right) => right.sales - left.sales);
  const pendingApprovals = sources.approvals
    .filter((approval) => approval.tenantId === tenantId)
    .filter((approval) => !branchId || approval.branchId === branchId)
    .filter((approval) => approval.status === "pending");

  res.json({
    period,
    periodLabel: reportPeriodLabels[period],
    summary: {
      totalSales,
      orderCount,
      averageTransaction,
      grossProfit,
      expenseTotal,
      netProfit: grossProfit - expenseTotal,
      lowStockCount: lowStock.length,
      openRegisterCash,
      auditEventCount: sources.audits.filter((event) => event.tenantId === tenantId).filter((event) => isWithinReportPeriod(event.createdAt, period)).length,
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
