import { describe, expect, it } from "vitest";
import { activeClearance, calculateSale, applyManagerApproval, expandCart, manualDiscount } from "./pricing";
import type { CartItem } from "./types";

const item: CartItem = {
  product: {
    id: "p1",
    branchId: "branch-lagos-main",
    name: "Jollof Rice",
    sku: "JOL-001",
    barcode: "1001",
    category: "Meals",
    price: 8500,
    cost: 4200,
    taxRate: 0.075,
    image: "",
    stock: 20,
    reorderPoint: 5,
    station: "Kitchen",
    modifiers: []
  },
  quantity: 2,
  discount: 500
};

describe("sales pricing", () => {
  it("calculates subtotal, discount, service charge, VAT and total", () => {
    expect(calculateSale([item])).toEqual({
      subtotal: 17000,
      discount: 1000,
      serviceCharge: 800,
      vat: 1200,
      total: 18000
    });
  });

  it("can remove service charge", () => {
    expect(calculateSale([item], { serviceChargeEnabled: false })).toMatchObject({
      serviceCharge: 0,
      total: 17200
    });
  });

  it("can override VAT and service charge rate", () => {
    expect(calculateSale([item], { vatRate: 0.1, serviceChargeRate: 0.075 })).toMatchObject({
      serviceCharge: 1200,
      vat: 1600,
      total: 18800
    });
  });

  it("flags sensitive or high-value actions for manager approval", () => {
    expect(applyManagerApproval("void", 1000)).toBe(true);
    expect(applyManagerApproval("discount", 51000)).toBe(true);
    expect(applyManagerApproval("discount", 3000)).toBe(false);
  });
});

describe("clearance pricing", () => {
  const nextWeek = new Date(Date.now() + 7 * 86_400_000).toISOString().slice(0, 10);
  const onClearance: CartItem = {
    ...item,
    quantity: 5,
    discount: 0,
    product: { ...item.product, price: 1000, clearancePrice: 700, clearanceRemaining: 3, clearanceEndsAt: nextWeek }
  };

  it("sells the clearance units first at the clearance price, then the normal price", () => {
    const lines = expandCart([onClearance]);
    expect(lines.map((line) => [line.quantity, line.discount, line.clearance ?? false])).toEqual([
      [3, 300, true],
      [2, 0, false]
    ]);
    expect(calculateSale(lines, { vatRate: 0, serviceChargeEnabled: false }).total).toBe(3 * 700 + 2 * 1000);
    expect(manualDiscount([onClearance])).toBe(0);
    expect(manualDiscount([{ ...onClearance, discount: 100 }])).toBe(200);
  });

  it("stops after the end date or when no units are left", () => {
    expect(activeClearance(onClearance.product)).toMatchObject({ price: 700, remaining: 3, percent: 30 });
    expect(activeClearance(onClearance.product, new Date(Date.now() + 9 * 86_400_000))).toBeNull();
    expect(activeClearance({ ...onClearance.product, clearanceRemaining: 0 })).toBeNull();
    expect(expandCart([{ ...onClearance, product: { ...onClearance.product, clearanceRemaining: 0 } }])).toHaveLength(1);
  });
});
