import { syncQueueInputSchema, syncQueueStatusSchema } from "@pos/validation";
import { Router, type Request, type Response } from "express";
import { canAccessAllBranches, resolveBranchScope, requireAnyPermission, requirePermission, requireTenant } from "../../shared/http/tenantContext";
import { listSyncQueue, queueSyncRecord, updateSyncRecordStatus } from "./sync.repository";

export const syncRouter = Router();

function parseSyncDate(value: string | undefined, endOfDay = false) {
  if (!value) return null;
  const date = new Date(`${value}T${endOfDay ? "23:59:59.999" : "00:00:00.000"}`);
  return Number.isNaN(date.getTime()) ? null : date;
}

function requestedBranch(req: Request) {
  const requested = req.query.branchId?.toString() ?? req.header("x-branch-id");
  if (requested) return requested;

  if (!canAccessAllBranches(req.tenantContext!) && req.tenantContext!.branchId) {
    return req.tenantContext!.branchId;
  }

  return undefined;
}

function resolveSyncBranch(req: Request, res: Response) {
  const scope = resolveBranchScope(req.tenantContext!, requestedBranch(req));
  if (scope.forbidden || (!canAccessAllBranches(req.tenantContext!) && !scope.branchId)) {
    res.status(403).json({ error: "Branch access denied" });
    return null;
  }

  return scope;
}

syncRouter.get("/queue", requireTenant, requirePermission("sync.manage"), async (req, res) => {
  const scope = resolveBranchScope(req.tenantContext!, requestedBranch(req));
  if (scope.forbidden || (!canAccessAllBranches(req.tenantContext!) && !scope.branchId)) {
    res.status(403).json({ error: "Branch access denied" });
    return;
  }

  const startDateValue = req.query.startDate?.toString();
  const endDateValue = req.query.endDate?.toString();
  const startDate = parseSyncDate(startDateValue);
  const endDate = parseSyncDate(endDateValue, true);

  if ((startDateValue && !startDate) || (endDateValue && !endDate)) {
    res.status(400).json({ error: "Invalid sync date range" });
    return;
  }

  if (startDate && endDate && startDate.getTime() > endDate.getTime()) {
    res.status(400).json({ error: "Start date must be before end date" });
    return;
  }

  const records = await listSyncQueue(req.tenantContext!.tenantId, {
    branchId: scope.branchId,
    terminalId: req.query.terminalId?.toString(),
    status: req.query.status?.toString(),
    startDate: startDate ?? undefined,
    endDate: endDate ?? undefined
  });

  res.json({ records });
});

syncRouter.post("/queue", requireTenant, requireAnyPermission(["sale.create", "sync.manage"]), async (req, res) => {
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

  const result = await queueSyncRecord(req.tenantContext!.tenantId, req.tenantContext!.userId, {
    ...parsed.data,
    branchId: scope.branchId ?? parsed.data.branchId
  });

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

  const scope = resolveSyncBranch(req, res);
  if (!scope) return;

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
