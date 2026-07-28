import { roleInputSchema, rolePermissionUpdateSchema, staffRoleAssignmentSchema } from "@pos/validation";
import { Router, type Request, type Response } from "express";
import { canAccessAllBranches, requirePermission, requireTenant } from "../../shared/http/tenantContext";
import { assignStaffRole, createRole, listPermissionCatalog, listRoleOptions, listRoles, updateRole, updateRolePermissions } from "./roles.repository";

export const rolesRouter = Router();

function requireBranchContext(req: Request, res: Response) {
  if (!canAccessAllBranches(req.tenantContext!) && !req.tenantContext!.branchId) {
    res.status(403).json({ error: "Branch access denied" });
    return false;
  }

  return true;
}

rolesRouter.get("/", requireTenant, requirePermission("roles.manage"), async (req, res) => {
  const roles = await listRoles(req.tenantContext!.tenantId);
  res.json({ roles, permissions: listPermissionCatalog() });
});

rolesRouter.get("/options", requireTenant, requirePermission("staff.manage"), async (req, res) => {
  const roles = await listRoleOptions(req.tenantContext!.tenantId);
  res.json({ roles });
});

rolesRouter.post("/", requireTenant, requirePermission("roles.manage"), async (req, res) => {
  const parsed = roleInputSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid role payload", issues: parsed.error.flatten() });
    return;
  }
  const result = await createRole(req.tenantContext!.tenantId, req.tenantContext!.userId, parsed.data);
  if (result.status === "duplicate") {
    res.status(409).json({ error: "Role already exists" });
    return;
  }
  res.status(201).json({ role: result.role });
});

rolesRouter.patch("/:roleId", requireTenant, requirePermission("roles.manage"), async (req, res) => {
  const parsed = roleInputSchema.pick({ label: true, description: true }).partial().safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid role payload", issues: parsed.error.flatten() });
    return;
  }
  const roleId = req.params.roleId.toString();
  const result = await updateRole(req.tenantContext!.tenantId, req.tenantContext!.userId, roleId, parsed.data);
  if (result.status === "not_found") {
    res.status(404).json({ error: "Role not found" });
    return;
  }
  res.json({ role: result.role });
});

rolesRouter.patch("/:roleId/permissions", requireTenant, requirePermission("roles.manage"), async (req, res) => {
  const parsed = rolePermissionUpdateSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid permission payload", issues: parsed.error.flatten() });
    return;
  }
  const roleId = req.params.roleId.toString();
  const result = await updateRolePermissions(req.tenantContext!.tenantId, req.tenantContext!.userId, roleId, parsed.data.permissions);
  if (result.status === "not_found") {
    res.status(404).json({ error: "Role not found" });
    return;
  }
  res.json({ role: result.role });
});

rolesRouter.post("/assign-staff", requireTenant, requirePermission("roles.manage"), async (req, res) => {
  const parsed = staffRoleAssignmentSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid staff role payload", issues: parsed.error.flatten() });
    return;
  }
  if (!requireBranchContext(req, res)) return;
  const result = await assignStaffRole(
    req.tenantContext!.tenantId,
    req.tenantContext!.branchId,
    req.tenantContext!.userId,
    parsed.data.staffId,
    parsed.data.role
  );
  if (result.status === "role_not_found") {
    res.status(404).json({ error: "Role not found" });
    return;
  }
  if (result.status === "staff_not_found") {
    res.status(404).json({ error: "Staff not found" });
    return;
  }
  res.json(result);
});
