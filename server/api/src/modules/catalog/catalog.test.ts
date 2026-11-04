import request from "supertest";
import { describe, expect, it } from "vitest";
import { createApp } from "../../app";

const app = createApp();

function addProduct(fields: Record<string, unknown>) {
  return request(app)
    .post("/api/v1/catalog/products")
    .set("x-tenant-id", "tenant-lagos-foods")
    .set("x-role", "owner")
    .set("x-user-id", "LCF-MAI-ADA")
    .send({
      branchId: "branch-lagos-main",
      name: "Blouse",
      category: "Retail",
      price: 250,
      cost: 300,
      taxRate: 0.105,
      image: "/uploads/products/transfer-source-rice.png",
      stock: 20,
      reorderPoint: 10,
      station: "Counter",
      modifiers: [],
      ...fields
    });
}

describe("adding products", () => {
  it("creates the SKU from the category, and uses it as the barcode, when both are blank", async () => {
    const first = await addProduct({ sku: "", barcode: "" });
    const second = await addProduct({ name: "Blouse (blue)" });

    expect(first.status).toBe(201);
    expect(first.body.product.sku).toMatch(/^RET-\d{4}$/);
    expect(first.body.product.barcode).toBe(first.body.product.sku);
    expect(second.status).toBe(201);
    expect(second.body.product.sku).not.toBe(first.body.product.sku);
  });

  it("accepts short codes of the shop's own", async () => {
    const response = await addProduct({ name: "Wrapper", sku: "001", barcode: "001" });
    expect(response.status).toBe(201);
    expect(response.body.product.sku).toBe("001");
  });

  it("names the field that is wrong", async () => {
    const response = await addProduct({ name: "B" });
    expect(response.status).toBe(400);
    expect(response.body.issues.fieldErrors.name[0]).toBe("Enter a product name (at least 2 characters)");
  });
});
