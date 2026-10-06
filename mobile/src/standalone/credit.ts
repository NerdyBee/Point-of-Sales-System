import type { Platform } from "../data/db";
import type { Customer } from "../data/readModel";
import type { DeviceSettings } from "../sync/settings";
import { context, getRow, now, putRow } from "./store";

/**
 * Customer credit ("on account") for a standalone device.
 *
 * - Only registered customers with a credit account (credit limit > 0) can buy on credit,
 *   and a sale may not take them over their limit.
 * - Every change to what a customer owes is a ledger entry (same shape as the server's
 *   customer_ledger_entries): amount > 0 increases the debt, amount < 0 reduces it.
 * - customers.outstandingBalance always equals the last entry's balanceAfter.
 */

export type LedgerType = "credit_sale" | "payment" | "credit_void" | "adjustment";
export type PaymentChannel = "cash" | "card" | "bank_transfer" | "mobile_money";

export interface LedgerEntry {
  id: string;
  customerId: string;
  type: LedgerType;
  amount: number;
  balanceAfter: number;
  note: string;
  reference?: string;
  paymentMethod?: PaymentChannel;
  paymentReference?: string;
  createdBy: string;
  createdAt: string;
}

export class CreditError extends Error {}

type CustomerRow = Customer & Record<string, unknown>;

async function loadCustomer(platform: Platform, customerId: string) {
  const customer = await getRow<CustomerRow>(platform.db, "customers", customerId);
  if (!customer) throw new CreditError("Customer not found");
  return customer;
}

async function writeEntry(platform: Platform, settings: DeviceSettings, customer: CustomerRow, entry: Omit<LedgerEntry, "id" | "balanceAfter" | "createdAt" | "customerId">) {
  const balanceAfter = Number(customer.outstandingBalance ?? 0) + entry.amount;
  const record: LedgerEntry & Record<string, unknown> = {
    ...entry,
    id: `ledger-${platform.uuid()}`,
    customerId: customer.id,
    balanceAfter,
    createdAt: now(),
    tenantId: settings.tenantId,
    branchId: settings.branchId,
    pointsDelta: 0,
    pointsAfter: Number(customer.loyaltyPoints ?? 0)
  };
  await putRow(platform.db, "customer_ledger_entries", record.id, record, settings.branchId);
  await putRow(platform.db, "customers", customer.id, { ...customer, outstandingBalance: balanceAfter });
  return record as LedgerEntry;
}

export function availableCredit(customer: Pick<Customer, "creditLimit" | "outstandingBalance">) {
  return Math.max(0, Number(customer.creditLimit ?? 0) - Number(customer.outstandingBalance ?? 0));
}

export function hasCreditAccount(customer: Pick<Customer, "creditLimit"> | null | undefined) {
  return Boolean(customer && Number(customer.creditLimit ?? 0) > 0);
}

/**
 * Puts part (or all) of a sale on the customer's account. Must run inside the sale's
 * transaction so a refused credit leaves no sale behind.
 */
export async function chargeToAccount(platform: Platform, input: { customerId: string; amount: number; saleNumber: string; staffId: string }) {
  const settings = await context(platform);
  if (!Number.isInteger(input.amount) || input.amount <= 0) throw new CreditError("Invalid credit amount");
  const customer = await loadCustomer(platform, input.customerId);
  if (!hasCreditAccount(customer)) {
    throw new CreditError(`${customer.name} does not have a credit account. An owner or manager can set a credit limit in Manage → Customers.`);
  }
  const available = availableCredit(customer);
  if (input.amount > available) {
    throw new CreditError(`Credit limit exceeded: ${customer.name} can buy up to ${available.toLocaleString()} more on account.`);
  }
  const entry = await writeEntry(platform, settings, customer, {
    type: "credit_sale",
    amount: input.amount,
    note: `Credit sale ${input.saleNumber}`,
    reference: input.saleNumber,
    createdBy: input.staffId
  });
  return { amount: input.amount, balanceAfter: entry.balanceAfter, limit: Number(customer.creditLimit) };
}

/** Undoes the credit part of a voided sale. */
export async function reverseAccountCharge(platform: Platform, input: { customerId: string; amount: number; saleNumber: string; staffId: string }) {
  const settings = await context(platform);
  const customer = await loadCustomer(platform, input.customerId);
  return writeEntry(platform, settings, customer, {
    type: "credit_void",
    amount: -Math.abs(input.amount),
    note: `Voided credit sale ${input.saleNumber}`,
    reference: input.saleNumber,
    createdBy: input.staffId
  });
}

/** Records money received against a customer's account. Cash goes into the open register. */
export async function receivePayment(
  platform: Platform,
  input: { customerId: string; amount: number; method: PaymentChannel; reference?: string; note?: string; staffId: string }
) {
  const settings = await context(platform);
  if (!Number.isInteger(input.amount) || input.amount <= 0) throw new CreditError("Enter the amount received");
  if (input.method !== "cash" && !input.reference?.trim()) throw new CreditError("Enter the payment reference");

  let entry: LedgerEntry | null = null;
  await platform.db.transaction(async () => {
    const customer = await loadCustomer(platform, input.customerId);
    const owed = Number(customer.outstandingBalance ?? 0);
    if (owed <= 0) throw new CreditError(`${customer.name} does not owe anything`);
    if (input.amount > owed) throw new CreditError(`${customer.name} owes ${owed.toLocaleString()}. Enter that amount or less.`);

    if (input.method === "cash") {
      const shift = await platform.db.first<{ id: string }>("SELECT id FROM shifts WHERE status = 'open' ORDER BY openedAt DESC LIMIT 1");
      if (!shift) throw new CreditError("Open the register to receive a cash payment, so the cash is counted in the drawer.");
      await platform.db.run("UPDATE shifts SET cashIn = cashIn + ? WHERE id = ?", [input.amount, shift.id]);
    }

    entry = await writeEntry(platform, settings, customer, {
      type: "payment",
      amount: -input.amount,
      note: input.note?.trim() || "Payment received",
      paymentMethod: input.method,
      paymentReference: input.reference?.trim() || undefined,
      createdBy: input.staffId
    });
  });
  return entry as unknown as LedgerEntry;
}

/** Statement lines, oldest first. */
export async function customerLedger(platform: Platform, customerId: string) {
  const rows = await platform.db.all<{ data: string }>(
    "SELECT data FROM rows WHERE tbl = 'customer_ledger_entries' AND json_extract(data, '$.customerId') = ? ORDER BY json_extract(data, '$.createdAt'), rowid",
    [customerId]
  );
  return rows.map((row) => JSON.parse(row.data) as LedgerEntry);
}

/** Total owed to the shop and how many customers owe. */
export async function debtorsSummary(platform: Platform) {
  const row = await platform.db.first<{ owed: number; debtors: number; accounts: number }>(
    `SELECT COALESCE(SUM(CASE WHEN json_extract(data, '$.outstandingBalance') > 0 THEN json_extract(data, '$.outstandingBalance') ELSE 0 END), 0) AS owed,
            SUM(CASE WHEN json_extract(data, '$.outstandingBalance') > 0 THEN 1 ELSE 0 END) AS debtors,
            SUM(CASE WHEN json_extract(data, '$.creditLimit') > 0 THEN 1 ELSE 0 END) AS accounts
     FROM rows WHERE tbl = 'customers'`
  );
  return { owed: Number(row?.owed ?? 0), debtors: Number(row?.debtors ?? 0), accounts: Number(row?.accounts ?? 0) };
}

const ledgerLabels: Record<LedgerType, string> = { credit_sale: "Credit sale", payment: "Payment", credit_void: "Voided sale", adjustment: "Adjustment" };

/** Plain-text statement for WhatsApp/SMS. */
export function statementText(input: { businessName: string; customer: Customer; entries: LedgerEntry[]; money: (amount: number) => string }) {
  const lines = [
    `${input.businessName}`,
    `Account statement: ${input.customer.name} (${input.customer.phone})`,
    `Date: ${new Date().toLocaleDateString()}`,
    ""
  ];
  for (const entry of input.entries) {
    const date = new Date(entry.createdAt).toLocaleDateString();
    const amount = entry.amount > 0 ? `+${input.money(entry.amount)}` : `-${input.money(Math.abs(entry.amount))}`;
    lines.push(`${date}  ${ledgerLabels[entry.type] ?? entry.type}${entry.reference ? ` ${entry.reference}` : ""}  ${amount}  bal ${input.money(entry.balanceAfter)}`);
  }
  lines.push("", `Balance owed: ${input.money(Number(input.customer.outstandingBalance ?? 0))}`);
  if (Number(input.customer.creditLimit ?? 0) > 0) lines.push(`Credit limit: ${input.money(Number(input.customer.creditLimit))}`);
  return lines.join("\n");
}

export { ledgerLabels };
