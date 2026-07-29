import { authLoginSchema, authPinLoginSchema, authRefreshSchema } from "@pos/validation";
import { type Request, Router } from "express";
import { listBranchOptions } from "../branches/branches.repository";
import { listStaff } from "../staff/staff.repository";
import { canAccessAllBranches, requireAuthenticatedUser, requirePermission, requireTenant, resolveBranchScope } from "../../shared/http/tenantContext";
import { branches, staffMembers, terminals } from "../../shared/data/demoStore";
import { prisma } from "../../shared/db/prisma";
import { findOrCreateSeededStaff, listAuthSessions, loginWithPassword, loginWithPin, refreshAuthSession, revokeAuthSession } from "./auth.repository";

export const authRouter = Router();

function requestMeta(req: Request) {
  return {
    userAgent: req.header("user-agent") ?? undefined,
    ipAddress: req.ip
  };
}

function requestedBranch(req: Request) {
  return req.query.branchId?.toString() ?? req.header("x-branch-id") ?? (canAccessAllBranches(req.tenantContext!) ? undefined : req.tenantContext!.branchId);
}

const useDemoStore = process.env.NODE_ENV === "test";

function normalizeStaffId(value: string) {
  return value.normalize("NFKC").replace(/[\u200B-\u200D\uFEFF]/g, "").trim().toUpperCase();
}

async function pinBootstrapForStaffId(staffId: string) {
  const normalizedStaffId = normalizeStaffId(staffId);
  if (!normalizedStaffId) return null;

  if (useDemoStore) {
    const staff = staffMembers.find((member) => member.id.toUpperCase() === normalizedStaffId && member.active && member.pinEnabled);
    if (!staff) return null;
    const branch = branches.find((item) => item.tenantId === staff.tenantId && item.id === staff.branchId);
    if (!branch) return null;

    return {
      branches: [{
        id: branch.id,
        tenantId: branch.tenantId,
        name: branch.name,
        city: branch.city,
        status: branch.status
      }],
      terminals: terminals
        .filter((terminal) => terminal.tenantId === staff.tenantId && terminal.branchId === staff.branchId)
        .map((terminal) => ({
          id: terminal.id,
          tenantId: terminal.tenantId,
          branchId: terminal.branchId,
          name: terminal.name,
          deviceCode: terminal.deviceCode,
          status: terminal.status,
          appVersion: terminal.appVersion,
          lastSeenAt: terminal.lastSeenAt
        })),
      staff: [{
        id: staff.id,
        tenantId: staff.tenantId,
        branchId: staff.branchId,
        name: staff.name,
        email: staff.email,
        role: staff.role,
        pinEnabled: staff.pinEnabled,
        active: staff.active
      }]
    };
  }

  const staffRecord = await prisma.staffMember.findFirst({
    where: {
      id: normalizedStaffId,
      active: true,
      pinEnabled: true,
      inviteStatus: "accepted"
    }
  });
  const staff = staffRecord ?? await findOrCreateSeededStaff(undefined, normalizedStaffId);
  if (!staff) return null;

  const [branch, dbTerminals] = await Promise.all([
    prisma.branch.findFirst({ where: { tenantId: staff.tenantId, id: staff.branchId } }),
    prisma.terminal.findMany({ where: { tenantId: staff.tenantId, branchId: staff.branchId }, orderBy: { name: "asc" } })
  ]);
  if (!branch) return null;

  return {
    branches: [{
      id: branch.id,
      tenantId: branch.tenantId,
      name: branch.name,
      city: branch.city,
      status: branch.status
    }],
    terminals: dbTerminals.map((terminal) => ({
      id: terminal.id,
      tenantId: terminal.tenantId,
      branchId: terminal.branchId,
      name: terminal.name,
      deviceCode: terminal.deviceCode,
      status: terminal.status,
      appVersion: terminal.appVersion,
      lastSeenAt: terminal.lastSeenAt?.toISOString()
    })),
    staff: [{
      id: staff.id,
      tenantId: staff.tenantId,
      branchId: staff.branchId,
      name: staff.name,
      email: staff.email,
      role: staff.role,
      pinEnabled: staff.pinEnabled,
      active: staff.active
    }]
  };
}

authRouter.post("/login", async (req, res) => {
  const parsed = authLoginSchema.safeParse(req.body);

  if (!parsed.success) {
    res.status(400).json({ error: "Invalid login payload", issues: parsed.error.flatten() });
    return;
  }

  const result = await loginWithPassword(parsed.data, requestMeta(req));
  if (result.status === "invalid_credentials") {
    res.status(result.reason === "account_locked" ? 429 : 401).json({
      error: result.reason === "account_locked" ? "Account temporarily locked" : "Invalid credentials",
      ...(process.env.NODE_ENV === "production"
        ? {}
        : { reason: result.reason, lockedUntil: result.lockedUntil, tenantId: parsed.data.tenantId, identifier: parsed.data.identifier })
    });
    return;
  }

  res.json(result.auth);
});

authRouter.get("/bootstrap", async (req, res) => {
  const tenantId = req.query.tenantId?.toString();

  if (!tenantId) {
    res.status(400).json({ error: "Tenant is required" });
    return;
  }

  const branchId = req.query.branchId?.toString();
  const [branchOptions, staff] = await Promise.all([listBranchOptions(tenantId), listStaff(tenantId, branchId)]);

  res.json({
    ...branchOptions,
    staff: staff
      .filter((member) => member.active && member.pinEnabled)
      .map((member) => ({
        id: member.id,
        tenantId: member.tenantId,
        branchId: member.branchId,
        name: member.name,
        email: member.email,
        role: member.role,
        pinEnabled: member.pinEnabled,
        active: member.active
      }))
  });
});

authRouter.get("/bootstrap/staff/:staffId", async (req, res) => {
  const bootstrap = await pinBootstrapForStaffId(req.params.staffId);

  if (!bootstrap) {
    res.status(404).json({ error: "PIN-enabled staff not found" });
    return;
  }

  res.json(bootstrap);
});

authRouter.post("/pin-login", async (req, res) => {
  const parsed = authPinLoginSchema.safeParse(req.body);

  if (!parsed.success) {
    res.status(400).json({ error: "Invalid PIN login payload", issues: parsed.error.flatten() });
    return;
  }

  const result = await loginWithPin(parsed.data, requestMeta(req));
  if (result.status === "invalid_credentials") {
    res.status(result.reason === "account_locked" ? 429 : 401).json({
      error: result.reason === "account_locked" ? "Account temporarily locked" : "Invalid credentials",
      ...(process.env.NODE_ENV === "production"
        ? {}
        : {
            reason: result.reason,
            lockedUntil: result.lockedUntil,
            tenantId: parsed.data.tenantId,
            branchId: parsed.data.branchId,
            terminalId: parsed.data.terminalId,
            staffId: parsed.data.staffId
          })
    });
    return;
  }

  res.json(result.auth);
});

authRouter.post("/refresh", async (req, res) => {
  const parsed = authRefreshSchema.safeParse(req.body);

  if (!parsed.success) {
    res.status(400).json({ error: "Invalid refresh payload", issues: parsed.error.flatten() });
    return;
  }

  const result = await refreshAuthSession(parsed.data.refreshToken, requestMeta(req));
  if (result.status === "invalid_refresh") {
    res.status(401).json({ error: "Invalid refresh token" });
    return;
  }

  res.json(result.auth);
});

authRouter.post("/logout", requireTenant, requireAuthenticatedUser, async (req, res) => {
  const sessionId = req.tenantContext!.sessionId;

  if (!sessionId) {
    res.status(400).json({ error: "Current auth session is required" });
    return;
  }

  const result = await revokeAuthSession(req.tenantContext!.tenantId, req.tenantContext!.userId, sessionId);
  if (result.status === "not_found") {
    res.status(404).json({ error: "Session not found" });
    return;
  }

  res.json({ session: result.session });
});

authRouter.get("/sessions", requireTenant, requirePermission("staff.manage"), async (req, res) => {
  const requestedBranchId = requestedBranch(req);
  const scope = resolveBranchScope(req.tenantContext!, requestedBranchId);
  if (scope.forbidden || (!canAccessAllBranches(req.tenantContext!) && !scope.branchId)) {
    res.status(403).json({ error: "Branch access denied" });
    return;
  }

  const sessions = await listAuthSessions(req.tenantContext!.tenantId, scope.branchId);
  res.json({ sessions });
});

authRouter.post("/sessions/:sessionId/revoke", requireTenant, requirePermission("staff.manage"), async (req, res) => {
  const requestedBranchId = requestedBranch(req);
  const scope = resolveBranchScope(req.tenantContext!, requestedBranchId);
  if (scope.forbidden || (!canAccessAllBranches(req.tenantContext!) && !scope.branchId)) {
    res.status(403).json({ error: "Branch access denied" });
    return;
  }

  const result = await revokeAuthSession(req.tenantContext!.tenantId, req.tenantContext!.userId, req.params.sessionId.toString(), scope.branchId);

  if (result.status === "not_found") {
    res.status(404).json({ error: "Session not found" });
    return;
  }

  res.json({ session: result.session });
});
