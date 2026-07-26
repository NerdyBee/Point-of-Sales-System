import { describe, expect, it } from "vitest";
import { formatMoney } from "./money";

describe("money utilities", () => {
  it("formats tenant currencies without fractional digits", () => {
    const normalizedAmounts = ["NGN", "USD", "GHS", "KES", "ZAR"].map((currency) =>
      formatMoney(8500, currency as Parameters<typeof formatMoney>[1]).replace(/\D/g, "")
    );

    expect(formatMoney(8500, "USD")).toBe("$8,500");
    expect(normalizedAmounts).toEqual(["8500", "8500", "8500", "8500", "8500"]);
  });
});
