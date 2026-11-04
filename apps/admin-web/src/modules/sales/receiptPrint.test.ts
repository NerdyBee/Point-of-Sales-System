import { describe, expect, it } from "vitest";
import { receiptHtml, type PrintableReceipt } from "./receiptPrint";

// The Frutyz 'n' More sample receipt, in naira (whole units).
const line = (productId: string, name: string, price: number) => ({ productId, name, quantity: 1, subtotal: price, discount: 0, vat: 0, total: price });
const sale = {
  saleId: "SI04272410",
  terminalId: "till-1",
  cashierId: "FRU-MAJ-LOI",
  createdAt: "2026-11-04T13:44:58",
  summary: {
    lines: [line("a", "Fried Rice", 1850), line("b", "Take Away Pack", 350), line("c", "Moi Moi", 1300), line("d", "Delivery Citec", 500)],
    subtotal: 4000, discount: 0, serviceCharge: 0, vat: 0, total: 4000, paid: 4000, balance: 0
  },
  payments: [{ method: "cash", amount: 4000 }],
  receipt: {
    businessName: "Frutyz 'n' More", currency: "NGN", footer: "...the best or nothing", whatsappEnabled: false, printEnabled: true,
    address: "4, Citec Shopping Center, Citec Estate, Jabi-Airport Road, Mbora, Abuja", email: "frutyznmore@yahoo.com",
    website: "www.frutyznmore.com", phone: "08107615005, 08083094888", branchName: "Major Store", cashierName: "Lois"
  }
} as unknown as PrintableReceipt;

describe("printed receipt", () => {
  it("follows the familiar sales invoice layout", () => {
    const html = receiptHtml(sale);

    for (const text of ["SALES INVOICE", "MAJOR STORE", "(WALK-IN CUSTOMER)", "LOIS", "SI04272410", "04-11-2026 13:44:58", "FRIED RICE", "1,850.00", "TOTAL (4)", "4,000.00", "INVOICE BALANCE", "...the best or nothing", "frutyznmore@yahoo.com"]) {
      expect(html).toContain(text);
    }
    // Zero discount, service charge and VAT lines are left out.
    expect(html).not.toContain("SERVICE CHARGE");
    expect(html).not.toContain(">VAT<");
  });

  it("uses the shop's own heading and marks reprints", () => {
    const html = receiptHtml({ ...sale, label: "Reprint", receipt: { ...sale.receipt, title: "Receipt" } });
    expect(html).toContain("RECEIPT (REPRINT)");
  });
});
