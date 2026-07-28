import { branchInputSchema, terminalInputSchema } from "@pos/validation";
import { Router, type Request, type Response } from "express";
import { canAccessAllBranches, resolveBranchScope, requireAuthenticatedUser, requirePermission, requireTenant } from "../../shared/http/tenantContext";
import { createBranch, createTerminal, listBranchOptions, listBranches, updateBranch, updateTerminal } from "./branches.repository";

export const branchesRouter = Router();

function requireBranchContext(req: Request, res: Response) {
  if (!canAccessAllBranches(req.tenantContext!) && !req.tenantContext!.branchId) {
    res.status(403).json({ error: "Branch access denied" });
    return false;
  }

  return true;
}

branchesRouter.get("/", requireTenant, requireAuthenticatedUser, async (req, res) => {
  if (!requireBranchContext(req, res)) return;

  const scope = resolveBranchScope(req.tenantContext!, req.query.branchId?.toString());
  if (scope.forbidden) {
    res.status(403).json({ error: "Branch access denied" });
    return;
  }

  const result = await listBranches(req.tenantContext!.tenantId);
  res.json({
    branches: scope.branchId ? result.branches.filter((branch) => branch.id === scope.branchId) : result.branches,
    terminals: scope.branchId ? result.terminals.filter((terminal) => terminal.branchId === scope.branchId) : result.terminals
  });
});

branchesRouter.get("/options", requireTenant, requireAuthenticatedUser, async (req, res) => {
  if (!requireBranchContext(req, res)) return;

  const scope = resolveBranchScope(req.tenantContext!, req.query.branchId?.toString());
  if (scope.forbidden) {
    res.status(403).json({ error: "Branch access denied" });
    return;
  }

  const result = await listBranchOptions(req.tenantContext!.tenantId);
  res.json({
    branches: scope.branchId ? result.branches.filter((branch) => branch.id === scope.branchId) : result.branches,
    terminals: scope.branchId ? result.terminals.filter((terminal) => terminal.branchId === scope.branchId) : result.terminals
  });
});

branchesRouter.post("/", requireTenant, requirePermission("branch.manage"), async (req, res) => {
  if (!canAccessAllBranches(req.tenantContext!)) {
    res.status(403).json({ error: "Only all-branch administrators can create branches" });
    return;
  }

  const parsed = branchInputSchema.safeParse(req.body);

  if (!parsed.success) {
    res.status(400).json({ error: "Invalid branch payload", issues: parsed.error.flatten() });
    return;
  }

  const result = await createBranch(req.tenantContext!.tenantId, req.tenantContext!.userId, parsed.data);

  if (result.status === "duplicate_name") {
    res.status(409).json({ error: "Branch name already exists for this tenant" });
    return;
  }

  if (result.status === "branch_limit_reached") {
    res.status(409).json({ error: "Active branch limit reached for this tenant plan" });
    return;
  }

  res.status(201).json({ branch: result.branch });
});

branchesRouter.patch("/:branchId", requireTenant, requirePermission("branch.manage"), async (req, res) => {
  if (!requireBranchContext(req, res)) return;

  const scope = resolveBranchScope(req.tenantContext!, req.params.branchId.toString());
  if (scope.forbidden) {
    res.status(403).json({ error: "Branch access denied" });
    return;
  }

  const parsed = branchInputSchema.partial().safeParse(req.body);

  if (!parsed.success) {
    res.status(400).json({ error: "Invalid branch payload", issues: parsed.error.flatten() });
    return;
  }

  const result = await updateBranch(req.tenantContext!.tenantId, req.tenantContext!.userId, req.params.branchId.toString(), parsed.data);

  if (result.status === "not_found") {
    res.status(404).json({ error: "Branch not found" });
    return;
  }

  if (result.status === "duplicate_name") {
    res.status(409).json({ error: "Branch name already exists for this tenant" });
    return;
  }

  if (result.status === "branch_limit_reached") {
    res.status(409).json({ error: "Active branch limit reached for this tenant plan" });
    return;
  }

  if (result.status === "default_branch_required") {
    res.status(409).json({ error: "Default branch cannot be paused" });
    return;
  }

  if (result.status === "online_terminals_attached") {
    res.status(409).json({ error: "Move online terminals offline before pausing this branch" });
    return;
  }

  res.json({ branch: result.branch });
});

branchesRouter.post("/terminals", requireTenant, requirePermission("branch.manage"), async (req, res) => {
  const parsed = terminalInputSchema.safeParse(req.body);

  if (!parsed.success) {
    res.status(400).json({ error: "Invalid terminal payload", issues: parsed.error.flatten() });
    return;
  }

  if (!requireBranchContext(req, res)) return;

  const scope = resolveBranchScope(req.tenantContext!, parsed.data.branchId);
  if (scope.forbidden) {
    res.status(403).json({ error: "Branch access denied" });
    return;
  }

  const result = await createTerminal(req.tenantContext!.tenantId, req.tenantContext!.userId, parsed.data);

  if (result.status === "branch_not_found") {
    res.status(404).json({ error: "Branch not found" });
    return;
  }

  if (result.status === "duplicate_device_code") {
    res.status(409).json({ error: "Terminal device code already exists for this tenant" });
    return;
  }

  if (result.status === "branch_not_active") {
    res.status(409).json({ error: "Online terminals require an active branch" });
    return;
  }

  res.status(201).json({ terminal: result.terminal });
});

branchesRouter.patch("/terminals/:terminalId", requireTenant, requirePermission("branch.manage"), async (req, res) => {
  const parsed = terminalInputSchema.partial().safeParse(req.body);

  if (!parsed.success) {
    res.status(400).json({ error: "Invalid terminal payload", issues: parsed.error.flatten() });
    return;
  }

  if (!requireBranchContext(req, res)) return;

  const scope = resolveBranchScope(req.tenantContext!, parsed.data.branchId);
  if (scope.forbidden) {
    res.status(403).json({ error: "Branch access denied" });
    return;
  }

  const scopedBranchId = canAccessAllBranches(req.tenantContext!) ? undefined : scope.branchId;
  const result = await updateTerminal(req.tenantContext!.tenantId, req.tenantContext!.userId, req.params.terminalId.toString(), parsed.data, scopedBranchId);

  if (result.status === "not_found") {
    res.status(404).json({ error: "Terminal not found" });
    return;
  }

  if (result.status === "branch_not_found") {
    res.status(404).json({ error: "Branch not found" });
    return;
  }

  if (result.status === "duplicate_device_code") {
    res.status(409).json({ error: "Terminal device code already exists for this tenant" });
    return;
  }

  if (result.status === "branch_not_active") {
    res.status(409).json({ error: "Online terminals require an active branch" });
    return;
  }

  res.json({ terminal: result.terminal });
});
