import { describe, expect, it } from "vitest";
import { customerRows, parseDate, parseMoney, productRows, supplierBalanceRows } from "./importRows";

describe("spreadsheet values", () => {
  it("reads money with currency signs and commas", () => {
    expect(parseMoney("₦1,500.50", 2)).toBe(150050);
    expect(parseMoney("3500", 0)).toBe(3500);
    expect(parseMoney("", 0)).toBeNull();
    expect(parseMoney("-5", 0)).toBe("invalid");
  });

  it("reads ISO, day-first and Excel dates", () => {
    expect(parseDate("2026-10-05")).toBe("2026-10-05");
    expect(parseDate("05/10/2026")).toBe("2026-10-05");
    expect(parseDate("46300")).toBe("2026-10-05");
    expect(parseDate("31/02/2026")).toBe("invalid");
  });
});

describe("product rows", () => {
  it("matches loose headers and fills defaults", () => {
    const [row] = productRows([{ "Item Name": "Golden Penny Semovita 2kg", Category: "Groceries", "Selling Price (₦)": "3,500", "Cost Price": 2900, Qty: "40", "VAT %": "7.5" }], 0);
    expect(row.errors).toEqual([]);
    expect(row.data).toEqual({ name: "Golden Penny Semovita 2kg", category: "Groceries", price: 3500, cost: 2900, stock: 40, reorderPoint: 0, sku: "", barcode: "", taxRate: 0.075, station: "Counter" });
  });

  it("explains what is wrong, with the spreadsheet row number", () => {
    const rows = productRows([{ name: "A", price: "abc" }, { name: "Rice", category: "Food", price: "100", sku: "R1" }, { name: "Rice 2", category: "Food", price: "100", sku: "r1" }], 0);
    expect(rows[0]).toEqual({ row: 2, errors: ["Name is missing", "Category is missing", "Price is not a number"] });
    expect(rows[1].errors).toEqual([]);
    expect(rows[2].errors).toEqual(["SKU r1 is also on row 3"]);
  });
});

describe("customer rows", () => {
  it("reads opening balances with the date they were owed from", () => {
    const [row] = customerRows([{ Customer: "Nneka Foods", Phone: "0803 333 3333", "Amount owed": "125,000", "Owed since": "01/08/2026", "Credit limit": "250000" }], 0);
    expect(row.data).toMatchObject({ name: "Nneka Foods", phone: "08033333333", openingBalance: 125000, balanceDate: "2026-08-01", creditLimit: 250000, group: "Credit account" });
  });

  it("flags repeated phone numbers", () => {
    const rows = customerRows([{ name: "Ada", phone: "08011112222" }, { name: "Ade", phone: "08011112222" }], 0);
    expect(rows[1].errors).toEqual(["Phone 08011112222 is also on row 2"]);
  });
});

describe("supplier balance rows", () => {
  it("needs a supplier, invoice number, date and amount", () => {
    const [good, bad] = supplierBalanceRows([{ Supplier: "Valley Farms", "Invoice No": "VF-1", Date: "2026-09-30", Amount: "80000", VAT: "5581" }, { Supplier: "X" }], 0);
    expect(good.data).toEqual({ supplier: "Valley Farms", invoiceNumber: "VF-1", invoiceDate: "2026-09-30", dueDate: null, amount: 80000, vatAmount: 5581, note: "" });
    expect(bad.errors).toEqual(["Supplier is missing", "Invoice number is missing", "Invoice date is missing", "Amount is missing"]);
  });
});
