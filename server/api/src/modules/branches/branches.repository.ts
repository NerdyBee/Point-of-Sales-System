import type { Branch as DbBranch, Prisma, Terminal as DbTerminal } from "@prisma/client";
import { appendAudit, branches, demoTenants, tenantSubscriptions, terminals } from "../../shared/data/demoStore";
import type { BranchProfile, TerminalDevice } from "../../shared/data/demoStore";
import { prisma } from "../../shared/db/prisma";
import { planCatalog } from "../subscriptions/subscriptions.repository";

const useDemoStore = process.env.NODE_ENV === "test";

type BranchInput = {
  name: string;
  address: string;
  city: string;
  phone: string;
  status: BranchProfile["status"];
};

type TerminalInput = {
  branchId: string;
  name: string;
  deviceCode: string;
  status: TerminalDevice["status"];
  appVersion: string;
};

function slug(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "").slice(0, 40) || "branch";
}

function nextBranchId(name: string) {
  return `branch-${slug(name)}-${Date.now().toString(36)}`;
}

function nextTerminalId() {
  return `terminal-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
}

function nextAuditId() {
  return `audit-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function readDefaultBranchId(settings: Prisma.JsonValue | unknown) {
  if (settings && typeof settings === "object" && "defaultBranchId" in settings) {
    const value = (settings as { defaultBranchId?: unknown }).defaultBranchId;
    return typeof value === "string" ? value : undefined;
  }

  return undefined;
}

async function getTenantBranchPolicy(tenantId: string) {
  if (useDemoStore) {
    const tenant = demoTenants.find((item) => item.id === tenantId);
    const subscription = tenantSubscriptions.find((item) => item.tenantId === tenantId);
    const plan = tenant?.plan && tenant.plan in planCatalog ? tenant.plan : "Professional";
    return tenant ? { branchLimit: tenant.branchLimit, terminalLimit: subscription?.terminalLimit ?? planCatalog[plan].terminalLimit, defaultBranchId: tenant.settings.defaultBranchId } : null;
  }

  const [tenant, subscription] = await Promise.all([
    prisma.tenant.findUnique({ where: { id: tenantId }, select: { branchLimit: true, settings: true, plan: true } }),
    prisma.tenantSubscription.findUnique({ where: { tenantId }, select: { terminalLimit: true } })
  ]);
  const plan = tenant?.plan && tenant.plan in planCatalog ? tenant.plan as keyof typeof planCatalog : "Professional";
  return tenant ? { branchLimit: tenant.branchLimit, terminalLimit: subscription?.terminalLimit ?? planCatalog[plan].terminalLimit, defaultBranchId: readDefaultBranchId(tenant.settings) } : null;
}

async function countActiveBranches(tenantId: string) {
  if (useDemoStore) {
    return branches.filter((branch) => branch.tenantId === tenantId && branch.status === "active").length;
  }

  return prisma.branch.count({ where: { tenantId, status: "active" } });
}

async function countTerminals(tenantId: string) {
  if (useDemoStore) {
    return terminals.filter((terminal) => terminal.tenantId === tenantId).length;
  }

  return prisma.terminal.count({ where: { tenantId } });
}

function toApiBranch(branch: DbBranch): BranchProfile {
  return {
    id: branch.id,
    tenantId: branch.tenantId,
    name: branch.name,
    address: branch.address,
    city: branch.city,
    phone: branch.phone,
    status: branch.status as BranchProfile["status"],
    createdAt: branch.createdAt.toISOString()
  };
}

function toApiTerminal(terminal: DbTerminal): TerminalDevice {
  return {
    id: terminal.id,
    tenantId: terminal.tenantId,
    branchId: terminal.branchId,
    name: terminal.name,
    deviceCode: terminal.deviceCode,
    status: terminal.status as TerminalDevice["status"],
    appVersion: terminal.appVersion,
    lastSeenAt: terminal.lastSeenAt?.toISOString(),
    createdAt: terminal.createdAt.toISOString()
  };
}

async function appendBranchAudit(event: Parameters<typeof appendAudit>[0]) {
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

async function updateTenantBranchCount(tenantId: string) {
  if (useDemoStore) {
    const activeBranches = branches.filter((branch) => branch.tenantId === tenantId && branch.status === "active").length;
    const tenant = demoTenants.find((item) => item.id === tenantId);
    if (tenant) tenant.activeBranches = activeBranches;
    return activeBranches;
  }

  const activeBranches = await prisma.branch.count({ where: { tenantId, status: "active" } });
  await prisma.tenant.update({ where: { id: tenantId }, data: { activeBranches } });
  return activeBranches;
}

export async function listBranches(tenantId: string) {
  if (useDemoStore) {
    return {
      branches: branches.filter((branch) => branch.tenantId === tenantId),
      terminals: terminals.filter((terminal) => terminal.tenantId === tenantId)
    };
  }

  const [dbBranches, dbTerminals] = await Promise.all([
    prisma.branch.findMany({ where: { tenantId }, orderBy: { name: "asc" } }),
    prisma.terminal.findMany({ where: { tenantId }, orderBy: [{ branchId: "asc" }, { name: "asc" }] })
  ]);

  return {
    branches: dbBranches.map(toApiBranch),
    terminals: dbTerminals.map(toApiTerminal)
  };
}

export async function listBranchOptions(tenantId: string) {
  const result = await listBranches(tenantId);
  return {
    branches: result.branches.map((branch) => ({
      id: branch.id,
      tenantId: branch.tenantId,
      name: branch.name,
      city: branch.city,
      status: branch.status
    })),
    terminals: result.terminals.map((terminal) => ({
      id: terminal.id,
      tenantId: terminal.tenantId,
      branchId: terminal.branchId,
      name: terminal.name,
      deviceCode: terminal.deviceCode,
      status: terminal.status,
      appVersion: terminal.appVersion,
      lastSeenAt: terminal.lastSeenAt
    }))
  };
}

export async function createBranch(tenantId: string, userId: string, input: BranchInput) {
  if (useDemoStore) {
    const duplicateName = branches.some((branch) => branch.tenantId === tenantId && branch.name.toLowerCase() === input.name.toLowerCase());
    if (duplicateName) return { status: "duplicate_name" as const };

    const policy = await getTenantBranchPolicy(tenantId);
    const activeBranchCount = await countActiveBranches(tenantId);
    if (input.status === "active" && policy && activeBranchCount >= policy.branchLimit) {
      return { status: "branch_limit_reached" as const };
    }

    const branch: BranchProfile = {
      id: nextBranchId(input.name),
      tenantId,
      ...input,
      createdAt: new Date().toISOString()
    };

    branches.unshift(branch);
    await appendBranchAudit({
      tenantId,
      branchId: branch.id,
      userId,
      action: "branch.created",
      entityType: "branch",
      entityId: branch.id,
      metadata: { name: branch.name, status: branch.status }
    });
    await updateTenantBranchCount(tenantId);

    return { status: "created" as const, branch };
  }

  const duplicateName = await prisma.branch.findFirst({ where: { tenantId, name: input.name } });
  if (duplicateName) return { status: "duplicate_name" as const };

  const policy = await getTenantBranchPolicy(tenantId);
  const activeBranchCount = await countActiveBranches(tenantId);
  if (input.status === "active" && policy && activeBranchCount >= policy.branchLimit) {
    return { status: "branch_limit_reached" as const };
  }

  const branch = await prisma.branch.create({ data: { id: nextBranchId(input.name), tenantId, ...input } });
  await appendBranchAudit({
    tenantId,
    branchId: branch.id,
    userId,
    action: "branch.created",
    entityType: "branch",
    entityId: branch.id,
    metadata: { name: branch.name, status: branch.status }
  });
  await updateTenantBranchCount(tenantId);

  return { status: "created" as const, branch: toApiBranch(branch) };
}

export async function updateBranch(tenantId: string, userId: string, branchId: string, input: Partial<BranchInput>) {
  if (useDemoStore) {
    const branchIndex = branches.findIndex((branch) => branch.tenantId === tenantId && branch.id === branchId);
    if (branchIndex === -1) return { status: "not_found" as const };

    if (input.name) {
      const duplicateName = branches.some((branch) => branch.tenantId === tenantId && branch.id !== branchId && branch.name.toLowerCase() === input.name!.toLowerCase());
      if (duplicateName) return { status: "duplicate_name" as const };
    }

    const existingBranch = branches[branchIndex];
    const nextStatus = input.status ?? existingBranch.status;
    const policy = await getTenantBranchPolicy(tenantId);
    if (nextStatus === "paused" && policy?.defaultBranchId === branchId) {
      return { status: "default_branch_required" as const };
    }

    if (existingBranch.status !== "active" && nextStatus === "active" && policy && await countActiveBranches(tenantId) >= policy.branchLimit) {
      return { status: "branch_limit_reached" as const };
    }

    if (existingBranch.status === "active" && nextStatus === "paused" && terminals.some((terminal) => terminal.tenantId === tenantId && terminal.branchId === branchId && terminal.status === "online")) {
      return { status: "online_terminals_attached" as const };
    }

    const branch = { ...branches[branchIndex], ...input };
    branches[branchIndex] = branch;
    await appendBranchAudit({
      tenantId,
      branchId,
      userId,
      action: "branch.updated",
      entityType: "branch",
      entityId: branchId,
      metadata: { fields: Object.keys(input), status: branch.status }
    });
    await updateTenantBranchCount(tenantId);

    return { status: "updated" as const, branch };
  }

  const existingBranch = await prisma.branch.findFirst({ where: { tenantId, id: branchId } });
  if (!existingBranch) return { status: "not_found" as const };

  if (input.name) {
    const duplicateName = await prisma.branch.findFirst({ where: { tenantId, name: input.name, id: { not: branchId } } });
    if (duplicateName) return { status: "duplicate_name" as const };
  }

  const nextStatus = input.status ?? (existingBranch.status as BranchProfile["status"]);
  const policy = await getTenantBranchPolicy(tenantId);
  if (nextStatus === "paused" && policy?.defaultBranchId === branchId) {
    return { status: "default_branch_required" as const };
  }

  if (existingBranch.status !== "active" && nextStatus === "active" && policy && await countActiveBranches(tenantId) >= policy.branchLimit) {
    return { status: "branch_limit_reached" as const };
  }

  if (existingBranch.status === "active" && nextStatus === "paused") {
    const onlineTerminals = await prisma.terminal.count({ where: { tenantId, branchId, status: "online" } });
    if (onlineTerminals > 0) return { status: "online_terminals_attached" as const };
  }

  const branch = await prisma.branch.update({ where: { id: branchId }, data: input });
  await appendBranchAudit({
    tenantId,
    branchId,
    userId,
    action: "branch.updated",
    entityType: "branch",
    entityId: branchId,
    metadata: { fields: Object.keys(input), status: branch.status }
  });
  await updateTenantBranchCount(tenantId);

  return { status: "updated" as const, branch: toApiBranch(branch) };
}

export async function createTerminal(tenantId: string, userId: string, input: TerminalInput) {
  if (useDemoStore) {
    const branch = branches.find((item) => item.tenantId === tenantId && item.id === input.branchId);
    if (!branch) return { status: "branch_not_found" as const };
    if (input.status === "online" && branch.status !== "active") return { status: "branch_not_active" as const };

    const policy = await getTenantBranchPolicy(tenantId);
    if (policy && await countTerminals(tenantId) >= policy.terminalLimit) return { status: "terminal_limit_reached" as const };

    const duplicateDeviceCode = terminals.some((terminal) => terminal.tenantId === tenantId && terminal.deviceCode === input.deviceCode);
    if (duplicateDeviceCode) return { status: "duplicate_device_code" as const };

    const terminal: TerminalDevice = {
      id: nextTerminalId(),
      tenantId,
      ...input,
      lastSeenAt: input.status === "online" ? new Date().toISOString() : undefined,
      createdAt: new Date().toISOString()
    };

    terminals.unshift(terminal);
    await appendBranchAudit({
      tenantId,
      branchId: terminal.branchId,
      userId,
      action: "terminal.created",
      entityType: "terminal",
      entityId: terminal.id,
      metadata: { deviceCode: terminal.deviceCode, status: terminal.status }
    });

    return { status: "created" as const, terminal };
  }

  const branch = await prisma.branch.findFirst({ where: { tenantId, id: input.branchId } });
  if (!branch) return { status: "branch_not_found" as const };
  if (input.status === "online" && branch.status !== "active") return { status: "branch_not_active" as const };

  const policy = await getTenantBranchPolicy(tenantId);
  if (policy && await countTerminals(tenantId) >= policy.terminalLimit) return { status: "terminal_limit_reached" as const };

  const duplicateDeviceCode = await prisma.terminal.findFirst({ where: { tenantId, deviceCode: input.deviceCode } });
  if (duplicateDeviceCode) return { status: "duplicate_device_code" as const };

  const terminal = await prisma.terminal.create({
    data: {
      id: nextTerminalId(),
      tenantId,
      ...input,
      lastSeenAt: input.status === "online" ? new Date() : null
    }
  });

  await appendBranchAudit({
    tenantId,
    branchId: terminal.branchId,
    userId,
    action: "terminal.created",
    entityType: "terminal",
    entityId: terminal.id,
    metadata: { deviceCode: terminal.deviceCode, status: terminal.status }
  });

  return { status: "created" as const, terminal: toApiTerminal(terminal) };
}

export async function updateTerminal(tenantId: string, userId: string, terminalId: string, input: Partial<TerminalInput>, requestBranchId?: string) {
  if (useDemoStore) {
    const terminalIndex = terminals.findIndex((terminal) =>
      terminal.tenantId === tenantId &&
      terminal.id === terminalId &&
      (!requestBranchId || terminal.branchId === requestBranchId)
    );
    if (terminalIndex === -1) return { status: "not_found" as const };

    const nextBranchId = input.branchId ?? terminals[terminalIndex].branchId;
    const branch = branches.find((item) => item.tenantId === tenantId && item.id === nextBranchId);
    if (!branch) {
      return { status: "branch_not_found" as const };
    }

    const nextStatus = input.status ?? terminals[terminalIndex].status;
    if (nextStatus === "online" && branch.status !== "active") return { status: "branch_not_active" as const };

    if (input.deviceCode) {
      const duplicateDeviceCode = terminals.some((terminal) => terminal.tenantId === tenantId && terminal.id !== terminalId && terminal.deviceCode === input.deviceCode);
      if (duplicateDeviceCode) return { status: "duplicate_device_code" as const };
    }

    const terminal = {
      ...terminals[terminalIndex],
      ...input,
      lastSeenAt: input.status === "online" ? new Date().toISOString() : terminals[terminalIndex].lastSeenAt
    };
    terminals[terminalIndex] = terminal;
    await appendBranchAudit({
      tenantId,
      branchId: terminal.branchId,
      userId,
      action: "terminal.updated",
      entityType: "terminal",
      entityId: terminal.id,
      metadata: { fields: Object.keys(input), status: terminal.status }
    });

    return { status: "updated" as const, terminal };
  }

  const existingTerminal = await prisma.terminal.findFirst({ where: { tenantId, id: terminalId, branchId: requestBranchId } });
  if (!existingTerminal) return { status: "not_found" as const };

  const nextBranchId = input.branchId ?? existingTerminal.branchId;
  const branch = await prisma.branch.findFirst({ where: { tenantId, id: nextBranchId } });
  if (!branch) return { status: "branch_not_found" as const };

  const nextStatus = input.status ?? (existingTerminal.status as TerminalDevice["status"]);
  if (nextStatus === "online" && branch.status !== "active") return { status: "branch_not_active" as const };

  if (input.deviceCode) {
    const duplicateDeviceCode = await prisma.terminal.findFirst({ where: { tenantId, deviceCode: input.deviceCode, id: { not: terminalId } } });
    if (duplicateDeviceCode) return { status: "duplicate_device_code" as const };
  }

  const terminal = await prisma.terminal.update({
    where: { id: terminalId },
    data: {
      ...input,
      lastSeenAt: input.status === "online" ? new Date() : undefined
    }
  });

  await appendBranchAudit({
    tenantId,
    branchId: terminal.branchId,
    userId,
    action: "terminal.updated",
    entityType: "terminal",
    entityId: terminal.id,
    metadata: { fields: Object.keys(input), status: terminal.status }
  });

  return { status: "updated" as const, terminal: toApiTerminal(terminal) };
}
