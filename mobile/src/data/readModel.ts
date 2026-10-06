import type { Db } from "./db";

/** Typed views over the server tables mirrored into `rows`. Field names match the server. */

export interface TenantSettings {
  businessName: string;
  taxId?: string;
  currency: "NGN" | "USD" | "GHS" | "KES" | "ZAR";
  defaultTaxRate?: number;
  serviceChargeEnabled?: boolean;
  serviceChargeRate?: number;
  receiptFooter?: string;
  /** Shown on receipts. */
  phone?: string;
  address?: string;
  /** Print the saved logo on receipts (default true when a logo exists). */
  printLogo?: boolean;
  productCategories?: string[];
  paymentMethods?: { cash?: boolean; card?: boolean; bankTransfer?: boolean; mobileMoney?: boolean };
}

export interface Tenant {
  id: string;
  name: string;
  settings: TenantSettings;
}

export interface Product {
  id: string;
  branchId: string;
  name: string;
  sku: string;
  barcode: string;
  category: string;
  price: number;
  taxRate: number;
  image: string;
  stock: number;
  station: string;
  cost?: number;
  reorderPoint?: number;
  /** Standalone only: hidden from selling but kept for sales history. */
  archived?: boolean;
}

export interface Staff {
  id: string;
  branchId: string;
  name: string;
  role: string;
  pinHash?: string | null;
  pinEnabled: boolean;
  active: boolean;
  inviteStatus: string;
}

export interface Customer {
  id: string;
  name: string;
  phone: string;
  email?: string | null;
  notes?: string | null;
  group: string;
  loyaltyPoints: number;
  creditLimit: number;
  outstandingBalance: number;
}

export interface ServerShift {
  id: string;
  terminalId: string;
  cashierId: string;
  status: string;
  openingBalance: number;
  expectedCash: number;
  openedAt: string;
}

export interface Terminal {
  id: string;
  branchId: string;
  name: string;
  status: string;
}

async function rowsOf<T>(db: Db, table: string, where = "", params: (string | number)[] = []) {
  const rows = await db.all<{ data: string }>(`SELECT data FROM rows WHERE tbl = ? ${where}`, [table, ...params]);
  return rows.map((row) => JSON.parse(row.data) as T);
}

async function rowOf<T>(db: Db, table: string, id: string) {
  const row = await db.first<{ data: string }>("SELECT data FROM rows WHERE tbl = ? AND id = ?", [table, id]);
  return row ? (JSON.parse(row.data) as T) : null;
}

export const readModel = {
  tenant: (db: Db, tenantId: string) => rowOf<Tenant>(db, "tenants", tenantId),
  terminal: (db: Db, terminalId: string) => rowOf<Terminal>(db, "terminals", terminalId),
  staff: (db: Db, staffId: string) => rowOf<Staff>(db, "staff_members", staffId),
  customer: (db: Db, customerId: string) => rowOf<Customer>(db, "customers", customerId),

  /** Products on sale at a branch. Archived products (standalone mode) are hidden unless asked for. */
  async products(db: Db, branchId: string, options: { includeArchived?: boolean } = {}) {
    const products = await rowsOf<Product>(db, "products", "AND branchId = ?", [branchId]);
    return products
      .filter((product) => options.includeArchived || !product.archived)
      .map((product) => ({ ...product, price: Number(product.price), taxRate: Number(product.taxRate), stock: Number(product.stock) }));
  },

  async signInStaff(db: Db) {
    const staff = await rowsOf<Staff>(db, "staff_members");
    return staff
      .filter((member) => member.active && member.pinEnabled && member.inviteStatus === "accepted" && member.pinHash)
      .sort((left, right) => left.name.localeCompare(right.name));
  },

  async customers(db: Db, search: string) {
    const term = `%${search.trim().toLowerCase()}%`;
    return rowsOf<Customer>(db, "customers", "AND (lower(json_extract(data, '$.name')) LIKE ? OR json_extract(data, '$.phone') LIKE ?) ORDER BY json_extract(data, '$.name') LIMIT 30", [term, term]);
  },

  async openServerShift(db: Db, terminalId: string) {
    const shifts = await rowsOf<ServerShift>(db, "register_shifts", "AND json_extract(data, '$.terminalId') = ? AND json_extract(data, '$.status') = 'open'", [terminalId]);
    return shifts[0] ?? null;
  },

  serverShift: (db: Db, shiftId: string) => rowOf<ServerShift>(db, "register_shifts", shiftId),

  /** Permission actions granted to a role name, from the synced role tables. */
  async permissionsForRole(db: Db, roleName: string) {
    const rows = await db.all<{ action: string }>(
      `SELECT json_extract(p.data, '$.action') AS action
       FROM rows r
       JOIN rows rp ON rp.tbl = 'access_role_permissions' AND json_extract(rp.data, '$.roleId') = r.id
       JOIN rows p ON p.tbl = 'access_permissions' AND p.id = json_extract(rp.data, '$.permissionId')
       WHERE r.tbl = 'access_roles' AND json_extract(r.data, '$.name') = ?`,
      [roleName]
    );
    return new Set(rows.map((row) => row.action));
  }
};
