import { profileSecurityUpdateSchema, profileUpdateSchema, staffInputSchema, staffSecurityUpdateSchema, staffStatusSchema } from "@pos/validation";
import { Router, type Request, type Response } from "express";
import { canAccessAllBranches, canAccessScopedBranches, resolveBranchScope, requireAuthenticatedUser, requirePermission, requireTenant } from "../../shared/http/tenantContext";
import { createStaff, getStaffProfile, listStaff, resendStaffInvite, revokeStaffInvite, setStaffStatus, updateOwnProfile, updateOwnSecurity, updateStaff, updateStaffSecurity } from "./staff.repository";

export const staffRouter = Router();

function requestedBranch(req: Request, bodyBranchId?: string) {
  const requested = bodyBranchId ?? req.query.branchId?.toString() ?? req.header("x-branch-id");
  if (!canAccessAllBranches(req.tenantContext!) && !canAccessScopedBranches(req.tenantContext!)) return req.tenantContext!.branchId;
  if (requested) return requested;
  if (canAccessAllBranches(req.tenantContext!) || canAccessScopedBranches(req.tenantContext!)) return undefined;
  return req.tenantContext!.branchId;
}

function resolveStaffBranch(req: Request, res: Response, requestedBranchId?: string) {
  if (!canAccessAllBranches(req.tenantContext!) && !canAccessScopedBranches(req.tenantContext!) && !req.tenantContext!.branchId) {
    res.status(403).json({ error: "Branch access denied" });
    return null;
  }

  const scope = resolveBranchScope(req.tenantContext!, requestedBranchId ?? requestedBranch(req));
  if (scope.forbidden || (!canAccessAllBranches(req.tenantContext!) && !canAccessScopedBranches(req.tenantContext!) && !scope.branchId)) {
    res.status(403).json({ error: "Branch access denied" });
    return null;
  }

  return scope;
}

function effectiveStaffScope(scope: ReturnType<typeof resolveBranchScope>, requestedBranchId?: string) {
  return !requestedBranchId && scope.branchScopeIds?.length ? { ...scope, branchId: undefined, branchIds: scope.branchScopeIds } : { ...scope, branchIds: undefined };
}

staffRouter.get("/", requireTenant, requirePermission("staff.manage"), async (req, res) => {
  const requestedBranchId = req.query.branchId?.toString();
  const scope = resolveStaffBranch(req, res, requestedBranchId);
  if (!scope) return;
  const effectiveScope = effectiveStaffScope(scope, requestedBranchId);

  const staff = await listStaff(req.tenantContext!.tenantId, { branchId: effectiveScope.branchId, branchIds: effectiveScope.branchIds });

  res.json({ staff });
});

staffRouter.get("/me", requireTenant, requireAuthenticatedUser, async (req, res) => {
  const staff = await getStaffProfile(req.tenantContext!.tenantId, req.tenantContext!.userId);

  if (!staff) {
    res.status(404).json({ error: "Staff member not found" });
    return;
  }

  res.json({ staff });
});

staffRouter.patch("/me", requireTenant, requireAuthenticatedUser, async (req, res) => {
  const parsed = profileUpdateSchema.safeParse(req.body);

  if (!parsed.success) {
    res.status(400).json({ error: "Invalid profile payload", issues: parsed.error.flatten() });
    return;
  }

  const result = await updateOwnProfile(req.tenantContext!.tenantId, req.tenantContext!.userId, parsed.data);

  if (result.status === "not_found") {
    res.status(404).json({ error: "Staff member not found" });
    return;
  }

  if (result.status === "duplicate_email") {
    res.status(409).json({ error: "Staff email already exists for this tenant" });
    return;
  }

  res.json({ staff: result.staff });
});

staffRouter.patch("/me/security", requireTenant, requireAuthenticatedUser, async (req, res) => {
  const parsed = profileSecurityUpdateSchema.safeParse(req.body);

  if (!parsed.success) {
    res.status(400).json({ error: "Invalid security payload", issues: parsed.error.flatten() });
    return;
  }

  const result = await updateOwnSecurity(req.tenantContext!.tenantId, req.tenantContext!.userId, parsed.data);

  if (result.status === "not_found") {
    res.status(404).json({ error: "Staff member not found" });
    return;
  }

  if (result.status === "password_mismatch") {
    res.status(401).json({ error: "Current password is incorrect" });
    return;
  }

  if (result.status === "pin_required") {
    res.status(400).json({ error: "Enter a 6-digit PIN to enable PIN login" });
    return;
  }

  res.json({ staff: result.staff });
});

staffRouter.post("/", requireTenant, requirePermission("staff.manage"), async (req, res) => {
  const parsed = staffInputSchema.safeParse(req.body);

  if (!parsed.success) {
    res.status(400).json({ error: "Invalid staff payload", issues: parsed.error.flatten() });
    return;
  }

  const scope = resolveStaffBranch(req, res, parsed.data.branchId);
  if (!scope) return;

  const result = await createStaff(req.tenantContext!.tenantId, req.tenantContext!.userId, {
    ...parsed.data,
    branchId: scope.branchId ?? parsed.data.branchId
  });

  if (result.status === "branch_not_found") {
    res.status(404).json({ error: "Staff branch not found for this tenant" });
    return;
  }

  if (result.status === "duplicate_email") {
    res.status(409).json({ error: "Staff email already exists for this tenant" });
    return;
  }

  if (result.status === "user_limit_reached") {
    res.status(409).json({ error: "User limit reached for this tenant plan" });
    return;
  }

  res.status(201).json({ staff: result.staff });
});

staffRouter.patch("/:staffId", requireTenant, requirePermission("staff.manage"), async (req, res) => {
  const parsed = staffInputSchema.partial().safeParse(req.body);

  if (!parsed.success) {
    res.status(400).json({ error: "Invalid staff payload", issues: parsed.error.flatten() });
    return;
  }

  const currentBranchId = req.header("x-branch-id") ?? req.query.branchId?.toString();
  const scope = resolveStaffBranch(req, res, currentBranchId);
  if (!scope) return;

  let scopedPayload = parsed.data;
  if (parsed.data.branchId) {
    const targetScope = resolveStaffBranch(req, res, parsed.data.branchId);
    if (!targetScope) return;
    scopedPayload = { ...parsed.data, branchId: targetScope.branchId ?? parsed.data.branchId };
  }

  const effectiveScope = effectiveStaffScope(scope, currentBranchId);
  const result = await updateStaff(
    req.tenantContext!.tenantId,
    { branchId: effectiveScope.branchId, branchIds: effectiveScope.branchIds },
    req.tenantContext!.userId,
    req.params.staffId.toString(),
    scopedPayload
  );

  if (result.status === "not_found") {
    res.status(404).json({ error: "Staff member not found" });
    return;
  }

  if (result.status === "duplicate_email") {
    res.status(409).json({ error: "Staff email already exists for this tenant" });
    return;
  }

  if (result.status === "branch_not_found") {
    res.status(404).json({ error: "Staff branch not found for this tenant" });
    return;
  }

  res.json({ staff: result.staff });
});

staffRouter.patch("/:staffId/status", requireTenant, requirePermission("staff.manage"), async (req, res) => {
  const parsed = staffStatusSchema.safeParse(req.body);

  if (!parsed.success) {
    res.status(400).json({ error: "Invalid staff status", issues: parsed.error.flatten() });
    return;
  }

  const scope = resolveStaffBranch(req, res);
  if (!scope) return;
  const effectiveScope = effectiveStaffScope(scope);

  const result = await setStaffStatus(
    req.tenantContext!.tenantId,
    { branchId: effectiveScope.branchId, branchIds: effectiveScope.branchIds },
    req.tenantContext!.userId,
    req.params.staffId.toString(),
    parsed.data
  );

  if (result.status === "not_found") {
    res.status(404).json({ error: "Staff member not found" });
    return;
  }

  if (result.status === "self_deactivate") {
    res.status(409).json({ error: "Users cannot deactivate themselves" });
    return;
  }

  res.json({ staff: result.staff });
});

staffRouter.patch("/:staffId/security", requireTenant, requirePermission("staff.manage"), async (req, res) => {
  const parsed = staffSecurityUpdateSchema.safeParse(req.body);

  if (!parsed.success) {
    res.status(400).json({ error: "Invalid staff security payload", issues: parsed.error.flatten() });
    return;
  }

  const scope = resolveStaffBranch(req, res);
  if (!scope) return;
  const effectiveScope = effectiveStaffScope(scope);

  const result = await updateStaffSecurity(
    req.tenantContext!.tenantId,
    { branchId: effectiveScope.branchId, branchIds: effectiveScope.branchIds },
    req.tenantContext!.userId,
    req.params.staffId.toString(),
    parsed.data
  );

  if (result.status === "not_found") {
    res.status(404).json({ error: "Staff member not found" });
    return;
  }

  if (result.status === "pin_required") {
    res.status(400).json({ error: "Enter a 6-digit PIN to enable PIN login" });
    return;
  }

  if (result.status === "self_password_reset") {
    res.status(409).json({ error: "Use your profile page to change your own password" });
    return;
  }

  res.json({ staff: result.staff });
});

staffRouter.post("/:staffId/invite/resend", requireTenant, requirePermission("staff.manage"), async (req, res) => {
  const scope = resolveStaffBranch(req, res);
  if (!scope) return;
  const effectiveScope = effectiveStaffScope(scope);

  const result = await resendStaffInvite(
    req.tenantContext!.tenantId,
    { branchId: effectiveScope.branchId, branchIds: effectiveScope.branchIds },
    req.tenantContext!.userId,
    req.params.staffId.toString()
  );

  if (result.status === "not_found") {
    res.status(404).json({ error: "Staff member not found" });
    return;
  }

  res.json({ staff: result.staff });
});

staffRouter.post("/:staffId/invite/revoke", requireTenant, requirePermission("staff.manage"), async (req, res) => {
  const scope = resolveStaffBranch(req, res);
  if (!scope) return;
  const effectiveScope = effectiveStaffScope(scope);

  const result = await revokeStaffInvite(
    req.tenantContext!.tenantId,
    { branchId: effectiveScope.branchId, branchIds: effectiveScope.branchIds },
    req.tenantContext!.userId,
    req.params.staffId.toString()
  );

  if (result.status === "not_found") {
    res.status(404).json({ error: "Staff member not found" });
    return;
  }

  if (result.status === "self_revoke") {
    res.status(409).json({ error: "Users cannot revoke their own invite" });
    return;
  }

  res.json({ staff: result.staff });
});
