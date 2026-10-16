import { describe, expect, it } from "vitest";
import { readModel } from "../src/data/readModel";
import { openShift, recordSale } from "../src/pos/actions";
import { calculateSale, type CartLine } from "../src/pos/pricing";
import { buildReceiptText, receiptFromSale } from "../src/print/receipt";
import { cashierCanDiscount, createStandaloneBusiness, ensureStandaloneUpgrades, saveProduct, saveStaff, setCashierDiscounts } from "../src/standalone/business";
import { loadSettings } from "../src/sync/settings";
import { nodePlatform } from "./nodePlatform";

async function shop() {
  const platform = await nodePlatform();
  const { owner } = await createStandaloneBusiness(platform, { businessName: "Price Shop", currency: "NGN", vatPercent: 0, serviceChargePercent: 0, ownerName: "Femi Ade", ownerPin: "602731" });
  const manager = await saveStaff(platform, { name: "Ngozi Manager", role: "manager", pin: "739104" });
  const cashier = await saveStaff(platform, { name: "Bisi Cashier", role: "cashier", pin: "582014" });
  const settings = (await loadSettings(platform))!;
  const tenant = (await readModel.tenant(platform.db, settings.tenantId))!;
  const rice = await saveProduct(platform, { name: "Rice 5kg", category: "Groceries", price: 10000, stock: 20 });
  await openShift(platform, owner, 0);
  const sell = (staff: typeof owner, cart: CartLine[]) =>
    recordSale(platform, { settings, tenantSettings: tenant.settings, staff, cart, payments: [{ method: "cash", amount: calculateSale(cart, tenant.settings).total }] });
  return { platform, owner, manager, cashier, rice, sell, tenant };
}

describe("discounts (edited prices)", () => {
  it("owners and managers can sell below the set price; the receipt shows the discount", async () => {
    const { owner, manager, rice, sell, tenant } = await shop();
    // Price edited from 10,000 to 9,000 for 2 bags.
    const sale = await sell(manager, [{ product: rice, quantity: 2, discount: 1000 }]);
    expect(sale.summary).toMatchObject({ subtotal: 20000, discount: 2000, total: 18000 });
    const text = buildReceiptText(receiptFromSale({ number: sale.number, createdAt: sale.createdAt }, sale.record, tenant.settings));
    expect(text).toContain("Discount: -N2,000");
    expect(text).toContain("TOTAL: N18,000");
    await sell(owner, [{ product: rice, quantity: 1, discount: 500 }]);
  });

  it("cashiers need the owner's permission, which can be switched on and off", async () => {
    const { platform, cashier, rice, sell } = await shop();
    expect(await cashierCanDiscount(platform)).toBe(false);
    await expect(sell(cashier, [{ product: rice, quantity: 1, discount: 1000 }])).rejects.toThrow("not allowed to give discounts");
    await sell(cashier, [{ product: rice, quantity: 1, discount: 0 }]);

    await setCashierDiscounts(platform, true);
    expect(await cashierCanDiscount(platform)).toBe(true);
    expect((await readModel.permissionsForRole(platform.db, "cashier")).has("sale.discount")).toBe(true);
    await sell(cashier, [{ product: rice, quantity: 1, discount: 1000 }]);

    await setCashierDiscounts(platform, false);
    await expect(sell(cashier, [{ product: rice, quantity: 1, discount: 1000 }])).rejects.toThrow("not allowed to give discounts");
    // Updates never give it back to cashiers.
    await ensureStandaloneUpgrades(platform);
    expect(await cashierCanDiscount(platform)).toBe(false);
  });

  it("never prices above the set price or below zero", async () => {
    const { owner, rice, sell } = await shop();
    await expect(sell(owner, [{ product: rice, quantity: 1, discount: 10001 }])).rejects.toThrow("not valid");
    await expect(sell(owner, [{ product: rice, quantity: 1, discount: -500 }])).rejects.toThrow("not valid");
    const free = await sell(owner, [{ product: rice, quantity: 1, discount: 10000 }]);
    expect(free.summary.total).toBe(0);
  });

  it("gives existing phones' owners and managers the new permission on update", async () => {
    const { platform, tenant } = await shop();
    // Simulate a phone set up before discounts existed.
    await platform.db.run("DELETE FROM rows WHERE tbl = 'access_role_permissions' AND id LIKE ?", [`%sale.discount`]);
    await platform.db.run("DELETE FROM rows WHERE tbl = 'access_permissions' AND id LIKE ?", [`%sale.discount`]);
    expect((await readModel.permissionsForRole(platform.db, "manager")).has("sale.discount")).toBe(false);
    await ensureStandaloneUpgrades(platform);
    expect((await readModel.permissionsForRole(platform.db, "owner")).has("sale.discount")).toBe(true);
    expect((await readModel.permissionsForRole(platform.db, "manager")).has("sale.discount")).toBe(true);
    expect((await readModel.permissionsForRole(platform.db, "cashier")).has("sale.discount")).toBe(false);
    expect(tenant).toBeTruthy();
  });
});
