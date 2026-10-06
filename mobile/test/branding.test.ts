import { describe, expect, it } from "vitest";
import { getBusinessLogo, loadReceiptBranding, setBusinessLogo } from "../src/print/branding";
import { loadSettings, saveSettings } from "../src/sync/settings";
import { createStandaloneBusiness, exportBackup, restoreBackup, updateBusinessSettings } from "../src/standalone/business";
import { nodePlatform } from "./nodePlatform";

const settingsInput = {
  businessName: "Mama Nkechi Provisions",
  vatPercent: 7.5,
  serviceChargePercent: 0,
  receiptFooter: "Thanks",
  paymentMethods: { cash: true, card: true, bankTransfer: true, mobileMoney: false }
};

async function shop() {
  const platform = await nodePlatform();
  await createStandaloneBusiness(platform, { businessName: "Mama Nkechi Provisions", currency: "NGN", vatPercent: 7.5, serviceChargePercent: 0, ownerName: "Nkechi", ownerPin: "582913" });
  return { platform, settings: (await loadSettings(platform))! };
}

describe("receipt branding", () => {
  it("saves phone, address and logo, and prints the logo unless turned off", async () => {
    const { platform, settings } = await shop();
    expect(await loadReceiptBranding(platform, settings)).toEqual({ phone: undefined, address: undefined, logoPng: undefined });

    await updateBusinessSettings(platform, { ...settingsInput, phone: " 0803 123 4567 ", address: "12 Market Road, Onitsha" });
    await setBusinessLogo(platform, "iVBORw0KGgo=");
    expect(await loadReceiptBranding(platform, settings)).toEqual({ phone: "0803 123 4567", address: "12 Market Road, Onitsha", logoPng: "iVBORw0KGgo=" });

    await updateBusinessSettings(platform, { ...settingsInput, phone: "0803 123 4567", address: "12 Market Road, Onitsha", printLogo: false });
    expect((await loadReceiptBranding(platform, settings)).logoPng).toBeUndefined();
    expect(await getBusinessLogo(platform)).toBe("iVBORw0KGgo=");

    await setBusinessLogo(platform, null);
    expect(await getBusinessLogo(platform)).toBeNull();
    await expect(updateBusinessSettings(platform, { ...settingsInput, address: "x".repeat(201) })).rejects.toThrow("Address is too long");
  });

  it("falls back to the branch's phone and address (server-connected devices)", async () => {
    const { platform, settings } = await shop();
    await platform.db.run("UPDATE rows SET data = json_set(data, '$.phone', '01-555-0100', '$.address', '5 Allen Avenue', '$.city', 'Ikeja') WHERE tbl = 'branches' AND id = ?", [settings.branchId]);
    await saveSettings(platform, { ...settings, mode: "local" });
    expect(await loadReceiptBranding(platform, { ...settings, mode: "local" })).toEqual({ phone: "01-555-0100", address: "5 Allen Avenue, Ikeja", logoPng: undefined });
  });

  it("keeps the logo in backups", async () => {
    const { platform } = await shop();
    await setBusinessLogo(platform, "bG9nbw==");
    const backup = await exportBackup(platform);
    const fresh = await nodePlatform();
    await restoreBackup(fresh, backup.content);
    expect(await getBusinessLogo(fresh)).toBe("bG9nbw==");
  });
});
