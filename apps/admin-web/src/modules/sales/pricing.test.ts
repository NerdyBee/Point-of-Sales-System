import { describe, expect, it } from "vitest";
import { calculateSale, applyManagerApproval } from "./pricing";
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
