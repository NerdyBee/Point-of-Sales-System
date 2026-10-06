import { describe, expect, it } from "vitest";
import { verifyPin } from "../src/auth/pin";
import { readModel } from "../src/data/readModel";
import { createCustomer, currentShift, openShift, pendingStockDeductions, recentSales, recordSale, requestCloseShift } from "../src/pos/actions";
import { calculateSale } from "../src/pos/pricing";
import { SyncEngine, pairServer } from "../src/sync/engine";
import { loadSettings, saveSettings } from "../src/sync/settings";
import { nodePlatform } from "./nodePlatform";

/**
 * Runs the tablet core against real servers. Start an office API, create a device
 * pairing code for a terminal, then:
 *
 *   NAIJAPOS_OFFICE_URL=http://127.0.0.1:4200 NAIJAPOS_OFFICE_CODE=ABCD-EFGH \
 *   [NAIJAPOS_CLOUD_URL=... NAIJAPOS_CLOUD_CODE=...] npx vitest run test/e2e.test.ts
 */
const officeUrl = process.env.NAIJAPOS_OFFICE_URL;
const officeCode = process.env.NAIJAPOS_OFFICE_CODE;
const cloudUrl = process.env.NAIJAPOS_CLOUD_URL;
const cloudCode = process.env.NAIJAPOS_CLOUD_CODE;
const staffId = process.env.NAIJAPOS_STAFF_ID ?? "LCF-MAI-ADA";
const pin = process.env.NAIJAPOS_PIN ?? "123456";

const settle = () => new Promise((resolve) => setTimeout(resolve, 6500)); // server feed settle window is 5s

describe.skipIf(!officeUrl || !officeCode)("tablet <-> office server (live)", () => {
  it("works offline-first: opens a shift, sells, creates a customer and reconciles with the server", { timeout: 120_000 }, async () => {
    const platform = await nodePlatform();
    const mode = cloudUrl && cloudCode ? "hybrid" : "local";
    const settings = await pairServer(platform, { server: "local", url: officeUrl!, pairingCode: officeCode!, mode });
    if (mode === "hybrid") await pairServer(platform, { server: "cloud", url: cloudUrl!, pairingCode: cloudCode!, mode });

    const engine = new SyncEngine(platform);
    const first = await engine.syncNow();
    expect(first.lastError).toBeUndefined();

    const tenant = await readModel.tenant(platform.db, settings.tenantId);
    expect(tenant?.settings.businessName).toBeTruthy();
    const products = (await readModel.products(platform.db, settings.branchId)).filter((product) => product.category.toLowerCase() !== "services");
    expect(products.length).toBeGreaterThan(1);
    expect(await readModel.signInStaff(platform.db)).not.toHaveLength(0);
    const staffRow = await readModel.staff(platform.db, staffId);
    expect(staffRow).not.toBeNull();
    expect(staffRow).not.toHaveProperty("passwordHash");

    expect((await verifyPin(platform, staffId, "000000")).ok).toBe(false);
    const login = await verifyPin(platform, staffId, pin);
    expect(login.ok).toBe(true);
    if (!login.ok) return;
    const staff = login.staff;

    if (!(await currentShift(platform))) await openShift(platform, staff, 5000);

    const customer = await createCustomer(platform, staff, { name: "Tablet Walk-in", phone: `080${Date.now().toString().slice(-8)}` });
    const [first1, second] = products;
    const stockBefore = { [first1.id]: first1.stock, [second.id]: second.stock };
    const cart = [{ product: first1, quantity: 2, discount: 0 }];
    const total = calculateSale(cart, tenant!.settings).total;
    const cashSale = await recordSale(platform, { settings, tenantSettings: tenant!.settings, staff, cart, payments: [{ method: "cash", amount: total }], customer });

    const cardCart = [{ product: second, quantity: 1, discount: 0 }];
    const cardTotal = calculateSale(cardCart, tenant!.settings).total;
    await recordSale(platform, { settings, tenantSettings: tenant!.settings, staff, cart: cardCart, payments: [{ method: "card", amount: cardTotal, reference: "POS-REF-1" }] });

    expect((await pendingStockDeductions(platform)).get(first1.id)).toBe(2);

    const pushed = await engine.syncNow();
    expect(pushed.pending).toBe(0);
    expect(pushed.conflicts).toBe(0);
    const synced = await recentSales(platform);
    expect(synced.find((sale) => sale.id === cashSale.id)?.serverId).toMatch(/^INV-/);

    await settle();
    await engine.syncNow();
    expect(await pendingStockDeductions(platform)).toEqual(new Map());
    const after = await readModel.products(platform.db, settings.branchId);
    expect(after.find((product) => product.id === first1.id)!.stock).toBe(stockBefore[first1.id] - 2);
    expect(after.find((product) => product.id === second.id)!.stock).toBe(stockBefore[second.id] - 1);
    const customers = await readModel.customers(platform.db, "Tablet Walk-in");
    expect(customers.some((row) => row.id.startsWith("local-"))).toBe(false);
    expect(customers.length).toBeGreaterThan(0);

    // Office goes away: sales keep working and queue up.
    const current = (await loadSettings(platform))!;
    const realUrl = current.servers.local!.url;
    await saveSettings(platform, { ...current, servers: { ...current.servers, local: { ...current.servers.local!, url: "http://127.0.0.1:9" } } });
    const offlineEngine = new SyncEngine(platform);
    await recordSale(platform, { settings, tenantSettings: tenant!.settings, staff, cart, payments: [{ method: "cash", amount: total }] });
    const offline = await offlineEngine.syncNow();
    expect(offline.pending).toBe(1); // the shift lives on the office server, so the sale waits for it
    expect(offline.reachable.local).toBe(false);

    await saveSettings(platform, { ...current, servers: { ...current.servers, local: { ...current.servers.local!, url: realUrl } } });
    const back = await new SyncEngine(platform).syncNow();
    expect(back.pending).toBe(0);

    await requestCloseShift(platform, staff, 5000 + total * 2, "end of test");
    const closed = await new SyncEngine(platform).syncNow();
    expect(closed.pending).toBe(0);
    expect(closed.conflicts).toBe(0);
  });
});
