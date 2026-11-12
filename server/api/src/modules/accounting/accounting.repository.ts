import { auditEvents, branches as demoBranches, customerLedger as demoLedger, customers as demoCustomers, expenses as demoExpenses, paymentRecords as demoPayments, saleLedger, supplierInvoices as demoInvoices } from "../../shared/data/demoStore";
import { prisma } from "../../shared/db/prisma";
import type { CustomerPaymentInput, ExpenseInput, PurchaseInput, ReturnInput, SaleInput, SupplierPaymentInput, VoucherInput } from "./vouchers";

const useDemoStore = process.env.NODE_ENV === "test";

export interface ExportScope {
  tenantId: string;
  from: Date;
  to: Date;
  /** Only these branches; undefined = all. */
  branchIds?: string[];
}

type RawSale = { id: string; branchId: string; customerId: string | null; summary: unknown; createdAt: Date | string };
type RawPayment = { saleId: string; method: string; amount: number };
type RawAudit = { action: string; entityId: string; metadata: unknown; createdAt: Date | string };

const iso = (value: Date | string) => (value instanceof Date ? value.toISOString() : value);
const within = (value: Date | string, scope: ExportScope) => {
  const time = new Date(value).getTime();
  return time >= scope.from.getTime() && time <= scope.to.getTime();
};
const inBranches = (branchId: string, scope: ExportScope) => !scope.branchIds || scope.branchIds.includes(branchId);

function toSaleInput(sale: RawSale, payments: RawPayment[], customerNames: Map<string, string>): SaleInput {
  const summary = (typeof sale.summary === "string" ? JSON.parse(sale.summary) : sale.summary) as SaleInput["summary"];
  return {
    id: sale.id,
    branchId: sale.branchId,
    createdAt: iso(sale.createdAt),
    customerName: sale.customerId ? customerNames.get(sale.customerId) : undefined,
    summary: { subtotal: Number(summary.subtotal ?? 0), discount: Number(summary.discount ?? 0), serviceCharge: Number(summary.serviceCharge ?? 0), vat: Number(summary.vat ?? 0), total: Number(summary.total ?? 0) },
    payments: payments.filter((payment) => payment.saleId === sale.id).map((payment) => ({ method: payment.method, amount: Number(payment.amount) }))
  };
}

/** Refunds (their own amount) and voids (what was left after earlier refunds), on their own day. */
function toReturns(events: RawAudit[], allRefunds: RawAudit[], sales: Map<string, SaleInput>): ReturnInput[] {
  return events
    .filter((event) => sales.has(event.entityId))
    .map((event) => {
      const metadata = (event.metadata ?? {}) as { amount?: number; total?: number };
      const sale = sales.get(event.entityId)!;
      if (event.action === "sale.refunded") return { saleId: event.entityId, kind: "refund" as const, amount: Number(metadata.amount ?? 0), at: iso(event.createdAt), sale };
      const refundedBefore = allRefunds
        .filter((refund) => refund.entityId === event.entityId && new Date(refund.createdAt) <= new Date(event.createdAt))
        .reduce((sum, refund) => sum + Number((refund.metadata as { amount?: number })?.amount ?? 0), 0);
      return { saleId: event.entityId, kind: "void" as const, amount: Number(metadata.total ?? sale.summary.total) - refundedBefore, at: iso(event.createdAt), sale };
    })
    .filter((item) => item.amount > 0);
}

/** Everything a period's vouchers need (ledger names are added by the caller). */
export async function loadVoucherData(scope: ExportScope): Promise<Omit<VoucherInput, "ledgers">> {
  const { tenantId } = scope;

  if (useDemoStore) {
    const customerNames = new Map(demoCustomers.filter((customer) => customer.tenantId === tenantId).map((customer) => [customer.id, customer.name]));
    const branchNames = new Map(demoBranches.map((branch) => [branch.id, branch.name]));
    const saleInputs = new Map(saleLedger.filter((sale) => sale.tenantId === tenantId).map((sale) => [sale.id, toSaleInput(sale as RawSale, demoPayments as RawPayment[], customerNames)]));
    const tenantAudits = auditEvents.filter((event) => event.tenantId === tenantId);
    const returnEvents = tenantAudits.filter((event) => (event.action === "sale.refunded" || event.action === "sale.voided") && within(event.createdAt, scope) && inBranches(event.branchId ?? "", scope));
    return {
      branchName: (id) => branchNames.get(id) ?? id,
      sales: [...saleInputs.values()].filter((sale) => within(sale.createdAt, scope) && inBranches(sale.branchId, scope)),
      returns: toReturns(returnEvents as RawAudit[], tenantAudits.filter((event) => event.action === "sale.refunded") as RawAudit[], saleInputs),
      customerPayments: demoLedger
        .filter((entry) => entry.tenantId === tenantId && entry.type === "payment" && within(entry.createdAt, scope) && inBranches(entry.branchId, scope))
        .map((entry): CustomerPaymentInput => ({ id: entry.id, branchId: entry.branchId, customerName: customerNames.get(entry.customerId) ?? entry.customerId, amount: Math.abs(entry.amount), at: entry.createdAt, note: entry.note })),
      purchases: demoInvoices
        .filter((invoice) => invoice.tenantId === tenantId && within(invoice.invoiceDate, scope) && inBranches(invoice.branchId, scope))
        .map((invoice): PurchaseInput => ({ id: invoice.id, branchId: invoice.branchId, supplierName: invoice.supplierName, invoiceNumber: invoice.invoiceNumber, amount: invoice.amount, date: invoice.invoiceDate })),
      supplierPayments: demoInvoices
        .filter((invoice) => invoice.tenantId === tenantId && inBranches(invoice.branchId, scope))
        .flatMap((invoice) => invoice.payments.filter((payment) => within(payment.paidAt, scope)).map((payment): SupplierPaymentInput => ({ id: payment.id, branchId: invoice.branchId, supplierName: invoice.supplierName, invoiceNumber: invoice.invoiceNumber, amount: payment.amount, method: payment.paymentMethod, reference: payment.reference, at: payment.paidAt }))),
      expenses: demoExpenses
        .filter((expense) => expense.tenantId === tenantId && expense.status === "paid" && within(expense.spentAt, scope) && inBranches(expense.branchId, scope))
        .map((expense): ExpenseInput => ({ id: expense.id, branchId: expense.branchId, category: expense.category, description: expense.description, vendor: expense.vendor, amount: expense.amount, method: expense.paymentMethod, at: expense.spentAt }))
    };
  }

  const branch = scope.branchIds ? { branchId: { in: scope.branchIds } } : {};
  const period = { gte: scope.from, lte: scope.to };
  const [branchRows, customerRows, sales, returnEvents, ledgerRows, invoiceRows, expenseRows] = await Promise.all([
    prisma.branch.findMany({ where: { tenantId }, select: { id: true, name: true } }),
    prisma.customer.findMany({ where: { tenantId }, select: { id: true, name: true } }),
    prisma.completedSale.findMany({ where: { tenantId, ...branch, createdAt: period }, select: { id: true, branchId: true, customerId: true, summary: true, createdAt: true } }),
    prisma.auditEvent.findMany({ where: { tenantId, ...branch, action: { in: ["sale.refunded", "sale.voided"] }, createdAt: period }, select: { action: true, entityId: true, metadata: true, createdAt: true } }),
    prisma.customerLedgerEntry.findMany({ where: { tenantId, ...branch, type: "payment", createdAt: period } }),
    // Invoices in the period, and any with payments in it (paid later than invoiced).
    prisma.supplierInvoice.findMany({ where: { tenantId, ...branch, OR: [{ invoiceDate: period }, { updatedAt: { gte: scope.from } }] } }),
    prisma.expense.findMany({ where: { tenantId, ...branch, status: "paid", spentAt: period } })
  ]);

  // Refunded/voided sales may come from before the period; fetch them too.
  const returnedIds = [...new Set(returnEvents.map((event) => event.entityId))].filter((id) => !sales.some((sale) => sale.id === id));
  const olderSales = returnedIds.length ? await prisma.completedSale.findMany({ where: { tenantId, id: { in: returnedIds } }, select: { id: true, branchId: true, customerId: true, summary: true, createdAt: true } }) : [];
  const allSales = [...sales, ...olderSales];
  const payments: RawPayment[] = [];
  for (let index = 0; index < allSales.length; index += 1000) {
    const ids = allSales.slice(index, index + 1000).map((sale) => sale.id);
    payments.push(...(await prisma.paymentRecord.findMany({ where: { tenantId, saleId: { in: ids } }, select: { saleId: true, method: true, amount: true } })));
  }
  const earlierRefunds = returnEvents.some((event) => event.action === "sale.voided")
    ? await prisma.auditEvent.findMany({ where: { tenantId, action: "sale.refunded", entityId: { in: returnEvents.filter((event) => event.action === "sale.voided").map((event) => event.entityId) } }, select: { action: true, entityId: true, metadata: true, createdAt: true } })
    : [];

  const branchNames = new Map(branchRows.map((row) => [row.id, row.name]));
  const customerNames = new Map(customerRows.map((row) => [row.id, row.name]));
  const paymentsBySale = new Map<string, RawPayment[]>();
  for (const payment of payments) paymentsBySale.set(payment.saleId, [...(paymentsBySale.get(payment.saleId) ?? []), payment]);
  const saleInputs = new Map(allSales.map((sale) => [sale.id, toSaleInput(sale, paymentsBySale.get(sale.id) ?? [], customerNames)]));

  return {
    branchName: (id) => branchNames.get(id) ?? id,
    sales: sales.map((sale) => saleInputs.get(sale.id)!),
    returns: toReturns(returnEvents, earlierRefunds, saleInputs),
    customerPayments: ledgerRows.map((entry) => ({ id: entry.id, branchId: entry.branchId, customerName: customerNames.get(entry.customerId) ?? entry.customerId, amount: Math.abs(entry.amount), at: entry.createdAt.toISOString(), note: entry.note })),
    purchases: invoiceRows.filter((invoice) => within(invoice.invoiceDate, scope)).map((invoice) => ({ id: invoice.id, branchId: invoice.branchId, supplierName: invoice.supplierName, invoiceNumber: invoice.invoiceNumber, amount: invoice.amount, date: invoice.invoiceDate.toISOString() })),
    supplierPayments: invoiceRows.flatMap((invoice) =>
      (Array.isArray(invoice.payments) ? (invoice.payments as { id: string; amount: number; paymentMethod: string; reference: string; paidAt: string }[]) : [])
        .filter((payment) => within(payment.paidAt, scope))
        .map((payment) => ({ id: payment.id, branchId: invoice.branchId, supplierName: invoice.supplierName, invoiceNumber: invoice.invoiceNumber, amount: payment.amount, method: payment.paymentMethod, reference: payment.reference, at: payment.paidAt }))
    ),
    expenses: expenseRows.map((expense) => ({ id: expense.id, branchId: expense.branchId, category: expense.category, description: expense.description, vendor: expense.vendor, amount: expense.amount, method: expense.paymentMethod, at: expense.spentAt.toISOString() }))
  };
}
