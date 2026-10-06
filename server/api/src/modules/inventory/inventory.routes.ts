import { purchaseOrderInputSchema, purchaseOrderStatusSchema, stockAdjustmentSchema, stockCountSchema, stockTransferInputSchema, supplierInputSchema, supplierInvoiceInputSchema, supplierInvoicePaymentSchema, supplierReceiptSchema, supplierReturnInputSchema } from "@pos/validation";
import { Router, type Request, type Response } from "express";
import { canAccessAllBranches, canAccessScopedBranches, resolveBranchScope, requirePermission, requireTenant } from "../../shared/http/tenantContext";
import {
  appendInventoryAudit,
  applyInventoryAdjustment,
  createInventorySupplier,
  createInventoryTransfer,
  createPurchaseOrder,
  createSupplierInvoice,
  createSupplierReturn,
  getSupplierStatement,
  listInventoryTransfers,
  listInventoryStock,
  listInventorySuppliers,
  listPurchaseOrders,
  listSupplierInvoices,
  listSupplierReturns,
  postInventoryCount,
  recordSupplierInvoicePayment,
  receiveSupplierPurchase,
  updatePurchaseOrderStatus
} from "./inventory.repository";

export const inventoryRouter = Router();

function requestedBranch(req: Request) {
  const requested = req.query.branchId?.toString() ?? req.header("x-branch-id");
  if (requested) return requested;

  if (!canAccessAllBranches(req.tenantContext!) && !canAccessScopedBranches(req.tenantContext!) && req.tenantContext!.branchId) {
    return req.tenantContext!.branchId;
  }

  return undefined;
}

function effectiveBranchScope(req: Request) {
  const branchId = requestedBranch(req);
  const scope = resolveBranchScope(req.tenantContext!, branchId);
  if (!branchId && scope.branchScopeIds?.length) {
    return { ...scope, branchId: undefined, branchIds: scope.branchScopeIds };
  }

  return { ...scope, branchIds: undefined };
}

function resolveInventoryBranch(req: Request, res: Response) {
  const scope = resolveBranchScope(req.tenantContext!, requestedBranch(req));
  if (scope.forbidden || (!canAccessAllBranches(req.tenantContext!) && !canAccessScopedBranches(req.tenantContext!) && !req.tenantContext!.branchId)) {
    res.status(403).json({ error: "Branch access denied" });
    return null;
  }

  return scope;
}

inventoryRouter.get("/stock", requireTenant, requirePermission("inventory.adjust"), async (req, res) => {
  const scope = effectiveBranchScope(req);
  if (scope.forbidden) {
    res.status(403).json({ error: "Branch access denied" });
    return;
  }

  const { products, movements } = await listInventoryStock(req.tenantContext!.tenantId, {
    branchId: scope.branchId,
    branchIds: scope.branchIds
  });

  res.json({ products, movements });
});

inventoryRouter.get("/transfers", requireTenant, requirePermission("inventory.adjust"), async (req, res) => {
  const scope = effectiveBranchScope(req);
  if (scope.forbidden) {
    res.status(403).json({ error: "Branch access denied" });
    return;
  }

  const transfers = await listInventoryTransfers(req.tenantContext!.tenantId, { branchId: scope.branchId, branchIds: scope.branchIds });
  res.json({ transfers });
});

inventoryRouter.get("/suppliers", requireTenant, requirePermission("inventory.adjust"), async (req, res) => {
  const scope = effectiveBranchScope(req);
  if (scope.forbidden) {
    res.status(403).json({ error: "Branch access denied" });
    return;
  }

  const tenantSuppliers = await listInventorySuppliers(req.tenantContext!.tenantId, { branchId: scope.branchId, branchIds: scope.branchIds });

  res.json({ suppliers: tenantSuppliers });
});

inventoryRouter.get("/suppliers/:supplierId/statement", requireTenant, requirePermission("inventory.adjust"), async (req, res) => {
  const scope = effectiveBranchScope(req);
  if (scope.forbidden) {
    res.status(403).json({ error: "Branch access denied" });
    return;
  }

  const result = await getSupplierStatement(req.tenantContext!.tenantId, { branchId: scope.branchId, branchIds: scope.branchIds }, String(req.params.supplierId));
  if (result.status === "supplier_not_found") {
    res.status(404).json({ error: "Supplier not found" });
    return;
  }

  res.json({ statement: result.statement });
});

inventoryRouter.get("/purchase-orders", requireTenant, requirePermission("inventory.adjust"), async (req, res) => {
  const scope = effectiveBranchScope(req);
  if (scope.forbidden) {
    res.status(403).json({ error: "Branch access denied" });
    return;
  }

  const orders = await listPurchaseOrders(req.tenantContext!.tenantId, {
    branchId: scope.branchId,
    branchIds: scope.branchIds,
    status: req.query.status?.toString()
  });

  res.json({ purchaseOrders: orders });
});

inventoryRouter.get("/supplier-invoices", requireTenant, requirePermission("inventory.adjust"), async (req, res) => {
  const scope = effectiveBranchScope(req);
  if (scope.forbidden) {
    res.status(403).json({ error: "Branch access denied" });
    return;
  }

  const invoices = await listSupplierInvoices(req.tenantContext!.tenantId, {
    branchId: scope.branchId,
    branchIds: scope.branchIds,
    supplierId: req.query.supplierId?.toString(),
    status: req.query.status?.toString()
  });

  res.json({ supplierInvoices: invoices });
});

inventoryRouter.get("/supplier-returns", requireTenant, requirePermission("inventory.adjust"), async (req, res) => {
  const scope = effectiveBranchScope(req);
  if (scope.forbidden) {
    res.status(403).json({ error: "Branch access denied" });
    return;
  }

  const returns = await listSupplierReturns(req.tenantContext!.tenantId, {
    branchId: scope.branchId,
    branchIds: scope.branchIds,
    supplierId: req.query.supplierId?.toString()
  });

  res.json({ supplierReturns: returns });
});

inventoryRouter.post("/suppliers", requireTenant, requirePermission("inventory.adjust"), async (req, res) => {
  const parsed = supplierInputSchema.safeParse(req.body);

  if (!parsed.success) {
    res.status(400).json({ error: "Invalid supplier payload", issues: parsed.error.flatten() });
    return;
  }

  const scope = resolveBranchScope(req.tenantContext!, parsed.data.branchId);
  if (scope.forbidden) {
    res.status(403).json({ error: "Branch access denied" });
    return;
  }

  const result = await createInventorySupplier(req.tenantContext!.tenantId, {
    ...parsed.data,
    branchId: scope.branchId ?? parsed.data.branchId
  });

  if (result.status === "branch_not_found") {
    res.status(404).json({ error: "Inventory branch not found for this tenant" });
    return;
  }

  if (result.status === "missing_products") {
    res.status(404).json({ error: "Supplier product coverage includes unknown products" });
    return;
  }

  if (result.status === "non_stock_product") {
    res.status(409).json({ error: "Services cannot be linked to supplier stock coverage" });
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

inventoryRouter.post("/purchase-orders", requireTenant, requirePermission("inventory.adjust"), async (req, res) => {
  const parsed = purchaseOrderInputSchema.safeParse(req.body);

  if (!parsed.success) {
    res.status(400).json({ error: "Invalid purchase order", issues: parsed.error.flatten() });
    return;
  }

  const scope = resolveBranchScope(req.tenantContext!, parsed.data.branchId);
  if (scope.forbidden) {
    res.status(403).json({ error: "Branch access denied" });
    return;
  }

  const result = await createPurchaseOrder(req.tenantContext!.tenantId, req.tenantContext!.userId, {
    ...parsed.data,
    branchId: scope.branchId ?? parsed.data.branchId
  });

  if (result.status === "branch_not_found") {
    res.status(404).json({ error: "Inventory branch not found for this tenant" });
    return;
  }

  if (result.status === "supplier_not_found") {
    res.status(404).json({ error: "Active supplier not found" });
    return;
  }

  if (result.status === "supplier_product_mismatch") {
    res.status(409).json({ error: `Supplier is not linked to product ${result.productId}` });
    return;
  }

  if (result.status === "product_not_found") {
    res.status(404).json({ error: `Product ${result.productId} stock record not found` });
    return;
  }

  if (result.status === "non_stock_product") {
    res.status(409).json({ error: "Services cannot be added to purchase orders" });
    return;
  }

  res.status(201).json({ purchaseOrder: result.order });
});

inventoryRouter.patch("/purchase-orders/:orderId/status", requireTenant, requirePermission("inventory.adjust"), async (req, res) => {
  const parsed = purchaseOrderStatusSchema.safeParse(req.body);

  if (!parsed.success) {
    res.status(400).json({ error: "Invalid purchase order status", issues: parsed.error.flatten() });
    return;
  }

  const scope = resolveInventoryBranch(req, res);
  if (!scope) return;

  const result = await updatePurchaseOrderStatus(
    req.tenantContext!.tenantId,
    scope.branchId,
    req.tenantContext!.userId,
    String(req.params.orderId),
    parsed.data
  );

  if (result.status === "order_not_found") {
    res.status(404).json({ error: "Purchase order not found" });
    return;
  }

  if (result.status === "locked") {
    res.status(409).json({ error: "Purchase order cannot be changed in its current status" });
    return;
  }

  res.json({ purchaseOrder: result.order });
});

inventoryRouter.post("/supplier-invoices", requireTenant, requirePermission("inventory.adjust"), async (req, res) => {
  const parsed = supplierInvoiceInputSchema.safeParse(req.body);

  if (!parsed.success) {
    res.status(400).json({ error: "Invalid supplier invoice", issues: parsed.error.flatten() });
    return;
  }

  const scope = resolveBranchScope(req.tenantContext!, parsed.data.branchId);
  if (scope.forbidden) {
    res.status(403).json({ error: "Branch access denied" });
    return;
  }

  const result = await createSupplierInvoice(req.tenantContext!.tenantId, req.tenantContext!.userId, {
    ...parsed.data,
    branchId: scope.branchId ?? parsed.data.branchId
  });

  if (result.status === "branch_not_found") {
    res.status(404).json({ error: "Inventory branch not found for this tenant" });
    return;
  }

  if (result.status === "supplier_not_found") {
    res.status(404).json({ error: "Active supplier not found" });
    return;
  }

  if (result.status === "purchase_order_not_found") {
    res.status(404).json({ error: "Purchase order not found for this supplier" });
    return;
  }

  if (result.status === "duplicate_invoice") {
    res.status(409).json({ error: "Supplier invoice number already exists" });
    return;
  }

  res.status(201).json({ supplierInvoice: result.invoice });
});

inventoryRouter.post("/supplier-invoices/:invoiceId/payments", requireTenant, requirePermission("inventory.adjust"), async (req, res) => {
  const parsed = supplierInvoicePaymentSchema.safeParse(req.body);

  if (!parsed.success) {
    res.status(400).json({ error: "Invalid supplier invoice payment", issues: parsed.error.flatten() });
    return;
  }

  const scope = resolveInventoryBranch(req, res);
  if (!scope) return;

  const result = await recordSupplierInvoicePayment(req.tenantContext!.tenantId, scope.branchId, req.tenantContext!.userId, String(req.params.invoiceId), parsed.data);

  if (result.status === "invoice_not_found") {
    res.status(404).json({ error: "Supplier invoice not found" });
    return;
  }

  if (result.status === "locked") {
    res.status(409).json({ error: "Supplier invoice cannot receive payments in its current status" });
    return;
  }

  if (result.status === "overpayment") {
    res.status(409).json({ error: "Supplier payment exceeds invoice balance" });
    return;
  }

  res.status(201).json({ supplierInvoice: result.invoice, payment: result.payment });
});

inventoryRouter.post("/supplier-returns", requireTenant, requirePermission("inventory.adjust"), async (req, res) => {
  const parsed = supplierReturnInputSchema.safeParse(req.body);

  if (!parsed.success) {
    res.status(400).json({ error: "Invalid supplier return", issues: parsed.error.flatten() });
    return;
  }

  const scope = resolveBranchScope(req.tenantContext!, parsed.data.branchId);
  if (scope.forbidden) {
    res.status(403).json({ error: "Branch access denied" });
    return;
  }

  const result = await createSupplierReturn(req.tenantContext!.tenantId, req.tenantContext!.userId, {
    ...parsed.data,
    branchId: scope.branchId ?? parsed.data.branchId
  });

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
  if (result.status === "non_stock_product") {
    res.status(409).json({ error: `${result.productName} is a service and does not use supplier returns` });
    return;
  }
  if (result.status === "insufficient_stock") {
    res.status(409).json({ error: `${result.productName} has insufficient stock for supplier return` });
    return;
  }
  if (result.status === "invoice_not_found") {
    res.status(404).json({ error: "Supplier invoice not found" });
    return;
  }
  if (result.status === "credit_exceeds_balance") {
    res.status(409).json({ error: "Supplier return credit exceeds invoice balance" });
    return;
  }

  res.status(201).json({ supplierReturn: result.supplierReturn, product: result.product, movement: result.movement, supplierInvoice: result.supplierInvoice });
});

inventoryRouter.post("/purchase-receipts", requireTenant, requirePermission("inventory.adjust"), async (req, res) => {
  const parsed = supplierReceiptSchema.safeParse(req.body);

  if (!parsed.success) {
    res.status(400).json({ error: "Invalid purchase receipt", issues: parsed.error.flatten() });
    return;
  }

  const scope = resolveBranchScope(req.tenantContext!, parsed.data.branchId);
  if (scope.forbidden) {
    res.status(403).json({ error: "Branch access denied" });
    return;
  }

  const scopedReceipt = { ...parsed.data, branchId: scope.branchId ?? parsed.data.branchId };
  const result = await receiveSupplierPurchase(req.tenantContext!.tenantId, req.tenantContext!.userId, scopedReceipt);

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

  if (result.status === "non_stock_product") {
    res.status(409).json({ error: `${result.productName} is a service and does not receive stock` });
    return;
  }

  if (result.status === "purchase_order_not_found") {
    res.status(404).json({ error: "Purchase order not found" });
    return;
  }

  if (result.status === "purchase_order_not_receivable") {
    res.status(409).json({ error: "Purchase order is not approved for receiving" });
    return;
  }

  if (result.status === "purchase_order_line_not_found") {
    res.status(409).json({ error: "Purchase order does not include this product" });
    return;
  }

  if (result.status === "purchase_order_over_received") {
    res.status(409).json({ error: "Receipt quantity exceeds the purchase order balance" });
    return;
  }

  await appendInventoryAudit({
    tenantId: req.tenantContext!.tenantId,
    branchId: scopedReceipt.branchId,
    userId: req.tenantContext!.userId,
    action: "inventory.purchase_received",
    entityType: "stockMovement",
    entityId: result.movement.id,
    metadata: { supplierId: result.supplier.id, productId: result.product.id, quantity: scopedReceipt.quantity, reference: scopedReceipt.reference }
  });

  res.status(201).json({ product: result.product, movement: result.movement, supplier: result.supplier, purchaseOrder: result.purchaseOrder });
});

inventoryRouter.post("/transfers", requireTenant, requirePermission("inventory.adjust"), async (req, res) => {
  const parsed = stockTransferInputSchema.safeParse(req.body);

  if (!parsed.success) {
    res.status(400).json({ error: "Invalid stock transfer", issues: parsed.error.flatten() });
    return;
  }

  const sourceScope = resolveBranchScope(req.tenantContext!, parsed.data.sourceBranchId);
  const destinationScope = resolveBranchScope(req.tenantContext!, parsed.data.destinationBranchId);
  if (sourceScope.forbidden || destinationScope.forbidden) {
    res.status(403).json({ error: "Branch access denied" });
    return;
  }

  const result = await createInventoryTransfer(req.tenantContext!.tenantId, req.tenantContext!.userId, {
    ...parsed.data,
    sourceBranchId: sourceScope.branchId ?? parsed.data.sourceBranchId,
    destinationBranchId: destinationScope.branchId ?? parsed.data.destinationBranchId
  });

  if (result.status === "same_branch") {
    res.status(400).json({ error: "Destination branch must be different" });
    return;
  }

  if (result.status === "source_branch_not_found") {
    res.status(404).json({ error: "Source branch not found for this tenant" });
    return;
  }

  if (result.status === "destination_branch_not_found") {
    res.status(404).json({ error: "Destination branch not found for this tenant" });
    return;
  }

  if (result.status === "source_product_not_found") {
    res.status(404).json({ error: "Source product stock record not found" });
    return;
  }

  if (result.status === "destination_product_not_found") {
    res.status(404).json({ error: "Destination product stock record not found" });
    return;
  }

  if (result.status === "non_stock_product") {
    res.status(409).json({ error: `${result.productName} is a service and cannot be transferred as stock` });
    return;
  }

  if (result.status === "insufficient_stock") {
    res.status(409).json({ error: `${result.productName} has insufficient stock for transfer` });
    return;
  }

  if (result.status === "duplicate_reference") {
    res.status(409).json({ error: "Transfer reference already exists" });
    return;
  }

  res.status(201).json({
    transfer: result.transfer,
    sourceProduct: result.sourceProduct,
    destinationProduct: result.destinationProduct,
    sourceMovement: result.sourceMovement,
    destinationMovement: result.destinationMovement
  });
});

inventoryRouter.post("/adjustments", requireTenant, requirePermission("inventory.adjust"), async (req, res) => {
  const parsed = stockAdjustmentSchema.safeParse(req.body);

  if (!parsed.success) {
    res.status(400).json({ error: "Invalid stock adjustment", issues: parsed.error.flatten() });
    return;
  }

  const scope = resolveBranchScope(req.tenantContext!, parsed.data.branchId);
  if (scope.forbidden) {
    res.status(403).json({ error: "Branch access denied" });
    return;
  }

  const scopedAdjustment = { ...parsed.data, branchId: scope.branchId ?? parsed.data.branchId };
  const result = await applyInventoryAdjustment(req.tenantContext!.tenantId, req.tenantContext!.userId, scopedAdjustment);

  if (result.status === "branch_not_found") {
    res.status(404).json({ error: "Inventory branch not found for this tenant" });
    return;
  }

  if (result.status === "product_not_found") {
    res.status(404).json({ error: "Product stock record not found" });
    return;
  }

  if (result.status === "non_stock_product") {
    res.status(409).json({ error: `${result.productName} is a service and cannot be stock-adjusted` });
    return;
  }

  if (result.status === "negative_stock") {
    res.status(409).json({ error: "Stock adjustment would create negative stock" });
    return;
  }

  await appendInventoryAudit({
    tenantId: req.tenantContext!.tenantId,
    branchId: scopedAdjustment.branchId,
    userId: req.tenantContext!.userId,
    action: "inventory.adjust",
    entityType: "stockMovement",
    entityId: result.movement.id,
    metadata: {
      productId: result.product.id,
      quantityDelta: scopedAdjustment.quantityDelta,
      balanceAfter: result.product.stock,
      reason: scopedAdjustment.reason
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

  const scope = resolveBranchScope(req.tenantContext!, parsed.data.branchId);
  if (scope.forbidden) {
    res.status(403).json({ error: "Branch access denied" });
    return;
  }

  const scopedCount = { ...parsed.data, branchId: scope.branchId ?? parsed.data.branchId };
  const result = await postInventoryCount(req.tenantContext!.tenantId, req.tenantContext!.userId, scopedCount);

  if (result.status === "branch_not_found") {
    res.status(404).json({ error: "Inventory branch not found for this tenant" });
    return;
  }

  if (result.status === "product_not_found") {
    res.status(404).json({ error: `Product ${result.productId} stock record not found` });
    return;
  }

  if (result.status === "non_stock_product") {
    res.status(409).json({ error: `${result.productName} is a service and cannot be stock-counted` });
    return;
  }

  await appendInventoryAudit({
    tenantId: req.tenantContext!.tenantId,
    branchId: scopedCount.branchId,
    userId: req.tenantContext!.userId,
    action: "inventory.count_posted",
    entityType: "stockCount",
    entityId: scopedCount.reference,
    metadata: {
      countedItems: scopedCount.counts.length,
      varianceItems: result.movements.length,
      reference: scopedCount.reference
    }
  });

  res.status(201).json({ products: result.products, movements: result.movements });
});
