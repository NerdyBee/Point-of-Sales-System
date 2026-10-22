import { describe, expect, it } from "vitest";
import { readModel } from "../src/data/readModel";
import { openShift, recordSale } from "../src/pos/actions";
import { activeClearance, expandCart } from "../src/pos/clearance";
import { calculateSale, type CartLine } from "../src/pos/pricing";
import { adjustStock, createStandaloneBusiness, saveProduct, saveStaff, voidSale } from "../src/standalone/business";
import { allocateStock, endClearance, expiringSoon, priceForPercent, productLots, setClearance, type StockLot } from "../src/standalone/expiry";
import { recordInflow } from "../src/standalone/inventory";
import { loadSettings } from "../src/sync/settings";
import { nodePlatform } from "./nodePlatform";

const inDays = (days: number) => {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
};

async function shop() {
  const platform = await nodePlatform();
  const { owner } = await createStandaloneBusiness(platform, { businessName: "Fresh Mart", currency: "NGN", vatPercent: 0, serviceChargePercent: 0, ownerName: "Femi Ade", ownerPin: "602731" });
  const cashier = await saveStaff(platform, { name: "Bisi Cashier", role: "cashier", pin: "582014" });
  const settings = (await loadSettings(platform))!;
  const tenant = (await readModel.tenant(platform.db, settings.tenantId))!;
  // 10 yoghurts expiring in 5 days (opening stock), then 20 more expiring in 40 days.
  const yoghurt = await saveProduct(platform, { name: "Yoghurt 500ml", category: "Dairy", price: 1000, stock: 10, expiryDate: inDays(5), staffId: owner.id });
  await recordInflow(platform, { staffId: owner.id, supplier: "Dairy Co", lines: [{ productId: yoghurt.id, quantity: 20, expiryDate: inDays(40) }] });
  const product = async () => (await readModel.product(platform.db, yoghurt.id))!;
  const sell = async (staff: typeof owner, quantity: number, discount = 0) => {
    const cart: CartLine[] = [{ product: await product(), quantity, discount }];
    const total = calculateSale(expandCart(cart), tenant.settings).total;
    return recordSale(platform, { settings, tenantSettings: tenant.settings, staff, cart, payments: [{ method: "cash", amount: total }] });
  };
  await openShift(platform, owner, 0);
  return { platform, owner, cashier, yoghurt, product, sell };
}

describe("batches and expiry", () => {
  it("works out what is left of each batch, oldest sold first", () => {
    const lot = (id: string, quantity: number, createdAt: string): StockLot =>
      ({ id, quantity, createdAt, productId: "p", productName: "P", tenantId: "t", branchId: "b", expiryDate: null, source: "inflow", reference: null, createdBy: "x" });
    const lots = [lot("old", 10, "2026-10-01T00:00:00Z"), lot("new", 20, "2026-10-10T00:00:00Z")];
    expect(allocateStock(30, lots).map((item) => [item.id, item.remaining])).toEqual([["new", 20], ["old", 10]]);
    expect(allocateStock(24, lots).map((item) => [item.id, item.remaining])).toEqual([["new", 20], ["old", 4]]);
    expect(allocateStock(8, lots).map((item) => [item.id, item.remaining])).toEqual([["new", 8], ["old", 0]]);
  });

  it("lists batches expiring soon with the units still on the shelf", async () => {
    const { platform, owner, product, sell } = await shop();
    expect((await productLots(platform, await product())).map((lot) => [lot.remaining, lot.daysLeft])).toEqual([[20, 40], [10, 5]]);
    let soon = await expiringSoon(platform, { withinDays: 30 });
    expect(soon.map((row) => [row.product.name, row.lot.remaining, row.lot.daysLeft])).toEqual([["Yoghurt 500ml", 10, 5]]);
    await sell(owner, 4);
    soon = await expiringSoon(platform, { withinDays: 30 });
    expect(soon[0].lot.remaining).toBe(6);
    expect((await expiringSoon(platform, { withinDays: 60 })).length).toBe(2);
  });

  it("sells only the clearance units at the clearance price, then the normal price", async () => {
    const { platform, owner, cashier, yoghurt, product, sell } = await shop();
    expect(priceForPercent(1000, 30)).toBe(700);
    await expect(setClearance(platform, { productId: yoghurt.id, clearancePrice: 1000, units: 10, staffId: owner.id })).rejects.toThrow("below the normal price");
    await expect(setClearance(platform, { productId: yoghurt.id, clearancePrice: 700, units: 99, staffId: owner.id })).rejects.toThrow("in stock");
    await setClearance(platform, { productId: yoghurt.id, clearancePrice: 700, units: 10, endsAt: inDays(5), expiryDate: inDays(5), staffId: owner.id });
    expect(activeClearance(await product())).toMatchObject({ price: 700, remaining: 10, percent: 30 });

    // A cashier (not allowed to give discounts) can still sell clearance units.
    const first = await sell(cashier, 4);
    expect(first.summary).toMatchObject({ subtotal: 4000, discount: 1200, total: 2800 });
    expect((await product()).clearanceRemaining).toBe(6);

    // 8 more: 6 at clearance, 2 at the normal price.
    const second = await sell(cashier, 8);
    expect(second.summary.lines.map((line) => [line.quantity, line.discount, line.clearance ?? false])).toEqual([[6, 1800, true], [2, 0, false]]);
    expect(second.summary.total).toBe(6 * 700 + 2 * 1000);
    expect(activeClearance(await product())).toBeNull();

    // But a manual price change still needs the permission.
    await expect(sell(cashier, 1, 100)).rejects.toThrow("not allowed to give discounts");

    // Voiding a clearance sale puts those units back on clearance.
    await voidSale(platform, first.id, owner.id, "Customer returned");
    expect((await product()).clearanceRemaining).toBe(4);
    await endClearance(platform, yoghurt.id);
    expect(activeClearance(await product())).toBeNull();
  });

  it("stops the clearance after its end date", async () => {
    const { platform, owner, yoghurt, product } = await shop();
    await setClearance(platform, { productId: yoghurt.id, clearancePrice: 500, units: 5, endsAt: inDays(1), staffId: owner.id });
    expect(activeClearance(await product())).not.toBeNull();
    const twoDaysLater = Date.now() + 2 * 86_400_000;
    expect(activeClearance(await product(), twoDaysLater)).toBeNull();
    await expect(setClearance(platform, { productId: yoghurt.id, clearancePrice: 500, units: 5, endsAt: inDays(-1), staffId: owner.id })).rejects.toThrow("already passed");
  });

  it("records batches for stock received on a product and checks dates", async () => {
    const { platform, owner, yoghurt, product } = await shop();
    await expect(adjustStock(platform, yoghurt.id, 5, "Delivery", { expiryDate: "2026-02-30" })).rejects.toThrow("does not exist");
    await adjustStock(platform, yoghurt.id, 5, "Delivery", { expiryDate: inDays(3), staffId: owner.id });
    const lots = await productLots(platform, await product());
    expect(lots[0]).toMatchObject({ quantity: 5, remaining: 5, daysLeft: 3, source: "received" });
    await expect(recordInflow(platform, { staffId: owner.id, lines: [{ productId: yoghurt.id, quantity: 1, expiryDate: "31/12/2026" }] })).rejects.toThrow("2026-12-31");
  });
});
