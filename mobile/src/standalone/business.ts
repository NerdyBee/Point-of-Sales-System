import type { Db, Platform } from "../data/db";
import type { Customer, Product, Staff, TenantSettings } from "../data/readModel";
import { reverseAccountCharge } from "./credit";
import { context, getRow, putRow } from "./store";

export { context, getRow, putRow };
import { loadSettings, saveSettings, type DeviceSettings } from "../sync/settings";

/**
 * Standalone mode: the tablet is the whole system for a very small shop.
 *
 * Data is written into the same `rows` tables (and with the same field names) that
 * a server would send, so every screen works unchanged and the data can later be
 * moved onto an office or cloud server.
 */

export type StandaloneRole = "owner" | "manager" | "cashier";

const allActions = [
  "sale.create", "sale.refund", "sale.void", "catalog.manage", "inventory.adjust", "customer.manage", "customer.credit", "staff.manage",
  "register.manage", "register.close", "reports.profit.view", "settings.manage", "sync.manage"
];

/** customer.credit = open credit accounts and set credit limits (selling on account needs only sale.create). */
const roleActions: Record<StandaloneRole, string[]> = {
  owner: allActions,
  manager: ["sale.create", "sale.refund", "sale.void", "catalog.manage", "inventory.adjust", "customer.manage", "customer.credit", "register.manage", "register.close", "reports.profit.view"],
  cashier: ["sale.create", "customer.manage", "register.manage"]
};

export const roleLabels: Record<StandaloneRole, string> = { owner: "Owner", manager: "Manager", cashier: "Cashier" };

const now = () => new Date().toISOString();


function shortCode(platform: Platform, length = 4) {
  return platform.uuid().replace(/-/g, "").slice(0, length).toUpperCase();
}

function initials(value: string, length = 3) {
  const letters = value.toUpperCase().replace(/[^A-Z ]/g, "").split(/\s+/).filter(Boolean);
  const code = letters.length > 1 ? letters.map((word) => word[0]).join("") : (letters[0] ?? "POS");
  return code.slice(0, length).padEnd(length, "X");
}

export function validatePin(pin: string) {
  if (!/^\d{6}$/.test(pin)) return "PIN must be 6 digits";
  if (/^(\d)\1{5}$/.test(pin) || pin === "123456" || pin === "654321") return "Choose a PIN that is harder to guess";
  return null;
}

async function pinHash(platform: Platform, pin: string) {
  return `sha256:${await platform.sha256Hex(pin)}`;
}

export interface StandaloneSetupInput {
  businessName: string;
  currency: TenantSettings["currency"];
  vatPercent: number;
  serviceChargePercent: number;
  ownerName: string;
  ownerPin: string;
  receiptFooter?: string;
}

/** Creates the business, branch, till, roles and owner on this tablet. */
export async function createStandaloneBusiness(platform: Platform, input: StandaloneSetupInput) {
  const businessName = input.businessName.trim();
  const ownerName = input.ownerName.trim();
  if (businessName.length < 2) throw new Error("Enter the business name");
  if (ownerName.length < 2) throw new Error("Enter the owner's name");
  const pinProblem = validatePin(input.ownerPin);
  if (pinProblem) throw new Error(pinProblem);
  if (!(input.vatPercent >= 0 && input.vatPercent <= 100) || !(input.serviceChargePercent >= 0 && input.serviceChargePercent <= 100)) {
    throw new Error("Percentages must be between 0 and 100");
  }
  if (await loadSettings(platform)) throw new Error("This tablet is already set up");

  const code = shortCode(platform);
  const tenantId = `tenant-${code.toLowerCase()}`;
  const branchId = `branch-${code.toLowerCase()}-main`;
  const terminalId = `terminal-${code.toLowerCase()}-1`;
  const settings: TenantSettings & Record<string, unknown> = {
    businessName,
    taxId: "",
    defaultBranchId: branchId,
    defaultTaxRate: input.vatPercent / 100,
    serviceChargeEnabled: input.serviceChargePercent > 0,
    serviceChargeRate: input.serviceChargePercent / 100,
    currency: input.currency,
    productCategories: ["General"],
    receiptFooter: input.receiptFooter?.trim() || "Thank you for your patronage",
    whatsappReceipts: false,
    paymentMethods: { cash: true, card: true, bankTransfer: true, mobileMoney: false },
    hardware: { printer: "", cashDrawer: false, barcodeScanner: false }
  };
  const db = platform.db;
  const created = now();

  await db.transaction(async () => {
    await putRow(db, "tenants", tenantId, { id: tenantId, name: businessName, plan: "Standalone", branchLimit: 1, activeBranches: 1, settings, createdAt: created });
    await putRow(db, "branches", branchId, { id: branchId, tenantId, name: "Main", address: "", city: "", phone: "", status: "active", createdAt: created });
    await putRow(db, "terminals", terminalId, { id: terminalId, tenantId, branchId, name: "Tablet", deviceCode: code, status: "online", appVersion: platform.appVersion, createdAt: created }, branchId);

    for (const action of allActions) {
      await putRow(db, "access_permissions", `perm-${tenantId}-${action}`, { id: `perm-${tenantId}-${action}`, tenantId, action, label: action, group: action.split(".")[0], description: action });
    }
    for (const role of Object.keys(roleActions) as StandaloneRole[]) {
      const roleId = `role-${tenantId}-${role}`;
      await putRow(db, "access_roles", roleId, { id: roleId, tenantId, name: role, label: roleLabels[role], system: true, createdAt: created });
      for (const action of roleActions[role]) {
        const permissionId = `perm-${tenantId}-${action}`;
        await putRow(db, "access_role_permissions", `${roleId}|${permissionId}`, { roleId, permissionId });
      }
    }

    const deviceSettings: DeviceSettings = {
      mode: "standalone",
      tenantId,
      tenantName: businessName,
      terminalId,
      terminalName: "Tablet",
      branchId,
      deviceCode: code,
      servers: {}
    };
    await saveSettings(platform, deviceSettings);
  });

  const owner = await saveStaff(platform, { name: ownerName, role: "owner", pin: input.ownerPin });
  return { tenantId, owner };
}


/**
 * Brings a device set up with an older version up to date: adds permissions introduced
 * since (e.g. customer.credit) to the built-in roles. Safe to run on every start.
 */
export async function ensureStandaloneUpgrades(platform: Platform) {
  const settings = await loadSettings(platform);
  if (!settings || settings.mode !== "standalone") return;
  const tenantId = settings.tenantId;
  const db = platform.db;
  for (const action of allActions) {
    const permissionId = `perm-${tenantId}-${action}`;
    if (!(await getRow(db, "access_permissions", permissionId))) {
      await putRow(db, "access_permissions", permissionId, { id: permissionId, tenantId, action, label: action, group: action.split(".")[0], description: action });
    }
  }
  for (const role of Object.keys(roleActions) as StandaloneRole[]) {
    const roleId = `role-${tenantId}-${role}`;
    if (!(await getRow(db, "access_roles", roleId))) continue;
    for (const action of roleActions[role]) {
      const permissionId = `perm-${tenantId}-${action}`;
      const linkId = `${roleId}|${permissionId}`;
      if (!(await getRow(db, "access_role_permissions", linkId))) await putRow(db, "access_role_permissions", linkId, { roleId, permissionId });
    }
  }
}

// ----- products ---------------------------------------------------------------

export interface ProductInput {
  id?: string;
  name: string;
  category: string;
  price: number;
  cost?: number;
  sku?: string;
  barcode?: string;
  /** Opening stock for a new product. Use adjustStock for existing ones. */
  stock?: number;
  reorderPoint?: number;
}

export async function saveProduct(platform: Platform, input: ProductInput) {
  const settings = await context(platform);
  const name = input.name.trim();
  const category = input.category.trim() || "General";
  if (name.length < 2) throw new Error("Enter the product name");
  if (!Number.isInteger(input.price) || input.price < 0) throw new Error("Enter a valid price");

  const existing = input.id ? await getRow<Product & Record<string, unknown>>(platform.db, "products", input.id) : null;
  const id = existing?.id ?? `p-${platform.uuid().replace(/-/g, "").slice(0, 12)}`;
  const sku = input.sku?.trim() || existing?.sku || `SKU-${id.slice(2, 8).toUpperCase()}`;
  const barcode = input.barcode?.trim() || existing?.barcode || id.slice(2, 14);

  const clash = await platform.db.first<{ id: string }>(
    "SELECT id FROM rows WHERE tbl = 'products' AND id <> ? AND (json_extract(data, '$.sku') = ? OR json_extract(data, '$.barcode') = ?)",
    [id, sku, barcode]
  );
  if (clash) throw new Error("Another product already uses this SKU or barcode");

  const product = {
    ...(existing ?? { tenantId: settings.tenantId, branchId: settings.branchId, image: "", station: "Counter", modifiers: [], taxRate: 0, createdAt: now() }),
    id,
    name,
    category,
    price: input.price,
    cost: input.cost ?? existing?.cost ?? 0,
    sku,
    barcode,
    stock: existing ? existing.stock : Math.max(0, Math.trunc(input.stock ?? 0)),
    reorderPoint: input.reorderPoint ?? existing?.reorderPoint ?? 0,
    updatedAt: now()
  };

  await platform.db.transaction(async () => {
    await putRow(platform.db, "products", id, product, settings.branchId);
    if (!existing && product.stock > 0) await recordMovement(platform, settings, product, product.stock, "Opening stock", "count");
    await addCategory(platform, settings, category);
  });
  return product as unknown as Product;
}

async function addCategory(platform: Platform, settings: DeviceSettings, category: string) {
  const tenant = await getRow<{ settings: TenantSettings } & Record<string, unknown>>(platform.db, "tenants", settings.tenantId);
  if (!tenant) return;
  const categories = tenant.settings.productCategories ?? [];
  if (categories.some((item) => item.toLowerCase() === category.toLowerCase())) return;
  await putRow(platform.db, "tenants", settings.tenantId, { ...tenant, settings: { ...tenant.settings, productCategories: [...categories, category] } });
}

/**
 * Movement types: count (opening stock), receipt (inflow), issue (sale), return (voided
 * sale back into stock), adjustment (damaged, missing, recount, cancelled inflow).
 */
export async function recordMovement(
  platform: Platform,
  settings: DeviceSettings,
  product: { id: string; name: string },
  delta: number,
  reason: string,
  type: string,
  balanceAfter?: number,
  extra: { reference?: string; unitCost?: number } = {}
) {
  const id = `move-${platform.uuid()}`;
  await putRow(platform.db, "stock_movements", id, {
    id,
    tenantId: settings.tenantId,
    branchId: settings.branchId,
    productId: product.id,
    productName: product.name,
    type,
    quantityDelta: delta,
    balanceAfter: balanceAfter ?? delta,
    reason,
    ...(extra.reference ? { reference: extra.reference } : {}),
    ...(extra.unitCost !== undefined ? { unitCost: extra.unitCost } : {}),
    createdAt: now()
  }, settings.branchId);
}

/** Adds (receive) or removes (damage, count correction) stock and keeps a movement record. */
export async function adjustStock(platform: Platform, productId: string, delta: number, reason: string) {
  const settings = await context(platform);
  if (!Number.isInteger(delta) || delta === 0) throw new Error("Enter a whole number of units");
  if (reason.trim().length < 3) throw new Error("Enter a reason");
  await platform.db.transaction(async () => {
    const product = await getRow<Product & Record<string, unknown>>(platform.db, "products", productId);
    if (!product) throw new Error("Product not found");
    const stock = Number(product.stock) + delta;
    if (stock < 0) throw new Error("Stock cannot go below zero");
    await putRow(platform.db, "products", productId, { ...product, stock, updatedAt: now() }, settings.branchId);
    await recordMovement(platform, settings, product, delta, reason.trim(), delta > 0 ? "receipt" : "adjustment", stock);
  });
}

/** Called by a standalone sale: deduct stock (may go negative; the goods already left). */
export async function deductStockForSale(platform: Platform, settings: DeviceSettings, lines: { productId: string; quantity: number }[], reference: string) {
  for (const line of lines) {
    const product = await getRow<Product & Record<string, unknown>>(platform.db, "products", line.productId);
    if (!product || product.category.trim().toLowerCase() === "services") continue;
    const stock = Number(product.stock) - line.quantity;
    await putRow(platform.db, "products", product.id, { ...product, stock, updatedAt: now() }, settings.branchId);
    await recordMovement(platform, settings, product, -line.quantity, `Sale ${reference}`, "issue", stock, { reference });
  }
}

// ----- staff ------------------------------------------------------------------

export interface StaffInput {
  id?: string;
  name: string;
  role: StandaloneRole;
  /** Required for new staff; optional to reset an existing PIN. */
  pin?: string;
  phone?: string;
}

export async function saveStaff(platform: Platform, input: StaffInput) {
  const settings = await context(platform);
  const name = input.name.trim();
  if (name.length < 2) throw new Error("Enter the staff member's name");
  if (!roleActions[input.role]) throw new Error("Choose a role");
  const existing = input.id ? await getRow<Staff & Record<string, unknown>>(platform.db, "staff_members", input.id) : null;
  if (!existing && !input.pin) throw new Error("Set a 6-digit PIN");
  if (input.pin) {
    const problem = validatePin(input.pin);
    if (problem) throw new Error(problem);
  }
  if (existing?.role === "owner" && input.role !== "owner" && (await activeOwnerCount(platform.db)) <= 1) {
    throw new Error("Keep at least one owner");
  }

  let id = existing?.id;
  if (!id) {
    const base = `${initials(settings.tenantName)}-MAI-${initials(name.split(/\s+/)[0] ?? name)}`;
    id = base;
    for (let index = 2; await getRow(platform.db, "staff_members", id); index += 1) id = `${base}${String(index).padStart(2, "0")}`;
  }

  const staff = {
    ...(existing ?? { tenantId: settings.tenantId, branchId: settings.branchId, email: "", salesTotal: 0, inviteStatus: "accepted", active: true, createdAt: now() }),
    id,
    name,
    role: input.role,
    phone: input.phone?.trim() ?? String(existing?.phone ?? ""),
    pinEnabled: true,
    pinHash: input.pin ? await pinHash(platform, input.pin) : existing?.pinHash
  };
  await putRow(platform.db, "staff_members", id, staff);
  return staff as unknown as Staff;
}

async function activeOwnerCount(db: Db) {
  const row = await db.first<{ total: number }>(
    "SELECT COUNT(*) AS total FROM rows WHERE tbl = 'staff_members' AND json_extract(data, '$.role') = 'owner' AND json_extract(data, '$.active') = 1"
  );
  return Number(row?.total ?? 0);
}

export async function setStaffActive(platform: Platform, staffId: string, active: boolean) {
  await context(platform);
  const staff = await getRow<Staff & Record<string, unknown>>(platform.db, "staff_members", staffId);
  if (!staff) throw new Error("Staff member not found");
  if (!active && staff.role === "owner" && (await activeOwnerCount(platform.db)) <= 1) throw new Error("Keep at least one active owner");
  await putRow(platform.db, "staff_members", staffId, { ...staff, active });
}

export async function listStaff(platform: Platform) {
  const rows = await platform.db.all<{ data: string }>("SELECT data FROM rows WHERE tbl = 'staff_members'");
  return rows.map((row) => JSON.parse(row.data) as Staff & { phone?: string }).sort((left, right) => left.name.localeCompare(right.name));
}

// ----- business settings -------------------------------------------------------

export interface BusinessSettingsInput {
  businessName: string;
  vatPercent: number;
  serviceChargePercent: number;
  receiptFooter: string;
  paymentMethods: { cash: boolean; card: boolean; bankTransfer: boolean; mobileMoney: boolean };
}

export async function updateBusinessSettings(platform: Platform, input: BusinessSettingsInput) {
  const settings = await context(platform);
  if (input.businessName.trim().length < 2) throw new Error("Enter the business name");
  if (!Object.values(input.paymentMethods).some(Boolean)) throw new Error("Enable at least one payment method");
  if (!(input.vatPercent >= 0 && input.vatPercent <= 100) || !(input.serviceChargePercent >= 0 && input.serviceChargePercent <= 100)) {
    throw new Error("Percentages must be between 0 and 100");
  }
  const tenant = await getRow<{ settings: TenantSettings } & Record<string, unknown>>(platform.db, "tenants", settings.tenantId);
  if (!tenant) throw new Error("Business record missing");
  await platform.db.transaction(async () => {
    await putRow(platform.db, "tenants", settings.tenantId, {
      ...tenant,
      name: input.businessName.trim(),
      settings: {
        ...tenant.settings,
        businessName: input.businessName.trim(),
        defaultTaxRate: input.vatPercent / 100,
        serviceChargeEnabled: input.serviceChargePercent > 0,
        serviceChargeRate: input.serviceChargePercent / 100,
        receiptFooter: input.receiptFooter.trim(),
        paymentMethods: input.paymentMethods
      }
    });
    await saveSettings(platform, { ...settings, tenantName: input.businessName.trim() });
  });
}

// ----- backup -----------------------------------------------------------------

const backupFormat = "naijapos-tablet-backup";
const backupTables = ["kv", "rows", "shifts", "sales"] as const;

export async function exportBackup(platform: Platform) {
  const settings = await context(platform);
  const tables: Record<string, unknown[]> = {};
  for (const table of backupTables) tables[table] = await platform.db.all(`SELECT * FROM ${table}`);
  const exportedAt = now();
  await platform.db.run("INSERT INTO kv (key, value) VALUES ('backup.lastAt', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value", [exportedAt]);
  return {
    fileName: `ajokepos-${settings.tenantName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "") || "backup"}-${exportedAt.slice(0, 10)}.json`,
    content: JSON.stringify({ format: backupFormat, version: 1, exportedAt, tenantId: settings.tenantId, tables })
  };
}

/** Replaces everything on this tablet with the backup's contents. */
export async function restoreBackup(platform: Platform, content: string) {
  let backup: { format?: string; version?: number; tables?: Record<string, Record<string, unknown>[]> };
  try {
    backup = JSON.parse(content);
  } catch {
    throw new Error("This file is not an Ajoke POS backup");
  }
  if (backup.format !== backupFormat || backup.version !== 1 || !backup.tables) throw new Error("This file is not an Ajoke POS backup");
  const settingsRow = backup.tables.kv?.find((row) => row.key === "device.settings");
  if (!settingsRow || (JSON.parse(String(settingsRow.value)) as DeviceSettings).mode !== "standalone") {
    throw new Error("This backup is not from a standalone tablet");
  }

  await platform.db.transaction(async () => {
    for (const table of [...backupTables, "outbox", "id_map"]) await platform.db.run(`DELETE FROM ${table}`);
    for (const table of backupTables) {
      for (const row of backup.tables![table] ?? []) {
        const columns = Object.keys(row).filter((column) => /^[A-Za-z_]+$/.test(column));
        if (!columns.length) continue;
        await platform.db.run(
          `INSERT INTO ${table} (${columns.join(", ")}) VALUES (${columns.map(() => "?").join(", ")})`,
          columns.map((column) => (row[column] === undefined ? null : (row[column] as string | number | null)))
        );
      }
    }
  });
}

export async function lastBackupAt(platform: Platform) {
  return (await platform.db.first<{ value: string }>("SELECT value FROM kv WHERE key = 'backup.lastAt'"))?.value ?? null;
}

// ----- product archive / delete -----------------------------------------------

async function productHasSales(db: Db, productId: string) {
  const row = await db.first<{ id: string }>(
    "SELECT s.id FROM sales s, json_each(s.data, '$.summary.lines') line WHERE json_extract(line.value, '$.productId') = ? LIMIT 1",
    [productId]
  );
  return Boolean(row);
}

export async function setProductArchived(platform: Platform, productId: string, archived: boolean) {
  const settings = await context(platform);
  const product = await getRow<Product & Record<string, unknown>>(platform.db, "products", productId);
  if (!product) throw new Error("Product not found");
  await putRow(platform.db, "products", productId, { ...product, archived, updatedAt: now() }, settings.branchId);
}

/**
 * Deletes a product that was never sold. A product with sales is archived instead,
 * so receipts and reports keep their history. Returns what happened.
 */
export async function deleteProduct(platform: Platform, productId: string): Promise<"deleted" | "archived"> {
  await context(platform);
  if (await productHasSales(platform.db, productId)) {
    await setProductArchived(platform, productId, true);
    return "archived";
  }
  await platform.db.transaction(async () => {
    await platform.db.run("DELETE FROM rows WHERE tbl = 'stock_movements' AND json_extract(data, '$.productId') = ?", [productId]);
    await platform.db.run("DELETE FROM rows WHERE tbl = 'products' AND id = ?", [productId]);
  });
  return "deleted";
}

export interface StockMovementRow {
  id: string;
  type: string;
  quantityDelta: number;
  balanceAfter: number;
  reason: string;
  createdAt: string;
}

export async function stockHistory(platform: Platform, productId: string, limit = 50) {
  const rows = await platform.db.all<{ data: string }>(
    "SELECT data FROM rows WHERE tbl = 'stock_movements' AND json_extract(data, '$.productId') = ? ORDER BY json_extract(data, '$.createdAt') DESC, rowid DESC LIMIT ?",
    [productId, limit]
  );
  return rows.map((row) => JSON.parse(row.data) as StockMovementRow);
}

// ----- customers ----------------------------------------------------------------

export const customerGroups = ["Walk-in", "VIP", "Credit account", "Wholesale", "Staff"] as const;

export interface CustomerInput {
  id?: string;
  name: string;
  phone: string;
  email?: string;
  group?: string;
  notes?: string;
  /** 0 = no credit account. Leave undefined to keep the current limit. */
  creditLimit?: number;
}

export async function listCustomers(platform: Platform, search = "") {
  const term = `%${search.trim().toLowerCase()}%`;
  const rows = await platform.db.all<{ data: string }>(
    `SELECT data FROM rows WHERE tbl = 'customers'
     AND (lower(json_extract(data, '$.name')) LIKE ? OR json_extract(data, '$.phone') LIKE ?)
     ORDER BY lower(json_extract(data, '$.name'))`,
    [term, term]
  );
  return rows.map((row) => JSON.parse(row.data) as Customer);
}

export async function saveCustomer(platform: Platform, input: CustomerInput) {
  const settings = await context(platform);
  const name = input.name.trim();
  const phone = input.phone.replace(/\s+/g, "");
  if (name.length < 2) throw new Error("Enter the customer's name");
  if (phone.length < 7) throw new Error("Enter a valid phone number");
  const email = input.email?.trim() ?? "";
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error("Enter a valid email or leave it empty");
  if (input.creditLimit !== undefined && (!Number.isInteger(input.creditLimit) || input.creditLimit < 0)) throw new Error("Credit limit must be 0 or more");

  const existing = input.id ? await getRow<Customer & Record<string, unknown>>(platform.db, "customers", input.id) : null;
  const id = existing?.id ?? `cust-${platform.uuid()}`;
  const clash = await platform.db.first<{ id: string }>("SELECT id FROM rows WHERE tbl = 'customers' AND id <> ? AND json_extract(data, '$.phone') = ?", [id, phone]);
  if (clash) throw new Error("Another customer already has this phone number");

  const customer = {
    ...(existing ?? { tenantId: settings.tenantId, loyaltyPoints: 0, creditLimit: 0, outstandingBalance: 0, createdAt: now() }),
    id,
    name,
    phone,
    email: email || null,
    group: input.group && (customerGroups as readonly string[]).includes(input.group) ? input.group : existing?.group ?? "Walk-in",
    notes: input.notes?.trim() || null,
    creditLimit: input.creditLimit ?? existing?.creditLimit ?? 0
  };
  await putRow(platform.db, "customers", id, customer);
  return customer as unknown as Customer;
}

export async function customerSales(platform: Platform, customerId: string) {
  const row = await platform.db.first<{ count: number; total: number }>(
    "SELECT COUNT(*) AS count, COALESCE(SUM(total), 0) AS total FROM sales WHERE customerId = ? AND status <> 'voided'",
    [customerId]
  );
  return { count: Number(row?.count ?? 0), total: Number(row?.total ?? 0) };
}

/** Deletes a customer with no sales; customers with sales must be kept for the records. */
export async function deleteCustomer(platform: Platform, customerId: string) {
  await context(platform);
  const sold = await platform.db.first<{ id: string }>("SELECT id FROM sales WHERE customerId = ? LIMIT 1", [customerId]);
  if (sold) throw new Error("This customer has sales on record and cannot be deleted. Edit their details instead.");
  await platform.db.run("DELETE FROM rows WHERE tbl = 'customers' AND id = ?", [customerId]);
}

// ----- void sale ------------------------------------------------------------------

/**
 * Voids a sale made on this device: puts the stock back, reverses loyalty points and,
 * if the sale belongs to the open shift, takes its cash out of the expected drawer.
 */
export async function voidSale(platform: Platform, saleId: string, staffId: string, reason: string) {
  const settings = await context(platform);
  if (reason.trim().length < 3) throw new Error("Enter the reason for voiding");
  const sale = await platform.db.first<{ id: string; number: string; shiftId: string; customerId: string | null; data: string; total: number; status: string }>(
    "SELECT id, number, shiftId, customerId, data, total, status FROM sales WHERE id = ?",
    [saleId]
  );
  if (!sale) throw new Error("Sale not found");
  if (sale.status === "voided") throw new Error("This sale is already voided");

  const record = JSON.parse(sale.data) as {
    summary: { lines: { productId: string; name: string; quantity: number }[]; total: number };
    payments: { method: string; amount: number }[];
  } & Record<string, unknown>;
  const cash = record.payments.filter((payment) => payment.method === "cash").reduce((sum, payment) => sum + payment.amount, 0);

  await platform.db.transaction(async () => {
    for (const line of record.summary.lines) {
      const product = await getRow<Product & Record<string, unknown>>(platform.db, "products", line.productId);
      if (!product || product.category.trim().toLowerCase() === "services") continue;
      const stock = Number(product.stock) + line.quantity;
      await putRow(platform.db, "products", product.id, { ...product, stock, updatedAt: now() }, settings.branchId);
      await recordMovement(platform, settings, product, line.quantity, `Void ${sale.number}`, "return", stock, { reference: sale.number });
    }
    if (sale.customerId) {
      await platform.db.run(
        "UPDATE rows SET data = json_set(data, '$.loyaltyPoints', MAX(0, COALESCE(json_extract(data, '$.loyaltyPoints'), 0) - ?)) WHERE tbl = 'customers' AND id = ?",
        [Math.floor(Number(sale.total) / 100), sale.customerId]
      );
    }
    if (cash) await platform.db.run("UPDATE shifts SET cashSales = cashSales - ? WHERE id = ? AND status = 'open'", [cash, sale.shiftId]);
    const onAccount = record.payments.filter((payment) => payment.method === "customer_credit").reduce((sum, payment) => sum + payment.amount, 0);
    if (onAccount && sale.customerId) await reverseAccountCharge(platform, { customerId: sale.customerId, amount: onAccount, saleNumber: sale.number, staffId });
    const voided = { ...record, voided: { at: now(), by: staffId, reason: reason.trim() } };
    await platform.db.run("UPDATE sales SET status = 'voided', data = ? WHERE id = ?", [JSON.stringify(voided), saleId]);
  });
}
