import { describe, expect, it } from "vitest";
import { readModel } from "../src/data/readModel";
import { currentShift, expectedCash, openShift, recordSale, requestCloseShift } from "../src/pos/actions";
import { calculateSale } from "../src/pos/pricing";
import { createStandaloneBusiness, ensureStandaloneUpgrades, saveProduct, saveStaff } from "../src/standalone/business";
import { expenseTotals, listExpenses, recordExpense, voidExpense } from "../src/standalone/expenses";
import { periodRange } from "../src/standalone/inventory";
import { loadSettings } from "../src/sync/settings";
import { nodePlatform } from "./nodePlatform";

async function shop() {
  const platform = await nodePlatform();
  const { owner } = await createStandaloneBusiness(platform, { businessName: "Spend Shop", currency: "NGN", vatPercent: 0, serviceChargePercent: 0, ownerName: "Femi Ade", ownerPin: "602731" });
  const settings = (await loadSettings(platform))!;
  const tenant = (await readModel.tenant(platform.db, settings.tenantId))!;
  const rice = await saveProduct(platform, { name: "Rice", category: "Groceries", price: 10000, stock: 10 });
  return { platform, owner, settings, tenant, rice };
}

describe("expenses", () => {
  it("takes cash paid from the drawer off the register's expected cash", async () => {
    const { platform, owner, settings, tenant, rice } = await shop();
    await openShift(platform, owner, 5000);
    const cart = [{ product: rice, quantity: 2, discount: 0 }];
    await recordSale(platform, { settings, tenantSettings: tenant.settings, staff: owner, cart, payments: [{ method: "cash", amount: calculateSale(cart, tenant.settings).total }] });

    const fuel = await recordExpense(platform, { amount: 3000, category: "Utilities", description: "Fuel for generator", vendor: "Total", paymentMethod: "cash", staffId: owner.id });
    expect(fuel).toMatchObject({ number: "EXP-00001", fromDrawer: true, status: "paid" });
    // From the owner's pocket: recorded, drawer untouched.
    await recordExpense(platform, { amount: 1500, category: "Transport", description: "Bike to market", paymentMethod: "cash", fromDrawer: false, staffId: owner.id });
    // By transfer, with a reference.
    const rent = await recordExpense(platform, { amount: 50000, category: "Rent", description: "Shop rent October", paymentMethod: "bank_transfer", reference: "TRF-7781", staffId: owner.id });
    expect(rent).toMatchObject({ fromDrawer: false, reference: "TRF-7781", number: "EXP-00003" });

    const shift = (await currentShift(platform))!;
    expect(shift.cashOut).toBe(3000);
    expect(expectedCash(shift)).toBe(5000 + 20000 - 3000);

    const closed = await requestCloseShift(platform, owner, 22000);
    expect(closed.expected).toBe(22000);

    const totals = expenseTotals(await listExpenses(platform, periodRange("today")));
    expect(totals).toMatchObject({ total: 54500, count: 3, fromDrawer: 3000, byMethod: { cash: 4500, bank_transfer: 50000 } });
    expect(totals.byCategory).toEqual({ Utilities: 3000, Transport: 1500, Rent: 50000 });
  });

  it("checks the amount, details and the open register", async () => {
    const { platform, owner } = await shop();
    const base = { category: "Supplies", description: "Nylon bags", paymentMethod: "cash" as const, staffId: owner.id };
    await expect(recordExpense(platform, { ...base, amount: 0 })).rejects.toThrow("amount");
    await expect(recordExpense(platform, { ...base, amount: 500, description: "x" })).rejects.toThrow("spent on");
    // Register closed: paying "from the drawer" is refused, from elsewhere is fine.
    await expect(recordExpense(platform, { ...base, amount: 500 })).rejects.toThrow("Open the register");
    await recordExpense(platform, { ...base, amount: 500, fromDrawer: false });
    // More than can be in the drawer.
    await openShift(platform, owner, 1000);
    await expect(recordExpense(platform, { ...base, amount: 5000 })).rejects.toThrow("should be in the drawer");
  });

  it("voids an expense and puts drawer cash back while the shift is open", async () => {
    const { platform, owner } = await shop();
    await openShift(platform, owner, 10000);
    const bags = await recordExpense(platform, { amount: 2000, category: "Supplies", description: "Nylon bags", paymentMethod: "cash", staffId: owner.id });
    expect((await currentShift(platform))!.cashOut).toBe(2000);
    await expect(voidExpense(platform, bags.id, owner.id, "x")).rejects.toThrow("reason");
    await voidExpense(platform, bags.id, owner.id, "Entered twice");
    expect((await currentShift(platform))!.cashOut).toBe(0);
    await expect(voidExpense(platform, bags.id, owner.id, "Again please")).rejects.toThrow("already voided");
    const [voided] = await listExpenses(platform, periodRange("today"));
    expect(voided).toMatchObject({ status: "voided", voided: { reason: "Entered twice" } });
    expect(expenseTotals([voided]).total).toBe(0);
  });

  it("is for owners and managers, including phones set up before expenses existed", async () => {
    const { platform } = await shop();
    await saveStaff(platform, { name: "Bisi Cashier", role: "cashier", pin: "582014" });
    await platform.db.run("DELETE FROM rows WHERE tbl IN ('access_role_permissions', 'access_permissions') AND id LIKE ?", ["%expense.manage"]);
    await ensureStandaloneUpgrades(platform);
    expect((await readModel.permissionsForRole(platform.db, "owner")).has("expense.manage")).toBe(true);
    expect((await readModel.permissionsForRole(platform.db, "manager")).has("expense.manage")).toBe(true);
    expect((await readModel.permissionsForRole(platform.db, "cashier")).has("expense.manage")).toBe(false);
  });
});
