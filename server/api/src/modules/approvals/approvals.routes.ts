import { approvalApplySchema, approvalDecisionSchema, approvalRequestSchema } from "@pos/validation";
import { Router, type Request, type Response } from "express";
import { canAccessAllBranches, canAccessScopedBranches, resolveBranchScope, requireAnyPermission, requirePermission, requireTenant } from "../../shared/http/tenantContext";
import { applyApproval, decideApproval, listApprovals, requestApproval } from "./approvals.repository";

export const approvalsRouter = Router();
const approvalWorkflowPermissions = ["sale.create", "register.manage", "inventory.adjust", "customer.manage", "expense.manage", "approval.manage"] as const;

function parseApprovalDate(value: string | undefined, endOfDay = false) {
  if (!value) return null;
  const date = new Date(`${value}T${endOfDay ? "23:59:59.999" : "00:00:00.000"}`);
  return Number.isNaN(date.getTime()) ? null : date;
}

function requireBranchContext(req: Request, res: Response) {
  const requestedBranchId = requestedBranch(req);
  const scope = resolveBranchScope(req.tenantContext!, requestedBranchId);
  if (scope.forbidden || (!canAccessAllBranches(req.tenantContext!) && !canAccessScopedBranches(req.tenantContext!) && !scope.branchId)) {
    res.status(403).json({ error: "Branch access denied" });
    return null;
  }

  return scope;
}

function requestedBranch(req: Request) {
  const queryBranchId = req.query.branchId?.toString();
  if (queryBranchId) return queryBranchId;

  const headerBranchId = req.header("x-branch-id");
  if (headerBranchId) return headerBranchId;

  if (canAccessAllBranches(req.tenantContext!) || canAccessScopedBranches(req.tenantContext!)) return undefined;
  return req.tenantContext!.branchId;
}

function effectiveBranchScope(scope: ReturnType<typeof resolveBranchScope>, requestedBranchId?: string) {
  return !requestedBranchId && scope.branchScopeIds?.length ? { ...scope, branchId: undefined } : scope;
}

approvalsRouter.get("/", requireTenant, requirePermission("approval.manage"), async (req, res) => {
  const requestedBranchId = requestedBranch(req);
  const scope = requireBranchContext(req, res);
  if (!scope) return;
  const effectiveScope = effectiveBranchScope(scope, requestedBranchId);

  const startDateValue = req.query.startDate?.toString();
  const endDateValue = req.query.endDate?.toString();
  const startDate = parseApprovalDate(startDateValue);
  const endDate = parseApprovalDate(endDateValue, true);

  if ((startDateValue && !startDate) || (endDateValue && !endDate)) {
    res.status(400).json({ error: "Invalid approval date range" });
    return;
  }

  if (startDate && endDate && startDate.getTime() > endDate.getTime()) {
    res.status(400).json({ error: "Start date must be before end date" });
    return;
  }

  const approvals = await listApprovals(req.tenantContext!.tenantId, {
    status: req.query.status?.toString() ?? "all",
    type: req.query.type?.toString() ?? "all",
    branchId: effectiveScope.branchId,
    branchIds: !effectiveScope.branchId ? effectiveScope.branchScopeIds : undefined,
    startDate: startDate ?? undefined,
    endDate: endDate ?? undefined
  });

  res.json({ approvals });
});

approvalsRouter.post("/", requireTenant, requireAnyPermission([...approvalWorkflowPermissions]), async (req, res) => {
  const parsed = approvalRequestSchema.safeParse(req.body);

  if (!parsed.success) {
    res.status(400).json({ error: "Invalid approval request", issues: parsed.error.flatten() });
    return;
  }

  const scope = resolveBranchScope(req.tenantContext!, parsed.data.branchId);
  if (scope.forbidden || (!canAccessAllBranches(req.tenantContext!) && !canAccessScopedBranches(req.tenantContext!) && !scope.branchId)) {
    res.status(403).json({ error: "Branch access denied" });
    return;
  }

  const result = await requestApproval(req.tenantContext!.tenantId, req.tenantContext!.userId, {
    ...parsed.data,
    branchId: scope.branchId ?? parsed.data.branchId,
    requestedBy: req.tenantContext!.userId
  });

  if (result.status === "branch_not_found") {
    res.status(404).json({ error: "Approval branch not found for this tenant" });
    return;
  }

  res.status(201).json({ approval: result.approval });
});

approvalsRouter.patch("/:approvalId/decision", requireTenant, requirePermission("approval.manage"), async (req, res) => {
  const parsed = approvalDecisionSchema.safeParse(req.body);

  if (!parsed.success) {
    res.status(400).json({ error: "Invalid approval decision", issues: parsed.error.flatten() });
    return;
  }

  const requestedBranchId = requestedBranch(req);
  const scope = requireBranchContext(req, res);
  if (!scope) return;
  const effectiveScope = effectiveBranchScope(scope, requestedBranchId);

  const result = await decideApproval(
    req.tenantContext!.tenantId,
    {
      branchId: effectiveScope.branchId,
      branchIds: !effectiveScope.branchId ? effectiveScope.branchScopeIds : undefined
    },
    req.tenantContext!.userId,
    req.params.approvalId.toString(),
    parsed.data
  );

  if (result.status === "not_found") {
    res.status(404).json({ error: "Approval request not found" });
    return;
  }

  if (result.status === "already_decided") {
    res.status(409).json({ error: "Approval request has already been decided" });
    return;
  }

  res.json({ approval: result.approval });
});

approvalsRouter.post("/:approvalId/apply", requireTenant, requireAnyPermission([...approvalWorkflowPermissions]), async (req, res) => {
  const parsed = approvalApplySchema.safeParse(req.body);

  if (!parsed.success) {
    res.status(400).json({ error: "Invalid approval application", issues: parsed.error.flatten() });
    return;
  }

  const requestedBranchId = requestedBranch(req);
  const scope = requireBranchContext(req, res);
  if (!scope) return;
  const effectiveScope = effectiveBranchScope(scope, requestedBranchId);

  const result = await applyApproval(
    {
      ...req.tenantContext!,
      branchId: effectiveScope.branchId,
      branchScopeIds: !effectiveScope.branchId ? effectiveScope.branchScopeIds : req.tenantContext!.branchScopeIds
    },
    req.params.approvalId.toString(),
    parsed.data
  );

  if (result.status === "not_found") {
    res.status(404).json({ error: "Approval request not found" });
    return;
  }

  if (result.status === "not_approved") {
    res.status(409).json({ error: "Only approved requests can be applied" });
    return;
  }

  if (result.status === "workflow_mismatch") {
    res.status(409).json({ error: "Approval request does not match this workflow" });
    return;
  }

  if (result.status === "coverage_mismatch") {
    res.status(409).json({ error: "Approval request does not cover this action" });
    return;
  }

  if (result.status === "forbidden") {
    res.status(403).json({ error: "Only the requester or a manager can apply this approval" });
    return;
  }

  res.json({ approval: result.approval });
});
