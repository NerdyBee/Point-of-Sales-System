import { Router } from "express";
import { canAccessAllBranches, resolveBranchScope, requirePermission, requireTenant } from "../../shared/http/tenantContext";
import { listAuditEvents } from "./audit.repository";

export const auditRouter = Router();

auditRouter.get("/", requireTenant, requirePermission("audit.view"), async (req, res) => {
  const scope = resolveBranchScope(req.tenantContext!, req.query.branchId?.toString());
  if (scope.forbidden || (!canAccessAllBranches(req.tenantContext!) && !scope.branchId)) {
    res.status(403).json({ error: "Branch access denied" });
    return;
  }

  const userId = req.query.userId?.toString();
  const action = req.query.action?.toString();
  const events = await listAuditEvents(req.tenantContext!.tenantId, {
    branchId: scope.branchId,
    userId: userId && userId !== "all" ? userId : undefined,
    action: action && action !== "all" ? action : undefined
  });

  res.json({
    events
  });
});
