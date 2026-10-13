import { describe, expect, it } from "vitest";
import { readModel } from "../src/data/readModel";
import { listSales, openShift, recordSale } from "../src/pos/actions";
import { calculateSale } from "../src/pos/pricing";
import { createStandaloneBusiness, saveCustomer, saveProduct, voidSale } from "../src/standalone/business";
import { loadSettings } from "../src/sync/settings";
import { nodePlatform } from "./nodePlatform";

describe("sales list", () => {
  it("pages through every sale and filters by day, voided and search", async () => {
    const platform = await nodePlatform();
    const { owner } = await createStandaloneBusiness(platform, { businessName: "Busy Shop", currency: "NGN", vatPercent: 0, serviceChargePercent: 0, ownerName: "Femi Ade", ownerPin: "602731" });
    const settings = (await loadSettings(platform))!;
    const tenant = (await readModel.tenant(platform.db, settings.tenantId))!;
    const water = await saveProduct(platform, { name: "Water", category: "Drinks", price: 200, stock: 1000 });
    const bayo = await saveCustomer(platform, { name: "Bayo Stores", phone: "08033333333" });
    await openShift(platform, owner, 0);
    const cart = [{ product: water, quantity: 1, discount: 0 }];
    const total = calculateSale(cart, tenant.settings).total;
    for (let index = 0; index < 130; index += 1) {
      await recordSale(platform, { settings, tenantSettings: tenant.settings, staff: owner, cart, customer: index === 5 ? bayo : null, payments: [{ method: "cash", amount: total }] });
    }

    const first = await listSales(platform, { day: new Date(), limit: 100 });
    const second = await listSales(platform, { day: new Date(), limit: 100, offset: 100 });
    expect(first).toHaveLength(100);
    expect(second).toHaveLength(30);
    expect(new Set([...first, ...second].map((sale) => sale.id)).size).toBe(130);

    const yesterday = new Date(Date.now() - 86_400_000);
    expect(await listSales(platform, { day: yesterday })).toHaveLength(0);

    expect((await listSales(platform, { search: "bayo" })).map((sale) => JSON.parse(sale.data).customer.name)).toEqual(["Bayo Stores"]);
    expect(await listSales(platform, { search: "0803333" })).toHaveLength(1);
    expect(await listSales(platform, { search: first[0].number })).toHaveLength(1);

    await voidSale(platform, first[0].id, owner.id, "Wrong item");
    expect((await listSales(platform, { voidedOnly: true })).map((sale) => sale.id)).toEqual([first[0].id]);
  });
});
