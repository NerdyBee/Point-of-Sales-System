import request from "supertest";
import { describe, expect, it } from "vitest";
import { createApp } from "./app";

const app = createApp();

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
        image: "",
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
      .set("x-role", "manager");

    expect(response.status).toBe(401);
    expect(response.body.error).toBe("Authenticated user context is required");
  });

  it("requires a real user context for tenant write workflows without dedicated permissions", async () => {
    const response = await request(app)
      .post("/api/v1/sync/queue")
      .set("x-tenant-id", "tenant-lagos-foods")
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
      .set("x-user-id", "owner-1");

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

  it("allows state managers to read across branches", async () => {
    const response = await request(app)
      .get("/api/v1/branches/options")
      .set("x-tenant-id", "tenant-lagos-foods")
      .set("x-role", "state_manager")
      .set("x-user-id", "state-manager-1");

    expect(response.status).toBe(200);
    expect(response.body.branches.length).toBeGreaterThan(1);
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
  });

  it("allows owners to update tenant settings", async () => {
    const response = await request(app)
      .patch("/api/v1/tenants/current/settings")
      .set("x-tenant-id", "tenant-lagos-foods")
      .set("x-role", "owner")
      .set("x-user-id", "owner-1")
      .send({
        businessName: "Lagos Central Foods HQ",
        taxId: "TIN-1029384756",
        defaultBranchId: "branch-lagos-main",
        defaultTaxRate: 0.075,
        currency: "NGN",
        productCategories: ["Meals", "Drinks", "Bakery", "Retail", "Pharmacy", "Services", "Breakfast"],
        receiptFooter: "Thank you for shopping with us.",
        whatsappReceipts: true,
        paymentMethods: { cash: true, card: true, bankTransfer: true, mobileMoney: false },
        hardware: { printer: "Epson TM-T20III", cashDrawer: true, barcodeScanner: true }
      });

    expect(response.status).toBe(200);
    expect(response.body.tenant.settings).toMatchObject({ businessName: "Lagos Central Foods HQ", currency: "NGN" });
    expect(response.body.tenant.settings.productCategories).toContain("Breakfast");
  });

  it("rejects tenant settings with no enabled payment methods", async () => {
    const response = await request(app)
      .patch("/api/v1/tenants/current/settings")
      .set("x-tenant-id", "tenant-lagos-foods")
      .set("x-role", "owner")
      .set("x-user-id", "owner-1")
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
      .set("x-user-id", "owner-1")
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
      .set("x-user-id", "owner-1")
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
      .set("x-role", "manager")
      .set("x-user-id", "manager-1")
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
      .set("x-role", "manager")
      .set("x-user-id", "manager-1")
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
      .set("x-role", "manager")
      .set("x-user-id", "manager-1");
    const optionsResponse = await request(app)
      .get("/api/v1/branches/options")
      .set("x-tenant-id", "tenant-lagos-foods")
      .set("x-role", "cashier")
      .set("x-user-id", "cashier-1");

    expect(branchResponse.status).toBe(201);
    expect(terminalResponse.status).toBe(201);
    expect(terminalResponse.body.terminal).toMatchObject({ branchId: branchResponse.body.branch.id, status: "online" });
    expect(listResponse.body.branches).toEqual(expect.arrayContaining([expect.objectContaining({ name: "Surulere Pickup" })]));
    expect(listResponse.body.terminals).toEqual(expect.arrayContaining([expect.objectContaining({ deviceCode: "LAG-SURULERE-01" })]));
    expect(optionsResponse.status).toBe(200);
    expect(optionsResponse.body.branches[0].address).toBeUndefined();
    expect(optionsResponse.body.terminals).toEqual(expect.arrayContaining([expect.objectContaining({ deviceCode: "LAG-SURULERE-01" })]));
  });

  it("protects branch dependencies and tenant plan limits", async () => {
    const defaultBranchResponse = await request(app)
      .patch("/api/v1/branches/branch-lagos-main")
      .set("x-tenant-id", "tenant-lagos-foods")
      .set("x-role", "manager")
      .set("x-user-id", "manager-1")
      .send({ status: "paused" });
    const pausedBranchTerminalResponse = await request(app)
      .post("/api/v1/branches/terminals")
      .set("x-tenant-id", "tenant-lagos-foods")
      .set("x-role", "manager")
      .set("x-user-id", "manager-1")
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
      .set("x-role", "manager")
      .set("x-user-id", "manager-1")
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
      .set("x-role", "manager")
      .set("x-user-id", "manager-1")
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
      .set("x-role", "manager")
      .set("x-user-id", "manager-1")
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
      .set("x-user-id", "owner-1");
    const openInvoice = overviewResponse.body.invoices.find((invoice: { status: string }) => invoice.status === "open");
    const renewalDate = new Date(Date.now() + 1000 * 60 * 60 * 24 * 30).toISOString();

    const updateResponse = await request(app)
      .patch("/api/v1/subscriptions/current")
      .set("x-tenant-id", "tenant-lagos-foods")
      .set("x-role", "owner")
      .set("x-user-id", "owner-1")
      .send({
        plan: "Business",
        status: "active",
        billingEmail: "billing@lagoscentral.example",
        renewalDate,
        notes: "Downgraded after pilot branch cleanup"
      });
    const invoiceResponse = await request(app)
      .patch(`/api/v1/subscriptions/invoices/${openInvoice.id}`)
      .set("x-tenant-id", "tenant-lagos-foods")
      .set("x-role", "owner")
      .set("x-user-id", "owner-1")
      .send({ status: "paid", paymentReference: "MANUAL-SUB-1002" });
    const branchLimitResponse = await request(app)
      .post("/api/v1/branches")
      .set("x-tenant-id", "tenant-lagos-foods")
      .set("x-role", "manager")
      .set("x-user-id", "manager-1")
      .send({
        name: "Business Limit Branch",
        address: "20 Marina Road",
        city: "Lagos",
        phone: "+2348010000066",
        status: "active"
      });

    expect(overviewResponse.status).toBe(200);
    expect(overviewResponse.body.subscription).toMatchObject({ plan: "Professional", status: "active" });
    expect(updateResponse.status).toBe(200);
    expect(updateResponse.body.subscription).toMatchObject({ plan: "Business", branchLimit: 3, billingEmail: "billing@lagoscentral.example" });
    expect(invoiceResponse.status).toBe(200);
    expect(invoiceResponse.body.invoice).toMatchObject({ id: openInvoice.id, status: "paid", paymentReference: "MANUAL-SUB-1002" });
    expect(branchLimitResponse.status).toBe(409);
    expect(branchLimitResponse.body.error).toBe("Active branch limit reached for this tenant plan");
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
      .set("x-role", "cashier")
      .set("x-user-id", "cashier-1")
      .send(payload);
    const replayResponse = await request(app)
      .post("/api/v1/sync/queue")
      .set("x-tenant-id", "tenant-lagos-foods")
      .set("x-role", "cashier")
      .set("x-user-id", "cashier-1")
      .send(payload);
    const listResponse = await request(app)
      .get("/api/v1/sync/queue?branchId=branch-lagos-main&status=all")
      .set("x-tenant-id", "tenant-lagos-foods")
      .set("x-role", "manager")
      .set("x-user-id", "manager-1");
    const conflictResponse = await request(app)
      .patch(`/api/v1/sync/queue/${createResponse.body.record.id}/status`)
      .set("x-tenant-id", "tenant-lagos-foods")
      .set("x-role", "manager")
      .set("x-user-id", "manager-1")
      .send({ status: "conflict", error: "Server record changed after offline capture" });
    const resolvedResponse = await request(app)
      .patch(`/api/v1/sync/queue/${createResponse.body.record.id}/status`)
      .set("x-tenant-id", "tenant-lagos-foods")
      .set("x-role", "manager")
      .set("x-user-id", "manager-1")
      .send({ status: "synced", serverEntityId: "INV-OFFLINE-1" });

    expect(createResponse.status).toBe(201);
    expect(createResponse.body.record).toMatchObject({ status: "queued", idempotencyKey: payload.idempotencyKey });
    expect(replayResponse.status).toBe(200);
    expect(replayResponse.body).toMatchObject({ status: "replayed", record: { id: createResponse.body.record.id } });
    expect(listResponse.body.records).toEqual(expect.arrayContaining([expect.objectContaining({ id: createResponse.body.record.id })]));
    expect(conflictResponse.body.record).toMatchObject({ status: "conflict", error: "Server record changed after offline capture" });
    expect(resolvedResponse.body.record).toMatchObject({ status: "synced", serverEntityId: "INV-OFFLINE-1", syncedAt: expect.any(String) });
  });

  it("rejects sync records for branches and terminals outside their tenant relationship", async () => {
    const invalidBranchResponse = await request(app)
      .post("/api/v1/sync/queue")
      .set("x-tenant-id", "tenant-lagos-foods")
      .set("x-role", "cashier")
      .set("x-user-id", "cashier-1")
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
      .set("x-role", "cashier")
      .set("x-user-id", "cashier-1")
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

  it("returns dashboard report metrics for owners", async () => {
    const response = await request(app)
      .get("/api/v1/reports/dashboard?branchId=branch-lagos-main")
      .set("x-tenant-id", "tenant-lagos-foods")
      .set("x-branch-id", "branch-lagos-main")
      .set("x-role", "owner")
      .set("x-user-id", "owner-1");

    expect(response.status).toBe(200);
    expect(response.body.period).toBe("today");
    expect(response.body.periodLabel).toBe("Today");
    expect(response.body.summary).toMatchObject({
      totalSales: expect.any(Number),
      orderCount: expect.any(Number),
      grossProfit: expect.any(Number),
      pendingApprovalCount: expect.any(Number),
      pendingApprovalValue: expect.any(Number),
      highPriorityApprovalCount: expect.any(Number)
    });
    expect(response.body.lowStock).toEqual(expect.any(Array));
    expect(response.body.categorySales).toEqual(expect.any(Array));
    expect(response.body.topProducts).toEqual(expect.any(Array));
    expect(response.body.approvals).toEqual(expect.any(Array));
  });

  it("returns dashboard metrics for the selected reporting period", async () => {
    const response = await request(app)
      .get("/api/v1/reports/dashboard?branchId=branch-lagos-main&period=week")
      .set("x-tenant-id", "tenant-lagos-foods")
      .set("x-branch-id", "branch-lagos-main")
      .set("x-role", "owner")
      .set("x-user-id", "owner-1");

    expect(response.status).toBe(200);
    expect(response.body.period).toBe("week");
    expect(response.body.periodLabel).toBe("This week");
    expect(response.body.hourlySales).toHaveLength(7);
    expect(response.body.hourlySales[0]).toMatchObject({
      label: expect.any(String),
      amount: expect.any(Number)
    });
  });

  it("rejects reports for branches outside the tenant", async () => {
    const response = await request(app)
      .get("/api/v1/reports/dashboard?branchId=branch-abuja-main")
      .set("x-tenant-id", "tenant-lagos-foods")
      .set("x-role", "owner")
      .set("x-user-id", "owner-1");

    expect(response.status).toBe(404);
    expect(response.body.error).toBe("Report branch not found for this tenant");
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

  it("allows products to use categories configured in tenant settings", async () => {
    const response = await request(app)
      .post("/api/v1/catalog/products")
      .set("x-tenant-id", "tenant-lagos-foods")
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
      .set("x-role", "manager")
      .set("x-user-id", "manager-1")
      .send({ branchId: "branch-abuja-main" });

    expect(createResponse.status).toBe(404);
    expect(createResponse.body.error).toBe("Product branch not found for this tenant");
    expect(updateResponse.status).toBe(404);
    expect(updateResponse.body.error).toBe("Product branch not found for this tenant");
  });

  it("renames tenant product categories and updates linked products", async () => {
    const renameResponse = await request(app)
      .patch("/api/v1/tenants/current/product-categories/rename")
      .set("x-tenant-id", "tenant-lagos-foods")
      .set("x-role", "owner")
      .set("x-user-id", "owner-1")
      .send({ from: "Breakfast", to: "Morning Meals" });
    const catalogResponse = await request(app)
      .get("/api/v1/catalog/products")
      .set("x-tenant-id", "tenant-lagos-foods")
      .set("x-role", "manager")
      .set("x-user-id", "manager-1");
    const renamedProduct = catalogResponse.body.products.find((product: { sku: string }) => product.sku === "BREAKFAST-AKARA");

    expect(renameResponse.status).toBe(200);
    expect(renameResponse.body.updatedProductCount).toBe(1);
    expect(renameResponse.body.tenant.settings.productCategories).toContain("Morning Meals");
    expect(renameResponse.body.tenant.settings.productCategories).not.toContain("Breakfast");
    expect(renamedProduct).toMatchObject({ sku: "BREAKFAST-AKARA", category: "Morning Meals" });
  });

  it("blocks cashiers from catalog management", async () => {
    const response = await request(app)
      .patch("/api/v1/catalog/products/p1")
      .set("x-tenant-id", "tenant-lagos-foods")
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
      .set("x-branch-id", "branch-lagos-main")
      .set("x-role", "manager")
      .set("x-user-id", "manager-1")
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
      .set("x-branch-id", "branch-lagos-main")
      .set("x-role", "manager")
      .set("x-user-id", "manager-1")
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
      .set("x-branch-id", "branch-lagos-main")
      .set("x-role", "manager")
      .set("x-user-id", "manager-1")
      .send({
        branchId: "branch-abuja-main",
        reference: "COUNT-WRONG-BRANCH",
        reason: "Wrong branch",
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

  it("allows managers to mark tables available", async () => {
    const response = await request(app)
      .patch("/api/v1/restaurant/tables/table-08/state")
      .set("x-tenant-id", "tenant-lagos-foods")
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

  it("blocks cashiers from updating prep ticket status", async () => {
    const response = await request(app)
      .patch("/api/v1/kitchen/tickets/BOT-1089/status")
      .set("x-tenant-id", "tenant-lagos-foods")
      .set("x-role", "cashier")
      .set("x-user-id", "cashier-1")
      .send({ status: "accepted" });

    expect(response.status).toBe(403);
  });

  it("allows cashiers to search tenant customers", async () => {
    const response = await request(app)
      .get("/api/v1/customers?q=amina")
      .set("x-tenant-id", "tenant-lagos-foods")
      .set("x-role", "cashier")
      .set("x-user-id", "cashier-1");

    expect(response.status).toBe(200);
    expect(response.body.customers[0]).toMatchObject({ name: "Amina Bello" });
  });

  it("allows managers to create customers", async () => {
    const response = await request(app)
      .post("/api/v1/customers")
      .set("x-tenant-id", "tenant-lagos-foods")
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

  it("prevents customer credit limit overrides", async () => {
    const response = await request(app)
      .post("/api/v1/customers/cust-1/ledger")
      .set("x-tenant-id", "tenant-lagos-foods")
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
    const response = await request(app)
      .post("/api/v1/customers/cust-2/ledger")
      .set("x-tenant-id", "tenant-lagos-foods")
      .set("x-role", "manager")
      .set("x-user-id", "manager-1")
      .send({
        type: "payment",
        amount: -5000,
        pointsDelta: 0,
        note: "Part account payment"
      });

    expect(response.status).toBe(201);
    expect(response.body.entry).toMatchObject({ type: "payment", amount: -5000 });
    expect(response.body.customer.outstandingBalance).toBeLessThan(38500);
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

  it("lets owners manage roles, permissions, and staff role assignments", async () => {
    const listResponse = await request(app)
      .get("/api/v1/roles")
      .set("x-tenant-id", "tenant-lagos-foods")
      .set("x-role", "owner")
      .set("x-user-id", "owner-1");

    expect(listResponse.status).toBe(200);
    expect(listResponse.body.permissions.map((permission: { action: string }) => permission.action)).toContain("roles.manage");
    expect(listResponse.body.roles.map((role: { name: string }) => role.name)).toContain("owner");

    const managerResponse = await request(app)
      .get("/api/v1/roles")
      .set("x-tenant-id", "tenant-lagos-foods")
      .set("x-role", "manager")
      .set("x-user-id", "manager-1");

    expect(managerResponse.status).toBe(403);

    const optionsResponse = await request(app)
      .get("/api/v1/roles/options")
      .set("x-tenant-id", "tenant-lagos-foods")
      .set("x-role", "manager")
      .set("x-user-id", "manager-1");

    expect(optionsResponse.status).toBe(200);
    expect(optionsResponse.body.roles.map((role: { name: string }) => role.name)).toContain("cashier");
    expect(optionsResponse.body.roles[0].permissions).toEqual([]);

    const createResponse = await request(app)
      .post("/api/v1/roles")
      .set("x-tenant-id", "tenant-lagos-foods")
      .set("x-role", "owner")
      .set("x-user-id", "owner-1")
      .send({ name: "floor_supervisor", label: "Floor Supervisor", description: "Can run floor and kitchen workflows." });

    expect(createResponse.status).toBe(201);
    expect(createResponse.body.role).toMatchObject({ name: "floor_supervisor", system: false });

    const permissionResponse = await request(app)
      .patch(`/api/v1/roles/${createResponse.body.role.id}/permissions`)
      .set("x-tenant-id", "tenant-lagos-foods")
      .set("x-role", "owner")
      .set("x-user-id", "owner-1")
      .send({ permissions: ["restaurant.manage", "kitchen.manage"] });

    expect(permissionResponse.status).toBe(200);
    expect(permissionResponse.body.role.permissions).toEqual(["restaurant.manage", "kitchen.manage"]);

    const assignResponse = await request(app)
      .post("/api/v1/roles/assign-staff")
      .set("x-tenant-id", "tenant-lagos-foods")
      .set("x-role", "owner")
      .set("x-user-id", "owner-1")
      .send({ staffId: "staff-3", role: "floor_supervisor" });

    expect(assignResponse.status).toBe(200);
    expect(assignResponse.body).toMatchObject({ staffId: "staff-3", role: "floor_supervisor" });
  });

  it("prevents assigning roles to staff outside the request branch", async () => {
    const response = await request(app)
      .post("/api/v1/roles/assign-staff")
      .set("x-tenant-id", "tenant-lagos-foods")
      .set("x-branch-id", "branch-abuja-main")
      .set("x-role", "owner")
      .set("x-user-id", "owner-1")
      .send({ staffId: "staff-2", role: "cashier" });

    expect(response.status).toBe(404);
    expect(response.body.error).toBe("Staff not found");
  });

  it("allows managers to invite staff", async () => {
    const response = await request(app)
      .post("/api/v1/staff")
      .set("x-tenant-id", "tenant-lagos-foods")
      .set("x-branch-id", "branch-lagos-main")
      .set("x-role", "manager")
      .set("x-user-id", "staff-1")
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
      .set("x-user-id", "staff-1")
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
      .patch("/api/v1/staff/staff-2/status")
      .set("x-tenant-id", "tenant-lagos-foods")
      .set("x-branch-id", "branch-abuja-main")
      .set("x-role", "manager")
      .set("x-user-id", "staff-1")
      .send({ active: false, reason: "Wrong branch attempt" });

    expect(response.status).toBe(404);
    expect(response.body.error).toBe("Staff member not found");
  });

  it("allows managers to resend and revoke staff invites", async () => {
    const createResponse = await request(app)
      .post("/api/v1/staff")
      .set("x-tenant-id", "tenant-lagos-foods")
      .set("x-branch-id", "branch-lagos-main")
      .set("x-role", "manager")
      .set("x-user-id", "staff-1")
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
      .set("x-role", "manager")
      .set("x-user-id", "staff-1");

    expect(resendResponse.status).toBe(200);
    expect(resendResponse.body.staff).toMatchObject({ inviteStatus: "pending", active: false });

    const revokeResponse = await request(app)
      .post(`/api/v1/staff/${createResponse.body.staff.id}/invite/revoke`)
      .set("x-tenant-id", "tenant-lagos-foods")
      .set("x-role", "manager")
      .set("x-user-id", "staff-1");

    expect(revokeResponse.status).toBe(200);
    expect(revokeResponse.body.staff).toMatchObject({ inviteStatus: "revoked", active: false });
  });

  it("authenticates staff with password and terminal PIN sessions", async () => {
    const bootstrapResponse = await request(app)
      .get("/api/v1/auth/bootstrap")
      .query({ tenantId: "tenant-lagos-foods", branchId: "branch-lagos-main" });
    const passwordResponse = await request(app)
      .post("/api/v1/auth/login")
      .send({
        tenantId: "tenant-lagos-foods",
        email: "chinelo@example.com",
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
        staffId: "staff-2",
        pin: "1234"
      });
    const sessionsResponse = await request(app)
      .get("/api/v1/auth/sessions")
      .set("x-tenant-id", "tenant-lagos-foods")
      .set("x-role", "manager")
      .set("x-user-id", "staff-1");
    const bearerSessionsResponse = await request(app)
      .get("/api/v1/auth/sessions")
      .set("authorization", `Bearer ${passwordResponse.body.accessToken}`)
      .set("x-tenant-id", "tenant-lagos-foods")
      .set("x-role", "cashier")
      .set("x-user-id", "staff-2");
    const revokeResponse = await request(app)
      .post(`/api/v1/auth/sessions/${passwordResponse.body.session.id}/revoke`)
      .set("x-tenant-id", "tenant-lagos-foods")
      .set("x-role", "manager")
      .set("x-user-id", "staff-1");
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
    expect(bootstrapResponse.body.staff).toEqual(expect.arrayContaining([expect.objectContaining({ id: "staff-2", pinEnabled: true })]));
    expect(bootstrapResponse.body.staff[0]).not.toHaveProperty("email");
    expect(passwordResponse.status).toBe(200);
    expect(passwordResponse.body).toMatchObject({
      staff: { email: "chinelo@example.com", role: "manager" },
      session: { terminalId: "terminal-web-1", role: "manager" },
      accessTokenExpiresIn: 900
    });
    expect(passwordResponse.body.accessToken.split(".")).toHaveLength(3);
    expect(passwordResponse.body.refreshToken).toEqual(expect.any(String));
    expect(refreshResponse.status).toBe(200);
    expect(refreshResponse.body.session.id).toBe(passwordResponse.body.session.id);
    expect(pinResponse.status).toBe(200);
    expect(pinResponse.body.staff).toMatchObject({ id: "staff-2", role: "cashier" });
    expect(sessionsResponse.body.sessions).toEqual(expect.arrayContaining([expect.objectContaining({ id: passwordResponse.body.session.id })]));
    expect(bearerSessionsResponse.status).toBe(200);
    expect(bearerSessionsResponse.body.sessions).toEqual(expect.arrayContaining([expect.objectContaining({ id: passwordResponse.body.session.id })]));
    expect(revokeResponse.body.session).toMatchObject({ id: passwordResponse.body.session.id, revokedAt: expect.any(String) });
    expect(logoutResponse.status).toBe(200);
    expect(logoutResponse.body.session).toMatchObject({ id: logoutLoginResponse.body.session.id, revokedAt: expect.any(String) });
    expect(invalidResponse.status).toBe(401);
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
      .patch("/api/v1/staff/staff-2/status")
      .set("authorization", `Bearer ${loginResponse.body.accessToken}`)
      .set("x-branch-id", "branch-abuja-main")
      .send({ active: false, reason: "Wrong selected branch attempt" });

    expect(response.status).toBe(404);
    expect(response.body.error).toBe("Staff member not found");
  });

  it("blocks cashiers from staff management", async () => {
    const response = await request(app)
      .patch("/api/v1/staff/staff-2/status")
      .set("x-tenant-id", "tenant-lagos-foods")
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
      .set("x-role", "manager")
      .set("x-user-id", "staff-1")
      .send({ decision: "approved", note: "Approved for VIP customer" });

    expect(decisionResponse.status).toBe(200);
    expect(decisionResponse.body.approval).toMatchObject({ status: "approved", decidedBy: "staff-1" });
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
      .set("x-role", "manager")
      .set("x-user-id", "staff-1")
      .send({ decision: "approved", note: "Approved for retention" });

    const applyResponse = await request(app)
      .post(`/api/v1/approvals/${requestResponse.body.approval.id}/apply`)
      .set("x-tenant-id", "tenant-lagos-foods")
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
      .set("x-role", "manager")
      .set("x-user-id", "staff-1")
      .send({ decision: "approved", note: "Customer has available limit" });

    const applyResponse = await request(app)
      .post(`/api/v1/approvals/${requestResponse.body.approval.id}/apply`)
      .set("x-tenant-id", "tenant-lagos-foods")
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
      .set("x-role", "manager")
      .set("x-user-id", "staff-1")
      .send({ decision: "approved", note: "Approved amount only" });

    const applyResponse = await request(app)
      .post(`/api/v1/approvals/${requestResponse.body.approval.id}/apply`)
      .set("x-tenant-id", "tenant-lagos-foods")
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
      .set("x-role", "manager")
      .set("x-user-id", "staff-1")
      .send({ decision: "approved", note: "Approved cancellation" });

    const applyResponse = await request(app)
      .post(`/api/v1/approvals/${requestResponse.body.approval.id}/apply`)
      .set("x-tenant-id", "tenant-lagos-foods")
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
      .set("x-role", "manager")
      .set("x-user-id", "staff-1")
      .send({ decision: "approved", note: "Approved supplier payout" });

    const applyResponse = await request(app)
      .post(`/api/v1/approvals/${requestResponse.body.approval.id}/apply`)
      .set("x-tenant-id", "tenant-lagos-foods")
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
      .set("x-role", "manager")
      .set("x-user-id", "staff-1")
      .send({ decision: "approved", note: "Variance accepted" });

    const applyResponse = await request(app)
      .post(`/api/v1/approvals/${requestResponse.body.approval.id}/apply`)
      .set("x-tenant-id", "tenant-lagos-foods")
      .set("x-role", "cashier")
      .set("x-user-id", "cashier-1")
      .send({
        entityType: "registerShift",
        entityId: "shift-1",
        type: "register_close",
        amount: 5000,
        note: "Applied before drawer close"
      });

    expect(applyResponse.status).toBe(200);
    expect(applyResponse.body.approval).toMatchObject({ type: "register_close", status: "applied" });
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
      .set("x-role", "manager")
      .set("x-user-id", "staff-1")
      .send({ decision: "approved", note: "Waste reviewed" });

    const applyResponse = await request(app)
      .post(`/api/v1/approvals/${requestResponse.body.approval.id}/apply`)
      .set("x-tenant-id", "tenant-lagos-foods")
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
      .set("x-role", "manager")
      .set("x-user-id", "staff-1")
      .send({ decision: "approved", note: "Count reviewed" });

    const applyResponse = await request(app)
      .post(`/api/v1/approvals/${requestResponse.body.approval.id}/apply`)
      .set("x-tenant-id", "tenant-lagos-foods")
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
      .set("x-role", "manager")
      .set("x-user-id", "staff-1")
      .send({ decision: "approved", note: "Refund reviewed" });

    const refundApply = await request(app)
      .post(`/api/v1/approvals/${refundRequest.body.approval.id}/apply`)
      .set("x-tenant-id", "tenant-lagos-foods")
      .set("x-role", "cashier")
      .set("x-user-id", "cashier-1")
      .send({
        entityType: "sale",
        entityId: "INV-00001",
        type: "refund",
        amount: 1500,
        note: "Applied receipt refund"
      });

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
      .set("x-role", "manager")
      .set("x-user-id", "staff-1")
      .send({ decision: "approved", note: "Void reviewed" });

    const voidApply = await request(app)
      .post(`/api/v1/approvals/${voidRequest.body.approval.id}/apply`)
      .set("x-tenant-id", "tenant-lagos-foods")
      .set("x-role", "cashier")
      .set("x-user-id", "cashier-1")
      .send({
        entityType: "sale",
        entityId: "INV-00002",
        type: "void",
        amount: 18000,
        note: "Applied receipt void"
      });

    expect(voidApply.status).toBe(200);
    expect(voidApply.body.approval).toMatchObject({ type: "void", status: "applied" });
  });

  it("returns the current register shift for a terminal", async () => {
    const response = await request(app)
      .get("/api/v1/registers/current?branchId=branch-lagos-main&terminalId=terminal-web-1")
      .set("x-tenant-id", "tenant-lagos-foods")
      .set("x-branch-id", "branch-lagos-main")
      .set("x-role", "cashier")
      .set("x-user-id", "cashier-1");

    expect(response.status).toBe(200);
    expect(response.body.shift).toMatchObject({ id: "shift-1", status: "open" });
  });

  it("records cash sales against the open register shift", async () => {
    const response = await request(app)
      .post("/api/v1/sales")
      .set("x-tenant-id", "tenant-lagos-foods")
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
      .set("x-role", "manager")
      .set("x-user-id", "manager-1");

    expect(shiftResponse.body.shift.expectedCash).toBeGreaterThan(50000);
    expect(shiftResponse.body.payments[0]).toMatchObject({ method: "cash", amount: 9563 });
  });

  it("rejects sales when an open-shift terminal is no longer online", async () => {
    const terminalResponse = await request(app)
      .post("/api/v1/branches/terminals")
      .set("x-tenant-id", "tenant-lagos-foods")
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
      .set("x-role", "manager")
      .set("x-user-id", "staff-1")
      .send({
        branchId: "branch-lagos-main",
        terminalId: terminalResponse.body.terminal.id,
        openingBalance: 10000
      });
    const offlineResponse = await request(app)
      .patch(`/api/v1/branches/terminals/${terminalResponse.body.terminal.id}`)
      .set("x-tenant-id", "tenant-lagos-foods")
      .set("x-role", "manager")
      .set("x-user-id", "manager-1")
      .send({ status: "offline" });
    const saleResponse = await request(app)
      .post("/api/v1/sales")
      .set("x-tenant-id", "tenant-lagos-foods")
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
      .set("x-role", "manager")
      .set("x-user-id", "staff-1")
      .send({
        branchId: "branch-lagos-main",
        terminalId: "terminal-web-2",
        openingBalance: 10000
      });
    const wrongBranchResponse = await request(app)
      .post("/api/v1/registers/open")
      .set("x-tenant-id", "tenant-lagos-foods")
      .set("x-role", "manager")
      .set("x-user-id", "staff-1")
      .send({
        branchId: "branch-lagos-ikeja",
        terminalId: "terminal-web-1",
        openingBalance: 10000
      });
    const missingTerminalResponse = await request(app)
      .post("/api/v1/registers/open")
      .set("x-tenant-id", "tenant-lagos-foods")
      .set("x-role", "manager")
      .set("x-user-id", "staff-1")
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

  it("allows managers to close open register shifts", async () => {
    const terminalResponse = await request(app)
      .post("/api/v1/branches/terminals")
      .set("x-tenant-id", "tenant-lagos-foods")
      .set("x-role", "manager")
      .set("x-user-id", "manager-1")
      .send({
        branchId: "branch-lagos-main",
        name: "Close Test POS",
        deviceCode: "LAG-CLOSE-TEST-01",
        status: "online",
        appVersion: "1.0.1"
      });
    const openResponse = await request(app)
      .post("/api/v1/registers/open")
      .set("x-tenant-id", "tenant-lagos-foods")
      .set("x-role", "manager")
      .set("x-user-id", "staff-1")
      .send({
        branchId: "branch-lagos-main",
        terminalId: terminalResponse.body.terminal.id,
        openingBalance: 10000
      });

    const closeResponse = await request(app)
      .post("/api/v1/registers/close")
      .set("x-tenant-id", "tenant-lagos-foods")
      .set("x-role", "manager")
      .set("x-user-id", "staff-1")
      .send({
        shiftId: openResponse.body.shift.id,
        countedCash: 9800,
        managerNote: "Short by 200"
      });

    expect(terminalResponse.status).toBe(201);
    expect(openResponse.status).toBe(201);
    expect(closeResponse.status).toBe(200);
    expect(closeResponse.body.shift).toMatchObject({ status: "closed", variance: -200 });
  });

  it("requires register drawer actions to use the shift branch", async () => {
    const terminalResponse = await request(app)
      .post("/api/v1/branches/terminals")
      .set("x-tenant-id", "tenant-lagos-foods")
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
      .set("x-role", "manager")
      .set("x-user-id", "staff-1")
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
      .set("x-user-id", "staff-1")
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
      .set("x-user-id", "staff-1")
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
      .set("x-role", "accountant")
      .set("x-user-id", "accountant-1")
      .send({ status: "paid", note: "Manager approved and paid" });
    const listResponse = await request(app)
      .get("/api/v1/expenses?branchId=branch-lagos-main&status=all")
      .set("x-tenant-id", "tenant-lagos-foods")
      .set("x-role", "accountant")
      .set("x-user-id", "accountant-1");
    const reportResponse = await request(app)
      .get("/api/v1/reports/dashboard?branchId=branch-lagos-main&period=all")
      .set("x-tenant-id", "tenant-lagos-foods")
      .set("x-branch-id", "branch-lagos-main")
      .set("x-role", "owner")
      .set("x-user-id", "owner-1");

    expect(expenseResponse.status).toBe(201);
    expect(expenseResponse.body.expense).toMatchObject({ status: "pending_approval", amount: 76000 });
    expect(approvalResponse.status).toBe(201);
    expect(approvalResponse.body.approval).toMatchObject({ type: "expense", entityType: "expense" });
    expect(statusResponse.status).toBe(200);
    expect(statusResponse.body.expense).toMatchObject({ status: "paid", paidAt: expect.any(String) });
    expect(listResponse.body.expenses).toEqual(expect.arrayContaining([expect.objectContaining({ id: expenseResponse.body.expense.id })]));
    expect(reportResponse.body.summary.expenseTotal).toBeGreaterThanOrEqual(76000);
    expect(reportResponse.body.summary.netProfit).toBe(reportResponse.body.summary.grossProfit - reportResponse.body.summary.expenseTotal);
  });

  it("rejects expenses for branches outside the tenant", async () => {
    const response = await request(app)
      .post("/api/v1/expenses")
      .set("x-tenant-id", "tenant-lagos-foods")
      .set("x-branch-id", "branch-lagos-main")
      .set("x-role", "accountant")
      .set("x-user-id", "accountant-1")
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
      .set("x-user-id", "owner-1");
    const salesResponse = await request(app)
      .get("/api/v1/sales?branchId=branch-lagos-main&status=all")
      .set("x-tenant-id", "tenant-lagos-foods")
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
      .set("x-role", "cashier")
      .set("x-user-id", "cashier-1")
      .send({ channel: "print" });
    const whatsappResponse = await request(app)
      .post(`/api/v1/sales/${response.body.saleId}/receipt-actions`)
      .set("x-tenant-id", "tenant-lagos-foods")
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
      .set("x-user-id", "owner-1");
    const receiptActions = receiptAuditResponse.body.events
      .filter((event: { entityId: string; action: string }) => event.entityId === response.body.saleId && event.action.startsWith("receipt."))
      .map((event: { action: string }) => event.action);

    expect(receiptActions).toEqual(expect.arrayContaining(["receipt.print_queued", "receipt.whatsapp_queued"]));

    const dashboardResponse = await request(app)
      .get("/api/v1/reports/dashboard?branchId=branch-lagos-main")
      .set("x-tenant-id", "tenant-lagos-foods")
      .set("x-branch-id", "branch-lagos-main")
      .set("x-role", "owner")
      .set("x-user-id", "owner-1");
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

  it("rejects sales using tenant-disabled payment methods", async () => {
    const response = await request(app)
      .post("/api/v1/sales")
      .set("x-tenant-id", "tenant-lagos-foods")
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

  it("requires payment references and exact settlement totals", async () => {
    const missingReferenceResponse = await request(app)
      .post("/api/v1/sales")
      .set("x-tenant-id", "tenant-lagos-foods")
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

  it("attaches customers to sales and awards loyalty points", async () => {
    const beforeResponse = await request(app)
      .get("/api/v1/customers?q=amina")
      .set("x-tenant-id", "tenant-lagos-foods")
      .set("x-role", "cashier")
      .set("x-user-id", "cashier-1");
    const beforePoints = beforeResponse.body.customers[0].loyaltyPoints;

    const saleResponse = await request(app)
      .post("/api/v1/sales")
      .set("x-tenant-id", "tenant-lagos-foods")
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
      .set("x-role", "cashier")
      .set("x-user-id", "cashier-1");
    const salesResponse = await request(app)
      .get("/api/v1/sales?branchId=branch-lagos-main&status=all")
      .set("x-tenant-id", "tenant-lagos-foods")
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

  it("reverses customer balances and loyalty when credit sales are refunded or voided", async () => {
    const beforeResponse = await request(app)
      .get("/api/v1/customers?q=kola")
      .set("x-tenant-id", "tenant-lagos-foods")
      .set("x-role", "cashier")
      .set("x-user-id", "cashier-1");
    const beforeCustomer = beforeResponse.body.customers[0];

    const refundSaleResponse = await request(app)
      .post("/api/v1/sales")
      .set("x-tenant-id", "tenant-lagos-foods")
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

    const refundResponse = await request(app)
      .post(`/api/v1/sales/${refundSaleResponse.body.saleId}/refund`)
      .set("x-tenant-id", "tenant-lagos-foods")
      .set("x-role", "manager")
      .set("x-user-id", "manager-1")
      .send({ amount: 2000, reason: "Customer returned part order" });

    const afterRefundResponse = await request(app)
      .get("/api/v1/customers?q=kola")
      .set("x-tenant-id", "tenant-lagos-foods")
      .set("x-role", "cashier")
      .set("x-user-id", "cashier-1");
    const afterRefundCustomer = afterRefundResponse.body.customers[0];

    const voidSaleResponse = await request(app)
      .post("/api/v1/sales")
      .set("x-tenant-id", "tenant-lagos-foods")
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

    const voidResponse = await request(app)
      .post(`/api/v1/sales/${voidSaleResponse.body.saleId}/void`)
      .set("x-tenant-id", "tenant-lagos-foods")
      .set("x-role", "manager")
      .set("x-user-id", "manager-1")
      .send({ reason: "Customer cancelled credit order" });

    const afterVoidResponse = await request(app)
      .get("/api/v1/customers?q=kola")
      .set("x-tenant-id", "tenant-lagos-foods")
      .set("x-role", "cashier")
      .set("x-user-id", "cashier-1");
    const ledgerResponse = await request(app)
      .get("/api/v1/customers/cust-2/ledger")
      .set("x-tenant-id", "tenant-lagos-foods")
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
      .set("x-role", "cashier")
      .set("x-user-id", "cashier-1")
      .send(payload);

    const replayResponse = await request(app)
      .post("/api/v1/sales")
      .set("x-tenant-id", "tenant-lagos-foods")
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
      .set("x-role", "manager")
      .set("x-user-id", "manager-1");
    const payment = registerResponse.body.payments.find((item: { saleId: string }) => item.saleId === saleResponse.body.saleId);
    const closeWithPendingResponse = await request(app)
      .post("/api/v1/registers/close")
      .set("x-tenant-id", "tenant-lagos-foods")
      .set("x-role", "manager")
      .set("x-user-id", "manager-1")
      .send({ shiftId: registerResponse.body.shift.id, countedCash: registerResponse.body.shift.expectedCash });
    const reconcileResponse = await request(app)
      .patch(`/api/v1/registers/payments/${payment.id}/reconcile`)
      .set("x-tenant-id", "tenant-lagos-foods")
      .set("x-role", "manager")
      .set("x-user-id", "manager-1")
      .send({ note: "Processor batch CARD-001" });
    const auditResponse = await request(app)
      .get("/api/v1/audit")
      .set("x-tenant-id", "tenant-lagos-foods")
      .set("x-role", "owner")
      .set("x-user-id", "owner-1");

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

  it("allows managers to refund and void eligible sales", async () => {
    const stockBefore = await request(app)
      .get("/api/v1/inventory/stock")
      .set("x-tenant-id", "tenant-lagos-foods")
      .set("x-branch-id", "branch-lagos-main")
      .set("x-role", "manager")
      .set("x-user-id", "manager-1");
    const p1StockBefore = stockBefore.body.products.find((product: { id: string; stock: number }) => product.id === "p1").stock;
    const p3StockBefore = stockBefore.body.products.find((product: { id: string; stock: number }) => product.id === "p3").stock;

    const refundSaleResponse = await request(app)
      .post("/api/v1/sales")
      .set("x-tenant-id", "tenant-lagos-foods")
      .set("x-role", "cashier")
      .set("x-user-id", "cashier-1")
      .send({
        branchId: "branch-lagos-main",
        terminalId: "terminal-web-1",
        idempotencyKey: "terminal-web-1-0006",
        lines: [{ productId: "p3", quantity: 1, discount: 0 }],
        payments: [{ method: "cash", amount: 4725 }]
      });

    const refundResponse = await request(app)
      .post(`/api/v1/sales/${refundSaleResponse.body.saleId}/refund`)
      .set("x-tenant-id", "tenant-lagos-foods")
      .set("x-role", "manager")
      .set("x-user-id", "manager-1")
      .send({ amount: 4725, reason: "Returned item" });

    const voidSaleResponse = await request(app)
      .post("/api/v1/sales")
      .set("x-tenant-id", "tenant-lagos-foods")
      .set("x-role", "cashier")
      .set("x-user-id", "cashier-1")
      .send({
        branchId: "branch-lagos-main",
        terminalId: "terminal-web-1",
        idempotencyKey: "terminal-web-1-0007",
        lines: [{ productId: "p1", quantity: 1, discount: 0 }],
        payments: [{ method: "cash", amount: 9563 }]
      });

    const voidResponse = await request(app)
      .post(`/api/v1/sales/${voidSaleResponse.body.saleId}/void`)
      .set("x-tenant-id", "tenant-lagos-foods")
      .set("x-role", "manager")
      .set("x-user-id", "manager-1")
      .send({ reason: "Duplicate order" });
    const stockAfter = await request(app)
      .get("/api/v1/inventory/stock")
      .set("x-tenant-id", "tenant-lagos-foods")
      .set("x-branch-id", "branch-lagos-main")
      .set("x-role", "manager")
      .set("x-user-id", "manager-1");

    expect(refundResponse.status).toBe(200);
    expect(refundResponse.body.sale).toMatchObject({ status: "refunded", refundTotal: 4725 });
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
  });
});
