import { describe, expect, it } from "vitest";
import { taxReturn, taxReturnCsv } from "./taxReturn";
import { buildVouchers, defaultLedgers, type SaleInput, type VoucherInput } from "./vouchers";

const sale = (id: string, total: number, vat: number): SaleInput => ({
  id,
  branchId: "b1",
  createdAt: "2026-10-05T10:00:00",
  summary: { subtotal: total - vat, discount: 0, serviceCharge: 0, vat, total },
  payments: [{ method: "cash", amount: total }]
});

const data: Omit<VoucherInput, "ledgers"> = {
  branchName: () => "Main",
  sales: [sale("S1", 10750, 750), sale("S2", 21500, 1500), sale("S3", 5000, 0)],
  returns: [{ saleId: "S2", kind: "refund", amount: 10750, at: "2026-10-06T10:00:00", sale: sale("S2", 21500, 1500) }],
  customerPayments: [],
  purchases: [{ id: "P1", branchId: "b1", supplierName: "Valley Farms", invoiceNumber: "VF-9", amount: 107500, vat: 7500, date: "2026-10-03T00:00:00" }],
  supplierPayments: [{ id: "PAY1", branchId: "b1", supplierName: "Valley Farms", invoiceNumber: "VF-9", amount: 100000, method: "bank_transfer", reference: "TRF-1", withholdingTax: 5000, at: "2026-10-20T10:00:00" }],
  expenses: [{ id: "E1", branchId: "b1", category: "Rent", description: "Shop rent", vendor: "Landlord Ltd", amount: 200000, vat: 0, withholdingTax: 20000, method: "bank_transfer", at: "2026-10-01T09:00:00" }]
};

describe("VAT return", () => {
  const result = taxReturn(data);

  it("nets output VAT (less refunds) against input VAT", () => {
    expect(result.vat.sales).toEqual({ count: 3, vatableValue: 30000, nonVatValue: 5000, vat: 2250 });
    expect(result.vat.returns).toEqual({ count: 1, value: 10000, vat: 750 });
    expect(result.vat.outputVat).toBe(1500);
    expect(result.vat.inputVat).toBe(7500);
    expect(result.vat.netVat).toBe(-6000);
  });

  it("lists withholding tax kept back from suppliers and vendors", () => {
    expect(result.withholding.rows.map((row) => [row.payee, row.gross, row.withheld, row.paid])).toEqual([
      ["Landlord Ltd", 200000, 20000, 180000],
      ["Valley Farms", 100000, 5000, 95000]
    ]);
    expect(result.withholding.total).toBe(25000);
  });

  it("writes a CSV", () => {
    const csv = taxReturnCsv(result, { from: "2026-10-01", to: "2026-10-31", amount: (value) => value.toFixed(2), branchName: () => "Main" });
    expect(csv).toContain("Output VAT,,1500.00");
    expect(csv).toContain("VAT credit carried forward,,6000.00");
    expect(csv).toContain("2026-10-20,Valley Farms,\"Invoice VF-9, TRF-1\",Main,100000.00,5000.00,95000.00");
  });
});

describe("vouchers with input VAT and withholding tax", () => {
  const vouchers = buildVouchers({ ...data, ledgers: defaultLedgers });
  const find = (number: string) => vouchers.find((voucher) => voucher.number === number)!;

  it("balances every voucher", () => {
    for (const voucher of vouchers) expect(voucher.lines.reduce((sum, line) => sum + line.amount, 0)).toBe(0);
  });

  it("splits input VAT out of purchases and books WHT as owed to the tax office", () => {
    expect(find("VF-9").lines).toEqual(expect.arrayContaining([{ ledger: "Purchase Account", amount: 100000 }, { ledger: "Input VAT", amount: 7500 }, { ledger: "Valley Farms", amount: -107500 }]));
    expect(find("PAY1").lines).toEqual(expect.arrayContaining([{ ledger: "Valley Farms", amount: 100000 }, { ledger: "Bank Account", amount: -95000 }, { ledger: "WHT Payable", amount: -5000 }]));
    expect(find("E1").lines).toEqual(expect.arrayContaining([{ ledger: "Rent", amount: 200000 }, { ledger: "Bank Account", amount: -180000 }, { ledger: "WHT Payable", amount: -20000 }]));
  });
});
