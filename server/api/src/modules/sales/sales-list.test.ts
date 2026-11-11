import request from "supertest";
import { describe, expect, it } from "vitest";
import { createApp } from "../../app";
import { appendCompletedSale } from "../../shared/data/demoStore";

const app = createApp();
const list = (query: string) =>
  request(app).get(`/api/v1/sales${query}`).set("x-tenant-id", "tenant-lagos-foods").set("x-role", "owner").set("x-user-id", "LCF-MAI-ADA");

describe("sales list", () => {
  // A sale from today and one from 2024, outside the default 30 days.
  const sale = (id: string) =>
    appendCompletedSale({
      id,
      tenantId: "tenant-lagos-foods",
      branchId: "branch-lagos-main",
      terminalId: "terminal-web-1",
      shiftId: "shift-test",
      cashierId: "LCF-MAI-ADA",
      idempotencyKey: `key-${id}`,
      summary: { lines: [], subtotal: 1000, discount: 0, serviceCharge: 0, vat: 0, total: 1000, paid: 1000, balance: 0 },
      status: "completed",
      refundTotal: 0,
      receipt: { businessName: "Lagos Central Foods", currency: "NGN", footer: "", whatsappEnabled: false, printEnabled: false }
    });
  sale("INV-TODAY-0001");
  sale("INV-OLD-2024-0001").createdAt = "2024-03-02T10:00:00.000Z";

  it("returns the last 30 days by default, not all history", async () => {
    const response = await list("");
    expect(response.status).toBe(200);
    expect(response.body.from).toBeTruthy();
    const ids = response.body.sales.map((sale: { id: string }) => sale.id);
    expect(ids).toContain("INV-TODAY-0001");
    expect(ids).not.toContain("INV-OLD-2024-0001");
  });

  it("returns sales between the dates asked for", async () => {
    const response = await list("?from=2024-03-01&to=2024-03-31");
    expect(response.body.sales.map((sale: { id: string }) => sale.id)).toEqual(["INV-OLD-2024-0001"]);
  });

  it("finds a receipt number anywhere in history, matching from its start", async () => {
    const response = await list("?search=INV-OLD-2024");
    expect(response.body.sales.map((sale: { id: string }) => sale.id)).toEqual(["INV-OLD-2024-0001"]);
  });

  it("says when there are more sales than the limit", async () => {
    const response = await list("?from=2000-01-01&limit=1");
    expect(response.body.sales).toHaveLength(1);
    expect(response.body.limited).toBe(true);
  });
});
