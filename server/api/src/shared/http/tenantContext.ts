import type { NextFunction, Request, Response } from "express";
import type { PermissionAction } from "@pos/types";
import { createHmac, timingSafeEqual } from "node:crypto";
import { getRolePermissions } from "../../modules/roles/roles.repository";
import { authSessions, branches, staffMembers } from "../data/demoStore";
import { prisma } from "../db/prisma";
import { fallbackPermissionsForRole } from "../security/accessControl";

export interface TenantContext {
  tenantId: string;
  branchId?: string;
  branchCity?: string;
  branchScopeIds?: string[];
  userId: string;
  role: string;
  sessionId?: string;
  permissions: PermissionAction[];
}

declare global {
  namespace Express {
    interface Request {
      tenantContext?: TenantContext;
    }
  }
}

const authSecret = process.env.AUTH_SECRET ?? "naijapos-dev-auth-secret";
const allowHeaderAuth = process.env.NODE_ENV === "test" || process.env.ALLOW_HEADER_AUTH === "true";
const useDemoStore = process.env.NODE_ENV === "test";

interface AccessTokenPayload {
  tenantId: string;
  branchId?: string;
  staffId: string;
  role: string;
  sessionId: string;
  exp: number;
}

export function permissionsForRole(role: string) {
  return fallbackPermissionsForRole(role);
}

export function canAccessAllBranches(context: TenantContext) {
  return context.role === "owner";
}

export function canAccessScopedBranches(context: TenantContext) {
  return context.role === "state_manager" && Boolean(context.branchScopeIds?.length);
}

export function isSelfScopedRole(context: TenantContext) {
  return context.role === "cashier" || context.role === "teller";
}

export function resolveBranchScope(context: TenantContext, requestedBranchId?: string) {
  const requested = requestedBranchId?.trim();

  if (canAccessAllBranches(context)) {
    return { branchId: requested || undefined, forbidden: false };
  }

  if (canAccessScopedBranches(context)) {
    if (requested) {
      return context.branchScopeIds!.includes(requested)
        ? { branchId: requested, branchScopeIds: context.branchScopeIds, forbidden: false }
        : { branchId: context.branchId, branchScopeIds: context.branchScopeIds, forbidden: true };
    }

    return { branchId: context.branchId, branchScopeIds: context.branchScopeIds, forbidden: false };
  }

  if (!context.branchId) {
    return { branchId: requested || undefined, forbidden: false };
  }

  if (requested && requested !== context.branchId) {
    return { branchId: context.branchId, forbidden: true };
  }

  return { branchId: context.branchId, forbidden: false };
}

export function selfScopedUserId(context: TenantContext) {
  return isSelfScopedRole(context) ? context.userId : undefined;
}

function safeCompare(left: string, right: string) {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

function readBearerToken(req: Request) {
  const authorization = req.header("authorization");
  if (!authorization?.toLowerCase().startsWith("bearer ")) return null;
  return authorization.slice("bearer ".length).trim();
}

function verifyAccessToken(token: string | null): AccessTokenPayload | null {
  if (!token) return null;

  const [header, body, signature] = token.split(".");
  if (!header || !body || !signature) return null;

  const expectedSignature = createHmac("sha256", authSecret).update(`${header}.${body}`).digest("base64url");
  if (!safeCompare(signature, expectedSignature)) return null;

  try {
    const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as AccessTokenPayload;
    const expiresAt = Number(payload.exp) * 1000;
    if (!payload.tenantId || !payload.staffId || !payload.role || !payload.sessionId || expiresAt <= Date.now()) return null;
    return payload;
  } catch {
    return null;
  }
}

async function currentContextForToken(payload: AccessTokenPayload): Promise<TenantContext | null> {
  if (useDemoStore) {
    const session = authSessions.find((item) =>
      item.id === payload.sessionId &&
      item.tenantId === payload.tenantId &&
      item.staffId === payload.staffId &&
      !item.revokedAt &&
      new Date(item.expiresAt).getTime() > Date.now()
    );
    const staff = staffMembers.find((member) =>
      member.tenantId === payload.tenantId &&
      member.id === payload.staffId &&
      member.active &&
      member.inviteStatus === "accepted"
    );
    if (!session || !staff) return null;
    const branchId = session.branchId || staff.branchId || payload.branchId;
    const branch = branches.find((item) => item.tenantId === payload.tenantId && item.id === branchId);
    const branchScopeIds = staff.role === "state_manager" && branch?.city
      ? branches.filter((item) => item.tenantId === payload.tenantId && item.city.toLowerCase() === branch.city.toLowerCase()).map((item) => item.id)
      : undefined;
    return {
      tenantId: payload.tenantId,
      branchId,
      branchCity: branch?.city,
      branchScopeIds,
      userId: staff.id,
      role: staff.role,
      sessionId: session.id,
      permissions: await getRolePermissions(payload.tenantId, staff.role)
    };
  }

  const [session, staff] = await Promise.all([
    prisma.authSession.findFirst({
      where: {
        id: payload.sessionId,
        tenantId: payload.tenantId,
        staffId: payload.staffId,
        revokedAt: null,
        expiresAt: { gt: new Date() }
      }
    }),
    prisma.staffMember.findFirst({
      where: {
        tenantId: payload.tenantId,
        id: payload.staffId,
        active: true,
        inviteStatus: "accepted"
      }
    })
  ]);
  if (!session || !staff) return null;
  const branchId = session.branchId ?? staff.branchId ?? payload.branchId;
  const branch = branchId
    ? await prisma.branch.findFirst({ where: { tenantId: payload.tenantId, id: branchId }, select: { city: true } })
    : null;
  const branchScopeIds = staff.role === "state_manager" && branch?.city
    ? (await prisma.branch.findMany({
      where: { tenantId: payload.tenantId, city: branch.city },
      select: { id: true }
    })).map((item) => item.id)
    : undefined;

  return {
    tenantId: payload.tenantId,
    branchId,
    branchCity: branch?.city,
    branchScopeIds,
    userId: staff.id,
    role: staff.role,
    sessionId: session.id,
    permissions: await getRolePermissions(payload.tenantId, staff.role)
  };
}

export function attachTenantContext(req: Request, _res: Response, next: NextFunction) {
  const tokenPayload = verifyAccessToken(readBearerToken(req));
  const headerTenantId = allowHeaderAuth ? req.header("x-tenant-id") : undefined;

  if (tokenPayload) {
    void currentContextForToken(tokenPayload)
      .then((context) => {
        if (context) req.tenantContext = context;
        next();
      })
      .catch(() => next());
    return;
  }

  const tenantId = headerTenantId;
  const branchId = allowHeaderAuth ? req.header("x-branch-id") : undefined;

  if (tenantId) {
    const role = (allowHeaderAuth ? req.header("x-role") : undefined) ?? "";
    const userId = (allowHeaderAuth ? req.header("x-user-id") : undefined) ?? "";
    const headerStaff = userId ? staffMembers.find((member) => member.tenantId === tenantId && member.id === userId) : undefined;
    const stateManagerFallbackBranch = role === "state_manager"
      ? headerStaff?.branchId ?? branches.find((item) => item.tenantId === tenantId)?.id
      : undefined;
    const branchScopeAnchorId = role === "state_manager"
      ? headerStaff?.branchId ?? stateManagerFallbackBranch
      : branchId;
    const context: TenantContext = {
      tenantId,
      branchId: branchId || stateManagerFallbackBranch || undefined,
      branchCity: undefined,
      userId,
      role,
      permissions: fallbackPermissionsForRole(role)
    };
    if (role === "state_manager") {
      const branch = branches.find((item) => item.tenantId === tenantId && item.id === branchScopeAnchorId);
      const city = branch?.city;
      context.branchCity = city;
      context.branchScopeIds = city
        ? branches.filter((item) => item.tenantId === tenantId && item.city.toLowerCase() === city.toLowerCase()).map((item) => item.id)
        : context.branchId ? [context.branchId] : undefined;
    }
    req.tenantContext = context;

    if (role) {
      void getRolePermissions(tenantId, role).then((permissions) => {
        context.permissions = permissions;
        next();
      }).catch(() => next());
      return;
    }
  }

  next();
}

export function requireTenant(req: Request, res: Response, next: NextFunction) {
  if (!req.tenantContext) {
    res.status(401).json({ error: "Tenant context is required" });
    return;
  }

  next();
}

export function requireAuthenticatedUser(req: Request, res: Response, next: NextFunction) {
  if (!req.tenantContext) {
    res.status(401).json({ error: "Tenant context is required" });
    return;
  }

  if (!req.tenantContext.userId) {
    res.status(401).json({ error: "Authenticated user context is required" });
    return;
  }

  next();
}

export function requirePermission(permission: PermissionAction) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.tenantContext) {
      res.status(401).json({ error: "Tenant context is required" });
      return;
    }

    if (!req.tenantContext.userId) {
      res.status(401).json({ error: "Authenticated user context is required" });
      return;
    }

    if (!req.tenantContext.permissions.includes(permission)) {
      res.status(403).json({ error: "Permission denied", permission });
      return;
    }

    next();
  };
}

export function requireAnyPermission(permissions: PermissionAction[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.tenantContext) {
      res.status(401).json({ error: "Tenant context is required" });
      return;
    }

    if (!req.tenantContext.userId) {
      res.status(401).json({ error: "Authenticated user context is required" });
      return;
    }

    if (!permissions.some((permission) => req.tenantContext!.permissions.includes(permission))) {
      res.status(403).json({ error: "Permission denied", permission: permissions[0], permissions });
      return;
    }

    next();
  };
}
