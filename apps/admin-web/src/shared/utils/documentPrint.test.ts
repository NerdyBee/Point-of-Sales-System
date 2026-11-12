import { describe, expect, it } from "vitest";
import type { CompletedSale, Quotation } from "../api/client";
import { creditNoteHtml, quotationHtml } from "./documentPrint";

const money = (amount: number) => `NGN ${amount.toLocaleString("en-NG")}`;
const business = { businessName: "Busy Mart", address: "12 Allen Avenue, Ikeja", phone: "0801", taxId: "TIN-1" };
const lines = [
  { productId: "p1", name: "Semovita 2kg", quantity: 10, subtotal: 35000, discount: 1000, vat: 2550, total: 36550 },
  { productId: "p2", name: "Peak Milk <tin>", quantity: 2, subtotal: 3000, discount: 0, vat: 225, total: 3225 }
];
const summary = { lines, subtotal: 38000, discount: 1000, serviceCharge: 0, vat: 2775, total: 39775 };

describe("quotation and proforma print", () => {
  const quote: Quotation = {
    id: "q1", branchId: "b1", kind: "quotation", number: "QT-000007", status: "open", expired: false,
    customerId: "", customerName: "Nneka Foods Ltd", customerPhone: "0803", customerEmail: "", summary,
    validUntil: "2026-12-31T22:59:59.999Z", note: "Delivery included", saleId: "", createdBy: "u", createdAt: "2026-11-12T10:00:00Z", updatedAt: "2026-11-12T10:00:00Z"
  };

  it("lists the items with unit prices and totals", () => {
    const html = quotationHtml(quote, business, money);
    for (const text of ["QUOTATION", "QT-000007", "To: Nneka Foods Ltd", "Semovita 2kg", "NGN 3,500", "NGN 34,000", "Peak Milk &lt;tin&gt;", "VAT", "NGN 39,775", "Delivery included", "not an invoice"]) {
      expect(html).toContain(text);
    }
  });

  it("says a proforma is not a receipt", () => {
    const html = quotationHtml({ ...quote, kind: "proforma", number: "PF-000001" }, business, money);
    expect(html).toContain("PROFORMA INVOICE");
    expect(html).toContain("not a receipt");
  });
});

describe("credit note print", () => {
  const sale = { id: "SI0001", status: "partially_refunded", refundTotal: 7955, refundReason: "Damaged tin", summary: { ...summary, paid: 39775, balance: 0 }, createdAt: "2026-11-10T10:00:00Z", updatedAt: "2026-11-11T10:00:00Z", customer: { name: "Kola Martins", phone: "0802" } } as unknown as CompletedSale;

  it("credits part of an invoice with its share of VAT", () => {
    const html = creditNoteHtml(sale, business, money);
    for (const text of ["CREDIT NOTE", "CN-SI0001", "Against invoice", "Part refund against invoice SI0001", "VAT credited", "NGN 555", "NGN 7,400", "NGN 7,955", "Damaged tin", "Kola Martins"]) {
      expect(html).toContain(text);
    }
  });

  it("credits every line of a voided invoice", () => {
    const html = creditNoteHtml({ ...sale, status: "voided", voidReason: "Wrong customer" }, business, money);
    expect(html).toContain("Semovita 2kg");
    expect(html).toContain("NGN 39,775");
    expect(html).toContain("Wrong customer");
  });
});
