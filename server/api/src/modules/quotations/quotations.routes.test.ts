import request from "supertest";
import { describe, expect, it } from "vitest";
import { createApp } from "../../app";

const app = createApp();
const as = (role = "owner") => ({
  get: (path: string) => request(app).get(`/api/v1/quotations${path}`).set("x-tenant-id", "tenant-lagos-foods").set("x-role", role).set("x-user-id", "LCF-MAI-ADA"),
  post: (path: string, body: object) => request(app).post(`/api/v1/quotations${path}`).set("x-tenant-id", "tenant-lagos-foods").set("x-role", role).set("x-user-id", "LCF-MAI-ADA").send(body)
});
const quote = (overrides: object = {}) => ({
  branchId: "branch-lagos-main",
  kind: "quotation",
  customerName: "Nneka Foods Ltd",
  customerPhone: "+2348033333333",
  validUntil: "2026-12-31",
  note: "Delivery within Lagos included",
  lines: [{ productId: "p1", quantity: 10, discount: 0 }],
  ...overrides
});

describe("quotations and proforma invoices", () => {
  it("prices a quotation like a sale and numbers it", async () => {
    const response = await as().post("", quote());
    expect(response.status).toBe(201);
    const { quotation } = response.body;
    expect(quotation.number).toMatch(/^QT-\d{6}$/);
    expect(quotation.status).toBe("open");
    expect(quotation.summary.subtotal).toBe(85000);
    expect(quotation.summary.lines[0].name).toBe("Signature Jollof Rice");
    expect(quotation.summary.total).toBe(quotation.summary.subtotal - quotation.summary.discount + quotation.summary.serviceCharge + quotation.summary.vat);

    const proforma = await as().post("", quote({ kind: "proforma" }));
    expect(proforma.body.quotation.number).toMatch(/^PF-\d{6}$/);
  });

  it("lists, finds and converts a quotation once", async () => {
    const created = (await as().post("", quote({ customerName: "Convert Me Ltd" }))).body.quotation;
    const list = await as().get("?search=convert");
    expect(list.body.quotations.map((item: { id: string }) => item.id)).toContain(created.id);
    expect((await as().get(`/${created.id}`)).body.quotation.number).toBe(created.number);

    const converted = await as().post(`/${created.id}/status`, { status: "converted", saleId: "sale-123" });
    expect(converted.body.quotation.status).toBe("converted");
    expect(converted.body.quotation.saleId).toBe("sale-123");
    expect((await as().post(`/${created.id}/status`, { status: "cancelled" })).status).toBe(409);
  });

  it("refuses unknown products, missing details and discounts from cashiers", async () => {
    expect((await as().post("", quote({ lines: [{ productId: "nope", quantity: 1, discount: 0 }] }))).status).toBe(400);
    expect((await as().post("", quote({ customerName: "" }))).status).toBe(400);
    expect((await as("cashier").post("", quote({ lines: [{ productId: "p1", quantity: 1, discount: 500 }] }))).status).toBe(403);
    expect((await as("cashier").post("", quote())).status).toBe(201);
  });

  it("never discounts an item below free", async () => {
    const { quotation } = (await as().post("", quote({ lines: [{ productId: "p1", quantity: 2, discount: 99_999_999 }] }))).body;
    expect(quotation.summary.discount).toBe(quotation.summary.subtotal);
    expect(quotation.summary.vat).toBe(0);
    expect(quotation.summary.total).toBe(quotation.summary.serviceCharge);
  });
});
