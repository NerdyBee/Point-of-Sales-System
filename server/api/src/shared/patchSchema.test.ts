import { customerInputSchema, patchSchema, productInputSchema, staffInputSchema } from "@pos/validation";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { createApp } from "../app";
import { customers, demoProducts } from "./data/demoStore";

const app = createApp();
const owner = (method: "patch", path: string) => request(app)[method](path).set("x-tenant-id", "tenant-lagos-foods").set("x-role", "owner").set("x-user-id", "LCF-MAI-ADA");

// Zod 4's .partial() fills in defaults for fields an edit leaves out; edits must not reset them.
describe("edits only change the fields sent", () => {
  it("adds no defaults", () => {
    expect(patchSchema(productInputSchema).parse({ price: 5 })).toEqual({ price: 5 });
    expect(patchSchema(customerInputSchema).parse({ name: "Ada Bello" })).toEqual({ name: "Ada Bello" });
    expect(patchSchema(staffInputSchema).parse({ name: "New Name" })).toEqual({ name: "New Name" });
    expect(patchSchema(productInputSchema).safeParse({ price: -1 }).success).toBe(false);
  });

  it("keeps a product's modifiers when only the price changes", async () => {
    const response = await owner("patch", "/api/v1/catalog/products/p1").set("x-branch-id", "branch-lagos-main").send({ price: 8800 });
    expect(response.status).toBe(200);
    expect(demoProducts.find((product) => product.id === "p1")).toMatchObject({ price: 8800, modifiers: ["Extra plantain", "No pepper", "Grilled chicken"] });
  });

  it("keeps a customer's loyalty points when only the name changes", async () => {
    const response = await owner("patch", "/api/v1/customers/cust-1").send({ name: "Amina Bello-Okafor" });
    expect(response.status).toBe(200);
    expect(customers.find((customer) => customer.id === "cust-1")).toMatchObject({ name: "Amina Bello-Okafor", loyaltyPoints: 2480 });
  });
});
