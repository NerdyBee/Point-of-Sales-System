import { Prisma } from "@prisma/client";
import { prisma } from "../../shared/db/prisma";
import { entityColumns, entityForTable, trackedColumns, whereForRowId, type SyncEntity } from "./sync.entities";
import {
  blockedFields,
  counterDeltas,
  hasInsert,
  incomingFieldTimes,
  latestChangedAt,
  mergeItems,
  orderForApply,
  pendingChanges,
  type LocalChange
} from "./sync.merge";
import type { ApplySummary, WireItem } from "./sync.wire";

export interface ApplyContext {
  /** Key for idempotency bookkeeping (cloud: office node id; office: "upstream"). */
  source: string;
  /** Value written to sync_changes.origin for rows changed by this apply (echo suppression). */
  originTag: string;
  tenantId: string;
  /** Tables this sender may write. */
  tables: Set<string>;
  /** Branch scope the sender is limited to; null = whole tenant. */
  branchScope: string[] | null;
}

export class SyncRejection extends Error {}

type Delegate = {
  findUnique(args: unknown): Promise<Record<string, unknown> | null>;
  create(args: unknown): Promise<unknown>;
  update(args: unknown): Promise<unknown>;
  delete(args: unknown): Promise<unknown>;
};

function delegateFor(tx: Prisma.TransactionClient, entity: SyncEntity) {
  return (tx as unknown as Record<string, Delegate>)[entity.delegate];
}

/** Converts a JSON-transported row back into Prisma input types; unknown columns are dropped. */
export function coerceRow(entity: SyncEntity, raw: Record<string, unknown>) {
  const data: Record<string, unknown> = {};
  for (const column of entityColumns(entity)) {
    if (!(column.name in raw)) continue;
    const value = raw[column.name];
    if (value === null || value === undefined) {
      data[column.name] = column.type === "Json" ? Prisma.JsonNull : null;
      continue;
    }
    switch (column.type) {
      case "DateTime":
        data[column.name] = new Date(value as string);
        break;
      case "BigInt":
        data[column.name] = BigInt(value as number);
        break;
      case "Decimal":
        data[column.name] = String(value);
        break;
      case "Int":
        data[column.name] = Math.trunc(Number(value));
        break;
      default:
        data[column.name] = value;
    }
  }
  return data;
}

function sqlUtc(epochMs: number) {
  return new Date(epochMs || Date.now()).toISOString().replace("T", " ").replace("Z", "");
}

async function tenantOfRow(tx: Prisma.TransactionClient, entity: SyncEntity, row: Record<string, unknown>) {
  if (entity.table === "tenants") return String(row.id);
  if ("tenantId" in row) return String(row.tenantId);
  if (entity.table === "access_role_permissions") {
    const role = await tx.accessRole.findUnique({ where: { id: String(row.roleId) }, select: { tenantId: true } });
    return role?.tenantId;
  }
  if (entity.table === "supplier_products") {
    const supplier = await tx.supplier.findUnique({ where: { id: String(row.supplierId) }, select: { tenantId: true } });
    return supplier?.tenantId;
  }
  return undefined;
}

function assertBranchScope(entity: SyncEntity, row: Record<string, unknown>, scope: string[] | null) {
  if (!scope) return;
  for (const expression of [entity.scope.branch, entity.scope.branch2]) {
    const column = expression && /^ROW\.(\w+)$/.exec(expression)?.[1];
    if (!column) continue;
    const branchId = row[column];
    if (branchId !== null && branchId !== undefined && !scope.includes(String(branchId))) {
      throw new SyncRejection(`${entity.table} ${column}=${String(branchId)} is outside this node's branch scope`);
    }
  }
}

async function localCompetingChanges(tx: Prisma.TransactionClient, entity: SyncEntity, rowId: string, originTag: string, since: number) {
  return tx.$queryRaw<LocalChange[]>`
    SELECT op, fields, changedAt FROM sync_changes
    WHERE tableName = ${entity.table} AND rowId = ${rowId} AND origin <> ${originTag} AND changedAt > ${sqlUtc(since)}`;
}

async function applyItem(context: ApplyContext, item: WireItem): Promise<"applied" | "skipped"> {
  const entity = entityForTable(item.table);
  if (!entity || !context.tables.has(item.table)) throw new SyncRejection(`Table ${item.table} is not accepted from this node`);

  return prisma.$transaction(async (tx) => {
    const stateKey = { source: context.source, tableName: entity.table, rowId: item.rowId };
    const state = await tx.syncRowState.findUnique({ where: { source_tableName_rowId: stateKey } });
    const pending = pendingChanges(item.changes, state ? Number(state.lastSeq) : 0);
    if (!pending.length) return "skipped" as const;

    const delegate = delegateFor(tx, entity);
    const where = whereForRowId(entity, item.rowId);
    const changedAt = latestChangedAt(pending);

    await tx.$executeRaw`SET @sync_origin = ${context.originTag}, @sync_changed_at = ${sqlUtc(changedAt)}`;
    try {
      const existing = await delegate.findUnique({ where });
      if (existing && (await tenantOfRow(tx, entity, existing)) !== context.tenantId) {
        throw new SyncRejection(`${entity.table} ${item.rowId} already exists for another tenant`);
      }

      if (item.row === null) {
        if (existing) await delegate.delete({ where });
      } else {
        const incoming = coerceRow(entity, item.row);
        if ((await tenantOfRow(tx, entity, incoming)) !== context.tenantId) {
          throw new SyncRejection(`${entity.table} ${item.rowId} does not belong to tenant ${context.tenantId}`);
        }
        assertBranchScope(entity, incoming, context.branchScope);

        if (!existing) {
          const data = { ...incoming };
          if (hasInsert(pending)) Object.assign(data, counterDeltas(entity, pending, false));
          await delegate.create({ data });
        } else {
          const tracked = trackedColumns(entity);
          const incomingTimes = incomingFieldTimes(pending, tracked);
          const earliest = Math.min(...pending.map((change) => Date.parse(change.changedAt)));
          const blocked = blockedFields(incomingTimes, await localCompetingChanges(tx, entity, item.rowId, context.originTag, earliest), tracked);

          const data: Record<string, unknown> = {};
          for (const field of incomingTimes.keys()) {
            if (!blocked.has(field) && field in incoming) data[field] = incoming[field];
          }
          for (const [counter, delta] of Object.entries(counterDeltas(entity, pending, true))) {
            if (delta !== 0) data[counter] = { increment: delta };
          }
          if (Object.keys(data).length) await delegate.update({ where, data });
        }
      }

      const lastSeq = BigInt(Math.max(...pending.map((change) => change.seq)));
      await tx.syncRowState.upsert({
        where: { source_tableName_rowId: stateKey },
        create: { ...stateKey, lastSeq },
        update: { lastSeq }
      });
      return "applied" as const;
    } finally {
      // Session variables live on the pooled connection; always clear them.
      await tx.$executeRaw`SET @sync_origin = NULL, @sync_changed_at = NULL`.catch(() => undefined);
    }
  }, { timeout: 30_000 });
}

function errorMessage(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return message.replace(/\s+/g, " ").slice(0, 480);
}

async function parkConflict(context: ApplyContext, item: WireItem, error: unknown) {
  const key = { source: context.source, tableName: item.table, rowId: item.rowId };
  const change = JSON.parse(JSON.stringify(item)) as Prisma.InputJsonValue;
  await prisma.syncConflict.upsert({
    where: { source_tableName_rowId: key },
    create: {
      id: `sync-conflict-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      tenantId: context.tenantId,
      ...key,
      change,
      error: errorMessage(error),
      status: "open"
    },
    update: { change, error: errorMessage(error), attempts: { increment: 1 }, status: "open", resolvedAt: null }
  });
}

/**
 * Applies a batch from a peer. Rows that fail (missing parent, unique clash, other
 * tenant) are parked in sync_conflicts and retried with the next batch so one bad
 * row never blocks the stream.
 */
export async function applyPeerItems(context: ApplyContext, items: WireItem[]): Promise<ApplySummary> {
  const summary: ApplySummary = { applied: 0, skipped: 0, conflicts: 0 };

  const parked = await prisma.syncConflict.findMany({ where: { source: context.source, status: "open" }, orderBy: { createdAt: "asc" }, take: 500 });
  const merged = new Map<string, WireItem>();
  for (const conflict of parked) {
    const item = conflict.change as unknown as WireItem;
    merged.set(`${item.table}\u0000${item.rowId}`, item);
  }
  for (const item of items) {
    const key = `${item.table}\u0000${item.rowId}`;
    const older = merged.get(key);
    merged.set(key, older ? mergeItems(older, item) : item);
  }

  const ordered = orderForApply([...merged.values()], (table) => entityForTable(table)?.rank ?? 99);
  for (const item of ordered) {
    try {
      const outcome = await applyItem(context, item);
      summary[outcome] += 1;
      await prisma.syncConflict.updateMany({
        where: { source: context.source, tableName: item.table, rowId: item.rowId, status: "open" },
        data: { status: "resolved", resolvedAt: new Date() }
      });
    } catch (error) {
      summary.conflicts += 1;
      await parkConflict(context, item, error);
    }
  }

  return summary;
}
