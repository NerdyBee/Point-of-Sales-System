import request from "supertest";
import { describe, expect, it } from "vitest";
import { createApp } from "../../app";

const app = createApp();
const today = new Date();
const day = (offset: number) => {
  const date = new Date(today.getFullYear(), today.getMonth(), today.getDate() + offset);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
};
const exportAs = (format: string, role = "owner") =>
  request(app)
    .get(`/api/v1/accounting/export?from=${day(-400)}&to=${day(1)}&format=${format}`)
    .set("x-tenant-id", "tenant-lagos-foods")
    .set("x-role", role)
    .set("x-user-id", "LCF-MAI-ADA");

describe("accountant export", () => {
  it("summarises the vouchers for the period", async () => {
    const response = await exportAs("summary");
    expect(response.status).toBe(200);
    expect(response.body.voucherCount).toBeGreaterThan(0);
    expect(response.body.ledgers.sales).toBe("Sales Account");
  });

  it("downloads Tally vouchers and ledgers, and a CSV day book", async () => {
    const vouchers = await exportAs("tally");
    expect(vouchers.headers["content-disposition"]).toMatch(/ajokepos-tally-vouchers-.*\.xml/);
    expect(vouchers.text).toContain("<REPORTNAME>Vouchers</REPORTNAME>");
    expect(vouchers.text).toContain("<VOUCHER VCHTYPE=");

    const ledgers = await exportAs("tally-ledgers");
    expect(ledgers.text).toContain("<REPORTNAME>All Masters</REPORTNAME>");
    expect(ledgers.text).toContain("<PARENT>Cash-in-Hand</PARENT>");

    const csv = await exportAs("csv");
    expect(csv.headers["content-type"]).toMatch(/text\/csv/);
    expect(csv.text).toContain("Date,Voucher type,Voucher no.,Branch,Ledger,Debit,Credit,Narration");
  });

  it("refuses bad dates and staff who cannot see profit", async () => {
    const backwards = await request(app).get(`/api/v1/accounting/export?from=${day(0)}&to=${day(-5)}`).set("x-tenant-id", "tenant-lagos-foods").set("x-role", "owner").set("x-user-id", "LCF-MAI-ADA");
    expect(backwards.status).toBe(400);
    expect((await exportAs("summary", "cashier")).status).toBe(403);
  });
});

describe("VAT and withholding tax return", () => {
  const taxReturn = (format = "summary", role = "owner") =>
    request(app).get(`/api/v1/accounting/tax-return?from=${day(-400)}&to=${day(1)}&format=${format}`).set("x-tenant-id", "tenant-lagos-foods").set("x-role", role).set("x-user-id", "LCF-MAI-ADA");

  it("returns output and input VAT and the WHT schedule", async () => {
    const response = await taxReturn();
    expect(response.status).toBe(200);
    expect(response.body.vat.netVat).toBe(response.body.vat.outputVat - response.body.vat.inputVat);
    expect(Array.isArray(response.body.withholding.rows)).toBe(true);
  });

  it("downloads a CSV, for owners and accountants only", async () => {
    const csv = await taxReturn("csv");
    expect(csv.headers["content-disposition"]).toMatch(/ajokepos-vat-wht-/);
    expect(csv.text).toContain("Output VAT");
    expect((await taxReturn("summary", "cashier")).status).toBe(403);
  });
});
