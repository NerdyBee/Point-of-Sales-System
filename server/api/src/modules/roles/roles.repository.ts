import type { PermissionAction } from "@pos/types";
import type { Prisma } from "@prisma/client";
import { appendAudit, staffMembers } from "../../shared/data/demoStore";
import { prisma } from "../../shared/db/prisma";
import { fallbackPermissionsForRole, permissionCatalog, permissionsByRole } from "../../shared/security/accessControl";

const useDemoStore = process.env.NODE_ENV === "test";

export interface AccessRoleDto {
  id: string;
  tenantId: string;
  name: string;
  label: string;
  description?: string;
  system: boolean;
  staffCount: number;
  permissions: PermissionAction[];
  createdAt: string;
  updatedAt: string;
}

const demoRoles = new Map<string, AccessRoleDto[]>();

function nextRoleId(name: string) {
  return `role-${name}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

function nextAuditId() {
  return `audit-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function roleLabel(name: string) {
  return name.split("_").map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`).join(" ");
}

function nowIso() {
  return new Date().toISOString();
}

function serializePermission(action: string) {
  return permissionCatalog.find((permission) => permission.action === action);
}

function demoTenantRoles(tenantId: string) {
  if (!demoRoles.has(tenantId)) {
    demoRoles.set(tenantId, Object.entries(permissionsByRole).map(([name, permissions]) => ({
      id: `role-${tenantId}-${name}`,
      tenantId,
      name,
      label: roleLabel(name),
      description: `${roleLabel(name)} system role`,
      system: true,
      staffCount: staffMembers.filter((member) => member.tenantId === tenantId && member.role === name).length,
      permissions,
      createdAt: nowIso(),
      updatedAt: nowIso()
    })));
  }

  return demoRoles.get(tenantId)!;
}

async function appendRolesAudit(event: Parameters<typeof appendAudit>[0]) {
  if (useDemoStore) {
    appendAudit(event);
    return;
  }

  await prisma.auditEvent.create({
    data: {
      id: nextAuditId(),
      tenantId: event.tenantId,
      branchId: event.branchId,
      userId: event.userId,
      action: event.action,
      entityType: event.entityType,
      entityId: event.entityId,
      metadata: event.metadata as Prisma.InputJsonValue
    }
  });
}

export function listPermissionCatalog() {
  return permissionCatalog;
}

export async function listRoleOptions(tenantId: string) {
  const roles = await listRoles(tenantId);
  return roles.map((role) => ({
    id: role.id,
    tenantId: role.tenantId,
    name: role.name,
    label: role.label,
    description: role.description,
    system: role.system,
    staffCount: role.staffCount,
    permissions: [],
    createdAt: role.createdAt,
    updatedAt: role.updatedAt
  }));
}

export async function ensureTenantAccessControl(tenantId: string) {
  if (useDemoStore) return;

  await prisma.accessPermission.createMany({
    data: permissionCatalog.map((permission) => ({
      id: `perm-${tenantId}-${permission.action}`,
      tenantId,
      action: permission.action,
      label: permission.label,
      group: permission.group,
      description: permission.description
    })),
    skipDuplicates: true
  });

  for (const [name, actions] of Object.entries(permissionsByRole)) {
    const role = await prisma.accessRole.upsert({
      where: { tenantId_name: { tenantId, name } },
      update: { label: roleLabel(name), system: true },
      create: {
        id: `role-${tenantId}-${name}`,
        tenantId,
        name,
        label: roleLabel(name),
        description: `${roleLabel(name)} system role`,
        system: true
      }
    });
    const permissions = await prisma.accessPermission.findMany({ where: { tenantId, action: { in: actions } } });
    await prisma.accessRolePermission.createMany({
      data: permissions.map((permission) => ({ roleId: role.id, permissionId: permission.id })),
      skipDuplicates: true
    });
  }
}

export async function listRoles(tenantId: string) {
  if (useDemoStore) return demoTenantRoles(tenantId);

  await ensureTenantAccessControl(tenantId);
  const [roles, staffCounts] = await Promise.all([
    prisma.accessRole.findMany({
      where: { tenantId },
      include: { permissions: { include: { permission: true } } },
      orderBy: [{ system: "desc" }, { label: "asc" }]
    }),
    prisma.staffMember.groupBy({ by: ["role"], where: { tenantId }, _count: { role: true } })
  ]);
  const counts = new Map(staffCounts.map((item) => [item.role, item._count.role]));

  return roles.map((role) => ({
    id: role.id,
    tenantId: role.tenantId,
    name: role.name,
    label: role.label,
    description: role.description ?? undefined,
    system: role.system,
    staffCount: counts.get(role.name) ?? 0,
    permissions: role.permissions.map((item) => item.permission.action as PermissionAction),
    createdAt: role.createdAt.toISOString(),
    updatedAt: role.updatedAt.toISOString()
  }));
}

export async function createRole(tenantId: string, userId: string, input: { name: string; label: string; description?: string }) {
  if (useDemoStore) {
    const roles = demoTenantRoles(tenantId);
    if (roles.some((role) => role.name === input.name)) return { status: "duplicate" as const };
    const role: AccessRoleDto = { id: nextRoleId(input.name), tenantId, name: input.name, label: input.label, description: input.description, system: false, staffCount: 0, permissions: [], createdAt: nowIso(), updatedAt: nowIso() };
    roles.push(role);
    return { status: "created" as const, role };
  }

  await ensureTenantAccessControl(tenantId);
  const existing = await prisma.accessRole.findFirst({ where: { tenantId, name: input.name } });
  if (existing) return { status: "duplicate" as const };
  const role = await prisma.accessRole.create({ data: { id: nextRoleId(input.name), tenantId, name: input.name, label: input.label, description: input.description || null, system: false } });
  await appendRolesAudit({ tenantId, userId, action: "role.created", entityType: "role", entityId: role.id, metadata: { name: role.name } });
  return { status: "created" as const, role: (await listRoles(tenantId)).find((item) => item.id === role.id)! };
}

export async function updateRole(tenantId: string, userId: string, roleId: string, input: { label?: string; description?: string }) {
  if (useDemoStore) {
    const role = demoTenantRoles(tenantId).find((item) => item.id === roleId);
    if (!role) return { status: "not_found" as const };
    role.label = input.label ?? role.label;
    role.description = input.description ?? role.description;
    role.updatedAt = nowIso();
    return { status: "updated" as const, role };
  }

  const existing = await prisma.accessRole.findFirst({ where: { tenantId, id: roleId } });
  if (!existing) return { status: "not_found" as const };
  await prisma.accessRole.update({ where: { id: roleId }, data: { label: input.label, description: input.description ?? null } });
  await appendRolesAudit({ tenantId, userId, action: "role.updated", entityType: "role", entityId: roleId, metadata: input });
  return { status: "updated" as const, role: (await listRoles(tenantId)).find((item) => item.id === roleId)! };
}

export async function updateRolePermissions(tenantId: string, userId: string, roleId: string, actions: string[]) {
  const validActions = actions.filter((action): action is PermissionAction => Boolean(serializePermission(action)));

  if (useDemoStore) {
    const role = demoTenantRoles(tenantId).find((item) => item.id === roleId);
    if (!role) return { status: "not_found" as const };
    role.permissions = role.name === "owner" ? fallbackPermissionsForRole("owner") : validActions;
    role.updatedAt = nowIso();
    return { status: "updated" as const, role };
  }

  const role = await prisma.accessRole.findFirst({ where: { tenantId, id: roleId } });
  if (!role) return { status: "not_found" as const };
  const nextActions = role.name === "owner" ? fallbackPermissionsForRole("owner") : validActions;
  const permissions = await prisma.accessPermission.findMany({ where: { tenantId, action: { in: nextActions } } });
  await prisma.accessRolePermission.deleteMany({ where: { roleId } });
  if (permissions.length) {
    await prisma.accessRolePermission.createMany({ data: permissions.map((permission) => ({ roleId, permissionId: permission.id })) });
  }
  await appendRolesAudit({ tenantId, userId, action: "role.permissions_updated", entityType: "role", entityId: roleId, metadata: { permissions: nextActions } });
  return { status: "updated" as const, role: (await listRoles(tenantId)).find((item) => item.id === roleId)! };
}

function staffBranchFilter(branchId?: string) {
  return branchId ? { branchId } : {};
}

export async function assignStaffRole(tenantId: string, branchId: string | undefined, userId: string, staffId: string, roleName: string) {
  if (useDemoStore) {
    const role = demoTenantRoles(tenantId).find((item) => item.name === roleName);
    const staff = staffMembers.find((member) => member.tenantId === tenantId && member.id === staffId && (!branchId || member.branchId === branchId));
    if (!role) return { status: "role_not_found" as const };
    if (!staff) return { status: "staff_not_found" as const };
    staff.role = roleName as typeof staff.role;
    return { status: "assigned" as const, staffId, role: roleName };
  }

  const [role, staff] = await Promise.all([
    prisma.accessRole.findFirst({ where: { tenantId, name: roleName } }),
    prisma.staffMember.findFirst({ where: { tenantId, id: staffId, ...staffBranchFilter(branchId) } })
  ]);
  if (!role) return { status: "role_not_found" as const };
  if (!staff) return { status: "staff_not_found" as const };
  await prisma.staffMember.update({ where: { id: staffId }, data: { role: role.name } });
  await appendRolesAudit({ tenantId, branchId: staff.branchId, userId, action: "staff.role_assigned", entityType: "staff", entityId: staffId, metadata: { role: role.name } });
  return { status: "assigned" as const, staffId, role: role.name };
}
