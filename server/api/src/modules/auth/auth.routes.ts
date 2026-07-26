import { authLoginSchema, authPinLoginSchema, authRefreshSchema } from "@pos/validation";
import { type Request, Router } from "express";
import { listBranchOptions } from "../branches/branches.repository";
import { listStaff } from "../staff/staff.repository";
import { requireAuthenticatedUser, requirePermission, requireTenant } from "../../shared/http/tenantContext";
import { listAuthSessions, loginWithPassword, loginWithPin, refreshAuthSession, revokeAuthSession } from "./auth.repository";

export const authRouter = Router();

function requestMeta(req: Request) {
  return {
    userAgent: req.header("user-agent") ?? undefined,
    ipAddress: req.ip
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
    res.status(401).json({
      error: "Invalid credentials",
      ...(process.env.NODE_ENV === "production" ? {} : { reason: result.reason, tenantId: parsed.data.tenantId, email: parsed.data.email })
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
        role: member.role,
        pinEnabled: member.pinEnabled,
        active: member.active
      }))
  });
});

authRouter.post("/pin-login", async (req, res) => {
  const parsed = authPinLoginSchema.safeParse(req.body);

  if (!parsed.success) {
    res.status(400).json({ error: "Invalid PIN login payload", issues: parsed.error.flatten() });
    return;
  }

  const result = await loginWithPin(parsed.data, requestMeta(req));
  if (result.status === "invalid_credentials") {
    res.status(401).json({
      error: "Invalid credentials",
      ...(process.env.NODE_ENV === "production"
        ? {}
        : {
            reason: result.reason,
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
  const sessions = await listAuthSessions(req.tenantContext!.tenantId);
  res.json({ sessions });
});

authRouter.post("/sessions/:sessionId/revoke", requireTenant, requirePermission("staff.manage"), async (req, res) => {
  const result = await revokeAuthSession(req.tenantContext!.tenantId, req.tenantContext!.userId, req.params.sessionId.toString());

  if (result.status === "not_found") {
    res.status(404).json({ error: "Session not found" });
    return;
  }

  res.json({ session: result.session });
});
