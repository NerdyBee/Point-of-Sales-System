import type { Prisma, SyncQueueRecord as DbSyncQueueRecord } from "@prisma/client";
import { appendAudit, branches, syncQueueRecords, terminals, type SyncQueueRecord, type SyncRecordStatus } from "../../shared/data/demoStore";
import { prisma } from "../../shared/db/prisma";

const useDemoStore = process.env.NODE_ENV === "test";

type SyncQueueInput = Pick<SyncQueueRecord, "branchId" | "terminalId" | "recordType" | "operation" | "idempotencyKey" | "payload">;

function nextSyncId() {
  return `sync-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function nextAuditId() {
  return `audit-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function toApiSyncRecord(record: DbSyncQueueRecord): SyncQueueRecord {
  return {
    id: record.id,
    tenantId: record.tenantId,
    branchId: record.branchId,
    terminalId: record.terminalId,
    recordType: record.recordType as SyncQueueRecord["recordType"],
    operation: record.operation as SyncQueueRecord["operation"],
    idempotencyKey: record.idempotencyKey,
    payload: record.payload as Record<string, unknown>,
    status: record.status as SyncRecordStatus,
    attempts: record.attempts,
    error: record.error ?? undefined,
    serverEntityId: record.serverEntityId ?? undefined,
    lastAttemptAt: record.lastAttemptAt?.toISOString(),
    syncedAt: record.syncedAt?.toISOString(),
    createdBy: record.createdBy,
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString()
  };
}

async function branchBelongsToTenant(tenantId: string, branchId: string) {
  if (useDemoStore) {
    return branches.some((branch) => branch.tenantId === tenantId && branch.id === branchId);
  }

  const branch = await prisma.branch.findFirst({ where: { tenantId, id: branchId }, select: { id: true } });
  return Boolean(branch);
}

async function terminalBelongsToBranch(tenantId: string, branchId: string, terminalId: string) {
  if (useDemoStore) {
    return terminals.some((terminal) => terminal.tenantId === tenantId && terminal.branchId === branchId && terminal.id === terminalId);
  }

  const terminal = await prisma.terminal.findFirst({ where: { tenantId, branchId, id: terminalId }, select: { id: true } });
  return Boolean(terminal);
}

function branchFilter(branchId?: string) {
  return branchId ? { branchId } : {};
}

async function appendSyncAudit(event: Parameters<typeof appendAudit>[0]) {
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

export async function listSyncQueue(tenantId: string, filters: { branchId?: string; terminalId?: string; status?: string }) {
  if (useDemoStore) {
    return syncQueueRecords
      .filter((record) => record.tenantId === tenantId)
      .filter((record) => !filters.branchId || record.branchId === filters.branchId)
      .filter((record) => !filters.terminalId || record.terminalId === filters.terminalId)
      .filter((record) => !filters.status || filters.status === "all" || record.status === filters.status);
  }

  const records = await prisma.syncQueueRecord.findMany({
    where: {
      tenantId,
      branchId: filters.branchId ? filters.branchId : undefined,
      terminalId: filters.terminalId ? filters.terminalId : undefined,
      status: filters.status && filters.status !== "all" ? filters.status : undefined
    },
    orderBy: { createdAt: "desc" }
  });

  return records.map(toApiSyncRecord);
}

export async function queueSyncRecord(tenantId: string, userId: string, input: SyncQueueInput) {
  const validBranch = await branchBelongsToTenant(tenantId, input.branchId);
  if (!validBranch) return { status: "branch_not_found" as const };

  const validTerminal = await terminalBelongsToBranch(tenantId, input.branchId, input.terminalId);
  if (!validTerminal) return { status: "terminal_not_found" as const };

  if (useDemoStore) {
    const existing = syncQueueRecords.find((record) => record.tenantId === tenantId && record.idempotencyKey === input.idempotencyKey);
    if (existing) return { status: "replayed" as const, record: existing };

    const now = new Date().toISOString();
    const record: SyncQueueRecord = {
      id: nextSyncId(),
      tenantId,
      ...input,
      status: "queued",
      attempts: 0,
      createdBy: userId,
      createdAt: now,
      updatedAt: now
    };

    syncQueueRecords.unshift(record);
    await appendSyncAudit({
      tenantId,
      branchId: record.branchId,
      userId,
      action: "sync.record_queued",
      entityType: "sync_queue_record",
      entityId: record.id,
      metadata: { recordType: record.recordType, operation: record.operation, idempotencyKey: record.idempotencyKey }
    });

    return { status: "created" as const, record };
  }

  const existing = await prisma.syncQueueRecord.findUnique({
    where: { tenantId_idempotencyKey: { tenantId, idempotencyKey: input.idempotencyKey } }
  });

  if (existing) return { status: "replayed" as const, record: toApiSyncRecord(existing) };

  const record = await prisma.syncQueueRecord.create({
    data: {
      id: nextSyncId(),
      tenantId,
      ...input,
      payload: input.payload as Prisma.InputJsonValue,
      status: "queued",
      attempts: 0,
      createdBy: userId
    }
  });

  await appendSyncAudit({
    tenantId,
    branchId: record.branchId,
    userId,
    action: "sync.record_queued",
    entityType: "sync_queue_record",
    entityId: record.id,
    metadata: { recordType: record.recordType, operation: record.operation, idempotencyKey: record.idempotencyKey }
  });

  return { status: "created" as const, record: toApiSyncRecord(record) };
}

export async function updateSyncRecordStatus(
  tenantId: string,
  branchId: string | undefined,
  userId: string,
  recordId: string,
  input: { status: Exclude<SyncRecordStatus, "processing">; serverEntityId?: string; error?: string }
) {
  const now = new Date().toISOString();

  if (useDemoStore) {
    const record = syncQueueRecords.find((item) => item.tenantId === tenantId && item.id === recordId && (!branchId || item.branchId === branchId));
    if (!record) return { status: "not_found" as const };

    record.status = input.status;
    record.serverEntityId = input.serverEntityId || record.serverEntityId;
    record.error = input.error || undefined;
    record.attempts += input.status === "queued" ? 1 : 0;
    record.lastAttemptAt = input.status === "queued" ? now : record.lastAttemptAt;
    record.syncedAt = input.status === "synced" ? now : record.syncedAt;
    record.updatedAt = now;

    await appendSyncAudit({
      tenantId,
      branchId: record.branchId,
      userId,
      action: "sync.record_updated",
      entityType: "sync_queue_record",
      entityId: record.id,
      metadata: { status: input.status, serverEntityId: input.serverEntityId, error: input.error }
    });

    return { status: "updated" as const, record };
  }

  const existing = await prisma.syncQueueRecord.findFirst({ where: { tenantId, id: recordId, ...branchFilter(branchId) } });
  if (!existing) return { status: "not_found" as const };

  const record = await prisma.syncQueueRecord.update({
    where: { id: existing.id },
    data: {
      status: input.status,
      serverEntityId: input.serverEntityId || existing.serverEntityId,
      error: input.error || null,
      attempts: input.status === "queued" ? { increment: 1 } : undefined,
      lastAttemptAt: input.status === "queued" ? new Date() : existing.lastAttemptAt,
      syncedAt: input.status === "synced" ? new Date() : existing.syncedAt
    }
  });

  await appendSyncAudit({
    tenantId,
    branchId: record.branchId,
    userId,
    action: "sync.record_updated",
    entityType: "sync_queue_record",
    entityId: record.id,
    metadata: { status: input.status, serverEntityId: input.serverEntityId, error: input.error }
  });

  return { status: "updated" as const, record: toApiSyncRecord(record) };
}
