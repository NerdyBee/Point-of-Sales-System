import { describe, expect, it } from "vitest";
import { verifyPin } from "../src/auth/pin";
import { createStandaloneBusiness } from "../src/standalone/business";
import { nodePlatform } from "./nodePlatform";

describe("wrong-PIN lockout", () => {
  it("counts down tries, locks after 5, and survives an app restart", async () => {
    const platform = await nodePlatform();
    const { owner } = await createStandaloneBusiness(platform, { businessName: "Lock Shop", currency: "NGN", vatPercent: 0, serviceChargePercent: 0, ownerName: "Femi Ade", ownerPin: "602731" });

    expect(await verifyPin(platform, owner.id, "111222")).toEqual({ ok: false, reason: "Wrong PIN. 4 tries left before a 5-minute wait." });
    for (let attempt = 0; attempt < 3; attempt += 1) await verifyPin(platform, owner.id, "111222");
    expect(await verifyPin(platform, owner.id, "111222")).toMatchObject({ ok: false, reason: expect.stringContaining("Too many attempts") });

    // Even the right PIN is refused while locked; the lock is stored in the database, so a
    // restarted app (fresh module state, same database) still sees it.
    expect(await verifyPin(platform, owner.id, "602731")).toMatchObject({ ok: false, reason: expect.stringContaining("Try again in 5 minutes") });
    const row = await platform.db.first<{ value: string }>("SELECT value FROM kv WHERE key = ?", [`pin.failures.${owner.id}`]);
    expect(JSON.parse(row!.value).count).toBe(5);

    // Once the wait is over, the right PIN works and clears the count.
    await platform.db.run("UPDATE kv SET value = json_set(value, '$.lockedUntil', ?) WHERE key = ?", [Date.now() - 1000, `pin.failures.${owner.id}`]);
    expect(await verifyPin(platform, owner.id, "602731")).toMatchObject({ ok: true });
    expect(await platform.db.first("SELECT value FROM kv WHERE key = ?", [`pin.failures.${owner.id}`])).toBeNull();
  });
});
