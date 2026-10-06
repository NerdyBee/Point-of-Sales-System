import request from "supertest";
import { describe, expect, it } from "vitest";
import { createApp } from "./app";
import { appendAudit, appendCompletedSale, authSessions, branches, demoProducts, paymentRecords, prepTickets, registerShifts, staffMembers, stockMovements, terminals } from "./shared/data/demoStore";

const app = createApp();

async function applySaleActionApproval(input: { saleId: string; branchId?: string; type: "refund" | "void"; amount: number; reason: string }) {
  const branchId = input.branchId ?? "branch-lagos-main";
  const approvalResponse = await request(app)
    .post("/api/v1/approvals")
    .set("x-tenant-id", "tenant-lagos-foods")
    .set("x-branch-id", branchId)
    .set("x-role", "manager")
    .set("x-user-id", "manager-1")
    .send({
      branchId,
      type: input.type,
      entityType: "sale",
      entityId: input.saleId,
      amount: input.amount,
      reason: input.reason
    });
  const decisionResponse = await request(app)
    .patch(`/api/v1/approvals/${approvalResponse.body.approval.id}/decision`)
    .set("x-tenant-id", "tenant-lagos-foods")
    .set("x-branch-id", branchId)
    .set("x-role", "manager")
    .set("x-user-id", "manager-1")
    .send({ decision: "approved", note: `${input.type} approved` });
  const applyResponse = await request(app)
    .post(`/api/v1/approvals/${approvalResponse.body.approval.id}/apply`)
    .set("x-tenant-id", "tenant-lagos-foods")
    .set("x-branch-id", branchId)
    .set("x-role", "manager")
    .set("x-user-id", "manager-1")
    .send({
      entityType: "sale",
      entityId: input.saleId,
      type: input.type,
      amount: input.amount,
      note: `${input.type} applied`
    });

  expect(approvalResponse.status).toBe(201);
  expect(decisionResponse.status).toBe(200);
  expect(applyResponse.status).toBe(200);
  return approvalResponse.body.approval.id as string;
}

async function applySaleDraftDiscountApproval(input: { terminalId: string; branchId?: string; amount: number; reason: string }) {
  const branchId = input.branchId ?? "branch-lagos-main";
  const approvalResponse = await request(app)
    .post("/api/v1/approvals")
    .set("x-tenant-id", "tenant-lagos-foods")
    .set("x-branch-id", branchId)
    .set("x-role", "cashier")
    .set("x-user-id", "cashier-1")
    .send({
      branchId,
      type: "discount",
      entityType: "saleDraft",
      entityId: input.terminalId,
      amount: input.amount,
      reason: input.reason
    });
  const decisionResponse = await request(app)
    .patch(`/api/v1/approvals/${approvalResponse.body.approval.id}/decision`)
    .set("x-tenant-id", "tenant-lagos-foods")
    .set("x-branch-id", branchId)
    .set("x-role", "manager")
    .set("x-user-id", "manager-1")
    .send({ decision: "approved", note: "Discount approved" });
  const applyResponse = await request(app)
    .post(`/api/v1/approvals/${approvalResponse.body.approval.id}/apply`)
    .set("x-tenant-id", "tenant-lagos-foods")
    .set("x-branch-id", branchId)
    .set("x-role", "cashier")
    .set("x-user-id", "cashier-1")
    .send({
      entityType: "saleDraft",
      entityId: input.terminalId,
      type: "discount",
      amount: input.amount,
      note: input.reason
    });

  expect(approvalResponse.status).toBe(201);
  expect(decisionResponse.status).toBe(200);
  expect(applyResponse.status).toBe(200);
  return approvalResponse.body.approval.id as string;
}

async function applyRegisterCloseApproval(input: { shiftId: string; branchId?: string; amount: number; reason: string }) {
  const branchId = input.branchId ?? "branch-lagos-main";
  const approvalResponse = await request(app)
    .post("/api/v1/approvals")
    .set("x-tenant-id", "tenant-lagos-foods")
    .set("x-branch-id", branchId)
    .set("x-role", "manager")
    .set("x-user-id", "manager-1")
    .send({
      branchId,
      type: "register_close",
      entityType: "registerShift",
      entityId: input.shiftId,
      amount: input.amount,
      reason: input.reason
    });
  const decisionResponse = await request(app)
    .patch(`/api/v1/approvals/${approvalResponse.body.approval.id}/decision`)
    .set("x-tenant-id", "tenant-lagos-foods")
    .set("x-branch-id", branchId)
    .set("x-role", "manager")
    .set("x-user-id", "manager-1")
    .send({ decision: "approved", note: "Register close approved" });
  const applyResponse = await request(app)
    .post(`/api/v1/approvals/${approvalResponse.body.approval.id}/apply`)
    .set("x-tenant-id", "tenant-lagos-foods")
    .set("x-branch-id", branchId)
    .set("x-role", "manager")
    .set("x-user-id", "manager-1")
    .send({
      entityType: "registerShift",
      entityId: input.shiftId,
      type: "register_close",
      amount: input.amount,
      note: input.reason
    });

  expect(approvalResponse.status).toBe(201);
  expect(decisionResponse.status).toBe(200);
  expect(applyResponse.status).toBe(200);
  return approvalResponse.body.approval.id as string;
}

describe("api foundation", () => {
  it("requires tenant context for tenant-scoped routes", async () => {
    const response = await request(app).get("/api/v1/catalog/products");

    expect(response.status).toBe(401);
    expect(response.body.error).toBe("Tenant context is required");
  });

  it("requires a real user context for permission-protected actions", async () => {
    const response = await request(app)
      .post("/api/v1/catalog/products")
      .set("x-tenant-id", "tenant-lagos-foods")
      .set("x-branch-id", "branch-lagos-main")
      .set("x-role", "manager")
      .set("x-branch-id", "branch-lagos-main")
      .send({
        branchId: "branch-lagos-main",
        name: "Header Only Product",
        sku: "HDR-ONLY",
        barcode: "HDR-ONLY",
        category: "Meals",
        price: 1000,
        cost: 500,
        taxRate: 0.075,
        image: "/uploads/products/transfer-source-rice.png",
        stock: 1,
        reorderPoint: 1,
        station: "Counter",
        modifiers: []
      });

    expect(response.status).toBe(401);
    expect(response.body.error).toBe("Authenticated user context is required");
  });

  it("requires a real user context for sensitive read workflows", async () => {
    const response = await request(app)
      .get("/api/v1/sales?branchId=branch-lagos-main&status=all")
      .set("x-tenant-id", "tenant-lagos-foods")
      .set("x-branch-id", "branch-lagos-main")
      .set("x-role", "manager");

    expect(response.status).toBe(401);
    expect(response.body.error).toBe("Authenticated user context is required");
  });

  it("requires a real user context for tenant write workflows without dedicated permissions", async () => {
    const response = await request(app)
      .post("/api/v1/sync/queue")
      .set("x-tenant-id", "tenant-lagos-foods")
      .set("x-branch-id", "branch-lagos-main")
      .set("x-role", "cashier")
      .send({
        branchId: "branch-lagos-main",
        terminalId: "terminal-web-1",
        recordType: "sale",
        operation: "create",
        idempotencyKey: "header-only-sync-record",
        payload: { total: 1500 }
      });

    expect(response.status).toBe(401);
    expect(response.body.error).toBe("Authenticated user context is required");
  });

  it("uses the authenticated staff member as the approval requester", async () => {
    const response = await request(app)
      .post("/api/v1/approvals")
      .set("x-tenant-id", "tenant-lagos-foods")
      .set("x-branch-id", "branch-lagos-main")
      .set("x-role", "cashier")
      .set("x-user-id", "cashier-1")
      .send({
        branchId: "branch-lagos-main",
        type: "discount",
        entityType: "saleDraft",
        entityId: "terminal-web-1",
        amount: 1500,
        reason: "Requester spoof check",
        requestedBy: "manager-1"
      });

    expect(response.status).toBe(201);
    expect(response.body.approval).toMatchObject({ requestedBy: "cashier-1" });
  });

  it("filters products by tenant", async () => {
    const response = await request(app)
      .get("/api/v1/catalog/products")
      .set("x-tenant-id", "tenant-abuja-pharma")
      .set("x-role", "owner")
      .set("x-user-id", "LCF-MAI-ADA");

    expect(response.status).toBe(200);
    expect(response.body.products).toHaveLength(1);
    expect(response.body.products[0].name).toBe("Malaria Test Kit");
    expect(response.body.products[0].tenantId).toBe("tenant-abuja-pharma");
  });

  it("filters catalog products by branch when requested", async () => {
    const response = await request(app)
      .get("/api/v1/catalog/products?branchId=branch-lagos-main")
      .set("x-tenant-id", "tenant-lagos-foods")
      .set("x-branch-id", "branch-lagos-main")
      .set("x-role", "cashier")
      .set("x-user-id", "cashier-1");
    const otherBranchResponse = await request(app)
      .get("/api/v1/catalog/products?branchId=branch-lagos-ikeja")
      .set("x-tenant-id", "tenant-lagos-foods")
      .set("x-branch-id", "branch-lagos-ikeja")
      .set("x-role", "cashier")
      .set("x-user-id", "cashier-1");

    expect(response.status).toBe(200);
    expect(response.body.products.length).toBeGreaterThan(0);
    expect(response.body.products.every((product: { branchId: string }) => product.branchId === "branch-lagos-main")).toBe(true);
    expect(otherBranchResponse.status).toBe(200);
    expect(otherBranchResponse.body.products.every((product: { branchId: string }) => product.branchId === "branch-lagos-ikeja")).toBe(true);
  });

  it("lets city managers read catalog products across only branches in their city", async () => {
    if (!branches.some((branch) => branch.id === "branch-lagos-outside-city")) {
      branches.push({
        id: "branch-lagos-outside-city",
        tenantId: "tenant-lagos-foods",
        name: "Ibadan Road Test Branch",
        address: "1 Test Road",
        city: "Ibadan",
        phone: "+2348099990000",
        status: "active",
        createdAt: new Date().toISOString()
      });
    }

    const ikejaProductResponse = await request(app)
      .post("/api/v1/catalog/products")
      .set("x-tenant-id", "tenant-lagos-foods")
      .set("x-role", "owner")
      .set("x-user-id", "LCF-MAI-ADA")
      .send({
        branchId: "branch-lagos-ikeja",
        name: "City Scope Catalog Cake",
        sku: "CITY-SCOPE-CATALOG-CAKE",
        barcode: "2341000951",
        category: "Bakery",
        price: 4500,
        cost: 1800,
        taxRate: 0.075,
        image: "/uploads/products/city-scope-catalog-cake.png",
        stock: 12,
        reorderPoint: 3,
        station: "Kitchen",
        modifiers: []
      });
    const outsideProductResponse = await request(app)
      .post("/api/v1/catalog/products")
      .set("x-tenant-id", "tenant-lagos-foods")
      .set("x-role", "owner")
      .set("x-user-id", "LCF-MAI-ADA")
      .send({
        branchId: "branch-lagos-outside-city",
        name: "Outside Scope Catalog Cake",
        sku: "OUTSIDE-SCOPE-CATALOG-CAKE",
        barcode: "2341000952",
        category: "Bakery",
        price: 4500,
        cost: 1800,
        taxRate: 0.075,
        image: "/uploads/products/outside-scope-catalog-cake.png",
        stock: 12,
        reorderPoint: 3,
        station: "Kitchen",
        modifiers: []
      });
    const catalogResponse = await request(app)
      .get("/api/v1/catalog/products")
      .set("x-tenant-id", "tenant-lagos-foods")
      .set("x-role", "state_manager")
      .set("x-user-id", "LCF-MAI-TUN");
    const outsideResponse = await request(app)
      .get("/api/v1/catalog/products?branchId=branch-lagos-outside-city")
      .set("x-tenant-id", "tenant-lagos-foods")
      .set("x-role", "state_manager")
      .set("x-user-id", "LCF-MAI-TUN");

    expect(ikejaProductResponse.status).toBe(201);
    expect(outsideProductResponse.status).toBe(201);
    expect(catalogResponse.status).toBe(200);
    expect(catalogResponse.body.products.some((product: { id: string }) => product.id === ikejaProductResponse.body.product.id)).toBe(true);
    expect(catalogResponse.body.products.some((product: { id: string }) => product.id === outsideProductResponse.body.product.id)).toBe(false);
    expect(outsideResponse.status).toBe(403);
  });

  it("blocks staff without POS, catalog, inventory, or floor permissions from catalog reads", async () => {
    const response = await request(app)
      .get("/api/v1/catalog/products?branchId=branch-lagos-main")
      .set("x-tenant-id", "tenant-lagos-foods")
      .set("x-branch-id", "branch-lagos-main")
      .set("x-role", "kitchen")
      .set("x-user-id", "kitchen-1");

    expect(response.status).toBe(403);
    expect(response.body).toMatchObject({ error: "Permission denied", permission: "sale.create" });
  });

  it("does not seed opening stock movements for service products", async () => {
    const response = await request(app)
      .get("/api/v1/inventory/stock?branchId=branch-lagos-main")
      .set("x-tenant-id", "tenant-lagos-foods")
      .set("x-branch-id", "branch-lagos-main")
      .set("x-role", "manager")
      .set("x-user-id", "manager-1");

    expect(response.status).toBe(200);
    expect(response.body.products.filter((product: { category: string }) => product.category === "Services")).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ stock: 0, reorderPoint: 0 })
      ])
    );
    expect(response.body.movements.some((movement: { productId: string }) => ["p28", "p29", "p30"].includes(movement.productId))).toBe(false);
  });

  it("blocks branch-scoped users from reading another branch", async () => {
    const catalogResponse = await request(app)
      .get("/api/v1/catalog/products?branchId=branch-lagos-ikeja")
      .set("x-tenant-id", "tenant-lagos-foods")
      .set("x-branch-id", "branch-lagos-main")
      .set("x-role", "cashier")
      .set("x-user-id", "cashier-1");
    const reportResponse = await request(app)
      .get("/api/v1/reports/dashboard?branchId=branch-lagos-ikeja")
      .set("x-tenant-id", "tenant-lagos-foods")
      .set("x-branch-id", "branch-lagos-main")
      .set("x-role", "manager")
      .set("x-user-id", "manager-1");

    expect(catalogResponse.status).toBe(403);
    expect(catalogResponse.body.error).toBe("Branch access denied");
    expect(reportResponse.status).toBe(403);
    expect(reportResponse.body.error).toBe("Branch access denied");
  });

  it("scopes cashier sales history to their own sales", async () => {
    const response = await request(app)
      .get("/api/v1/sales?branchId=branch-lagos-main&status=all")
      .set("x-tenant-id", "tenant-lagos-foods")
      .set("x-branch-id", "branch-lagos-main")
      .set("x-role", "cashier")
      .set("x-user-id", "cashier-1");

    expect(response.status).toBe(200);
    expect(response.body.sales.every((sale: { branchId: string; cashierId: string }) => sale.branchId === "branch-lagos-main" && sale.cashierId === "cashier-1")).toBe(true);
  });

  it("blocks non-sales staff from reading sales history", async () => {
    const response = await request(app)
      .get("/api/v1/sales?branchId=branch-lagos-main&status=all")
      .set("x-tenant-id", "tenant-lagos-foods")
      .set("x-branch-id", "branch-lagos-main")
      .set("x-role", "kitchen")
      .set("x-user-id", "kitchen-1");

    expect(response.status).toBe(403);
    expect(response.body).toMatchObject({ error: "Permission denied", permission: "sale.create" });
  });

  it("allows state managers to read across branches", async () => {
    const response = await request(app)
      .get("/api/v1/branches/options")
      .set("x-tenant-id", "tenant-lagos-foods")
      .set("x-role", "state_manager")
      .set("x-user-id", "state-manager-1");

    expect(response.status).toBe(200);
    expect(response.body.branches.length).toBeGreaterThan(1);
    expect(response.body.branches.every((branch: { city: string }) => branch.city === "Lagos")).toBe(true);
    expect(response.body.branches.some((branch: { id: string }) => branch.id === "branch-abuja-main")).toBe(false);
  });

  it("lets seeded state managers log in and keep cross-branch access", async () => {
    const loginResponse = await request(app)
      .post("/api/v1/auth/login")
      .send({
        tenantId: "tenant-lagos-foods",
        email: "tunde@example.com",
        password: "Password123!",
        terminalId: "terminal-web-1"
      });

    expect(loginResponse.status).toBe(200);
    expect(loginResponse.body.staff.role).toBe("state_manager");
    expect(loginResponse.body.staff.permissions).toContain("branch.manage");

    const branchResponse = await request(app)
      .get("/api/v1/branches/options")
      .set("authorization", `Bearer ${loginResponse.body.accessToken}`);

    expect(branchResponse.status).toBe(200);
    expect(branchResponse.body.branches.length).toBeGreaterThan(1);
    expect(branchResponse.body.branches.every((branch: { city: string }) => branch.city === "Lagos")).toBe(true);
  });

  it("allows owners to update tenant settings", async () => {
    const response = await request(app)
      .patch("/api/v1/tenants/current/settings")
      .set("x-tenant-id", "tenant-lagos-foods")
      .set("x-role", "owner")
      .set("x-user-id", "LCF-MAI-ADA")
      .send({
        businessName: "Lagos Central Foods HQ",
        taxId: "TIN-1029384756",
        defaultBranchId: "branch-lagos-main",
        defaultTaxRate: 0.075,
        currency: "NGN",
        productCategories: ["Meals", "Drinks", "Bakery", "Retail", "Pharmacy", "Services", "  Breakfast  "],
        receiptFooter: "Thank you for shopping with us.",
        whatsappReceipts: true,
        paymentMethods: { cash: true, card: true, bankTransfer: true, mobileMoney: false },
        hardware: { printer: "Epson TM-T20III", cashDrawer: true, barcodeScanner: true }
      });

    expect(response.status).toBe(200);
    expect(response.body.tenant.settings).toMatchObject({ businessName: "Lagos Central Foods HQ", currency: "NGN" });
    expect(response.body.tenant.settings.productCategories).toContain("Breakfast");
    expect(response.body.tenant.settings.productCategories).not.toContain("  Breakfast  ");
  });

  it("rejects tenant settings with duplicate categories after normalization", async () => {
    const response = await request(app)
      .patch("/api/v1/tenants/current/settings")
      .set("x-tenant-id", "tenant-lagos-foods")
      .set("x-role", "owner")
      .set("x-user-id", "LCF-MAI-ADA")
      .send({
        businessName: "Lagos Central Foods HQ",
        taxId: "TIN-1029384756",
        defaultBranchId: "branch-lagos-main",
        defaultTaxRate: 0.075,
        currency: "NGN",
        productCategories: ["Meals", " Meals ", "Bakery"],
        receiptFooter: "Thank you for shopping with us.",
        whatsappReceipts: true,
        paymentMethods: { cash: true, card: true, bankTransfer: true, mobileMoney: false },
        hardware: { printer: "Epson TM-T20III", cashDrawer: true, barcodeScanner: true }
      });

    expect(response.status).toBe(400);
    expect(response.body.issues.fieldErrors.productCategories).toContain("Product categories must be unique");
  });

  it("rejects tenant settings with no enabled payment methods", async () => {
    const response = await request(app)
      .patch("/api/v1/tenants/current/settings")
      .set("x-tenant-id", "tenant-lagos-foods")
      .set("x-role", "owner")
      .set("x-user-id", "LCF-MAI-ADA")
      .send({
        businessName: "Lagos Central Foods HQ",
        taxId: "TIN-1029384756",
        defaultBranchId: "branch-lagos-main",
        defaultTaxRate: 0.075,
        currency: "NGN",
        productCategories: ["Meals", "Drinks", "Bakery", "Retail", "Pharmacy", "Services"],
        receiptFooter: "Thank you for shopping with us.",
        whatsappReceipts: true,
        paymentMethods: { cash: false, card: false, bankTransfer: false, mobileMoney: false },
        hardware: { printer: "Epson TM-T20III", cashDrawer: true, barcodeScanner: true }
      });

    expect(response.status).toBe(400);
    expect(response.body.issues.fieldErrors.paymentMethods).toContain("At least one payment method must be enabled");
  });

  it("rejects tenant settings with an unknown default branch", async () => {
    const response = await request(app)
      .patch("/api/v1/tenants/current/settings")
      .set("x-tenant-id", "tenant-lagos-foods")
      .set("x-role", "owner")
      .set("x-user-id", "LCF-MAI-ADA")
      .send({
        businessName: "Lagos Central Foods HQ",
        taxId: "TIN-1029384756",
        defaultBranchId: "branch-missing",
        defaultTaxRate: 0.075,
        serviceChargeEnabled: true,
        serviceChargeRate: 0.05,
        currency: "NGN",
        productCategories: ["Meals", "Drinks", "Bakery", "Retail", "Pharmacy", "Services", "Breakfast"],
        receiptFooter: "Thank you for shopping with us.",
        whatsappReceipts: true,
        paymentMethods: { cash: true, card: true, bankTransfer: true, mobileMoney: false },
        hardware: { printer: "Epson TM-T20III", cashDrawer: true, barcodeScanner: true }
      });

    expect(response.status).toBe(409);
    expect(response.body.error).toBe("Default branch must exist for this tenant");
  });

  it("prevents removing product categories that existing products use", async () => {
    const response = await request(app)
      .patch("/api/v1/tenants/current/settings")
      .set("x-tenant-id", "tenant-lagos-foods")
      .set("x-role", "owner")
      .set("x-user-id", "LCF-MAI-ADA")
      .send({
        businessName: "Lagos Central Foods HQ",
        taxId: "TIN-1029384756",
        defaultBranchId: "branch-lagos-main",
        defaultTaxRate: 0.075,
        currency: "NGN",
        productCategories: ["Breakfast"],
        receiptFooter: "Thank you for shopping with us.",
        whatsappReceipts: true,
        paymentMethods: { cash: true, card: true, bankTransfer: true, mobileMoney: false },
        hardware: { printer: "Epson TM-T20III", cashDrawer: true, barcodeScanner: true }
      });

    expect(response.status).toBe(409);
    expect(response.body.error).toContain("Cannot remove categories used by products");
  });

  it("manages branches and provisioned terminals", async () => {
    const branchResponse = await request(app)
      .post("/api/v1/branches")
      .set("x-tenant-id", "tenant-lagos-foods")
      .set("x-role", "owner")
      .set("x-user-id", "LCF-MAI-ADA")
      .send({
        name: "Surulere Pickup",
        address: "7 Bode Thomas Street",
        city: "Lagos",
        phone: "+2348010000044",
        status: "active"
      });

    const terminalResponse = await request(app)
      .post("/api/v1/branches/terminals")
      .set("x-tenant-id", "tenant-lagos-foods")
      .set("x-branch-id", branchResponse.body.branch.id)
      .set("x-role", "owner")
      .set("x-user-id", "LCF-MAI-ADA")
      .send({
        branchId: branchResponse.body.branch.id,
        name: "Pickup Counter",
        deviceCode: "LAG-SURULERE-01",
        status: "online",
        appVersion: "1.0.1"
      });

    const listResponse = await request(app)
      .get("/api/v1/branches")
      .set("x-tenant-id", "tenant-lagos-foods")
      .set("x-role", "owner")
      .set("x-user-id", "LCF-MAI-ADA");
    const optionsResponse = await request(app)
      .get("/api/v1/branches/options")
      .set("x-tenant-id", "tenant-lagos-foods")
      .set("x-role", "owner")
      .set("x-user-id", "LCF-MAI-ADA");

    expect(branchResponse.status).toBe(201);
    expect(terminalResponse.status).toBe(201);
    expect(terminalResponse.body.terminal).toMatchObject({ branchId: branchResponse.body.branch.id, status: "online" });
    expect(listResponse.body.branches).toEqual(expect.arrayContaining([expect.objectContaining({ name: "Surulere Pickup" })]));
    expect(listResponse.body.terminals).toEqual(expect.arrayContaining([expect.objectContaining({ deviceCode: "LAG-SURULERE-01" })]));
    expect(optionsResponse.status).toBe(200);
    expect(optionsResponse.body.branches[0].address).toBeUndefined();
    expect(optionsResponse.body.terminals).toEqual(expect.arrayContaining([expect.objectContaining({ deviceCode: "LAG-SURULERE-01" })]));
  });

  it("blocks cashiers from full branch management reads but allows scoped branch options", async () => {
    const listResponse = await request(app)
      .get("/api/v1/branches?branchId=branch-lagos-main")
      .set("x-tenant-id", "tenant-lagos-foods")
      .set("x-branch-id", "branch-lagos-main")
      .set("x-role", "cashier")
      .set("x-user-id", "cashier-1");
    const optionsResponse = await request(app)
      .get("/api/v1/branches/options?branchId=branch-lagos-main")
      .set("x-tenant-id", "tenant-lagos-foods")
      .set("x-branch-id", "branch-lagos-main")
      .set("x-role", "cashier")
      .set("x-user-id", "cashier-1");

    expect(listResponse.status).toBe(403);
    expect(listResponse.body).toMatchObject({ error: "Permission denied", permission: "branch.manage" });
    expect(optionsResponse.status).toBe(200);
    expect(optionsResponse.body.branches.every((branch: { id: string }) => branch.id === "branch-lagos-main")).toBe(true);
  });

  it("keeps branch-scoped managers inside their terminal assignments", async () => {
    const branchCreateResponse = await request(app)
      .post("/api/v1/branches")
      .set("x-tenant-id", "tenant-lagos-foods")
      .set("x-branch-id", "branch-lagos-main")
      .set("x-role", "manager")
      .set("x-user-id", "manager-1")
      .send({
        name: "Manager Created Branch",
        address: "1 Branch Scope Road",
        city: "Lagos",
        phone: "+2348010000099",
        status: "active"
      });

    const noContextListResponse = await request(app)
      .get("/api/v1/branches?branchId=branch-lagos-main")
      .set("x-tenant-id", "tenant-lagos-foods")
      .set("x-role", "manager")
      .set("x-user-id", "manager-1");

    const noContextOptionsResponse = await request(app)
      .get("/api/v1/branches/options?branchId=branch-lagos-main")
      .set("x-tenant-id", "tenant-lagos-foods")
      .set("x-role", "manager")
      .set("x-user-id", "manager-1");

    const noContextBranchUpdateResponse = await request(app)
      .patch("/api/v1/branches/branch-lagos-main")
      .set("x-tenant-id", "tenant-lagos-foods")
      .set("x-role", "manager")
      .set("x-user-id", "manager-1")
      .send({ city: "Lagos" });

    const noContextCreateTerminalResponse = await request(app)
      .post("/api/v1/branches/terminals")
      .set("x-tenant-id", "tenant-lagos-foods")
      .set("x-role", "manager")
      .set("x-user-id", "manager-1")
      .send({
        branchId: "branch-lagos-main",
        name: "No Context POS",
        deviceCode: "LAG-NO-CONTEXT-01",
        status: "offline",
        appVersion: "1.0.1"
      });

    const noContextUpdateTerminalResponse = await request(app)
      .patch("/api/v1/branches/terminals/terminal-web-1")
      .set("x-tenant-id", "tenant-lagos-foods")
      .set("x-role", "manager")
      .set("x-user-id", "manager-1")
      .send({ status: "offline" });

    const terminalResponse = await request(app)
      .post("/api/v1/branches/terminals")
      .set("x-tenant-id", "tenant-lagos-foods")
      .set("x-branch-id", "branch-lagos-main")
      .set("x-role", "manager")
      .set("x-user-id", "manager-1")
      .send({
        branchId: "branch-lagos-main",
        name: "Scoped Manager POS",
        deviceCode: "LAG-SCOPED-MANAGER-01",
        status: "online",
        appVersion: "1.0.1"
      });

    const moveResponse = await request(app)
      .patch(`/api/v1/branches/terminals/${terminalResponse.body.terminal.id}`)
      .set("x-tenant-id", "tenant-lagos-foods")
      .set("x-branch-id", "branch-lagos-main")
      .set("x-role", "manager")
      .set("x-user-id", "manager-1")
      .send({ branchId: "branch-lagos-ikeja" });

    const wrongBranchUpdateResponse = await request(app)
      .patch(`/api/v1/branches/terminals/${terminalResponse.body.terminal.id}`)
      .set("x-tenant-id", "tenant-lagos-foods")
      .set("x-branch-id", "branch-lagos-ikeja")
      .set("x-role", "manager")
      .set("x-user-id", "manager-2")
      .send({ status: "offline" });

    expect(branchCreateResponse.status).toBe(403);
    expect(branchCreateResponse.body.error).toBe("Only all-branch administrators can create branches");
    expect(noContextListResponse.status).toBe(403);
    expect(noContextOptionsResponse.status).toBe(403);
    expect(noContextBranchUpdateResponse.status).toBe(403);
    expect(noContextCreateTerminalResponse.status).toBe(403);
    expect(noContextUpdateTerminalResponse.status).toBe(403);
    expect(noContextListResponse.body.error).toBe("Branch access denied");
    expect(terminalResponse.status).toBe(201);
    expect(moveResponse.status).toBe(403);
    expect(moveResponse.body.error).toBe("Branch access denied");
    expect(wrongBranchUpdateResponse.status).toBe(404);
    expect(wrongBranchUpdateResponse.body.error).toBe("Terminal not found");
  });

  it("protects branch dependencies and tenant plan limits", async () => {
    const defaultBranchResponse = await request(app)
      .patch("/api/v1/branches/branch-lagos-main")
      .set("x-tenant-id", "tenant-lagos-foods")
      .set("x-branch-id", "branch-lagos-main")
      .set("x-role", "manager")
      .set("x-user-id", "manager-1")
      .send({ status: "paused" });
    const pausedBranchTerminalResponse = await request(app)
      .post("/api/v1/branches/terminals")
      .set("x-tenant-id", "tenant-lagos-foods")
      .set("x-role", "owner")
      .set("x-user-id", "LCF-MAI-ADA")
      .send({
        branchId: "branch-lagos-lekki",
        name: "Paused Branch POS",
        deviceCode: "LAG-LEKKI-PAUSED-01",
        status: "online",
        appVersion: "1.0.1"
      });
    const firstAbujaBranch = await request(app)
      .post("/api/v1/branches")
      .set("x-tenant-id", "tenant-abuja-pharma")
      .set("x-role", "owner")
      .set("x-user-id", "LCF-MAI-ADA")
      .send({
        name: "Abuja Wuse",
        address: "9 Wuse Market Road",
        city: "Abuja",
        phone: "+2348020000001",
        status: "active"
      });
    const secondAbujaBranch = await request(app)
      .post("/api/v1/branches")
      .set("x-tenant-id", "tenant-abuja-pharma")
      .set("x-role", "owner")
      .set("x-user-id", "LCF-MAI-ADA")
      .send({
        name: "Abuja Garki",
        address: "14 Area 11",
        city: "Abuja",
        phone: "+2348020000002",
        status: "active"
      });
    const limitResponse = await request(app)
      .post("/api/v1/branches")
      .set("x-tenant-id", "tenant-abuja-pharma")
      .set("x-role", "owner")
      .set("x-user-id", "LCF-MAI-ADA")
      .send({
        name: "Abuja Maitama",
        address: "31 Aguiyi Ironsi Street",
        city: "Abuja",
        phone: "+2348020000003",
        status: "active"
      });

    expect(defaultBranchResponse.status).toBe(409);
    expect(defaultBranchResponse.body.error).toBe("Default branch cannot be paused");
    expect(pausedBranchTerminalResponse.status).toBe(409);
    expect(pausedBranchTerminalResponse.body.error).toBe("Online terminals require an active branch");
    expect(firstAbujaBranch.status).toBe(201);
    expect(secondAbujaBranch.status).toBe(201);
    expect(limitResponse.status).toBe(409);
    expect(limitResponse.body.error).toBe("Active branch limit reached for this tenant plan");
  });

  it("manages tenant subscriptions and billing invoices", async () => {
    const overviewResponse = await request(app)
      .get("/api/v1/subscriptions/current")
      .set("x-tenant-id", "tenant-lagos-foods")
      .set("x-role", "owner")
      .set("x-user-id", "LCF-MAI-ADA");
    const openInvoice = overviewResponse.body.invoices.find((invoice: { status: string }) => invoice.status === "open");
    const renewalDate = new Date(Date.now() + 1000 * 60 * 60 * 24 * 30).toISOString();
    const expectedUsage = {
      branches: branches.filter((branch) => branch.tenantId === "tenant-lagos-foods" && branch.status === "active").length,
      users: staffMembers.filter((member) => member.tenantId === "tenant-lagos-foods" && member.inviteStatus !== "revoked").length,
      terminals: terminals.filter((terminal) => terminal.tenantId === "tenant-lagos-foods").length
    };

    const updateResponse = await request(app)
      .patch("/api/v1/subscriptions/current")
      .set("x-tenant-id", "tenant-lagos-foods")
      .set("x-role", "owner")
      .set("x-user-id", "LCF-MAI-ADA")
      .send({
        plan: "Business",
        status: "active",
        billingEmail: "billing@lagoscentral.example",
        renewalDate,
        notes: "Downgraded after pilot branch cleanup"
    });
    const createInvoiceResponse = await request(app)
      .post("/api/v1/subscriptions/invoices")
      .set("x-tenant-id", "tenant-lagos-foods")
      .set("x-role", "owner")
      .set("x-user-id", "LCF-MAI-ADA")
      .send({
        plan: "Business",
        amount: 25000,
        status: "open",
        issuedAt: new Date("2026-07-29T09:00:00.000Z").toISOString(),
        dueAt: new Date("2026-08-05T09:00:00.000Z").toISOString()
      });
    const paidInvoiceWithoutReferenceResponse = await request(app)
      .post("/api/v1/subscriptions/invoices")
      .set("x-tenant-id", "tenant-lagos-foods")
      .set("x-role", "owner")
      .set("x-user-id", "LCF-MAI-ADA")
      .send({
        plan: "Business",
        amount: 25000,
        status: "paid",
        issuedAt: new Date("2026-07-29T09:00:00.000Z").toISOString(),
        dueAt: new Date("2026-08-05T09:00:00.000Z").toISOString()
      });
    const invoiceResponse = await request(app)
      .patch(`/api/v1/subscriptions/invoices/${openInvoice.id}`)
      .set("x-tenant-id", "tenant-lagos-foods")
      .set("x-role", "owner")
      .set("x-user-id", "LCF-MAI-ADA")
      .send({ status: "paid", paymentReference: "MANUAL-SUB-1002" });
    const finalizedInvoiceResponse = await request(app)
      .patch(`/api/v1/subscriptions/invoices/${openInvoice.id}`)
      .set("x-tenant-id", "tenant-lagos-foods")
      .set("x-role", "owner")
      .set("x-user-id", "LCF-MAI-ADA")
      .send({ status: "void" });
    const branchLimitResponse = await request(app)
      .post("/api/v1/branches")
      .set("x-tenant-id", "tenant-lagos-foods")
      .set("x-role", "owner")
      .set("x-user-id", "LCF-MAI-ADA")
      .send({
        name: "Business Limit Branch",
        address: "20 Marina Road",
        city: "Lagos",
        phone: "+2348010000066",
        status: "active"
      });
    const freeTrialLimitResponse = await request(app)
      .patch("/api/v1/subscriptions/current")
      .set("x-tenant-id", "tenant-lagos-foods")
      .set("x-role", "owner")
      .set("x-user-id", "LCF-MAI-ADA")
      .send({
        plan: "Free Trial",
        status: "active",
        billingEmail: "billing@lagoscentral.example",
        renewalDate
      });
    const terminalLimitResponse = await request(app)
      .post("/api/v1/branches/terminals")
      .set("x-tenant-id", "tenant-lagos-foods")
      .set("x-role", "owner")
      .set("x-user-id", "LCF-MAI-ADA")
      .send({
        branchId: "branch-lagos-main",
        name: "Trial Limit POS",
        deviceCode: "LAG-MAIN-TRIAL-LIMIT",
        status: "offline",
        appVersion: "1.0.0"
      });
    const userLimitResponse = await request(app)
      .post("/api/v1/staff")
      .set("x-tenant-id", "tenant-lagos-foods")
      .set("x-role", "owner")
      .set("x-user-id", "LCF-MAI-ADA")
      .send({
        branchId: "branch-lagos-main",
        name: "Trial Limit User",
        email: "trial-limit@example.com",
        phone: "+2348010000077",
        role: "cashier",
        pinEnabled: true,
        active: true
      });
    const restoreSubscriptionResponse = await request(app)
      .patch("/api/v1/subscriptions/current")
      .set("x-tenant-id", "tenant-lagos-foods")
      .set("x-role", "owner")
      .set("x-user-id", "LCF-MAI-ADA")
      .send({
        plan: "Professional",
        status: "active",
        billingEmail: "accounts@lagoscentral.example",
        renewalDate
      });

    expect(overviewResponse.status).toBe(200);
    expect(overviewResponse.body.subscription).toMatchObject({ plan: "Professional", status: "active" });
    expect(overviewResponse.body.usage).toEqual(expectedUsage);
    expect(updateResponse.status).toBe(200);
    expect(updateResponse.body.subscription).toMatchObject({ plan: "Business", branchLimit: 3, billingEmail: "billing@lagoscentral.example" });
    expect(createInvoiceResponse.status).toBe(201);
    expect(createInvoiceResponse.body.invoice).toMatchObject({
      plan: "Business",
      amount: 25000,
      status: "open",
      invoiceNumber: expect.stringMatching(/^SUB-LF-\d+$/)
    });
    expect(paidInvoiceWithoutReferenceResponse.status).toBe(400);
    expect(invoiceResponse.status).toBe(200);
    expect(invoiceResponse.body.invoice).toMatchObject({ id: openInvoice.id, status: "paid", paymentReference: "MANUAL-SUB-1002" });
    expect(finalizedInvoiceResponse.status).toBe(409);
    expect(finalizedInvoiceResponse.body.error).toBe("Paid or void subscription invoices cannot be changed");
    expect(branchLimitResponse.status).toBe(409);
    expect(branchLimitResponse.body.error).toBe("Active branch limit reached for this tenant plan");
    expect(freeTrialLimitResponse.status).toBe(200);
    expect(terminalLimitResponse.status).toBe(409);
    expect(terminalLimitResponse.body.error).toBe("Terminal limit reached for this tenant plan");
    expect(userLimitResponse.status).toBe(409);
    expect(userLimitResponse.body.error).toBe("User limit reached for this tenant plan");
    expect(restoreSubscriptionResponse.status).toBe(200);
  });

  it("queues offline sync records idempotently and lets managers resolve conflicts", async () => {
    const payload = {
      branchId: "branch-lagos-main",
      terminalId: "terminal-web-1",
      recordType: "sale",
      operation: "create",
      idempotencyKey: "terminal-web-1-offline-test-sale",
      payload: { total: 15200, lines: [{ productId: "p1", quantity: 1 }] }
    };

    const createResponse = await request(app)
      .post("/api/v1/sync/queue")
      .set("x-tenant-id", "tenant-lagos-foods")
      .set("x-branch-id", "branch-lagos-main")
      .set("x-role", "cashier")
      .set("x-user-id", "cashier-1")
      .send(payload);
    const replayResponse = await request(app)
      .post("/api/v1/sync/queue")
      .set("x-tenant-id", "tenant-lagos-foods")
      .set("x-branch-id", "branch-lagos-main")
      .set("x-role", "cashier")
      .set("x-user-id", "cashier-1")
      .send(payload);
    const listResponse = await request(app)
      .get("/api/v1/sync/queue?branchId=branch-lagos-main&status=all")
      .set("x-tenant-id", "tenant-lagos-foods")
      .set("x-branch-id", "branch-lagos-main")
      .set("x-role", "manager")
      .set("x-user-id", "manager-1");
    const today = new Date().toISOString().slice(0, 10);
    const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const dateRangeResponse = await request(app)
      .get(`/api/v1/sync/queue?branchId=branch-lagos-main&status=all&startDate=${today}&endDate=${today}`)
      .set("x-tenant-id", "tenant-lagos-foods")
      .set("x-branch-id", "branch-lagos-main")
      .set("x-role", "manager")
      .set("x-user-id", "manager-1");
    const invalidDateResponse = await request(app)
      .get("/api/v1/sync/queue?branchId=branch-lagos-main&startDate=not-a-date")
      .set("x-tenant-id", "tenant-lagos-foods")
      .set("x-branch-id", "branch-lagos-main")
      .set("x-role", "manager")
      .set("x-user-id", "manager-1");
    const invertedDateResponse = await request(app)
      .get(`/api/v1/sync/queue?branchId=branch-lagos-main&startDate=${tomorrow}&endDate=${today}`)
      .set("x-tenant-id", "tenant-lagos-foods")
      .set("x-branch-id", "branch-lagos-main")
      .set("x-role", "manager")
      .set("x-user-id", "manager-1");
    const conflictWithoutNoteResponse = await request(app)
      .patch(`/api/v1/sync/queue/${createResponse.body.record.id}/status`)
      .set("x-tenant-id", "tenant-lagos-foods")
      .set("x-branch-id", "branch-lagos-main")
      .set("x-role", "manager")
      .set("x-user-id", "manager-1")
      .send({ status: "conflict" });
    const syncedWithoutServerIdResponse = await request(app)
      .patch(`/api/v1/sync/queue/${createResponse.body.record.id}/status`)
      .set("x-tenant-id", "tenant-lagos-foods")
      .set("x-branch-id", "branch-lagos-main")
      .set("x-role", "manager")
      .set("x-user-id", "manager-1")
      .send({ status: "synced" });
    const conflictResponse = await request(app)
      .patch(`/api/v1/sync/queue/${createResponse.body.record.id}/status`)
      .set("x-tenant-id", "tenant-lagos-foods")
      .set("x-branch-id", "branch-lagos-main")
      .set("x-role", "manager")
      .set("x-user-id", "manager-1")
      .send({ status: "conflict", error: "Server record changed after offline capture" });
    const retryResponse = await request(app)
      .patch(`/api/v1/sync/queue/${createResponse.body.record.id}/status`)
      .set("x-tenant-id", "tenant-lagos-foods")
      .set("x-branch-id", "branch-lagos-main")
      .set("x-role", "manager")
      .set("x-user-id", "manager-1")
      .send({ status: "queued" });
    const resolvedResponse = await request(app)
      .patch(`/api/v1/sync/queue/${createResponse.body.record.id}/status`)
      .set("x-tenant-id", "tenant-lagos-foods")
      .set("x-branch-id", "branch-lagos-main")
      .set("x-role", "manager")
      .set("x-user-id", "manager-1")
      .send({ status: "synced", serverEntityId: "INV-OFFLINE-1" });
    const finalizedResponse = await request(app)
      .patch(`/api/v1/sync/queue/${createResponse.body.record.id}/status`)
      .set("x-tenant-id", "tenant-lagos-foods")
      .set("x-branch-id", "branch-lagos-main")
      .set("x-role", "manager")
      .set("x-user-id", "manager-1")
      .send({ status: "queued" });

    expect(createResponse.status).toBe(201);
    expect(createResponse.body.record).toMatchObject({ status: "queued", idempotencyKey: payload.idempotencyKey });
    expect(replayResponse.status).toBe(200);
    expect(replayResponse.body).toMatchObject({ status: "replayed", record: { id: createResponse.body.record.id } });
    expect(listResponse.body.records).toEqual(expect.arrayContaining([expect.objectContaining({ id: createResponse.body.record.id })]));
    expect(dateRangeResponse.status).toBe(200);
    expect(dateRangeResponse.body.records).toEqual(expect.arrayContaining([expect.objectContaining({ id: createResponse.body.record.id })]));
    expect(invalidDateResponse.status).toBe(400);
    expect(invertedDateResponse.status).toBe(400);
    expect(conflictWithoutNoteResponse.status).toBe(400);
    expect(syncedWithoutServerIdResponse.status).toBe(400);
    expect(conflictResponse.body.record).toMatchObject({ status: "conflict", error: "Server record changed after offline capture" });
    expect(retryResponse.body.record).toMatchObject({ status: "queued", attempts: 1 });
    expect(retryResponse.body.record.error).toBeUndefined();
    expect(resolvedResponse.body.record).toMatchObject({ status: "synced", serverEntityId: "INV-OFFLINE-1", syncedAt: expect.any(String) });
    expect(finalizedResponse.status).toBe(409);
    expect(finalizedResponse.body.error).toBe("Synced sync records cannot be changed");
  });

  it("blocks staff without sales or sync permissions from queueing offline records", async () => {
    const response = await request(app)
      .post("/api/v1/sync/queue")
      .set("x-tenant-id", "tenant-lagos-foods")
      .set("x-branch-id", "branch-lagos-main")
      .set("x-role", "kitchen")
      .set("x-user-id", "kitchen-1")
      .send({
        branchId: "branch-lagos-main",
        terminalId: "terminal-web-1",
        recordType: "sale",
        operation: "create",
        idempotencyKey: "kitchen-sync-block",
        payload: { total: 1000 }
      });

    expect(response.status).toBe(403);
    expect(response.body).toMatchObject({ error: "Permission denied", permission: "sale.create" });
  });

  it("rejects sync records for branches and terminals outside their tenant relationship", async () => {
    const invalidBranchResponse = await request(app)
      .post("/api/v1/sync/queue")
      .set("x-tenant-id", "tenant-lagos-foods")
      .set("x-role", "owner")
      .set("x-user-id", "LCF-MAI-ADA")
      .send({
        branchId: "branch-abuja-main",
        terminalId: "terminal-web-1",
        recordType: "sale",
        operation: "create",
        idempotencyKey: "invalid-sync-branch",
        payload: { total: 1500 }
      });

    const invalidTerminalResponse = await request(app)
      .post("/api/v1/sync/queue")
      .set("x-tenant-id", "tenant-lagos-foods")
      .set("x-role", "owner")
      .set("x-user-id", "LCF-MAI-ADA")
      .send({
        branchId: "branch-lagos-ikeja",
        terminalId: "terminal-web-1",
        recordType: "sale",
        operation: "create",
        idempotencyKey: "invalid-sync-terminal",
        payload: { total: 1500 }
      });

    expect(invalidBranchResponse.status).toBe(404);
    expect(invalidBranchResponse.body.error).toBe("Sync branch not found for this tenant");
    expect(invalidTerminalResponse.status).toBe(404);
    expect(invalidTerminalResponse.body.error).toBe("Sync terminal not found for this branch");
  });

  it("prevents sync status updates from the wrong branch context", async () => {
    const createResponse = await request(app)
      .post("/api/v1/sync/queue")
      .set("x-tenant-id", "tenant-lagos-foods")
      .set("x-branch-id", "branch-lagos-main")
      .set("x-role", "cashier")
      .set("x-user-id", "cashier-1")
      .send({
        branchId: "branch-lagos-main",
        terminalId: "terminal-web-1",
        recordType: "payment",
        operation: "create",
        idempotencyKey: "wrong-branch-sync-status",
        payload: { saleId: "INV-OFFLINE-2", amount: 5500 }
      });

    const updateResponse = await request(app)
      .patch(`/api/v1/sync/queue/${createResponse.body.record.id}/status`)
      .set("x-tenant-id", "tenant-lagos-foods")
      .set("x-branch-id", "branch-lagos-ikeja")
      .set("x-role", "manager")
      .set("x-user-id", "manager-1")
      .send({ status: "synced", serverEntityId: "PAY-OFFLINE-2" });

    expect(updateResponse.status).toBe(404);
    expect(updateResponse.body.error).toBe("Sync record not found");
  });

  it("lets city managers supervise sync records only inside their branch city", async () => {
    if (!branches.some((branch) => branch.id === "branch-lagos-outside-city")) {
      branches.push({
        id: "branch-lagos-outside-city",
        tenantId: "tenant-lagos-foods",
        name: "Ibadan Road Test Branch",
        address: "1 Test Road",
        city: "Ibadan",
        phone: "+2348099990000",
        status: "active",
        createdAt: new Date().toISOString()
      });
    }
    if (!terminals.some((terminal) => terminal.id === "terminal-outside-city-1")) {
      terminals.push({
        id: "terminal-outside-city-1",
        tenantId: "tenant-lagos-foods",
        branchId: "branch-lagos-outside-city",
        name: "Outside City Terminal",
        deviceCode: "IBD-TEST-01",
        status: "online",
        appVersion: "1.0.0",
        lastSeenAt: new Date().toISOString(),
        createdAt: new Date().toISOString()
      });
    }

    const ikejaResponse = await request(app)
      .post("/api/v1/sync/queue")
      .set("x-tenant-id", "tenant-lagos-foods")
      .set("x-role", "owner")
      .set("x-user-id", "LCF-MAI-ADA")
      .send({
        branchId: "branch-lagos-ikeja",
        terminalId: "terminal-ikeja-1",
        recordType: "sale",
        operation: "create",
        idempotencyKey: "city-manager-sync-ikeja",
        payload: { total: 4500 }
      });
    const outsideResponse = await request(app)
      .post("/api/v1/sync/queue")
      .set("x-tenant-id", "tenant-lagos-foods")
      .set("x-role", "owner")
      .set("x-user-id", "LCF-MAI-ADA")
      .send({
        branchId: "branch-lagos-outside-city",
        terminalId: "terminal-outside-city-1",
        recordType: "sale",
        operation: "create",
        idempotencyKey: "city-manager-sync-outside",
        payload: { total: 4500 }
      });
    const listResponse = await request(app)
      .get("/api/v1/sync/queue?status=all")
      .set("x-tenant-id", "tenant-lagos-foods")
      .set("x-role", "state_manager")
      .set("x-user-id", "LCF-MAI-TUN");
    const updateResponse = await request(app)
      .patch(`/api/v1/sync/queue/${ikejaResponse.body.record.id}/status`)
      .set("x-tenant-id", "tenant-lagos-foods")
      .set("x-role", "state_manager")
      .set("x-user-id", "LCF-MAI-TUN")
      .send({ status: "synced", serverEntityId: "INV-CITY-SYNC" });
    const outsideUpdateResponse = await request(app)
      .patch(`/api/v1/sync/queue/${outsideResponse.body.record.id}/status`)
      .set("x-tenant-id", "tenant-lagos-foods")
      .set("x-role", "state_manager")
      .set("x-user-id", "LCF-MAI-TUN")
      .send({ status: "synced", serverEntityId: "INV-OUTSIDE-SYNC" });

    expect(ikejaResponse.status).toBe(201);
    expect(outsideResponse.status).toBe(201);
    expect(listResponse.status).toBe(200);
    expect(listResponse.body.records.some((record: { id: string }) => record.id === ikejaResponse.body.record.id)).toBe(true);
    expect(listResponse.body.records.some((record: { id: string }) => record.id === outsideResponse.body.record.id)).toBe(false);
    expect(updateResponse.status).toBe(200);
    expect(updateResponse.body.record).toMatchObject({ id: ikejaResponse.body.record.id, status: "synced", serverEntityId: "INV-CITY-SYNC" });
    expect(outsideUpdateResponse.status).toBe(404);
  });

  it("blocks branch-scoped sync users from cross-branch and missing-branch workflows", async () => {
    const crossBranchCreateResponse = await request(app)
      .post("/api/v1/sync/queue")
      .set("x-tenant-id", "tenant-lagos-foods")
      .set("x-branch-id", "branch-lagos-main")
      .set("x-role", "cashier")
      .set("x-user-id", "cashier-1")
      .send({
        branchId: "branch-lagos-ikeja",
        terminalId: "terminal-ikeja-1",
        recordType: "sale",
        operation: "create",
        idempotencyKey: "cross-branch-sync-record",
        payload: { total: 4500 }
      });
    const missingBranchCreateResponse = await request(app)
      .post("/api/v1/sync/queue")
      .set("x-tenant-id", "tenant-lagos-foods")
      .set("x-role", "cashier")
      .set("x-user-id", "cashier-1")
      .send({
        branchId: "branch-lagos-main",
        terminalId: "terminal-web-1",
        recordType: "sale",
        operation: "create",
        idempotencyKey: "missing-branch-sync-record",
        payload: { total: 2200 }
      });
    const crossBranchListResponse = await request(app)
      .get("/api/v1/sync/queue?branchId=branch-lagos-ikeja&status=all")
      .set("x-tenant-id", "tenant-lagos-foods")
      .set("x-branch-id", "branch-lagos-main")
      .set("x-role", "manager")
      .set("x-user-id", "manager-1");

    expect(crossBranchCreateResponse.status).toBe(403);
    expect(crossBranchCreateResponse.body.error).toBe("Branch access denied");
    expect(missingBranchCreateResponse.status).toBe(403);
    expect(missingBranchCreateResponse.body.error).toBe("Branch access denied");
    expect(crossBranchListResponse.status).toBe(403);
    expect(crossBranchListResponse.body.error).toBe("Branch access denied");
  });

  it("returns dashboard report metrics for owners", async () => {
    const response = await request(app)
      .get("/api/v1/reports/dashboard?branchId=branch-lagos-main")
      .set("x-tenant-id", "tenant-lagos-foods")
      .set("x-branch-id", "branch-lagos-main")
      .set("x-role", "owner")
      .set("x-user-id", "LCF-MAI-ADA");

    expect(response.status).toBe(200);
    expect(response.body.period).toBe("today");
    expect(response.body.periodLabel).toBe("Today");
    expect(response.body.summary).toMatchObject({
      totalSales: expect.any(Number),
      taxableSales: expect.any(Number),
      discountTotal: expect.any(Number),
      serviceChargeTotal: expect.any(Number),
      vatTotal: expect.any(Number),
      orderCount: expect.any(Number),
      grossProfit: expect.any(Number),
      cashMovementIn: expect.any(Number),
      cashMovementOut: expect.any(Number),
      cashMovementNet: expect.any(Number),
      customerCount: expect.any(Number),
      customerOutstandingBalance: expect.any(Number),
      customerCreditLimit: expect.any(Number),
      customerLoyaltyPoints: expect.any(Number),
      customerAccountPayments: expect.any(Number),
      customerAccountCreditIssued: expect.any(Number),
      pendingApprovalCount: expect.any(Number),
      pendingApprovalValue: expect.any(Number),
      highPriorityApprovalCount: expect.any(Number)
    });
    expect(response.body.summary.customerOutstandingBalance).toBeGreaterThan(0);
    expect(response.body.summary.customerCreditLimit).toBeGreaterThan(response.body.summary.customerOutstandingBalance);
    expect(response.body.summary.customerAccountCreditIssued).toBeGreaterThan(0);
    expect(response.body.lowStock).toEqual(expect.any(Array));
    expect(response.body.categorySales).toEqual(expect.any(Array));
    expect(response.body.topProducts).toEqual(expect.any(Array));
    expect(response.body.cashMovements).toEqual(expect.any(Array));
    expect(response.body.approvals).toEqual(expect.any(Array));
    expect(response.body.staffPerformance).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "LCF-MAI-CHI", status: "active" })
    ]));
  });

  it("returns dashboard metrics for the selected reporting period", async () => {
    const response = await request(app)
      .get("/api/v1/reports/dashboard?branchId=branch-lagos-main&period=week")
      .set("x-tenant-id", "tenant-lagos-foods")
      .set("x-branch-id", "branch-lagos-main")
      .set("x-role", "owner")
      .set("x-user-id", "LCF-MAI-ADA");

    expect(response.status).toBe(200);
    expect(response.body.period).toBe("week");
    expect(response.body.periodLabel).toBe("This week");
    expect(response.body.hourlySales).toHaveLength(7);
    expect(response.body.hourlySales[0]).toMatchObject({
      label: expect.any(String),
      amount: expect.any(Number)
    });
  });

  it("supports custom dashboard report date ranges", async () => {
    const response = await request(app)
      .get("/api/v1/reports/dashboard?branchId=branch-lagos-main&period=all&startDate=2026-07-01&endDate=2026-07-31")
      .set("x-tenant-id", "tenant-lagos-foods")
      .set("x-branch-id", "branch-lagos-main")
      .set("x-role", "owner")
      .set("x-user-id", "LCF-MAI-ADA");

    expect(response.status).toBe(200);
    expect(response.body.period).toBe("all");
    expect(response.body.periodLabel).toBe("Jul 1, 2026 - Jul 31, 2026");
    expect(response.body.summary).toMatchObject({
      totalSales: expect.any(Number),
      taxableSales: expect.any(Number),
      discountTotal: expect.any(Number),
      serviceChargeTotal: expect.any(Number),
      vatTotal: expect.any(Number),
      expenseTotal: expect.any(Number),
      cashMovementNet: expect.any(Number)
    });
  });

  it("rejects invalid dashboard report date ranges", async () => {
    const invalidDateResponse = await request(app)
      .get("/api/v1/reports/dashboard?branchId=branch-lagos-main&startDate=not-a-date")
      .set("x-tenant-id", "tenant-lagos-foods")
      .set("x-branch-id", "branch-lagos-main")
      .set("x-role", "owner")
      .set("x-user-id", "LCF-MAI-ADA");
    const reversedDateResponse = await request(app)
      .get("/api/v1/reports/dashboard?branchId=branch-lagos-main&startDate=2026-08-01&endDate=2026-07-01")
      .set("x-tenant-id", "tenant-lagos-foods")
      .set("x-branch-id", "branch-lagos-main")
      .set("x-role", "owner")
      .set("x-user-id", "LCF-MAI-ADA");

    expect(invalidDateResponse.status).toBe(400);
    expect(invalidDateResponse.body.error).toBe("Invalid report date filter");
    expect(reversedDateResponse.status).toBe(400);
    expect(reversedDateResponse.body.error).toBe("Report end date must be after start date");
  });

  it("scopes customer account report totals to the selected branch", async () => {
    const mainResponse = await request(app)
      .get("/api/v1/reports/dashboard?branchId=branch-lagos-main&period=all")
      .set("x-tenant-id", "tenant-lagos-foods")
      .set("x-branch-id", "branch-lagos-main")
      .set("x-role", "owner")
      .set("x-user-id", "LCF-MAI-ADA");
    const ikejaResponse = await request(app)
      .get("/api/v1/reports/dashboard?branchId=branch-lagos-ikeja&period=all")
      .set("x-tenant-id", "tenant-lagos-foods")
      .set("x-branch-id", "branch-lagos-main")
      .set("x-role", "owner")
      .set("x-user-id", "LCF-MAI-ADA");

    expect(mainResponse.status).toBe(200);
    expect(ikejaResponse.status).toBe(200);
    expect(mainResponse.body.summary.customerAccountCreditIssued).toBeGreaterThan(0);
    expect(mainResponse.body.summary.customerOutstandingBalance).toBeGreaterThan(0);
    expect(mainResponse.body.summary.customerCount).toBeGreaterThan(0);
    expect(ikejaResponse.body.summary.customerAccountCreditIssued).toBe(0);
    expect(ikejaResponse.body.summary.customerAccountPayments).toBe(0);
    expect(ikejaResponse.body.summary.customerOutstandingBalance).toBe(0);
    expect(ikejaResponse.body.summary.customerCreditLimit).toBe(0);
    expect(ikejaResponse.body.summary.customerLoyaltyPoints).toBe(0);
    expect(ikejaResponse.body.summary.customerCount).toBe(0);
  });

  it("rejects reports for branches outside the tenant", async () => {
    const response = await request(app)
      .get("/api/v1/reports/dashboard?branchId=branch-abuja-main")
      .set("x-tenant-id", "tenant-lagos-foods")
      .set("x-role", "owner")
      .set("x-user-id", "LCF-MAI-ADA");

    expect(response.status).toBe(404);
    expect(response.body.error).toBe("Report branch not found for this tenant");
  });

  it("requires branch context for branch-scoped report users", async () => {
    const missingBranchResponse = await request(app)
      .get("/api/v1/reports/dashboard")
      .set("x-tenant-id", "tenant-lagos-foods")
      .set("x-role", "accountant")
      .set("x-user-id", "accountant-1");
    const crossBranchResponse = await request(app)
      .get("/api/v1/reports/dashboard?branchId=branch-lagos-ikeja")
      .set("x-tenant-id", "tenant-lagos-foods")
      .set("x-branch-id", "branch-lagos-main")
      .set("x-role", "accountant")
      .set("x-user-id", "accountant-1");
    const branchResponse = await request(app)
      .get("/api/v1/reports/dashboard?branchId=branch-lagos-main")
      .set("x-tenant-id", "tenant-lagos-foods")
      .set("x-branch-id", "branch-lagos-main")
      .set("x-role", "accountant")
      .set("x-user-id", "accountant-1");
    const stateManagerResponse = await request(app)
      .get("/api/v1/reports/dashboard")
      .set("x-tenant-id", "tenant-lagos-foods")
      .set("x-role", "state_manager")
      .set("x-user-id", "state-manager-1");

    expect(missingBranchResponse.status).toBe(403);
    expect(missingBranchResponse.body.error).toBe("Branch access denied");
    expect(crossBranchResponse.status).toBe(403);
    expect(crossBranchResponse.body.error).toBe("Branch access denied");
    expect(branchResponse.status).toBe(200);
    expect(stateManagerResponse.status).toBe(200);
  });

  it("scopes audit events to branch context unless the user can access all branches", async () => {
    appendAudit({
      tenantId: "tenant-lagos-foods",
      branchId: "branch-lagos-main",
      userId: "audit-filter-user",
      action: "auth.login",
      entityType: "testProbe",
      entityId: "audit-filter-1",
      metadata: { source: "audit-filter-test" }
    });
    appendAudit({
      tenantId: "tenant-lagos-foods",
      branchId: "branch-lagos-main",
      userId: "audit-other-user",
      action: "auth.refresh",
      entityType: "testProbe",
      entityId: "audit-filter-2",
      metadata: { source: "audit-filter-test" }
    });
    appendAudit({
      tenantId: "tenant-lagos-foods",
      branchId: "branch-lagos-ikeja",
      userId: "audit-ikeja-user",
      action: "auth.login",
      entityType: "testProbe",
      entityId: "audit-filter-ikeja",
      metadata: { source: "audit-filter-test" }
    });
    appendAudit({
      tenantId: "tenant-lagos-foods",
      branchId: "branch-outside-lagos-city",
      userId: "audit-outside-city-user",
      action: "auth.login",
      entityType: "testProbe",
      entityId: "audit-filter-outside-city",
      metadata: { source: "audit-filter-test" }
    });
    const missingBranchResponse = await request(app)
      .get("/api/v1/audit")
      .set("x-tenant-id", "tenant-lagos-foods")
      .set("x-role", "auditor")
      .set("x-user-id", "auditor-1");
    const crossBranchResponse = await request(app)
      .get("/api/v1/audit?branchId=branch-lagos-ikeja")
      .set("x-tenant-id", "tenant-lagos-foods")
      .set("x-branch-id", "branch-lagos-main")
      .set("x-role", "auditor")
      .set("x-user-id", "auditor-1");
    const branchResponse = await request(app)
      .get("/api/v1/audit?branchId=branch-lagos-main")
      .set("x-tenant-id", "tenant-lagos-foods")
      .set("x-branch-id", "branch-lagos-main")
      .set("x-role", "auditor")
      .set("x-user-id", "auditor-1");
    const stateManagerResponse = await request(app)
      .get("/api/v1/audit")
      .set("x-tenant-id", "tenant-lagos-foods")
      .set("x-role", "state_manager")
      .set("x-user-id", "state-manager-1");
    const filteredResponse = await request(app)
      .get("/api/v1/audit?branchId=branch-lagos-main&userId=audit-filter-user&action=auth.login")
      .set("x-tenant-id", "tenant-lagos-foods")
      .set("x-branch-id", "branch-lagos-main")
      .set("x-role", "auditor")
      .set("x-user-id", "auditor-1");
    const today = new Date().toISOString().slice(0, 10);
    const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const dateRangeResponse = await request(app)
      .get(`/api/v1/audit?branchId=branch-lagos-main&startDate=${today}&endDate=${today}`)
      .set("x-tenant-id", "tenant-lagos-foods")
      .set("x-branch-id", "branch-lagos-main")
      .set("x-role", "auditor")
      .set("x-user-id", "auditor-1");
    const invalidDateResponse = await request(app)
      .get("/api/v1/audit?branchId=branch-lagos-main&startDate=not-a-date")
      .set("x-tenant-id", "tenant-lagos-foods")
      .set("x-branch-id", "branch-lagos-main")
      .set("x-role", "auditor")
      .set("x-user-id", "auditor-1");
    const invertedDateResponse = await request(app)
      .get(`/api/v1/audit?branchId=branch-lagos-main&startDate=${tomorrow}&endDate=${today}`)
      .set("x-tenant-id", "tenant-lagos-foods")
      .set("x-branch-id", "branch-lagos-main")
      .set("x-role", "auditor")
      .set("x-user-id", "auditor-1");

    expect(missingBranchResponse.status).toBe(403);
    expect(missingBranchResponse.body.error).toBe("Branch access denied");
    expect(crossBranchResponse.status).toBe(403);
    expect(crossBranchResponse.body.error).toBe("Branch access denied");
    expect(branchResponse.status).toBe(200);
    expect(branchResponse.body.events.every((event: { branchId?: string }) => !event.branchId || event.branchId === "branch-lagos-main")).toBe(true);
    expect(stateManagerResponse.status).toBe(200);
    expect(stateManagerResponse.body.events).toEqual(expect.arrayContaining([expect.objectContaining({ entityId: "audit-filter-ikeja" })]));
    expect(stateManagerResponse.body.events).not.toEqual(expect.arrayContaining([expect.objectContaining({ entityId: "audit-filter-outside-city" })]));
    expect(filteredResponse.status).toBe(200);
    expect(filteredResponse.body.events).toHaveLength(1);
    expect(filteredResponse.body.events[0]).toMatchObject({
      userId: "audit-filter-user",
      action: "auth.login",
      entityId: "audit-filter-1"
    });
    expect(dateRangeResponse.status).toBe(200);
    expect(dateRangeResponse.body.events.length).toBeGreaterThan(0);
    expect(invalidDateResponse.status).toBe(400);
    expect(invertedDateResponse.status).toBe(400);
  });

  it("denies sale creation without permission", async () => {
    const response = await request(app)
      .post("/api/v1/sales")
      .set("x-tenant-id", "tenant-lagos-foods")
      .set("x-role", "auditor")
      .set("x-user-id", "auditor-1")
      .send({
        branchId: "branch-lagos-main",
        terminalId: "terminal-1",
        idempotencyKey: "terminal-1-0001",
        lines: [{ productId: "p1", quantity: 1, discount: 0 }],
        payments: [{ method: "cash", amount: 9563 }]
      });

    expect(response.status).toBe(403);
  });

  it("allows managers to create tenant-scoped products", async () => {
    const response = await request(app)
      .post("/api/v1/catalog/products")
      .set("x-tenant-id", "tenant-lagos-foods")
      .set("x-branch-id", "branch-lagos-main")
      .set("x-role", "manager")
      .set("x-user-id", "manager-1")
      .send({
        branchId: "branch-lagos-main",
        name: "Chapman Pitcher",
        sku: "BAR-CHAPMAN",
        barcode: "2341000099",
        category: "Drinks",
        price: 6000,
        cost: 2300,
        taxRate: 0.075,
        image: "https://images.unsplash.com/photo-1544145945-f90425340c7e?auto=format&fit=crop&w=600&q=80",
        stock: 20,
        reorderPoint: 8,
        station: "Bar",
        modifiers: ["Less sugar"]
      });

    expect(response.status).toBe(201);
    expect(response.body.product).toMatchObject({
      tenantId: "tenant-lagos-foods",
      sku: "BAR-CHAPMAN"
    });
  });

  it("uses tenant default tax for catalog products when tax is omitted", async () => {
    const response = await request(app)
      .post("/api/v1/catalog/products")
      .set("x-tenant-id", "tenant-lagos-foods")
      .set("x-branch-id", "branch-lagos-main")
      .set("x-role", "manager")
      .set("x-user-id", "manager-1")
      .send({
        branchId: "branch-lagos-main",
        name: "Small Chops Tray",
        sku: "MEAL-SMALL-CHOPS",
        barcode: "2341000100",
        category: "Meals",
        price: 9500,
        cost: 4100,
        image: "https://images.unsplash.com/photo-1604908176997-125f25cc6f3d?auto=format&fit=crop&w=600&q=80",
        stock: 12,
        reorderPoint: 4,
        station: "Kitchen",
        modifiers: ["Extra pepper"]
      });

    expect(response.status).toBe(201);
    expect(response.body.product).toMatchObject({
      tenantId: "tenant-lagos-foods",
      sku: "MEAL-SMALL-CHOPS",
      taxRate: 0.075
    });
  });

  it("normalizes service catalog products as non-stock items", async () => {
    const createResponse = await request(app)
      .post("/api/v1/catalog/products")
      .set("x-tenant-id", "tenant-lagos-foods")
      .set("x-branch-id", "branch-lagos-main")
      .set("x-role", "manager")
      .set("x-user-id", "manager-1")
      .send({
        branchId: "branch-lagos-main",
        name: "Setup Consultation",
        sku: "SVC-SETUP-CONSULT",
        barcode: "2341000102",
        category: "Services",
        price: 15000,
        cost: 0,
        taxRate: 0.075,
        image: "/uploads/products/setup-consultation.png",
        stock: 25,
        reorderPoint: 5,
        station: "Counter",
        modifiers: ["Remote", "On-site"]
      });

    const updateResponse = await request(app)
      .patch("/api/v1/catalog/products/p28")
      .set("x-tenant-id", "tenant-lagos-foods")
      .set("x-branch-id", "branch-lagos-main")
      .set("x-role", "manager")
      .set("x-user-id", "manager-1")
      .send({ stock: 99, reorderPoint: 10 });

    expect(createResponse.status).toBe(201);
    expect(createResponse.body.product).toMatchObject({
      category: "Services",
      stock: 0,
      reorderPoint: 0
    });
    expect(updateResponse.status).toBe(200);
    expect(updateResponse.body.product).toMatchObject({
      id: "p28",
      category: "Services",
      stock: 0,
      reorderPoint: 0
    });
  });

  it("allows products to use categories configured in tenant settings", async () => {
    const response = await request(app)
      .post("/api/v1/catalog/products")
      .set("x-tenant-id", "tenant-lagos-foods")
      .set("x-branch-id", "branch-lagos-main")
      .set("x-role", "manager")
      .set("x-user-id", "manager-1")
      .send({
        branchId: "branch-lagos-main",
        name: "Breakfast Akara Box",
        sku: "BREAKFAST-AKARA",
        barcode: "2341000101",
        category: "Breakfast",
        price: 4200,
        cost: 1300,
        taxRate: 0.075,
        image: "https://images.unsplash.com/photo-1546069901-ba9599a7e63c?auto=format&fit=crop&w=600&q=80",
        stock: 18,
        reorderPoint: 6,
        station: "Kitchen",
        modifiers: ["Extra pap"]
      });

    expect(response.status).toBe(201);
    expect(response.body.product).toMatchObject({ sku: "BREAKFAST-AKARA", category: "Breakfast" });
  });

  it("requires catalog products to belong to a tenant branch", async () => {
    const createResponse = await request(app)
      .post("/api/v1/catalog/products")
      .set("x-tenant-id", "tenant-lagos-foods")
      .set("x-branch-id", "branch-lagos-main")
      .set("x-role", "manager")
      .set("x-user-id", "manager-1")
      .send({
        branchId: "branch-abuja-main",
        name: "Cross Tenant Product",
        sku: "CROSS-TENANT-PRODUCT",
        barcode: "2341000199",
        category: "Meals",
        price: 4200,
        cost: 1300,
        taxRate: 0.075,
        image: "https://images.unsplash.com/photo-1546069901-ba9599a7e63c?auto=format&fit=crop&w=600&q=80",
        stock: 18,
        reorderPoint: 6,
        station: "Kitchen",
        modifiers: []
      });
    const updateResponse = await request(app)
      .patch("/api/v1/catalog/products/p1")
      .set("x-tenant-id", "tenant-lagos-foods")
      .set("x-branch-id", "branch-lagos-main")
      .set("x-role", "manager")
      .set("x-user-id", "manager-1")
      .send({ branchId: "branch-abuja-main" });

    expect(createResponse.status).toBe(404);
    expect(createResponse.body.error).toBe("Product branch not found for this tenant");
    expect(updateResponse.status).toBe(404);
    expect(updateResponse.body.error).toBe("Product branch not found for this tenant");
  });

  it("blocks branch-scoped catalog writes outside the assigned branch", async () => {
    const ownerCreateResponse = await request(app)
      .post("/api/v1/catalog/products")
      .set("x-tenant-id", "tenant-lagos-foods")
      .set("x-role", "owner")
      .set("x-user-id", "LCF-MAI-ADA")
      .send({
        branchId: "branch-lagos-ikeja",
        name: "Ikeja Counter Cake",
        sku: "IKEJA-COUNTER-CAKE",
        barcode: "2900000000700",
        category: "Bakery",
        price: 2800,
        cost: 1300,
        taxRate: 0.075,
        image: "/uploads/products/ikeja-counter-cake.png",
        stock: 10,
        reorderPoint: 3,
        station: "Counter",
        modifiers: []
      });
    const createResponse = await request(app)
      .post("/api/v1/catalog/products")
      .set("x-tenant-id", "tenant-lagos-foods")
      .set("x-branch-id", "branch-lagos-main")
      .set("x-role", "manager")
      .set("x-user-id", "manager-1")
      .send({
        branchId: "branch-lagos-ikeja",
        name: "Cross Branch Pastry",
        sku: "CROSS-BRANCH-PASTRY",
        barcode: "2900000000701",
        category: "Bakery",
        price: 2500,
        cost: 1200,
        taxRate: 0.075,
        image: "/uploads/products/cross-branch-pastry.png",
        stock: 12,
        reorderPoint: 4,
        station: "Kitchen",
        modifiers: []
      });
    const updateResponse = await request(app)
      .patch(`/api/v1/catalog/products/${ownerCreateResponse.body.product.id}`)
      .set("x-tenant-id", "tenant-lagos-foods")
      .set("x-branch-id", "branch-lagos-main")
      .set("x-role", "manager")
      .set("x-user-id", "manager-1")
      .send({ price: 3000 });

    expect(ownerCreateResponse.status).toBe(201);
    expect(createResponse.status).toBe(403);
    expect(createResponse.body.error).toBe("Branch access denied");
    expect(updateResponse.status).toBe(403);
    expect(updateResponse.body.error).toBe("Branch access denied");
  });

  it("blocks product image uploads outside the assigned branch", async () => {
    const response = await request(app)
      .post("/api/v1/catalog/product-images")
      .set("x-tenant-id", "tenant-lagos-foods")
      .set("x-branch-id", "branch-abuja-main")
      .set("x-role", "manager")
      .set("x-user-id", "manager-1")
      .set("x-file-name", "cross-branch.png")
      .set("content-type", "image/png")
      .send(Buffer.from("fake-png"));

    expect(response.status).toBe(404);
    expect(response.body.error).toBe("Product branch not found for this tenant");
  });

  it("renames tenant product categories and updates linked products", async () => {
    const renameResponse = await request(app)
      .patch("/api/v1/tenants/current/product-categories/rename")
      .set("x-tenant-id", "tenant-lagos-foods")
      .set("x-role", "owner")
      .set("x-user-id", "LCF-MAI-ADA")
      .send({ from: " Breakfast ", to: "  Morning   Meals  " });
    const catalogResponse = await request(app)
      .get("/api/v1/catalog/products")
      .set("x-tenant-id", "tenant-lagos-foods")
      .set("x-branch-id", "branch-lagos-main")
      .set("x-role", "manager")
      .set("x-user-id", "manager-1");
    const renamedProduct = catalogResponse.body.products.find((product: { sku: string }) => product.sku === "BREAKFAST-AKARA");

    expect(renameResponse.status).toBe(200);
    expect(renameResponse.body.updatedProductCount).toBe(1);
    expect(renameResponse.body.tenant.settings.productCategories).toContain("Morning Meals");
    expect(renameResponse.body.tenant.settings.productCategories).not.toContain("  Morning   Meals  ");
    expect(renameResponse.body.tenant.settings.productCategories).not.toContain("Breakfast");
    expect(renamedProduct).toMatchObject({ sku: "BREAKFAST-AKARA", category: "Morning Meals" });
  });

  it("blocks cashiers from catalog management", async () => {
    const response = await request(app)
      .patch("/api/v1/catalog/products/p1")
      .set("x-tenant-id", "tenant-lagos-foods")
      .set("x-branch-id", "branch-lagos-main")
      .set("x-role", "cashier")
      .set("x-user-id", "cashier-1")
      .send({ price: 9000 });

    expect(response.status).toBe(403);
  });

  it("allows managers to adjust stock and records movement history", async () => {
    const response = await request(app)
      .post("/api/v1/inventory/adjustments")
      .set("x-tenant-id", "tenant-lagos-foods")
      .set("x-branch-id", "branch-lagos-main")
      .set("x-role", "manager")
      .set("x-user-id", "manager-1")
      .send({
        productId: "p2",
        branchId: "branch-lagos-main",
        type: "receipt",
        quantityDelta: 5,
        reason: "Supplier delivery",
        reference: "GRN-002"
      });

    expect(response.status).toBe(201);
    expect(response.body.product.stock).toBe(23);
    expect(response.body.movement).toMatchObject({
      productId: "p2",
      quantityDelta: 5,
      balanceAfter: 23
    });
  });

  it("lets city managers read inventory only across branches in their city", async () => {
    if (!branches.some((branch) => branch.id === "branch-lagos-outside-city")) {
      branches.push({
        id: "branch-lagos-outside-city",
        tenantId: "tenant-lagos-foods",
        name: "Ibadan Road Test Branch",
        address: "1 Test Road",
        city: "Ibadan",
        phone: "+2348099990000",
        status: "active",
        createdAt: new Date().toISOString()
      });
    }

    const ikejaProductResponse = await request(app)
      .post("/api/v1/catalog/products")
      .set("x-tenant-id", "tenant-lagos-foods")
      .set("x-role", "owner")
      .set("x-user-id", "LCF-MAI-ADA")
      .send({
        branchId: "branch-lagos-ikeja",
        name: "City Scope Inventory Cake",
        sku: "CITY-SCOPE-INV-CAKE",
        barcode: "2341000901",
        category: "Bakery",
        price: 4500,
        cost: 1800,
        taxRate: 0.075,
        image: "/uploads/products/city-scope-cake.png",
        stock: 12,
        reorderPoint: 3,
        station: "Kitchen",
        modifiers: []
      });
    const outsideProductResponse = await request(app)
      .post("/api/v1/catalog/products")
      .set("x-tenant-id", "tenant-lagos-foods")
      .set("x-role", "owner")
      .set("x-user-id", "LCF-MAI-ADA")
      .send({
        branchId: "branch-lagos-outside-city",
        name: "Outside Scope Inventory Cake",
        sku: "OUTSIDE-SCOPE-INV-CAKE",
        barcode: "2341000902",
        category: "Bakery",
        price: 4500,
        cost: 1800,
        taxRate: 0.075,
        image: "/uploads/products/outside-scope-cake.png",
        stock: 12,
        reorderPoint: 3,
        station: "Kitchen",
        modifiers: []
      });

    const ikejaSupplierResponse = await request(app)
      .post("/api/v1/inventory/suppliers")
      .set("x-tenant-id", "tenant-lagos-foods")
      .set("x-role", "owner")
      .set("x-user-id", "LCF-MAI-ADA")
      .send({
        branchId: "branch-lagos-ikeja",
        name: "City Scope Foods",
        contactPerson: "Ikeja Buyer",
        phone: "+2348011111111",
        email: "city-scope@example.com",
        leadTimeDays: 2,
        active: true,
        productIds: [ikejaProductResponse.body.product.id]
      });
    const outsideSupplierResponse = await request(app)
      .post("/api/v1/inventory/suppliers")
      .set("x-tenant-id", "tenant-lagos-foods")
      .set("x-role", "owner")
      .set("x-user-id", "LCF-MAI-ADA")
      .send({
        branchId: "branch-lagos-outside-city",
        name: "Outside Scope Foods",
        contactPerson: "Ibadan Buyer",
        phone: "+2348022222222",
        email: "outside-scope@example.com",
        leadTimeDays: 2,
        active: true,
        productIds: [outsideProductResponse.body.product.id]
      });

    const stockResponse = await request(app)
      .get("/api/v1/inventory/stock")
      .set("x-tenant-id", "tenant-lagos-foods")
      .set("x-role", "state_manager")
      .set("x-user-id", "LCF-MAI-TUN");
    const suppliersResponse = await request(app)
      .get("/api/v1/inventory/suppliers")
      .set("x-tenant-id", "tenant-lagos-foods")
      .set("x-role", "state_manager")
      .set("x-user-id", "LCF-MAI-TUN");
    const outsideStockResponse = await request(app)
      .get("/api/v1/inventory/stock?branchId=branch-lagos-outside-city")
      .set("x-tenant-id", "tenant-lagos-foods")
      .set("x-role", "state_manager")
      .set("x-user-id", "LCF-MAI-TUN");

    expect(ikejaProductResponse.status).toBe(201);
    expect(outsideProductResponse.status).toBe(201);
    expect(ikejaSupplierResponse.status).toBe(201);
    expect(outsideSupplierResponse.status).toBe(201);
    expect(stockResponse.status).toBe(200);
    expect(stockResponse.body.products.some((product: { id: string }) => product.id === ikejaProductResponse.body.product.id)).toBe(true);
    expect(stockResponse.body.products.some((product: { id: string }) => product.id === outsideProductResponse.body.product.id)).toBe(false);
    expect(suppliersResponse.status).toBe(200);
    expect(suppliersResponse.body.suppliers.some((supplier: { id: string }) => supplier.id === ikejaSupplierResponse.body.supplier.id)).toBe(true);
    expect(suppliersResponse.body.suppliers.some((supplier: { id: string }) => supplier.id === outsideSupplierResponse.body.supplier.id)).toBe(false);
    expect(outsideStockResponse.status).toBe(403);
  });

  it("posts branch inventory transfers with paired stock movements", async () => {
    const sourceResponse = await request(app)
      .post("/api/v1/catalog/products")
      .set("x-tenant-id", "tenant-lagos-foods")
      .set("x-role", "owner")
      .set("x-user-id", "LCF-MAI-ADA")
      .send({
        branchId: "branch-lagos-main",
        name: "Transfer Source Rice",
        sku: "TRANSFER-SRC-RICE",
        barcode: "2341000301",
        category: "Bakery",
        price: 5000,
        cost: 2000,
        taxRate: 0.075,
        image: "/uploads/products/transfer-destination-rice.png",
        stock: 9,
        reorderPoint: 2,
        station: "Kitchen",
        modifiers: []
      });
    const destinationResponse = await request(app)
      .post("/api/v1/catalog/products")
      .set("x-tenant-id", "tenant-lagos-foods")
      .set("x-role", "owner")
      .set("x-user-id", "LCF-MAI-ADA")
      .send({
        branchId: "branch-lagos-ikeja",
        name: "Transfer Destination Rice",
        sku: "TRANSFER-DEST-RICE",
        barcode: "2341000302",
        category: "Bakery",
        price: 5000,
        cost: 2000,
        taxRate: 0.075,
        image: "/uploads/products/transfer-low-stock.png",
        stock: 4,
        reorderPoint: 2,
        station: "Kitchen",
        modifiers: []
      });

    const response = await request(app)
      .post("/api/v1/inventory/transfers")
      .set("x-tenant-id", "tenant-lagos-foods")
      .set("x-role", "owner")
      .set("x-user-id", "LCF-MAI-ADA")
      .send({
        sourceBranchId: "branch-lagos-main",
        destinationBranchId: "branch-lagos-ikeja",
        sourceProductId: sourceResponse.body.product.id,
        destinationProductId: destinationResponse.body.product.id,
        quantity: 3,
        reference: "TRF-API-001",
        note: "Move stock to Ikeja branch"
      });
    const transferList = await request(app)
      .get("/api/v1/inventory/transfers?branchId=branch-lagos-main")
      .set("x-tenant-id", "tenant-lagos-foods")
      .set("x-branch-id", "branch-lagos-main")
      .set("x-role", "owner")
      .set("x-user-id", "LCF-MAI-ADA");

    expect(sourceResponse.status).toBe(201);
    expect(destinationResponse.status).toBe(201);
    expect(response.status).toBe(201);
    expect(response.body.transfer).toMatchObject({
      reference: "TRF-API-001",
      sourceBranchId: "branch-lagos-main",
      destinationBranchId: "branch-lagos-ikeja",
      quantity: 3
    });
    expect(response.body.sourceProduct.stock).toBe(6);
    expect(response.body.destinationProduct.stock).toBe(7);
    expect(response.body.sourceMovement).toMatchObject({ type: "transfer", quantityDelta: -3, balanceAfter: 6 });
    expect(response.body.destinationMovement).toMatchObject({ type: "transfer", quantityDelta: 3, balanceAfter: 7 });
    expect(transferList.status).toBe(200);
    expect(transferList.body.transfers.some((transfer: { reference: string }) => transfer.reference === "TRF-API-001")).toBe(true);
  });

  it("blocks branch transfers that exceed source stock or cross branch scope", async () => {
    const sourceResponse = await request(app)
      .post("/api/v1/catalog/products")
      .set("x-tenant-id", "tenant-lagos-foods")
      .set("x-role", "owner")
      .set("x-user-id", "LCF-MAI-ADA")
      .send({
        branchId: "branch-lagos-main",
        name: "Transfer Low Stock",
        sku: "TRANSFER-LOW-STOCK",
        barcode: "2341000303",
        category: "Bakery",
        price: 5000,
        cost: 2000,
        taxRate: 0.075,
        image: "/uploads/products/transfer-low-destination.png",
        stock: 1,
        reorderPoint: 1,
        station: "Kitchen",
        modifiers: []
      });
    const destinationResponse = await request(app)
      .post("/api/v1/catalog/products")
      .set("x-tenant-id", "tenant-lagos-foods")
      .set("x-role", "owner")
      .set("x-user-id", "LCF-MAI-ADA")
      .send({
        branchId: "branch-lagos-ikeja",
        name: "Transfer Low Destination",
        sku: "TRANSFER-LOW-DEST",
        barcode: "2341000304",
        category: "Bakery",
        price: 5000,
        cost: 2000,
        taxRate: 0.075,
        image: "/uploads/products/transfer-low-destination.png",
        stock: 2,
        reorderPoint: 1,
        station: "Kitchen",
        modifiers: []
      });
    const overstockResponse = await request(app)
      .post("/api/v1/inventory/transfers")
      .set("x-tenant-id", "tenant-lagos-foods")
      .set("x-role", "owner")
      .set("x-user-id", "LCF-MAI-ADA")
      .send({
        sourceBranchId: "branch-lagos-main",
        destinationBranchId: "branch-lagos-ikeja",
        sourceProductId: sourceResponse.body.product.id,
        destinationProductId: destinationResponse.body.product.id,
        quantity: 9999,
        reference: "TRF-API-OVERSTOCK",
        note: "Too much stock"
      });
    const scopedResponse = await request(app)
      .post("/api/v1/inventory/transfers")
      .set("x-tenant-id", "tenant-lagos-foods")
      .set("x-branch-id", "branch-lagos-main")
      .set("x-role", "manager")
      .set("x-user-id", "manager-1")
      .send({
        sourceBranchId: "branch-lagos-main",
        destinationBranchId: "branch-lagos-ikeja",
        sourceProductId: sourceResponse.body.product.id,
        destinationProductId: destinationResponse.body.product.id,
        quantity: 1,
        reference: "TRF-API-SCOPED",
        note: "Scoped branch transfer"
      });

    expect(sourceResponse.status).toBe(201);
    expect(destinationResponse.status).toBe(201);
    expect(overstockResponse.status).toBe(409);
    expect(overstockResponse.body.error).toContain("insufficient stock");
    expect(scopedResponse.status).toBe(403);
    expect(scopedResponse.body.error).toBe("Branch access denied");
  });

  it("lists tenant suppliers with product coverage", async () => {
    const response = await request(app)
      .get("/api/v1/inventory/suppliers")
      .set("x-tenant-id", "tenant-lagos-foods")
      .set("x-branch-id", "branch-lagos-main")
      .set("x-role", "manager")
      .set("x-user-id", "manager-1");

    expect(response.status).toBe(200);
    expect(response.body.suppliers.length).toBeGreaterThanOrEqual(4);
    expect(response.body.suppliers[0]).toMatchObject({
      tenantId: "tenant-lagos-foods",
      branchId: "branch-lagos-main",
      active: true,
      productIds: expect.any(Array)
    });
  });

  it("creates suppliers with valid branch product coverage", async () => {
    const response = await request(app)
      .post("/api/v1/inventory/suppliers")
      .set("x-tenant-id", "tenant-lagos-foods")
      .set("x-branch-id", "branch-lagos-main")
      .set("x-role", "manager")
      .set("x-user-id", "manager-1")
      .send({
        branchId: "branch-lagos-main",
        name: "Lekki Dry Goods",
        contactPerson: "Tola Ade",
        phone: "+2348011112222",
        email: "orders@lekkidrygoods.ng",
        leadTimeDays: 3,
        active: true,
        productIds: ["p22", "p23"]
      });

    expect(response.status).toBe(201);
    expect(response.body.supplier).toMatchObject({
      tenantId: "tenant-lagos-foods",
      branchId: "branch-lagos-main",
      name: "Lekki Dry Goods",
      productIds: ["p22", "p23"]
    });
  });

  it("requires inventory writes to target tenant branches", async () => {
    const supplierResponse = await request(app)
      .post("/api/v1/inventory/suppliers")
      .set("x-tenant-id", "tenant-lagos-foods")
      .set("x-role", "owner")
      .set("x-user-id", "LCF-MAI-ADA")
      .send({
        branchId: "branch-abuja-main",
        name: "Wrong Branch Supplier",
        contactPerson: "Ada Stock",
        phone: "+2348011119999",
        email: "stock@example.com",
        leadTimeDays: 3,
        active: true,
        productIds: ["p1"]
      });

    const adjustmentResponse = await request(app)
      .post("/api/v1/inventory/adjustments")
      .set("x-tenant-id", "tenant-lagos-foods")
      .set("x-role", "owner")
      .set("x-user-id", "LCF-MAI-ADA")
      .send({
        productId: "p1",
        branchId: "branch-abuja-main",
        type: "adjustment",
        quantityDelta: 1,
        reason: "Wrong branch"
      });

    const countResponse = await request(app)
      .post("/api/v1/inventory/counts")
      .set("x-tenant-id", "tenant-lagos-foods")
      .set("x-role", "owner")
      .set("x-user-id", "LCF-MAI-ADA")
      .send({
        branchId: "branch-abuja-main",
        reference: "COUNT-WRONG-BRANCH",
        reason: "Wrong branch",
        counts: [{ productId: "p1", countedQuantity: 12 }]
      });

    const receiptResponse = await request(app)
      .post("/api/v1/inventory/purchase-receipts")
      .set("x-tenant-id", "tenant-lagos-foods")
      .set("x-role", "owner")
      .set("x-user-id", "LCF-MAI-ADA")
      .send({
        supplierId: "sup-1",
        branchId: "branch-abuja-main",
        productId: "p1",
        quantity: 2,
        reference: "PO-WRONG-BRANCH",
        note: "Wrong branch"
      });

    expect(supplierResponse.status).toBe(404);
    expect(adjustmentResponse.status).toBe(404);
    expect(countResponse.status).toBe(404);
    expect(receiptResponse.status).toBe(404);
    expect(supplierResponse.body.error).toBe("Inventory branch not found for this tenant");
    expect(adjustmentResponse.body.error).toBe("Inventory branch not found for this tenant");
    expect(countResponse.body.error).toBe("Inventory branch not found for this tenant");
    expect(receiptResponse.body.error).toBe("Inventory branch not found for this tenant");
  });

  it("blocks branch-scoped inventory users from writing to another tenant branch", async () => {
    const supplierResponse = await request(app)
      .post("/api/v1/inventory/suppliers")
      .set("x-tenant-id", "tenant-lagos-foods")
      .set("x-branch-id", "branch-lagos-main")
      .set("x-role", "manager")
      .set("x-user-id", "manager-1")
      .send({
        branchId: "branch-lagos-ikeja",
        name: "Cross Branch Supplier",
        contactPerson: "Ada Stock",
        phone: "+2348011119999",
        email: "stock@example.com",
        leadTimeDays: 3,
        active: true,
        productIds: ["p1"]
      });

    const adjustmentResponse = await request(app)
      .post("/api/v1/inventory/adjustments")
      .set("x-tenant-id", "tenant-lagos-foods")
      .set("x-branch-id", "branch-lagos-main")
      .set("x-role", "manager")
      .set("x-user-id", "manager-1")
      .send({
        productId: "p1",
        branchId: "branch-lagos-ikeja",
        type: "adjustment",
        quantityDelta: 1,
        reason: "Cross branch"
      });

    const countResponse = await request(app)
      .post("/api/v1/inventory/counts")
      .set("x-tenant-id", "tenant-lagos-foods")
      .set("x-branch-id", "branch-lagos-main")
      .set("x-role", "manager")
      .set("x-user-id", "manager-1")
      .send({
        branchId: "branch-lagos-ikeja",
        reference: "COUNT-CROSS-BRANCH",
        reason: "Cross branch",
        counts: [{ productId: "p1", countedQuantity: 12 }]
      });

    const receiptResponse = await request(app)
      .post("/api/v1/inventory/purchase-receipts")
      .set("x-tenant-id", "tenant-lagos-foods")
      .set("x-branch-id", "branch-lagos-main")
      .set("x-role", "manager")
      .set("x-user-id", "manager-1")
      .send({
        supplierId: "sup-1",
        branchId: "branch-lagos-ikeja",
        productId: "p1",
        quantity: 2,
        reference: "PO-CROSS-BRANCH",
        note: "Cross branch"
      });

    expect(supplierResponse.status).toBe(403);
    expect(adjustmentResponse.status).toBe(403);
    expect(countResponse.status).toBe(403);
    expect(receiptResponse.status).toBe(403);
    expect(supplierResponse.body.error).toBe("Branch access denied");
    expect(adjustmentResponse.body.error).toBe("Branch access denied");
    expect(countResponse.body.error).toBe("Branch access denied");
    expect(receiptResponse.body.error).toBe("Branch access denied");
  });

  it("receives supplier purchases and links movement history", async () => {
    const before = await request(app)
      .get("/api/v1/inventory/stock")
      .set("x-tenant-id", "tenant-lagos-foods")
      .set("x-branch-id", "branch-lagos-main")
      .set("x-role", "manager")
      .set("x-user-id", "manager-1");
    const currentStock = before.body.products.find((product: { id: string; stock: number }) => product.id === "p1").stock;

    const response = await request(app)
      .post("/api/v1/inventory/purchase-receipts")
      .set("x-tenant-id", "tenant-lagos-foods")
      .set("x-branch-id", "branch-lagos-main")
      .set("x-role", "manager")
      .set("x-user-id", "manager-1")
      .send({
        supplierId: "sup-1",
        branchId: "branch-lagos-main",
        productId: "p1",
        quantity: 6,
        reference: "PO-1002",
        note: "Received supplier purchase"
      });

    expect(response.status).toBe(201);
    expect(response.body.product.stock).toBe(currentStock + 6);
    expect(response.body.supplier.name).toBe("Mainland Fresh Foods");
    expect(response.body.movement).toMatchObject({
      productId: "p1",
      supplierId: "sup-1",
      supplierName: "Mainland Fresh Foods",
      type: "receipt",
      quantityDelta: 6,
      balanceAfter: currentStock + 6
    });
  });

  it("creates, approves, and receives against purchase orders", async () => {
    const createResponse = await request(app)
      .post("/api/v1/inventory/purchase-orders")
      .set("x-tenant-id", "tenant-lagos-foods")
      .set("x-branch-id", "branch-lagos-main")
      .set("x-role", "manager")
      .set("x-user-id", "manager-1")
      .send({
        branchId: "branch-lagos-main",
        supplierId: "sup-1",
        note: "Restock staples",
        lines: [{ productId: "p1", quantity: 4, unitCost: 4800 }]
      });

    const submitResponse = await request(app)
      .patch(`/api/v1/inventory/purchase-orders/${createResponse.body.purchaseOrder.id}/status`)
      .set("x-tenant-id", "tenant-lagos-foods")
      .set("x-branch-id", "branch-lagos-main")
      .set("x-role", "manager")
      .set("x-user-id", "manager-1")
      .send({ status: "pending_approval", note: "Ready for approval" });

    const approveResponse = await request(app)
      .patch(`/api/v1/inventory/purchase-orders/${createResponse.body.purchaseOrder.id}/status`)
      .set("x-tenant-id", "tenant-lagos-foods")
      .set("x-branch-id", "branch-lagos-main")
      .set("x-role", "manager")
      .set("x-user-id", "manager-1")
      .send({ status: "approved" });

    const receiptResponse = await request(app)
      .post("/api/v1/inventory/purchase-receipts")
      .set("x-tenant-id", "tenant-lagos-foods")
      .set("x-branch-id", "branch-lagos-main")
      .set("x-role", "manager")
      .set("x-user-id", "manager-1")
      .send({
        supplierId: "sup-1",
        branchId: "branch-lagos-main",
        productId: "p1",
        quantity: 4,
        reference: createResponse.body.purchaseOrder.orderNumber,
        note: "Received against PO",
        purchaseOrderId: createResponse.body.purchaseOrder.id
      });

    expect(createResponse.status).toBe(201);
    expect(createResponse.body.purchaseOrder).toMatchObject({ status: "draft", subtotal: 19200 });
    expect(submitResponse.body.purchaseOrder.status).toBe("pending_approval");
    expect(approveResponse.body.purchaseOrder.status).toBe("approved");
    expect(receiptResponse.status).toBe(201);
    expect(receiptResponse.body.purchaseOrder).toMatchObject({ id: createResponse.body.purchaseOrder.id, status: "received" });
    expect(receiptResponse.body.purchaseOrder.lines[0]).toMatchObject({ productId: "p1", receivedQuantity: 4 });
  });

  it("blocks purchase order over-receipts", async () => {
    const createResponse = await request(app)
      .post("/api/v1/inventory/purchase-orders")
      .set("x-tenant-id", "tenant-lagos-foods")
      .set("x-branch-id", "branch-lagos-main")
      .set("x-role", "manager")
      .set("x-user-id", "manager-1")
      .send({
        branchId: "branch-lagos-main",
        supplierId: "sup-1",
        lines: [{ productId: "p1", quantity: 2 }]
      });

    await request(app)
      .patch(`/api/v1/inventory/purchase-orders/${createResponse.body.purchaseOrder.id}/status`)
      .set("x-tenant-id", "tenant-lagos-foods")
      .set("x-branch-id", "branch-lagos-main")
      .set("x-role", "manager")
      .set("x-user-id", "manager-1")
      .send({ status: "approved" });

    const response = await request(app)
      .post("/api/v1/inventory/purchase-receipts")
      .set("x-tenant-id", "tenant-lagos-foods")
      .set("x-branch-id", "branch-lagos-main")
      .set("x-role", "manager")
      .set("x-user-id", "manager-1")
      .send({
        supplierId: "sup-1",
        branchId: "branch-lagos-main",
        productId: "p1",
        quantity: 3,
        reference: createResponse.body.purchaseOrder.orderNumber,
        note: "Too much stock",
        purchaseOrderId: createResponse.body.purchaseOrder.id
      });

    expect(response.status).toBe(409);
    expect(response.body.error).toBe("Receipt quantity exceeds the purchase order balance");
  });

  it("creates supplier invoices and records payments against balances", async () => {
    const invoiceResponse = await request(app)
      .post("/api/v1/inventory/supplier-invoices")
      .set("x-tenant-id", "tenant-lagos-foods")
      .set("x-branch-id", "branch-lagos-main")
      .set("x-role", "manager")
      .set("x-user-id", "manager-1")
      .send({
        branchId: "branch-lagos-main",
        supplierId: "sup-1",
        invoiceNumber: "SUP-INV-TEST-1001",
        invoiceDate: new Date().toISOString(),
        dueDate: new Date(Date.now() + 1000 * 60 * 60 * 24 * 7).toISOString(),
        amount: 25000,
        note: "Supplier invoice test"
      });

    const partialPaymentResponse = await request(app)
      .post(`/api/v1/inventory/supplier-invoices/${invoiceResponse.body.supplierInvoice.id}/payments`)
      .set("x-tenant-id", "tenant-lagos-foods")
      .set("x-branch-id", "branch-lagos-main")
      .set("x-role", "manager")
      .set("x-user-id", "manager-1")
      .send({
        amount: 10000,
        paymentMethod: "bank_transfer",
        reference: "SUP-PAY-1001",
        paidAt: new Date().toISOString(),
        note: "Part payment"
      });

    const invalidCreditPaymentResponse = await request(app)
      .post(`/api/v1/inventory/supplier-invoices/${invoiceResponse.body.supplierInvoice.id}/payments`)
      .set("x-tenant-id", "tenant-lagos-foods")
      .set("x-branch-id", "branch-lagos-main")
      .set("x-role", "manager")
      .set("x-user-id", "manager-1")
      .send({
        amount: 1000,
        paymentMethod: "customer_credit",
        reference: "SUP-PAY-BAD",
        paidAt: new Date().toISOString()
      });

    const finalPaymentResponse = await request(app)
      .post(`/api/v1/inventory/supplier-invoices/${invoiceResponse.body.supplierInvoice.id}/payments`)
      .set("x-tenant-id", "tenant-lagos-foods")
      .set("x-branch-id", "branch-lagos-main")
      .set("x-role", "manager")
      .set("x-user-id", "manager-1")
      .send({
        amount: 15000,
        paymentMethod: "bank_transfer",
        reference: "SUP-PAY-1002",
        paidAt: new Date().toISOString()
      });

    expect(invoiceResponse.status).toBe(201);
    expect(invoiceResponse.body.supplierInvoice).toMatchObject({ status: "open", amount: 25000, balanceDue: 25000 });
    expect(partialPaymentResponse.status).toBe(201);
    expect(partialPaymentResponse.body.supplierInvoice).toMatchObject({ status: "partially_paid", amountPaid: 10000, balanceDue: 15000 });
    expect(invalidCreditPaymentResponse.status).toBe(400);
    expect(finalPaymentResponse.status).toBe(201);
    expect(finalPaymentResponse.body.supplierInvoice).toMatchObject({ status: "paid", amountPaid: 25000, balanceDue: 0 });
  });

  it("blocks supplier invoice overpayments", async () => {
    const invoiceResponse = await request(app)
      .post("/api/v1/inventory/supplier-invoices")
      .set("x-tenant-id", "tenant-lagos-foods")
      .set("x-branch-id", "branch-lagos-main")
      .set("x-role", "manager")
      .set("x-user-id", "manager-1")
      .send({
        branchId: "branch-lagos-main",
        supplierId: "sup-1",
        invoiceNumber: "SUP-INV-TEST-1002",
        invoiceDate: new Date().toISOString(),
        amount: 12000
      });

    const response = await request(app)
      .post(`/api/v1/inventory/supplier-invoices/${invoiceResponse.body.supplierInvoice.id}/payments`)
      .set("x-tenant-id", "tenant-lagos-foods")
      .set("x-branch-id", "branch-lagos-main")
      .set("x-role", "manager")
      .set("x-user-id", "manager-1")
      .send({
        amount: 13000,
        paymentMethod: "cash",
        reference: "SUP-PAY-OVER",
        paidAt: new Date().toISOString()
      });

    expect(response.status).toBe(409);
    expect(response.body.error).toBe("Supplier payment exceeds invoice balance");
  });

  it("records supplier returns, reduces stock, and credits invoice balances", async () => {
    const stockBefore = await request(app)
      .get("/api/v1/inventory/stock")
      .set("x-tenant-id", "tenant-lagos-foods")
      .set("x-branch-id", "branch-lagos-main")
      .set("x-role", "manager")
      .set("x-user-id", "manager-1");
    const p1Stock = stockBefore.body.products.find((product: { id: string; stock: number }) => product.id === "p1").stock;

    const invoiceResponse = await request(app)
      .post("/api/v1/inventory/supplier-invoices")
      .set("x-tenant-id", "tenant-lagos-foods")
      .set("x-branch-id", "branch-lagos-main")
      .set("x-role", "manager")
      .set("x-user-id", "manager-1")
      .send({
        branchId: "branch-lagos-main",
        supplierId: "sup-1",
        invoiceNumber: "SUP-INV-RETURN-1001",
        invoiceDate: new Date().toISOString(),
        amount: 20000
      });

    const response = await request(app)
      .post("/api/v1/inventory/supplier-returns")
      .set("x-tenant-id", "tenant-lagos-foods")
      .set("x-branch-id", "branch-lagos-main")
      .set("x-role", "manager")
      .set("x-user-id", "manager-1")
      .send({
        branchId: "branch-lagos-main",
        supplierId: "sup-1",
        productId: "p1",
        supplierInvoiceId: invoiceResponse.body.supplierInvoice.id,
        quantity: 2,
        unitCost: 5000,
        reference: "SRET-1001",
        reason: "Damaged delivery",
        returnedAt: new Date().toISOString()
      });

    expect(response.status).toBe(201);
    expect(response.body.product.stock).toBe(p1Stock - 2);
    expect(response.body.movement).toMatchObject({ productId: "p1", quantityDelta: -2, balanceAfter: p1Stock - 2 });
    expect(response.body.supplierInvoice).toMatchObject({ creditTotal: 10000, balanceDue: 10000, status: "partially_paid" });
  });

  it("blocks supplier return credits above invoice balance", async () => {
    const invoiceResponse = await request(app)
      .post("/api/v1/inventory/supplier-invoices")
      .set("x-tenant-id", "tenant-lagos-foods")
      .set("x-branch-id", "branch-lagos-main")
      .set("x-role", "manager")
      .set("x-user-id", "manager-1")
      .send({
        branchId: "branch-lagos-main",
        supplierId: "sup-1",
        invoiceNumber: "SUP-INV-RETURN-1002",
        invoiceDate: new Date().toISOString(),
        amount: 5000
      });

    const response = await request(app)
      .post("/api/v1/inventory/supplier-returns")
      .set("x-tenant-id", "tenant-lagos-foods")
      .set("x-branch-id", "branch-lagos-main")
      .set("x-role", "manager")
      .set("x-user-id", "manager-1")
      .send({
        branchId: "branch-lagos-main",
        supplierId: "sup-1",
        productId: "p1",
        supplierInvoiceId: invoiceResponse.body.supplierInvoice.id,
        quantity: 2,
        unitCost: 5000,
        reference: "SRET-OVER",
        reason: "Credit too high",
        returnedAt: new Date().toISOString()
      });

    expect(response.status).toBe(409);
    expect(response.body.error).toBe("Supplier return credit exceeds invoice balance");
  });

  it("builds supplier statements from invoices, payments, and return credits", async () => {
    const invoiceResponse = await request(app)
      .post("/api/v1/inventory/supplier-invoices")
      .set("x-tenant-id", "tenant-lagos-foods")
      .set("x-branch-id", "branch-lagos-main")
      .set("x-role", "manager")
      .set("x-user-id", "manager-1")
      .send({
        branchId: "branch-lagos-main",
        supplierId: "sup-1",
        invoiceNumber: "SUP-STMT-1001",
        invoiceDate: new Date("2026-07-20T09:00:00.000Z").toISOString(),
        amount: 30000
      });

    await request(app)
      .post(`/api/v1/inventory/supplier-invoices/${invoiceResponse.body.supplierInvoice.id}/payments`)
      .set("x-tenant-id", "tenant-lagos-foods")
      .set("x-branch-id", "branch-lagos-main")
      .set("x-role", "manager")
      .set("x-user-id", "manager-1")
      .send({
        amount: 10000,
        paymentMethod: "bank_transfer",
        reference: "SUP-STMT-PAY-1001",
        paidAt: new Date("2026-07-21T09:00:00.000Z").toISOString()
      });

    await request(app)
      .post("/api/v1/inventory/supplier-returns")
      .set("x-tenant-id", "tenant-lagos-foods")
      .set("x-branch-id", "branch-lagos-main")
      .set("x-role", "manager")
      .set("x-user-id", "manager-1")
      .send({
        branchId: "branch-lagos-main",
        supplierId: "sup-1",
        productId: "p1",
        supplierInvoiceId: invoiceResponse.body.supplierInvoice.id,
        quantity: 1,
        unitCost: 5000,
        reference: "SUP-STMT-RET-1001",
        reason: "Statement return",
        returnedAt: new Date("2026-07-22T09:00:00.000Z").toISOString()
      });

    const response = await request(app)
      .get("/api/v1/inventory/suppliers/sup-1/statement?branchId=branch-lagos-main")
      .set("x-tenant-id", "tenant-lagos-foods")
      .set("x-branch-id", "branch-lagos-main")
      .set("x-role", "manager")
      .set("x-user-id", "manager-1");

    expect(response.status).toBe(200);
    expect(response.body.statement.totals).toMatchObject({
      invoiced: expect.any(Number),
      paid: expect.any(Number),
      credited: expect.any(Number),
      balanceDue: expect.any(Number)
    });
    expect(response.body.statement.entries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ reference: "SUP-STMT-1001", type: "invoice", debit: 30000 }),
        expect.objectContaining({ reference: "SUP-STMT-PAY-1001", type: "payment", credit: 10000 }),
        expect.objectContaining({ reference: "SUP-STMT-RET-1001", type: "credit", credit: 5000 })
      ])
    );
  });

  it("blocks purchase receipts for products outside supplier coverage", async () => {
    const response = await request(app)
      .post("/api/v1/inventory/purchase-receipts")
      .set("x-tenant-id", "tenant-lagos-foods")
      .set("x-branch-id", "branch-lagos-main")
      .set("x-role", "manager")
      .set("x-user-id", "manager-1")
      .send({
        supplierId: "sup-1",
        branchId: "branch-lagos-main",
        productId: "p3",
        quantity: 3,
        reference: "PO-1003",
        note: "Wrong supplier"
      });

    expect(response.status).toBe(409);
    expect(response.body.error).toBe("Supplier is not linked to this product");
  });

  it("blocks service products from stock-managed inventory workflows", async () => {
    const adjustmentResponse = await request(app)
      .post("/api/v1/inventory/adjustments")
      .set("x-tenant-id", "tenant-lagos-foods")
      .set("x-branch-id", "branch-lagos-main")
      .set("x-role", "manager")
      .set("x-user-id", "manager-1")
      .send({
        productId: "p28",
        branchId: "branch-lagos-main",
        type: "adjustment",
        quantityDelta: 5,
        reason: "Service is not counted stock"
      });

    const countResponse = await request(app)
      .post("/api/v1/inventory/counts")
      .set("x-tenant-id", "tenant-lagos-foods")
      .set("x-branch-id", "branch-lagos-main")
      .set("x-role", "manager")
      .set("x-user-id", "manager-1")
      .send({
        branchId: "branch-lagos-main",
        reference: "COUNT-SVC-001",
        reason: "Service count attempt",
        counts: [{ productId: "p28", countedQuantity: 0 }]
      });

    const supplierResponse = await request(app)
      .post("/api/v1/inventory/suppliers")
      .set("x-tenant-id", "tenant-lagos-foods")
      .set("x-branch-id", "branch-lagos-main")
      .set("x-role", "manager")
      .set("x-user-id", "manager-1")
      .send({
        branchId: "branch-lagos-main",
        name: "Services Supplier",
        contactPerson: "Ada Service",
        phone: "+2348099991111",
        email: "service-supplier@example.com",
        leadTimeDays: 1,
        active: true,
        productIds: ["p28"]
      });

    expect(adjustmentResponse.status).toBe(409);
    expect(adjustmentResponse.body.error).toContain("service");
    expect(countResponse.status).toBe(409);
    expect(countResponse.body.error).toContain("service");
    expect(supplierResponse.status).toBe(409);
    expect(supplierResponse.body.error).toBe("Services cannot be linked to supplier stock coverage");
  });

  it("prevents negative stock adjustments", async () => {
    const response = await request(app)
      .post("/api/v1/inventory/adjustments")
      .set("x-tenant-id", "tenant-lagos-foods")
      .set("x-branch-id", "branch-lagos-main")
      .set("x-role", "manager")
      .set("x-user-id", "manager-1")
      .send({
        productId: "p2",
        branchId: "branch-lagos-main",
        type: "waste",
        quantityDelta: -9999,
        reason: "Bad count"
      });

    expect(response.status).toBe(409);
  });

  it("posts batch stock counts and records only variances", async () => {
    const response = await request(app)
      .post("/api/v1/inventory/counts")
      .set("x-tenant-id", "tenant-lagos-foods")
      .set("x-branch-id", "branch-lagos-main")
      .set("x-role", "manager")
      .set("x-user-id", "manager-1")
      .send({
        branchId: "branch-lagos-main",
        reference: "COUNT-API-001",
        reason: "Evening count",
        counts: [
          { productId: "p1", countedQuantity: 40 },
          { productId: "p2", countedQuantity: 18 }
        ]
      });

    expect(response.status).toBe(201);
    expect(response.body.products).toHaveLength(2);
    expect(response.body.movements.length).toBeGreaterThanOrEqual(1);
    expect(response.body.movements.find((movement: { productId: string }) => movement.productId === "p1")).toMatchObject({
      productId: "p1",
      type: "count",
      quantityDelta: expect.any(Number),
      reference: "COUNT-API-001"
    });
  });

  it("blocks cashiers from stock adjustments", async () => {
    const response = await request(app)
      .post("/api/v1/inventory/adjustments")
      .set("x-tenant-id", "tenant-lagos-foods")
      .set("x-branch-id", "branch-lagos-main")
      .set("x-role", "cashier")
      .set("x-user-id", "cashier-1")
      .send({
        productId: "p1",
        branchId: "branch-lagos-main",
        type: "adjustment",
        quantityDelta: 1,
        reason: "Unauthorized"
      });

    expect(response.status).toBe(403);
  });

  it("blocks cashiers from inventory read workflows", async () => {
    const inventoryReads = await Promise.all([
      request(app).get("/api/v1/inventory/stock?branchId=branch-lagos-main"),
      request(app).get("/api/v1/inventory/transfers?branchId=branch-lagos-main"),
      request(app).get("/api/v1/inventory/suppliers?branchId=branch-lagos-main"),
      request(app).get("/api/v1/inventory/suppliers/sup-1/statement?branchId=branch-lagos-main"),
      request(app).get("/api/v1/inventory/purchase-orders?branchId=branch-lagos-main"),
      request(app).get("/api/v1/inventory/supplier-invoices?branchId=branch-lagos-main"),
      request(app).get("/api/v1/inventory/supplier-returns?branchId=branch-lagos-main")
    ].map((requestBuilder) => requestBuilder
      .set("x-tenant-id", "tenant-lagos-foods")
      .set("x-branch-id", "branch-lagos-main")
      .set("x-role", "cashier")
      .set("x-user-id", "cashier-1")));

    expect(inventoryReads.every((response) => response.status === 403)).toBe(true);
    expect(inventoryReads.every((response) => response.body.permission === "inventory.adjust")).toBe(true);
  });

  it("allows waiters to open available table orders", async () => {
    const response = await request(app)
      .post("/api/v1/restaurant/table-orders")
      .set("x-tenant-id", "tenant-lagos-foods")
      .set("x-branch-id", "branch-lagos-main")
      .set("x-role", "waiter")
      .set("x-user-id", "waiter-3")
      .send({
        tableId: "table-01",
        guests: 2,
        waiterId: "waiter-3",
        customerName: "Walk-in guest",
        specialInstructions: "Birthday dessert"
      });

    expect(response.status).toBe(201);
    expect(response.body.table).toMatchObject({
      id: "table-01",
      state: "occupied",
      guests: 2
    });
  });

  it("prevents opening an already occupied table", async () => {
    const response = await request(app)
      .post("/api/v1/restaurant/table-orders")
      .set("x-tenant-id", "tenant-lagos-foods")
      .set("x-branch-id", "branch-lagos-main")
      .set("x-role", "waiter")
      .set("x-user-id", "waiter-1")
      .send({
        tableId: "table-04",
        guests: 2,
        waiterId: "waiter-1"
      });

    expect(response.status).toBe(409);
  });

  it("requires table orders to use tables in the request branch", async () => {
    const response = await request(app)
      .post("/api/v1/restaurant/table-orders")
      .set("x-tenant-id", "tenant-lagos-foods")
      .set("x-branch-id", "branch-abuja-main")
      .set("x-role", "waiter")
      .set("x-user-id", "waiter-3")
      .send({
        tableId: "table-01",
        guests: 2,
        waiterId: "waiter-3"
      });

    expect(response.status).toBe(404);
    expect(response.body.error).toBe("Table not found");
  });

  it("adds and removes items on open table orders", async () => {
    const addResponse = await request(app)
      .post("/api/v1/restaurant/table-orders/table-order-2/items")
      .set("x-tenant-id", "tenant-lagos-foods")
      .set("x-branch-id", "branch-lagos-main")
      .set("x-role", "waiter")
      .set("x-user-id", "waiter-2")
      .send({
        productId: "p3",
        quantity: 2,
        modifiers: ["Extra ice"],
        note: "Serve after drinks"
      });

    expect(addResponse.status).toBe(201);
    expect(addResponse.body.item).toMatchObject({ productId: "p3", quantity: 2, productName: "Passion Mojito" });
    expect(addResponse.body.order.items.some((item: { productId: string }) => item.productId === "p3")).toBe(true);

    const removeResponse = await request(app)
      .delete(`/api/v1/restaurant/table-orders/table-order-2/items/${addResponse.body.item.id}`)
      .set("x-tenant-id", "tenant-lagos-foods")
      .set("x-branch-id", "branch-lagos-main")
      .set("x-role", "waiter")
      .set("x-user-id", "waiter-2");

    expect(removeResponse.status).toBe(200);
    expect(removeResponse.body.order.items.some((item: { id: string }) => item.id === addResponse.body.item.id)).toBe(false);
  });

  it("rejects table order products outside the order branch", async () => {
    const response = await request(app)
      .post("/api/v1/restaurant/table-orders/table-order-2/items")
      .set("x-tenant-id", "tenant-lagos-foods")
      .set("x-branch-id", "branch-lagos-main")
      .set("x-role", "waiter")
      .set("x-user-id", "waiter-2")
      .send({
        productId: "p6",
        quantity: 1,
        modifiers: [],
        note: "Wrong branch product"
      });

    expect(response.status).toBe(404);
    expect(response.body.error).toBe("Product not found");
  });

  it("routes added table order items to station prep tickets", async () => {
    const addResponse = await request(app)
      .post("/api/v1/restaurant/table-orders/table-order-2/items")
      .set("x-tenant-id", "tenant-lagos-foods")
      .set("x-branch-id", "branch-lagos-main")
      .set("x-role", "waiter")
      .set("x-user-id", "waiter-2")
      .send({
        productId: "p1",
        quantity: 1,
        modifiers: ["Extra plantain"],
        note: "Fire with mains"
      });

    const kitchenResponse = await request(app)
      .get("/api/v1/kitchen/tickets?branchId=branch-lagos-main&station=Kitchen")
      .set("x-tenant-id", "tenant-lagos-foods")
      .set("x-branch-id", "branch-lagos-main")
      .set("x-role", "kitchen")
      .set("x-user-id", "kitchen-1");

    expect(addResponse.status).toBe(201);
    expect(addResponse.body.prepTicket).toMatchObject({ station: "Kitchen", tableOrderId: "table-order-2", status: "new" });
    expect(
      kitchenResponse.body.tickets.some((ticket: { id: string; items: Array<{ sourceTableItemId?: string }> }) =>
        ticket.id === addResponse.body.prepTicket.id &&
        ticket.items.some((item) => item.sourceTableItemId === addResponse.body.item.id)
      )
    ).toBe(true);
  });

  it("transfers active table orders to another available table", async () => {
    const sourceTableResponse = await request(app)
      .post("/api/v1/restaurant/tables")
      .set("x-tenant-id", "tenant-lagos-foods")
      .set("x-branch-id", "branch-lagos-main")
      .set("x-role", "manager")
      .set("x-user-id", "manager-1")
      .send({ branchId: "branch-lagos-main", area: "Main Dining", label: "X91", seats: 4, x: 62, y: 38 });
    const targetTableResponse = await request(app)
      .post("/api/v1/restaurant/tables")
      .set("x-tenant-id", "tenant-lagos-foods")
      .set("x-branch-id", "branch-lagos-main")
      .set("x-role", "manager")
      .set("x-user-id", "manager-1")
      .send({ branchId: "branch-lagos-main", area: "Main Dining", label: "X92", seats: 4, x: 68, y: 38 });
    const openResponse = await request(app)
      .post("/api/v1/restaurant/table-orders")
      .set("x-tenant-id", "tenant-lagos-foods")
      .set("x-branch-id", "branch-lagos-main")
      .set("x-role", "waiter")
      .set("x-user-id", "waiter-2")
      .send({
        tableId: sourceTableResponse.body.table.id,
        guests: 3,
        waiterId: "waiter-2",
        customerName: "Moved Guest"
      });
    const transferResponse = await request(app)
      .patch(`/api/v1/restaurant/table-orders/${openResponse.body.order.id}/transfer`)
      .set("x-tenant-id", "tenant-lagos-foods")
      .set("x-branch-id", "branch-lagos-main")
      .set("x-role", "waiter")
      .set("x-user-id", "waiter-2")
      .send({ targetTableId: targetTableResponse.body.table.id, reason: "Guest requested booth" });

    expect(sourceTableResponse.status).toBe(201);
    expect(targetTableResponse.status).toBe(201);
    expect(openResponse.status).toBe(201);
    expect(transferResponse.status).toBe(200);
    expect(transferResponse.body.order).toMatchObject({ id: openResponse.body.order.id, tableId: targetTableResponse.body.table.id });
    expect(transferResponse.body.sourceTable).toMatchObject({ id: sourceTableResponse.body.table.id, state: "available", guests: 0 });
    expect(transferResponse.body.targetTable).toMatchObject({ id: targetTableResponse.body.table.id, state: "occupied", orderId: openResponse.body.order.id, guests: 3 });
  });

  it("creates table reservations and blocks overlapping reservations", async () => {
    const reservationPayload = {
      branchId: "branch-lagos-main",
      tableId: "table-12",
      customerName: "Ada Reservation",
      phone: "+2348099999999",
      guests: 6,
      reservedAt: "2026-07-20T18:00:00.000Z",
      durationMinutes: 120,
      note: "Window seat"
    };

    const response = await request(app)
      .post("/api/v1/restaurant/reservations")
      .set("x-tenant-id", "tenant-lagos-foods")
      .set("x-branch-id", "branch-lagos-main")
      .set("x-role", "manager")
      .set("x-user-id", "manager-1")
      .send(reservationPayload);

    const conflictResponse = await request(app)
      .post("/api/v1/restaurant/reservations")
      .set("x-tenant-id", "tenant-lagos-foods")
      .set("x-branch-id", "branch-lagos-main")
      .set("x-role", "manager")
      .set("x-user-id", "manager-1")
      .send({ ...reservationPayload, customerName: "Overlap Guest", reservedAt: "2026-07-20T19:00:00.000Z" });

    expect(response.status).toBe(201);
    expect(response.body.reservation).toMatchObject({ tableId: "table-12", status: "booked" });
    expect(conflictResponse.status).toBe(409);
  });

  it("blocks branch-scoped users from creating reservations for another branch", async () => {
    const response = await request(app)
      .post("/api/v1/restaurant/reservations")
      .set("x-tenant-id", "tenant-lagos-foods")
      .set("x-branch-id", "branch-lagos-main")
      .set("x-role", "manager")
      .set("x-user-id", "manager-1")
      .send({
        branchId: "branch-lagos-ikeja",
        tableId: "table-12",
        customerName: "Cross Branch Guest",
        phone: "+2348099999988",
        guests: 2,
        reservedAt: "2026-07-21T18:00:00.000Z",
        durationMinutes: 120,
        note: "Wrong branch"
      });

    expect(response.status).toBe(403);
    expect(response.body.error).toBe("Branch access denied");
  });

  it("updates reservation status and releases reserved tables when cancelled", async () => {
    const tableResponse = await request(app)
      .post("/api/v1/restaurant/tables")
      .set("x-tenant-id", "tenant-lagos-foods")
      .set("x-branch-id", "branch-lagos-main")
      .set("x-role", "manager")
      .set("x-user-id", "manager-1")
      .send({
        branchId: "branch-lagos-main",
        area: "Patio",
        label: "C88",
        seats: 4,
        x: 35,
        y: 40
      });

    const createResponse = await request(app)
      .post("/api/v1/restaurant/reservations")
      .set("x-tenant-id", "tenant-lagos-foods")
      .set("x-branch-id", "branch-lagos-main")
      .set("x-role", "manager")
      .set("x-user-id", "manager-1")
      .send({
        branchId: "branch-lagos-main",
        tableId: tableResponse.body.table.id,
        customerName: "Cancel Reservation",
        phone: "+2348099999977",
        guests: 4,
        reservedAt: "2026-07-22T18:00:00.000Z",
        durationMinutes: 120,
        note: "Release table test"
      });

    const statusResponse = await request(app)
      .patch(`/api/v1/restaurant/reservations/${createResponse.body.reservation.id}/status`)
      .set("x-tenant-id", "tenant-lagos-foods")
      .set("x-branch-id", "branch-lagos-main")
      .set("x-role", "manager")
      .set("x-user-id", "manager-1")
      .send({ status: "cancelled", note: "Guest cancelled" });

    expect(createResponse.status).toBe(201);
    expect(statusResponse.status).toBe(200);
    expect(statusResponse.body.reservation).toMatchObject({ id: createResponse.body.reservation.id, status: "cancelled" });
    expect(statusResponse.body.table).toMatchObject({ id: tableResponse.body.table.id, state: "available" });
  });

  it("allows managers to mark tables available", async () => {
    const response = await request(app)
      .patch("/api/v1/restaurant/tables/table-08/state")
      .set("x-tenant-id", "tenant-lagos-foods")
      .set("x-branch-id", "branch-lagos-main")
      .set("x-role", "manager")
      .set("x-user-id", "manager-1")
      .send({ state: "available", reason: "Bill paid" });

    expect(response.status).toBe(200);
    expect(response.body.table).toMatchObject({
      id: "table-08",
      state: "available",
      guests: 0
    });
  });

  it("allows managers to create floor tables and blocks duplicate labels", async () => {
    const payload = {
      branchId: "branch-lagos-main",
      area: "Patio",
      label: "P99",
      seats: 4,
      x: 45,
      y: 60
    };
    const createResponse = await request(app)
      .post("/api/v1/restaurant/tables")
      .set("x-tenant-id", "tenant-lagos-foods")
      .set("x-branch-id", "branch-lagos-main")
      .set("x-role", "manager")
      .set("x-user-id", "manager-1")
      .send(payload);

    const duplicateResponse = await request(app)
      .post("/api/v1/restaurant/tables")
      .set("x-tenant-id", "tenant-lagos-foods")
      .set("x-branch-id", "branch-lagos-main")
      .set("x-role", "manager")
      .set("x-user-id", "manager-1")
      .send(payload);

    const floorResponse = await request(app)
      .get("/api/v1/restaurant/tables?branchId=branch-lagos-main")
      .set("x-tenant-id", "tenant-lagos-foods")
      .set("x-branch-id", "branch-lagos-main")
      .set("x-role", "manager")
      .set("x-user-id", "manager-1");

    expect(createResponse.status).toBe(201);
    expect(createResponse.body.table).toMatchObject({ branchId: "branch-lagos-main", label: "P99", seats: 4, state: "available", guests: 0 });
    expect(duplicateResponse.status).toBe(409);
    expect(duplicateResponse.body.error).toBe("A table with this label already exists in this branch");
    expect(floorResponse.body.tables.some((table: { label: string }) => table.label === "P99")).toBe(true);
  });

  it("lets city managers read floor state and staff options across only branches in their city", async () => {
    if (!branches.some((branch) => branch.id === "branch-lagos-outside-city")) {
      branches.push({
        id: "branch-lagos-outside-city",
        tenantId: "tenant-lagos-foods",
        name: "Outside City Branch",
        address: "1 Ring Road",
        city: "Ibadan",
        phone: "+2348010000099",
        status: "active",
        createdAt: new Date().toISOString()
      });
    }

    if (!staffMembers.some((staff) => staff.id === "LCF-IKE-FLO")) {
      staffMembers.push({
        id: "LCF-IKE-FLO",
        tenantId: "tenant-lagos-foods",
        branchId: "branch-lagos-ikeja",
        name: "Ikeja Floor Staff",
        email: "ikejafloor@example.com",
        phone: "+2348077777201",
        role: "waiter",
        pinEnabled: false,
        active: true,
        salesTotal: 0,
        inviteStatus: "accepted",
        createdAt: new Date().toISOString()
      });
    }

    if (!staffMembers.some((staff) => staff.id === "LCF-IBA-FLO")) {
      staffMembers.push({
        id: "LCF-IBA-FLO",
        tenantId: "tenant-lagos-foods",
        branchId: "branch-lagos-outside-city",
        name: "Ibadan Floor Staff",
        email: "ibadanfloor@example.com",
        phone: "+2348077777202",
        role: "waiter",
        pinEnabled: false,
        active: true,
        salesTotal: 0,
        inviteStatus: "accepted",
        createdAt: new Date().toISOString()
      });
    }

    const ikejaTableResponse = await request(app)
      .post("/api/v1/restaurant/tables")
      .set("x-tenant-id", "tenant-lagos-foods")
      .set("x-role", "owner")
      .set("x-user-id", "owner-1")
      .send({
        branchId: "branch-lagos-ikeja",
        area: "Main Dining",
        label: "CITY-IKEJA-01",
        seats: 4,
        x: 20,
        y: 30
      });
    const outsideTableResponse = await request(app)
      .post("/api/v1/restaurant/tables")
      .set("x-tenant-id", "tenant-lagos-foods")
      .set("x-role", "owner")
      .set("x-user-id", "owner-1")
      .send({
        branchId: "branch-lagos-outside-city",
        area: "Main Dining",
        label: "CITY-IBADAN-01",
        seats: 4,
        x: 20,
        y: 30
      });

    const floorResponse = await request(app)
      .get("/api/v1/restaurant/tables")
      .set("x-tenant-id", "tenant-lagos-foods")
      .set("x-role", "state_manager")
      .set("x-user-id", "LCF-MAI-TUN");
    const blockedFloorResponse = await request(app)
      .get("/api/v1/restaurant/tables?branchId=branch-lagos-outside-city")
      .set("x-tenant-id", "tenant-lagos-foods")
      .set("x-role", "state_manager")
      .set("x-user-id", "LCF-MAI-TUN");
    const staffResponse = await request(app)
      .get("/api/v1/restaurant/staff-options")
      .set("x-tenant-id", "tenant-lagos-foods")
      .set("x-role", "state_manager")
      .set("x-user-id", "LCF-MAI-TUN");

    expect(ikejaTableResponse.status).toBe(201);
    expect(outsideTableResponse.status).toBe(201);
    expect(floorResponse.status).toBe(200);
    expect(floorResponse.body.tables.some((table: { id: string }) => table.id === ikejaTableResponse.body.table.id)).toBe(true);
    expect(floorResponse.body.tables.some((table: { id: string }) => table.id === outsideTableResponse.body.table.id)).toBe(false);
    expect(blockedFloorResponse.status).toBe(403);
    expect(blockedFloorResponse.body.error).toBe("Branch access denied");
    expect(staffResponse.status).toBe(200);
    expect(staffResponse.body.staff.some((staff: { id: string }) => staff.id === "LCF-IKE-FLO")).toBe(true);
    expect(staffResponse.body.staff.some((staff: { id: string }) => staff.id === "LCF-IBA-FLO")).toBe(false);
  });

  it("blocks cashiers from reading restaurant floor state", async () => {
    const response = await request(app)
      .get("/api/v1/restaurant/tables?branchId=branch-lagos-main")
      .set("x-tenant-id", "tenant-lagos-foods")
      .set("x-branch-id", "branch-lagos-main")
      .set("x-role", "cashier")
      .set("x-user-id", "cashier-1");

    expect(response.status).toBe(403);
    expect(response.body).toMatchObject({ error: "Permission denied", permission: "restaurant.manage" });
  });

  it("requires branch context for branch-scoped restaurant mutations", async () => {
    const listResponse = await request(app)
      .get("/api/v1/restaurant/tables?branchId=branch-lagos-main")
      .set("x-tenant-id", "tenant-lagos-foods")
      .set("x-role", "manager")
      .set("x-user-id", "manager-1");

    const createResponse = await request(app)
      .post("/api/v1/restaurant/tables")
      .set("x-tenant-id", "tenant-lagos-foods")
      .set("x-role", "manager")
      .set("x-user-id", "manager-1")
      .send({
        branchId: "branch-lagos-main",
        area: "Main Dining",
        label: "M01",
        seats: 4,
        x: 20,
        y: 20
      });

    const reservationResponse = await request(app)
      .post("/api/v1/restaurant/reservations")
      .set("x-tenant-id", "tenant-lagos-foods")
      .set("x-role", "manager")
      .set("x-user-id", "manager-1")
      .send({
        branchId: "branch-lagos-main",
        tableId: "table-12",
        customerName: "No Branch Reservation",
        phone: "+2348000000012",
        guests: 2,
        reservedAt: "2026-07-21T19:00:00.000Z",
        durationMinutes: 90
      });

    const openResponse = await request(app)
      .post("/api/v1/restaurant/table-orders")
      .set("x-tenant-id", "tenant-lagos-foods")
      .set("x-role", "waiter")
      .set("x-user-id", "waiter-2")
      .send({
        tableId: "table-01",
        guests: 2,
        waiterId: "waiter-2",
        customerName: "Missing Branch Guest"
      });

    const reservationStatusResponse = await request(app)
      .patch("/api/v1/restaurant/reservations/reservation-1/status")
      .set("x-tenant-id", "tenant-lagos-foods")
      .set("x-role", "manager")
      .set("x-user-id", "manager-1")
      .send({ status: "cancelled", note: "Missing branch" });

    const itemResponse = await request(app)
      .post("/api/v1/restaurant/table-orders/table-order-2/items")
      .set("x-tenant-id", "tenant-lagos-foods")
      .set("x-role", "waiter")
      .set("x-user-id", "waiter-2")
      .send({
        productId: "p3",
        quantity: 1,
        modifiers: [],
        note: "Missing branch"
      });

    const billResponse = await request(app)
      .patch("/api/v1/restaurant/table-orders/table-order-2/bill")
      .set("x-tenant-id", "tenant-lagos-foods")
      .set("x-role", "waiter")
      .set("x-user-id", "waiter-2")
      .send({ note: "Missing branch" });

    const removeResponse = await request(app)
      .delete("/api/v1/restaurant/table-orders/table-order-2/items/table-item-3")
      .set("x-tenant-id", "tenant-lagos-foods")
      .set("x-role", "waiter")
      .set("x-user-id", "waiter-2");

    const stateResponse = await request(app)
      .patch("/api/v1/restaurant/tables/table-01/state")
      .set("x-tenant-id", "tenant-lagos-foods")
      .set("x-role", "manager")
      .set("x-user-id", "manager-1")
      .send({ state: "delayed", reason: "Missing branch" });

    const layoutResponse = await request(app)
      .patch("/api/v1/restaurant/tables/table-01/layout")
      .set("x-tenant-id", "tenant-lagos-foods")
      .set("x-role", "manager")
      .set("x-user-id", "manager-1")
      .send({
        area: "Main Dining",
        label: "T01",
        seats: 2,
        x: 10,
        y: 18
      });

    expect(listResponse.status).toBe(403);
    expect(createResponse.status).toBe(403);
    expect(reservationResponse.status).toBe(403);
    expect(openResponse.status).toBe(403);
    expect(reservationStatusResponse.status).toBe(403);
    expect(itemResponse.status).toBe(403);
    expect(billResponse.status).toBe(403);
    expect(removeResponse.status).toBe(403);
    expect(stateResponse.status).toBe(403);
    expect(layoutResponse.status).toBe(403);
    expect(listResponse.body.error).toBe("Branch access denied");
    expect(createResponse.body.error).toBe("Branch access denied");
    expect(reservationResponse.body.error).toBe("Branch access denied");
    expect(openResponse.body.error).toBe("Branch access denied");
    expect(reservationStatusResponse.body.error).toBe("Branch access denied");
    expect(itemResponse.body.error).toBe("Branch access denied");
    expect(billResponse.body.error).toBe("Branch access denied");
    expect(removeResponse.body.error).toBe("Branch access denied");
    expect(stateResponse.body.error).toBe("Branch access denied");
    expect(layoutResponse.body.error).toBe("Branch access denied");
  });

  it("marks open table orders as bill requested", async () => {
    const response = await request(app)
      .patch("/api/v1/restaurant/table-orders/table-order-3/bill")
      .set("x-tenant-id", "tenant-lagos-foods")
      .set("x-branch-id", "branch-lagos-main")
      .set("x-role", "waiter")
      .set("x-user-id", "waiter-3")
      .send({ note: "Guest asked for bill" });

    expect(response.status).toBe(200);
    expect(response.body.order).toMatchObject({ id: "table-order-3", status: "bill_requested" });
    expect(response.body.order.billRequestedAt).toBeTruthy();
    expect(response.body.table).toMatchObject({ id: "table-01", state: "awaiting_payment" });
  });

  it("allows managers to update table layout details", async () => {
    const response = await request(app)
      .patch("/api/v1/restaurant/tables/table-04/layout")
      .set("x-tenant-id", "tenant-lagos-foods")
      .set("x-branch-id", "branch-lagos-main")
      .set("x-role", "manager")
      .set("x-user-id", "manager-1")
      .send({
        area: "Main Dining",
        label: "T04A",
        seats: 5,
        x: 44,
        y: 24
      });

    expect(response.status).toBe(200);
    expect(response.body.table).toMatchObject({
      id: "table-04",
      label: "T04A",
      seats: 5,
      x: 44,
      y: 24
    });
  });

  it("closes a table order when its POS sale is completed", async () => {
    const stockBefore = await request(app)
      .get("/api/v1/inventory/stock")
      .set("x-tenant-id", "tenant-lagos-foods")
      .set("x-branch-id", "branch-lagos-main")
      .set("x-role", "manager")
      .set("x-user-id", "manager-1");
    const p1StockBefore = stockBefore.body.products.find((product: { id: string; stock: number }) => product.id === "p1").stock;

    const saleResponse = await request(app)
      .post("/api/v1/sales")
      .set("x-tenant-id", "tenant-lagos-foods")
      .set("x-branch-id", "branch-lagos-main")
      .set("x-role", "cashier")
      .set("x-user-id", "cashier-1")
      .send({
        branchId: "branch-lagos-main",
        terminalId: "terminal-web-1",
        tableId: "table-04",
        tableOrderId: "table-order-1",
        idempotencyKey: "terminal-web-1-table-order-1",
        lines: [{ productId: "p1", quantity: 1, discount: 0 }],
        payments: [{ method: "cash", amount: 9563 }]
      });

    const stockAfter = await request(app)
      .get("/api/v1/inventory/stock")
      .set("x-tenant-id", "tenant-lagos-foods")
      .set("x-branch-id", "branch-lagos-main")
      .set("x-role", "manager")
      .set("x-user-id", "manager-1");
    const floorResponse = await request(app)
      .get("/api/v1/restaurant/tables?branchId=branch-lagos-main")
      .set("x-tenant-id", "tenant-lagos-foods")
      .set("x-branch-id", "branch-lagos-main")
      .set("x-role", "manager")
      .set("x-user-id", "manager-1");

    expect(saleResponse.status).toBe(201);
    expect(stockAfter.body.products.find((product: { id: string; stock: number }) => product.id === "p1").stock).toBe(p1StockBefore - 1);
    expect(stockAfter.body.movements[0]).toMatchObject({
      productId: "p1",
      type: "issue",
      quantityDelta: -1,
      reference: saleResponse.body.saleId
    });
    expect(floorResponse.body.tables.find((table: { id: string }) => table.id === "table-04")).toMatchObject({
      state: "available",
      guests: 0
    });
    expect(floorResponse.body.openOrders.some((order: { id: string }) => order.id === "table-order-1")).toBe(false);
  });

  it("blocks sales that would exceed available stock", async () => {
    const response = await request(app)
      .post("/api/v1/sales")
      .set("x-tenant-id", "tenant-lagos-foods")
      .set("x-branch-id", "branch-lagos-main")
      .set("x-role", "cashier")
      .set("x-user-id", "cashier-1")
      .send({
        branchId: "branch-lagos-main",
        terminalId: "terminal-web-1",
        idempotencyKey: "terminal-web-1-low-stock-check",
        lines: [{ productId: "p5", quantity: 999, discount: 0 }],
        payments: [{ method: "cash", amount: 16296188 }]
      });

    expect(response.status).toBe(409);
    expect(response.body.error).toBe("Seafood Okra Bowl has insufficient stock");
  });

  it("lists kitchen tickets by station", async () => {
    const response = await request(app)
      .get("/api/v1/kitchen/tickets?station=Kitchen")
      .set("x-tenant-id", "tenant-lagos-foods")
      .set("x-branch-id", "branch-lagos-main")
      .set("x-role", "kitchen")
      .set("x-user-id", "kitchen-1");

    expect(response.status).toBe(200);
    expect(response.body.tickets.every((ticket: { station: string }) => ticket.station === "Kitchen")).toBe(true);
  });

  it("blocks cashiers from reading kitchen tickets", async () => {
    const response = await request(app)
      .get("/api/v1/kitchen/tickets?branchId=branch-lagos-main")
      .set("x-tenant-id", "tenant-lagos-foods")
      .set("x-branch-id", "branch-lagos-main")
      .set("x-role", "cashier")
      .set("x-user-id", "cashier-1");

    expect(response.status).toBe(403);
    expect(response.body).toMatchObject({ error: "Permission denied", permission: "kitchen.manage" });
  });

  it("lets city managers work kitchen tickets only across branches in their city", async () => {
    if (!branches.some((branch) => branch.id === "branch-lagos-outside-city")) {
      branches.push({
        id: "branch-lagos-outside-city",
        tenantId: "tenant-lagos-foods",
        name: "Outside City Branch",
        address: "1 Ring Road",
        city: "Ibadan",
        phone: "+2348010000099",
        status: "active",
        createdAt: new Date().toISOString()
      });
    }

    if (!prepTickets.some((ticket) => ticket.id === "KOT-CITY-IKEJA")) {
      prepTickets.unshift({
        id: "KOT-CITY-IKEJA",
        tenantId: "tenant-lagos-foods",
        branchId: "branch-lagos-ikeja",
        station: "Kitchen",
        tableLabel: "IKJ-01",
        waiterId: "waiter-2",
        serviceType: "dine_in",
        priority: "normal",
        status: "new",
        items: [
          {
            id: "prep-city-ikeja-item",
            productId: "p1",
            productName: "City Scope Kitchen Meal",
            quantity: 1,
            modifiers: [],
            status: "new"
          }
        ],
        createdAt: new Date().toISOString()
      });
    }

    if (!prepTickets.some((ticket) => ticket.id === "KOT-CITY-OUTSIDE")) {
      prepTickets.unshift({
        id: "KOT-CITY-OUTSIDE",
        tenantId: "tenant-lagos-foods",
        branchId: "branch-lagos-outside-city",
        station: "Kitchen",
        tableLabel: "IBD-01",
        waiterId: "waiter-2",
        serviceType: "dine_in",
        priority: "normal",
        status: "new",
        items: [
          {
            id: "prep-city-outside-item",
            productId: "p1",
            productName: "Outside Scope Kitchen Meal",
            quantity: 1,
            modifiers: [],
            status: "new"
          }
        ],
        createdAt: new Date().toISOString()
      });
    }

    const listResponse = await request(app)
      .get("/api/v1/kitchen/tickets?station=Kitchen")
      .set("x-tenant-id", "tenant-lagos-foods")
      .set("x-role", "state_manager")
      .set("x-user-id", "LCF-MAI-TUN");
    const updateResponse = await request(app)
      .patch("/api/v1/kitchen/tickets/KOT-CITY-IKEJA/status")
      .set("x-tenant-id", "tenant-lagos-foods")
      .set("x-role", "state_manager")
      .set("x-user-id", "LCF-MAI-TUN")
      .send({ status: "accepted", note: "City manager accepted" });
    const outsideUpdateResponse = await request(app)
      .patch("/api/v1/kitchen/tickets/KOT-CITY-OUTSIDE/status")
      .set("x-tenant-id", "tenant-lagos-foods")
      .set("x-role", "state_manager")
      .set("x-user-id", "LCF-MAI-TUN")
      .send({ status: "accepted", note: "Outside city attempt" });
    const outsideBranchResponse = await request(app)
      .get("/api/v1/kitchen/tickets?branchId=branch-lagos-outside-city")
      .set("x-tenant-id", "tenant-lagos-foods")
      .set("x-role", "state_manager")
      .set("x-user-id", "LCF-MAI-TUN");

    expect(listResponse.status).toBe(200);
    expect(listResponse.body.tickets).toEqual(expect.arrayContaining([expect.objectContaining({ id: "KOT-CITY-IKEJA" })]));
    expect(listResponse.body.tickets).not.toEqual(expect.arrayContaining([expect.objectContaining({ id: "KOT-CITY-OUTSIDE" })]));
    expect(updateResponse.status).toBe(200);
    expect(updateResponse.body.ticket).toMatchObject({ id: "KOT-CITY-IKEJA", status: "accepted" });
    expect(outsideUpdateResponse.status).toBe(404);
    expect(outsideBranchResponse.status).toBe(403);
  });

  it("allows kitchen staff to mark tickets ready", async () => {
    const response = await request(app)
      .patch("/api/v1/kitchen/tickets/KOT-1088/status")
      .set("x-tenant-id", "tenant-lagos-foods")
      .set("x-branch-id", "branch-lagos-main")
      .set("x-role", "kitchen")
      .set("x-user-id", "kitchen-1")
      .send({ status: "ready", note: "Pickup window" });

    expect(response.status).toBe(200);
    expect(response.body.ticket).toMatchObject({
      id: "KOT-1088",
      status: "ready"
    });
    expect(response.body.ticket.readyAt).toBeTruthy();
  });

  it("lists kitchen tickets by station and status", async () => {
    const response = await request(app)
      .get("/api/v1/kitchen/tickets?branchId=branch-lagos-main&station=Kitchen&status=ready")
      .set("x-tenant-id", "tenant-lagos-foods")
      .set("x-branch-id", "branch-lagos-main")
      .set("x-role", "kitchen")
      .set("x-user-id", "kitchen-1");

    expect(response.status).toBe(200);
    expect(response.body.tickets.length).toBeGreaterThan(0);
    expect(response.body.tickets.every((ticket: { station: string; status: string }) => ticket.station === "Kitchen" && ticket.status === "ready")).toBe(true);
  });

  it("allows kitchen staff to change prep ticket priority", async () => {
    const response = await request(app)
      .patch("/api/v1/kitchen/tickets/KOT-1090/priority")
      .set("x-tenant-id", "tenant-lagos-foods")
      .set("x-branch-id", "branch-lagos-main")
      .set("x-role", "kitchen")
      .set("x-user-id", "kitchen-1")
      .send({ priority: "rush", note: "Guest waiting" });

    expect(response.status).toBe(200);
    expect(response.body.ticket).toMatchObject({ id: "KOT-1090", priority: "rush" });
  });

  it("allows station staff to update individual prep ticket items", async () => {
    const response = await request(app)
      .patch("/api/v1/kitchen/tickets/BOT-1089/items/item-3/status")
      .set("x-tenant-id", "tenant-lagos-foods")
      .set("x-branch-id", "branch-lagos-main")
      .set("x-role", "bar")
      .set("x-user-id", "bar-1")
      .send({ status: "ready", note: "Drink finished" });
    const floorResponse = await request(app)
      .get("/api/v1/restaurant/tables?branchId=branch-lagos-main")
      .set("x-tenant-id", "tenant-lagos-foods")
      .set("x-branch-id", "branch-lagos-main")
      .set("x-role", "manager")
      .set("x-user-id", "manager-1");

    expect(response.status).toBe(200);
    expect(response.body.ticket.items[0]).toMatchObject({ id: "item-3", status: "ready" });
    expect(response.body.ticket.status).toBe("ready");
    expect(floorResponse.body.openOrders.find((order: { id: string }) => order.id === "table-order-2")).toMatchObject({
      prepStatus: "ready"
    });
  });

  it("allows kitchen staff to mark ready tickets served", async () => {
    const response = await request(app)
      .patch("/api/v1/kitchen/tickets/BOT-1089/status")
      .set("x-tenant-id", "tenant-lagos-foods")
      .set("x-branch-id", "branch-lagos-main")
      .set("x-role", "bar")
      .set("x-user-id", "bar-1")
      .send({ status: "served", note: "Delivered to table" });

    expect(response.status).toBe(200);
    expect(response.body.ticket).toMatchObject({ id: "BOT-1089", status: "served" });
    expect(response.body.ticket.servedAt).toBeTruthy();
  });

  it("requires kitchen ticket updates to use the ticket branch", async () => {
    const response = await request(app)
      .patch("/api/v1/kitchen/tickets/KOT-1088/status")
      .set("x-tenant-id", "tenant-lagos-foods")
      .set("x-branch-id", "branch-abuja-main")
      .set("x-role", "kitchen")
      .set("x-user-id", "kitchen-1")
      .send({ status: "accepted", note: "Wrong branch" });

    expect(response.status).toBe(404);
    expect(response.body.error).toBe("Ticket not found");
  });

  it("requires branch-scoped kitchen users to carry branch context for ticket updates", async () => {
    const listResponse = await request(app)
      .get("/api/v1/kitchen/tickets?branchId=branch-lagos-main&station=Kitchen")
      .set("x-tenant-id", "tenant-lagos-foods")
      .set("x-role", "kitchen")
      .set("x-user-id", "kitchen-1");
    const statusResponse = await request(app)
      .patch("/api/v1/kitchen/tickets/KOT-1088/status")
      .set("x-tenant-id", "tenant-lagos-foods")
      .set("x-role", "kitchen")
      .set("x-user-id", "kitchen-1")
      .send({ status: "accepted", note: "Missing branch context" });
    const priorityResponse = await request(app)
      .patch("/api/v1/kitchen/tickets/KOT-1090/priority")
      .set("x-tenant-id", "tenant-lagos-foods")
      .set("x-role", "kitchen")
      .set("x-user-id", "kitchen-1")
      .send({ priority: "rush", note: "Missing branch context" });
    const itemResponse = await request(app)
      .patch("/api/v1/kitchen/tickets/BOT-1089/items/item-3/status")
      .set("x-tenant-id", "tenant-lagos-foods")
      .set("x-role", "bar")
      .set("x-user-id", "bar-1")
      .send({ status: "ready", note: "Missing branch context" });

    expect(listResponse.status).toBe(403);
    expect(statusResponse.status).toBe(403);
    expect(priorityResponse.status).toBe(403);
    expect(itemResponse.status).toBe(403);
    expect(listResponse.body.error).toBe("Branch access denied");
    expect(statusResponse.body.error).toBe("Branch access denied");
    expect(priorityResponse.body.error).toBe("Branch access denied");
    expect(itemResponse.body.error).toBe("Branch access denied");
  });

  it("allows all-branch users to update kitchen tickets without branch context", async () => {
    const response = await request(app)
      .patch("/api/v1/kitchen/tickets/KOT-1088/status")
      .set("x-tenant-id", "tenant-lagos-foods")
      .set("x-role", "state_manager")
      .set("x-user-id", "state-manager-1")
      .send({ status: "preparing", note: "State manager support" });

    expect(response.status).toBe(200);
    expect(response.body.ticket).toMatchObject({ id: "KOT-1088", status: "preparing" });
  });

  it("blocks cashiers from updating prep ticket status", async () => {
    const response = await request(app)
      .patch("/api/v1/kitchen/tickets/BOT-1089/status")
      .set("x-tenant-id", "tenant-lagos-foods")
      .set("x-branch-id", "branch-lagos-main")
      .set("x-role", "cashier")
      .set("x-user-id", "cashier-1")
      .send({ status: "accepted" });

    expect(response.status).toBe(403);
  });

  it("allows cashiers to search tenant customers", async () => {
    const response = await request(app)
      .get("/api/v1/customers?q=amina")
      .set("x-tenant-id", "tenant-lagos-foods")
      .set("x-branch-id", "branch-lagos-main")
      .set("x-role", "cashier")
      .set("x-user-id", "cashier-1");

    expect(response.status).toBe(200);
    expect(response.body.customers[0]).toMatchObject({ name: "Amina Bello" });
  });

  it("blocks staff without sales or customer permissions from customer search", async () => {
    const response = await request(app)
      .get("/api/v1/customers?q=amina")
      .set("x-tenant-id", "tenant-lagos-foods")
      .set("x-branch-id", "branch-lagos-main")
      .set("x-role", "kitchen")
      .set("x-user-id", "kitchen-1");

    expect(response.status).toBe(403);
    expect(response.body).toMatchObject({ error: "Permission denied", permission: "sale.create" });
  });

  it("blocks cashiers from reading customer account ledgers", async () => {
    const response = await request(app)
      .get("/api/v1/customers/cust-2/ledger")
      .set("x-tenant-id", "tenant-lagos-foods")
      .set("x-branch-id", "branch-lagos-main")
      .set("x-role", "cashier")
      .set("x-user-id", "cashier-1");

    expect(response.status).toBe(403);
    expect(response.body).toMatchObject({ error: "Permission denied", permission: "customer.manage" });
  });

  it("allows managers to create customers", async () => {
    const response = await request(app)
      .post("/api/v1/customers")
      .set("x-tenant-id", "tenant-lagos-foods")
      .set("x-branch-id", "branch-lagos-main")
      .set("x-role", "manager")
      .set("x-user-id", "manager-1")
      .send({
        name: "Ada Green",
        phone: "+2348099999999",
        email: "ada@example.com",
        group: "VIP",
        creditLimit: 50000,
        loyaltyPoints: 100,
        notes: "Likes WhatsApp receipts"
      });

    expect(response.status).toBe(201);
    expect(response.body.customer).toMatchObject({ name: "Ada Green", outstandingBalance: 0 });
  });

  it("requires branch context for branch-scoped customer writes", async () => {
    const createResponse = await request(app)
      .post("/api/v1/customers")
      .set("x-tenant-id", "tenant-lagos-foods")
      .set("x-role", "manager")
      .set("x-user-id", "manager-1")
      .send({
        name: "No Branch Customer",
        phone: "+2348099999911",
        email: "nobranch@example.com",
        group: "VIP",
        creditLimit: 50000,
        loyaltyPoints: 100,
        notes: "Missing branch"
      });

    const updateResponse = await request(app)
      .patch("/api/v1/customers/cust-1")
      .set("x-tenant-id", "tenant-lagos-foods")
      .set("x-role", "manager")
      .set("x-user-id", "manager-1")
      .send({ notes: "Missing branch update" });

    const ledgerResponse = await request(app)
      .post("/api/v1/customers/cust-2/ledger")
      .set("x-tenant-id", "tenant-lagos-foods")
      .set("x-role", "manager")
      .set("x-user-id", "LCF-MAI-CHI")
      .send({
        type: "payment",
        amount: -1000,
        pointsDelta: 0,
        note: "Missing branch ledger",
        paymentMethod: "card",
        paymentReference: "NO-BRANCH"
      });
    const ledgerReadResponse = await request(app)
      .get("/api/v1/customers/cust-2/ledger")
      .set("x-tenant-id", "tenant-lagos-foods")
      .set("x-role", "manager")
      .set("x-user-id", "manager-1");

    expect(createResponse.status).toBe(403);
    expect(updateResponse.status).toBe(403);
    expect(ledgerResponse.status).toBe(403);
    expect(ledgerReadResponse.status).toBe(403);
    expect(createResponse.body.error).toBe("Branch access denied");
    expect(updateResponse.body.error).toBe("Branch access denied");
    expect(ledgerResponse.body.error).toBe("Branch access denied");
    expect(ledgerReadResponse.body.error).toBe("Branch access denied");
  });

  it("lets city managers read customer ledger activity only inside their branch city", async () => {
    if (!branches.some((branch) => branch.id === "branch-lagos-outside-city")) {
      branches.push({
        id: "branch-lagos-outside-city",
        tenantId: "tenant-lagos-foods",
        name: "Ibadan Road Test Branch",
        address: "1 Test Road",
        city: "Ibadan",
        phone: "+2348099990000",
        status: "active",
        createdAt: new Date().toISOString()
      });
    }

    const ikejaLedgerResponse = await request(app)
      .post("/api/v1/customers/cust-1/ledger")
      .set("x-tenant-id", "tenant-lagos-foods")
      .set("x-branch-id", "branch-lagos-ikeja")
      .set("x-role", "owner")
      .set("x-user-id", "LCF-MAI-ADA")
      .send({
        type: "loyalty_adjustment",
        amount: 0,
        pointsDelta: 1,
        note: "Ikeja loyalty correction"
      });
    const outsideLedgerResponse = await request(app)
      .post("/api/v1/customers/cust-1/ledger")
      .set("x-tenant-id", "tenant-lagos-foods")
      .set("x-branch-id", "branch-lagos-outside-city")
      .set("x-role", "owner")
      .set("x-user-id", "LCF-MAI-ADA")
      .send({
        type: "loyalty_adjustment",
        amount: 0,
        pointsDelta: 1,
        note: "Outside city loyalty correction"
      });
    const ledgerResponse = await request(app)
      .get("/api/v1/customers/cust-1/ledger")
      .set("x-tenant-id", "tenant-lagos-foods")
      .set("x-role", "state_manager")
      .set("x-user-id", "LCF-MAI-TUN");
    const outsideReadResponse = await request(app)
      .get("/api/v1/customers/cust-1/ledger?branchId=branch-lagos-outside-city")
      .set("x-tenant-id", "tenant-lagos-foods")
      .set("x-role", "state_manager")
      .set("x-user-id", "LCF-MAI-TUN");

    expect(ikejaLedgerResponse.status).toBe(201);
    expect(outsideLedgerResponse.status).toBe(201);
    expect(ledgerResponse.status).toBe(200);
    expect(ledgerResponse.body.entries.some((entry: { id: string }) => entry.id === ikejaLedgerResponse.body.entry.id)).toBe(true);
    expect(ledgerResponse.body.entries.some((entry: { id: string }) => entry.id === outsideLedgerResponse.body.entry.id)).toBe(false);
    expect(outsideReadResponse.status).toBe(403);
    expect(outsideReadResponse.body.error).toBe("Branch access denied");
  });

  it("prevents customer credit limit overrides", async () => {
    const response = await request(app)
      .post("/api/v1/customers/cust-1/ledger")
      .set("x-tenant-id", "tenant-lagos-foods")
      .set("x-branch-id", "branch-lagos-main")
      .set("x-role", "manager")
      .set("x-user-id", "manager-1")
      .send({
        type: "credit_sale",
        amount: 5000,
        pointsDelta: 50,
        note: "Unauthorized credit"
      });

    expect(response.status).toBe(409);
  });

  it("records customer account payments in the ledger", async () => {
    const registerBefore = await request(app)
      .get("/api/v1/registers/current?branchId=branch-lagos-main&terminalId=terminal-web-1")
      .set("x-tenant-id", "tenant-lagos-foods")
      .set("x-branch-id", "branch-lagos-main")
      .set("x-role", "manager")
      .set("x-user-id", "manager-1");
    const response = await request(app)
      .post("/api/v1/customers/cust-2/ledger")
      .set("x-tenant-id", "tenant-lagos-foods")
      .set("x-branch-id", "branch-lagos-main")
      .set("x-role", "manager")
      .set("x-user-id", "manager-1")
      .send({
        type: "payment",
        amount: -5000,
        pointsDelta: 0,
        note: "Part account payment",
        paymentMethod: "cash",
        terminalId: "terminal-web-1"
      });
    const registerAfter = await request(app)
      .get("/api/v1/registers/current?branchId=branch-lagos-main&terminalId=terminal-web-1")
      .set("x-tenant-id", "tenant-lagos-foods")
      .set("x-branch-id", "branch-lagos-main")
      .set("x-role", "manager")
      .set("x-user-id", "manager-1");
    const today = new Date().toISOString().slice(0, 10);
    const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const ledgerRangeResponse = await request(app)
      .get(`/api/v1/customers/cust-2/ledger?startDate=${today}&endDate=${today}`)
      .set("x-tenant-id", "tenant-lagos-foods")
      .set("x-branch-id", "branch-lagos-main")
      .set("x-role", "manager")
      .set("x-user-id", "manager-1");
    const invalidDateResponse = await request(app)
      .get("/api/v1/customers/cust-2/ledger?startDate=not-a-date")
      .set("x-tenant-id", "tenant-lagos-foods")
      .set("x-branch-id", "branch-lagos-main")
      .set("x-role", "manager")
      .set("x-user-id", "manager-1");
    const invertedDateResponse = await request(app)
      .get(`/api/v1/customers/cust-2/ledger?startDate=${tomorrow}&endDate=${today}`)
      .set("x-tenant-id", "tenant-lagos-foods")
      .set("x-branch-id", "branch-lagos-main")
      .set("x-role", "manager")
      .set("x-user-id", "manager-1");

    expect(registerBefore.status).toBe(200);
    expect(response.status).toBe(201);
    expect(response.body.entry).toMatchObject({ type: "payment", amount: -5000 });
    expect(response.body.movement).toMatchObject({ type: "cash_in", amount: 5000, expectedCashAfter: registerBefore.body.shift.expectedCash + 5000 });
    expect(response.body.customer.outstandingBalance).toBeLessThan(38500);
    expect(registerAfter.body.shift.expectedCash).toBe(registerBefore.body.shift.expectedCash + 5000);
    expect(ledgerRangeResponse.status).toBe(200);
    expect(ledgerRangeResponse.body.entries).toEqual(expect.arrayContaining([expect.objectContaining({ id: response.body.entry.id })]));
    expect(invalidDateResponse.status).toBe(400);
    expect(invertedDateResponse.status).toBe(400);
  });

  it("blocks customer account overpayments", async () => {
    const response = await request(app)
      .post("/api/v1/customers/cust-2/ledger")
      .set("x-tenant-id", "tenant-lagos-foods")
      .set("x-branch-id", "branch-lagos-main")
      .set("x-role", "manager")
      .set("x-user-id", "manager-1")
      .send({
        type: "payment",
        amount: -1000000,
        pointsDelta: 0,
        note: "Overpay account",
        paymentMethod: "cash",
        terminalId: "terminal-web-1"
      });

    expect(response.status).toBe(409);
    expect(response.body.error).toBe("Customer payment exceeds outstanding balance");
  });

  it("lists staff with derived permissions", async () => {
    const response = await request(app)
      .get("/api/v1/staff")
      .set("x-tenant-id", "tenant-lagos-foods")
      .set("x-branch-id", "branch-lagos-main")
      .set("x-role", "manager")
      .set("x-user-id", "manager-1");

    expect(response.status).toBe(200);
    expect(response.body.staff[0].permissions).toBeDefined();
  });

  it("blocks cashiers from staff list reads but allows restaurant staff options", async () => {
    const staffResponse = await request(app)
      .get("/api/v1/staff?branchId=branch-lagos-main")
      .set("x-tenant-id", "tenant-lagos-foods")
      .set("x-branch-id", "branch-lagos-main")
      .set("x-role", "cashier")
      .set("x-user-id", "cashier-1");
    const floorStaffResponse = await request(app)
      .get("/api/v1/restaurant/staff-options?branchId=branch-lagos-main")
      .set("x-tenant-id", "tenant-lagos-foods")
      .set("x-branch-id", "branch-lagos-main")
      .set("x-role", "waiter")
      .set("x-user-id", "waiter-2");

    expect(staffResponse.status).toBe(403);
    expect(staffResponse.body).toMatchObject({ error: "Permission denied", permission: "staff.manage" });
    expect(floorStaffResponse.status).toBe(200);
    expect(floorStaffResponse.body.staff[0]).toMatchObject({
      id: expect.any(String),
      name: expect.any(String),
      role: expect.any(String),
      active: true
    });
    expect(floorStaffResponse.body.staff[0].permissions).toBeUndefined();
  });

  it("lets city managers manage staff only across branches in their city", async () => {
    if (!branches.some((branch) => branch.id === "branch-lagos-outside-city")) {
      branches.push({
        id: "branch-lagos-outside-city",
        tenantId: "tenant-lagos-foods",
        name: "Outside City Branch",
        address: "1 Ring Road",
        city: "Ibadan",
        phone: "+2348000000200",
        status: "active",
        createdAt: "2026-07-30T08:00:00.000Z"
      });
    }

    const ikejaStaffResponse = await request(app)
      .post("/api/v1/staff")
      .set("x-tenant-id", "tenant-lagos-foods")
      .set("x-role", "owner")
      .set("x-user-id", "owner-1")
      .send({
        branchId: "branch-lagos-ikeja",
        name: "Ikeja Staff Scope",
        email: "ikejastaffscope@example.com",
        phone: "+2348077777101",
        role: "cashier",
        pinEnabled: true,
        active: true
      });
    const outsideStaffResponse = await request(app)
      .post("/api/v1/staff")
      .set("x-tenant-id", "tenant-lagos-foods")
      .set("x-role", "owner")
      .set("x-user-id", "owner-1")
      .send({
        branchId: "branch-lagos-outside-city",
        name: "Outside Staff Scope",
        email: "outsidestaffscope@example.com",
        phone: "+2348077777102",
        role: "cashier",
        pinEnabled: true,
        active: true
      });

    expect(ikejaStaffResponse.status).toBe(201);
    expect(outsideStaffResponse.status).toBe(201);

    const listResponse = await request(app)
      .get("/api/v1/staff")
      .set("x-tenant-id", "tenant-lagos-foods")
      .set("x-role", "state_manager")
      .set("x-user-id", "LCF-MAI-TUN");
    const statusResponse = await request(app)
      .patch(`/api/v1/staff/${ikejaStaffResponse.body.staff.id}/status`)
      .set("x-tenant-id", "tenant-lagos-foods")
      .set("x-role", "state_manager")
      .set("x-user-id", "LCF-MAI-TUN")
      .send({ active: true, reason: "City scope status update" });
    const outsideStatusResponse = await request(app)
      .patch(`/api/v1/staff/${outsideStaffResponse.body.staff.id}/status`)
      .set("x-tenant-id", "tenant-lagos-foods")
      .set("x-role", "state_manager")
      .set("x-user-id", "LCF-MAI-TUN")
      .send({ active: true, reason: "Outside city status update" });
    const outsideListResponse = await request(app)
      .get("/api/v1/staff?branchId=branch-lagos-outside-city")
      .set("x-tenant-id", "tenant-lagos-foods")
      .set("x-role", "state_manager")
      .set("x-user-id", "LCF-MAI-TUN");

    const staffIds = listResponse.body.staff.map((member: { id: string }) => member.id);
    expect(listResponse.status).toBe(200);
    expect(staffIds).toContain(ikejaStaffResponse.body.staff.id);
    expect(staffIds).not.toContain(outsideStaffResponse.body.staff.id);
    expect(statusResponse.status).toBe(200);
    expect(outsideStatusResponse.status).toBe(404);
    expect(outsideListResponse.status).toBe(403);
  });

  it("lets signed-in staff view and update their own profile without staff management permission", async () => {
    const profileResponse = await request(app)
      .get("/api/v1/staff/me")
      .set("x-tenant-id", "tenant-lagos-foods")
      .set("x-branch-id", "branch-lagos-main")
      .set("x-role", "cashier")
      .set("x-user-id", "LCF-MAI-MUS");

    const updateResponse = await request(app)
      .patch("/api/v1/staff/me")
      .set("x-tenant-id", "tenant-lagos-foods")
      .set("x-branch-id", "branch-lagos-main")
      .set("x-role", "cashier")
      .set("x-user-id", "LCF-MAI-MUS")
      .send({
        name: "Chinelo Cashier",
        email: "chinelo.cashier@example.com",
        phone: "+2348022222299"
      });

    const duplicateResponse = await request(app)
      .patch("/api/v1/staff/me")
      .set("x-tenant-id", "tenant-lagos-foods")
      .set("x-branch-id", "branch-lagos-main")
      .set("x-role", "cashier")
      .set("x-user-id", "LCF-MAI-MUS")
      .send({
        name: "Chinelo Cashier",
        email: "adaeze@example.com",
        phone: "+2348022222299"
      });
    const restoreResponse = await request(app)
      .patch("/api/v1/staff/me")
      .set("x-tenant-id", "tenant-lagos-foods")
      .set("x-branch-id", "branch-lagos-main")
      .set("x-role", "cashier")
      .set("x-user-id", "LCF-MAI-MUS")
      .send({
        name: profileResponse.body.staff.name,
        email: profileResponse.body.staff.email,
        phone: profileResponse.body.staff.phone
      });

    expect(profileResponse.status).toBe(200);
    expect(profileResponse.body.staff).toMatchObject({ id: "LCF-MAI-MUS" });
    expect(updateResponse.status).toBe(200);
    expect(updateResponse.body.staff).toMatchObject({
      id: "LCF-MAI-MUS",
      name: "Chinelo Cashier",
      email: "chinelo.cashier@example.com",
      phone: "+2348022222299",
      role: "cashier"
    });
    expect(updateResponse.body.staff.permissions).toContain("sale.create");
    expect(duplicateResponse.status).toBe(409);
    expect(duplicateResponse.body.error).toBe("Staff email already exists for this tenant");
    expect(restoreResponse.status).toBe(200);
  });

  it("lets signed-in staff update their own password and PIN", async () => {
    const securityResponse = await request(app)
      .patch("/api/v1/staff/me/security")
      .set("x-tenant-id", "tenant-lagos-foods")
      .set("x-branch-id", "branch-lagos-main")
      .set("x-role", "cashier")
      .set("x-user-id", "LCF-MAI-MUS")
      .send({
        currentPassword: "Password123!",
        newPassword: "Password456!",
        newPin: "654321",
        pinEnabled: true
      });

    const oldPasswordResponse = await request(app)
      .post("/api/v1/auth/login")
      .send({
        tenantId: "tenant-lagos-foods",
        identifier: "musa@example.com",
        password: "Password123!",
        terminalId: "terminal-web-1"
      });

    const newPasswordResponse = await request(app)
      .post("/api/v1/auth/login")
      .send({
        tenantId: "tenant-lagos-foods",
        identifier: "musa@example.com",
        password: "Password456!",
        terminalId: "terminal-web-1"
      });

    const newPinResponse = await request(app)
      .post("/api/v1/auth/pin-login")
      .send({
        tenantId: "tenant-lagos-foods",
        terminalId: "terminal-web-1",
        staffId: "LCF-MAI-MUS",
        pin: "654321"
      });

    const restoreResponse = await request(app)
      .patch("/api/v1/staff/me/security")
      .set("x-tenant-id", "tenant-lagos-foods")
      .set("x-branch-id", "branch-lagos-main")
      .set("x-role", "cashier")
      .set("x-user-id", "LCF-MAI-MUS")
      .send({
        currentPassword: "Password456!",
        newPassword: "Password123!",
        newPin: "123456",
        pinEnabled: true
      });

    const badCurrentPasswordResponse = await request(app)
      .patch("/api/v1/staff/me/security")
      .set("x-tenant-id", "tenant-lagos-foods")
      .set("x-branch-id", "branch-lagos-main")
      .set("x-role", "cashier")
      .set("x-user-id", "LCF-MAI-MUS")
      .send({
        currentPassword: "wrong-password",
        newPin: "111111",
        pinEnabled: true
      });

    expect(securityResponse.status).toBe(200);
    expect(securityResponse.body.staff).toMatchObject({ id: "LCF-MAI-MUS", pinEnabled: true });
    expect(oldPasswordResponse.status).toBe(401);
    expect(newPasswordResponse.status).toBe(200);
    expect(newPinResponse.status).toBe(200);
    expect(restoreResponse.status).toBe(200);
    expect(badCurrentPasswordResponse.status).toBe(401);
  });

  it("lets staff managers reset staff temporary passwords and PIN access", async () => {
    const resetResponse = await request(app)
      .patch("/api/v1/staff/LCF-MAI-MUS/security")
      .set("x-tenant-id", "tenant-lagos-foods")
      .set("x-branch-id", "branch-lagos-main")
      .set("x-role", "owner")
      .set("x-user-id", "LCF-MAI-ADA")
      .send({
        temporaryPassword: "TempPass456!",
        pin: "654321",
        pinEnabled: true,
        reason: "Cashier forgot credentials"
      });

    const passwordResponse = await request(app)
      .post("/api/v1/auth/login")
      .send({
        tenantId: "tenant-lagos-foods",
        identifier: "musa@example.com",
        password: "TempPass456!",
        terminalId: "terminal-web-1"
      });

    const pinResponse = await request(app)
      .post("/api/v1/auth/pin-login")
      .send({
        tenantId: "tenant-lagos-foods",
        terminalId: "terminal-web-1",
        staffId: "LCF-MAI-MUS",
        pin: "654321"
      });

    const selfResetResponse = await request(app)
      .patch("/api/v1/staff/LCF-MAI-ADA/security")
      .set("x-tenant-id", "tenant-lagos-foods")
      .set("x-branch-id", "branch-lagos-main")
      .set("x-role", "owner")
      .set("x-user-id", "LCF-MAI-ADA")
      .send({
        temporaryPassword: "OwnerTemp456!",
        reason: "Self reset attempt"
      });

    const restoreResponse = await request(app)
      .patch("/api/v1/staff/LCF-MAI-MUS/security")
      .set("x-tenant-id", "tenant-lagos-foods")
      .set("x-branch-id", "branch-lagos-main")
      .set("x-role", "owner")
      .set("x-user-id", "LCF-MAI-ADA")
      .send({
        temporaryPassword: "Password123!",
        pin: "123456",
        pinEnabled: true,
        reason: "Restore seeded credentials"
      });

    expect(resetResponse.status).toBe(200);
    expect(resetResponse.body.staff).toMatchObject({ id: "LCF-MAI-MUS", pinEnabled: true });
    expect(passwordResponse.status).toBe(200);
    expect(pinResponse.status).toBe(200);
    expect(selfResetResponse.status).toBe(409);
    expect(restoreResponse.status).toBe(200);
  });

  it("lets owners manage roles, permissions, and staff role assignments", async () => {
    const listResponse = await request(app)
      .get("/api/v1/roles")
      .set("x-tenant-id", "tenant-lagos-foods")
      .set("x-role", "owner")
      .set("x-user-id", "LCF-MAI-ADA");

    expect(listResponse.status).toBe(200);
    expect(listResponse.body.permissions.map((permission: { action: string }) => permission.action)).toContain("roles.manage");
    expect(listResponse.body.roles.map((role: { name: string }) => role.name)).toContain("owner");

    const managerResponse = await request(app)
      .get("/api/v1/roles")
      .set("x-tenant-id", "tenant-lagos-foods")
      .set("x-branch-id", "branch-lagos-main")
      .set("x-role", "manager")
      .set("x-user-id", "manager-1");

    expect(managerResponse.status).toBe(403);

    const optionsResponse = await request(app)
      .get("/api/v1/roles/options")
      .set("x-tenant-id", "tenant-lagos-foods")
      .set("x-branch-id", "branch-lagos-main")
      .set("x-role", "manager")
      .set("x-user-id", "manager-1");

    expect(optionsResponse.status).toBe(200);
    expect(optionsResponse.body.roles.map((role: { name: string }) => role.name)).toContain("cashier");
    expect(optionsResponse.body.roles[0].permissions).toEqual([]);

    const createResponse = await request(app)
      .post("/api/v1/roles")
      .set("x-tenant-id", "tenant-lagos-foods")
      .set("x-role", "owner")
      .set("x-user-id", "LCF-MAI-ADA")
      .send({ name: "floor_supervisor", label: "Floor Supervisor", description: "Can run floor and kitchen workflows." });

    expect(createResponse.status).toBe(201);
    expect(createResponse.body.role).toMatchObject({ name: "floor_supervisor", system: false });

    const permissionResponse = await request(app)
      .patch(`/api/v1/roles/${createResponse.body.role.id}/permissions`)
      .set("x-tenant-id", "tenant-lagos-foods")
      .set("x-role", "owner")
      .set("x-user-id", "LCF-MAI-ADA")
      .send({ permissions: ["restaurant.manage", "kitchen.manage"] });

    expect(permissionResponse.status).toBe(200);
    expect(permissionResponse.body.role.permissions).toEqual(["restaurant.manage", "kitchen.manage"]);

    const assignResponse = await request(app)
      .post("/api/v1/roles/assign-staff")
      .set("x-tenant-id", "tenant-lagos-foods")
      .set("x-role", "owner")
      .set("x-user-id", "LCF-MAI-ADA")
      .send({ staffId: "LCF-MAI-SAR", role: "floor_supervisor" });

    expect(assignResponse.status).toBe(200);
    expect(assignResponse.body).toMatchObject({ staffId: "LCF-MAI-SAR", role: "floor_supervisor" });

    const assignedProfileResponse = await request(app)
      .get("/api/v1/staff/me")
      .set("x-tenant-id", "tenant-lagos-foods")
      .set("x-branch-id", "branch-lagos-main")
      .set("x-role", "floor_supervisor")
      .set("x-user-id", "LCF-MAI-SAR");

    const allowedTableResponse = await request(app)
      .post("/api/v1/restaurant/tables")
      .set("x-tenant-id", "tenant-lagos-foods")
      .set("x-branch-id", "branch-lagos-main")
      .set("x-role", "floor_supervisor")
      .set("x-user-id", "LCF-MAI-SAR")
      .send({ branchId: "branch-lagos-main", area: "Patio", label: "RBAC-1", seats: 4, x: 20, y: 30 });

    const removedPermissionResponse = await request(app)
      .patch(`/api/v1/roles/${createResponse.body.role.id}/permissions`)
      .set("x-tenant-id", "tenant-lagos-foods")
      .set("x-role", "owner")
      .set("x-user-id", "LCF-MAI-ADA")
      .send({ permissions: [] });

    const deniedTableResponse = await request(app)
      .post("/api/v1/restaurant/tables")
      .set("x-tenant-id", "tenant-lagos-foods")
      .set("x-branch-id", "branch-lagos-main")
      .set("x-role", "floor_supervisor")
      .set("x-user-id", "LCF-MAI-SAR")
      .send({ branchId: "branch-lagos-main", area: "Patio", label: "RBAC-2", seats: 4, x: 25, y: 35 });

    const strippedProfileResponse = await request(app)
      .get("/api/v1/staff/me")
      .set("x-tenant-id", "tenant-lagos-foods")
      .set("x-branch-id", "branch-lagos-main")
      .set("x-role", "floor_supervisor")
      .set("x-user-id", "LCF-MAI-SAR");

    expect(assignedProfileResponse.body.staff).toMatchObject({ id: "LCF-MAI-SAR", role: "floor_supervisor" });
    expect(assignedProfileResponse.body.staff.permissions).toEqual(["restaurant.manage", "kitchen.manage"]);
    expect(allowedTableResponse.status).toBe(201);
    expect(removedPermissionResponse.status).toBe(200);
    expect(removedPermissionResponse.body.role.permissions).toEqual([]);
    expect(strippedProfileResponse.body.staff.permissions).toEqual([]);
    expect(deniedTableResponse.status).toBe(403);
    expect(deniedTableResponse.body).toMatchObject({ error: "Permission denied", permission: "restaurant.manage" });
  });

  it("prevents assigning roles to staff outside the request branch", async () => {
    const response = await request(app)
      .post("/api/v1/roles/assign-staff")
      .set("x-tenant-id", "tenant-lagos-foods")
      .set("x-branch-id", "branch-abuja-main")
      .set("x-role", "owner")
      .set("x-user-id", "LCF-MAI-ADA")
      .send({ staffId: "LCF-MAI-MUS", role: "cashier" });

    expect(response.status).toBe(404);
    expect(response.body.error).toBe("Staff not found");
  });

  it("allows all-branch role managers to assign staff roles without branch context", async () => {
    const response = await request(app)
      .post("/api/v1/roles/assign-staff")
      .set("x-tenant-id", "tenant-lagos-foods")
      .set("x-role", "owner")
      .set("x-user-id", "LCF-MAI-ADA")
      .send({ staffId: "LCF-MAI-MUS", role: "cashier" });

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ staffId: "LCF-MAI-MUS", role: "cashier" });
  });

  it("lets city managers assign roles only to staff in their city branches", async () => {
    const rolesResponse = await request(app)
      .get("/api/v1/roles")
      .set("x-tenant-id", "tenant-lagos-foods")
      .set("x-role", "owner")
      .set("x-user-id", "LCF-MAI-ADA");
    const stateManagerRole = rolesResponse.body.roles.find((role: { name: string }) => role.name === "state_manager");
    expect(stateManagerRole).toBeDefined();
    const originalPermissions = stateManagerRole.permissions;
    const grantResponse = await request(app)
      .patch(`/api/v1/roles/${stateManagerRole.id}/permissions`)
      .set("x-tenant-id", "tenant-lagos-foods")
      .set("x-role", "owner")
      .set("x-user-id", "LCF-MAI-ADA")
      .send({ permissions: [...new Set([...originalPermissions, "roles.manage"])] });

    if (!branches.some((branch) => branch.id === "branch-lagos-outside-city")) {
      branches.push({
        id: "branch-lagos-outside-city",
        tenantId: "tenant-lagos-foods",
        name: "Outside City Branch",
        address: "1 Ring Road",
        city: "Ibadan",
        phone: "+2348000000200",
        status: "active",
        createdAt: "2026-07-30T08:00:00.000Z"
      });
    }

    const ikejaStaffResponse = await request(app)
      .post("/api/v1/staff")
      .set("x-tenant-id", "tenant-lagos-foods")
      .set("x-role", "owner")
      .set("x-user-id", "LCF-MAI-ADA")
      .send({
        branchId: "branch-lagos-ikeja",
        name: "Ikeja Role Scope",
        email: "ikejarolescope@example.com",
        phone: "+2348077777201",
        role: "cashier",
        pinEnabled: true,
        active: true
      });
    const outsideStaffResponse = await request(app)
      .post("/api/v1/staff")
      .set("x-tenant-id", "tenant-lagos-foods")
      .set("x-role", "owner")
      .set("x-user-id", "LCF-MAI-ADA")
      .send({
        branchId: "branch-lagos-outside-city",
        name: "Outside Role Scope",
        email: "outsiderolescope@example.com",
        phone: "+2348077777202",
        role: "cashier",
        pinEnabled: true,
        active: true
      });

    expect(ikejaStaffResponse.status).toBe(201);
    expect(outsideStaffResponse.status).toBe(201);
    expect(grantResponse.status).toBe(200);

    const assignResponse = await request(app)
      .post("/api/v1/roles/assign-staff")
      .set("x-tenant-id", "tenant-lagos-foods")
      .set("x-role", "state_manager")
      .set("x-user-id", "LCF-MAI-TUN")
      .send({ staffId: ikejaStaffResponse.body.staff.id, role: "manager" });
    const outsideAssignResponse = await request(app)
      .post("/api/v1/roles/assign-staff")
      .set("x-tenant-id", "tenant-lagos-foods")
      .set("x-role", "state_manager")
      .set("x-user-id", "LCF-MAI-TUN")
      .send({ staffId: outsideStaffResponse.body.staff.id, role: "manager" });
    const explicitOutsideResponse = await request(app)
      .post("/api/v1/roles/assign-staff")
      .set("x-tenant-id", "tenant-lagos-foods")
      .set("x-role", "state_manager")
      .set("x-user-id", "LCF-MAI-TUN")
      .set("x-branch-id", "branch-lagos-outside-city")
      .send({ staffId: outsideStaffResponse.body.staff.id, role: "manager" });
    const restoreResponse = await request(app)
      .patch(`/api/v1/roles/${stateManagerRole.id}/permissions`)
      .set("x-tenant-id", "tenant-lagos-foods")
      .set("x-role", "owner")
      .set("x-user-id", "LCF-MAI-ADA")
      .send({ permissions: originalPermissions });

    expect(assignResponse.status).toBe(200);
    expect(assignResponse.body).toMatchObject({ staffId: ikejaStaffResponse.body.staff.id, role: "manager" });
    expect(outsideAssignResponse.status).toBe(404);
    expect(explicitOutsideResponse.status).toBe(403);
    expect(restoreResponse.status).toBe(200);
  });

  it("allows managers to invite staff", async () => {
    const response = await request(app)
      .post("/api/v1/staff")
      .set("x-tenant-id", "tenant-lagos-foods")
      .set("x-branch-id", "branch-lagos-main")
      .set("x-role", "manager")
      .set("x-user-id", "LCF-MAI-CHI")
      .send({
        branchId: "branch-lagos-main",
        name: "New Cashier",
        email: "newcashier@example.com",
        phone: "+2348077777777",
        role: "cashier",
        pinEnabled: true,
        active: true
      });

    expect(response.status).toBe(201);
    expect(response.body.staff).toMatchObject({ name: "New Cashier", role: "cashier", active: false, inviteStatus: "pending" });
    expect(response.body.staff.inviteExpiresAt).toBeDefined();
  });

  it("rejects staff invites for branches outside the tenant", async () => {
    const response = await request(app)
      .post("/api/v1/staff")
      .set("x-tenant-id", "tenant-lagos-foods")
      .set("x-branch-id", "branch-lagos-main")
      .set("x-role", "manager")
      .set("x-user-id", "LCF-MAI-CHI")
      .send({
        branchId: "branch-abuja-main",
        name: "Wrong Branch Cashier",
        email: "wrongbranchcashier@example.com",
        phone: "+2348077777799",
        role: "cashier",
        pinEnabled: true,
        active: true
      });

    expect(response.status).toBe(403);
    expect(response.body.error).toBe("Branch access denied");
  });

  it("prevents staff updates from the wrong branch context", async () => {
    const response = await request(app)
      .patch("/api/v1/staff/LCF-MAI-MUS/status")
      .set("x-tenant-id", "tenant-lagos-foods")
      .set("x-branch-id", "branch-abuja-main")
      .set("x-role", "manager")
      .set("x-user-id", "LCF-MAI-CHI")
      .send({ active: false, reason: "Wrong branch attempt" });

    expect(response.status).toBe(404);
    expect(response.body.error).toBe("Staff member not found");
  });

  it("blocks branch-scoped managers from moving staff to another branch", async () => {
    const response = await request(app)
      .patch("/api/v1/staff/LCF-MAI-MUS")
      .set("x-tenant-id", "tenant-lagos-foods")
      .set("x-branch-id", "branch-lagos-main")
      .set("x-role", "manager")
      .set("x-user-id", "LCF-MAI-CHI")
      .send({
        branchId: "branch-lagos-ikeja",
        name: "Chinelo Okafor",
        email: "chinelo@example.com",
        phone: "+2348022222222",
        role: "cashier",
        pinEnabled: true,
        active: true
      });

    expect(response.status).toBe(403);
    expect(response.body.error).toBe("Branch access denied");
  });

  it("requires branch context for branch-scoped staff writes", async () => {
    const listResponse = await request(app)
      .get("/api/v1/staff?branchId=branch-lagos-main")
      .set("x-tenant-id", "tenant-lagos-foods")
      .set("x-role", "manager")
      .set("x-user-id", "LCF-MAI-CHI");

    const createResponse = await request(app)
      .post("/api/v1/staff")
      .set("x-tenant-id", "tenant-lagos-foods")
      .set("x-role", "manager")
      .set("x-user-id", "LCF-MAI-CHI")
      .send({
        branchId: "branch-lagos-main",
        name: "No Branch Staff",
        email: "nobranchstaff@example.com",
        phone: "+2348077777711",
        role: "cashier",
        pinEnabled: true,
        active: true
      });

    const statusResponse = await request(app)
      .patch("/api/v1/staff/LCF-MAI-MUS/status")
      .set("x-tenant-id", "tenant-lagos-foods")
      .set("x-role", "manager")
      .set("x-user-id", "LCF-MAI-CHI")
      .send({ active: false, reason: "Missing branch context" });

    const resendResponse = await request(app)
      .post("/api/v1/staff/LCF-MAI-MUS/invite/resend")
      .set("x-tenant-id", "tenant-lagos-foods")
      .set("x-role", "manager")
      .set("x-user-id", "LCF-MAI-CHI");

    expect(listResponse.status).toBe(403);
    expect(createResponse.status).toBe(403);
    expect(statusResponse.status).toBe(403);
    expect(resendResponse.status).toBe(403);
    expect(listResponse.body.error).toBe("Branch access denied");
    expect(createResponse.body.error).toBe("Branch access denied");
    expect(statusResponse.body.error).toBe("Branch access denied");
    expect(resendResponse.body.error).toBe("Branch access denied");
  });

  it("allows managers to resend and revoke staff invites", async () => {
    const createResponse = await request(app)
      .post("/api/v1/staff")
      .set("x-tenant-id", "tenant-lagos-foods")
      .set("x-branch-id", "branch-lagos-main")
      .set("x-role", "manager")
      .set("x-user-id", "LCF-MAI-CHI")
      .send({
        branchId: "branch-lagos-main",
        name: "Temporary Cashier",
        email: "tempcashier@example.com",
        phone: "+2348077777788",
        role: "cashier",
        pinEnabled: true,
        active: true
      });

    const resendResponse = await request(app)
      .post(`/api/v1/staff/${createResponse.body.staff.id}/invite/resend`)
      .set("x-tenant-id", "tenant-lagos-foods")
      .set("x-branch-id", "branch-lagos-main")
      .set("x-role", "manager")
      .set("x-user-id", "LCF-MAI-CHI");

    expect(resendResponse.status).toBe(200);
    expect(resendResponse.body.staff).toMatchObject({ inviteStatus: "pending", active: false });

    const revokeResponse = await request(app)
      .post(`/api/v1/staff/${createResponse.body.staff.id}/invite/revoke`)
      .set("x-tenant-id", "tenant-lagos-foods")
      .set("x-branch-id", "branch-lagos-main")
      .set("x-role", "manager")
      .set("x-user-id", "LCF-MAI-CHI");

    expect(revokeResponse.status).toBe(200);
    expect(revokeResponse.body.staff).toMatchObject({ inviteStatus: "revoked", active: false });
  });

  it("authenticates staff with password and terminal PIN sessions", async () => {
    const bootstrapResponse = await request(app)
      .get("/api/v1/auth/bootstrap")
      .query({ tenantId: "tenant-lagos-foods", branchId: "branch-lagos-main" });
    const staffBootstrapResponse = await request(app)
      .get("/api/v1/auth/bootstrap/staff/LCF-MAI-MUS");
    const passwordResponse = await request(app)
      .post("/api/v1/auth/login")
      .send({
        tenantId: "tenant-lagos-foods",
        email: "chinelo@example.com",
        password: "Password123!",
        terminalId: "terminal-web-1"
      });
    const compactIdPasswordResponse = await request(app)
      .post("/api/v1/auth/login")
      .send({
        identifier: "LCF-MAI-CHI",
        password: "Password123!",
        terminalId: "terminal-web-1"
      });
    const refreshResponse = await request(app)
      .post("/api/v1/auth/refresh")
      .send({ refreshToken: passwordResponse.body.refreshToken });
    const pinResponse = await request(app)
      .post("/api/v1/auth/pin-login")
      .send({
        tenantId: "tenant-lagos-foods",
        branchId: "branch-lagos-main",
        terminalId: "terminal-web-1",
        staffId: "LCF-MAI-MUS",
        pin: "123456"
      });
    const wrongTerminalPasswordResponse = await request(app)
      .post("/api/v1/auth/login")
      .send({
        tenantId: "tenant-lagos-foods",
        email: "chinelo@example.com",
        password: "Password123!",
        terminalId: "terminal-ikeja-1"
      });
    const wrongTerminalPinResponse = await request(app)
      .post("/api/v1/auth/pin-login")
      .send({
        tenantId: "tenant-lagos-foods",
        branchId: "branch-lagos-main",
        terminalId: "terminal-ikeja-1",
        staffId: "LCF-MAI-MUS",
        pin: "123456"
      });
    const sessionsResponse = await request(app)
      .get("/api/v1/auth/sessions")
      .set("x-tenant-id", "tenant-lagos-foods")
      .set("x-branch-id", "branch-lagos-main")
      .set("x-role", "manager")
      .set("x-user-id", "LCF-MAI-CHI");
    const crossBranchSessionsResponse = await request(app)
      .get("/api/v1/auth/sessions?branchId=branch-lagos-ikeja")
      .set("x-tenant-id", "tenant-lagos-foods")
      .set("x-branch-id", "branch-lagos-main")
      .set("x-role", "manager")
      .set("x-user-id", "LCF-MAI-CHI");
    const bearerSessionsResponse = await request(app)
      .get("/api/v1/auth/sessions")
      .set("authorization", `Bearer ${passwordResponse.body.accessToken}`)
      .set("x-tenant-id", "tenant-lagos-foods")
      .set("x-branch-id", "branch-lagos-main")
      .set("x-role", "cashier")
      .set("x-user-id", "LCF-MAI-MUS");
    const revokeResponse = await request(app)
      .post(`/api/v1/auth/sessions/${passwordResponse.body.session.id}/revoke`)
      .set("x-tenant-id", "tenant-lagos-foods")
      .set("x-branch-id", "branch-lagos-main")
      .set("x-role", "manager")
      .set("x-user-id", "LCF-MAI-CHI");
    const logoutLoginResponse = await request(app)
      .post("/api/v1/auth/login")
      .send({
        tenantId: "tenant-lagos-foods",
        email: "chinelo@example.com",
        password: "Password123!",
        terminalId: "terminal-web-1"
      });
    const logoutResponse = await request(app)
      .post("/api/v1/auth/logout")
      .set("authorization", `Bearer ${logoutLoginResponse.body.accessToken}`);
    const invalidResponse = await request(app)
      .post("/api/v1/auth/login")
      .send({
        tenantId: "tenant-lagos-foods",
        email: "chinelo@example.com",
        password: "wrong-password"
      });

    expect(bootstrapResponse.status).toBe(200);
    expect(bootstrapResponse.body.branches).toEqual(expect.arrayContaining([expect.objectContaining({ id: "branch-lagos-main" })]));
    expect(bootstrapResponse.body.terminals).toEqual(expect.arrayContaining([expect.objectContaining({ id: "terminal-web-1" })]));
    expect(bootstrapResponse.body.staff).toEqual(expect.arrayContaining([expect.objectContaining({ id: "LCF-MAI-MUS", email: expect.any(String), pinEnabled: true })]));
    expect(staffBootstrapResponse.status).toBe(200);
    expect(staffBootstrapResponse.body).toMatchObject({
      branches: [expect.objectContaining({ id: "branch-lagos-main", tenantId: "tenant-lagos-foods" })],
      terminals: expect.arrayContaining([expect.objectContaining({ id: "terminal-web-1", branchId: "branch-lagos-main" })]),
      staff: [expect.objectContaining({ id: "LCF-MAI-MUS", tenantId: "tenant-lagos-foods", branchId: "branch-lagos-main" })]
    });
    expect(passwordResponse.status).toBe(200);
    expect(passwordResponse.body).toMatchObject({
      staff: { email: "chinelo@example.com", role: "manager" },
      session: { terminalId: "terminal-web-1", role: "manager" },
      accessTokenExpiresIn: 900
    });
    expect(passwordResponse.body.accessToken.split(".")).toHaveLength(3);
    expect(passwordResponse.body.refreshToken).toEqual(expect.any(String));
    expect(compactIdPasswordResponse.status).toBe(200);
    expect(compactIdPasswordResponse.body).toMatchObject({
      staff: { id: "LCF-MAI-CHI", tenantId: "tenant-lagos-foods", branchId: "branch-lagos-main" },
      session: { branchId: "branch-lagos-main", terminalId: "terminal-web-1", role: "manager" }
    });
    expect(refreshResponse.status).toBe(200);
    expect(refreshResponse.body.session.id).toBe(passwordResponse.body.session.id);
    expect(pinResponse.status).toBe(200);
    expect(pinResponse.body.staff).toMatchObject({ id: "LCF-MAI-MUS", role: "cashier" });
    expect(wrongTerminalPasswordResponse.status).toBe(401);
    expect(wrongTerminalPasswordResponse.body.reason).toBe("terminal_mismatch");
    expect(wrongTerminalPinResponse.status).toBe(401);
    expect(wrongTerminalPinResponse.body.reason).toBe("terminal_mismatch");
    expect(sessionsResponse.status).toBe(200);
    expect(sessionsResponse.body.sessions).toEqual(expect.arrayContaining([expect.objectContaining({ id: passwordResponse.body.session.id })]));
    expect(sessionsResponse.body.sessions.every((session: { branchId?: string }) => session.branchId === "branch-lagos-main")).toBe(true);
    expect(crossBranchSessionsResponse.status).toBe(403);
    expect(bearerSessionsResponse.status).toBe(200);
    expect(bearerSessionsResponse.body.sessions).toEqual(expect.arrayContaining([expect.objectContaining({ id: passwordResponse.body.session.id })]));
    expect(revokeResponse.body.session).toMatchObject({ id: passwordResponse.body.session.id, revokedAt: expect.any(String) });
    expect(logoutResponse.status).toBe(200);
    expect(logoutResponse.body.session).toMatchObject({ id: logoutLoginResponse.body.session.id, revokedAt: expect.any(String) });
    expect(invalidResponse.status).toBe(401);
  });

  it("lets city managers review and revoke auth sessions inside their branch city", async () => {
    authSessions.unshift(
      {
        id: "session-city-main",
        tenantId: "tenant-lagos-foods",
        staffId: "LCF-MAI-MUS",
        branchId: "branch-lagos-main",
        terminalId: "terminal-web-1",
        role: "cashier",
        refreshTokenHash: "hidden-main",
        expiresAt: new Date(Date.now() + 1000 * 60 * 60).toISOString(),
        createdAt: new Date().toISOString()
      },
      {
        id: "session-city-ikeja",
        tenantId: "tenant-lagos-foods",
        staffId: "LCF-MAI-MUS",
        branchId: "branch-lagos-ikeja",
        terminalId: "terminal-ikeja-1",
        role: "cashier",
        refreshTokenHash: "hidden-ikeja",
        expiresAt: new Date(Date.now() + 1000 * 60 * 60).toISOString(),
        createdAt: new Date().toISOString()
      },
      {
        id: "session-city-outside",
        tenantId: "tenant-lagos-foods",
        staffId: "LCF-MAI-MUS",
        branchId: "branch-lagos-outside-city",
        terminalId: "terminal-web-1",
        role: "cashier",
        refreshTokenHash: "hidden-outside",
        expiresAt: new Date(Date.now() + 1000 * 60 * 60).toISOString(),
        createdAt: new Date().toISOString()
      }
    );

    const sessionsResponse = await request(app)
      .get("/api/v1/auth/sessions")
      .set("x-tenant-id", "tenant-lagos-foods")
      .set("x-role", "state_manager")
      .set("x-user-id", "LCF-MAI-TUN");
    const revokeResponse = await request(app)
      .post("/api/v1/auth/sessions/session-city-ikeja/revoke")
      .set("x-tenant-id", "tenant-lagos-foods")
      .set("x-role", "state_manager")
      .set("x-user-id", "LCF-MAI-TUN");
    const outsideRevokeResponse = await request(app)
      .post("/api/v1/auth/sessions/session-city-outside/revoke")
      .set("x-tenant-id", "tenant-lagos-foods")
      .set("x-role", "state_manager")
      .set("x-user-id", "LCF-MAI-TUN");

    expect(sessionsResponse.status).toBe(200);
    expect(sessionsResponse.body.sessions).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "session-city-main" }),
      expect.objectContaining({ id: "session-city-ikeja" })
    ]));
    expect(sessionsResponse.body.sessions.some((session: { id: string }) => session.id === "session-city-outside")).toBe(false);
    expect(revokeResponse.status).toBe(200);
    expect(revokeResponse.body.session).toMatchObject({ id: "session-city-ikeja", revokedAt: expect.any(String) });
    expect(outsideRevokeResponse.status).toBe(404);
  });

  it("resolves bearer access from the current staff role and active session", async () => {
    const staff = staffMembers.find((member) => member.id === "LCF-MAI-MUS");
    expect(staff).toBeDefined();
    const originalRole = staff!.role;

    try {
      const loginResponse = await request(app)
        .post("/api/v1/auth/pin-login")
        .send({
          tenantId: "tenant-lagos-foods",
          branchId: "branch-lagos-main",
          terminalId: "terminal-web-1",
          staffId: "LCF-MAI-MUS",
          pin: "123456"
        });

      staff!.role = "manager";
      const managerAccessResponse = await request(app)
        .get("/api/v1/auth/sessions")
        .set("authorization", `Bearer ${loginResponse.body.accessToken}`);

      staff!.role = "cashier";
      const cashierAccessResponse = await request(app)
        .get("/api/v1/auth/sessions")
        .set("authorization", `Bearer ${loginResponse.body.accessToken}`);

      const revokeResponse = await request(app)
        .post(`/api/v1/auth/sessions/${loginResponse.body.session.id}/revoke`)
        .set("x-tenant-id", "tenant-lagos-foods")
        .set("x-branch-id", "branch-lagos-main")
        .set("x-role", "manager")
        .set("x-user-id", "LCF-MAI-CHI");
      staff!.role = "manager";
      const revokedAccessResponse = await request(app)
        .get("/api/v1/auth/sessions")
        .set("authorization", `Bearer ${loginResponse.body.accessToken}`);

      expect(loginResponse.status).toBe(200);
      expect(managerAccessResponse.status).toBe(200);
      expect(cashierAccessResponse.status).toBe(403);
      expect(cashierAccessResponse.body).toMatchObject({ error: "Permission denied", permission: "staff.manage" });
      expect(revokeResponse.status).toBe(200);
      expect(revokedAccessResponse.status).toBe(401);
    } finally {
      staff!.role = originalRole;
    }
  });

  it("does not accept seeded default secrets when a staff credential hash is missing", async () => {
    const staff = staffMembers.find((member) => member.id === "LCF-MAI-MUS");
    expect(staff).toBeDefined();
    const originalPasswordHash = staff!.passwordHash;
    const originalPinHash = staff!.pinHash;

    try {
      staff!.passwordHash = undefined;
      staff!.pinHash = undefined;

      const passwordResponse = await request(app)
        .post("/api/v1/auth/login")
        .send({
          tenantId: "tenant-lagos-foods",
          email: "musa@example.com",
          password: "Password123!",
          terminalId: "terminal-web-1"
        });
      const pinResponse = await request(app)
        .post("/api/v1/auth/pin-login")
        .send({
          tenantId: "tenant-lagos-foods",
          branchId: "branch-lagos-main",
          terminalId: "terminal-web-1",
          staffId: "LCF-MAI-MUS",
          pin: "123456"
        });

      expect(passwordResponse.status).toBe(401);
      expect(passwordResponse.body.reason).toBe("password_mismatch");
      expect(pinResponse.status).toBe(401);
      expect(pinResponse.body.reason).toBe("pin_mismatch");
    } finally {
      staff!.passwordHash = originalPasswordHash;
      staff!.pinHash = originalPinHash;
    }
  });

  it("authenticates password login with a staff ID identifier", async () => {
    const response = await request(app)
      .post("/api/v1/auth/login")
      .send({
        tenantId: "tenant-lagos-foods",
        identifier: "LCF-MAI-CHI",
        password: "Password123!",
        terminalId: "terminal-web-1"
      });

    expect(response.status).toBe(200);
    expect(response.body.staff).toMatchObject({ id: "LCF-MAI-CHI", email: "chinelo@example.com", role: "manager" });
    expect(response.body.session).toMatchObject({ branchId: "branch-lagos-main", terminalId: "terminal-web-1" });
  });

  it("audits failed password and PIN login attempts without storing secrets", async () => {
    const passwordResponse = await request(app)
      .post("/api/v1/auth/login")
      .set("user-agent", "failed-password-test")
      .send({
        tenantId: "tenant-lagos-foods",
        email: "chinelo@example.com",
        password: "not-the-password",
        terminalId: "terminal-web-1"
      });
    const pinResponse = await request(app)
      .post("/api/v1/auth/pin-login")
      .set("user-agent", "failed-pin-test")
      .send({
        tenantId: "tenant-lagos-foods",
        branchId: "branch-lagos-main",
        terminalId: "terminal-web-1",
        staffId: "LCF-MAI-MUS",
        pin: "000000"
      });
    const passwordAuditResponse = await request(app)
      .get("/api/v1/audit?branchId=branch-lagos-main&action=auth.login_failed")
      .set("x-tenant-id", "tenant-lagos-foods")
      .set("x-branch-id", "branch-lagos-main")
      .set("x-role", "auditor")
      .set("x-user-id", "auditor-1");
    const pinAuditResponse = await request(app)
      .get("/api/v1/audit?branchId=branch-lagos-main&action=auth.pin_login_failed")
      .set("x-tenant-id", "tenant-lagos-foods")
      .set("x-branch-id", "branch-lagos-main")
      .set("x-role", "auditor")
      .set("x-user-id", "auditor-1");

    expect(passwordResponse.status).toBe(401);
    expect(passwordResponse.body.reason).toBe("password_mismatch");
    expect(pinResponse.status).toBe(401);
    expect(pinResponse.body.reason).toBe("pin_mismatch");
    expect(passwordAuditResponse.status).toBe(200);
    expect(passwordAuditResponse.body.events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          action: "auth.login_failed",
          entityType: "auth_attempt",
          userId: "LCF-MAI-CHI",
          metadata: expect.objectContaining({
            identifier: "chinelo@example.com",
            terminalId: "terminal-web-1",
            reason: "password_mismatch",
            userAgent: "failed-password-test"
          })
        })
      ])
    );
    expect(pinAuditResponse.status).toBe(200);
    expect(pinAuditResponse.body.events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          action: "auth.pin_login_failed",
          entityType: "auth_attempt",
          userId: "LCF-MAI-MUS",
          metadata: expect.objectContaining({
            staffId: "LCF-MAI-MUS",
            terminalId: "terminal-web-1",
            reason: "pin_mismatch",
            userAgent: "failed-pin-test"
          })
        })
      ])
    );
    expect(JSON.stringify(passwordAuditResponse.body.events)).not.toContain("not-the-password");
    expect(JSON.stringify(pinAuditResponse.body.events)).not.toContain("000000");
  });

  it("temporarily locks repeated failed password and PIN login attempts", async () => {
    const passwordPayload = {
      tenantId: "tenant-lagos-foods",
      identifier: "missing-lockout-user",
      password: "wrong-password",
      terminalId: "terminal-web-1"
    };
    const pinPayload = {
      tenantId: "tenant-lagos-foods",
      branchId: "branch-lagos-main",
      terminalId: "terminal-web-1",
      staffId: "missing-lockout-pin-user",
      pin: "000000"
    };

    for (let attempt = 0; attempt < 5; attempt += 1) {
      const response = await request(app).post("/api/v1/auth/login").send(passwordPayload);
      expect(response.status).toBe(401);
    }

    const lockedPasswordResponse = await request(app).post("/api/v1/auth/login").send(passwordPayload);
    expect(lockedPasswordResponse.status).toBe(429);
    expect(lockedPasswordResponse.body).toMatchObject({
      error: "Account temporarily locked",
      reason: "account_locked",
      identifier: "missing-lockout-user"
    });
    expect(lockedPasswordResponse.body.lockedUntil).toEqual(expect.any(String));

    for (let attempt = 0; attempt < 5; attempt += 1) {
      const response = await request(app).post("/api/v1/auth/pin-login").send(pinPayload);
      expect(response.status).toBe(401);
    }

    const lockedPinResponse = await request(app).post("/api/v1/auth/pin-login").send(pinPayload);
    expect(lockedPinResponse.status).toBe(429);
    expect(lockedPinResponse.body).toMatchObject({
      error: "Account temporarily locked",
      reason: "account_locked",
      staffId: "missing-lockout-pin-user"
    });
    expect(lockedPinResponse.body.lockedUntil).toEqual(expect.any(String));
  });

  it("uses bearer identity with the selected branch context", async () => {
    const loginResponse = await request(app)
      .post("/api/v1/auth/login")
      .send({
        tenantId: "tenant-lagos-foods",
        email: "chinelo@example.com",
        password: "Password123!",
        terminalId: "terminal-web-1"
      });

    const response = await request(app)
      .patch("/api/v1/staff/LCF-MAI-MUS/status")
      .set("authorization", `Bearer ${loginResponse.body.accessToken}`)
      .set("x-branch-id", "branch-abuja-main")
      .send({ active: false, reason: "Wrong selected branch attempt" });

    expect(response.status).toBe(200);
    expect(response.body.staff).toMatchObject({ id: "LCF-MAI-MUS", active: false });
  });

  it("blocks cashiers from staff management", async () => {
    const response = await request(app)
      .patch("/api/v1/staff/LCF-MAI-MUS/status")
      .set("x-tenant-id", "tenant-lagos-foods")
      .set("x-branch-id", "branch-lagos-main")
      .set("x-role", "cashier")
      .set("x-user-id", "cashier-1")
      .send({ active: false, reason: "No permission" });

    expect(response.status).toBe(403);
  });

  it("allows staff to request manager approval and managers to approve it", async () => {
    const requestResponse = await request(app)
      .post("/api/v1/approvals")
      .set("x-tenant-id", "tenant-lagos-foods")
      .set("x-branch-id", "branch-lagos-main")
      .set("x-role", "cashier")
      .set("x-user-id", "cashier-1")
      .send({
        branchId: "branch-lagos-main",
        type: "discount",
        entityType: "saleDraft",
        entityId: "terminal-web-1",
        amount: 75000,
        reason: "VIP discount above threshold"
      });

    expect(requestResponse.status).toBe(201);
    expect(requestResponse.body.approval).toMatchObject({ status: "pending", requestedBy: "cashier-1" });

    const decisionResponse = await request(app)
      .patch(`/api/v1/approvals/${requestResponse.body.approval.id}/decision`)
      .set("x-tenant-id", "tenant-lagos-foods")
      .set("x-branch-id", "branch-lagos-main")
      .set("x-role", "manager")
      .set("x-user-id", "LCF-MAI-CHI")
      .send({ decision: "approved", note: "Approved for VIP customer" });

    expect(decisionResponse.status).toBe(200);
    expect(decisionResponse.body.approval).toMatchObject({ status: "approved", decidedBy: "LCF-MAI-CHI" });
  });

  it("lets city managers review and decide approvals only inside their branch city", async () => {
    if (!branches.some((branch) => branch.id === "branch-lagos-outside-city")) {
      branches.push({
        id: "branch-lagos-outside-city",
        tenantId: "tenant-lagos-foods",
        name: "Ibadan Road Test Branch",
        address: "1 Test Road",
        city: "Ibadan",
        phone: "+2348099990000",
        status: "active",
        createdAt: new Date().toISOString()
      });
    }

    const ikejaRequest = await request(app)
      .post("/api/v1/approvals")
      .set("x-tenant-id", "tenant-lagos-foods")
      .set("x-branch-id", "branch-lagos-ikeja")
      .set("x-role", "owner")
      .set("x-user-id", "LCF-MAI-ADA")
      .send({
        branchId: "branch-lagos-ikeja",
        type: "cash_movement",
        entityType: "registerShift",
        entityId: "shift-city-manager-ikeja",
        amount: 5000,
        reason: "City manager scoped approval"
      });
    const outsideCityRequest = await request(app)
      .post("/api/v1/approvals")
      .set("x-tenant-id", "tenant-lagos-foods")
      .set("x-branch-id", "branch-lagos-outside-city")
      .set("x-role", "owner")
      .set("x-user-id", "LCF-MAI-ADA")
      .send({
        branchId: "branch-lagos-outside-city",
        type: "cash_movement",
        entityType: "registerShift",
        entityId: "shift-city-manager-outside",
        amount: 5000,
        reason: "Outside city approval"
      });
    const queueResponse = await request(app)
      .get("/api/v1/approvals?status=all&type=all")
      .set("x-tenant-id", "tenant-lagos-foods")
      .set("x-role", "state_manager")
      .set("x-user-id", "LCF-MAI-TUN");
    const decisionResponse = await request(app)
      .patch(`/api/v1/approvals/${ikejaRequest.body.approval.id}/decision`)
      .set("x-tenant-id", "tenant-lagos-foods")
      .set("x-role", "state_manager")
      .set("x-user-id", "LCF-MAI-TUN")
      .send({ decision: "approved", note: "Inside city approval" });
    const outsideDecisionResponse = await request(app)
      .patch(`/api/v1/approvals/${outsideCityRequest.body.approval.id}/decision`)
      .set("x-tenant-id", "tenant-lagos-foods")
      .set("x-role", "state_manager")
      .set("x-user-id", "LCF-MAI-TUN")
      .send({ decision: "approved", note: "Outside city attempt" });

    expect(ikejaRequest.status).toBe(201);
    expect(outsideCityRequest.status).toBe(201);
    expect(queueResponse.status).toBe(200);
    expect(queueResponse.body.approvals.some((approval: { id: string }) => approval.id === ikejaRequest.body.approval.id)).toBe(true);
    expect(queueResponse.body.approvals.some((approval: { id: string }) => approval.id === outsideCityRequest.body.approval.id)).toBe(false);
    expect(decisionResponse.status).toBe(200);
    expect(decisionResponse.body.approval).toMatchObject({ status: "approved", decidedBy: "LCF-MAI-TUN" });
    expect(outsideDecisionResponse.status).toBe(404);
  });

  it("filters approval queue by date range", async () => {
    const requestResponse = await request(app)
      .post("/api/v1/approvals")
      .set("x-tenant-id", "tenant-lagos-foods")
      .set("x-branch-id", "branch-lagos-main")
      .set("x-role", "cashier")
      .set("x-user-id", "cashier-1")
      .send({
        branchId: "branch-lagos-main",
        type: "cash_movement",
        entityType: "registerShift",
        entityId: "shift-filter-test",
        amount: 2500,
        reason: "Date filter coverage"
      });

    const today = new Date().toISOString().slice(0, 10);
    const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const rangeResponse = await request(app)
      .get(`/api/v1/approvals?branchId=branch-lagos-main&status=all&type=all&startDate=${today}&endDate=${today}`)
      .set("x-tenant-id", "tenant-lagos-foods")
      .set("x-branch-id", "branch-lagos-main")
      .set("x-role", "manager")
      .set("x-user-id", "LCF-MAI-CHI");
    const invalidDateResponse = await request(app)
      .get("/api/v1/approvals?branchId=branch-lagos-main&startDate=not-a-date")
      .set("x-tenant-id", "tenant-lagos-foods")
      .set("x-branch-id", "branch-lagos-main")
      .set("x-role", "manager")
      .set("x-user-id", "LCF-MAI-CHI");
    const invertedDateResponse = await request(app)
      .get(`/api/v1/approvals?branchId=branch-lagos-main&startDate=${tomorrow}&endDate=${today}`)
      .set("x-tenant-id", "tenant-lagos-foods")
      .set("x-branch-id", "branch-lagos-main")
      .set("x-role", "manager")
      .set("x-user-id", "LCF-MAI-CHI");

    expect(requestResponse.status).toBe(201);
    expect(rangeResponse.status).toBe(200);
    expect(rangeResponse.body.approvals.some((approval: { id: string }) => approval.id === requestResponse.body.approval.id)).toBe(true);
    expect(invalidDateResponse.status).toBe(400);
    expect(invertedDateResponse.status).toBe(400);
  });

  it("blocks staff without workflow permissions from requesting or applying approvals", async () => {
    const requestResponse = await request(app)
      .post("/api/v1/approvals")
      .set("x-tenant-id", "tenant-lagos-foods")
      .set("x-branch-id", "branch-lagos-main")
      .set("x-role", "kitchen")
      .set("x-user-id", "kitchen-1")
      .send({
        branchId: "branch-lagos-main",
        type: "discount",
        entityType: "saleDraft",
        entityId: "terminal-web-1",
        amount: 1000,
        reason: "Kitchen discount request"
      });
    const applyResponse = await request(app)
      .post("/api/v1/approvals/approval-1/apply")
      .set("x-tenant-id", "tenant-lagos-foods")
      .set("x-branch-id", "branch-lagos-main")
      .set("x-role", "kitchen")
      .set("x-user-id", "kitchen-1")
      .send({
        entityType: "saleDraft",
        entityId: "terminal-web-1",
        type: "discount",
        amount: 1000,
        note: "Kitchen apply attempt"
      });

    expect(requestResponse.status).toBe(403);
    expect(applyResponse.status).toBe(403);
    expect(requestResponse.body).toMatchObject({ error: "Permission denied", permission: "sale.create" });
    expect(applyResponse.body).toMatchObject({ error: "Permission denied", permission: "sale.create" });
  });

  it("rejects approval requests for branches outside the tenant", async () => {
    const response = await request(app)
      .post("/api/v1/approvals")
      .set("x-tenant-id", "tenant-lagos-foods")
      .set("x-branch-id", "branch-lagos-main")
      .set("x-role", "cashier")
      .set("x-user-id", "cashier-1")
      .send({
        branchId: "branch-abuja-main",
        type: "discount",
        entityType: "saleDraft",
        entityId: "terminal-web-1",
        amount: 1000,
        reason: "Wrong branch request"
      });

    expect(response.status).toBe(403);
    expect(response.body.error).toBe("Branch access denied");
  });

  it("requires approval decisions to use the approval branch", async () => {
    const requestResponse = await request(app)
      .post("/api/v1/approvals")
      .set("x-tenant-id", "tenant-lagos-foods")
      .set("x-branch-id", "branch-lagos-main")
      .set("x-role", "cashier")
      .set("x-user-id", "cashier-1")
      .send({
        branchId: "branch-lagos-main",
        type: "discount",
        entityType: "saleDraft",
        entityId: "terminal-web-1",
        amount: 1000,
        reason: "Branch scoped approval"
      });

    const decisionResponse = await request(app)
      .patch(`/api/v1/approvals/${requestResponse.body.approval.id}/decision`)
      .set("x-tenant-id", "tenant-lagos-foods")
      .set("x-branch-id", "branch-abuja-main")
      .set("x-role", "manager")
      .set("x-user-id", "manager-1")
      .send({ decision: "approved", note: "Wrong branch decision" });

    expect(decisionResponse.status).toBe(404);
    expect(decisionResponse.body.error).toBe("Approval request not found");
  });

  it("blocks cashiers from deciding approval requests", async () => {
    const response = await request(app)
      .patch("/api/v1/approvals/approval-1/decision")
      .set("x-tenant-id", "tenant-lagos-foods")
      .set("x-branch-id", "branch-lagos-main")
      .set("x-role", "cashier")
      .set("x-user-id", "cashier-1")
      .send({ decision: "rejected", note: "No manager access" });

    expect(response.status).toBe(403);
  });

  it("allows the requester to apply an approved matching approval once", async () => {
    const requestResponse = await request(app)
      .post("/api/v1/approvals")
      .set("x-tenant-id", "tenant-lagos-foods")
      .set("x-branch-id", "branch-lagos-main")
      .set("x-role", "cashier")
      .set("x-user-id", "cashier-1")
      .send({
        branchId: "branch-lagos-main",
        type: "discount",
        entityType: "saleDraft",
        entityId: "terminal-web-1",
        amount: 90000,
        reason: "Approved discount request"
      });

    await request(app)
      .patch(`/api/v1/approvals/${requestResponse.body.approval.id}/decision`)
      .set("x-tenant-id", "tenant-lagos-foods")
      .set("x-branch-id", "branch-lagos-main")
      .set("x-role", "manager")
      .set("x-user-id", "LCF-MAI-CHI")
      .send({ decision: "approved", note: "Approved for retention" });

    const applyResponse = await request(app)
      .post(`/api/v1/approvals/${requestResponse.body.approval.id}/apply`)
      .set("x-tenant-id", "tenant-lagos-foods")
      .set("x-branch-id", "branch-lagos-main")
      .set("x-role", "cashier")
      .set("x-user-id", "cashier-1")
      .send({
        entityType: "saleDraft",
        entityId: "terminal-web-1",
        type: "discount",
        amount: 85000,
        note: "Applied in POS terminal"
      });

    expect(applyResponse.status).toBe(200);
    expect(applyResponse.body.approval).toMatchObject({ status: "applied" });

    const replayResponse = await request(app)
      .post(`/api/v1/approvals/${requestResponse.body.approval.id}/apply`)
      .set("x-tenant-id", "tenant-lagos-foods")
      .set("x-branch-id", "branch-lagos-main")
      .set("x-role", "cashier")
      .set("x-user-id", "cashier-1")
      .send({
        entityType: "saleDraft",
        entityId: "terminal-web-1",
        type: "discount",
        amount: 85000,
        note: "Replay attempt"
      });

    expect(replayResponse.status).toBe(409);
  });

  it("allows applying an approved customer credit request", async () => {
    const requestResponse = await request(app)
      .post("/api/v1/approvals")
      .set("x-tenant-id", "tenant-lagos-foods")
      .set("x-branch-id", "branch-lagos-main")
      .set("x-role", "cashier")
      .set("x-user-id", "cashier-1")
      .send({
        branchId: "branch-lagos-main",
        type: "customer_credit",
        entityType: "customerAccount",
        entityId: "cust-2",
        amount: 15000,
        reason: "Customer credit sale on account"
      });

    expect(requestResponse.status).toBe(201);

    await request(app)
      .patch(`/api/v1/approvals/${requestResponse.body.approval.id}/decision`)
      .set("x-tenant-id", "tenant-lagos-foods")
      .set("x-branch-id", "branch-lagos-main")
      .set("x-role", "manager")
      .set("x-user-id", "LCF-MAI-CHI")
      .send({ decision: "approved", note: "Customer has available limit" });

    const applyResponse = await request(app)
      .post(`/api/v1/approvals/${requestResponse.body.approval.id}/apply`)
      .set("x-tenant-id", "tenant-lagos-foods")
      .set("x-branch-id", "branch-lagos-main")
      .set("x-role", "cashier")
      .set("x-user-id", "cashier-1")
      .send({
        entityType: "customerAccount",
        entityId: "cust-2",
        type: "customer_credit",
        amount: 15000,
        note: "Applied from customer ledger"
      });

    expect(applyResponse.status).toBe(200);
    expect(applyResponse.body.approval).toMatchObject({ type: "customer_credit", status: "applied" });
  });

  it("blocks applying approvals that do not cover the requested action", async () => {
    const requestResponse = await request(app)
      .post("/api/v1/approvals")
      .set("x-tenant-id", "tenant-lagos-foods")
      .set("x-branch-id", "branch-lagos-main")
      .set("x-role", "cashier")
      .set("x-user-id", "cashier-1")
      .send({
        branchId: "branch-lagos-main",
        type: "discount",
        entityType: "saleDraft",
        entityId: "terminal-web-1",
        amount: 10000,
        reason: "Small approved discount"
      });

    await request(app)
      .patch(`/api/v1/approvals/${requestResponse.body.approval.id}/decision`)
      .set("x-tenant-id", "tenant-lagos-foods")
      .set("x-branch-id", "branch-lagos-main")
      .set("x-role", "manager")
      .set("x-user-id", "LCF-MAI-CHI")
      .send({ decision: "approved", note: "Approved amount only" });

    const applyResponse = await request(app)
      .post(`/api/v1/approvals/${requestResponse.body.approval.id}/apply`)
      .set("x-tenant-id", "tenant-lagos-foods")
      .set("x-branch-id", "branch-lagos-main")
      .set("x-role", "cashier")
      .set("x-user-id", "cashier-1")
      .send({
        entityType: "saleDraft",
        entityId: "terminal-web-1",
        type: "discount",
        amount: 50000,
        note: "Too large"
      });

    expect(applyResponse.status).toBe(409);
  });

  it("allows applying an approved void request from the POS terminal", async () => {
    const requestResponse = await request(app)
      .post("/api/v1/approvals")
      .set("x-tenant-id", "tenant-lagos-foods")
      .set("x-branch-id", "branch-lagos-main")
      .set("x-role", "cashier")
      .set("x-user-id", "cashier-1")
      .send({
        branchId: "branch-lagos-main",
        type: "void",
        entityType: "saleDraft",
        entityId: "terminal-web-1",
        amount: 18000,
        reason: "Customer cancelled active order"
      });

    await request(app)
      .patch(`/api/v1/approvals/${requestResponse.body.approval.id}/decision`)
      .set("x-tenant-id", "tenant-lagos-foods")
      .set("x-branch-id", "branch-lagos-main")
      .set("x-role", "manager")
      .set("x-user-id", "LCF-MAI-CHI")
      .send({ decision: "approved", note: "Approved cancellation" });

    const applyResponse = await request(app)
      .post(`/api/v1/approvals/${requestResponse.body.approval.id}/apply`)
      .set("x-tenant-id", "tenant-lagos-foods")
      .set("x-branch-id", "branch-lagos-main")
      .set("x-role", "cashier")
      .set("x-user-id", "cashier-1")
      .send({
        entityType: "saleDraft",
        entityId: "terminal-web-1",
        type: "void",
        amount: 18000,
        note: "Voided current terminal order"
      });

    expect(applyResponse.status).toBe(200);
    expect(applyResponse.body.approval).toMatchObject({ type: "void", status: "applied" });
  });

  it("allows applying an approved cash movement request for a register shift", async () => {
    const requestResponse = await request(app)
      .post("/api/v1/approvals")
      .set("x-tenant-id", "tenant-lagos-foods")
      .set("x-branch-id", "branch-lagos-main")
      .set("x-role", "cashier")
      .set("x-user-id", "cashier-1")
      .send({
        branchId: "branch-lagos-main",
        type: "cash_movement",
        entityType: "registerShift",
        entityId: "shift-1",
        amount: 12000,
        reason: "Paid out supplier delivery"
      });

    await request(app)
      .patch(`/api/v1/approvals/${requestResponse.body.approval.id}/decision`)
      .set("x-tenant-id", "tenant-lagos-foods")
      .set("x-branch-id", "branch-lagos-main")
      .set("x-role", "manager")
      .set("x-user-id", "LCF-MAI-CHI")
      .send({ decision: "approved", note: "Approved supplier payout" });

    const applyResponse = await request(app)
      .post(`/api/v1/approvals/${requestResponse.body.approval.id}/apply`)
      .set("x-tenant-id", "tenant-lagos-foods")
      .set("x-branch-id", "branch-lagos-main")
      .set("x-role", "cashier")
      .set("x-user-id", "cashier-1")
      .send({
        entityType: "registerShift",
        entityId: "shift-1",
        type: "cash_movement",
        amount: 12000,
        note: "Recorded in register"
      });

    expect(applyResponse.status).toBe(200);
    expect(applyResponse.body.approval).toMatchObject({ type: "cash_movement", status: "applied" });
  });

  it("allows applying an approved register close request", async () => {
    const requestResponse = await request(app)
      .post("/api/v1/approvals")
      .set("x-tenant-id", "tenant-lagos-foods")
      .set("x-branch-id", "branch-lagos-main")
      .set("x-role", "cashier")
      .set("x-user-id", "cashier-1")
      .send({
        branchId: "branch-lagos-main",
        type: "register_close",
        entityType: "registerShift",
        entityId: "shift-1",
        amount: 5000,
        reason: "Close drawer with approved variance"
      });

    await request(app)
      .patch(`/api/v1/approvals/${requestResponse.body.approval.id}/decision`)
      .set("x-tenant-id", "tenant-lagos-foods")
      .set("x-branch-id", "branch-lagos-main")
      .set("x-role", "manager")
      .set("x-user-id", "LCF-MAI-CHI")
      .send({ decision: "approved", note: "Variance accepted" });

    const cashierApplyResponse = await request(app)
      .post(`/api/v1/approvals/${requestResponse.body.approval.id}/apply`)
      .set("x-tenant-id", "tenant-lagos-foods")
      .set("x-branch-id", "branch-lagos-main")
      .set("x-role", "cashier")
      .set("x-user-id", "cashier-1")
      .send({
        entityType: "registerShift",
        entityId: "shift-1",
        type: "register_close",
        amount: 5000,
        note: "Cashier apply attempt"
      });
    const managerApplyResponse = await request(app)
      .post(`/api/v1/approvals/${requestResponse.body.approval.id}/apply`)
      .set("x-tenant-id", "tenant-lagos-foods")
      .set("x-branch-id", "branch-lagos-main")
      .set("x-role", "manager")
      .set("x-user-id", "LCF-MAI-CHI")
      .send({
        entityType: "registerShift",
        entityId: "shift-1",
        type: "register_close",
        amount: 5000,
        note: "Applied before drawer close"
      });

    expect(cashierApplyResponse.status).toBe(403);
    expect(managerApplyResponse.status).toBe(200);
    expect(managerApplyResponse.body.approval).toMatchObject({ type: "register_close", status: "applied" });
  });

  it("allows applying an approved stock adjustment request", async () => {
    const requestResponse = await request(app)
      .post("/api/v1/approvals")
      .set("x-tenant-id", "tenant-lagos-foods")
      .set("x-branch-id", "branch-lagos-main")
      .set("x-role", "inventory")
      .set("x-user-id", "inventory-1")
      .send({
        branchId: "branch-lagos-main",
        type: "stock_adjustment",
        entityType: "productStock",
        entityId: "p1",
        amount: 3800,
        reason: "Waste adjustment approval"
      });

    await request(app)
      .patch(`/api/v1/approvals/${requestResponse.body.approval.id}/decision`)
      .set("x-tenant-id", "tenant-lagos-foods")
      .set("x-branch-id", "branch-lagos-main")
      .set("x-role", "manager")
      .set("x-user-id", "LCF-MAI-CHI")
      .send({ decision: "approved", note: "Waste reviewed" });

    const applyResponse = await request(app)
      .post(`/api/v1/approvals/${requestResponse.body.approval.id}/apply`)
      .set("x-tenant-id", "tenant-lagos-foods")
      .set("x-branch-id", "branch-lagos-main")
      .set("x-role", "inventory")
      .set("x-user-id", "inventory-1")
      .send({
        entityType: "productStock",
        entityId: "p1",
        type: "stock_adjustment",
        amount: 3800,
        note: "Applied inventory movement"
      });

    expect(applyResponse.status).toBe(200);
    expect(applyResponse.body.approval).toMatchObject({ type: "stock_adjustment", status: "applied" });
  });

  it("allows applying an approved stock count variance request", async () => {
    const requestResponse = await request(app)
      .post("/api/v1/approvals")
      .set("x-tenant-id", "tenant-lagos-foods")
      .set("x-branch-id", "branch-lagos-main")
      .set("x-role", "inventory")
      .set("x-user-id", "inventory-1")
      .send({
        branchId: "branch-lagos-main",
        type: "stock_adjustment",
        entityType: "stockCount",
        entityId: "COUNT-APPROVED-001",
        amount: 7600,
        reason: "Cycle count variance approval"
      });

    await request(app)
      .patch(`/api/v1/approvals/${requestResponse.body.approval.id}/decision`)
      .set("x-tenant-id", "tenant-lagos-foods")
      .set("x-branch-id", "branch-lagos-main")
      .set("x-role", "manager")
      .set("x-user-id", "LCF-MAI-CHI")
      .send({ decision: "approved", note: "Count reviewed" });

    const applyResponse = await request(app)
      .post(`/api/v1/approvals/${requestResponse.body.approval.id}/apply`)
      .set("x-tenant-id", "tenant-lagos-foods")
      .set("x-branch-id", "branch-lagos-main")
      .set("x-role", "inventory")
      .set("x-user-id", "inventory-1")
      .send({
        entityType: "stockCount",
        entityId: "COUNT-APPROVED-001",
        type: "stock_adjustment",
        amount: 7600,
        note: "Applied stock count"
      });

    expect(applyResponse.status).toBe(200);
    expect(applyResponse.body.approval).toMatchObject({ type: "stock_adjustment", status: "applied" });
  });

  it("allows applying approved completed-sale refund and void requests", async () => {
    const refundRequest = await request(app)
      .post("/api/v1/approvals")
      .set("x-tenant-id", "tenant-lagos-foods")
      .set("x-branch-id", "branch-lagos-main")
      .set("x-role", "cashier")
      .set("x-user-id", "cashier-1")
      .send({
        branchId: "branch-lagos-main",
        type: "refund",
        entityType: "sale",
        entityId: "INV-00001",
        amount: 1500,
        reason: "Approved receipt refund"
      });

    await request(app)
      .patch(`/api/v1/approvals/${refundRequest.body.approval.id}/decision`)
      .set("x-tenant-id", "tenant-lagos-foods")
      .set("x-branch-id", "branch-lagos-main")
      .set("x-role", "manager")
      .set("x-user-id", "LCF-MAI-CHI")
      .send({ decision: "approved", note: "Refund reviewed" });

    const cashierRefundApply = await request(app)
      .post(`/api/v1/approvals/${refundRequest.body.approval.id}/apply`)
      .set("x-tenant-id", "tenant-lagos-foods")
      .set("x-branch-id", "branch-lagos-main")
      .set("x-role", "cashier")
      .set("x-user-id", "cashier-1")
      .send({
        entityType: "sale",
        entityId: "INV-00001",
        type: "refund",
        amount: 1500,
        note: "Cashier refund apply attempt"
      });
    const refundApply = await request(app)
      .post(`/api/v1/approvals/${refundRequest.body.approval.id}/apply`)
      .set("x-tenant-id", "tenant-lagos-foods")
      .set("x-branch-id", "branch-lagos-main")
      .set("x-role", "manager")
      .set("x-user-id", "LCF-MAI-CHI")
      .send({
        entityType: "sale",
        entityId: "INV-00001",
        type: "refund",
        amount: 1500,
        note: "Applied receipt refund"
      });

    expect(cashierRefundApply.status).toBe(403);
    expect(refundApply.status).toBe(200);
    expect(refundApply.body.approval).toMatchObject({ type: "refund", status: "applied" });

    const voidRequest = await request(app)
      .post("/api/v1/approvals")
      .set("x-tenant-id", "tenant-lagos-foods")
      .set("x-branch-id", "branch-lagos-main")
      .set("x-role", "cashier")
      .set("x-user-id", "cashier-1")
      .send({
        branchId: "branch-lagos-main",
        type: "void",
        entityType: "sale",
        entityId: "INV-00002",
        amount: 18000,
        reason: "Approved receipt void"
      });

    await request(app)
      .patch(`/api/v1/approvals/${voidRequest.body.approval.id}/decision`)
      .set("x-tenant-id", "tenant-lagos-foods")
      .set("x-branch-id", "branch-lagos-main")
      .set("x-role", "manager")
      .set("x-user-id", "LCF-MAI-CHI")
      .send({ decision: "approved", note: "Void reviewed" });

    const cashierVoidApply = await request(app)
      .post(`/api/v1/approvals/${voidRequest.body.approval.id}/apply`)
      .set("x-tenant-id", "tenant-lagos-foods")
      .set("x-branch-id", "branch-lagos-main")
      .set("x-role", "cashier")
      .set("x-user-id", "cashier-1")
      .send({
        entityType: "sale",
        entityId: "INV-00002",
        type: "void",
        amount: 18000,
        note: "Cashier void apply attempt"
      });
    const voidApply = await request(app)
      .post(`/api/v1/approvals/${voidRequest.body.approval.id}/apply`)
      .set("x-tenant-id", "tenant-lagos-foods")
      .set("x-branch-id", "branch-lagos-main")
      .set("x-role", "manager")
      .set("x-user-id", "LCF-MAI-CHI")
      .send({
        entityType: "sale",
        entityId: "INV-00002",
        type: "void",
        amount: 18000,
        note: "Applied receipt void"
      });

    expect(cashierVoidApply.status).toBe(403);
    expect(voidApply.status).toBe(200);
    expect(voidApply.body.approval).toMatchObject({ type: "void", status: "applied" });
  });

  it("returns the current register shift for a terminal", async () => {
    const response = await request(app)
      .get("/api/v1/registers/current?branchId=branch-lagos-main&terminalId=terminal-web-1")
      .set("x-tenant-id", "tenant-lagos-foods")
      .set("x-branch-id", "branch-lagos-main")
      .set("x-role", "cashier")
      .set("x-user-id", "LCF-MAI-MUS");

    expect(response.status).toBe(200);
    expect(response.body.shift).toMatchObject({ id: "shift-1", status: "open" });
  });

  it("lists register shift history and self-scopes cashier users", async () => {
    const cashierResponse = await request(app)
      .get("/api/v1/registers/history?branchId=branch-lagos-main&terminalId=terminal-web-1")
      .set("x-tenant-id", "tenant-lagos-foods")
      .set("x-branch-id", "branch-lagos-main")
      .set("x-role", "cashier")
      .set("x-user-id", "LCF-MAI-MUS");
    const otherCashierResponse = await request(app)
      .get("/api/v1/registers/history?branchId=branch-lagos-main&terminalId=terminal-web-1")
      .set("x-tenant-id", "tenant-lagos-foods")
      .set("x-branch-id", "branch-lagos-main")
      .set("x-role", "cashier")
      .set("x-user-id", "cashier-other");
    const managerResponse = await request(app)
      .get("/api/v1/registers/history?branchId=branch-lagos-main&terminalId=terminal-web-1")
      .set("x-tenant-id", "tenant-lagos-foods")
      .set("x-branch-id", "branch-lagos-main")
      .set("x-role", "manager")
      .set("x-user-id", "LCF-MAI-CHI");

    expect(cashierResponse.status).toBe(200);
    expect(cashierResponse.body.shifts).toEqual(expect.arrayContaining([expect.objectContaining({ id: "shift-1", cashierId: "LCF-MAI-MUS" })]));
    expect(otherCashierResponse.status).toBe(200);
    expect(otherCashierResponse.body.shifts).toEqual([]);
    expect(managerResponse.status).toBe(200);
    expect(managerResponse.body.shifts).toEqual(expect.arrayContaining([expect.objectContaining({ id: "shift-1" })]));
  });

  it("lets city managers read register shifts only across branches in their city", async () => {
    if (!branches.some((branch) => branch.id === "branch-lagos-outside-city")) {
      branches.push({
        id: "branch-lagos-outside-city",
        tenantId: "tenant-lagos-foods",
        name: "Outside City Branch",
        address: "1 Ring Road",
        city: "Ibadan",
        phone: "+2348010000099",
        status: "active",
        createdAt: new Date().toISOString()
      });
    }

    if (!terminals.some((terminal) => terminal.id === "terminal-outside-city-1")) {
      terminals.push({
        id: "terminal-outside-city-1",
        tenantId: "tenant-lagos-foods",
        branchId: "branch-lagos-outside-city",
        name: "Outside City Terminal",
        deviceCode: "IBD-TEST-01",
        status: "online",
        appVersion: "1.0.0",
        lastSeenAt: new Date().toISOString(),
        createdAt: new Date().toISOString()
      });
    }

    if (!registerShifts.some((shift) => shift.id === "shift-register-city-ikeja")) {
      registerShifts.unshift({
        id: "shift-register-city-ikeja",
        tenantId: "tenant-lagos-foods",
        branchId: "branch-lagos-ikeja",
        terminalId: "terminal-ikeja-1",
        cashierId: "LCF-MAI-MUS",
        status: "open",
        openingBalance: 10000,
        expectedCash: 10000,
        openedAt: new Date().toISOString()
      });
    }

    if (!registerShifts.some((shift) => shift.id === "shift-register-city-outside")) {
      registerShifts.unshift({
        id: "shift-register-city-outside",
        tenantId: "tenant-lagos-foods",
        branchId: "branch-lagos-outside-city",
        terminalId: "terminal-outside-city-1",
        cashierId: "LCF-MAI-MUS",
        status: "open",
        openingBalance: 10000,
        expectedCash: 10000,
        openedAt: new Date().toISOString()
      });
    }

    const historyResponse = await request(app)
      .get("/api/v1/registers/history")
      .set("x-tenant-id", "tenant-lagos-foods")
      .set("x-role", "state_manager")
      .set("x-user-id", "LCF-MAI-TUN");
    const currentResponse = await request(app)
      .get("/api/v1/registers/current?terminalId=terminal-ikeja-1")
      .set("x-tenant-id", "tenant-lagos-foods")
      .set("x-role", "state_manager")
      .set("x-user-id", "LCF-MAI-TUN");
    const outsideHistoryResponse = await request(app)
      .get("/api/v1/registers/history?branchId=branch-lagos-outside-city")
      .set("x-tenant-id", "tenant-lagos-foods")
      .set("x-role", "state_manager")
      .set("x-user-id", "LCF-MAI-TUN");

    expect(historyResponse.status).toBe(200);
    expect(historyResponse.body.shifts).toEqual(expect.arrayContaining([expect.objectContaining({ id: "shift-register-city-ikeja" })]));
    expect(historyResponse.body.shifts).not.toEqual(expect.arrayContaining([expect.objectContaining({ id: "shift-register-city-outside" })]));
    expect(currentResponse.status).toBe(200);
    expect(currentResponse.body.shift).toMatchObject({ id: "shift-register-city-ikeja", branchId: "branch-lagos-ikeja" });
    expect(outsideHistoryResponse.status).toBe(403);
    expect(outsideHistoryResponse.body.error).toBe("Branch access denied");
  });

  it("blocks non-register staff from reading current register state", async () => {
    const response = await request(app)
      .get("/api/v1/registers/current?branchId=branch-lagos-main&terminalId=terminal-web-1")
      .set("x-tenant-id", "tenant-lagos-foods")
      .set("x-branch-id", "branch-lagos-main")
      .set("x-role", "waiter")
      .set("x-user-id", "waiter-2");

    expect(response.status).toBe(403);
    expect(response.body).toMatchObject({ error: "Permission denied", permission: "register.manage" });
  });

  it("records cash sales against the open register shift", async () => {
    const response = await request(app)
      .post("/api/v1/sales")
      .set("x-tenant-id", "tenant-lagos-foods")
      .set("x-branch-id", "branch-lagos-main")
      .set("x-role", "cashier")
      .set("x-user-id", "cashier-1")
      .send({
        branchId: "branch-lagos-main",
        terminalId: "terminal-web-1",
        idempotencyKey: "terminal-1-0004",
        lines: [{ productId: "p1", quantity: 1, discount: 0 }],
        payments: [{ method: "cash", amount: 9563 }]
      });

    expect(response.status).toBe(201);

    const shiftResponse = await request(app)
      .get("/api/v1/registers/current?branchId=branch-lagos-main&terminalId=terminal-web-1")
      .set("x-tenant-id", "tenant-lagos-foods")
      .set("x-branch-id", "branch-lagos-main")
      .set("x-role", "manager")
      .set("x-user-id", "manager-1");

    expect(shiftResponse.body.shift.expectedCash).toBeGreaterThan(50000);
    expect(shiftResponse.body.payments[0]).toMatchObject({ method: "cash", amount: 9563 });
  });

  it("rejects sales when an open-shift terminal is no longer online", async () => {
    const terminalResponse = await request(app)
      .post("/api/v1/branches/terminals")
      .set("x-tenant-id", "tenant-lagos-foods")
      .set("x-branch-id", "branch-lagos-main")
      .set("x-role", "manager")
      .set("x-user-id", "manager-1")
      .send({
        branchId: "branch-lagos-main",
        name: "Offline Sale Guard POS",
        deviceCode: "LAG-OFFLINE-SALE-01",
        status: "online",
        appVersion: "1.0.1"
      });
    const openResponse = await request(app)
      .post("/api/v1/registers/open")
      .set("x-tenant-id", "tenant-lagos-foods")
      .set("x-branch-id", "branch-lagos-main")
      .set("x-role", "manager")
      .set("x-user-id", "LCF-MAI-CHI")
      .send({
        branchId: "branch-lagos-main",
        terminalId: terminalResponse.body.terminal.id,
        openingBalance: 10000
      });
    const offlineResponse = await request(app)
      .patch(`/api/v1/branches/terminals/${terminalResponse.body.terminal.id}`)
      .set("x-tenant-id", "tenant-lagos-foods")
      .set("x-branch-id", "branch-lagos-main")
      .set("x-role", "manager")
      .set("x-user-id", "manager-1")
      .send({ status: "offline" });
    const saleResponse = await request(app)
      .post("/api/v1/sales")
      .set("x-tenant-id", "tenant-lagos-foods")
      .set("x-branch-id", "branch-lagos-main")
      .set("x-role", "cashier")
      .set("x-user-id", "cashier-1")
      .send({
        branchId: "branch-lagos-main",
        terminalId: terminalResponse.body.terminal.id,
        idempotencyKey: `${terminalResponse.body.terminal.id}-offline-sale`,
        lines: [{ productId: "p1", quantity: 1, discount: 0 }],
        payments: [{ method: "cash", amount: 9563 }]
      });

    expect(terminalResponse.status).toBe(201);
    expect(openResponse.status).toBe(201);
    expect(offlineResponse.status).toBe(200);
    expect(saleResponse.status).toBe(409);
    expect(saleResponse.body.error).toBe("Sales can only be posted from an online terminal");
  });

  it("rejects opening registers on invalid terminal assignments", async () => {
    const offlineTerminalResponse = await request(app)
      .post("/api/v1/registers/open")
      .set("x-tenant-id", "tenant-lagos-foods")
      .set("x-branch-id", "branch-lagos-main")
      .set("x-role", "manager")
      .set("x-user-id", "LCF-MAI-CHI")
      .send({
        branchId: "branch-lagos-main",
        terminalId: "terminal-web-2",
        openingBalance: 10000
      });
    const wrongBranchResponse = await request(app)
      .post("/api/v1/registers/open")
      .set("x-tenant-id", "tenant-lagos-foods")
      .set("x-role", "owner")
      .set("x-user-id", "LCF-MAI-ADA")
      .send({
        branchId: "branch-lagos-ikeja",
        terminalId: "terminal-web-1",
        openingBalance: 10000
      });
    const missingTerminalResponse = await request(app)
      .post("/api/v1/registers/open")
      .set("x-tenant-id", "tenant-lagos-foods")
      .set("x-branch-id", "branch-lagos-main")
      .set("x-role", "manager")
      .set("x-user-id", "LCF-MAI-CHI")
      .send({
        branchId: "branch-lagos-main",
        terminalId: "terminal-missing",
        openingBalance: 10000
      });

    expect(offlineTerminalResponse.status).toBe(409);
    expect(offlineTerminalResponse.body.error).toBe("Register can only open on an online terminal");
    expect(wrongBranchResponse.status).toBe(409);
    expect(wrongBranchResponse.body.error).toBe("Terminal does not belong to this branch");
    expect(missingTerminalResponse.status).toBe(404);
    expect(missingTerminalResponse.body.error).toBe("Terminal not found");
  });

  it("requires applied approval before managers close open register shifts", async () => {
    const terminalResponse = await request(app)
      .post("/api/v1/branches/terminals")
      .set("x-tenant-id", "tenant-lagos-foods")
      .set("x-branch-id", "branch-lagos-main")
      .set("x-role", "manager")
      .set("x-user-id", "manager-1")
      .send({
        branchId: "branch-lagos-main",
        name: "Close Test POS",
        deviceCode: `LAG-CLOSE-TEST-${Date.now()}`,
        status: "online",
        appVersion: "1.0.1"
      });
    const openResponse = await request(app)
      .post("/api/v1/registers/open")
      .set("x-tenant-id", "tenant-lagos-foods")
      .set("x-branch-id", "branch-lagos-main")
      .set("x-role", "manager")
      .set("x-user-id", "LCF-MAI-CHI")
      .send({
        branchId: "branch-lagos-main",
        terminalId: terminalResponse.body.terminal.id,
        openingBalance: 10000
      });
    const directCloseResponse = await request(app)
      .post("/api/v1/registers/close")
      .set("x-tenant-id", "tenant-lagos-foods")
      .set("x-branch-id", "branch-lagos-main")
      .set("x-role", "manager")
      .set("x-user-id", "LCF-MAI-CHI")
      .send({
        shiftId: openResponse.body.shift.id,
        countedCash: 9800,
        managerNote: "Short by 200"
      });
    const approvalResponse = await request(app)
      .post("/api/v1/approvals")
      .set("x-tenant-id", "tenant-lagos-foods")
      .set("x-branch-id", "branch-lagos-main")
      .set("x-role", "manager")
      .set("x-user-id", "LCF-MAI-CHI")
      .send({
        branchId: "branch-lagos-main",
        type: "register_close",
        entityType: "registerShift",
        entityId: openResponse.body.shift.id,
        amount: 200,
        reason: "Short by 200"
      });
    const decisionResponse = await request(app)
      .patch(`/api/v1/approvals/${approvalResponse.body.approval.id}/decision`)
      .set("x-tenant-id", "tenant-lagos-foods")
      .set("x-branch-id", "branch-lagos-main")
      .set("x-role", "manager")
      .set("x-user-id", "manager-1")
      .send({ decision: "approved", note: "Variance accepted" });
    const applyResponse = await request(app)
      .post(`/api/v1/approvals/${approvalResponse.body.approval.id}/apply`)
      .set("x-tenant-id", "tenant-lagos-foods")
      .set("x-branch-id", "branch-lagos-main")
      .set("x-role", "manager")
      .set("x-user-id", "LCF-MAI-CHI")
      .send({
        entityType: "registerShift",
        entityId: openResponse.body.shift.id,
        type: "register_close",
        amount: 200,
        note: "Closing approved variance"
      });
    const closeResponse = await request(app)
      .post("/api/v1/registers/close")
      .set("x-tenant-id", "tenant-lagos-foods")
      .set("x-branch-id", "branch-lagos-main")
      .set("x-role", "manager")
      .set("x-user-id", "LCF-MAI-CHI")
      .send({
        shiftId: openResponse.body.shift.id,
        countedCash: 9800,
        managerNote: "Short by 200",
        approvalId: approvalResponse.body.approval.id
      });

    expect(terminalResponse.status).toBe(201);
    expect(openResponse.status).toBe(201);
    expect(directCloseResponse.status).toBe(409);
    expect(directCloseResponse.body.error).toBe("Applied register close approval is required");
    expect(approvalResponse.status).toBe(201);
    expect(decisionResponse.status).toBe(200);
    expect(applyResponse.status).toBe(200);
    expect(closeResponse.status).toBe(200);
    expect(closeResponse.body.shift).toMatchObject({ status: "closed", variance: -200 });
  });

  it("blocks cashiers from closing register shifts directly", async () => {
    const terminalResponse = await request(app)
      .post("/api/v1/branches/terminals")
      .set("x-tenant-id", "tenant-lagos-foods")
      .set("x-branch-id", "branch-lagos-main")
      .set("x-role", "manager")
      .set("x-user-id", "manager-1")
      .send({
        branchId: "branch-lagos-main",
        name: "Cashier Close Block POS",
        deviceCode: "LAG-CASHIER-CLOSE-01",
        status: "online",
        appVersion: "1.0.1"
      });
    const openResponse = await request(app)
      .post("/api/v1/registers/open")
      .set("x-tenant-id", "tenant-lagos-foods")
      .set("x-branch-id", "branch-lagos-main")
      .set("x-role", "cashier")
      .set("x-user-id", "cashier-1")
      .send({
        branchId: "branch-lagos-main",
        terminalId: terminalResponse.body.terminal.id,
        openingBalance: 10000
      });
    const closeResponse = await request(app)
      .post("/api/v1/registers/close")
      .set("x-tenant-id", "tenant-lagos-foods")
      .set("x-branch-id", "branch-lagos-main")
      .set("x-role", "cashier")
      .set("x-user-id", "cashier-1")
      .send({
        shiftId: openResponse.body.shift.id,
        countedCash: 10000,
        managerNote: "Cashier direct close attempt"
      });

    expect(terminalResponse.status).toBe(201);
    expect(openResponse.status).toBe(201);
    expect(closeResponse.status).toBe(403);
  });

  it("requires an applied approval before recording register cash movements", async () => {
    const terminalResponse = await request(app)
      .post("/api/v1/branches/terminals")
      .set("x-tenant-id", "tenant-lagos-foods")
      .set("x-branch-id", "branch-lagos-main")
      .set("x-role", "manager")
      .set("x-user-id", "manager-1")
      .send({
        branchId: "branch-lagos-main",
        name: "Approval Guard POS",
        deviceCode: `LAG-APPROVAL-GUARD-${Date.now()}`,
        status: "online",
        appVersion: "1.0.1"
      });
    const openResponse = await request(app)
      .post("/api/v1/registers/open")
      .set("x-tenant-id", "tenant-lagos-foods")
      .set("x-branch-id", "branch-lagos-main")
      .set("x-role", "manager")
      .set("x-user-id", "LCF-MAI-CHI")
      .send({
        branchId: "branch-lagos-main",
        terminalId: terminalResponse.body.terminal.id,
        openingBalance: 10000
      });
    const movementResponse = await request(app)
      .post("/api/v1/registers/cash-movements")
      .set("x-tenant-id", "tenant-lagos-foods")
      .set("x-branch-id", "branch-lagos-main")
      .set("x-role", "manager")
      .set("x-user-id", "LCF-MAI-CHI")
      .send({
        shiftId: openResponse.body.shift.id,
        type: "cash_out",
        amount: 1000,
        reason: "Direct movement without approval"
      });

    expect(terminalResponse.status).toBe(201);
    expect(openResponse.status).toBe(201);
    expect(movementResponse.status).toBe(409);
    expect(movementResponse.body.error).toBe("Applied cash movement approval is required");
  });

  it("records register cash movements after approval is applied", async () => {
    const terminalResponse = await request(app)
      .post("/api/v1/branches/terminals")
      .set("x-tenant-id", "tenant-lagos-foods")
      .set("x-branch-id", "branch-lagos-main")
      .set("x-role", "manager")
      .set("x-user-id", "manager-1")
      .send({
        branchId: "branch-lagos-main",
        name: "Approved Movement POS",
        deviceCode: `LAG-APPROVED-MOVE-${Date.now()}`,
        status: "online",
        appVersion: "1.0.1"
      });
    const openResponse = await request(app)
      .post("/api/v1/registers/open")
      .set("x-tenant-id", "tenant-lagos-foods")
      .set("x-branch-id", "branch-lagos-main")
      .set("x-role", "manager")
      .set("x-user-id", "LCF-MAI-CHI")
      .send({
        branchId: "branch-lagos-main",
        terminalId: terminalResponse.body.terminal.id,
        openingBalance: 10000
      });
    const approvalResponse = await request(app)
      .post("/api/v1/approvals")
      .set("x-tenant-id", "tenant-lagos-foods")
      .set("x-branch-id", "branch-lagos-main")
      .set("x-role", "manager")
      .set("x-user-id", "LCF-MAI-CHI")
      .send({
        branchId: "branch-lagos-main",
        type: "cash_movement",
        entityType: "registerShift",
        entityId: openResponse.body.shift.id,
        amount: 1500,
        reason: "Paid out supplier delivery"
      });
    const decisionResponse = await request(app)
      .patch(`/api/v1/approvals/${approvalResponse.body.approval.id}/decision`)
      .set("x-tenant-id", "tenant-lagos-foods")
      .set("x-branch-id", "branch-lagos-main")
      .set("x-role", "manager")
      .set("x-user-id", "manager-1")
      .send({ decision: "approved", note: "Approved supplier payout" });
    const applyResponse = await request(app)
      .post(`/api/v1/approvals/${approvalResponse.body.approval.id}/apply`)
      .set("x-tenant-id", "tenant-lagos-foods")
      .set("x-branch-id", "branch-lagos-main")
      .set("x-role", "manager")
      .set("x-user-id", "LCF-MAI-CHI")
      .send({
        entityType: "registerShift",
        entityId: openResponse.body.shift.id,
        type: "cash_movement",
        amount: 1500,
        note: "Recorded in drawer"
      });
    const movementResponse = await request(app)
      .post("/api/v1/registers/cash-movements")
      .set("x-tenant-id", "tenant-lagos-foods")
      .set("x-branch-id", "branch-lagos-main")
      .set("x-role", "manager")
      .set("x-user-id", "LCF-MAI-CHI")
      .send({
        shiftId: openResponse.body.shift.id,
        type: "cash_out",
        amount: 1500,
        reason: "Paid out supplier delivery",
        approvalId: approvalResponse.body.approval.id
      });
    const currentRegisterResponse = await request(app)
      .get(`/api/v1/registers/current?branchId=branch-lagos-main&terminalId=${terminalResponse.body.terminal.id}`)
      .set("x-tenant-id", "tenant-lagos-foods")
      .set("x-branch-id", "branch-lagos-main")
      .set("x-role", "manager")
      .set("x-user-id", "LCF-MAI-CHI");
    const reportResponse = await request(app)
      .get("/api/v1/reports/dashboard?branchId=branch-lagos-main&period=all")
      .set("x-tenant-id", "tenant-lagos-foods")
      .set("x-branch-id", "branch-lagos-main")
      .set("x-role", "owner")
      .set("x-user-id", "LCF-MAI-ADA");

    expect(terminalResponse.status).toBe(201);
    expect(openResponse.status).toBe(201);
    expect(approvalResponse.status).toBe(201);
    expect(decisionResponse.status).toBe(200);
    expect(applyResponse.status).toBe(200);
    expect(movementResponse.status).toBe(201);
    expect(movementResponse.body.shift.expectedCash).toBe(8500);
    expect(movementResponse.body.movement).toMatchObject({ type: "cash_out", amount: 1500, expectedCashAfter: 8500 });
    expect(currentRegisterResponse.body.movements).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: movementResponse.body.movement.id, expectedCashAfter: 8500 })])
    );
    expect(reportResponse.body.summary.cashMovementOut).toBeGreaterThanOrEqual(1500);
    expect(reportResponse.body.cashMovements).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: movementResponse.body.movement.id, type: "cash_out", amount: 1500 })])
    );
  });

  it("requires register drawer actions to use the shift branch", async () => {
    const terminalResponse = await request(app)
      .post("/api/v1/branches/terminals")
      .set("x-tenant-id", "tenant-lagos-foods")
      .set("x-branch-id", "branch-lagos-main")
      .set("x-role", "manager")
      .set("x-user-id", "manager-1")
      .send({
        branchId: "branch-lagos-main",
        name: "Branch Scope POS",
        deviceCode: "LAG-BRANCH-SCOPE-01",
        status: "online",
        appVersion: "1.0.1"
      });
    const openResponse = await request(app)
      .post("/api/v1/registers/open")
      .set("x-tenant-id", "tenant-lagos-foods")
      .set("x-branch-id", "branch-lagos-main")
      .set("x-role", "manager")
      .set("x-user-id", "LCF-MAI-CHI")
      .send({
        branchId: "branch-lagos-main",
        terminalId: terminalResponse.body.terminal.id,
        openingBalance: 10000
      });
    const movementResponse = await request(app)
      .post("/api/v1/registers/cash-movements")
      .set("x-tenant-id", "tenant-lagos-foods")
      .set("x-branch-id", "branch-abuja-main")
      .set("x-role", "manager")
      .set("x-user-id", "LCF-MAI-CHI")
      .send({
        shiftId: openResponse.body.shift.id,
        type: "cash_in",
        amount: 1000,
        reason: "Wrong branch movement"
      });
    const closeResponse = await request(app)
      .post("/api/v1/registers/close")
      .set("x-tenant-id", "tenant-lagos-foods")
      .set("x-branch-id", "branch-abuja-main")
      .set("x-role", "manager")
      .set("x-user-id", "LCF-MAI-CHI")
      .send({
        shiftId: openResponse.body.shift.id,
        countedCash: 10000,
        managerNote: "Wrong branch close"
      });

    expect(terminalResponse.status).toBe(201);
    expect(openResponse.status).toBe(201);
    expect(movementResponse.status).toBe(404);
    expect(movementResponse.body.error).toBe("Open register shift not found");
    expect(closeResponse.status).toBe(404);
    expect(closeResponse.body.error).toBe("Open register shift not found");
  });

  it("records expenses with approval and report impact", async () => {
    const expenseResponse = await request(app)
      .post("/api/v1/expenses")
      .set("x-tenant-id", "tenant-lagos-foods")
      .set("x-branch-id", "branch-lagos-main")
      .set("x-role", "accountant")
      .set("x-user-id", "accountant-1")
      .send({
        branchId: "branch-lagos-main",
        category: "Supplies",
        description: "Bulk takeaway packs",
        vendor: "Counter Retail Partners",
        amount: 76000,
        paymentMethod: "bank_transfer",
        reference: "EXP-TAKEAWAY-001",
        status: "paid",
        spentAt: new Date().toISOString(),
        note: "Weekend stock-up"
      });
    const approvalResponse = await request(app)
      .post("/api/v1/approvals")
      .set("x-tenant-id", "tenant-lagos-foods")
      .set("x-branch-id", "branch-lagos-main")
      .set("x-role", "accountant")
      .set("x-user-id", "accountant-1")
      .send({
        branchId: "branch-lagos-main",
        type: "expense",
        entityType: "expense",
        entityId: expenseResponse.body.expense.id,
        amount: expenseResponse.body.expense.amount,
        reason: "Approve large branch expense",
        requestedBy: "accountant-1"
      });
    const statusResponse = await request(app)
      .patch(`/api/v1/expenses/${expenseResponse.body.expense.id}/status`)
      .set("x-tenant-id", "tenant-lagos-foods")
      .set("x-branch-id", "branch-lagos-main")
      .set("x-role", "accountant")
      .set("x-user-id", "accountant-1")
      .send({ status: "paid", note: "Manager approved and paid" });
    const listResponse = await request(app)
      .get("/api/v1/expenses?branchId=branch-lagos-main&status=all")
      .set("x-tenant-id", "tenant-lagos-foods")
      .set("x-branch-id", "branch-lagos-main")
      .set("x-role", "accountant")
      .set("x-user-id", "accountant-1");
    const today = new Date().toISOString().slice(0, 10);
    const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const dateRangeResponse = await request(app)
      .get(`/api/v1/expenses?branchId=branch-lagos-main&status=all&startDate=${today}&endDate=${today}`)
      .set("x-tenant-id", "tenant-lagos-foods")
      .set("x-branch-id", "branch-lagos-main")
      .set("x-role", "accountant")
      .set("x-user-id", "accountant-1");
    const invalidDateResponse = await request(app)
      .get("/api/v1/expenses?branchId=branch-lagos-main&startDate=not-a-date")
      .set("x-tenant-id", "tenant-lagos-foods")
      .set("x-branch-id", "branch-lagos-main")
      .set("x-role", "accountant")
      .set("x-user-id", "accountant-1");
    const invertedDateResponse = await request(app)
      .get(`/api/v1/expenses?branchId=branch-lagos-main&startDate=${tomorrow}&endDate=${today}`)
      .set("x-tenant-id", "tenant-lagos-foods")
      .set("x-branch-id", "branch-lagos-main")
      .set("x-role", "accountant")
      .set("x-user-id", "accountant-1");
    const reportResponse = await request(app)
      .get("/api/v1/reports/dashboard?branchId=branch-lagos-main&period=all")
      .set("x-tenant-id", "tenant-lagos-foods")
      .set("x-branch-id", "branch-lagos-main")
      .set("x-role", "owner")
      .set("x-user-id", "LCF-MAI-ADA");

    expect(expenseResponse.status).toBe(201);
    expect(expenseResponse.body.expense).toMatchObject({ status: "pending_approval", amount: 76000 });
    expect(approvalResponse.status).toBe(201);
    expect(approvalResponse.body.approval).toMatchObject({ type: "expense", entityType: "expense" });
    expect(statusResponse.status).toBe(200);
    expect(statusResponse.body.expense).toMatchObject({ status: "paid", paidAt: expect.any(String) });
    expect(listResponse.body.expenses).toEqual(expect.arrayContaining([expect.objectContaining({ id: expenseResponse.body.expense.id })]));
    expect(dateRangeResponse.status).toBe(200);
    expect(dateRangeResponse.body.expenses).toEqual(expect.arrayContaining([expect.objectContaining({ id: expenseResponse.body.expense.id })]));
    expect(invalidDateResponse.status).toBe(400);
    expect(invertedDateResponse.status).toBe(400);
    expect(reportResponse.body.summary.expenseTotal).toBeGreaterThanOrEqual(76000);
    expect(reportResponse.body.summary.netProfit).toBe(reportResponse.body.summary.grossProfit - reportResponse.body.summary.expenseTotal);
  });

  it("rejects expenses for branches outside the tenant", async () => {
    const response = await request(app)
      .post("/api/v1/expenses")
      .set("x-tenant-id", "tenant-lagos-foods")
      .set("x-role", "owner")
      .set("x-user-id", "LCF-MAI-ADA")
      .send({
        branchId: "branch-abuja-main",
        category: "Supplies",
        description: "Wrong branch expense",
        vendor: "Cross Tenant Vendor",
        amount: 12000,
        paymentMethod: "bank_transfer",
        reference: "EXP-WRONG-BRANCH",
        status: "draft",
        spentAt: new Date().toISOString(),
        note: "Should be rejected"
      });

    expect(response.status).toBe(404);
    expect(response.body.error).toBe("Expense branch not found for this tenant");
  });

  it("rejects customer credit as an expense payment method", async () => {
    const response = await request(app)
      .post("/api/v1/expenses")
      .set("x-tenant-id", "tenant-lagos-foods")
      .set("x-branch-id", "branch-lagos-main")
      .set("x-role", "accountant")
      .set("x-user-id", "accountant-1")
      .send({
        branchId: "branch-lagos-main",
        category: "Supplies",
        description: "Invalid credit expense",
        vendor: "Counter Retail Partners",
        amount: 12000,
        paymentMethod: "customer_credit",
        reference: "EXP-BAD-CREDIT",
        status: "paid",
        spentAt: new Date().toISOString(),
        note: "Customer credit cannot settle operating expenses"
      });

    expect(response.status).toBe(400);
    expect(response.body.error).toBe("Invalid expense payload");
  });

  it("lets city managers review and update expenses only inside their branch city", async () => {
    if (!branches.some((branch) => branch.id === "branch-lagos-outside-city")) {
      branches.push({
        id: "branch-lagos-outside-city",
        tenantId: "tenant-lagos-foods",
        name: "Ibadan Road Test Branch",
        address: "1 Test Road",
        city: "Ibadan",
        phone: "+2348099990000",
        status: "active",
        createdAt: new Date().toISOString()
      });
    }

    const ikejaExpense = await request(app)
      .post("/api/v1/expenses")
      .set("x-tenant-id", "tenant-lagos-foods")
      .set("x-role", "owner")
      .set("x-user-id", "LCF-MAI-ADA")
      .send({
        branchId: "branch-lagos-ikeja",
        category: "Repairs",
        description: "Ikeja POS counter repair",
        vendor: "Service Desk",
        amount: 15000,
        paymentMethod: "bank_transfer",
        reference: "EXP-CITY-IKEJA",
        status: "pending_approval",
        spentAt: new Date().toISOString(),
        note: "City scope expense"
      });
    const outsideCityExpense = await request(app)
      .post("/api/v1/expenses")
      .set("x-tenant-id", "tenant-lagos-foods")
      .set("x-role", "owner")
      .set("x-user-id", "LCF-MAI-ADA")
      .send({
        branchId: "branch-lagos-outside-city",
        category: "Repairs",
        description: "Outside city expense",
        vendor: "Service Desk",
        amount: 15000,
        paymentMethod: "bank_transfer",
        reference: "EXP-CITY-OUTSIDE",
        status: "pending_approval",
        spentAt: new Date().toISOString(),
        note: "Outside city scope"
      });
    const listResponse = await request(app)
      .get("/api/v1/expenses?status=all")
      .set("x-tenant-id", "tenant-lagos-foods")
      .set("x-role", "state_manager")
      .set("x-user-id", "LCF-MAI-TUN");
    const updateResponse = await request(app)
      .patch(`/api/v1/expenses/${ikejaExpense.body.expense.id}/status`)
      .set("x-tenant-id", "tenant-lagos-foods")
      .set("x-role", "state_manager")
      .set("x-user-id", "LCF-MAI-TUN")
      .send({ status: "approved", note: "Approved inside city" });
    const outsideUpdateResponse = await request(app)
      .patch(`/api/v1/expenses/${outsideCityExpense.body.expense.id}/status`)
      .set("x-tenant-id", "tenant-lagos-foods")
      .set("x-role", "state_manager")
      .set("x-user-id", "LCF-MAI-TUN")
      .send({ status: "approved", note: "Outside city attempt" });

    expect(ikejaExpense.status).toBe(201);
    expect(outsideCityExpense.status).toBe(201);
    expect(listResponse.status).toBe(200);
    expect(listResponse.body.expenses.some((expense: { id: string }) => expense.id === ikejaExpense.body.expense.id)).toBe(true);
    expect(listResponse.body.expenses.some((expense: { id: string }) => expense.id === outsideCityExpense.body.expense.id)).toBe(false);
    expect(updateResponse.status).toBe(200);
    expect(updateResponse.body.expense).toMatchObject({ id: ikejaExpense.body.expense.id, status: "approved", approvedBy: "LCF-MAI-TUN" });
    expect(outsideUpdateResponse.status).toBe(404);
  });

  it("blocks branch-scoped expense users from writing to another branch", async () => {
    const createResponse = await request(app)
      .post("/api/v1/expenses")
      .set("x-tenant-id", "tenant-lagos-foods")
      .set("x-branch-id", "branch-lagos-main")
      .set("x-role", "accountant")
      .set("x-user-id", "accountant-1")
      .send({
        branchId: "branch-lagos-ikeja",
        category: "Supplies",
        description: "Cross branch expense",
        vendor: "Cross Branch Vendor",
        amount: 12000,
        paymentMethod: "bank_transfer",
        reference: "EXP-CROSS-BRANCH",
        status: "draft",
        spentAt: new Date().toISOString(),
        note: "Should be rejected"
      });

    const listResponse = await request(app)
      .get("/api/v1/expenses?branchId=branch-lagos-ikeja&status=all")
      .set("x-tenant-id", "tenant-lagos-foods")
      .set("x-branch-id", "branch-lagos-main")
      .set("x-role", "accountant")
      .set("x-user-id", "accountant-1");

    expect(createResponse.status).toBe(403);
    expect(listResponse.status).toBe(403);
    expect(createResponse.body.error).toBe("Branch access denied");
    expect(listResponse.body.error).toBe("Branch access denied");
  });

  it("does not update expense status from another branch context", async () => {
    const expenseResponse = await request(app)
      .post("/api/v1/expenses")
      .set("x-tenant-id", "tenant-lagos-foods")
      .set("x-branch-id", "branch-lagos-main")
      .set("x-role", "accountant")
      .set("x-user-id", "accountant-1")
      .send({
        branchId: "branch-lagos-main",
        category: "Repairs",
        description: "Main branch freezer service",
        vendor: "Cold Line",
        amount: 18000,
        paymentMethod: "bank_transfer",
        reference: "EXP-BRANCH-SCOPE",
        status: "pending_approval",
        spentAt: new Date().toISOString(),
        note: "Branch isolation check"
      });

    const wrongBranchResponse = await request(app)
      .patch(`/api/v1/expenses/${expenseResponse.body.expense.id}/status`)
      .set("x-tenant-id", "tenant-lagos-foods")
      .set("x-branch-id", "branch-lagos-ikeja")
      .set("x-role", "accountant")
      .set("x-user-id", "accountant-1")
      .send({ status: "approved", note: "Wrong branch context" });

    expect(expenseResponse.status).toBe(201);
    expect(wrongBranchResponse.status).toBe(404);
    expect(wrongBranchResponse.body.error).toBe("Expense not found");
  });

  it("creates an audited sale preview for permitted users", async () => {
    const response = await request(app)
      .post("/api/v1/sales")
      .set("x-tenant-id", "tenant-lagos-foods")
      .set("x-branch-id", "branch-lagos-main")
      .set("x-role", "cashier")
      .set("x-user-id", "cashier-1")
      .send({
        branchId: "branch-lagos-main",
        terminalId: "terminal-web-1",
        idempotencyKey: "terminal-web-1-0002",
        lines: [{ productId: "p1", quantity: 1, discount: 0 }],
        payments: [{ method: "cash", amount: 9563 }]
      });

    expect(response.status).toBe(201);
    expect(response.body.saleId).toMatch(/^INV-\d{5}$/);
    expect(response.body.summary.total).toBe(9563);
    expect(response.body.receipt).toMatchObject({
      businessName: "Lagos Central Foods HQ",
      currency: "NGN",
      footer: "Thank you for shopping with us.",
      whatsappEnabled: true,
      printerName: "Epson TM-T20III",
      printEnabled: true
    });

    const auditResponse = await request(app)
      .get("/api/v1/audit")
      .set("x-tenant-id", "tenant-lagos-foods")
      .set("x-role", "owner")
      .set("x-user-id", "LCF-MAI-ADA");
    const salesResponse = await request(app)
      .get("/api/v1/sales?branchId=branch-lagos-main&status=all")
      .set("x-tenant-id", "tenant-lagos-foods")
      .set("x-branch-id", "branch-lagos-main")
      .set("x-role", "manager")
      .set("x-user-id", "manager-1");

    const saleAudit = auditResponse.body.events.find((event: { action: string; entityId: string }) => event.action === "sale.created");

    expect(saleAudit).toMatchObject({
      action: "sale.created",
      entityId: response.body.saleId
    });
    expect(salesResponse.body.sales.find((sale: { id: string }) => sale.id === response.body.saleId).receipt).toMatchObject({
      businessName: "Lagos Central Foods HQ",
      footer: "Thank you for shopping with us.",
      printerName: "Epson TM-T20III",
      printEnabled: true
    });

    const printResponse = await request(app)
      .post(`/api/v1/sales/${response.body.saleId}/receipt-actions`)
      .set("x-tenant-id", "tenant-lagos-foods")
      .set("x-branch-id", "branch-lagos-main")
      .set("x-role", "cashier")
      .set("x-user-id", "cashier-1")
      .send({ channel: "print" });
    const whatsappResponse = await request(app)
      .post(`/api/v1/sales/${response.body.saleId}/receipt-actions`)
      .set("x-tenant-id", "tenant-lagos-foods")
      .set("x-branch-id", "branch-lagos-main")
      .set("x-role", "cashier")
      .set("x-user-id", "cashier-1")
      .send({ channel: "whatsapp" });
    const wrongBranchReceiptResponse = await request(app)
      .post(`/api/v1/sales/${response.body.saleId}/receipt-actions`)
      .set("x-tenant-id", "tenant-lagos-foods")
      .set("x-branch-id", "branch-lagos-ikeja")
      .set("x-role", "cashier")
      .set("x-user-id", "cashier-1")
      .send({ channel: "print" });

    expect(printResponse.status).toBe(200);
    expect(printResponse.body.delivery).toMatchObject({ saleId: response.body.saleId, channel: "print", status: "queued" });
    expect(whatsappResponse.status).toBe(200);
    expect(whatsappResponse.body.delivery).toMatchObject({ saleId: response.body.saleId, channel: "whatsapp", status: "queued" });
    expect(wrongBranchReceiptResponse.status).toBe(404);
    expect(wrongBranchReceiptResponse.body.error).toBe("Sale not found");

    const receiptAuditResponse = await request(app)
      .get("/api/v1/audit")
      .set("x-tenant-id", "tenant-lagos-foods")
      .set("x-role", "owner")
      .set("x-user-id", "LCF-MAI-ADA");
    const receiptActions = receiptAuditResponse.body.events
      .filter((event: { entityId: string; action: string }) => event.entityId === response.body.saleId && event.action.startsWith("receipt."))
      .map((event: { action: string }) => event.action);

    expect(receiptActions).toEqual(expect.arrayContaining(["receipt.print_queued", "receipt.whatsapp_queued"]));

    const dashboardResponse = await request(app)
      .get("/api/v1/reports/dashboard?branchId=branch-lagos-main")
      .set("x-tenant-id", "tenant-lagos-foods")
      .set("x-branch-id", "branch-lagos-main")
      .set("x-role", "owner")
      .set("x-user-id", "LCF-MAI-ADA");
    const mealsCategory = dashboardResponse.body.categorySales.find((category: { category: string }) => category.category === "Meals");

    expect(dashboardResponse.status).toBe(200);
    expect(mealsCategory).toMatchObject({
      category: "Meals",
      quantity: expect.any(Number),
      sales: expect.any(Number),
      profit: expect.any(Number)
    });
    expect(dashboardResponse.body.topProducts[0]).toMatchObject({
      id: expect.any(String),
      name: expect.any(String),
      sales: expect.any(Number)
    });
  });

  it("sells services without stock depletion or insufficient stock errors", async () => {
    const serviceProduct = demoProducts.find((product) => product.id === "p28");
    expect(serviceProduct).toBeDefined();
    const originalStock = serviceProduct!.stock;
    const originalMovementCount = stockMovements.filter((movement) => movement.productId === "p28").length;

    try {
      serviceProduct!.stock = 0;

      const response = await request(app)
        .post("/api/v1/sales")
        .set("x-tenant-id", "tenant-lagos-foods")
        .set("x-branch-id", "branch-lagos-main")
        .set("x-role", "cashier")
        .set("x-user-id", "cashier-1")
        .send({
          branchId: "branch-lagos-main",
          terminalId: "terminal-web-1",
          idempotencyKey: "terminal-web-1-service-no-stock",
          lines: [{ productId: "p28", quantity: 3, discount: 0 }],
          payments: [{ method: "cash", amount: 5063 }]
        });

      const nextMovementCount = stockMovements.filter((movement) => movement.productId === "p28").length;

      expect(response.status).toBe(201);
      expect(response.body.summary).toMatchObject({
        subtotal: 4500,
        serviceCharge: 225,
        vat: 338,
        total: 5063
      });
      expect(serviceProduct!.stock).toBe(0);
      expect(nextMovementCount).toBe(originalMovementCount);
    } finally {
      serviceProduct!.stock = originalStock;
    }
  });

  it("rejects sales using tenant-disabled payment methods", async () => {
    const response = await request(app)
      .post("/api/v1/sales")
      .set("x-tenant-id", "tenant-lagos-foods")
      .set("x-branch-id", "branch-lagos-main")
      .set("x-role", "cashier")
      .set("x-user-id", "cashier-1")
      .send({
        branchId: "branch-lagos-main",
        terminalId: "terminal-web-1",
        idempotencyKey: "terminal-web-1-disabled-payment",
        lines: [{ productId: "p3", quantity: 1, discount: 0 }],
        payments: [{ method: "mobile_money", amount: 4725, reference: "MM-001" }]
      });

    expect(response.status).toBe(409);
    expect(response.body.error).toBe("mobile money payments are disabled for this tenant");
  });

  it("requires applied approval before posting high-value sale discounts", async () => {
    const discountedLines = [{ productId: "p2", quantity: 4, discount: 12500 }];
    const directResponse = await request(app)
      .post("/api/v1/sales")
      .set("x-tenant-id", "tenant-lagos-foods")
      .set("x-branch-id", "branch-lagos-main")
      .set("x-role", "cashier")
      .set("x-user-id", "cashier-1")
      .send({
        branchId: "branch-lagos-main",
        terminalId: "terminal-web-1",
        idempotencyKey: "terminal-web-1-high-discount-direct",
        lines: discountedLines,
        payments: [{ method: "cash", amount: 0 }]
      });
    const approvalId = await applySaleDraftDiscountApproval({
      terminalId: "terminal-web-1",
      amount: 50000,
      reason: "Approved manager comp"
    });
    const approvedResponse = await request(app)
      .post("/api/v1/sales")
      .set("x-tenant-id", "tenant-lagos-foods")
      .set("x-branch-id", "branch-lagos-main")
      .set("x-role", "cashier")
      .set("x-user-id", "cashier-1")
      .send({
        branchId: "branch-lagos-main",
        terminalId: "terminal-web-1",
        idempotencyKey: "terminal-web-1-high-discount-approved",
        discountApprovalId: approvalId,
        lines: discountedLines,
        payments: [{ method: "cash", amount: 0 }]
      });

    expect(directResponse.status).toBe(409);
    expect(directResponse.body.error).toBe("Applied discount approval is required");
    expect(approvedResponse.status).toBe(201);
    expect(approvedResponse.body.summary).toMatchObject({ subtotal: 50000, discount: 50000, total: 0, paid: 0 });
  });

  it("lets city managers list sales only across branches in their city", async () => {
    if (!branches.some((branch) => branch.id === "branch-lagos-outside-city")) {
      branches.push({
        id: "branch-lagos-outside-city",
        tenantId: "tenant-lagos-foods",
        name: "Ibadan Road Test Branch",
        address: "1 Test Road",
        city: "Ibadan",
        phone: "+2348099990000",
        status: "active",
        createdAt: new Date().toISOString()
      });
    }

    const receipt = {
      businessName: "NaijaPOS",
      currency: "NGN" as const,
      footer: "Thank you",
      whatsappEnabled: false,
      printEnabled: true
    };
    const summary = {
      lines: [],
      subtotal: 1000,
      discount: 0,
      serviceCharge: 0,
      vat: 75,
      total: 1075,
      paid: 1075,
      balance: 0
    };
    const ikejaSale = appendCompletedSale({
      id: "INV-CITY-SALES-IKEJA",
      tenantId: "tenant-lagos-foods",
      branchId: "branch-lagos-ikeja",
      terminalId: "terminal-ikeja-1",
      shiftId: "shift-city-sales-ikeja",
      cashierId: "LCF-MAI-MUS",
      idempotencyKey: "city-sales-ikeja",
      summary,
      status: "completed",
      refundTotal: 0,
      receipt
    });
    const outsideSale = appendCompletedSale({
      id: "INV-CITY-SALES-OUTSIDE",
      tenantId: "tenant-lagos-foods",
      branchId: "branch-lagos-outside-city",
      terminalId: "terminal-outside-city-1",
      shiftId: "shift-city-sales-outside",
      cashierId: "LCF-MAI-MUS",
      idempotencyKey: "city-sales-outside",
      summary,
      status: "completed",
      refundTotal: 0,
      receipt
    });

    const cityManagerResponse = await request(app)
      .get("/api/v1/sales?status=all")
      .set("x-tenant-id", "tenant-lagos-foods")
      .set("x-role", "state_manager")
      .set("x-user-id", "LCF-MAI-TUN");
    const outsideFilterResponse = await request(app)
      .get("/api/v1/sales?branchId=branch-lagos-outside-city&status=all")
      .set("x-tenant-id", "tenant-lagos-foods")
      .set("x-role", "state_manager")
      .set("x-user-id", "LCF-MAI-TUN");
    const ownerOutsideResponse = await request(app)
      .get("/api/v1/sales?branchId=branch-lagos-outside-city&status=all")
      .set("x-tenant-id", "tenant-lagos-foods")
      .set("x-role", "owner")
      .set("x-user-id", "LCF-MAI-ADA");
    const ikejaReceiptResponse = await request(app)
      .post(`/api/v1/sales/${ikejaSale.id}/receipt-actions`)
      .set("x-tenant-id", "tenant-lagos-foods")
      .set("x-role", "state_manager")
      .set("x-user-id", "LCF-MAI-TUN")
      .send({ channel: "print" });
    const outsideReceiptResponse = await request(app)
      .post(`/api/v1/sales/${outsideSale.id}/receipt-actions`)
      .set("x-tenant-id", "tenant-lagos-foods")
      .set("x-role", "state_manager")
      .set("x-user-id", "LCF-MAI-TUN")
      .send({ channel: "print" });
    const outsideExplicitReceiptResponse = await request(app)
      .post(`/api/v1/sales/${outsideSale.id}/receipt-actions?branchId=branch-lagos-outside-city`)
      .set("x-tenant-id", "tenant-lagos-foods")
      .set("x-role", "state_manager")
      .set("x-user-id", "LCF-MAI-TUN")
      .send({ channel: "print" });

    expect(cityManagerResponse.status).toBe(200);
    expect(cityManagerResponse.body.sales.some((sale: { id: string }) => sale.id === ikejaSale.id)).toBe(true);
    expect(cityManagerResponse.body.sales.some((sale: { id: string }) => sale.id === outsideSale.id)).toBe(false);
    expect(outsideFilterResponse.status).toBe(403);
    expect(ownerOutsideResponse.status).toBe(200);
    expect(ownerOutsideResponse.body.sales.some((sale: { id: string }) => sale.id === outsideSale.id)).toBe(true);
    expect(ikejaReceiptResponse.status).toBe(200);
    expect(ikejaReceiptResponse.body.delivery).toMatchObject({ saleId: ikejaSale.id, channel: "print", status: "queued" });
    expect(outsideReceiptResponse.status).toBe(404);
    expect(outsideExplicitReceiptResponse.status).toBe(403);
  });

  it("requires branch context for branch-scoped sales workflows", async () => {
    const saleResponse = await request(app)
      .post("/api/v1/sales")
      .set("x-tenant-id", "tenant-lagos-foods")
      .set("x-branch-id", "branch-lagos-main")
      .set("x-role", "cashier")
      .set("x-user-id", "cashier-1")
      .send({
        branchId: "branch-lagos-main",
        terminalId: "terminal-web-1",
        idempotencyKey: "terminal-web-1-sales-missing-branch-guard",
        lines: [{ productId: "p3", quantity: 1, discount: 0 }],
        payments: [{ method: "cash", amount: 4725 }]
      });
    const listResponse = await request(app)
      .get("/api/v1/sales?status=all")
      .set("x-tenant-id", "tenant-lagos-foods")
      .set("x-role", "manager")
      .set("x-user-id", "manager-1");
    const createResponse = await request(app)
      .post("/api/v1/sales")
      .set("x-tenant-id", "tenant-lagos-foods")
      .set("x-role", "cashier")
      .set("x-user-id", "cashier-1")
      .send({
        branchId: "branch-lagos-main",
        terminalId: "terminal-web-1",
        idempotencyKey: "terminal-web-1-sales-missing-branch-create",
        lines: [{ productId: "p3", quantity: 1, discount: 0 }],
        payments: [{ method: "cash", amount: 4725 }]
      });
    const receiptResponse = await request(app)
      .post(`/api/v1/sales/${saleResponse.body.saleId}/receipt-actions`)
      .set("x-tenant-id", "tenant-lagos-foods")
      .set("x-role", "cashier")
      .set("x-user-id", "cashier-1")
      .send({ channel: "print" });
    const refundResponse = await request(app)
      .post(`/api/v1/sales/${saleResponse.body.saleId}/refund`)
      .set("x-tenant-id", "tenant-lagos-foods")
      .set("x-role", "manager")
      .set("x-user-id", "manager-1")
      .send({ amount: 1000, reason: "Missing branch refund" });
    const voidResponse = await request(app)
      .post(`/api/v1/sales/${saleResponse.body.saleId}/void`)
      .set("x-tenant-id", "tenant-lagos-foods")
      .set("x-role", "manager")
      .set("x-user-id", "manager-1")
      .send({ reason: "Missing branch void" });

    expect(saleResponse.status).toBe(201);
    expect(listResponse.status).toBe(403);
    expect(createResponse.status).toBe(403);
    expect(receiptResponse.status).toBe(403);
    expect(refundResponse.status).toBe(403);
    expect(voidResponse.status).toBe(403);
    expect(listResponse.body.error).toBe("Branch access denied");
    expect(createResponse.body.error).toBe("Branch access denied");
    expect(receiptResponse.body.error).toBe("Branch access denied");
    expect(refundResponse.body.error).toBe("Branch access denied");
    expect(voidResponse.body.error).toBe("Branch access denied");
  });

  it("requires payment references and exact settlement totals", async () => {
    const missingReferenceResponse = await request(app)
      .post("/api/v1/sales")
      .set("x-tenant-id", "tenant-lagos-foods")
      .set("x-branch-id", "branch-lagos-main")
      .set("x-role", "cashier")
      .set("x-user-id", "cashier-1")
      .send({
        branchId: "branch-lagos-main",
        terminalId: "terminal-web-1",
        idempotencyKey: "terminal-web-1-card-missing-reference",
        lines: [{ productId: "p3", quantity: 1, discount: 0 }],
        payments: [{ method: "card", amount: 4725 }]
      });
    const underpaidResponse = await request(app)
      .post("/api/v1/sales")
      .set("x-tenant-id", "tenant-lagos-foods")
      .set("x-branch-id", "branch-lagos-main")
      .set("x-role", "cashier")
      .set("x-user-id", "cashier-1")
      .send({
        branchId: "branch-lagos-main",
        terminalId: "terminal-web-1",
        idempotencyKey: "terminal-web-1-underpaid-sale",
        lines: [{ productId: "p3", quantity: 1, discount: 0 }],
        payments: [{ method: "cash", amount: 1000 }]
      });

    expect(missingReferenceResponse.status).toBe(400);
    expect(missingReferenceResponse.body.error).toBe("Invalid sale payload");
    expect(underpaidResponse.status).toBe(409);
    expect(underpaidResponse.body).toMatchObject({ error: "Payment total must match sale total", paid: 1000 });
  });

  it("records mixed tender payments on a single sale", async () => {
    const registerBefore = await request(app)
      .get("/api/v1/registers/current?branchId=branch-lagos-main&terminalId=terminal-web-1")
      .set("x-tenant-id", "tenant-lagos-foods")
      .set("x-branch-id", "branch-lagos-main")
      .set("x-role", "manager")
      .set("x-user-id", "manager-1");
    const response = await request(app)
      .post("/api/v1/sales")
      .set("x-tenant-id", "tenant-lagos-foods")
      .set("x-branch-id", "branch-lagos-main")
      .set("x-role", "cashier")
      .set("x-user-id", "cashier-1")
      .send({
        branchId: "branch-lagos-main",
        terminalId: "terminal-web-1",
        idempotencyKey: "terminal-web-1-mixed-tender-sale",
        lines: [{ productId: "p3", quantity: 1, discount: 0 }],
        payments: [
          { method: "cash", amount: 2000 },
          { method: "card", amount: 2725, reference: "CARD-MIX-001" }
        ]
      });
    const registerAfter = await request(app)
      .get("/api/v1/registers/current?branchId=branch-lagos-main&terminalId=terminal-web-1")
      .set("x-tenant-id", "tenant-lagos-foods")
      .set("x-branch-id", "branch-lagos-main")
      .set("x-role", "manager")
      .set("x-user-id", "manager-1");

    expect(response.status).toBe(201);
    expect(response.body.summary).toMatchObject({ total: 4725, paid: 4725, balance: 0 });
    expect(registerAfter.body.shift.expectedCash).toBe(registerBefore.body.shift.expectedCash + 2000);
    expect(registerAfter.body.payments).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ saleId: response.body.saleId, method: "cash", amount: 2000, reconciliationStatus: "matched" }),
        expect.objectContaining({ saleId: response.body.saleId, method: "card", amount: 2725, reference: "CARD-MIX-001", reconciliationStatus: "pending" })
      ])
    );
  });

  it("attaches customers to sales and awards loyalty points", async () => {
    const beforeResponse = await request(app)
      .get("/api/v1/customers?q=amina")
      .set("x-tenant-id", "tenant-lagos-foods")
      .set("x-branch-id", "branch-lagos-main")
      .set("x-role", "cashier")
      .set("x-user-id", "cashier-1");
    const beforePoints = beforeResponse.body.customers[0].loyaltyPoints;

    const saleResponse = await request(app)
      .post("/api/v1/sales")
      .set("x-tenant-id", "tenant-lagos-foods")
      .set("x-branch-id", "branch-lagos-main")
      .set("x-role", "cashier")
      .set("x-user-id", "cashier-1")
      .send({
        branchId: "branch-lagos-main",
        terminalId: "terminal-web-1",
        customerId: "cust-1",
        idempotencyKey: "terminal-web-1-customer-loyalty",
        lines: [{ productId: "p3", quantity: 1, discount: 0 }],
        payments: [{ method: "cash", amount: 4725 }]
      });

    const afterResponse = await request(app)
      .get("/api/v1/customers?q=amina")
      .set("x-tenant-id", "tenant-lagos-foods")
      .set("x-branch-id", "branch-lagos-main")
      .set("x-role", "cashier")
      .set("x-user-id", "cashier-1");
    const salesResponse = await request(app)
      .get("/api/v1/sales?branchId=branch-lagos-main&status=all")
      .set("x-tenant-id", "tenant-lagos-foods")
      .set("x-branch-id", "branch-lagos-main")
      .set("x-role", "manager")
      .set("x-user-id", "manager-1");

    expect(saleResponse.status).toBe(201);
    expect(afterResponse.body.customers[0]).toMatchObject({
      id: "cust-1",
      loyaltyPoints: beforePoints + Math.floor(saleResponse.body.summary.total / 100)
    });
    expect(afterResponse.body.customers[0].lastVisitAt).toBeTruthy();
    expect(salesResponse.body.sales.find((sale: { id: string }) => sale.id === saleResponse.body.saleId)).toMatchObject({
      customer: {
        id: "cust-1",
        name: "Amina Bello",
        group: "VIP"
      }
    });
  });

  it("requires a valid customer before posting customer credit payments", async () => {
    const missingCustomerResponse = await request(app)
      .post("/api/v1/sales")
      .set("x-tenant-id", "tenant-lagos-foods")
      .set("x-branch-id", "branch-lagos-main")
      .set("x-role", "cashier")
      .set("x-user-id", "cashier-1")
      .send({
        branchId: "branch-lagos-main",
        terminalId: "terminal-web-1",
        idempotencyKey: "terminal-web-1-credit-missing-customer",
        lines: [{ productId: "p3", quantity: 1, discount: 0 }],
        payments: [{ method: "customer_credit", amount: 4725 }]
      });

    const limitResponse = await request(app)
      .post("/api/v1/sales")
      .set("x-tenant-id", "tenant-lagos-foods")
      .set("x-branch-id", "branch-lagos-main")
      .set("x-role", "cashier")
      .set("x-user-id", "cashier-1")
      .send({
        branchId: "branch-lagos-main",
        terminalId: "terminal-web-1",
        customerId: "cust-1",
        idempotencyKey: "terminal-web-1-credit-limit",
        lines: [{ productId: "p3", quantity: 1, discount: 0 }],
        payments: [{ method: "customer_credit", amount: 4725 }]
      });

    expect(missingCustomerResponse.status).toBe(409);
    expect(limitResponse.status).toBe(409);
    expect(limitResponse.body.error).toBe("Customer credit limit exceeded");
  });

  it("does not require external reconciliation for customer credit register payments", async () => {
    const terminalId = "terminal-credit-close-test";
    terminals.push({
      id: terminalId,
      tenantId: "tenant-lagos-foods",
      branchId: "branch-lagos-main",
      name: "Credit Close Test",
      deviceCode: "LAG-MAIN-CREDIT",
      status: "online",
      appVersion: "1.0.0",
      lastSeenAt: new Date().toISOString(),
      createdAt: new Date().toISOString()
    });

    const openResponse = await request(app)
      .post("/api/v1/registers/open")
      .set("x-tenant-id", "tenant-lagos-foods")
      .set("x-branch-id", "branch-lagos-main")
      .set("x-role", "cashier")
      .set("x-user-id", "cashier-1")
      .send({ branchId: "branch-lagos-main", terminalId, openingBalance: 0 });

    const saleResponse = await request(app)
      .post("/api/v1/sales")
      .set("x-tenant-id", "tenant-lagos-foods")
      .set("x-branch-id", "branch-lagos-main")
      .set("x-role", "cashier")
      .set("x-user-id", "cashier-1")
      .send({
        branchId: "branch-lagos-main",
        terminalId,
        customerId: "cust-2",
        idempotencyKey: `${terminalId}-customer-credit`,
        lines: [{ productId: "p3", quantity: 1, discount: 0 }],
        payments: [{ method: "customer_credit", amount: 4725 }]
    });

    const creditPayment = paymentRecords.find((payment) => payment.saleId === saleResponse.body.saleId && payment.method === "customer_credit");
    const approvalId = await applyRegisterCloseApproval({
      shiftId: openResponse.body.shift.id,
      amount: openResponse.body.shift.expectedCash,
      reason: "Customer credit close test"
    });
    const closeResponse = await request(app)
      .post("/api/v1/registers/close")
      .set("x-tenant-id", "tenant-lagos-foods")
      .set("x-branch-id", "branch-lagos-main")
      .set("x-role", "manager")
      .set("x-user-id", "manager-1")
      .send({ shiftId: openResponse.body.shift.id, countedCash: 0, managerNote: "Customer credit does not need settlement matching", approvalId });

    expect(openResponse.status).toBe(201);
    expect(saleResponse.status).toBe(201);
    expect(creditPayment?.reconciliationStatus).toBe("matched");
    expect(closeResponse.status).toBe(200);
    expect(closeResponse.body.shift).toMatchObject({ id: openResponse.body.shift.id, status: "closed", expectedCash: 0 });
  });

  it("reverses customer balances and loyalty when credit sales are refunded or voided", async () => {
    const beforeResponse = await request(app)
      .get("/api/v1/customers?q=kola")
      .set("x-tenant-id", "tenant-lagos-foods")
      .set("x-branch-id", "branch-lagos-main")
      .set("x-role", "cashier")
      .set("x-user-id", "cashier-1");
    const beforeCustomer = beforeResponse.body.customers[0];

    const refundSaleResponse = await request(app)
      .post("/api/v1/sales")
      .set("x-tenant-id", "tenant-lagos-foods")
      .set("x-branch-id", "branch-lagos-main")
      .set("x-role", "cashier")
      .set("x-user-id", "cashier-1")
      .send({
        branchId: "branch-lagos-main",
        terminalId: "terminal-web-1",
        customerId: "cust-2",
        idempotencyKey: "terminal-web-1-credit-refund-reversal",
        lines: [{ productId: "p3", quantity: 1, discount: 0 }],
        payments: [{ method: "customer_credit", amount: 4725 }]
      });
    const wrongBranchRefundResponse = await request(app)
      .post(`/api/v1/sales/${refundSaleResponse.body.saleId}/refund`)
      .set("x-tenant-id", "tenant-lagos-foods")
      .set("x-branch-id", "branch-lagos-ikeja")
      .set("x-role", "manager")
      .set("x-user-id", "manager-1")
      .send({ amount: 100, reason: "Wrong branch attempt" });
    const refundApprovalId = await applySaleActionApproval({
      saleId: refundSaleResponse.body.saleId,
      type: "refund",
      amount: 2000,
      reason: "Customer returned part order"
    });

    const refundResponse = await request(app)
      .post(`/api/v1/sales/${refundSaleResponse.body.saleId}/refund`)
      .set("x-tenant-id", "tenant-lagos-foods")
      .set("x-branch-id", "branch-lagos-main")
      .set("x-role", "manager")
      .set("x-user-id", "manager-1")
      .send({ amount: 2000, reason: "Customer returned part order", approvalId: refundApprovalId });

    const afterRefundResponse = await request(app)
      .get("/api/v1/customers?q=kola")
      .set("x-tenant-id", "tenant-lagos-foods")
      .set("x-branch-id", "branch-lagos-main")
      .set("x-role", "cashier")
      .set("x-user-id", "cashier-1");
    const afterRefundCustomer = afterRefundResponse.body.customers[0];

    const voidSaleResponse = await request(app)
      .post("/api/v1/sales")
      .set("x-tenant-id", "tenant-lagos-foods")
      .set("x-branch-id", "branch-lagos-main")
      .set("x-role", "cashier")
      .set("x-user-id", "cashier-1")
      .send({
        branchId: "branch-lagos-main",
        terminalId: "terminal-web-1",
        customerId: "cust-2",
        idempotencyKey: "terminal-web-1-credit-void-reversal",
        lines: [{ productId: "p3", quantity: 1, discount: 0 }],
        payments: [{ method: "customer_credit", amount: 4725 }]
      });
    const wrongBranchVoidResponse = await request(app)
      .post(`/api/v1/sales/${voidSaleResponse.body.saleId}/void`)
      .set("x-tenant-id", "tenant-lagos-foods")
      .set("x-branch-id", "branch-lagos-ikeja")
      .set("x-role", "manager")
      .set("x-user-id", "manager-1")
      .send({ reason: "Wrong branch attempt" });
    const voidApprovalId = await applySaleActionApproval({
      saleId: voidSaleResponse.body.saleId,
      type: "void",
      amount: voidSaleResponse.body.summary.total,
      reason: "Customer cancelled credit order"
    });

    const voidResponse = await request(app)
      .post(`/api/v1/sales/${voidSaleResponse.body.saleId}/void`)
      .set("x-tenant-id", "tenant-lagos-foods")
      .set("x-branch-id", "branch-lagos-main")
      .set("x-role", "manager")
      .set("x-user-id", "manager-1")
      .send({ reason: "Customer cancelled credit order", approvalId: voidApprovalId });

    const afterVoidResponse = await request(app)
      .get("/api/v1/customers?q=kola")
      .set("x-tenant-id", "tenant-lagos-foods")
      .set("x-branch-id", "branch-lagos-main")
      .set("x-role", "cashier")
      .set("x-user-id", "cashier-1");
    const ledgerResponse = await request(app)
      .get("/api/v1/customers/cust-2/ledger")
      .set("x-tenant-id", "tenant-lagos-foods")
      .set("x-branch-id", "branch-lagos-main")
      .set("x-role", "manager")
      .set("x-user-id", "manager-1");

    expect(refundSaleResponse.status).toBe(201);
    expect(wrongBranchRefundResponse.status).toBe(404);
    expect(refundResponse.status).toBe(200);
    expect(afterRefundCustomer.outstandingBalance).toBe(beforeCustomer.outstandingBalance + 2725);
    expect(afterRefundCustomer.loyaltyPoints).toBe(beforeCustomer.loyaltyPoints + 27);
    expect(voidSaleResponse.status).toBe(201);
    expect(wrongBranchVoidResponse.status).toBe(404);
    expect(voidResponse.status).toBe(200);
    expect(afterVoidResponse.body.customers[0].outstandingBalance).toBe(afterRefundCustomer.outstandingBalance);
    expect(afterVoidResponse.body.customers[0].loyaltyPoints).toBe(afterRefundCustomer.loyaltyPoints);
    expect(ledgerResponse.body.entries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: "payment", amount: -2000, note: expect.stringContaining("Refunded credit") }),
        expect.objectContaining({ type: "loyalty_adjustment", pointsDelta: -20, note: expect.stringContaining("Refunded loyalty") }),
        expect.objectContaining({ type: "payment", amount: -4725, note: expect.stringContaining("Voided credit") }),
        expect.objectContaining({ type: "loyalty_adjustment", pointsDelta: -47, note: expect.stringContaining("Voided loyalty") })
      ])
    );
  });

  it("blocks cashiers from reading audit events", async () => {
    const response = await request(app)
      .get("/api/v1/audit")
      .set("x-tenant-id", "tenant-lagos-foods")
      .set("x-branch-id", "branch-lagos-main")
      .set("x-role", "cashier")
      .set("x-user-id", "cashier-1");

    expect(response.status).toBe(403);
  });

  it("replays duplicate sale submissions by idempotency key", async () => {
    const payload = {
      branchId: "branch-lagos-main",
      terminalId: "terminal-web-1",
      idempotencyKey: "terminal-web-1-0003",
      lines: [{ productId: "p3", quantity: 1, discount: 0 }],
      payments: [{ method: "cash", amount: 4725 }]
    };

    const firstResponse = await request(app)
      .post("/api/v1/sales")
      .set("x-tenant-id", "tenant-lagos-foods")
      .set("x-branch-id", "branch-lagos-main")
      .set("x-role", "cashier")
      .set("x-user-id", "cashier-1")
      .send(payload);

    const replayResponse = await request(app)
      .post("/api/v1/sales")
      .set("x-tenant-id", "tenant-lagos-foods")
      .set("x-branch-id", "branch-lagos-main")
      .set("x-role", "cashier")
      .set("x-user-id", "cashier-1")
      .send(payload);

    expect(firstResponse.status).toBe(201);
    expect(replayResponse.status).toBe(200);
    expect(replayResponse.body.saleId).toBe(firstResponse.body.saleId);
  });

  it("lists completed sales with payment records", async () => {
    const saleResponse = await request(app)
      .post("/api/v1/sales")
      .set("x-tenant-id", "tenant-lagos-foods")
      .set("x-branch-id", "branch-lagos-main")
      .set("x-role", "cashier")
      .set("x-user-id", "cashier-1")
      .send({
        branchId: "branch-lagos-main",
        terminalId: "terminal-web-1",
        idempotencyKey: "terminal-web-1-0005",
        lines: [{ productId: "p2", quantity: 1, discount: 0 }],
        payments: [{ method: "card", amount: 14063, reference: "CARD-001" }]
      });

    const listResponse = await request(app)
      .get("/api/v1/sales?branchId=branch-lagos-main&status=all")
      .set("x-tenant-id", "tenant-lagos-foods")
      .set("x-branch-id", "branch-lagos-main")
      .set("x-role", "manager")
      .set("x-user-id", "manager-1");

    expect(saleResponse.status).toBe(201);
    expect(listResponse.status).toBe(200);
    expect(listResponse.body.sales[0]).toMatchObject({
      id: saleResponse.body.saleId,
      status: "completed",
      payments: [{ method: "card", reference: "CARD-001" }]
    });

    const registerResponse = await request(app)
      .get("/api/v1/registers/current?branchId=branch-lagos-main&terminalId=terminal-web-1")
      .set("x-tenant-id", "tenant-lagos-foods")
      .set("x-branch-id", "branch-lagos-main")
      .set("x-role", "manager")
      .set("x-user-id", "manager-1");
    const payment = registerResponse.body.payments.find((item: { saleId: string }) => item.saleId === saleResponse.body.saleId);
    const closeWithPendingResponse = await request(app)
      .post("/api/v1/registers/close")
      .set("x-tenant-id", "tenant-lagos-foods")
      .set("x-branch-id", "branch-lagos-main")
      .set("x-role", "manager")
      .set("x-user-id", "manager-1")
      .send({ shiftId: registerResponse.body.shift.id, countedCash: registerResponse.body.shift.expectedCash });
    const reconcileResponse = await request(app)
      .patch(`/api/v1/registers/payments/${payment.id}/reconcile`)
      .set("x-tenant-id", "tenant-lagos-foods")
      .set("x-branch-id", "branch-lagos-main")
      .set("x-role", "manager")
      .set("x-user-id", "manager-1")
      .send({ note: "Processor batch CARD-001" });
    const auditResponse = await request(app)
      .get("/api/v1/audit")
      .set("x-tenant-id", "tenant-lagos-foods")
      .set("x-role", "owner")
      .set("x-user-id", "LCF-MAI-ADA");

    expect(payment).toMatchObject({ method: "card", reconciliationStatus: "pending" });
    expect(closeWithPendingResponse.status).toBe(409);
    expect(closeWithPendingResponse.body.error).toBe("Reconcile pending non-cash payments before closing this register");
    expect(reconcileResponse.status).toBe(200);
    expect(reconcileResponse.body.payment).toMatchObject({ id: payment.id, reconciliationStatus: "matched" });
    expect(auditResponse.body.events.find((event: { action: string; entityId: string }) => event.action === "register.payment_reconciled" && event.entityId === payment.id)).toMatchObject({
      action: "register.payment_reconciled",
      metadata: expect.objectContaining({ saleId: saleResponse.body.saleId, note: "Processor batch CARD-001" })
    });
  });

  it("blocks cashiers from applying refunds and voids", async () => {
    const refundSaleResponse = await request(app)
      .post("/api/v1/sales")
      .set("x-tenant-id", "tenant-lagos-foods")
      .set("x-branch-id", "branch-lagos-main")
      .set("x-role", "cashier")
      .set("x-user-id", "cashier-1")
      .send({
        branchId: "branch-lagos-main",
        terminalId: "terminal-web-1",
        idempotencyKey: "terminal-web-1-cashier-refund-block",
        lines: [{ productId: "p3", quantity: 1, discount: 0 }],
        payments: [{ method: "cash", amount: 4725 }]
      });
    const cashierRefundResponse = await request(app)
      .post(`/api/v1/sales/${refundSaleResponse.body.saleId}/refund`)
      .set("x-tenant-id", "tenant-lagos-foods")
      .set("x-branch-id", "branch-lagos-main")
      .set("x-role", "cashier")
      .set("x-user-id", "cashier-1")
      .send({ amount: 1000, reason: "Unauthorized cashier refund" });

    const voidSaleResponse = await request(app)
      .post("/api/v1/sales")
      .set("x-tenant-id", "tenant-lagos-foods")
      .set("x-branch-id", "branch-lagos-main")
      .set("x-role", "cashier")
      .set("x-user-id", "cashier-1")
      .send({
        branchId: "branch-lagos-main",
        terminalId: "terminal-web-1",
        idempotencyKey: "terminal-web-1-cashier-void-block",
        lines: [{ productId: "p1", quantity: 1, discount: 0 }],
        payments: [{ method: "cash", amount: 9563 }]
      });
    const cashierVoidResponse = await request(app)
      .post(`/api/v1/sales/${voidSaleResponse.body.saleId}/void`)
      .set("x-tenant-id", "tenant-lagos-foods")
      .set("x-branch-id", "branch-lagos-main")
      .set("x-role", "cashier")
      .set("x-user-id", "cashier-1")
      .send({ reason: "Unauthorized cashier void" });

    expect(refundSaleResponse.status).toBe(201);
    expect(cashierRefundResponse.status).toBe(403);
    expect(voidSaleResponse.status).toBe(201);
    expect(cashierVoidResponse.status).toBe(403);
  });

  it("allows managers to refund and void eligible sales", async () => {
    const stockBefore = await request(app)
      .get("/api/v1/inventory/stock")
      .set("x-tenant-id", "tenant-lagos-foods")
      .set("x-branch-id", "branch-lagos-main")
      .set("x-role", "manager")
      .set("x-user-id", "manager-1");
    const p1StockBefore = stockBefore.body.products.find((product: { id: string; stock: number }) => product.id === "p1").stock;
    const p3StockBefore = stockBefore.body.products.find((product: { id: string; stock: number }) => product.id === "p3").stock;
    const registerBefore = await request(app)
      .get("/api/v1/registers/current?branchId=branch-lagos-main&terminalId=terminal-web-1")
      .set("x-tenant-id", "tenant-lagos-foods")
      .set("x-branch-id", "branch-lagos-main")
      .set("x-role", "manager")
      .set("x-user-id", "manager-1");

    const refundSaleResponse = await request(app)
      .post("/api/v1/sales")
      .set("x-tenant-id", "tenant-lagos-foods")
      .set("x-branch-id", "branch-lagos-main")
      .set("x-role", "cashier")
      .set("x-user-id", "cashier-1")
      .send({
        branchId: "branch-lagos-main",
        terminalId: "terminal-web-1",
        idempotencyKey: "terminal-web-1-0006",
        lines: [{ productId: "p3", quantity: 1, discount: 0 }],
        payments: [{ method: "cash", amount: 4725 }]
      });
    const directRefundResponse = await request(app)
      .post(`/api/v1/sales/${refundSaleResponse.body.saleId}/refund`)
      .set("x-tenant-id", "tenant-lagos-foods")
      .set("x-branch-id", "branch-lagos-main")
      .set("x-role", "manager")
      .set("x-user-id", "manager-1")
      .send({ amount: 4725, reason: "Returned item" });
    const refundApprovalId = await applySaleActionApproval({
      saleId: refundSaleResponse.body.saleId,
      type: "refund",
      amount: 4725,
      reason: "Returned item"
    });

    const refundResponse = await request(app)
      .post(`/api/v1/sales/${refundSaleResponse.body.saleId}/refund`)
      .set("x-tenant-id", "tenant-lagos-foods")
      .set("x-branch-id", "branch-lagos-main")
      .set("x-role", "manager")
      .set("x-user-id", "manager-1")
      .send({ amount: 4725, reason: "Returned item", approvalId: refundApprovalId });

    const voidSaleResponse = await request(app)
      .post("/api/v1/sales")
      .set("x-tenant-id", "tenant-lagos-foods")
      .set("x-branch-id", "branch-lagos-main")
      .set("x-role", "cashier")
      .set("x-user-id", "cashier-1")
      .send({
        branchId: "branch-lagos-main",
        terminalId: "terminal-web-1",
        idempotencyKey: "terminal-web-1-0007",
        lines: [{ productId: "p1", quantity: 1, discount: 0 }],
        payments: [{ method: "cash", amount: 9563 }]
      });
    const directVoidResponse = await request(app)
      .post(`/api/v1/sales/${voidSaleResponse.body.saleId}/void`)
      .set("x-tenant-id", "tenant-lagos-foods")
      .set("x-branch-id", "branch-lagos-main")
      .set("x-role", "manager")
      .set("x-user-id", "manager-1")
      .send({ reason: "Duplicate order" });
    const voidApprovalId = await applySaleActionApproval({
      saleId: voidSaleResponse.body.saleId,
      type: "void",
      amount: voidSaleResponse.body.summary.total,
      reason: "Duplicate order"
    });

    const voidResponse = await request(app)
      .post(`/api/v1/sales/${voidSaleResponse.body.saleId}/void`)
      .set("x-tenant-id", "tenant-lagos-foods")
      .set("x-branch-id", "branch-lagos-main")
      .set("x-role", "manager")
      .set("x-user-id", "manager-1")
      .send({ reason: "Duplicate order", approvalId: voidApprovalId });
    const stockAfter = await request(app)
      .get("/api/v1/inventory/stock")
      .set("x-tenant-id", "tenant-lagos-foods")
      .set("x-branch-id", "branch-lagos-main")
      .set("x-role", "manager")
      .set("x-user-id", "manager-1");
    const registerAfter = await request(app)
      .get("/api/v1/registers/current?branchId=branch-lagos-main&terminalId=terminal-web-1")
      .set("x-tenant-id", "tenant-lagos-foods")
      .set("x-branch-id", "branch-lagos-main")
      .set("x-role", "manager")
      .set("x-user-id", "manager-1");

    expect(registerBefore.status).toBe(200);
    expect(directRefundResponse.status).toBe(409);
    expect(directRefundResponse.body.error).toBe("Applied refund approval is required");
    expect(refundResponse.status).toBe(200);
    expect(refundResponse.body.sale).toMatchObject({ status: "refunded", refundTotal: 4725 });
    expect(directVoidResponse.status).toBe(409);
    expect(directVoidResponse.body.error).toBe("Applied void approval is required");
    expect(voidResponse.status).toBe(200);
    expect(voidResponse.body.sale).toMatchObject({ status: "voided", voidReason: "Duplicate order" });
    expect(stockAfter.body.products.find((product: { id: string; stock: number }) => product.id === "p1").stock).toBe(p1StockBefore);
    expect(stockAfter.body.products.find((product: { id: string; stock: number }) => product.id === "p3").stock).toBe(p3StockBefore);
    expect(stockAfter.body.movements).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ productId: "p3", type: "receipt", quantityDelta: 1, reference: refundSaleResponse.body.saleId }),
        expect.objectContaining({ productId: "p1", type: "receipt", quantityDelta: 1, reference: voidSaleResponse.body.saleId })
      ])
    );
    expect(registerAfter.body.shift.expectedCash).toBe(registerBefore.body.shift.expectedCash);
    expect(registerAfter.body.movements).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: "cash_out", amount: 4725, reason: expect.stringContaining(refundSaleResponse.body.saleId) }),
        expect.objectContaining({ type: "cash_out", amount: 9563, reason: expect.stringContaining(voidSaleResponse.body.saleId) })
      ])
    );
  });
});




