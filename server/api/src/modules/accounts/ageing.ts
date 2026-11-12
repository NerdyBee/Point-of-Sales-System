/**
 * Who owes the business, who the business owes, and for how long; and customer statements.
 *
 * Debtors: each increase in a customer's balance (a credit sale) is an open item from the day
 * it happened; each decrease (a payment, refund or voucher) settles the oldest open items first.
 * What stays open is aged. Working from each entry's `balanceAfter` keeps this right whatever
 * the entry type.
 */

export const ageBuckets = ["current", "days31to60", "days61to90", "over90"] as const;
export type AgeBucket = (typeof ageBuckets)[number];
export type Buckets = Record<AgeBucket, number>;

const emptyBuckets = (): Buckets => ({ current: 0, days31to60: 0, days61to90: 0, over90: 0 });
const day = 86_400_000;

export function bucketFor(days: number): AgeBucket {
  if (days <= 30) return "current";
  if (days <= 60) return "days31to60";
  if (days <= 90) return "days61to90";
  return "over90";
}

export interface LedgerEntry {
  id: string;
  type: string;
  note: string;
  balanceAfter: number;
  createdAt: string;
}

/** Each entry's change in balance: positive = the customer owes more (debit). */
export function withChanges(entries: LedgerEntry[]) {
  const sorted = [...entries].sort((left, right) => left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id));
  let previous = 0;
  return sorted.map((entry) => {
    const change = entry.balanceAfter - previous;
    previous = entry.balanceAfter;
    return { ...entry, change };
  });
}

/**
 * Makes the entries agree with the customer's current balance. A balance with no entries
 * (entered when the customer was created, or carried over from an old system) becomes a
 * "balance brought forward" on the day the customer was added; any other difference becomes
 * an adjustment today.
 */
export function reconciled(entries: LedgerEntry[], currentBalance: number, customerSince: string, now = new Date()): LedgerEntry[] {
  const sorted = withChanges(entries);
  const last = sorted.length ? sorted[sorted.length - 1].balanceAfter : 0;
  if (last === currentBalance) return entries;
  if (!entries.length) return [{ id: "opening", type: "opening", note: "Balance brought forward", balanceAfter: currentBalance, createdAt: customerSince }];
  return [...entries, { id: "~adjustment", type: "adjustment", note: "Balance adjustment", balanceAfter: currentBalance, createdAt: now.toISOString() }];
}

/** Open items left after payments settle the oldest first, with their age in days. */
export function openItems(entries: LedgerEntry[], now = new Date()) {
  const items: { date: string; amount: number; note: string }[] = [];
  for (const entry of withChanges(entries)) {
    if (entry.change > 0) {
      items.push({ date: entry.createdAt, amount: entry.change, note: entry.note });
      continue;
    }
    let toSettle = -entry.change;
    while (toSettle > 0 && items.length) {
      const oldest = items[0];
      const used = Math.min(oldest.amount, toSettle);
      oldest.amount -= used;
      toSettle -= used;
      if (oldest.amount === 0) items.shift();
    }
  }
  return items.map((item) => ({ ...item, days: Math.max(0, Math.floor((now.getTime() - new Date(item.date).getTime()) / day)) }));
}

export interface DebtorRow {
  customerId: string;
  name: string;
  phone: string;
  creditLimit: number;
  total: number;
  buckets: Buckets;
  oldestDays: number;
}

export function debtorRow(customer: { id: string; name: string; phone: string; creditLimit: number }, entries: LedgerEntry[], now = new Date()): DebtorRow | null {
  const items = openItems(entries, now);
  const buckets = emptyBuckets();
  for (const item of items) buckets[bucketFor(item.days)] += item.amount;
  const total = items.reduce((sum, item) => sum + item.amount, 0);
  if (total <= 0) return null;
  return { customerId: customer.id, name: customer.name, phone: customer.phone, creditLimit: customer.creditLimit, total, buckets, oldestDays: Math.max(...items.map((item) => item.days)) };
}

export interface CreditorInvoice {
  id: string;
  branchId: string;
  supplierId: string;
  supplierName: string;
  invoiceNumber: string;
  invoiceDate: string;
  dueDate?: string | null;
  balanceDue: number;
}

export interface CreditorRow {
  supplierId: string;
  name: string;
  total: number;
  /** Not yet due, then overdue by 1-30, 31-60, 61-90 and over 90 days. */
  buckets: { notDue: number } & Buckets;
  invoices: { invoiceNumber: string; invoiceDate: string; dueDate: string | null; balanceDue: number; daysOverdue: number }[];
}

/** Unpaid supplier invoices by supplier, aged from the due date (or the invoice date if none). */
export function creditorRows(invoices: CreditorInvoice[], now = new Date()): CreditorRow[] {
  const rows = new Map<string, CreditorRow>();
  for (const invoice of invoices.filter((item) => item.balanceDue > 0)) {
    const due = new Date(invoice.dueDate ?? invoice.invoiceDate);
    const daysOverdue = Math.floor((now.getTime() - due.getTime()) / day);
    const row = rows.get(invoice.supplierId) ?? { supplierId: invoice.supplierId, name: invoice.supplierName, total: 0, buckets: { notDue: 0, ...emptyBuckets() }, invoices: [] };
    row.total += invoice.balanceDue;
    // Overdue buckets count days past due: 1-30 days late is "current" overdue.
    if (daysOverdue <= 0) row.buckets.notDue += invoice.balanceDue;
    else row.buckets[bucketFor(daysOverdue)] += invoice.balanceDue;
    row.invoices.push({ invoiceNumber: invoice.invoiceNumber, invoiceDate: invoice.invoiceDate, dueDate: invoice.dueDate ?? null, balanceDue: invoice.balanceDue, daysOverdue: Math.max(0, daysOverdue) });
    rows.set(invoice.supplierId, row);
  }
  return [...rows.values()].sort((left, right) => right.total - left.total);
}

export interface StatementLine {
  date: string;
  type: string;
  description: string;
  debit: number;
  credit: number;
  balance: number;
}

const typeLabels: Record<string, string> = { credit_sale: "Credit sale", payment: "Payment received", voucher: "Voucher", refund: "Refund", loyalty_adjustment: "Adjustment", opening: "Opening balance", adjustment: "Adjustment" };

/** Statement of account: balance brought forward, each movement in the period, balance due. */
export function statement(entries: LedgerEntry[], from: Date, to: Date) {
  const changes = withChanges(entries);
  const before = changes.filter((entry) => new Date(entry.createdAt) < from);
  const openingBalance = before.length ? before[before.length - 1].balanceAfter : 0;
  const lines: StatementLine[] = changes
    .filter((entry) => {
      const at = new Date(entry.createdAt);
      return at >= from && at <= to && entry.change !== 0;
    })
    .map((entry) => ({
      date: entry.createdAt,
      type: entry.type,
      description: [typeLabels[entry.type] ?? entry.type, entry.note].filter(Boolean).join(": "),
      debit: Math.max(entry.change, 0),
      credit: Math.max(-entry.change, 0),
      balance: entry.balanceAfter
    }));
  return { openingBalance, lines, closingBalance: lines.length ? lines[lines.length - 1].balance : openingBalance };
}
