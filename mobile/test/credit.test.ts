import { describe, expect, it } from "vitest";
import { readModel } from "../src/data/readModel";
import { createCustomer, currentShift, daySummary, openShift, recordSale, requestCloseShift } from "../src/pos/actions";
import { calculateSale } from "../src/pos/pricing";
import { buildReceiptText, receiptFromSale } from "../src/print/receipt";
import { loadSettings, saveSettings } from "../src/sync/settings";
import { createStandaloneBusiness, ensureStandaloneUpgrades, listCustomers, saveCustomer, saveProduct, voidSale } from "../src/standalone/business";
import { availableCredit, customerLedger, debtorsSummary, receivePayment, statementText } from "../src/standalone/credit";
import { nodePlatform } from "./nodePlatform";

async function shop() {
  const platform = await nodePlatform();
  const { owner } = await createStandaloneBusiness(platform, {
    businessName: "Credit Corner",
    currency: "NGN",
    vatPercent: 0,
    serviceChargePercent: 0,
    ownerName: "Femi Ade",
    ownerPin: "602731"
  });
  const settings = (await loadSettings(platform))!;
  const tenant = (await readModel.tenant(platform.db, settings.tenantId))!;
  const rice = await saveProduct(platform, { name: "Rice", category: "Groceries", price: 10000, stock: 50 });
  await openShift(platform, owner, 5000);
  const sell = (quantity: number, payments: { method: "cash" | "card" | "customer_credit"; amount: number; reference?: string }[], customer?: Awaited<ReturnType<typeof saveCustomer>> | null) => {
    const cart = [{ product: rice, quantity, discount: 0 }];
    expect(calculateSale(cart, tenant.settings).total).toBe(quantity * 10000);
    return recordSale(platform, { settings, tenantSettings: tenant.settings, staff: owner, cart, customer, payments });
  };
  const customer = async (id: string) => (await listCustomers(platform)).find((item) => item.id === id)!;
  return { platform, owner, settings, tenant, sell, customer };
}

describe("selling on credit", () => {
  it("only sells on credit to registered customers with a credit account, within their limit", async () => {
    const { platform, owner, sell, customer } = await shop();
    const walkIn = await saveCustomer(platform, { name: "Walk In", phone: "08010000000" });
    const trader = await saveCustomer(platform, { name: "Mama Tunde", phone: "08020000000", group: "Credit account", creditLimit: 50000 });

    await expect(sell(1, [{ method: "customer_credit", amount: 10000 }])).rejects.toThrow("registered customer");
    await expect(sell(1, [{ method: "customer_credit", amount: 10000 }], walkIn)).rejects.toThrow("does not have a credit account");

    const first = await sell(3, [{ method: "customer_credit", amount: 30000 }], trader);
    expect(first.record.credit).toEqual({ amount: 30000, balanceAfter: 30000, limit: 50000 });
    expect(availableCredit(await customer(trader.id))).toBe(20000);

    // Over the limit: refused, and nothing is saved (no sale, no stock taken, no ledger entry).
    await expect(sell(3, [{ method: "customer_credit", amount: 30000 }], trader)).rejects.toThrow("Credit limit exceeded");
    expect((await readModel.products(platform.db, (await loadSettings(platform))!.branchId))[0].stock).toBe(47);
    expect(await customerLedger(platform, trader.id)).toHaveLength(1);

    // Part payment: 10,000 cash now, 20,000 on account (exactly the remaining limit).
    const split = await sell(3, [{ method: "cash", amount: 10000 }, { method: "customer_credit", amount: 20000 }], trader);
    expect(split.record.credit).toMatchObject({ amount: 20000, balanceAfter: 50000 });
    expect((await currentShift(platform))?.cashSales).toBe(10000);
    expect(await debtorsSummary(platform)).toEqual({ owed: 50000, debtors: 1, accounts: 1 });
    expect((await daySummary(platform)).byMethod).toEqual({ customer_credit: 50000, cash: 10000 });

    const receipt = buildReceiptText(receiptFromSale({ number: split.number, createdAt: split.createdAt }, split.record, (await readModel.tenant(platform.db, (await loadSettings(platform))!.tenantId))!.settings));
    expect(receipt).toContain("On account: N20,000");
    expect(receipt).toContain("Account balance: N50,000");
    expect(owner.id).toBeTruthy();
  });

  it("does not offer credit on server-connected devices or to unsynced customers", async () => {
    const { platform, owner, settings, tenant, sell } = await shop();
    const placeholder = await createCustomer(platform, owner, { name: "Temp", phone: "08030000000" });
    expect(placeholder.id.startsWith("cust-")).toBe(true);
    await saveSettings(platform, { ...settings, mode: "local" });
    const cart = [{ product: (await readModel.products(platform.db, settings.branchId))[0], quantity: 1, discount: 0 }];
    await expect(recordSale(platform, { settings: { ...settings, mode: "local" }, tenantSettings: tenant.settings, staff: owner, cart, customer: placeholder, payments: [{ method: "customer_credit", amount: 10000 }] })).rejects.toThrow("web app");
    await saveSettings(platform, settings);
    expect(sell).toBeTruthy();
  });
});

describe("customer payments and statements", () => {
  it("records payments, counts cash in the drawer and keeps a running statement", async () => {
    const { platform, owner, sell, customer, tenant } = await shop();
    const trader = await saveCustomer(platform, { name: "Mama Tunde", phone: "08020000000", creditLimit: 100000 });
    await sell(4, [{ method: "customer_credit", amount: 40000 }], trader);

    await expect(receivePayment(platform, { customerId: trader.id, amount: 0, method: "cash", staffId: owner.id })).rejects.toThrow("amount");
    await expect(receivePayment(platform, { customerId: trader.id, amount: 50000, method: "cash", staffId: owner.id })).rejects.toThrow("owes 40,000");
    await expect(receivePayment(platform, { customerId: trader.id, amount: 5000, method: "bank_transfer", staffId: owner.id })).rejects.toThrow("reference");

    await receivePayment(platform, { customerId: trader.id, amount: 15000, method: "cash", staffId: owner.id });
    await receivePayment(platform, { customerId: trader.id, amount: 5000, method: "bank_transfer", reference: "TRF-88", note: "Part payment", staffId: owner.id });

    expect((await customer(trader.id)).outstandingBalance).toBe(20000);
    const shift = (await currentShift(platform))!;
    expect(shift.cashIn).toBe(15000);
    const closed = await requestCloseShift(platform, owner, 20000);
    expect(closed.expected).toBe(5000 + 15000); // float + cash received on account (the sale itself was on credit)

    const ledger = await customerLedger(platform, trader.id);
    expect(ledger.map((entry) => [entry.type, entry.amount, entry.balanceAfter])).toEqual([
      ["credit_sale", 40000, 40000],
      ["payment", -15000, 25000],
      ["payment", -5000, 20000]
    ]);
    expect(ledger[2]).toMatchObject({ paymentMethod: "bank_transfer", paymentReference: "TRF-88", note: "Part payment" });

    const text = statementText({ businessName: tenant.settings.businessName, customer: await customer(trader.id), entries: ledger, money: (amount) => `N${amount}` });
    expect(text).toContain("Account statement: Mama Tunde");
    expect(text).toContain("Balance owed: N20000");
  });

  it("refuses cash payments without an open register", async () => {
    const { platform, owner, sell } = await shop();
    const trader = await saveCustomer(platform, { name: "Ade", phone: "08040000000", creditLimit: 20000 });
    await sell(1, [{ method: "customer_credit", amount: 10000 }], trader);
    await requestCloseShift(platform, owner, 5000);
    await expect(receivePayment(platform, { customerId: trader.id, amount: 1000, method: "cash", staffId: owner.id })).rejects.toThrow("Open the register");
    await receivePayment(platform, { customerId: trader.id, amount: 1000, method: "card", reference: "POS-1", staffId: owner.id });
  });

  it("voiding a credit sale takes it off the customer's account", async () => {
    const { platform, owner, sell, customer } = await shop();
    const trader = await saveCustomer(platform, { name: "Bisi", phone: "08050000000", creditLimit: 30000 });
    const sale = await sell(2, [{ method: "cash", amount: 5000 }, { method: "customer_credit", amount: 15000 }], trader);
    await voidSale(platform, sale.id, owner.id, "Customer returned goods");
    expect((await customer(trader.id)).outstandingBalance).toBe(0);
    expect((await customerLedger(platform, trader.id)).map((entry) => [entry.type, entry.amount, entry.balanceAfter])).toEqual([
      ["credit_sale", 15000, 15000],
      ["credit_void", -15000, 0]
    ]);
    expect((await currentShift(platform))?.cashSales).toBe(0);
  });

  it("upgrades roles on devices set up before credit existed", async () => {
    const { platform } = await shop();
    await platform.db.run("DELETE FROM rows WHERE tbl = 'access_role_permissions' AND id LIKE '%customer.credit' OR (tbl = 'access_role_permissions' AND id LIKE '%manager|%sale.void')");
    await platform.db.run("DELETE FROM rows WHERE tbl = 'access_permissions' AND json_extract(data, '$.action') = 'customer.credit'");
    expect((await readModel.permissionsForRole(platform.db, "owner")).has("customer.credit")).toBe(false);
    await ensureStandaloneUpgrades(platform);
    await ensureStandaloneUpgrades(platform);
    expect((await readModel.permissionsForRole(platform.db, "owner")).has("customer.credit")).toBe(true);
    const manager = await readModel.permissionsForRole(platform.db, "manager");
    expect(manager.has("customer.credit") && manager.has("sale.void")).toBe(true);
    expect((await readModel.permissionsForRole(platform.db, "cashier")).has("customer.credit")).toBe(false);
  });
});
