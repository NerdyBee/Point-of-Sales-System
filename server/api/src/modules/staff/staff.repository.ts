import type { Prisma, StaffMember as DbStaffMember } from "@prisma/client";
import { appendAudit, branches, demoSecretHash, demoTenants, staffMembers } from "../../shared/data/demoStore";
import type { StaffMember } from "../../shared/data/demoStore";
import { prisma } from "../../shared/db/prisma";
import { getRolePermissions } from "../roles/roles.repository";

const useDemoStore = process.env.NODE_ENV === "test";

type StaffInput = {
  branchId: string;
  name: string;
  email: string;
  phone: string;
  role: StaffMember["role"];
  pinEnabled: boolean;
  active: boolean;
};

type StaffPatchInput = Partial<StaffInput>;
type ProfileSecurityInput = {
  currentPassword: string;
  newPassword?: string;
  newPin?: string;
  pinEnabled?: boolean;
};
type StaffSecurityInput = {
  temporaryPassword?: string;
  pin?: string;
  pinEnabled?: boolean;
  reason: string;
};

function nextInviteExpiry() {
  return new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
}

function codeFromWords(value: string) {
  const words = value
    .normalize("NFKC")
    .replace(/[^a-z0-9\s-]/gi, " ")
    .split(/[\s-]+/)
    .filter(Boolean);
  const code = words.length >= 3
    ? words.slice(0, 3).map((word) => word[0]).join("")
    : (words[0] ?? value).slice(0, 3);
  return code.padEnd(3, "X").slice(0, 3).toUpperCase();
}

function codeFromFirstWord(value: string) {
  const firstWord = value
    .normalize("NFKC")
    .replace(/[^a-z0-9\s-]/gi, " ")
    .split(/[\s-]+/)
    .filter(Boolean)[0] ?? value;
  return firstWord.padEnd(3, "X").slice(0, 3).toUpperCase();
}

async function nextStaffId(tenantId: string, branchId: string, staffName: string) {
  const tenantName = useDemoStore
    ? demoTenants.find((tenant) => tenant.id === tenantId)?.name ?? tenantId
    : (await prisma.tenant.findUnique({ where: { id: tenantId }, select: { name: true } }))?.name ?? tenantId;
  const branchName = useDemoStore
    ? branches.find((branch) => branch.tenantId === tenantId && branch.id === branchId)?.name ?? branchId
    : (await prisma.branch.findFirst({ where: { tenantId, id: branchId }, select: { name: true } }))?.name ?? branchId;
  const baseId = `${codeFromWords(tenantName)}-${codeFromFirstWord(branchName)}-${codeFromFirstWord(staffName)}`;

  for (let index = 0; index < 100; index += 1) {
    const candidate = index === 0 ? baseId : `${baseId}${String(index + 1).padStart(2, "0")}`;
    const exists = useDemoStore
      ? staffMembers.some((member) => member.id === candidate)
      : Boolean(await prisma.staffMember.findUnique({ where: { id: candidate }, select: { id: true } }));
    if (!exists) return candidate;
  }

  return `${baseId}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
}

function nextAuditId() {
  return `audit-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function hashSecret(secret: string) {
  return demoSecretHash(secret);
}

function toApiStaff(member: DbStaffMember): StaffMember {
  return {
    id: member.id,
    tenantId: member.tenantId,
    branchId: member.branchId,
    name: member.name,
    email: member.email,
    phone: member.phone,
    role: member.role as StaffMember["role"],
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

async function serializeStaff(member: StaffMember) {
  const inviteStatus =
    member.inviteStatus === "pending" && member.inviteExpiresAt && new Date(member.inviteExpiresAt).getTime() < Date.now()
      ? "expired"
      : member.inviteStatus;

  return {
    ...member,
    inviteStatus,
    permissions: await getRolePermissions(member.tenantId, member.role)
  };
}

async function branchBelongsToTenant(tenantId: string, branchId: string) {
  if (useDemoStore) {
    return branches.some((branch) => branch.tenantId === tenantId && branch.id === branchId);
  }

  const branch = await prisma.branch.findFirst({ where: { tenantId, id: branchId }, select: { id: true } });
  return Boolean(branch);
}

function staffBranchFilter(branchId?: string) {
  return branchId ? { branchId } : {};
}

async function appendStaffAudit(event: Parameters<typeof appendAudit>[0]) {
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

export async function listStaff(tenantId: string, branchId?: string) {
  if (useDemoStore) {
    return await Promise.all(staffMembers
      .filter((member) => member.tenantId === tenantId && (branchId ? member.branchId === branchId : true))
      .map(serializeStaff));
  }

  const staff = await prisma.staffMember.findMany({
    where: { tenantId, branchId: branchId ? branchId : undefined },
    orderBy: { name: "asc" }
  });

  return await Promise.all(staff.map((member) => serializeStaff(toApiStaff(member))));
}

export async function listStaffOptions(tenantId: string, branchId?: string) {
  const staff = await listStaff(tenantId, branchId);
  return staff
    .filter((member) => member.active)
    .map((member) => ({
      id: member.id,
      tenantId: member.tenantId,
      branchId: member.branchId,
      name: member.name,
      email: member.email,
      role: member.role,
      pinEnabled: member.pinEnabled,
      active: member.active
    }));
}

export async function getStaffProfile(tenantId: string, staffId: string) {
  if (useDemoStore) {
    const member = staffMembers.find((staff) => staff.tenantId === tenantId && staff.id === staffId);
    return member ? await serializeStaff(member) : null;
  }

  const member = await prisma.staffMember.findFirst({ where: { tenantId, id: staffId } });
  return member ? await serializeStaff(toApiStaff(member)) : null;
}

export async function updateOwnProfile(tenantId: string, userId: string, input: Pick<StaffInput, "name" | "email" | "phone">) {
  if (useDemoStore) {
    const staffIndex = staffMembers.findIndex((member) => member.tenantId === tenantId && member.id === userId);

    if (staffIndex === -1) return { status: "not_found" as const };

    const duplicateEmail = staffMembers.some((member) => member.tenantId === tenantId && member.email === input.email && member.id !== userId);
    if (duplicateEmail) return { status: "duplicate_email" as const };

    const member = { ...staffMembers[staffIndex], ...input };
    staffMembers[staffIndex] = member;
    appendAudit({
      tenantId,
      branchId: member.branchId,
      userId,
      action: "staff.updated",
      entityType: "staff",
      entityId: member.id,
      metadata: { fields: Object.keys(input), source: "profile" }
    });

    return { status: "updated" as const, staff: await serializeStaff(member) };
  }

  const existingStaff = await prisma.staffMember.findFirst({ where: { tenantId, id: userId } });
  if (!existingStaff) return { status: "not_found" as const };

  const duplicateEmail = await prisma.staffMember.findFirst({ where: { tenantId, email: input.email, id: { not: userId } } });
  if (duplicateEmail) return { status: "duplicate_email" as const };

  const member = await prisma.staffMember.update({
    where: { id: userId },
    data: {
      name: input.name,
      email: input.email,
      phone: input.phone
    }
  });

  await appendStaffAudit({
    tenantId,
    branchId: member.branchId,
    userId,
    action: "staff.updated",
    entityType: "staff",
    entityId: member.id,
    metadata: { fields: Object.keys(input), source: "profile" }
  });

  return { status: "updated" as const, staff: await serializeStaff(toApiStaff(member)) };
}

export async function updateOwnSecurity(tenantId: string, userId: string, input: ProfileSecurityInput) {
  const newPassword = input.newPassword?.trim();
  const newPin = input.newPin?.trim();
  const pinEnabled = input.pinEnabled;

  if (useDemoStore) {
    const staffIndex = staffMembers.findIndex((member) => member.tenantId === tenantId && member.id === userId);

    if (staffIndex === -1) return { status: "not_found" as const };

    const member = staffMembers[staffIndex] as StaffMember & { passwordHash?: string; pinHash?: string };
    if (!member.passwordHash || member.passwordHash !== hashSecret(input.currentPassword)) return { status: "password_mismatch" as const };
    if (pinEnabled === true && !newPin) return { status: "pin_required" as const };

    const changedFields: string[] = [];
    const updatedMember = { ...member };
    if (newPassword) {
      updatedMember.passwordHash = hashSecret(newPassword);
      changedFields.push("password");
    }
    if (newPin) {
      updatedMember.pinHash = hashSecret(newPin);
      updatedMember.pinEnabled = true;
      changedFields.push("pin");
    } else if (pinEnabled === false) {
      updatedMember.pinHash = undefined;
      updatedMember.pinEnabled = false;
      changedFields.push("pin_disabled");
    }

    staffMembers[staffIndex] = updatedMember;
    appendAudit({
      tenantId,
      branchId: updatedMember.branchId,
      userId,
      action: "staff.security_updated",
      entityType: "staff",
      entityId: updatedMember.id,
      metadata: { fields: changedFields }
    });

    return { status: "updated" as const, staff: await serializeStaff(updatedMember) };
  }

  const existingStaff = await prisma.staffMember.findFirst({ where: { tenantId, id: userId } });
  if (!existingStaff) return { status: "not_found" as const };
  if (!existingStaff.passwordHash || existingStaff.passwordHash !== hashSecret(input.currentPassword)) return { status: "password_mismatch" as const };
  if (pinEnabled === true && !newPin) return { status: "pin_required" as const };

  const changedFields: string[] = [];
  const data: Prisma.StaffMemberUpdateInput = {};
  if (newPassword) {
    data.passwordHash = hashSecret(newPassword);
    changedFields.push("password");
  }
  if (newPin) {
    data.pinHash = hashSecret(newPin);
    data.pinEnabled = true;
    changedFields.push("pin");
  } else if (pinEnabled === false) {
    data.pinHash = null;
    data.pinEnabled = false;
    changedFields.push("pin_disabled");
  }

  const member = await prisma.staffMember.update({
    where: { id: userId },
    data
  });

  await appendStaffAudit({
    tenantId,
    branchId: member.branchId,
    userId,
    action: "staff.security_updated",
    entityType: "staff",
    entityId: member.id,
    metadata: { fields: changedFields }
  });

  return { status: "updated" as const, staff: await serializeStaff(toApiStaff(member)) };
}

export async function createStaff(tenantId: string, userId: string, input: StaffInput) {
  const validBranch = await branchBelongsToTenant(tenantId, input.branchId);

  if (!validBranch) return { status: "branch_not_found" as const };

  if (useDemoStore) {
    const duplicateEmail = staffMembers.some((member) => member.tenantId === tenantId && member.email === input.email);

    if (duplicateEmail) return { status: "duplicate_email" as const };

    const member = {
      id: await nextStaffId(tenantId, input.branchId, input.name),
      tenantId,
      branchId: input.branchId,
      name: input.name,
      email: input.email,
      phone: input.phone,
      role: input.role,
      pinEnabled: input.pinEnabled,
      active: false,
      salesTotal: 0,
      inviteStatus: "pending" as const,
      invitedAt: new Date().toISOString(),
      invitedBy: userId,
      inviteExpiresAt: nextInviteExpiry().toISOString(),
      createdAt: new Date().toISOString()
    };

    staffMembers.unshift(member);
    appendAudit({
      tenantId,
      branchId: member.branchId,
      userId,
      action: "staff.created",
      entityType: "staff",
      entityId: member.id,
      metadata: { role: member.role, active: member.active, inviteStatus: member.inviteStatus }
    });

    return { status: "created" as const, staff: await serializeStaff(member) };
  }

  const duplicateEmail = await prisma.staffMember.findFirst({ where: { tenantId, email: input.email } });

  if (duplicateEmail) return { status: "duplicate_email" as const };

  const member = await prisma.staffMember.create({
    data: {
      id: await nextStaffId(tenantId, input.branchId, input.name),
      tenantId,
      branchId: input.branchId,
      name: input.name,
      email: input.email,
      phone: input.phone,
      role: input.role,
      pinEnabled: input.pinEnabled,
      active: false,
      salesTotal: 0,
      inviteStatus: "pending",
      invitedAt: new Date(),
      invitedBy: userId,
      inviteExpiresAt: nextInviteExpiry()
    }
  });

  await appendStaffAudit({
    tenantId,
    branchId: member.branchId,
    userId,
    action: "staff.created",
    entityType: "staff",
    entityId: member.id,
    metadata: { role: member.role, active: member.active, inviteStatus: member.inviteStatus }
  });

  return { status: "created" as const, staff: await serializeStaff(toApiStaff(member)) };
}

export async function updateStaff(tenantId: string, requestBranchId: string | undefined, userId: string, staffId: string, input: StaffPatchInput) {
  if (input.branchId) {
    const validBranch = await branchBelongsToTenant(tenantId, input.branchId);

    if (!validBranch) return { status: "branch_not_found" as const };
  }

  if (useDemoStore) {
    const staffIndex = staffMembers.findIndex(
      (member) => member.tenantId === tenantId && member.id === staffId && (!requestBranchId || member.branchId === requestBranchId)
    );

    if (staffIndex === -1) return { status: "not_found" as const };

    if (input.email) {
      const duplicateEmail = staffMembers.some((member) => member.tenantId === tenantId && member.email === input.email && member.id !== staffId);

      if (duplicateEmail) return { status: "duplicate_email" as const };
    }

    const member = { ...staffMembers[staffIndex], ...input };
    staffMembers[staffIndex] = member;
    appendAudit({
      tenantId,
      branchId: member.branchId,
      userId,
      action: "staff.updated",
      entityType: "staff",
      entityId: member.id,
      metadata: { fields: Object.keys(input), role: member.role }
    });

    return { status: "updated" as const, staff: await serializeStaff(member) };
  }

  const existingStaff = await prisma.staffMember.findFirst({ where: { tenantId, id: staffId, ...staffBranchFilter(requestBranchId) } });

  if (!existingStaff) return { status: "not_found" as const };

  if (input.email) {
    const duplicateEmail = await prisma.staffMember.findFirst({
      where: { tenantId, email: input.email, id: { not: staffId } }
    });

    if (duplicateEmail) return { status: "duplicate_email" as const };
  }

  const member = await prisma.staffMember.update({
    where: { id: staffId },
    data: {
      branchId: input.branchId,
      name: input.name,
      email: input.email,
      phone: input.phone,
      role: input.role,
      pinEnabled: input.pinEnabled,
      active: input.active
    }
  });

  await appendStaffAudit({
    tenantId,
    branchId: member.branchId,
    userId,
    action: "staff.updated",
    entityType: "staff",
    entityId: member.id,
    metadata: { fields: Object.keys(input), role: member.role }
  });

  return { status: "updated" as const, staff: await serializeStaff(toApiStaff(member)) };
}

export async function setStaffStatus(
  tenantId: string,
  requestBranchId: string | undefined,
  userId: string,
  staffId: string,
  input: { active: boolean; reason: string }
) {
  if (staffId === userId && !input.active) return { status: "self_deactivate" as const };

  if (useDemoStore) {
    const member = staffMembers.find((item) => item.tenantId === tenantId && item.id === staffId && (!requestBranchId || item.branchId === requestBranchId));

    if (!member) return { status: "not_found" as const };

    member.active = input.active;
    if (input.active) member.inviteStatus = "accepted";
    appendAudit({
      tenantId,
      branchId: member.branchId,
      userId,
      action: "staff.status_changed",
      entityType: "staff",
      entityId: member.id,
      metadata: { active: member.active, reason: input.reason }
    });

    return { status: "updated" as const, staff: await serializeStaff(member) };
  }

  const existingStaff = await prisma.staffMember.findFirst({ where: { tenantId, id: staffId, ...staffBranchFilter(requestBranchId) } });

  if (!existingStaff) return { status: "not_found" as const };

  const member = await prisma.staffMember.update({
    where: { id: staffId },
    data: {
      active: input.active,
      inviteStatus: input.active ? "accepted" : existingStaff.inviteStatus
    }
  });

  await appendStaffAudit({
    tenantId,
    branchId: member.branchId,
    userId,
    action: "staff.status_changed",
    entityType: "staff",
    entityId: member.id,
    metadata: { active: member.active, reason: input.reason }
  });

  return { status: "updated" as const, staff: await serializeStaff(toApiStaff(member)) };
}

export async function updateStaffSecurity(
  tenantId: string,
  requestBranchId: string | undefined,
  userId: string,
  staffId: string,
  input: StaffSecurityInput
) {
  if (staffId === userId && input.temporaryPassword) return { status: "self_password_reset" as const };

  const temporaryPassword = input.temporaryPassword?.trim();
  const pin = input.pin?.trim();
  if (input.pinEnabled === true && !pin) return { status: "pin_required" as const };

  if (useDemoStore) {
    const member = staffMembers.find((item) => item.tenantId === tenantId && item.id === staffId && (!requestBranchId || item.branchId === requestBranchId)) as (StaffMember & { passwordHash?: string; pinHash?: string }) | undefined;

    if (!member) return { status: "not_found" as const };

    const changedFields: string[] = [];
    if (temporaryPassword) {
      member.passwordHash = hashSecret(temporaryPassword);
      member.inviteStatus = "accepted";
      member.active = true;
      changedFields.push("temporary_password");
    }
    if (pin) {
      member.pinHash = hashSecret(pin);
      member.pinEnabled = true;
      changedFields.push("pin");
    } else if (input.pinEnabled === false) {
      member.pinHash = undefined;
      member.pinEnabled = false;
      changedFields.push("pin_disabled");
    }

    appendAudit({
      tenantId,
      branchId: member.branchId,
      userId,
      action: "staff.security_reset",
      entityType: "staff",
      entityId: member.id,
      metadata: { fields: changedFields, reason: input.reason }
    });

    return { status: "updated" as const, staff: await serializeStaff(member) };
  }

  const existingStaff = await prisma.staffMember.findFirst({ where: { tenantId, id: staffId, ...staffBranchFilter(requestBranchId) } });
  if (!existingStaff) return { status: "not_found" as const };

  const changedFields: string[] = [];
  const data: Prisma.StaffMemberUpdateInput = {};
  if (temporaryPassword) {
    data.passwordHash = hashSecret(temporaryPassword);
    data.inviteStatus = "accepted";
    data.active = true;
    changedFields.push("temporary_password");
  }
  if (pin) {
    data.pinHash = hashSecret(pin);
    data.pinEnabled = true;
    changedFields.push("pin");
  } else if (input.pinEnabled === false) {
    data.pinHash = null;
    data.pinEnabled = false;
    changedFields.push("pin_disabled");
  }

  const member = await prisma.staffMember.update({
    where: { id: staffId },
    data
  });

  await appendStaffAudit({
    tenantId,
    branchId: member.branchId,
    userId,
    action: "staff.security_reset",
    entityType: "staff",
    entityId: member.id,
    metadata: { fields: changedFields, reason: input.reason }
  });

  return { status: "updated" as const, staff: await serializeStaff(toApiStaff(member)) };
}

export async function resendStaffInvite(tenantId: string, requestBranchId: string | undefined, userId: string, staffId: string) {
  if (useDemoStore) {
    const member = staffMembers.find((item) => item.tenantId === tenantId && item.id === staffId && (!requestBranchId || item.branchId === requestBranchId));

    if (!member) return { status: "not_found" as const };

    member.inviteStatus = "pending";
    member.active = false;
    member.invitedAt = new Date().toISOString();
    member.invitedBy = userId;
    member.inviteExpiresAt = nextInviteExpiry().toISOString();
    appendAudit({
      tenantId,
      branchId: member.branchId,
      userId,
      action: "staff.invite_resent",
      entityType: "staff",
      entityId: member.id,
      metadata: { inviteExpiresAt: member.inviteExpiresAt }
    });

    return { status: "resent" as const, staff: await serializeStaff(member) };
  }

  const existingStaff = await prisma.staffMember.findFirst({ where: { tenantId, id: staffId, ...staffBranchFilter(requestBranchId) } });

  if (!existingStaff) return { status: "not_found" as const };

  const inviteExpiresAt = nextInviteExpiry();
  const member = await prisma.staffMember.update({
    where: { id: staffId },
    data: {
      inviteStatus: "pending",
      active: false,
      invitedAt: new Date(),
      invitedBy: userId,
      inviteExpiresAt
    }
  });

  await appendStaffAudit({
    tenantId,
    branchId: member.branchId,
    userId,
    action: "staff.invite_resent",
    entityType: "staff",
    entityId: member.id,
    metadata: { inviteExpiresAt: inviteExpiresAt.toISOString() }
  });

  return { status: "resent" as const, staff: await serializeStaff(toApiStaff(member)) };
}

export async function revokeStaffInvite(tenantId: string, requestBranchId: string | undefined, userId: string, staffId: string) {
  if (staffId === userId) return { status: "self_revoke" as const };

  if (useDemoStore) {
    const member = staffMembers.find((item) => item.tenantId === tenantId && item.id === staffId && (!requestBranchId || item.branchId === requestBranchId));

    if (!member) return { status: "not_found" as const };

    member.inviteStatus = "revoked";
    member.active = false;
    member.inviteExpiresAt = undefined;
    appendAudit({
      tenantId,
      branchId: member.branchId,
      userId,
      action: "staff.invite_revoked",
      entityType: "staff",
      entityId: member.id,
      metadata: { role: member.role }
    });

    return { status: "revoked" as const, staff: await serializeStaff(member) };
  }

  const existingStaff = await prisma.staffMember.findFirst({ where: { tenantId, id: staffId, ...staffBranchFilter(requestBranchId) } });

  if (!existingStaff) return { status: "not_found" as const };

  const member = await prisma.staffMember.update({
    where: { id: staffId },
    data: {
      inviteStatus: "revoked",
      active: false,
      inviteExpiresAt: null
    }
  });

  await appendStaffAudit({
    tenantId,
    branchId: member.branchId,
    userId,
    action: "staff.invite_revoked",
    entityType: "staff",
    entityId: member.id,
    metadata: { role: member.role }
  });

  return { status: "revoked" as const, staff: await serializeStaff(toApiStaff(member)) };
}
