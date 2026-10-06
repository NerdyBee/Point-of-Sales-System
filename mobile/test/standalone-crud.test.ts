import { describe, expect, it } from "vitest";
import { readModel } from "../src/data/readModel";
import { currentShift, daySummary, openShift, recentSales, recordSale, shiftHistory, requestCloseShift } from "../src/pos/actions";
import { calculateSale } from "../src/pos/pricing";
import { loadSettings } from "../src/sync/settings";
import {
  adjustStock,
  createStandaloneBusiness,
  customerSales,
  deleteCustomer,
  deleteProduct,
  listCustomers,
  saveCustomer,
  saveProduct,
  setProductArchived,
  stockHistory,
  voidSale
} from "../src/standalone/business";
import { nodePlatform } from "./nodePlatform";

async function shop() {
  const platform = await nodePlatform();
  const { owner } = await createStandaloneBusiness(platform, {
    businessName: "Corner Shop",
    currency: "NGN",
    vatPercent: 0,
    serviceChargePercent: 0,
    ownerName: "Ada Eze",
    ownerPin: "582941"
  });
  const settings = (await loadSettings(platform))!;
  const tenant = (await readModel.tenant(platform.db, settings.tenantId))!;
  return { platform, owner, settings, tenant };
}

describe("standalone create / read / update / delete", () => {
  it("deletes unsold products, archives sold ones and keeps stock history", async () => {
    const { platform, owner, settings, tenant } = await shop();
    const unsold = await saveProduct(platform, { name: "Matches", category: "General", price: 50, stock: 10 });
    const sold = await saveProduct(platform, { name: "Bread", category: "Bakery", price: 1200, stock: 5 });
    await adjustStock(platform, sold.id, 3, "Morning delivery");

    const history = await stockHistory(platform, sold.id);
    expect(history.map((move) => [move.quantityDelta, move.reason])).toEqual([[3, "Morning delivery"], [5, "Opening stock"]]);

    const edited = await saveProduct(platform, { id: sold.id, name: "Bread (large)", category: "Bakery", price: 1300 });
    expect(edited).toMatchObject({ name: "Bread (large)", price: 1300, stock: 8 });

    await openShift(platform, owner, 0);
    const cart = [{ product: edited, quantity: 1, discount: 0 }];
    await recordSale(platform, { settings, tenantSettings: tenant.settings, staff: owner, cart, payments: [{ method: "cash", amount: calculateSale(cart, tenant.settings).total }] });

    expect(await deleteProduct(platform, unsold.id)).toBe("deleted");
    expect(await stockHistory(platform, unsold.id)).toEqual([]);
    expect(await deleteProduct(platform, sold.id)).toBe("archived");

    expect((await readModel.products(platform.db, settings.branchId)).map((product) => product.id)).toEqual([]);
    const all = await readModel.products(platform.db, settings.branchId, { includeArchived: true });
    expect(all).toEqual([expect.objectContaining({ id: sold.id, archived: true, stock: 7 })]);

    await setProductArchived(platform, sold.id, false);
    expect((await readModel.products(platform.db, settings.branchId)).map((product) => product.id)).toEqual([sold.id]);
  });

  it("creates, edits, searches and deletes customers, protecting ones with sales", async () => {
    const { platform, owner, settings, tenant } = await shop();
    const bola = await saveCustomer(platform, { name: "Bola", phone: "0803 111 2222", group: "VIP" });
    const chidi = await saveCustomer(platform, { name: "Chidi", phone: "08055556666", email: "chidi@example.com" });
    await expect(saveCustomer(platform, { name: "Copy", phone: "08031112222" })).rejects.toThrow("already has this phone");
    await expect(saveCustomer(platform, { name: "Bad", phone: "08099999999", email: "not-an-email" })).rejects.toThrow("valid email");

    const updated = await saveCustomer(platform, { id: bola.id, name: "Bola Ade", phone: "08031112222", group: "Wholesale", notes: "Pays monthly" });
    expect(updated).toMatchObject({ id: bola.id, name: "Bola Ade", group: "Wholesale", notes: "Pays monthly", loyaltyPoints: 0 });
    expect((await listCustomers(platform, "ade")).map((customer) => customer.id)).toEqual([bola.id]);
    expect((await listCustomers(platform, "0805")).map((customer) => customer.id)).toEqual([chidi.id]);

    const product = await saveProduct(platform, { name: "Milk", category: "Dairy", price: 900, stock: 20 });
    await openShift(platform, owner, 0);
    const cart = [{ product, quantity: 2, discount: 0 }];
    await recordSale(platform, { settings, tenantSettings: tenant.settings, staff: owner, cart, customer: updated, payments: [{ method: "card", amount: 1800, reference: "T-1" }] });

    expect(await customerSales(platform, bola.id)).toEqual({ count: 1, total: 1800 });
    await expect(deleteCustomer(platform, bola.id)).rejects.toThrow("has sales on record");
    await deleteCustomer(platform, chidi.id);
    expect((await listCustomers(platform)).map((customer) => customer.id)).toEqual([bola.id]);
  });

  it("voids a sale: stock, loyalty, expected cash and totals are reversed", async () => {
    const { platform, owner, settings, tenant } = await shop();
    const product = await saveProduct(platform, { name: "Soap", category: "Toiletries", price: 2500, stock: 10 });
    const customer = await saveCustomer(platform, { name: "Ngozi", phone: "08077778888" });
    await openShift(platform, owner, 1000);
    const cart = [{ product, quantity: 4, discount: 0 }];
    const sale = await recordSale(platform, { settings, tenantSettings: tenant.settings, staff: owner, cart, customer, payments: [{ method: "cash", amount: 10000 }] });

    expect((await listCustomers(platform, "Ngozi"))[0].loyaltyPoints).toBe(100);
    expect((await currentShift(platform))?.cashSales).toBe(10000);
    await expect(voidSale(platform, sale.id, owner.id, "")).rejects.toThrow("reason");

    await voidSale(platform, sale.id, owner.id, "Customer changed mind");
    await expect(voidSale(platform, sale.id, owner.id, "again")).rejects.toThrow("already voided");

    expect((await readModel.products(platform.db, settings.branchId))[0].stock).toBe(10);
    expect((await listCustomers(platform, "Ngozi"))[0].loyaltyPoints).toBe(0);
    expect((await currentShift(platform))?.cashSales).toBe(0);
    expect((await recentSales(platform))[0].status).toBe("voided");
    expect(await daySummary(platform)).toMatchObject({ count: 0, total: 0 });
    expect((await stockHistory(platform, product.id))[0]).toMatchObject({ quantityDelta: 4, reason: `Void ${sale.number}` });

    const closed = await requestCloseShift(platform, owner, 1000);
    expect(closed).toEqual({ closed: true, expected: 1000 });
    const [shift] = await shiftHistory(platform);
    expect(shift).toMatchObject({ status: "closed", countedCash: 1000, sales: 0, salesTotal: 0 });
  });
});
