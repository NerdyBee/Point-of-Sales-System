import { describe, expect, it } from "vitest";
import type { Product } from "../src/data/readModel";
import { calculateSale } from "../src/pos/pricing";

const product = (id: string, price: number, taxRate = 0.075): Product => ({
  id,
  branchId: "b1",
  name: id,
  sku: id,
  barcode: id,
  category: "Food",
  price,
  taxRate,
  image: "",
  stock: 10,
  station: "Counter"
});

describe("calculateSale (must match the server's previewSaleTotal)", () => {
  it("rounds VAT per line and adds service charge on the discounted subtotal", () => {
    const summary = calculateSale(
      [
        { product: product("a", 1333), quantity: 3, discount: 0 },
        { product: product("b", 999), quantity: 1, discount: 100 }
      ],
      { defaultTaxRate: 0.075, serviceChargeEnabled: true, serviceChargeRate: 0.05 }
    );
    // a: 3999 base, vat round(299.925)=300 ; b: 899 base, vat round(67.425)=67
    expect(summary.subtotal).toBe(4998);
    expect(summary.discount).toBe(100);
    expect(summary.vat).toBe(367);
    expect(summary.serviceCharge).toBe(245); // round(4898 * 0.05) = 244.9
    expect(summary.total).toBe(3999 + 300 + 899 + 67 + 245);
  });

  it("falls back to each product's tax rate when the business has no default", () => {
    const summary = calculateSale([{ product: product("a", 1000, 0.1), quantity: 2, discount: 0 }], { serviceChargeEnabled: false });
    expect(summary.vat).toBe(200);
    expect(summary.serviceCharge).toBe(0);
    expect(summary.total).toBe(2200);
  });
});
