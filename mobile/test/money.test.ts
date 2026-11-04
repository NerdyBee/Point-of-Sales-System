import { afterEach, describe, expect, it } from "vitest";
import { readModel } from "../src/data/readModel";
import { formatMoney, fromMajorUnits, groupAmount, setMoneyDecimals } from "../src/pos/pricing";
import { printMoney } from "../src/print/receipt";
import { createStandaloneBusiness } from "../src/standalone/business";
import { loadSettings } from "../src/sync/settings";
import { nodePlatform } from "./nodePlatform";

describe("money in other currencies", () => {
  afterEach(() => setMoneyDecimals(0));

  it("keeps whole units for businesses without decimals", () => {
    expect(formatMoney(8500, "NGN")).toBe("₦8,500");
    expect(printMoney(12500, "NGN")).toBe("N12,500");
  });

  it("shows stored smallest units as decimals", () => {
    setMoneyDecimals(2);
    expect(formatMoney(499, "USD")).toBe("$4.99");
    expect(formatMoney(850050, "GBP")).toBe("£8,500.50");
    expect(printMoney(499, "GBP")).toBe("GBP 4.99");
    expect(printMoney(-1250, "USD")).toBe("-$12.50");
    expect(groupAmount(1234.5)).toBe("1,234.50");
    expect(fromMajorUnits(0.1 + 0.2)).toBe(30);
  });

  it("fixes the decimal places from the currency when a business is created", async () => {
    const usd = await nodePlatform();
    await createStandaloneBusiness(usd, { businessName: "Corner Deli", currency: "USD", vatPercent: 8, serviceChargePercent: 0, ownerName: "Ann Lee", ownerPin: "602731" });
    const usdTenant = await readModel.tenant(usd.db, (await loadSettings(usd))!.tenantId);
    expect(usdTenant?.settings.moneyDecimals).toBe(2);

    const ngn = await nodePlatform();
    await createStandaloneBusiness(ngn, { businessName: "Mama Store", currency: "NGN", vatPercent: 7.5, serviceChargePercent: 0, ownerName: "Ada Obi", ownerPin: "602731" });
    const ngnTenant = await readModel.tenant(ngn.db, (await loadSettings(ngn))!.tenantId);
    expect(ngnTenant?.settings.moneyDecimals).toBe(0);
  });
});
