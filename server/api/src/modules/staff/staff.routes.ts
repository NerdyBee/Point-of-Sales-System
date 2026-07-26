import { staffInputSchema, staffStatusSchema } from "@pos/validation";
import { Router } from "express";
import { resolveBranchScope, requireAuthenticatedUser, requirePermission, requireTenant } from "../../shared/http/tenantContext";
import { createStaff, listStaff, resendStaffInvite, revokeStaffInvite, setStaffStatus, updateStaff } from "./staff.repository";

export const staffRouter = Router();

staffRouter.get("/", requireTenant, requireAuthenticatedUser, async (req, res) => {
  const scope = resolveBranchScope(req.tenantContext!, req.query.branchId?.toString());
  if (scope.forbidden) {
    res.status(403).json({ error: "Branch access denied" });
    return;
  }

  const staff = await listStaff(req.tenantContext!.tenantId, scope.branchId);

  res.json({ staff });
});

staffRouter.post("/", requireTenant, requirePermission("staff.manage"), async (req, res) => {
  const parsed = staffInputSchema.safeParse(req.body);

  if (!parsed.success) {
    res.status(400).json({ error: "Invalid staff payload", issues: parsed.error.flatten() });
    return;
  }

  const scope = resolveBranchScope(req.tenantContext!, parsed.data.branchId);
  if (scope.forbidden) {
    res.status(403).json({ error: "Branch access denied" });
    return;
  }

  const result = await createStaff(req.tenantContext!.tenantId, req.tenantContext!.userId, parsed.data);

  if (result.status === "branch_not_found") {
    res.status(404).json({ error: "Staff branch not found for this tenant" });
    return;
  }

  if (result.status === "duplicate_email") {
    res.status(409).json({ error: "Staff email already exists for this tenant" });
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

  const result = await updateStaff(
    req.tenantContext!.tenantId,
    req.tenantContext!.branchId,
    req.tenantContext!.userId,
    req.params.staffId.toString(),
    parsed.data
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

  const result = await setStaffStatus(
    req.tenantContext!.tenantId,
    req.tenantContext!.branchId,
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

staffRouter.post("/:staffId/invite/resend", requireTenant, requirePermission("staff.manage"), async (req, res) => {
  const result = await resendStaffInvite(
    req.tenantContext!.tenantId,
    req.tenantContext!.branchId,
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
  const result = await revokeStaffInvite(
    req.tenantContext!.tenantId,
    req.tenantContext!.branchId,
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
