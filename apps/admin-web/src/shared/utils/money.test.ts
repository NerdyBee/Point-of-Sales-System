import { afterEach, describe, expect, it } from "vitest";
import { formatMoney, fromMajorUnits, setMoneyDecimals, toMajorUnits } from "./money";

describe("money utilities", () => {
  afterEach(() => setMoneyDecimals(0));

  it("formats whole-unit businesses without fractional digits", () => {
    expect(formatMoney(8500, "NGN")).toBe("₦8,500");
    expect(formatMoney(8500, "USD")).toBe("$8,500");
  });

  it("formats stored smallest units for businesses with decimals", () => {
    setMoneyDecimals(2);
    expect(formatMoney(499, "USD")).toBe("$4.99");
    expect(formatMoney(850050, "GBP")).toBe("£8,500.50");
    expect(formatMoney(100, "EUR", 0)).toBe("€100");
  });

  it("converts between typed and stored amounts", () => {
    setMoneyDecimals(2);
    expect(fromMajorUnits(4.99)).toBe(499);
    expect(fromMajorUnits(0.1 + 0.2)).toBe(30);
    expect(toMajorUnits(499)).toBe(4.99);
    expect(fromMajorUnits(12, 0)).toBe(12);
  });

  it("shows the code for currencies without a symbol", () => {
    expect(formatMoney(1200, "ZZZ").replace(/\s/g, " ")).toBe("ZZZ 1,200");
  });
});
