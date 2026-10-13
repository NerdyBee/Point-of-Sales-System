import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { readModel } from "../src/data/readModel";
import { publicKeyFor } from "../src/license/license";
import { unlockWithVendorKey } from "../src/standalone/backupCrypto";
import {
  BackupPasswordNeeded,
  createStandaloneBusiness,
  exportBackup,
  hasBackupPassword,
  inspectBackup,
  restoreBackup,
  saveCustomer,
  setBackupPassword
} from "../src/standalone/business";
import { loadSettings } from "../src/sync/settings";
import { nodePlatform } from "./nodePlatform";

const vendorSecret = randomBytes(32).toString("hex");
const vendorPublicKeyHex = publicKeyFor(vendorSecret);

async function shop() {
  const platform = await nodePlatform();
  await createStandaloneBusiness(platform, { businessName: "Locked Stores", currency: "NGN", vatPercent: 0, serviceChargePercent: 0, ownerName: "Femi Ade", ownerPin: "602731" });
  await saveCustomer(platform, { name: "Mama Tunde", phone: "08020000000" });
  return platform;
}

describe("locked backups", () => {
  it("needs a backup password before the first backup", async () => {
    const platform = await shop();
    expect(await hasBackupPassword(platform)).toBe(false);
    await expect(exportBackup(platform, { vendorPublicKeyHex })).rejects.toBeInstanceOf(BackupPasswordNeeded);
    await expect(setBackupPassword(platform, "12345")).rejects.toThrow("at least 6");
    await setBackupPassword(platform, "kano-2026!");
    expect(await hasBackupPassword(platform)).toBe(true);
  });

  it("keeps customer details and PIN hashes unreadable without the password", async () => {
    const platform = await shop();
    await setBackupPassword(platform, "kano-2026!");
    const backup = await exportBackup(platform, { vendorPublicKeyHex });
    expect(backup.content).not.toContain("Mama Tunde");
    expect(backup.content).not.toContain("08020000000");
    expect(backup.content).not.toContain("sha256:");
    expect(inspectBackup(backup.content)).toMatchObject({ locked: true, businessName: "Locked Stores" });
  });

  it("restores with the right password only, and the new phone remembers it", async () => {
    const platform = await shop();
    await setBackupPassword(platform, "kano-2026!");
    const backup = await exportBackup(platform, { vendorPublicKeyHex });

    const phone = await nodePlatform("another-phone");
    await expect(restoreBackup(phone, backup.content)).rejects.toBeInstanceOf(BackupPasswordNeeded);
    await expect(restoreBackup(phone, backup.content, "wrong-pass")).rejects.toThrow("not right");
    expect(await loadSettings(phone)).toBeNull();

    await restoreBackup(phone, backup.content, "kano-2026!");
    expect((await readModel.customers(phone.db, "")).map((customer) => customer.name)).toEqual(["Mama Tunde"]);
    // The restored phone can back up straight away with the same password.
    const again = await exportBackup(phone, { vendorPublicKeyHex });
    await restoreBackup(await nodePlatform("third-phone"), again.content, "kano-2026!");
  });

  it("can be opened by the vendor's licence key if the password is lost", async () => {
    const platform = await shop();
    await setBackupPassword(platform, "forgotten-pass");
    const backup = await exportBackup(platform, { vendorPublicKeyHex });
    const file = JSON.parse(backup.content);
    const contents = JSON.parse(unlockWithVendorKey(file.locked, vendorSecret));
    expect(JSON.stringify(contents.tables.rows)).toContain("Mama Tunde");
    expect(() => unlockWithVendorKey(file.locked, randomBytes(32).toString("hex"))).toThrow("not locked with your licence key");
  });

  it("still restores old unlocked backups", async () => {
    const platform = await shop();
    const tables: Record<string, unknown[]> = {};
    for (const table of ["kv", "rows", "shifts", "sales"]) tables[table] = await platform.db.all(`SELECT * FROM ${table}`);
    const oldFile = JSON.stringify({ format: "naijapos-tablet-backup", version: 1, exportedAt: "2026-09-01T00:00:00.000Z", tables });
    expect(inspectBackup(oldFile).locked).toBe(false);
    const phone = await nodePlatform("old-file-phone");
    await restoreBackup(phone, oldFile);
    expect((await loadSettings(phone))?.tenantName).toBe("Locked Stores");
  });
});
