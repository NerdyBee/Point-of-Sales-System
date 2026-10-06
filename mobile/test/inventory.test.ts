import { describe, expect, it } from "vitest";
import { readModel } from "../src/data/readModel";
import { openShift, recordSale } from "../src/pos/actions";
import { calculateSale } from "../src/pos/pricing";
import { loadSettings } from "../src/sync/settings";
import { adjustStock, createStandaloneBusiness, saveProduct, voidSale } from "../src/standalone/business";
import { cancelInflow, listInflows, periodRange, recordInflow, stockReport, stockReportCsv } from "../src/standalone/inventory";
import { nodePlatform } from "./nodePlatform";

async function shop() {
  const platform = await nodePlatform();
  const { owner } = await createStandaloneBusiness(platform, {
    businessName: "Inflow Stores",
    currency: "NGN",
    vatPercent: 0,
    serviceChargePercent: 0,
    ownerName: "Uche Obi",
    ownerPin: "593817"
  });
  const settings = (await loadSettings(platform))!;
  const tenant = (await readModel.tenant(platform.db, settings.tenantId))!;
  const sell = async (product: Awaited<ReturnType<typeof saveProduct>>, quantity: number) => {
    const fresh = (await readModel.products(platform.db, settings.branchId)).find((item) => item.id === product.id)!;
    const cart = [{ product: fresh, quantity, discount: 0 }];
    return recordSale(platform, { settings, tenantSettings: tenant.settings, staff: owner, cart, payments: [{ method: "cash", amount: calculateSale(cart, tenant.settings).total }] });
  };
  return { platform, owner, settings, sell };
}

const today = () => periodRange("today");
const stockOf = async (platform: Awaited<ReturnType<typeof nodePlatform>>, branchId: string, id: string) =>
  (await readModel.products(platform.db, branchId, { includeArchived: true })).find((product) => product.id === id)!.stock;

describe("stock inflow", () => {
  it("receives several products at once, merges duplicate lines and updates cost prices", async () => {
    const { platform, owner, settings } = await shop();
    const rice = await saveProduct(platform, { name: "Rice 5kg", category: "Groceries", price: 9000, cost: 7000, stock: 2 });
    const oil = await saveProduct(platform, { name: "Oil 1L", category: "Groceries", price: 2500, stock: 0 });

    const inflow = await recordInflow(platform, {
      supplier: "Dangote Depot",
      reference: "DN-7781",
      staffId: owner.id,
      lines: [
        { productId: rice.id, quantity: 10, unitCost: 7200 },
        { productId: oil.id, quantity: 24, unitCost: 1900 },
        { productId: rice.id, quantity: 5 }
      ]
    });

    expect(inflow).toMatchObject({ number: "INF-00001", supplier: "Dangote Depot", reference: "DN-7781", totalQuantity: 39, totalCost: 15 * 7200 + 24 * 1900 });
    expect(inflow.lines).toHaveLength(2);
    expect(await stockOf(platform, settings.branchId, rice.id)).toBe(17);
    expect(await stockOf(platform, settings.branchId, oil.id)).toBe(24);
    expect((await readModel.products(platform.db, settings.branchId)).find((product) => product.id === rice.id)?.cost).toBe(7200);

    const second = await recordInflow(platform, { staffId: owner.id, lines: [{ productId: oil.id, quantity: 1 }], updateCost: false });
    expect(second.number).toBe("INF-00002");
    expect((await listInflows(platform)).map((item) => item.number)).toEqual(["INF-00002", "INF-00001"]);
  });

  it("rejects empty inflows, zero quantities and services", async () => {
    const { platform, owner } = await shop();
    const delivery = await saveProduct(platform, { name: "Delivery", category: "Services", price: 500 });
    const soap = await saveProduct(platform, { name: "Soap", category: "Toiletries", price: 300 });
    await expect(recordInflow(platform, { staffId: owner.id, lines: [] })).rejects.toThrow("at least one item");
    await expect(recordInflow(platform, { staffId: owner.id, lines: [{ productId: soap.id, quantity: 0 }] })).rejects.toThrow("at least 1");
    await expect(recordInflow(platform, { staffId: owner.id, lines: [{ productId: delivery.id, quantity: 3 }] })).rejects.toThrow("service");
  });

  it("cancels a mistaken inflow, but not once the stock has been sold", async () => {
    const { platform, owner, settings, sell } = await shop();
    const soap = await saveProduct(platform, { name: "Soap", category: "Toiletries", price: 300 });
    const sugar = await saveProduct(platform, { name: "Sugar", category: "Groceries", price: 1200 });
    const wrong = await recordInflow(platform, { staffId: owner.id, lines: [{ productId: soap.id, quantity: 50 }] });
    const sold = await recordInflow(platform, { staffId: owner.id, lines: [{ productId: sugar.id, quantity: 4 }] });

    await openShift(platform, owner, 0);
    await sell(sugar, 3);

    await expect(cancelInflow(platform, sold.id, owner.id, "Typo")).rejects.toThrow("only 1 Sugar left");
    await cancelInflow(platform, wrong.id, owner.id, "Entered twice");
    expect(await stockOf(platform, settings.branchId, soap.id)).toBe(0);
    await expect(cancelInflow(platform, wrong.id, owner.id, "again")).rejects.toThrow("already cancelled");
    expect((await listInflows(platform)).find((item) => item.id === wrong.id)?.cancelled?.reason).toBe("Entered twice");
  });
});

describe("inflow vs sales vs stock report", () => {
  it("reconciles opening + inflow - sold +/- adjustments to the current quantity", async () => {
    const { platform, owner, settings, sell } = await shop();
    const bread = await saveProduct(platform, { name: "Bread", category: "Bakery", price: 1000, cost: 600, stock: 10 });
    const delivery = await saveProduct(platform, { name: "Delivery", category: "Services", price: 500 });
    await recordInflow(platform, { staffId: owner.id, lines: [{ productId: bread.id, quantity: 5, unitCost: 650 }] });
    await openShift(platform, owner, 0);
    await sell(bread, 3);
    const mistake = await sell(bread, 1);
    await voidSale(platform, mistake.id, owner.id, "Wrong item");
    await sell(delivery, 2);
    await adjustStock(platform, bread.id, -1, "Damaged");

    const report = await stockReport(platform, today());
    const row = report.rows.find((item) => item.productId === bread.id)!;
    expect(row).toMatchObject({ opening: 0, inflow: 15, sold: 3, adjusted: -1, closing: 11, current: 11, inflowCost: 5 * 650, salesValue: 3000 });
    expect(report.rows.find((item) => item.productId === delivery.id)).toMatchObject({ tracked: false, sold: 2, salesValue: 1000 });
    expect(report.mismatched).toEqual([]);
    expect(report.totals).toMatchObject({ inflow: 15, sold: 5, adjusted: -1, inflowCost: 3250, salesValue: 4000, stockValue: 11 * 650 });

    // A period that ends before anything happened opens and closes at zero; one that starts later carries the stock in.
    const before = await stockReport(platform, { from: new Date(2020, 0, 1), to: new Date(2020, 0, 2) });
    expect(before.rows.find((item) => item.productId === bread.id)).toMatchObject({ opening: 0, inflow: 0, closing: 0, current: 11 });
    const future = new Date(Date.now() + 3_600_000);
    const later = await stockReport(platform, { from: future, to: new Date(future.getTime() + 3_600_000) });
    expect(later.rows.find((item) => item.productId === bread.id)).toMatchObject({ opening: 11, inflow: 0, sold: 0, closing: 11 });
  });

  it("counts voids recorded by older versions as sales returns", async () => {
    const { platform, owner, settings, sell } = await shop();
    const tea = await saveProduct(platform, { name: "Tea", category: "Drinks", price: 200, stock: 10 });
    await openShift(platform, owner, 0);
    await sell(tea, 2);
    // Simulate an old-style void: stock put back with an "adjustment" movement named "Void ...".
    await platform.db.run("UPDATE rows SET data = json_set(data, '$.stock', 10) WHERE tbl = 'products' AND id = ?", [tea.id]);
    await platform.db.run(
      "INSERT INTO rows (tbl, id, branchId, data, updatedAt) VALUES ('stock_movements', 'legacy-void', ?, ?, ?)",
      [settings.branchId, JSON.stringify({ id: "legacy-void", productId: tea.id, type: "adjustment", quantityDelta: 2, balanceAfter: 10, reason: "Void X-00001", createdAt: new Date().toISOString() }), new Date().toISOString()]
    );
    const row = (await stockReport(platform, today())).rows.find((item) => item.productId === tea.id)!;
    expect(row).toMatchObject({ inflow: 10, sold: 0, adjusted: 0, closing: 10 });
  });

  it("exports CSV with optional cost columns and safe quoting", async () => {
    const { platform, owner } = await shop();
    const odd = await saveProduct(platform, { name: 'Milk "Peak", tin', category: "Dairy", price: 650, stock: 1 });
    await recordInflow(platform, { staffId: owner.id, lines: [{ productId: odd.id, quantity: 2, unitCost: 500 }] });
    const report = await stockReport(platform, today());
    const withCosts = stockReportCsv(report, { includeCosts: true }).split("\n");
    expect(withCosts[0]).toBe("Product,Category,Opening,Inflow,Sold,Adjusted,Closing,Inflow cost,Sales value");
    expect(withCosts[1]).toBe('"Milk ""Peak"", tin",Dairy,0,3,0,0,3,1000,0');
    expect(stockReportCsv(report, { includeCosts: false }).split("\n")[0]).not.toContain("cost");
  });

  it("builds period ranges", () => {
    const reference = new Date(2026, 9, 8, 15, 30); // Thursday 8 Oct 2026
    expect(periodRange("today", reference).from).toEqual(new Date(2026, 9, 8));
    expect(periodRange("yesterday", reference)).toEqual({ from: new Date(2026, 9, 7), to: new Date(2026, 9, 8) });
    expect(periodRange("week", reference).from).toEqual(new Date(2026, 9, 5));
    expect(periodRange("month", reference).from).toEqual(new Date(2026, 9, 1));
  });
});
