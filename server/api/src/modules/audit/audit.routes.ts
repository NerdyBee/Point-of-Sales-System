import { Router } from "express";
import { resolveBranchScope, requirePermission, requireTenant } from "../../shared/http/tenantContext";
import { listAuditEvents } from "./audit.repository";

export const auditRouter = Router();

auditRouter.get("/", requireTenant, requirePermission("audit.view"), async (req, res) => {
  const scope = resolveBranchScope(req.tenantContext!, req.query.branchId?.toString());
  if (scope.forbidden) {
    res.status(403).json({ error: "Branch access denied" });
    return;
  }

  const events = await listAuditEvents(req.tenantContext!.tenantId, { branchId: scope.branchId });

  res.json({
    events
  });
});
