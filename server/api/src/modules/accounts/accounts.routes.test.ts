import request from "supertest";
import { describe, expect, it } from "vitest";
import { createApp } from "../../app";

const app = createApp();
const as = (path: string, role = "owner") => request(app).get(`/api/v1/accounts${path}`).set("x-tenant-id", "tenant-lagos-foods").set("x-role", role).set("x-user-id", "LCF-MAI-ADA");
const today = new Date();
const ymd = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;

describe("debtors, creditors and statements", () => {
  it("lists customers who owe, including balances with no ledger entries", async () => {
    const response = await as("/debtors");
    expect(response.status).toBe(200);
    const byName = Object.fromEntries(response.body.rows.map((row: { name: string; total: number }) => [row.name, row.total]));
    expect(byName["Kola Martins"]).toBe(38500);
    expect(byName["Nneka Foods Ltd"]).toBe(125000);
    expect(byName["Amina Bello"]).toBeUndefined();
  });

  it("lists suppliers owed", async () => {
    const response = await as("/creditors");
    expect(response.status).toBe(200);
    expect(Array.isArray(response.body.rows)).toBe(true);
  });

  it("produces a customer statement", async () => {
    const from = ymd(new Date(today.getFullYear() - 1, today.getMonth(), today.getDate()));
    const response = await as(`/customers/cust-2/statement?from=${from}&to=${ymd(today)}`);
    expect(response.status).toBe(200);
    expect(response.body.customer.name).toBe("Kola Martins");
    expect(response.body.closingBalance).toBe(38500);
    expect(response.body.lines.length).toBeGreaterThan(0);
    expect((await as(`/customers/nobody/statement?from=${from}&to=${ymd(today)}`)).status).toBe(404);
  });

  it("refuses cashiers and bad dates", async () => {
    expect((await as("/debtors", "cashier")).status).toBe(403);
    expect((await as("/customers/cust-2/statement?from=2026-02-01&to=2026-01-01")).status).toBe(400);
  });
});
