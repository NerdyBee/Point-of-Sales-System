import request from "supertest";
import { describe, expect, it } from "vitest";
import { createApp } from "../../app";

const app = createApp();
const post = (path: string, body: object, role = "owner") =>
  request(app).post(`/api/v1/imports/${path}`).set("x-tenant-id", "tenant-lagos-foods").set("x-role", role).set("x-user-id", "LCF-MAI-ADA").send({ branchId: "branch-lagos-main", ...body });

describe("spreadsheet imports", () => {
  it("previews products without saving, then saves them", async () => {
    const rows = [
      { "Item name": "Imported Zobo 50cl", Category: "Imported Drinks", "Selling price": "700", Cost: "350", Qty: "48" },
      { "Item name": "Signature Jollof Rice", Category: "Meals", "Selling price": "9000", SKU: "MEAL-JOLLOF" },
      { "Item name": "Broken", "Selling price": "x" }
    ];
    const preview = await post("products", { rows });
    expect(preview.status).toBe(200);
    expect(preview.body).toMatchObject({ committed: false, created: 1, updated: 1, skipped: 1 });
    expect(preview.body.rows[0].warnings).toContain('New category "Imported Drinks" will be added');
    expect(preview.body.rows[2].errors).toContain("Category is missing");

    const products = async () => (await request(app).get("/api/v1/catalog/products?branchId=branch-lagos-main").set("x-tenant-id", "tenant-lagos-foods").set("x-role", "owner").set("x-user-id", "LCF-MAI-ADA")).body.products as { name: string; price: number; stock: number; sku: string; image: string }[];
    expect((await products()).some((product) => product.name === "Imported Zobo 50cl")).toBe(false);

    const saved = await post("products", { rows, commit: true });
    expect(saved.body).toMatchObject({ committed: true, created: 1, updated: 1, skipped: 1 });
    const after = await products();
    const zobo = after.find((product) => product.name === "Imported Zobo 50cl")!;
    expect(zobo).toMatchObject({ price: 700, stock: 48, image: "/uploads/products/no-image.svg" });
    expect(zobo.sku).toMatch(/^IMP-\d{4}$/);
    expect(after.find((product) => product.sku === "MEAL-JOLLOF")!.price).toBe(9000);
  });

  it("creates customers with an opening balance that ages from its date", async () => {
    const rows = [{ Customer: "Import Traders Ltd", Phone: "08099990001", "Credit limit": "500000", "Opening balance": "120000", "Owed since": "2026-01-15" }];
    const saved = await post("customers", { rows, commit: true });
    expect(saved.body).toMatchObject({ created: 1, skipped: 0 });
    const debtors = await request(app).get("/api/v1/accounts/debtors").set("x-tenant-id", "tenant-lagos-foods").set("x-role", "owner").set("x-user-id", "LCF-MAI-ADA");
    const row = debtors.body.rows.find((item: { name: string }) => item.name === "Import Traders Ltd");
    expect(row.total).toBe(120000);
    expect(row.buckets.over90).toBe(120000);

    const again = await post("customers", { rows });
    expect(again.body.rows[0]).toMatchObject({ action: "update", warnings: ["Already a customer: opening balance not added (record a credit sale instead)"] });
  });

  it("records what is owed to existing suppliers and refuses unknown ones", async () => {
    const rows = [
      { Supplier: "Mainland Fresh Foods", "Invoice no": "OB-001", "Invoice date": "30/09/2026", Amount: "80000" },
      { Supplier: "Nobody Ltd", "Invoice no": "OB-002", "Invoice date": "30/09/2026", Amount: "1000" }
    ];
    const saved = await post("supplier-balances", { rows, commit: true });
    expect(saved.body).toMatchObject({ created: 1, skipped: 1 });
    expect(saved.body.rows[1].errors[0]).toMatch(/No supplier called "Nobody Ltd"/);
    expect((await post("supplier-balances", { rows: rows.slice(0, 1) })).body.rows[0].errors[0]).toMatch(/already recorded/);
  });

  it("needs the right permission", async () => {
    expect((await post("products", { rows: [{ name: "x" }] }, "cashier")).status).toBe(403);
  });
});
