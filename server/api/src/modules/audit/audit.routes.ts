import { Router, type Request } from "express";
import { canAccessAllBranches, canAccessScopedBranches, resolveBranchScope, requirePermission, requireTenant } from "../../shared/http/tenantContext";
import { listAuditEvents } from "./audit.repository";

export const auditRouter = Router();

function requestedBranch(req: Request) {
  const queryBranchId = req.query.branchId?.toString();
  if (queryBranchId) return queryBranchId;
  const headerBranchId = req.header("x-branch-id");
  if (headerBranchId) return headerBranchId;
  if (canAccessAllBranches(req.tenantContext!) || canAccessScopedBranches(req.tenantContext!)) return undefined;
  return req.tenantContext!.branchId;
}

function parseAuditDate(value: string | undefined, endOfDay = false) {
  if (!value) return null;
  const date = new Date(`${value}T${endOfDay ? "23:59:59.999" : "00:00:00.000"}`);
  return Number.isNaN(date.getTime()) ? null : date;
}

auditRouter.get("/", requireTenant, requirePermission("audit.view"), async (req, res) => {
  const requestedBranchId = requestedBranch(req);
  const scope = resolveBranchScope(req.tenantContext!, requestedBranchId);
  if (scope.forbidden || (!canAccessAllBranches(req.tenantContext!) && !canAccessScopedBranches(req.tenantContext!) && !scope.branchId)) {
    res.status(403).json({ error: "Branch access denied" });
    return;
  }
  const effectiveScope = !requestedBranchId && scope.branchScopeIds?.length ? { ...scope, branchId: undefined } : scope;

  const userId = req.query.userId?.toString();
  const action = req.query.action?.toString();
  const rawStartDate = req.query.startDate?.toString();
  const rawEndDate = req.query.endDate?.toString();
  const startDate = parseAuditDate(rawStartDate);
  const endDate = parseAuditDate(rawEndDate, true);

  if ((rawStartDate && !startDate) || (rawEndDate && !endDate)) {
    res.status(400).json({ error: "Invalid audit date range" });
    return;
  }

  if (startDate && endDate && startDate.getTime() > endDate.getTime()) {
    res.status(400).json({ error: "Start date must be before end date" });
    return;
  }

  const events = await listAuditEvents(req.tenantContext!.tenantId, {
    branchId: effectiveScope.branchId,
    branchIds: !effectiveScope.branchId ? effectiveScope.branchScopeIds : undefined,
    userId: userId && userId !== "all" ? userId : undefined,
    action: action && action !== "all" ? action : undefined,
    startDate: startDate ?? undefined,
    endDate: endDate ?? undefined
  });

  res.json({
    events
  });
});
