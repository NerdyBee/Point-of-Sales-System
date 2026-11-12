import { Router, type Request } from "express";
import { canAccessAllBranches, canAccessScopedBranches, requireAnyPermission, requireTenant, resolveBranchScope } from "../../shared/http/tenantContext";
import { creditorsAgeing, customerStatement, debtorsAgeing } from "./accounts.repository";

/**
 * GET /api/v1/accounts/debtors                         what customers owe, by age
 * GET /api/v1/accounts/creditors[?branchId=]           what is owed to suppliers, by how overdue
 * GET /api/v1/accounts/customers/:id/statement?from&to  a customer's statement of account
 */
export const accountsRouter = Router();

function parseDay(value: unknown, endOfDay: boolean) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const [year, month, day] = value.split("-").map(Number);
  return endOfDay ? new Date(year, month - 1, day, 23, 59, 59, 999) : new Date(year, month - 1, day);
}

function branchIds(req: Request) {
  const scope = resolveBranchScope(req.tenantContext!, req.query.branchId?.toString() || undefined);
  if (scope.forbidden) return { forbidden: true as const };
  if (scope.branchId) return { branchIds: [scope.branchId] };
  if (canAccessAllBranches(req.tenantContext!)) return { branchIds: undefined };
  if (canAccessScopedBranches(req.tenantContext!) && scope.branchScopeIds?.length) return { branchIds: scope.branchScopeIds };
  return req.tenantContext!.branchId ? { branchIds: [req.tenantContext!.branchId] } : { forbidden: true as const };
}

accountsRouter.get("/debtors", requireTenant, requireAnyPermission(["reports.profit.view", "customer.manage"]), async (req, res) => {
  const rows = await debtorsAgeing(req.tenantContext!.tenantId);
  res.json({ asOf: new Date().toISOString(), rows });
});

accountsRouter.get("/creditors", requireTenant, requireAnyPermission(["reports.profit.view", "inventory.adjust"]), async (req, res) => {
  const scope = branchIds(req);
  if ("forbidden" in scope) {
    res.status(403).json({ error: "Branch access denied" });
    return;
  }
  const rows = await creditorsAgeing(req.tenantContext!.tenantId, scope.branchIds);
  res.json({ asOf: new Date().toISOString(), rows });
});

accountsRouter.get("/customers/:customerId/statement", requireTenant, requireAnyPermission(["customer.manage", "reports.profit.view"]), async (req, res) => {
  const from = parseDay(req.query.from, false);
  const to = parseDay(req.query.to, true);
  if (!from || !to || to < from) {
    res.status(400).json({ error: "Choose a start and end date (YYYY-MM-DD), with the end on or after the start" });
    return;
  }
  const result = await customerStatement(req.tenantContext!.tenantId, req.params.customerId.toString(), from, to);
  if (!result) {
    res.status(404).json({ error: "Customer not found" });
    return;
  }
  res.json({ from: req.query.from, to: req.query.to, ...result });
});
