import { customerLedger as demoLedger, customers as demoCustomers, supplierInvoices as demoInvoices } from "../../shared/data/demoStore";
import { prisma } from "../../shared/db/prisma";
import { creditorRows, debtorRow, reconciled, statement, type CreditorInvoice, type DebtorRow, type LedgerEntry } from "./ageing";

const useDemoStore = process.env.NODE_ENV === "test";
const iso = (value: Date | string) => (value instanceof Date ? value.toISOString() : value);

type CustomerFacts = { id: string; name: string; phone: string; email?: string | null; creditLimit: number; outstandingBalance: number; createdAt: Date | string };

const toEntry = (entry: { id: string; type: string; note: string | null; balanceAfter: number; createdAt: Date | string }): LedgerEntry => ({
  id: entry.id,
  type: entry.type,
  note: entry.note ?? "",
  balanceAfter: Number(entry.balanceAfter),
  createdAt: iso(entry.createdAt)
});

/**
 * Customers who owe money, oldest debt first. Balances are per customer, not per branch, so
 * this covers the whole business.
 */
export async function debtorsAgeing(tenantId: string, now = new Date()) {
  let owing: CustomerFacts[];
  let entries: (LedgerEntry & { customerId: string })[];
  if (useDemoStore) {
    owing = demoCustomers.filter((customer) => customer.tenantId === tenantId && customer.outstandingBalance > 0);
    const ids = new Set(owing.map((customer) => customer.id));
    entries = demoLedger.filter((entry) => entry.tenantId === tenantId && ids.has(entry.customerId)).map((entry) => ({ ...toEntry(entry), customerId: entry.customerId }));
  } else {
    owing = await prisma.customer.findMany({
      where: { tenantId, outstandingBalance: { gt: 0 } },
      select: { id: true, name: true, phone: true, email: true, creditLimit: true, outstandingBalance: true, createdAt: true }
    });
    entries = [];
    for (let index = 0; index < owing.length; index += 500) {
      const rows = await prisma.customerLedgerEntry.findMany({
        where: { tenantId, customerId: { in: owing.slice(index, index + 500).map((customer) => customer.id) } },
        select: { id: true, customerId: true, type: true, note: true, balanceAfter: true, createdAt: true }
      });
      entries.push(...rows.map((row) => ({ ...toEntry(row), customerId: row.customerId })));
    }
  }

  const byCustomer = new Map<string, LedgerEntry[]>();
  for (const entry of entries) byCustomer.set(entry.customerId, [...(byCustomer.get(entry.customerId) ?? []), entry]);
  return owing
    .map((customer) => debtorRow(customer, reconciled(byCustomer.get(customer.id) ?? [], customer.outstandingBalance, iso(customer.createdAt), now), now))
    .filter((row): row is DebtorRow => row !== null)
    .sort((left, right) => right.oldestDays - left.oldestDays || right.total - left.total);
}

/** Unpaid supplier invoices, by supplier. */
export async function creditorsAgeing(tenantId: string, branchIds: string[] | undefined, now = new Date()) {
  let invoices: CreditorInvoice[];
  if (useDemoStore) {
    invoices = demoInvoices
      .filter((invoice) => invoice.tenantId === tenantId && invoice.status !== "voided" && invoice.balanceDue > 0 && (!branchIds || branchIds.includes(invoice.branchId)))
      .map((invoice) => ({ ...invoice, dueDate: invoice.dueDate ?? null }));
  } else {
    const rows = await prisma.supplierInvoice.findMany({
      where: { tenantId, status: { not: "voided" }, balanceDue: { gt: 0 }, ...(branchIds ? { branchId: { in: branchIds } } : {}) },
      select: { id: true, branchId: true, supplierId: true, supplierName: true, invoiceNumber: true, invoiceDate: true, dueDate: true, balanceDue: true }
    });
    invoices = rows.map((row) => ({ ...row, invoiceDate: row.invoiceDate.toISOString(), dueDate: row.dueDate ? row.dueDate.toISOString() : null }));
  }
  return creditorRows(invoices, now);
}

/** A customer's statement of account for a period. */
export async function customerStatement(tenantId: string, customerId: string, from: Date, to: Date, now = new Date()) {
  let customer: CustomerFacts | null;
  let entries: LedgerEntry[];
  if (useDemoStore) {
    customer = demoCustomers.find((item) => item.tenantId === tenantId && item.id === customerId) ?? null;
    entries = demoLedger.filter((entry) => entry.tenantId === tenantId && entry.customerId === customerId).map(toEntry);
  } else {
    customer = await prisma.customer.findFirst({
      where: { tenantId, id: customerId },
      select: { id: true, name: true, phone: true, email: true, creditLimit: true, outstandingBalance: true, createdAt: true }
    });
    entries = customer
      ? (await prisma.customerLedgerEntry.findMany({ where: { tenantId, customerId }, select: { id: true, type: true, note: true, balanceAfter: true, createdAt: true } })).map(toEntry)
      : [];
  }
  if (!customer) return null;

  const all = reconciled(entries, customer.outstandingBalance, iso(customer.createdAt), now);
  const row = debtorRow(customer, all, now);
  return {
    customer: { id: customer.id, name: customer.name, phone: customer.phone, email: customer.email ?? "", creditLimit: customer.creditLimit, outstandingBalance: customer.outstandingBalance },
    ...statement(all, from, to),
    ageing: row?.buckets ?? { current: 0, days31to60: 0, days61to90: 0, over90: 0 }
  };
}
