import { syncQueueInputSchema, syncQueueStatusSchema } from "@pos/validation";
import { Router } from "express";
import { canAccessAllBranches, resolveBranchScope, requireAuthenticatedUser, requirePermission, requireTenant } from "../../shared/http/tenantContext";
import { listSyncQueue, queueSyncRecord, updateSyncRecordStatus } from "./sync.repository";

export const syncRouter = Router();

syncRouter.get("/queue", requireTenant, requirePermission("sync.manage"), async (req, res) => {
  const scope = resolveBranchScope(req.tenantContext!, req.query.branchId?.toString());
  if (scope.forbidden || (!canAccessAllBranches(req.tenantContext!) && !scope.branchId)) {
    res.status(403).json({ error: "Branch access denied" });
    return;
  }

  const records = await listSyncQueue(req.tenantContext!.tenantId, {
    branchId: scope.branchId,
    terminalId: req.query.terminalId?.toString(),
    status: req.query.status?.toString()
  });

  res.json({ records });
});

syncRouter.post("/queue", requireTenant, requireAuthenticatedUser, async (req, res) => {
  if (!req.tenantContext!.permissions.includes("sale.create") && !req.tenantContext!.permissions.includes("sync.manage")) {
    res.status(403).json({ error: "Permission denied", permission: "sale.create" });
    return;
  }

  const parsed = syncQueueInputSchema.safeParse(req.body);

  if (!parsed.success) {
    res.status(400).json({ error: "Invalid sync queue payload", issues: parsed.error.flatten() });
    return;
  }

  const scope = resolveBranchScope(req.tenantContext!, parsed.data.branchId);
  if (scope.forbidden || (!canAccessAllBranches(req.tenantContext!) && !req.tenantContext!.branchId)) {
    res.status(403).json({ error: "Branch access denied" });
    return;
  }

  const result = await queueSyncRecord(req.tenantContext!.tenantId, req.tenantContext!.userId, parsed.data);

  if (result.status === "branch_not_found") {
    res.status(404).json({ error: "Sync branch not found for this tenant" });
    return;
  }

  if (result.status === "terminal_not_found") {
    res.status(404).json({ error: "Sync terminal not found for this branch" });
    return;
  }

  res.status(result.status === "created" ? 201 : 200).json({ record: result.record, status: result.status });
});

syncRouter.patch("/queue/:recordId/status", requireTenant, requirePermission("sync.manage"), async (req, res) => {
  const parsed = syncQueueStatusSchema.safeParse(req.body);

  if (!parsed.success) {
    res.status(400).json({ error: "Invalid sync status payload", issues: parsed.error.flatten() });
    return;
  }

  const scope = resolveBranchScope(req.tenantContext!, req.tenantContext!.branchId);
  if (scope.forbidden || (!canAccessAllBranches(req.tenantContext!) && !scope.branchId)) {
    res.status(403).json({ error: "Branch access denied" });
    return;
  }

  const result = await updateSyncRecordStatus(
    req.tenantContext!.tenantId,
    scope.branchId,
    req.tenantContext!.userId,
    req.params.recordId.toString(),
    parsed.data
  );

  if (result.status === "not_found") {
    res.status(404).json({ error: "Sync record not found" });
    return;
  }

  res.json({ record: result.record });
});
