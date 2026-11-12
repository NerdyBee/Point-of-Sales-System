import { describe, expect, it } from "vitest";
import { dayBookCsv, decimalAmount, tallyLedgersXml, tallyVouchersXml } from "./formats";
import { buildVouchers, defaultLedgers, ledgersUsed, type SaleInput, type VoucherInput } from "./vouchers";

const day = "2026-11-10T10:00:00";
const sale = (id: string, summary: Partial<SaleInput["summary"]>, payments: SaleInput["payments"], extra: Partial<SaleInput> = {}): SaleInput => ({
  id,
  branchId: "b1",
  createdAt: day,
  summary: { subtotal: 0, discount: 0, serviceCharge: 0, vat: 0, total: 0, ...summary },
  payments,
  ...extra
});

function input(overrides: Partial<VoucherInput>): VoucherInput {
  return { ledgers: defaultLedgers, branchName: () => "Main", sales: [], returns: [], customerPayments: [], purchases: [], supplierPayments: [], expenses: [], ...overrides };
}

const balance = (lines: { amount: number }[]) => lines.reduce((sum, line) => sum + line.amount, 0);
const line = (voucher: { lines: { ledger: string; amount: number }[] }, ledger: string) => voucher.lines.find((item) => item.ledger === ledger)?.amount ?? 0;

describe("accounting vouchers", () => {
  // 10,000 subtotal, 500 discount, 7.5% VAT on 9,500 = 712.50 (rounded 713), total 10,213.
  const cashSale = sale("INV-1", { subtotal: 10000, discount: 500, vat: 713, total: 10213 }, [{ method: "cash", amount: 11000 }]);
  const cardSale = sale("INV-2", { subtotal: 4000, serviceCharge: 200, vat: 315, total: 4515 }, [{ method: "card", amount: 4515 }]);

  it("books a day's walk-in sales as one balanced voucher per branch", () => {
    const [voucher] = buildVouchers(input({ sales: [cashSale, cardSale] }));
    expect(voucher).toMatchObject({ type: "Sales", date: "2026-11-10", number: "POS-20261110-MAIN" });
    expect(balance(voucher.lines)).toBe(0);
    expect(line(voucher, "Cash")).toBe(10213); // 11,000 tendered less 787 change
    expect(line(voucher, "POS Card Account")).toBe(4515);
    expect(line(voucher, "Discount Allowed")).toBe(500);
    expect(line(voucher, "Output VAT")).toBe(-1028);
    expect(line(voucher, "Service Charge")).toBe(-200);
    expect(line(voucher, "Sales Account")).toBe(-14000);
  });

  it("books each credit sale to the customer's own ledger", () => {
    const credit = sale("INV-3", { subtotal: 20000, vat: 1500, total: 21500 }, [{ method: "cash", amount: 5000 }, { method: "customer_credit", amount: 16500 }], { customerName: "Sunrise Cafe" });
    const [voucher] = buildVouchers(input({ sales: [credit] }));
    expect(voucher).toMatchObject({ type: "Sales", number: "INV-3", party: "Sunrise Cafe" });
    expect(line(voucher, "Sunrise Cafe")).toBe(16500);
    expect(line(voucher, "Cash")).toBe(5000);
    expect(balance(voucher.lines)).toBe(0);

    const [shared] = buildVouchers(input({ sales: [credit], ledgers: { ...defaultLedgers, customerLedger: "shared" } }));
    expect(shared.party).toBe("Sundry Debtors (POS)");
  });

  it("turns refunds and voids into credit notes on their own day, reversing VAT in proportion", () => {
    const vouchers = buildVouchers(input({
      returns: [
        { saleId: "INV-1", kind: "refund", amount: 5106, at: "2026-11-12T09:00:00", sale: cashSale },
        { saleId: "INV-2", kind: "void", amount: 4515, at: "2026-11-12T11:00:00", sale: cardSale }
      ]
    }));
    const [refund, voided] = [vouchers.find((item) => item.number === "RFD-INV-1")!, vouchers.find((item) => item.number === "VOID-INV-2")!];
    expect(refund).toMatchObject({ type: "Credit Note", date: "2026-11-12", party: "Cash" });
    expect(line(refund, "Output VAT")).toBe(356); // 713 x 5106/10213 = 356.46
    expect(line(refund, "Cash")).toBe(-5106);
    expect(balance(refund.lines)).toBe(0);
    expect(line(voided, "POS Card Account")).toBe(-4515);
    expect(line(voided, "Sales Returns")).toBe(4000);
    expect(balance(voided.lines)).toBe(0);
  });

  it("books customer payments, supplier invoices and payments, and expenses", () => {
    const vouchers = buildVouchers(input({
      customerPayments: [{ id: "LED-1", branchId: "b1", customerName: "Sunrise Cafe", amount: 8000, at: day, note: "Part payment" }],
      purchases: [{ id: "SI-1", branchId: "b1", supplierName: "Valley Farms", invoiceNumber: "VF-2201", amount: 150000, date: day }],
      supplierPayments: [{ id: "SP-1", branchId: "b1", supplierName: "Valley Farms", invoiceNumber: "VF-2201", amount: 100000, method: "bank_transfer", reference: "TRF 88", at: day }],
      expenses: [{ id: "EXP-1", branchId: "b1", category: "Utilities", description: "Electricity bill", vendor: "City Power", amount: 18450, method: "cash", at: day }]
    }));
    for (const voucher of vouchers) expect(balance(voucher.lines)).toBe(0);
    expect(vouchers.find((item) => item.type === "Receipt")!.lines).toEqual([{ ledger: "Cash", amount: 8000 }, { ledger: "Sunrise Cafe", amount: -8000 }]);
    expect(vouchers.find((item) => item.type === "Purchase")!.lines).toEqual([{ ledger: "Purchase Account", amount: 150000 }, { ledger: "Valley Farms", amount: -150000 }]);
    expect(vouchers.find((item) => item.number === "SP-1")!.lines).toEqual([{ ledger: "Valley Farms", amount: 100000 }, { ledger: "Bank Account", amount: -100000 }]);
    expect(vouchers.find((item) => item.number === "EXP-1")!.lines).toEqual([{ ledger: "Utilities", amount: 18450 }, { ledger: "Cash", amount: -18450 }]);

    const groups = ledgersUsed(vouchers, defaultLedgers, ["Utilities"]);
    expect(groups.get("Sunrise Cafe")).toBe("Sundry Debtors");
    expect(groups.get("Valley Farms")).toBe("Sundry Creditors");
    expect(groups.get("Utilities")).toBe("Indirect Expenses");
    expect(groups.get("Bank Account")).toBe("Bank Accounts");
  });

  it("writes Tally XML with Tally's signs, and a CSV day book", () => {
    const vouchers = buildVouchers(input({ sales: [cardSale] }));
    const tally = tallyVouchersXml(vouchers, { company: "Bella & Co", decimals: 2 });
    expect(tally).toContain("<SVCURRENTCOMPANY>Bella &amp; Co</SVCURRENTCOMPANY>");
    expect(tally).toMatch(/<LEDGERNAME>POS Card Account<\/LEDGERNAME>\s*<ISDEEMEDPOSITIVE>Yes<\/ISDEEMEDPOSITIVE>\s*<AMOUNT>-45\.15<\/AMOUNT>/);
    expect(tally).toMatch(/<LEDGERNAME>Sales Account<\/LEDGERNAME>\s*<ISDEEMEDPOSITIVE>No<\/ISDEEMEDPOSITIVE>\s*<AMOUNT>40\.00<\/AMOUNT>/);
    expect(tallyLedgersXml(new Map([["Output VAT", "Duties & Taxes"]]))).toContain("<PARENT>Duties &amp; Taxes</PARENT>");

    const csv = dayBookCsv(vouchers, { decimals: 0, branchName: () => "Main" });
    expect(csv.split("\r\n")[0]).toBe("Date,Voucher type,Voucher no.,Branch,Ledger,Debit,Credit,Narration");
    expect(csv).toContain("2026-11-10,Sales,POS-20261110-MAIN,Main,POS Card Account,4515.00,,");
    expect(decimalAmount(1234567, 0)).toBe("1234567.00");
  });
});
