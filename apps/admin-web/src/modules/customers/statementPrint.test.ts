import { describe, expect, it } from "vitest";
import { statementHtml } from "./statementPrint";

const money = (amount: number) => `NGN ${amount.toLocaleString("en-NG")}`;

describe("customer statement print", () => {
  it("shows the balance brought forward, each movement, the balance due and its age", () => {
    const html = statementHtml(
      {
        from: "2026-10-01",
        to: "2026-10-31",
        customer: { id: "c1", name: "Nneka Foods <Ltd>", phone: "0803", email: "", creditLimit: 250000, outstandingBalance: 125000 },
        openingBalance: 100000,
        lines: [
          { date: "2026-10-05T10:00:00Z", type: "payment", description: "Payment received: Transfer", debit: 0, credit: 40000, balance: 60000 },
          { date: "2026-10-20T10:00:00Z", type: "credit_sale", description: "Credit sale: INV-9", debit: 65000, credit: 0, balance: 125000 }
        ],
        closingBalance: 125000,
        ageing: { current: 65000, days31to60: 60000, days61to90: 0, over90: 0 }
      },
      { businessName: "Busy Mart", address: "12 Allen Avenue, Ikeja", phone: "0801", taxId: "TIN-1" },
      money
    );
    for (const text of ["STATEMENT OF ACCOUNT", "Busy Mart", "Nneka Foods &lt;Ltd&gt;", "01-10-2026 to 31-10-2026", "Balance brought forward", "NGN 100,000", "Payment received: Transfer", "NGN 40,000", "Balance due", "NGN 125,000", "NGN 60,000", "TIN-1"]) {
      expect(html).toContain(text);
    }
  });
});
