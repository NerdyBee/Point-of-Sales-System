import { Prisma } from "@prisma/client";

/**
 * Replication registry: every table that moves between servers (office <-> cloud)
 * or down to devices (tablets). See SYNC_ARCHITECTURE.md for the full model.
 *
 * - rank: foreign-key depth. Parents always have a lower rank than children, so a
 *   batch applied in rank order never inserts a child before its parent.
 * - scope: how the trigger fills sync_changes.branchId/branchId2. Tenant-wide rows
 *   (null branch) reach every node of the tenant; branch rows only reach nodes whose
 *   branch scope covers them.
 * - counters: numeric columns that several nodes increment/decrement concurrently.
 *   Triggers record (NEW - OLD) and peers add the delta instead of overwriting.
 * - direction: "both" | "down" (cloud -> office only) | "up" (office -> cloud only).
 * - device: shipped to tablets as a read model.
 */

export type SyncDirection = "both" | "down" | "up";

type ScopeSql = { tenant: string; branch?: string; branch2?: string };

export interface SyncEntity {
  model: string;
  table: string;
  delegate: string;
  pk: string[];
  rank: number;
  scope: ScopeSql;
  counters?: string[];
  direction: SyncDirection;
  device?: boolean;
  /** Columns never sent to devices. */
  deviceOmit?: string[];
}

const row = (column: string) => `ROW.${column}`;

export const syncEntities: SyncEntity[] = [
  { model: "Tenant", table: "tenants", delegate: "tenant", pk: ["id"], rank: 0, scope: { tenant: row("id") }, direction: "both", device: true },
  { model: "Branch", table: "branches", delegate: "branch", pk: ["id"], rank: 1, scope: { tenant: row("tenantId") }, direction: "both", device: true },
  { model: "TenantSubscription", table: "tenant_subscriptions", delegate: "tenantSubscription", pk: ["id"], rank: 1, scope: { tenant: row("tenantId") }, direction: "down" },
  { model: "SubscriptionInvoice", table: "subscription_invoices", delegate: "subscriptionInvoice", pk: ["id"], rank: 1, scope: { tenant: row("tenantId") }, direction: "down" },
  { model: "Terminal", table: "terminals", delegate: "terminal", pk: ["id"], rank: 2, scope: { tenant: row("tenantId"), branch: row("branchId") }, direction: "both", device: true },
  { model: "AccessRole", table: "access_roles", delegate: "accessRole", pk: ["id"], rank: 2, scope: { tenant: row("tenantId") }, direction: "both", device: true },
  { model: "AccessPermission", table: "access_permissions", delegate: "accessPermission", pk: ["id"], rank: 2, scope: { tenant: row("tenantId") }, direction: "both", device: true },
  {
    model: "AccessRolePermission",
    table: "access_role_permissions",
    delegate: "accessRolePermission",
    pk: ["roleId", "permissionId"],
    rank: 3,
    scope: { tenant: "(SELECT r.tenantId FROM access_roles r WHERE r.id = ROW.roleId)" },
    direction: "both",
    device: true
  },
  // Staff are tenant-wide so owners/managers can sign in at any branch's tablet.
  {
    model: "StaffMember",
    table: "staff_members",
    delegate: "staffMember",
    pk: ["id"],
    rank: 2,
    scope: { tenant: row("tenantId") },
    counters: ["salesTotal"],
    direction: "both",
    device: true,
    deviceOmit: ["passwordHash"]
  },
  {
    model: "Customer",
    table: "customers",
    delegate: "customer",
    pk: ["id"],
    rank: 2,
    scope: { tenant: row("tenantId") },
    counters: ["outstandingBalance", "loyaltyPoints"],
    direction: "both",
    device: true
  },
  {
    model: "Product",
    table: "products",
    delegate: "product",
    pk: ["id"],
    rank: 2,
    scope: { tenant: row("tenantId"), branch: row("branchId") },
    counters: ["stock"],
    direction: "both",
    device: true
  },
  { model: "Supplier", table: "suppliers", delegate: "supplier", pk: ["id"], rank: 2, scope: { tenant: row("tenantId"), branch: row("branchId") }, direction: "both" },
  {
    model: "SupplierProduct",
    table: "supplier_products",
    delegate: "supplierProduct",
    pk: ["supplierId", "productId"],
    rank: 3,
    scope: {
      tenant: "(SELECT s.tenantId FROM suppliers s WHERE s.id = ROW.supplierId)",
      branch: "(SELECT s.branchId FROM suppliers s WHERE s.id = ROW.supplierId)"
    },
    direction: "both"
  },
  { model: "RegisterShift", table: "register_shifts", delegate: "registerShift", pk: ["id"], rank: 2, scope: { tenant: row("tenantId"), branch: row("branchId") }, counters: ["expectedCash"], direction: "both", device: true },
  { model: "ApprovalRequest", table: "approval_requests", delegate: "approvalRequest", pk: ["id"], rank: 2, scope: { tenant: row("tenantId"), branch: row("branchId") }, direction: "both" },
  { model: "Expense", table: "expenses", delegate: "expense", pk: ["id"], rank: 2, scope: { tenant: row("tenantId"), branch: row("branchId") }, direction: "both" },
  { model: "RestaurantTable", table: "restaurant_tables", delegate: "restaurantTable", pk: ["id"], rank: 2, scope: { tenant: row("tenantId"), branch: row("branchId") }, direction: "both", device: true },
  { model: "PrepTicket", table: "prep_tickets", delegate: "prepTicket", pk: ["id"], rank: 2, scope: { tenant: row("tenantId"), branch: row("branchId") }, direction: "both" },
  // Audit history flows up to the cloud for central review but is never pulled down.
  { model: "AuditEvent", table: "audit_events", delegate: "auditEvent", pk: ["id"], rank: 2, scope: { tenant: row("tenantId"), branch: row("branchId") }, direction: "up" },
  { model: "PurchaseOrder", table: "purchase_orders", delegate: "purchaseOrder", pk: ["id"], rank: 3, scope: { tenant: row("tenantId"), branch: row("branchId") }, direction: "both" },
  { model: "StockMovement", table: "stock_movements", delegate: "stockMovement", pk: ["id"], rank: 3, scope: { tenant: row("tenantId"), branch: row("branchId") }, direction: "both" },
  {
    model: "InventoryTransfer",
    table: "inventory_transfers",
    delegate: "inventoryTransfer",
    pk: ["id"],
    rank: 3,
    scope: { tenant: row("tenantId"), branch: row("sourceBranchId"), branch2: row("destinationBranchId") },
    direction: "both"
  },
  { model: "CompletedSale", table: "completed_sales", delegate: "completedSale", pk: ["id"], rank: 3, scope: { tenant: row("tenantId"), branch: row("branchId") }, direction: "both", device: true },
  { model: "CashMovement", table: "cash_movements", delegate: "cashMovement", pk: ["id"], rank: 3, scope: { tenant: row("tenantId"), branch: row("branchId") }, direction: "both" },
  // Ledger entries are tenant-wide because customers are tenant-wide.
  { model: "CustomerLedgerEntry", table: "customer_ledger_entries", delegate: "customerLedgerEntry", pk: ["id"], rank: 3, scope: { tenant: row("tenantId") }, direction: "both" },
  { model: "TableOrder", table: "table_orders", delegate: "tableOrder", pk: ["id"], rank: 3, scope: { tenant: row("tenantId"), branch: row("branchId") }, direction: "both", device: true },
  { model: "TableReservation", table: "table_reservations", delegate: "tableReservation", pk: ["id"], rank: 3, scope: { tenant: row("tenantId"), branch: row("branchId") }, direction: "both" },
  { model: "SupplierInvoice", table: "supplier_invoices", delegate: "supplierInvoice", pk: ["id"], rank: 4, scope: { tenant: row("tenantId"), branch: row("branchId") }, direction: "both" },
  { model: "PaymentRecord", table: "payment_records", delegate: "paymentRecord", pk: ["id"], rank: 4, scope: { tenant: row("tenantId"), branch: row("branchId") }, direction: "both" },
  { model: "SupplierReturn", table: "supplier_returns", delegate: "supplierReturn", pk: ["id"], rank: 5, scope: { tenant: row("tenantId"), branch: row("branchId") }, direction: "both" }
];

/** Tables that are deliberately node-local and never replicated. */
export const localOnlyTables = [
  "auth_sessions",
  "sync_queue_records",
  "sync_identity",
  "sync_changes",
  "sync_nodes",
  "sync_peers",
  "sync_row_state",
  "sync_id_map",
  "sync_conflicts"
];

const byTable = new Map(syncEntities.map((entity) => [entity.table, entity]));

export function entityForTable(table: string) {
  return byTable.get(table);
}

export type ColumnType = "String" | "Int" | "BigInt" | "Float" | "Decimal" | "Boolean" | "DateTime" | "Json" | "Bytes";
export interface EntityColumn {
  name: string;
  type: ColumnType;
}

const columnCache = new Map<string, EntityColumn[]>();

/** Scalar columns of a model, read from the generated Prisma client. */
export function entityColumns(entity: SyncEntity): EntityColumn[] {
  const cached = columnCache.get(entity.model);
  if (cached) return cached;

  const model = Prisma.dmmf.datamodel.models.find((item) => item.name === entity.model);
  if (!model) throw new Error(`Unknown Prisma model ${entity.model}`);
  const columns = model.fields
    .filter((field) => field.kind === "scalar" || field.kind === "enum")
    .map((field) => ({ name: field.name, type: field.type as ColumnType }));
  columnCache.set(entity.model, columns);
  return columns;
}

/** Columns whose changes are tracked field-by-field (not pk, not counters, not @updatedAt). */
export function trackedColumns(entity: SyncEntity) {
  const skip = new Set([...entity.pk, ...(entity.counters ?? []), "updatedAt"]);
  return entityColumns(entity).map((column) => column.name).filter((name) => !skip.has(name));
}

export function rowIdOf(entity: SyncEntity, record: Record<string, unknown>) {
  return entity.pk.map((column) => String(record[column])).join("|");
}

export function whereForRowId(entity: SyncEntity, rowId: string) {
  const parts = rowId.split("|");
  if (entity.pk.length === 1) return { [entity.pk[0]]: parts[0] };
  const compound = Object.fromEntries(entity.pk.map((column, index) => [column, parts[index]]));
  return { [entity.pk.join("_")]: compound };
}

/** Entities this node may send to / accept from a peer, by role of the sender. */
export function entitiesFlowing(from: "cloud" | "office") {
  return syncEntities.filter((entity) => entity.direction === "both" || (from === "cloud" ? entity.direction === "down" : entity.direction === "up"));
}

export function deviceEntities() {
  return syncEntities.filter((entity) => entity.device);
}
