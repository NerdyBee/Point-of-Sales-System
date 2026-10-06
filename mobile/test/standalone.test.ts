import { describe, expect, it } from "vitest";
import { verifyPin } from "../src/auth/pin";
import { readModel } from "../src/data/readModel";
import { createCustomer, currentShift, daySummary, openShift, pendingStockDeductions, recentSales, recordSale, requestCloseShift } from "../src/pos/actions";
import { calculateSale } from "../src/pos/pricing";
import { SyncEngine } from "../src/sync/engine";
import { loadSettings } from "../src/sync/settings";
import {
  adjustStock,
  createStandaloneBusiness,
  exportBackup,
  listStaff,
  restoreBackup,
  saveProduct,
  saveStaff,
  setStaffActive,
  updateBusinessSettings
} from "../src/standalone/business";
import { nodePlatform } from "./nodePlatform";

async function setUpShop() {
  const platform = await nodePlatform();
  const { owner } = await createStandaloneBusiness(platform, {
    businessName: "Mama Nkechi Provisions",
    currency: "NGN",
    vatPercent: 7.5,
    serviceChargePercent: 0,
    ownerName: "Nkechi Obi",
    ownerPin: "482913"
  });
  return { platform, owner, settings: (await loadSettings(platform))! };
}

describe("standalone tablet (no server)", () => {
  it("sets up a business that works with the normal screens and permissions", async () => {
    const { platform, owner, settings } = await setUpShop();
    expect(settings.mode).toBe("standalone");
    expect(settings.servers).toEqual({});

    const tenant = await readModel.tenant(platform.db, settings.tenantId);
    expect(tenant?.settings).toMatchObject({ businessName: "Mama Nkechi Provisions", defaultTaxRate: 0.075, serviceChargeEnabled: false });
    expect((await readModel.signInStaff(platform.db)).map((staff) => staff.name)).toEqual(["Nkechi Obi"]);
    expect(owner.id).toBe("MNP-MAI-NKE");

    const ownerPermissions = await readModel.permissionsForRole(platform.db, "owner");
    expect(ownerPermissions.has("settings.manage")).toBe(true);
    // The Reports tab is shown to roles with either of these.
    expect(ownerPermissions.has("inventory.adjust") && ownerPermissions.has("reports.profit.view")).toBe(true);
    expect((await readModel.permissionsForRole(platform.db, "manager")).has("inventory.adjust")).toBe(true);
    const cashierPermissions = await readModel.permissionsForRole(platform.db, "cashier");
    expect([...cashierPermissions].sort()).toEqual(["customer.manage", "register.manage", "sale.create"]);

    expect((await verifyPin(platform, owner.id, "000000")).ok).toBe(false);
    expect((await verifyPin(platform, owner.id, "482913")).ok).toBe(true);
    await expect(createStandaloneBusiness(platform, { businessName: "Again", currency: "NGN", vatPercent: 0, serviceChargePercent: 0, ownerName: "X Y", ownerPin: "482913" })).rejects.toThrow("already set up");
  });

  it("rejects weak PINs", async () => {
    const platform = await nodePlatform();
    await expect(createStandaloneBusiness(platform, { businessName: "Shop", currency: "NGN", vatPercent: 0, serviceChargePercent: 0, ownerName: "Ada", ownerPin: "111111" })).rejects.toThrow("harder to guess");
    await expect(createStandaloneBusiness(platform, { businessName: "Shop", currency: "NGN", vatPercent: 0, serviceChargePercent: 0, ownerName: "Ada", ownerPin: "12345" })).rejects.toThrow("6 digits");
  });

  it("sells, deducts stock directly, closes the register and never queues anything", async () => {
    const { platform, owner, settings } = await setUpShop();
    const rice = await saveProduct(platform, { name: "Rice 5kg", category: "Groceries", price: 9000, stock: 10 });
    const delivery = await saveProduct(platform, { name: "Delivery", category: "Services", price: 500 });
    await adjustStock(platform, rice.id, 5, "Supplier delivery");
    await expect(adjustStock(platform, rice.id, -100, "Count")).rejects.toThrow("below zero");
    await expect(saveProduct(platform, { name: "Clash", category: "Groceries", price: 1, sku: rice.sku })).rejects.toThrow("SKU or barcode");

    const tenant = (await readModel.tenant(platform.db, settings.tenantId))!;
    expect(tenant.settings.productCategories).toEqual(["General", "Groceries", "Services"]);

    await openShift(platform, owner, 2000);
    const customer = await createCustomer(platform, owner, { name: "Bayo", phone: "08031234567" });
    expect(customer.id.startsWith("cust-")).toBe(true);

    const cart = [
      { product: rice, quantity: 3, discount: 0 },
      { product: delivery, quantity: 1, discount: 0 }
    ];
    const total = calculateSale(cart, tenant.settings).total;
    expect(total).toBe(27000 + 2025 + 500 + 38); // VAT 7.5% on each line, no service charge
    const sale = await recordSale(platform, { settings, tenantSettings: tenant.settings, staff: owner, cart, customer, payments: [{ method: "cash", amount: total }] });

    const products = await readModel.products(platform.db, settings.branchId);
    expect(products.find((product) => product.id === rice.id)!.stock).toBe(12);
    expect(products.find((product) => product.id === delivery.id)!.stock).toBe(0);
    expect(await pendingStockDeductions(platform)).toEqual(new Map());
    expect((await readModel.customers(platform.db, "Bayo"))[0].loyaltyPoints).toBe(Math.floor(total / 100));
    expect((await recentSales(platform))[0]).toMatchObject({ id: sale.id, status: "saved" });
    expect(await daySummary(platform)).toEqual({ count: 1, total, items: 4, byMethod: { cash: total } });

    const engine = new SyncEngine(platform);
    const status = await engine.syncNow();
    expect(status.pending).toBe(0);
    expect(status.lastError).toBeUndefined();
    expect(await platform.db.first("SELECT * FROM outbox")).toBeNull();

    const closed = await requestCloseShift(platform, owner, 2000 + total);
    expect(closed).toEqual({ closed: true, expected: 2000 + total });
    expect(await currentShift(platform)).toBeNull();
  });

  it("manages staff and business settings", async () => {
    const { platform, owner, settings } = await setUpShop();
    const cashier = await saveStaff(platform, { name: "Musa Bello", role: "cashier", pin: "739204" });
    expect((await verifyPin(platform, cashier.id, "739204")).ok).toBe(true);
    await saveStaff(platform, { id: cashier.id, name: "Musa Bello", role: "cashier", pin: "640218" });
    expect((await verifyPin(platform, cashier.id, "739204")).ok).toBe(false);

    await setStaffActive(platform, cashier.id, false);
    expect((await readModel.signInStaff(platform.db)).map((staff) => staff.id)).toEqual([owner.id]);
    await expect(setStaffActive(platform, owner.id, false)).rejects.toThrow("at least one active owner");
    await expect(saveStaff(platform, { id: owner.id, name: owner.name, role: "cashier" })).rejects.toThrow("Keep at least one owner");
    expect(await listStaff(platform)).toHaveLength(2);

    await updateBusinessSettings(platform, {
      businessName: "Nkechi Stores",
      vatPercent: 0,
      serviceChargePercent: 5,
      receiptFooter: "See you again",
      paymentMethods: { cash: true, card: false, bankTransfer: true, mobileMoney: false }
    });
    const tenant = await readModel.tenant(platform.db, settings.tenantId);
    expect(tenant?.settings).toMatchObject({ businessName: "Nkechi Stores", defaultTaxRate: 0, serviceChargeEnabled: true, serviceChargeRate: 0.05 });
    expect((await loadSettings(platform))?.tenantName).toBe("Nkechi Stores");
  });

  it("restores a backup onto a new tablet", async () => {
    const { platform, owner, settings } = await setUpShop();
    const product = await saveProduct(platform, { name: "Sugar", category: "Groceries", price: 1200, stock: 4 });
    const tenant = (await readModel.tenant(platform.db, settings.tenantId))!;
    await openShift(platform, owner, 0);
    const cart = [{ product, quantity: 1, discount: 0 }];
    await recordSale(platform, { settings, tenantSettings: tenant.settings, staff: owner, cart, payments: [{ method: "cash", amount: calculateSale(cart, tenant.settings).total }] });

    const backup = await exportBackup(platform);
    expect(backup.fileName).toMatch(/^naijapos-mama-nkechi-provisions-\d{4}-\d{2}-\d{2}\.json$/);

    const replacement = await nodePlatform();
    await expect(restoreBackup(replacement, "{}")).rejects.toThrow("not a NaijaPOS backup");
    await restoreBackup(replacement, backup.content);
    expect((await loadSettings(replacement))?.tenantId).toBe(settings.tenantId);
    expect((await readModel.products(replacement.db, settings.branchId))[0].stock).toBe(3);
    expect(await recentSales(replacement)).toHaveLength(1);
    expect((await currentShift(replacement))?.status).toBe("open");
    expect((await verifyPin(replacement, owner.id, "482913")).ok).toBe(true);
  });
});
