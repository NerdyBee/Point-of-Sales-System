import { approvalApplySchema, approvalDecisionSchema, approvalRequestSchema } from "@pos/validation";
import { Router } from "express";
import { resolveBranchScope, requireAuthenticatedUser, requirePermission, requireTenant } from "../../shared/http/tenantContext";
import { applyApproval, decideApproval, listApprovals, requestApproval } from "./approvals.repository";

export const approvalsRouter = Router();

approvalsRouter.get("/", requireTenant, requirePermission("approval.manage"), async (req, res) => {
  const scope = resolveBranchScope(req.tenantContext!, req.query.branchId?.toString());
  if (scope.forbidden) {
    res.status(403).json({ error: "Branch access denied" });
    return;
  }

  const approvals = await listApprovals(req.tenantContext!.tenantId, {
    status: req.query.status?.toString() ?? "all",
    type: req.query.type?.toString() ?? "all",
    branchId: scope.branchId
  });

  res.json({ approvals });
});

approvalsRouter.post("/", requireTenant, requireAuthenticatedUser, async (req, res) => {
  const parsed = approvalRequestSchema.safeParse(req.body);

  if (!parsed.success) {
    res.status(400).json({ error: "Invalid approval request", issues: parsed.error.flatten() });
    return;
  }

  const scope = resolveBranchScope(req.tenantContext!, parsed.data.branchId);
  if (scope.forbidden) {
    res.status(403).json({ error: "Branch access denied" });
    return;
  }

  const result = await requestApproval(req.tenantContext!.tenantId, req.tenantContext!.userId, {
    ...parsed.data,
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

  const result = await decideApproval(
    req.tenantContext!.tenantId,
    req.tenantContext!.branchId,
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

approvalsRouter.post("/:approvalId/apply", requireTenant, requireAuthenticatedUser, async (req, res) => {
  const parsed = approvalApplySchema.safeParse(req.body);

  if (!parsed.success) {
    res.status(400).json({ error: "Invalid approval application", issues: parsed.error.flatten() });
    return;
  }

  const result = await applyApproval(req.tenantContext!, req.params.approvalId.toString(), parsed.data);

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
