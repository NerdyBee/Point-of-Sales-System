import type { Platform } from "../data/db";
import { readModel, type Customer, type Staff, type TenantSettings } from "../data/readModel";
import { enqueueCommand } from "../sync/engine";
import { getKv, setKv, type DeviceSettings } from "../sync/settings";
import { calculateSale, type CartLine, type SaleSummary } from "./pricing";

/**
 * Everything the cashier does is written locally first and queued as a command,
 * so the tablet behaves the same online and offline.
 */

export type PaymentMethod = "cash" | "card" | "bank_transfer" | "mobile_money";
export const referenceRequired: PaymentMethod[] = ["card", "bank_transfer", "mobile_money"];

export interface Payment {
  method: PaymentMethod;
  amount: number;
  reference?: string;
}

export interface LocalShift {
  id: string;
  serverId: string | null;
  home: string | null;
  openedBy: string;
  openingBalance: number;
  cashSales: number;
  status: "open" | "closing" | "closed";
  countedCash: number | null;
  openedAt: string;
}

export interface LocalSale {
  id: string;
  number: string;
  shiftId: string;
  idempotencyKey: string;
  staffId: string;
  customerId: string | null;
  total: number;
  status: "pending" | "synced" | "conflict";
  serverId: string | null;
  reconciled: number;
  createdAt: string;
  data: string;
}

export interface SaleRecord {
  summary: SaleSummary;
  payments: Payment[];
  customer?: Pick<Customer, "id" | "name" | "phone">;
  staffName: string;
}

export class PosError extends Error {}

const localId = (platform: Platform, kind: string) => `local-${kind}-${platform.uuid()}`;

export async function currentShift(platform: Platform) {
  return platform.db.first<LocalShift>("SELECT * FROM shifts WHERE status IN ('open', 'closing') ORDER BY openedAt DESC LIMIT 1");
}

export async function staffPermissions(platform: Platform, staff: Staff) {
  return readModel.permissionsForRole(platform.db, staff.role);
}

export async function openShift(platform: Platform, staff: Staff, openingBalance: number) {
  if (await currentShift(platform)) throw new PosError("A register shift is already open on this tablet");
  if (!Number.isInteger(openingBalance) || openingBalance < 0) throw new PosError("Enter a valid opening float");

  const id = localId(platform, "shift");
  await platform.db.transaction(async () => {
    await platform.db.run("INSERT INTO shifts (id, openedBy, openingBalance, status, openedAt) VALUES (?, ?, ?, 'open', ?)", [
      id,
      staff.id,
      openingBalance,
      new Date().toISOString()
    ]);
    await enqueueCommand(platform, { type: "register.open", staffId: staff.id, shiftLocalId: id, payload: { localShiftId: id, openingBalance } });
  });
  return id;
}

/** Sends the cash count; a manager approves and finalises the close in the web app. */
export async function requestCloseShift(platform: Platform, staff: Staff, countedCash: number, note?: string) {
  const shift = await currentShift(platform);
  if (!shift || shift.status !== "open") throw new PosError("No open shift to close");
  await platform.db.transaction(async () => {
    await platform.db.run("UPDATE shifts SET status = 'closing', countedCash = ? WHERE id = ?", [countedCash, shift.id]);
    await enqueueCommand(platform, {
      type: "register.close",
      staffId: staff.id,
      shiftLocalId: shift.id,
      payload: { shiftId: shift.serverId ?? shift.id, countedCash, note: note?.trim() || undefined }
    });
  });
}

/** Units of each product sold on this tablet that the server stock does not reflect yet. */
export async function pendingStockDeductions(platform: Platform) {
  const rows = await platform.db.all<{ data: string }>("SELECT data FROM sales WHERE reconciled = 0 AND status <> 'conflict'");
  const deductions = new Map<string, number>();
  for (const row of rows) {
    const record = JSON.parse(row.data) as SaleRecord;
    for (const line of record.summary.lines) deductions.set(line.productId, (deductions.get(line.productId) ?? 0) + line.quantity);
  }
  return deductions;
}

async function nextSaleNumber(platform: Platform, settings: DeviceSettings) {
  const next = Number((await getKv(platform, "sale.counter")) ?? 0) + 1;
  await setKv(platform, "sale.counter", String(next));
  return `${settings.deviceCode}-${String(next).padStart(5, "0")}`;
}

export async function recordSale(
  platform: Platform,
  input: { settings: DeviceSettings; tenantSettings: TenantSettings; staff: Staff; cart: CartLine[]; payments: Payment[]; customer?: Customer | null }
) {
  const shift = await currentShift(platform);
  if (!shift || shift.status !== "open") throw new PosError("Open the register before selling");
  if (!input.cart.length) throw new PosError("The cart is empty");

  const summary = calculateSale(input.cart, input.tenantSettings);
  const payments = input.payments.filter((payment) => payment.amount > 0);
  const paid = payments.reduce((sum, payment) => sum + payment.amount, 0);
  if (paid !== summary.total) throw new PosError("Payments must equal the sale total");
  for (const payment of payments) {
    if (referenceRequired.includes(payment.method) && !payment.reference?.trim()) throw new PosError("Enter the payment reference");
  }

  const id = localId(platform, "sale");
  const idempotencyKey = `tab-${input.settings.deviceCode}-${platform.uuid()}`;
  const createdAt = new Date().toISOString();
  const cash = payments.filter((payment) => payment.method === "cash").reduce((sum, payment) => sum + payment.amount, 0);
  const record: SaleRecord = {
    summary,
    payments,
    customer: input.customer ? { id: input.customer.id, name: input.customer.name, phone: input.customer.phone } : undefined,
    staffName: input.staff.name
  };

  let number = "";
  await platform.db.transaction(async () => {
    number = await nextSaleNumber(platform, input.settings);
    await platform.db.run(
      "INSERT INTO sales (id, number, shiftId, idempotencyKey, staffId, customerId, data, total, status, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?)",
      [id, number, shift.id, idempotencyKey, input.staff.id, input.customer?.id ?? null, JSON.stringify(record), summary.total, createdAt]
    );
    if (cash) await platform.db.run("UPDATE shifts SET cashSales = cashSales + ? WHERE id = ?", [cash, shift.id]);
    await enqueueCommand(platform, {
      type: "sale.create",
      staffId: input.staff.id,
      shiftLocalId: shift.id,
      payload: {
        localSaleId: id,
        idempotencyKey,
        customerId: input.customer?.id,
        lines: input.cart.map((line) => ({ productId: line.product.id, quantity: line.quantity, discount: line.discount, note: line.note, unitPrice: line.product.price })),
        payments: payments.map((payment) => ({ method: payment.method, amount: payment.amount, reference: payment.reference?.trim() || undefined }))
      }
    });
  });

  return { id, number, summary, createdAt, record };
}

export async function createCustomer(platform: Platform, staff: Staff, input: { name: string; phone: string }) {
  const name = input.name.trim();
  const phone = input.phone.replace(/\s+/g, "");
  if (name.length < 2) throw new PosError("Enter the customer's name");
  if (phone.length < 7) throw new PosError("Enter a valid phone number");

  const existing = await platform.db.first<{ data: string }>("SELECT data FROM rows WHERE tbl = 'customers' AND json_extract(data, '$.phone') = ?", [phone]);
  if (existing) return JSON.parse(existing.data) as Customer;

  const customer: Customer = { id: localId(platform, "customer"), name, phone, group: "Walk-in", loyaltyPoints: 0, creditLimit: 0, outstandingBalance: 0 };
  // Route with the open shift so the sale that uses this customer goes to the same server.
  const shift = await currentShift(platform);
  await platform.db.transaction(async () => {
    await platform.db.run("INSERT INTO rows (tbl, id, branchId, data, updatedAt) VALUES ('customers', ?, NULL, ?, ?)", [
      customer.id,
      JSON.stringify(customer),
      new Date().toISOString()
    ]);
    await enqueueCommand(platform, {
      type: "customer.create",
      staffId: staff.id,
      shiftLocalId: shift?.id,
      payload: { localCustomerId: customer.id, name, phone, group: "Walk-in" }
    });
  });
  return customer;
}

export async function recentSales(platform: Platform, limit = 100) {
  return platform.db.all<LocalSale>("SELECT * FROM sales ORDER BY createdAt DESC LIMIT ?", [limit]);
}
