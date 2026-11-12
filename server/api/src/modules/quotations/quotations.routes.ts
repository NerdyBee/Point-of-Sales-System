import { quotationInputSchema, quotationStatusSchema } from "@pos/validation";
import { Router, type Request } from "express";
import { canAccessAllBranches, canAccessScopedBranches, requirePermission, requireTenant, resolveBranchScope } from "../../shared/http/tenantContext";
import { createQuotation, getQuotation, listQuotations, setQuotationStatus } from "./quotations.repository";

/**
 * Quotations and proforma invoices.
 *   GET   /api/v1/quotations[?branchId&status&search]
 *   GET   /api/v1/quotations/:id
 *   POST  /api/v1/quotations
 *   POST  /api/v1/quotations/:id/status   { status: accepted | cancelled | converted, saleId? }
 */
export const quotationsRouter = Router();

function branchIds(req: Request, requested?: string) {
  const scope = resolveBranchScope(req.tenantContext!, requested || undefined);
  if (scope.forbidden) return { forbidden: true as const };
  if (scope.branchId) return { branchIds: [scope.branchId] };
  if (canAccessAllBranches(req.tenantContext!)) return { branchIds: undefined };
  if (canAccessScopedBranches(req.tenantContext!) && scope.branchScopeIds?.length) return { branchIds: scope.branchScopeIds };
  return req.tenantContext!.branchId ? { branchIds: [req.tenantContext!.branchId] } : { forbidden: true as const };
}

quotationsRouter.get("/", requireTenant, requirePermission("sale.create"), async (req, res) => {
  const scope = branchIds(req, req.query.branchId?.toString());
  if ("forbidden" in scope) {
    res.status(403).json({ error: "Branch access denied" });
    return;
  }
  const quotations = await listQuotations(req.tenantContext!.tenantId, { branchIds: scope.branchIds, status: req.query.status?.toString() || undefined, search: req.query.search?.toString() });
  res.json({ quotations });
});

quotationsRouter.get("/:id", requireTenant, requirePermission("sale.create"), async (req, res) => {
  const quotation = await getQuotation(req.tenantContext!.tenantId, req.params.id.toString());
  const scope = branchIds(req);
  if (!quotation || "forbidden" in scope || (scope.branchIds && !scope.branchIds.includes(quotation.branchId))) {
    res.status(404).json({ error: "Quotation not found" });
    return;
  }
  res.json({ quotation });
});

quotationsRouter.post("/", requireTenant, requirePermission("sale.create"), async (req, res) => {
  const parsed = quotationInputSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Check the quotation: customer name, valid-until date and at least one item are needed", issues: parsed.error.flatten() });
    return;
  }
  const scope = branchIds(req, parsed.data.branchId);
  if ("forbidden" in scope || (scope.branchIds && !scope.branchIds.includes(parsed.data.branchId))) {
    res.status(403).json({ error: "Branch access denied" });
    return;
  }
  // A discounted price on paper is a promise: only staff who may give discounts can quote one.
  if (parsed.data.lines.some((line) => (line.discount ?? 0) > 0) && !req.tenantContext!.permissions.includes("sale.discount")) {
    res.status(403).json({ error: "Your role cannot give discounts, so it cannot quote discounted prices" });
    return;
  }
  const result = await createQuotation(req.tenantContext!.tenantId, req.tenantContext!.userId, parsed.data);
  if (result.status === "invalid_product") {
    res.status(400).json({ error: result.message });
    return;
  }
  res.status(201).json({ quotation: result.quotation });
});

quotationsRouter.post("/:id/status", requireTenant, requirePermission("sale.create"), async (req, res) => {
  const parsed = quotationStatusSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "status must be accepted, cancelled or converted" });
    return;
  }
  const scope = branchIds(req);
  if ("forbidden" in scope) {
    res.status(403).json({ error: "Branch access denied" });
    return;
  }
  const result = await setQuotationStatus(req.tenantContext!.tenantId, req.tenantContext!.userId, req.params.id.toString(), parsed.data.status, parsed.data.saleId, scope.branchIds);
  if (result.status === "not_found") {
    res.status(404).json({ error: "Quotation not found" });
    return;
  }
  if (result.status === "not_allowed") {
    res.status(409).json({ error: `This quotation is already ${result.from}` });
    return;
  }
  res.json({ quotation: result.quotation });
});
