import { saleActionSchema, saleReceiptActionSchema, saleRefundSchema } from "@pos/validation";
import { Router } from "express";
import { resolveBranchScope, requireAuthenticatedUser, requirePermission, requireTenant, selfScopedUserId } from "../../shared/http/tenantContext";
import { createSale, listSales, queueReceiptAction, refundSale, voidSale } from "./sales.repository";
import { createSaleSchema } from "./sales.service";

export const salesRouter = Router();

salesRouter.get("/", requireTenant, requireAuthenticatedUser, async (req, res) => {
  const scope = resolveBranchScope(req.tenantContext!, req.query.branchId?.toString());
  if (scope.forbidden) {
    res.status(403).json({ error: "Branch access denied" });
    return;
  }

  const status = req.query.status?.toString();
  const sales = await listSales(req.tenantContext!.tenantId, {
    branchId: scope.branchId,
    status,
    cashierId: selfScopedUserId(req.tenantContext!)
  });

  res.json({ sales });
});

salesRouter.post("/", requireTenant, requirePermission("sale.create"), async (req, res) => {
  const parsed = createSaleSchema.safeParse(req.body);

  if (!parsed.success) {
    res.status(400).json({ error: "Invalid sale payload", issues: parsed.error.flatten() });
    return;
  }

  const scope = resolveBranchScope(req.tenantContext!, parsed.data.branchId);
  if (scope.forbidden) {
    res.status(403).json({ error: "Branch access denied" });
    return;
  }

  try {
    const result = await createSale(req.tenantContext!.tenantId, req.tenantContext!.userId, parsed.data);

    if (result.status === "no_open_shift") {
      res.status(409).json({ error: "No open register shift for this terminal" });
      return;
    }

    if (result.status === "branch_not_found") {
      res.status(404).json({ error: "Branch not found" });
      return;
    }

    if (result.status === "branch_not_active") {
      res.status(409).json({ error: "Sales can only be posted from an active branch" });
      return;
    }

    if (result.status === "terminal_not_found") {
      res.status(404).json({ error: "Terminal not found" });
      return;
    }

    if (result.status === "terminal_branch_mismatch") {
      res.status(409).json({ error: "Terminal does not belong to this branch" });
      return;
    }

    if (result.status === "terminal_not_online") {
      res.status(409).json({ error: "Sales can only be posted from an online terminal" });
      return;
    }

    if (result.status === "tenant_not_found") {
      res.status(404).json({ error: "Tenant not found" });
      return;
    }

    if (result.status === "payment_disabled") {
      res.status(409).json({ error: `${result.method.replace("_", " ")} payments are disabled for this tenant` });
      return;
    }

    if (result.status === "payment_total_mismatch") {
      res.status(409).json({ error: "Payment total must match sale total", total: result.total, paid: result.paid });
      return;
    }

    if (result.status === "customer_not_found") {
      res.status(404).json({ error: "Customer not found" });
      return;
    }

    if (result.status === "credit_requires_customer") {
      res.status(409).json({ error: "Customer credit requires an attached customer" });
      return;
    }

    if (result.status === "credit_limit_exceeded") {
      res.status(409).json({ error: "Customer credit limit exceeded" });
      return;
    }

    if (result.status === "stock_not_found") {
      res.status(404).json({ error: `Product ${result.productId} stock record not found` });
      return;
    }

    if (result.status === "insufficient_stock") {
      res.status(409).json({ error: `${result.productName} has insufficient stock` });
      return;
    }

    res.status(result.status === "replayed" ? 200 : 201).json(result.response);
  } catch (error) {
    res.status(422).json({ error: error instanceof Error ? error.message : "Unable to create sale" });
  }
});

salesRouter.post("/:saleId/receipt-actions", requireTenant, requirePermission("sale.create"), async (req, res) => {
  const parsed = saleReceiptActionSchema.safeParse(req.body);

  if (!parsed.success) {
    res.status(400).json({ error: "Invalid receipt action", issues: parsed.error.flatten() });
    return;
  }

  const result = await queueReceiptAction(
    req.tenantContext!.tenantId,
    req.tenantContext!.branchId,
    req.tenantContext!.userId,
    req.params.saleId.toString(),
    parsed.data.channel
  );

  if (result.status === "sale_not_found") {
    res.status(404).json({ error: "Sale not found" });
    return;
  }

  if (result.status === "print_disabled") {
    res.status(409).json({ error: "Receipt printer was not enabled for this sale" });
    return;
  }

  if (result.status === "whatsapp_disabled") {
    res.status(409).json({ error: "WhatsApp receipt was not enabled for this sale" });
    return;
  }

  res.json({ delivery: result.delivery });
});

salesRouter.post("/:saleId/void", requireTenant, requirePermission("sale.void"), async (req, res) => {
  const parsed = saleActionSchema.safeParse(req.body);

  if (!parsed.success) {
    res.status(400).json({ error: "Invalid void request", issues: parsed.error.flatten() });
    return;
  }

  const result = await voidSale(
    req.tenantContext!.tenantId,
    req.tenantContext!.branchId,
    req.tenantContext!.userId,
    req.params.saleId.toString(),
    parsed.data.reason
  );

  if (result.status === "sale_not_found") {
    res.status(404).json({ error: "Sale not found" });
    return;
  }

  if (result.status === "not_completed") {
    res.status(409).json({ error: "Only completed sales can be voided" });
    return;
  }

  res.json({ sale: result.sale });
});

salesRouter.post("/:saleId/refund", requireTenant, requirePermission("sale.refund"), async (req, res) => {
  const parsed = saleRefundSchema.safeParse(req.body);

  if (!parsed.success) {
    res.status(400).json({ error: "Invalid refund request", issues: parsed.error.flatten() });
    return;
  }

  const result = await refundSale(
    req.tenantContext!.tenantId,
    req.tenantContext!.branchId,
    req.tenantContext!.userId,
    req.params.saleId.toString(),
    parsed.data.amount,
    parsed.data.reason
  );

  if (result.status === "sale_not_found") {
    res.status(404).json({ error: "Sale not found" });
    return;
  }

  if (result.status === "cannot_refund") {
    res.status(409).json({ error: "Sale cannot receive another refund" });
    return;
  }

  if (result.status === "refund_exceeds_total") {
    res.status(409).json({ error: "Refund exceeds sale total" });
    return;
  }

  res.json({ sale: result.sale });
});
