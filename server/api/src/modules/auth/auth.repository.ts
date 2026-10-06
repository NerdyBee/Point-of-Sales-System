import type { AuthSession as DbAuthSession, Prisma, StaffMember as DbStaffMember } from "@prisma/client";
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { appendAudit, authSessions, demoSecretHash, staffMembers, terminals, type AuthSession, type StaffMember } from "../../shared/data/demoStore";
import { prisma } from "../../shared/db/prisma";
import { getRolePermissions } from "../roles/roles.repository";

const useDemoStore = process.env.NODE_ENV === "test";
const accessTokenTtlSeconds = 15 * 60;
const refreshTokenTtlDays = 14;
const authSecret = process.env.AUTH_SECRET ?? "naijapos-dev-auth-secret";
const authFailureWindowMs = 15 * 60 * 1000;
const authLockoutMs = 10 * 60 * 1000;
const maxAuthFailures = 5;

type LoginInput = { tenantId?: string; identifier: string; email?: string; password: string; terminalId?: string };
type PinLoginInput = { tenantId?: string; branchId?: string; terminalId: string; staffId: string; pin: string };
type StaffShape = StaffMember & { passwordHash?: string; pinHash?: string };
type InvalidCredentialReason =
  | "staff_not_found"
  | "staff_inactive_or_pending"
  | "password_mismatch"
  | "branch_mismatch"
  | "terminal_mismatch"
  | "pin_disabled"
  | "pin_mismatch"
  | "account_locked";
type AuthAttempt = { failures: number; firstFailedAt: number; lockedUntil?: number };

const authAttempts = new Map<string, AuthAttempt>();

function nextSessionId() {
  return `session-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function nextAuditId() {
  return `audit-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function nextAuthAttemptId() {
  return `auth-attempt-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function hashSecret(secret: string) {
  return demoSecretHash(secret);
}

function randomToken() {
  return randomBytes(32).toString("base64url");
}

function safeCompare(a: string, b: string) {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

function verifySecret(secret: string, storedHash?: string | null) {
  if (!storedHash) return false;
  return safeCompare(hashSecret(secret), storedHash);
}

function normalizeLoginText(value: string) {
  return value.normalize("NFKC").replace(/[\u200B-\u200D\uFEFF]/g, "").trim();
}

function normalizeStaffId(value: string) {
  return normalizeLoginText(value).toUpperCase();
}

function authAttemptKey(kind: "password" | "pin", tenantId: string, identifier: string, ipAddress?: string) {
  return [kind, tenantId.toLowerCase(), normalizeLoginText(identifier).toLowerCase(), ipAddress ?? "unknown-ip"].join(":");
}

function lockedUntilForAttempt(key: string) {
  const attempt = authAttempts.get(key);
  if (!attempt) return null;

  const now = Date.now();
  if (attempt.lockedUntil && attempt.lockedUntil > now) return attempt.lockedUntil;
  if (attempt.lockedUntil || now - attempt.firstFailedAt > authFailureWindowMs) {
    authAttempts.delete(key);
    return null;
  }

  return null;
}

function recordFailedAttempt(key: string) {
  const now = Date.now();
  const current = authAttempts.get(key);
  const attempt = current && now - current.firstFailedAt <= authFailureWindowMs
    ? current
    : { failures: 0, firstFailedAt: now };
  attempt.failures += 1;
  if (attempt.failures >= maxAuthFailures) {
    attempt.lockedUntil = now + authLockoutMs;
  }
  authAttempts.set(key, attempt);
  return attempt.lockedUntil && attempt.lockedUntil > now ? attempt.lockedUntil : null;
}

function clearFailedAttempt(key: string) {
  authAttempts.delete(key);
}

function signAccessToken(payload: Record<string, unknown>) {
  const header = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url");
  const body = Buffer.from(JSON.stringify({ ...payload, exp: Math.floor(Date.now() / 1000) + accessTokenTtlSeconds })).toString("base64url");
  const signature = createHmac("sha256", authSecret).update(`${header}.${body}`).digest("base64url");
  return `${header}.${body}.${signature}`;
}

function toApiStaff(member: DbStaffMember): StaffShape {
  return {
    id: member.id,
    tenantId: member.tenantId,
    branchId: member.branchId,
    name: member.name,
    email: member.email,
    phone: member.phone,
    role: member.role as StaffMember["role"],
    passwordHash: member.passwordHash ?? undefined,
    pinHash: member.pinHash ?? undefined,
    pinEnabled: member.pinEnabled,
    active: member.active,
    salesTotal: member.salesTotal,
    inviteStatus: member.inviteStatus as StaffMember["inviteStatus"],
    invitedAt: member.invitedAt?.toISOString(),
    invitedBy: member.invitedBy ?? undefined,
    inviteExpiresAt: member.inviteExpiresAt?.toISOString(),
    lastSeenAt: member.lastSeenAt?.toISOString(),
    createdAt: member.createdAt.toISOString()
  };
}

function toApiSession(session: DbAuthSession): AuthSession {
  return {
    id: session.id,
    tenantId: session.tenantId,
    staffId: session.staffId,
    branchId: session.branchId ?? undefined,
    terminalId: session.terminalId ?? undefined,
    role: session.role as AuthSession["role"],
    refreshTokenHash: session.refreshTokenHash,
    userAgent: session.userAgent ?? undefined,
    ipAddress: session.ipAddress ?? undefined,
    expiresAt: session.expiresAt.toISOString(),
    revokedAt: session.revokedAt?.toISOString(),
    lastSeenAt: session.lastSeenAt?.toISOString(),
    createdAt: session.createdAt.toISOString()
  };
}

function dateOrNull(value?: string) {
  return value ? new Date(value) : null;
}

export async function findOrCreateSeededStaff(tenantId: string | undefined, identifier: string) {
  const identifierKey = normalizeLoginText(identifier).toLowerCase();
  const staffIdKey = normalizeStaffId(identifier);
  const demoStaff = staffMembers.find((member) =>
    (!tenantId || member.tenantId === tenantId) &&
    (member.email.toLowerCase() === identifierKey || member.id.toUpperCase() === staffIdKey)
  ) as StaffShape | undefined;
  if (!demoStaff) return null;

  const seededStaffData = {
    tenantId: demoStaff.tenantId,
    branchId: demoStaff.branchId,
    name: demoStaff.name,
    email: demoStaff.email.toLowerCase(),
    phone: demoStaff.phone,
    role: demoStaff.role,
    passwordHash: demoStaff.passwordHash ?? null,
    pinHash: demoStaff.pinHash ?? null,
    pinEnabled: demoStaff.pinEnabled,
    active: demoStaff.active,
    salesTotal: demoStaff.salesTotal,
    inviteStatus: demoStaff.inviteStatus,
    invitedAt: dateOrNull(demoStaff.invitedAt),
    invitedBy: demoStaff.invitedBy ?? null,
    inviteExpiresAt: dateOrNull(demoStaff.inviteExpiresAt),
    lastSeenAt: dateOrNull(demoStaff.lastSeenAt),
    createdAt: new Date(demoStaff.createdAt)
  };

  const existing = await prisma.staffMember.findFirst({
    where: {
      tenantId: demoStaff.tenantId,
      OR: [{ id: demoStaff.id }, { email: demoStaff.email.toLowerCase() }]
    }
  });

  if (existing) {
    if (existing.id !== demoStaff.id) {
      await prisma.authSession.deleteMany({ where: { staffId: existing.id } });
    }

    const updatedStaff = await prisma.staffMember.update({
      where: { id: existing.id },
      data: {
        id: demoStaff.id,
        ...seededStaffData
      }
    });
    return toApiStaff(updatedStaff);
  }

  try {
    const createdStaff = await prisma.staffMember.create({
      data: {
        id: demoStaff.id,
        ...seededStaffData
      }
    });
    return toApiStaff(createdStaff);
  } catch {
    return null;
  }
}

async function permissionsForStaff(member: StaffShape) {
  return await getRolePermissions(member.tenantId, member.role);
}

async function terminalBelongsToBranch(tenantId: string, branchId: string, terminalId?: string) {
  if (!terminalId) return true;

  if (useDemoStore) {
    return terminals.some((terminal) => terminal.tenantId === tenantId && terminal.branchId === branchId && terminal.id === terminalId);
  }

  const terminal = await prisma.terminal.findFirst({ where: { tenantId, branchId, id: terminalId } });
  return Boolean(terminal);
}

async function serializeAuthStaff(member: StaffShape) {
  return {
    id: member.id,
    tenantId: member.tenantId,
    branchId: member.branchId,
    name: member.name,
    email: member.email,
    phone: member.phone,
    role: member.role,
    permissions: await permissionsForStaff(member)
  };
}

async function buildAuthResponse(staff: StaffShape, session: AuthSession, refreshToken: string) {
  return {
    staff: await serializeAuthStaff(staff),
    session: { ...session, refreshTokenHash: undefined },
    accessToken: signAccessToken({
      tenantId: staff.tenantId,
      branchId: session.branchId ?? staff.branchId,
      staffId: staff.id,
      role: staff.role,
      sessionId: session.id
    }),
    accessTokenExpiresIn: accessTokenTtlSeconds,
    refreshToken
  };
}

async function appendAuthAudit(event: Parameters<typeof appendAudit>[0]) {
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

async function recordFailedAuthAttempt(input: {
  tenantId: string;
  branchId?: string;
  userId?: string;
  action: "auth.login_failed" | "auth.pin_login_failed";
  reason: InvalidCredentialReason;
  metadata: Record<string, unknown>;
}) {
  await appendAuthAudit({
    tenantId: input.tenantId,
    branchId: input.branchId,
    userId: input.userId ?? "unknown",
    action: input.action,
    entityType: "auth_attempt",
    entityId: nextAuthAttemptId(),
    metadata: input.metadata
  });
}

function looksLikeCompactStaffId(identifier: string) {
  return /^[A-Z0-9]{2,6}-[A-Z0-9]{2,6}-[A-Z0-9]{2,8}$/i.test(identifier.trim());
}

async function createSession(staff: StaffShape, input: { branchId?: string; terminalId?: string; userAgent?: string; ipAddress?: string; action: "auth.login" | "auth.pin_login" }) {
  const refreshToken = randomToken();
  const now = new Date();
  const expiresAt = new Date(now.getTime() + refreshTokenTtlDays * 24 * 60 * 60 * 1000);

  if (useDemoStore) {
    const session: AuthSession = {
      id: nextSessionId(),
      tenantId: staff.tenantId,
      staffId: staff.id,
      branchId: input.branchId ?? staff.branchId,
      terminalId: input.terminalId || undefined,
      role: staff.role,
      refreshTokenHash: hashSecret(refreshToken),
      userAgent: input.userAgent,
      ipAddress: input.ipAddress,
      expiresAt: expiresAt.toISOString(),
      lastSeenAt: now.toISOString(),
      createdAt: now.toISOString()
    };
    authSessions.unshift(session);
    staff.lastSeenAt = now.toISOString();
    await appendAuthAudit({
      tenantId: staff.tenantId,
      branchId: session.branchId,
      userId: staff.id,
      action: input.action,
      entityType: "auth_session",
      entityId: session.id,
      metadata: { role: staff.role, terminalId: session.terminalId }
    });
    return await buildAuthResponse(staff, session, refreshToken);
  }

  const session = await prisma.authSession.create({
    data: {
      id: nextSessionId(),
      tenantId: staff.tenantId,
      staffId: staff.id,
      branchId: input.branchId ?? staff.branchId,
      terminalId: input.terminalId || null,
      role: staff.role,
      refreshTokenHash: hashSecret(refreshToken),
      userAgent: input.userAgent || null,
      ipAddress: input.ipAddress || null,
      expiresAt,
      lastSeenAt: now
    }
  });

  await prisma.staffMember.update({ where: { id: staff.id }, data: { lastSeenAt: now } });
  await appendAuthAudit({
    tenantId: staff.tenantId,
    branchId: session.branchId ?? undefined,
    userId: staff.id,
    action: input.action,
    entityType: "auth_session",
    entityId: session.id,
    metadata: { role: staff.role, terminalId: session.terminalId }
  });

  return await buildAuthResponse(staff, toApiSession(session), refreshToken);
}

export async function loginWithPassword(input: LoginInput, meta: { userAgent?: string; ipAddress?: string }) {
  const identifier = normalizeLoginText(input.identifier || input.email || "");
  const identifierKey = identifier.toLowerCase();
  const submittedTenantId = input.tenantId?.trim();
  const auditTenantId = submittedTenantId || "unknown";
  const attemptKey = authAttemptKey("password", auditTenantId, identifierKey, meta.ipAddress);
  const fail = async (reason: InvalidCredentialReason, staff?: StaffShape) => {
    const lockedUntil = reason === "account_locked" ? lockedUntilForAttempt(attemptKey) : recordFailedAttempt(attemptKey);
    const failureTenantId = staff?.tenantId ?? submittedTenantId;
    if (failureTenantId) {
      await recordFailedAuthAttempt({
        tenantId: failureTenantId,
        branchId: staff?.branchId,
        userId: staff?.id,
        action: "auth.login_failed",
        reason,
        metadata: {
          identifier: identifierKey,
          terminalId: input.terminalId,
          reason,
          lockedUntil: lockedUntil ? new Date(lockedUntil).toISOString() : undefined,
          userAgent: meta.userAgent,
          ipAddress: meta.ipAddress
        }
      });
    }
    return { status: "invalid_credentials" as const, reason, lockedUntil: lockedUntil ? new Date(lockedUntil).toISOString() : undefined };
  };

  if (lockedUntilForAttempt(attemptKey)) return await fail("account_locked");

  if (!submittedTenantId && !looksLikeCompactStaffId(identifier)) return await fail("staff_not_found");

  if (useDemoStore) {
    const staff = staffMembers.find((member) =>
      (!submittedTenantId || member.tenantId === submittedTenantId) &&
      (member.email.toLowerCase() === identifierKey || member.id.toLowerCase() === identifierKey)
    ) as StaffShape | undefined;
    if (!staff) return await fail("staff_not_found");
    if (!staff.active || staff.inviteStatus !== "accepted") return await fail("staff_inactive_or_pending", staff);
    if (!verifySecret(input.password, staff.passwordHash)) return await fail("password_mismatch", staff);
    if (!(await terminalBelongsToBranch(staff.tenantId, staff.branchId, input.terminalId))) return await fail("terminal_mismatch", staff);
    clearFailedAttempt(attemptKey);
    return { status: "authenticated" as const, auth: await createSession(staff, { terminalId: input.terminalId, userAgent: meta.userAgent, ipAddress: meta.ipAddress, action: "auth.login" }) };
  }

  const record = await prisma.staffMember.findFirst({
    where: {
      tenantId: submittedTenantId ? submittedTenantId : undefined,
      OR: [{ email: identifierKey }, { id: identifier }]
    }
  });
  const staff = record ? toApiStaff(record) : await findOrCreateSeededStaff(submittedTenantId, identifierKey);
  if (!staff) return await fail("staff_not_found");
  if (!staff.active || staff.inviteStatus !== "accepted") return await fail("staff_inactive_or_pending", staff);
  if (!verifySecret(input.password, staff.passwordHash)) return await fail("password_mismatch", staff);
  if (!(await terminalBelongsToBranch(staff.tenantId, staff.branchId, input.terminalId))) return await fail("terminal_mismatch", staff);
  clearFailedAttempt(attemptKey);
  return { status: "authenticated" as const, auth: await createSession(staff, { terminalId: input.terminalId, userAgent: meta.userAgent, ipAddress: meta.ipAddress, action: "auth.login" }) };
}

export async function loginWithPin(input: PinLoginInput, meta: { userAgent?: string; ipAddress?: string }) {
  const submittedStaffId = normalizeStaffId(input.staffId);
  const auditTenantId = input.tenantId?.trim() || "unknown";
  const attemptKey = authAttemptKey("pin", auditTenantId, submittedStaffId, meta.ipAddress);
  const fail = async (reason: InvalidCredentialReason, staff?: StaffShape) => {
    const lockedUntil = reason === "account_locked" ? lockedUntilForAttempt(attemptKey) : recordFailedAttempt(attemptKey);
    const failureTenantId = staff?.tenantId ?? input.tenantId?.trim();
    if (failureTenantId) {
      await recordFailedAuthAttempt({
        tenantId: failureTenantId,
        branchId: staff?.branchId ?? input.branchId,
        userId: staff?.id ?? submittedStaffId,
        action: "auth.pin_login_failed",
        reason,
        metadata: {
          staffId: submittedStaffId,
          terminalId: input.terminalId,
          reason,
          lockedUntil: lockedUntil ? new Date(lockedUntil).toISOString() : undefined,
          userAgent: meta.userAgent,
          ipAddress: meta.ipAddress
        }
      });
    }
    return { status: "invalid_credentials" as const, reason, lockedUntil: lockedUntil ? new Date(lockedUntil).toISOString() : undefined };
  };

  if (lockedUntilForAttempt(attemptKey)) return await fail("account_locked");

  if (useDemoStore) {
    const staff = staffMembers.find((member) => member.id.toUpperCase() === submittedStaffId && (!input.tenantId || member.tenantId === input.tenantId)) as StaffShape | undefined;
    if (!staff) return await fail("staff_not_found");
    if (input.branchId && staff.branchId !== input.branchId) return await fail("branch_mismatch", staff);
    if (!(await terminalBelongsToBranch(staff.tenantId, staff.branchId, input.terminalId))) return await fail("terminal_mismatch", staff);
    if (!staff.active || staff.inviteStatus !== "accepted") return await fail("staff_inactive_or_pending", staff);
    if (!staff.pinEnabled) return await fail("pin_disabled", staff);
    if (!verifySecret(input.pin, staff.pinHash)) return await fail("pin_mismatch", staff);
    clearFailedAttempt(attemptKey);
    return { status: "authenticated" as const, auth: await createSession(staff, { branchId: staff.branchId, terminalId: input.terminalId, userAgent: meta.userAgent, ipAddress: meta.ipAddress, action: "auth.pin_login" }) };
  }

  const record = await prisma.staffMember.findFirst({
    where: {
      id: submittedStaffId,
      tenantId: input.tenantId ? input.tenantId : undefined
    }
  });
  const staff = record ? toApiStaff(record) : await findOrCreateSeededStaff(input.tenantId?.trim(), submittedStaffId);
  if (!staff) return await fail("staff_not_found");
  if (input.branchId && staff.branchId !== input.branchId) return await fail("branch_mismatch", staff);
  if (!(await terminalBelongsToBranch(staff.tenantId, staff.branchId, input.terminalId))) return await fail("terminal_mismatch", staff);
  if (!staff.active || staff.inviteStatus !== "accepted") return await fail("staff_inactive_or_pending", staff);
  if (!staff.pinEnabled) return await fail("pin_disabled", staff);
  if (!verifySecret(input.pin, staff.pinHash)) return await fail("pin_mismatch", staff);
  clearFailedAttempt(attemptKey);
  return { status: "authenticated" as const, auth: await createSession(staff, { branchId: staff.branchId, terminalId: input.terminalId, userAgent: meta.userAgent, ipAddress: meta.ipAddress, action: "auth.pin_login" }) };
}

export async function refreshAuthSession(refreshToken: string, meta: { userAgent?: string; ipAddress?: string }) {
  const refreshTokenHash = hashSecret(refreshToken);
  const now = new Date();

  if (useDemoStore) {
    const session = authSessions.find((item) => item.refreshTokenHash === refreshTokenHash && !item.revokedAt && new Date(item.expiresAt).getTime() > Date.now());
    if (!session) return { status: "invalid_refresh" as const };
    const staff = staffMembers.find((member) => member.tenantId === session.tenantId && member.id === session.staffId) as StaffShape | undefined;
    if (!staff || !staff.active) return { status: "invalid_refresh" as const };
    session.lastSeenAt = now.toISOString();
    await appendAuthAudit({
      tenantId: session.tenantId,
      branchId: session.branchId,
      userId: session.staffId,
      action: "auth.refresh",
      entityType: "auth_session",
      entityId: session.id,
      metadata: { userAgent: meta.userAgent, ipAddress: meta.ipAddress }
    });
    return { status: "refreshed" as const, auth: await buildAuthResponse(staff, session, refreshToken) };
  }

  const session = await prisma.authSession.findFirst({ where: { refreshTokenHash, revokedAt: null, expiresAt: { gt: now } } });
  if (!session) return { status: "invalid_refresh" as const };
  const record = await prisma.staffMember.findFirst({ where: { tenantId: session.tenantId, id: session.staffId, active: true } });
  if (!record) return { status: "invalid_refresh" as const };
  const updatedSession = await prisma.authSession.update({ where: { id: session.id }, data: { lastSeenAt: now } });
  const staff = toApiStaff(record);
  await appendAuthAudit({
    tenantId: session.tenantId,
    branchId: session.branchId ?? undefined,
    userId: session.staffId,
    action: "auth.refresh",
    entityType: "auth_session",
    entityId: session.id,
    metadata: { userAgent: meta.userAgent, ipAddress: meta.ipAddress }
  });
  return { status: "refreshed" as const, auth: await buildAuthResponse(staff, toApiSession(updatedSession), refreshToken) };
}

export async function listAuthSessions(tenantId: string, filters: { branchId?: string; branchIds?: string[] } = {}) {
  if (useDemoStore) {
    return authSessions
      .filter((session) => session.tenantId === tenantId)
      .filter((session) => {
        if (filters.branchId) return session.branchId === filters.branchId;
        if (filters.branchIds?.length) return Boolean(session.branchId && filters.branchIds.includes(session.branchId));
        return true;
      })
      .map((session) => ({ ...session, refreshTokenHash: undefined }));
  }

  const sessions = await prisma.authSession.findMany({
    where: { tenantId, branchId: filters.branchId ? filters.branchId : filters.branchIds?.length ? { in: filters.branchIds } : undefined },
    orderBy: { createdAt: "desc" }
  });
  return sessions.map((session) => ({ ...toApiSession(session), refreshTokenHash: undefined }));
}

export async function revokeAuthSession(tenantId: string, userId: string, sessionId: string, filters: { branchId?: string; branchIds?: string[] } = {}) {
  const now = new Date().toISOString();

  if (useDemoStore) {
    const session = authSessions.find((item) => {
      const branchMatch = filters.branchId
        ? item.branchId === filters.branchId
        : filters.branchIds?.length
          ? Boolean(item.branchId && filters.branchIds.includes(item.branchId))
          : true;
      return item.tenantId === tenantId && item.id === sessionId && branchMatch;
    });
    if (!session) return { status: "not_found" as const };
    session.revokedAt = now;
    await appendAuthAudit({
      tenantId,
      branchId: session.branchId,
      userId,
      action: "auth.session_revoked",
      entityType: "auth_session",
      entityId: session.id,
      metadata: { staffId: session.staffId }
    });
    return { status: "revoked" as const, session: { ...session, refreshTokenHash: undefined } };
  }

  const existing = await prisma.authSession.findFirst({
    where: { tenantId, id: sessionId, branchId: filters.branchId ? filters.branchId : filters.branchIds?.length ? { in: filters.branchIds } : undefined }
  });
  if (!existing) return { status: "not_found" as const };
  const session = await prisma.authSession.update({ where: { id: existing.id }, data: { revokedAt: new Date(now) } });
  await appendAuthAudit({
    tenantId,
    branchId: session.branchId ?? undefined,
    userId,
    action: "auth.session_revoked",
    entityType: "auth_session",
    entityId: session.id,
    metadata: { staffId: session.staffId }
  });
  return { status: "revoked" as const, session: { ...toApiSession(session), refreshTokenHash: undefined } };
}
