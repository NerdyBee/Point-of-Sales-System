import type { NextFunction, Request, Response } from "express";
import type { PermissionAction } from "@pos/types";
import { createHmac, timingSafeEqual } from "node:crypto";
import { prisma } from "../db/prisma";
import { fallbackPermissionsForRole } from "../security/accessControl";

export interface TenantContext {
  tenantId: string;
  branchId?: string;
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
  return context.role === "owner" || context.role === "state_manager";
}

export function isSelfScopedRole(context: TenantContext) {
  return context.role === "cashier" || context.role === "teller";
}

export function resolveBranchScope(context: TenantContext, requestedBranchId?: string) {
  const requested = requestedBranchId?.trim();

  if (canAccessAllBranches(context)) {
    return { branchId: requested || undefined, forbidden: false };
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

export function attachTenantContext(req: Request, _res: Response, next: NextFunction) {
  const tokenPayload = verifyAccessToken(readBearerToken(req));
  const headerTenantId = allowHeaderAuth ? req.header("x-tenant-id") : undefined;
  const tenantId = tokenPayload?.tenantId ?? headerTenantId;
  const branchId = tokenPayload ? (req.header("x-branch-id") || tokenPayload.branchId) : (allowHeaderAuth ? req.header("x-branch-id") : undefined);

  if (tenantId) {
    const role = tokenPayload?.role ?? (allowHeaderAuth ? req.header("x-role") : undefined) ?? "";
    const context: TenantContext = {
      tenantId,
      branchId: branchId || undefined,
      userId: tokenPayload?.staffId ?? (allowHeaderAuth ? req.header("x-user-id") : undefined) ?? "",
      role,
      sessionId: tokenPayload?.sessionId,
      permissions: fallbackPermissionsForRole(role)
    };
    req.tenantContext = context;

    if (process.env.NODE_ENV !== "test") {
      void prisma.accessRole.findFirst({
        where: { tenantId, name: role },
        include: { permissions: { include: { permission: true } } }
      }).then((accessRole) => {
        if (accessRole) {
          const dbPermissions = accessRole.permissions.map((item) => item.permission.action as PermissionAction);
          const fallbackPermissions = fallbackPermissionsForRole(role);
          context.permissions = Array.from(new Set([...dbPermissions, ...fallbackPermissions]));
        }
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
