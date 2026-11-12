import { describe, expect, it } from "vitest";
import { creditorRows, debtorRow, openItems, reconciled, statement, type LedgerEntry } from "./ageing";

const now = new Date("2026-11-12T12:00:00Z");
const daysAgo = (days: number) => new Date(now.getTime() - days * 86_400_000).toISOString();
const entry = (id: string, days: number, balanceAfter: number, type = "credit_sale", note = ""): LedgerEntry => ({ id, type, note, balanceAfter, createdAt: daysAgo(days) });

describe("debtor ageing", () => {
  // Credit sales 100 days, 45 days and 10 days ago; one payment 20 days ago.
  const entries = [
    entry("a", 100, 30000, "credit_sale", "INV-1"),
    entry("b", 45, 50000, "credit_sale", "INV-2"),
    entry("c", 20, 35000, "payment", "Cash"),
    entry("d", 10, 47000, "credit_sale", "INV-3")
  ];

  it("lets payments settle the oldest credit first", () => {
    const items = openItems(entries, now);
    expect(items.map((item) => [item.note, item.amount, item.days])).toEqual([
      ["INV-1", 15000, 100],
      ["INV-2", 20000, 45],
      ["INV-3", 12000, 10]
    ]);
  });

  it("puts what is owed into age buckets", () => {
    const row = debtorRow({ id: "c1", name: "Sunrise Cafe", phone: "0800", creditLimit: 100000 }, entries, now)!;
    expect(row.total).toBe(47000);
    expect(row.buckets).toEqual({ current: 12000, days31to60: 20000, days61to90: 0, over90: 15000 });
    expect(row.oldestDays).toBe(100);
  });

  it("leaves out customers who owe nothing", () => {
    expect(debtorRow({ id: "c2", name: "Paid Up", phone: "", creditLimit: 0 }, [entry("x", 5, 9000), entry("y", 2, 0, "payment")], now)).toBeNull();
  });
});

describe("creditor ageing", () => {
  it("ages unpaid invoices from their due date, by supplier", () => {
    const rows = creditorRows([
      { id: "1", branchId: "b", supplierId: "s1", supplierName: "Valley Farms", invoiceNumber: "VF-1", invoiceDate: daysAgo(50), dueDate: daysAgo(20), balanceDue: 80000 },
      { id: "2", branchId: "b", supplierId: "s1", supplierName: "Valley Farms", invoiceNumber: "VF-2", invoiceDate: daysAgo(5), dueDate: daysAgo(-25), balanceDue: 40000 },
      { id: "3", branchId: "b", supplierId: "s2", supplierName: "Metro Wholesale", invoiceNumber: "MW-9", invoiceDate: daysAgo(120), balanceDue: 15000 },
      { id: "4", branchId: "b", supplierId: "s2", supplierName: "Metro Wholesale", invoiceNumber: "MW-10", invoiceDate: daysAgo(3), balanceDue: 0 }
    ], now);
    expect(rows.map((row) => [row.name, row.total])).toEqual([["Valley Farms", 120000], ["Metro Wholesale", 15000]]);
    expect(rows[0].buckets).toEqual({ notDue: 40000, current: 80000, days31to60: 0, days61to90: 0, over90: 0 });
    expect(rows[1].buckets.over90).toBe(15000);
    expect(rows[1].invoices).toHaveLength(1);
  });
});

describe("customer statement", () => {
  it("brings the balance forward and lists the period's movements", () => {
    const entries = [entry("a", 40, 30000, "credit_sale", "INV-1"), entry("b", 10, 10000, "payment", "Transfer"), entry("c", 5, 25000, "credit_sale", "INV-2")];
    const result = statement(entries, new Date(daysAgo(30)), now);
    expect(result.openingBalance).toBe(30000);
    expect(result.lines.map((line) => [line.description, line.debit, line.credit, line.balance])).toEqual([
      ["Payment received: Transfer", 0, 20000, 10000],
      ["Credit sale: INV-2", 15000, 0, 25000]
    ]);
    expect(result.closingBalance).toBe(25000);
  });
});

describe("reconciling with the customer's balance", () => {
  it("turns a balance with no entries into a balance brought forward", () => {
    const entries = reconciled([], 125000, daysAgo(70), now);
    expect(debtorRow({ id: "c3", name: "Nneka", phone: "", creditLimit: 0 }, entries, now)!.buckets.days61to90).toBe(125000);
  });

  it("leaves matching entries alone", () => {
    const entries = [entry("a", 3, 5000)];
    expect(reconciled(entries, 5000, daysAgo(10), now)).toBe(entries);
  });
});
