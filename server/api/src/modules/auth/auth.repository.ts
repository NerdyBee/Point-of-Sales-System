import type { AuthSession as DbAuthSession, Prisma, StaffMember as DbStaffMember } from "@prisma/client";
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { appendAudit, authSessions, demoSecretHash, staffMembers, type AuthSession, type StaffMember } from "../../shared/data/demoStore";
import { prisma } from "../../shared/db/prisma";
import { permissionsForRole } from "../../shared/http/tenantContext";

const useDemoStore = process.env.NODE_ENV === "test";
const accessTokenTtlSeconds = 15 * 60;
const refreshTokenTtlDays = 14;
const authSecret = process.env.AUTH_SECRET ?? "naijapos-dev-auth-secret";

type LoginInput = { tenantId: string; email: string; password: string; terminalId?: string };
type PinLoginInput = { tenantId: string; branchId: string; terminalId: string; staffId: string; pin: string };
type StaffShape = StaffMember & { passwordHash?: string; pinHash?: string };
type InvalidCredentialReason = "staff_not_found" | "staff_inactive_or_pending" | "password_mismatch" | "branch_mismatch" | "pin_disabled" | "pin_mismatch";

function nextSessionId() {
  return `session-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function nextAuditId() {
  return `audit-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
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

function verifySecret(secret: string, storedHash?: string | null, fallbackSecret?: string) {
  const expectedHash = storedHash || (fallbackSecret ? hashSecret(fallbackSecret) : "");
  return Boolean(expectedHash) && safeCompare(hashSecret(secret), expectedHash);
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

async function findOrCreateSeededStaff(tenantId: string, email: string) {
  const demoStaff = staffMembers.find((member) => member.tenantId === tenantId && member.email.toLowerCase() === email.toLowerCase()) as StaffShape | undefined;
  if (!demoStaff) return null;

  try {
    const createdStaff = await prisma.staffMember.create({
      data: {
        id: demoStaff.id,
        tenantId: demoStaff.tenantId,
        branchId: demoStaff.branchId,
        name: demoStaff.name,
        email: demoStaff.email,
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
      }
    });
    return toApiStaff(createdStaff);
  } catch {
    return null;
  }
}

function serializeAuthStaff(member: StaffShape) {
  return {
    id: member.id,
    tenantId: member.tenantId,
    branchId: member.branchId,
    name: member.name,
    email: member.email,
    role: member.role,
    permissions: permissionsForRole(member.role)
  };
}

function buildAuthResponse(staff: StaffShape, session: AuthSession, refreshToken: string) {
  return {
    staff: serializeAuthStaff(staff),
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
    return buildAuthResponse(staff, session, refreshToken);
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

  return buildAuthResponse(staff, toApiSession(session), refreshToken);
}

export async function loginWithPassword(input: LoginInput, meta: { userAgent?: string; ipAddress?: string }) {
  const email = input.email.toLowerCase();

  if (useDemoStore) {
    const staff = staffMembers.find((member) => member.tenantId === input.tenantId && member.email.toLowerCase() === email) as StaffShape | undefined;
    if (!staff) return { status: "invalid_credentials" as const, reason: "staff_not_found" satisfies InvalidCredentialReason };
    if (!staff.active || staff.inviteStatus !== "accepted") return { status: "invalid_credentials" as const, reason: "staff_inactive_or_pending" satisfies InvalidCredentialReason };
    if (!verifySecret(input.password, staff.passwordHash, "Password123!")) return { status: "invalid_credentials" as const, reason: "password_mismatch" satisfies InvalidCredentialReason };
    return { status: "authenticated" as const, auth: await createSession(staff, { terminalId: input.terminalId, userAgent: meta.userAgent, ipAddress: meta.ipAddress, action: "auth.login" }) };
  }

  const record = await prisma.staffMember.findFirst({ where: { tenantId: input.tenantId, email } });
  const staff = record ? toApiStaff(record) : await findOrCreateSeededStaff(input.tenantId, email);
  if (!staff) return { status: "invalid_credentials" as const, reason: "staff_not_found" satisfies InvalidCredentialReason };
  if (!staff.active || staff.inviteStatus !== "accepted") return { status: "invalid_credentials" as const, reason: "staff_inactive_or_pending" satisfies InvalidCredentialReason };
  if (!verifySecret(input.password, staff.passwordHash, "Password123!")) return { status: "invalid_credentials" as const, reason: "password_mismatch" satisfies InvalidCredentialReason };
  return { status: "authenticated" as const, auth: await createSession(staff, { terminalId: input.terminalId, userAgent: meta.userAgent, ipAddress: meta.ipAddress, action: "auth.login" }) };
}

export async function loginWithPin(input: PinLoginInput, meta: { userAgent?: string; ipAddress?: string }) {
  if (useDemoStore) {
    const staff = staffMembers.find((member) => member.tenantId === input.tenantId && member.id === input.staffId) as StaffShape | undefined;
    if (!staff) return { status: "invalid_credentials" as const, reason: "staff_not_found" satisfies InvalidCredentialReason };
    if (staff.branchId !== input.branchId) return { status: "invalid_credentials" as const, reason: "branch_mismatch" satisfies InvalidCredentialReason };
    if (!staff.active || staff.inviteStatus !== "accepted") return { status: "invalid_credentials" as const, reason: "staff_inactive_or_pending" satisfies InvalidCredentialReason };
    if (!staff.pinEnabled) return { status: "invalid_credentials" as const, reason: "pin_disabled" satisfies InvalidCredentialReason };
    if (!verifySecret(input.pin, staff.pinHash, "1234")) return { status: "invalid_credentials" as const, reason: "pin_mismatch" satisfies InvalidCredentialReason };
    return { status: "authenticated" as const, auth: await createSession(staff, { branchId: input.branchId, terminalId: input.terminalId, userAgent: meta.userAgent, ipAddress: meta.ipAddress, action: "auth.pin_login" }) };
  }

  const record = await prisma.staffMember.findFirst({ where: { tenantId: input.tenantId, id: input.staffId } });
  const staff = record ? toApiStaff(record) : null;
  if (!staff) return { status: "invalid_credentials" as const, reason: "staff_not_found" satisfies InvalidCredentialReason };
  if (staff.branchId !== input.branchId) return { status: "invalid_credentials" as const, reason: "branch_mismatch" satisfies InvalidCredentialReason };
  if (!staff.active || staff.inviteStatus !== "accepted") return { status: "invalid_credentials" as const, reason: "staff_inactive_or_pending" satisfies InvalidCredentialReason };
  if (!staff.pinEnabled) return { status: "invalid_credentials" as const, reason: "pin_disabled" satisfies InvalidCredentialReason };
  if (!verifySecret(input.pin, staff.pinHash, "1234")) return { status: "invalid_credentials" as const, reason: "pin_mismatch" satisfies InvalidCredentialReason };
  return { status: "authenticated" as const, auth: await createSession(staff, { branchId: input.branchId, terminalId: input.terminalId, userAgent: meta.userAgent, ipAddress: meta.ipAddress, action: "auth.pin_login" }) };
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
    return { status: "refreshed" as const, auth: buildAuthResponse(staff, session, refreshToken) };
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
  return { status: "refreshed" as const, auth: buildAuthResponse(staff, toApiSession(updatedSession), refreshToken) };
}

export async function listAuthSessions(tenantId: string) {
  if (useDemoStore) {
    return authSessions.filter((session) => session.tenantId === tenantId).map((session) => ({ ...session, refreshTokenHash: undefined }));
  }

  const sessions = await prisma.authSession.findMany({ where: { tenantId }, orderBy: { createdAt: "desc" } });
  return sessions.map((session) => ({ ...toApiSession(session), refreshTokenHash: undefined }));
}

export async function revokeAuthSession(tenantId: string, userId: string, sessionId: string) {
  const now = new Date().toISOString();

  if (useDemoStore) {
    const session = authSessions.find((item) => item.tenantId === tenantId && item.id === sessionId);
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

  const existing = await prisma.authSession.findFirst({ where: { tenantId, id: sessionId } });
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
