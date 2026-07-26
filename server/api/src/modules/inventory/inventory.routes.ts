import { stockAdjustmentSchema, stockCountSchema, supplierInputSchema, supplierReceiptSchema } from "@pos/validation";
import { Router } from "express";
import { resolveBranchScope, requireAuthenticatedUser, requirePermission, requireTenant } from "../../shared/http/tenantContext";
import {
  appendInventoryAudit,
  applyInventoryAdjustment,
  createInventorySupplier,
  listInventoryStock,
  listInventorySuppliers,
  postInventoryCount,
  receiveSupplierPurchase
} from "./inventory.repository";

export const inventoryRouter = Router();

inventoryRouter.get("/stock", requireTenant, requireAuthenticatedUser, async (req, res) => {
  const scope = resolveBranchScope(req.tenantContext!, req.query.branchId?.toString());
  if (scope.forbidden) {
    res.status(403).json({ error: "Branch access denied" });
    return;
  }

  const { products, movements } = await listInventoryStock(req.tenantContext!.tenantId, scope.branchId);

  res.json({ products, movements });
});

inventoryRouter.get("/suppliers", requireTenant, requireAuthenticatedUser, async (req, res) => {
  const scope = resolveBranchScope(req.tenantContext!, req.query.branchId?.toString());
  if (scope.forbidden) {
    res.status(403).json({ error: "Branch access denied" });
    return;
  }

  const tenantSuppliers = await listInventorySuppliers(req.tenantContext!.tenantId, scope.branchId);

  res.json({ suppliers: tenantSuppliers });
});

inventoryRouter.post("/suppliers", requireTenant, requirePermission("inventory.adjust"), async (req, res) => {
  const parsed = supplierInputSchema.safeParse(req.body);

  if (!parsed.success) {
    res.status(400).json({ error: "Invalid supplier payload", issues: parsed.error.flatten() });
    return;
  }

  const result = await createInventorySupplier(req.tenantContext!.tenantId, parsed.data);

  if (result.status === "branch_not_found") {
    res.status(404).json({ error: "Inventory branch not found for this tenant" });
    return;
  }

  if (result.status === "missing_products") {
    res.status(404).json({ error: "Supplier product coverage includes unknown products" });
    return;
  }

  await appendInventoryAudit({
    tenantId: req.tenantContext!.tenantId,
    branchId: result.supplier.branchId,
    userId: req.tenantContext!.userId,
    action: "supplier.created",
    entityType: "supplier",
    entityId: result.supplier.id,
    metadata: { name: result.supplier.name, productCount: result.supplier.productIds.length }
  });

  res.status(201).json({ supplier: result.supplier });
});

inventoryRouter.post("/purchase-receipts", requireTenant, requirePermission("inventory.adjust"), async (req, res) => {
  const parsed = supplierReceiptSchema.safeParse(req.body);

  if (!parsed.success) {
    res.status(400).json({ error: "Invalid purchase receipt", issues: parsed.error.flatten() });
    return;
  }

  const result = await receiveSupplierPurchase(req.tenantContext!.tenantId, req.tenantContext!.userId, parsed.data);

  if (result.status === "branch_not_found") {
    res.status(404).json({ error: "Inventory branch not found for this tenant" });
    return;
  }

  if (result.status === "supplier_not_found") {
    res.status(404).json({ error: "Active supplier not found" });
    return;
  }

  if (result.status === "supplier_product_mismatch") {
    res.status(409).json({ error: "Supplier is not linked to this product" });
    return;
  }

  if (result.status === "product_not_found") {
    res.status(404).json({ error: "Product stock record not found" });
    return;
  }

  await appendInventoryAudit({
    tenantId: req.tenantContext!.tenantId,
    branchId: parsed.data.branchId,
    userId: req.tenantContext!.userId,
    action: "inventory.purchase_received",
    entityType: "stockMovement",
    entityId: result.movement.id,
    metadata: { supplierId: result.supplier.id, productId: result.product.id, quantity: parsed.data.quantity, reference: parsed.data.reference }
  });

  res.status(201).json({ product: result.product, movement: result.movement, supplier: result.supplier });
});

inventoryRouter.post("/adjustments", requireTenant, requirePermission("inventory.adjust"), async (req, res) => {
  const parsed = stockAdjustmentSchema.safeParse(req.body);

  if (!parsed.success) {
    res.status(400).json({ error: "Invalid stock adjustment", issues: parsed.error.flatten() });
    return;
  }

  const result = await applyInventoryAdjustment(req.tenantContext!.tenantId, req.tenantContext!.userId, parsed.data);

  if (result.status === "branch_not_found") {
    res.status(404).json({ error: "Inventory branch not found for this tenant" });
    return;
  }

  if (result.status === "product_not_found") {
    res.status(404).json({ error: "Product stock record not found" });
    return;
  }

  if (result.status === "negative_stock") {
    res.status(409).json({ error: "Stock adjustment would create negative stock" });
    return;
  }

  await appendInventoryAudit({
    tenantId: req.tenantContext!.tenantId,
    branchId: parsed.data.branchId,
    userId: req.tenantContext!.userId,
    action: "inventory.adjust",
    entityType: "stockMovement",
    entityId: result.movement.id,
    metadata: {
      productId: result.product.id,
      quantityDelta: parsed.data.quantityDelta,
      balanceAfter: result.product.stock,
      reason: parsed.data.reason
    }
  });

  res.status(201).json({ product: result.product, movement: result.movement });
});

inventoryRouter.post("/counts", requireTenant, requirePermission("inventory.adjust"), async (req, res) => {
  const parsed = stockCountSchema.safeParse(req.body);

  if (!parsed.success) {
    res.status(400).json({ error: "Invalid stock count", issues: parsed.error.flatten() });
    return;
  }

  const result = await postInventoryCount(req.tenantContext!.tenantId, req.tenantContext!.userId, parsed.data);

  if (result.status === "branch_not_found") {
    res.status(404).json({ error: "Inventory branch not found for this tenant" });
    return;
  }

  if (result.status === "product_not_found") {
    res.status(404).json({ error: `Product ${result.productId} stock record not found` });
    return;
  }

  await appendInventoryAudit({
    tenantId: req.tenantContext!.tenantId,
    branchId: parsed.data.branchId,
    userId: req.tenantContext!.userId,
    action: "inventory.count_posted",
    entityType: "stockCount",
    entityId: parsed.data.reference,
    metadata: {
      countedItems: parsed.data.counts.length,
      varianceItems: result.movements.length,
      reference: parsed.data.reference
    }
  });

  res.status(201).json({ products: result.products, movements: result.movements });
});
