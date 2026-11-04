import request from "supertest";
import { describe, expect, it } from "vitest";
import { createApp } from "../../app";

const app = createApp();

describe("first-run setup", () => {
  it("reports that an installation with a business needs no setup", async () => {
    const response = await request(app).get("/api/v1/setup/status");
    expect(response.status).toBe(200);
    expect(response.body.needsSetup).toBe(false);
  });

  it("refuses to create a second business", async () => {
    const response = await request(app).post("/api/v1/setup").send({
      businessName: "Intruder Ltd",
      currency: "USD",
      vatPercent: 0,
      ownerName: "Someone Else",
      email: "x@example.com",
      password: "Password123!"
    });
    expect(response.status).toBe(409);
  });
});
