import { describe, expect, it } from "vitest";
import { demoProducts, registerShifts, staffMembers } from "../../shared/data/demoStore";
import { executeDeviceCommand, memoryIdMap, type CommandContext } from "./sync.commands";
import { deviceEntities, entitiesFlowing, entityForTable, syncEntities, trackedColumns } from "./sync.entities";
import { blockedFields, counterDeltas, incomingFieldTimes, mergeItems, orderForApply, pendingChanges } from "./sync.merge";
import { backfillStatement, triggerStatements } from "./sync.triggers";
import type { WireChange, WireItem } from "./sync.wire";

const change = (seq: number, op: WireChange["op"], changedAt: string, extra: Partial<WireChange> = {}): WireChange => ({
  seq,
  op,
  fields: null,
  deltas: null,
  changedAt,
  ...extra
});

describe("sync entity registry", () => {
  it("ranks every parent ahead of its children", () => {
    const rank = (table: string) => entityForTable(table)!.rank;
    const relations: [string, string][] = [
      ["tenants", "branches"],
      ["branches", "terminals"],
      ["branches", "products"],
      ["access_roles", "access_role_permissions"],
      ["access_permissions", "access_role_permissions"],
      ["register_shifts", "completed_sales"],
      ["customers", "completed_sales"],
      ["completed_sales", "payment_records"],
      ["register_shifts", "cash_movements"],
      ["products", "stock_movements"],
      ["suppliers", "purchase_orders"],
      ["purchase_orders", "supplier_invoices"],
      ["supplier_invoices", "supplier_returns"],
      ["customers", "customer_ledger_entries"],
      ["restaurant_tables", "table_reservations"]
    ];
    for (const [parent, child] of relations) expect(rank(parent), `${parent} -> ${child}`).toBeLessThan(rank(child));
  });

  it("keeps subscriptions cloud-authored and audit history upward-only", () => {
    const fromOffice = entitiesFlowing("office").map((entity) => entity.table);
    const fromCloud = entitiesFlowing("cloud").map((entity) => entity.table);
    expect(fromOffice).not.toContain("tenant_subscriptions");
    expect(fromOffice).toContain("audit_events");
    expect(fromCloud).toContain("tenant_subscriptions");
    expect(fromCloud).not.toContain("audit_events");
  });

  it("never ships password hashes to devices", () => {
    const staff = deviceEntities().find((entity) => entity.table === "staff_members")!;
    expect(staff.deviceOmit).toContain("passwordHash");
    expect(deviceEntities().map((entity) => entity.table)).not.toContain("auth_sessions");
  });

  it("tracks counters as deltas instead of fields", () => {
    const products = entityForTable("products")!;
    expect(trackedColumns(products)).toContain("price");
    expect(trackedColumns(products)).not.toContain("stock");
    expect(trackedColumns(products)).not.toContain("updatedAt");
  });

  it("generates triggers for every replicated table, quoting reserved column names", () => {
    for (const entity of syncEntities) {
      const sql = triggerStatements(entity).map((statement) => statement.sql).join("\n");
      expect(sql).toContain(`'${entity.table}'`);
      expect(backfillStatement(entity)).toContain("NOT EXISTS");
    }
    expect(triggerStatements(entityForTable("customers")!).map((statement) => statement.sql).join()).toContain("OLD.`group` <=> NEW.`group`");
  });
});

describe("sync merge rules", () => {
  it("applies parents first and deletes children first", () => {
    const item = (table: string, deleted = false): WireItem => ({ table, rowId: table, row: deleted ? null : {}, changes: [] });
    const ordered = orderForApply(
      [item("payment_records"), item("completed_sales"), item("branches", true), item("products", true), item("tenants")],
      (table) => entityForTable(table)!.rank
    );
    expect(ordered.map((entry) => entry.table)).toEqual(["tenants", "completed_sales", "payment_records", "products", "branches"]);
  });

  it("only applies changes newer than what was already applied", () => {
    const changes = [change(4, "I", "2026-01-01T00:00:00Z"), change(9, "U", "2026-01-01T00:01:00Z")];
    expect(pendingChanges(changes, 4).map((entry) => entry.seq)).toEqual([9]);
    expect(pendingChanges(changes, 9)).toEqual([]);
  });

  it("sums counter deltas and ignores a duplicate insert of an existing row", () => {
    const products = entityForTable("products")!;
    const changes = [
      change(1, "I", "2026-01-01T00:00:00Z", { deltas: { stock: 40 } }),
      change(2, "U", "2026-01-01T00:01:00Z", { fields: [], deltas: { stock: -2 } }),
      change(3, "U", "2026-01-01T00:02:00Z", { fields: ["price"], deltas: { stock: -3 } })
    ];
    expect(counterDeltas(products, changes, false)).toEqual({ stock: 35 });
    expect(counterDeltas(products, changes, true)).toEqual({ stock: -5 });
  });

  it("keeps a local column when the local write is newer (field-level last writer wins)", () => {
    const tracked = ["name", "price", "category"];
    const incoming = incomingFieldTimes(
      [change(5, "U", "2026-03-01T10:00:00Z", { fields: ["name"] }), change(6, "U", "2026-03-01T10:05:00Z", { fields: ["price"] })],
      tracked
    );
    const blocked = blockedFields(incoming, [{ op: "U", fields: "price", changedAt: "2026-03-01T10:07:00Z" }, { op: "U", fields: "name", changedAt: "2026-03-01T09:00:00Z" }], tracked);
    expect([...blocked]).toEqual(["price"]);
  });

  it("merges a parked conflict with a newer delivery of the same row", () => {
    const older: WireItem = { table: "products", rowId: "p1", row: { name: "old" }, changes: [change(2, "I", "2026-01-01T00:00:00Z")] };
    const newer: WireItem = { table: "products", rowId: "p1", row: { name: "new" }, changes: [change(2, "I", "2026-01-01T00:00:00Z"), change(7, "U", "2026-01-02T00:00:00Z")] };
    const merged = mergeItems(older, newer);
    expect(merged.row).toEqual({ name: "new" });
    expect(merged.changes.map((entry) => entry.seq)).toEqual([2, 7]);
  });
});

describe("device command replay", () => {
  const tenantId = "tenant-lagos-foods";
  const branchId = "branch-lagos-main";
  const terminalId = "terminal-web-1";
  const cashier = staffMembers.find((member) => member.tenantId === tenantId && member.role === "owner" && member.active)!;

  function context(): CommandContext {
    return { tenantId, branchId, terminalId, nodeId: "device-test", idMap: memoryIdMap() };
  }

  it("maps an offline-opened shift onto the server shift and replays an offline sale at the price charged", async () => {
    const ctx = context();
    const open = await executeDeviceCommand(ctx, {
      id: "cmd-open-0001",
      type: "register.open",
      staffId: cashier.id,
      createdAt: new Date().toISOString(),
      payload: { localShiftId: "local-shift-1", openingBalance: 5000 }
    });
    expect(open.status).toBe("synced");
    const serverShiftId = await ctx.idMap.get("local-shift-1");
    expect(serverShiftId).toBe(registerShifts.find((shift) => shift.terminalId === terminalId && shift.status === "open")!.id);

    const product = demoProducts.find((item) => item.tenantId === tenantId && item.branchId === branchId && item.category.toLowerCase() !== "services")!;
    const quantity = product.stock + 5; // more than the server has: the sale still happened at the counter
    const chargedUnitPrice = product.price - 100; // device had a stale price
    const stockBefore = product.stock;

    const probe = await executeDeviceCommand(ctx, {
      id: "cmd-sale-probe",
      type: "sale.create",
      staffId: cashier.id,
      createdAt: new Date().toISOString(),
      payload: {
        localSaleId: "local-sale-probe",
        idempotencyKey: "device-test-probe-0001",
        lines: [{ productId: product.id, quantity, unitPrice: chargedUnitPrice }],
        payments: [{ method: "cash", amount: 1 }]
      }
    });
    expect(probe.status).toBe("conflict");
    expect(product.stock).toBe(stockBefore);

    // Work out what the device would have computed with the same tax rules.
    const { previewSaleTotal } = await import("../sales/sales.service");
    const { demoTenants } = await import("../../shared/data/demoStore");
    const settings = demoTenants.find((tenant) => tenant.id === tenantId)!.settings;
    const total = previewSaleTotal(
      tenantId,
      { branchId, terminalId, idempotencyKey: "x".repeat(12), lines: [{ productId: product.id, quantity, discount: 0 }], payments: [{ method: "cash", amount: 0 }] },
      { vatRate: settings.defaultTaxRate, serviceChargeEnabled: settings.serviceChargeEnabled, serviceChargeRate: settings.serviceChargeRate },
      [{ ...product, price: chargedUnitPrice }]
    ).total;

    const sale = await executeDeviceCommand(ctx, {
      id: "cmd-sale-0001",
      type: "sale.create",
      staffId: cashier.id,
      createdAt: new Date().toISOString(),
      payload: {
        localSaleId: "local-sale-1",
        idempotencyKey: "device-test-sale-0001",
        lines: [{ productId: product.id, quantity, unitPrice: chargedUnitPrice }],
        payments: [{ method: "cash", amount: total }]
      }
    });
    expect(sale.status).toBe("synced");
    expect(sale.idMap?.["local-sale-1"]).toMatch(/^INV-/);
    expect(product.stock).toBe(stockBefore - quantity);
  });

  it("rejects commands from staff without the needed permission", async () => {
    const result = await executeDeviceCommand(context(), {
      id: "cmd-unknown-staff",
      type: "sale.create",
      staffId: "NOBODY",
      createdAt: new Date().toISOString(),
      payload: {}
    });
    expect(result).toMatchObject({ status: "conflict", error: "Staff member is inactive or unknown" });
  });
});
