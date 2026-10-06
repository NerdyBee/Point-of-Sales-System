import { Prisma } from "@prisma/client";
import { prisma } from "../../shared/db/prisma";
import { entityForTable, type SyncEntity } from "./sync.entities";
import type { ChangeOp, FeedPage, WireChange, WireItem } from "./sync.wire";

/**
 * Changes are only served once they are this old. Sequence numbers are allocated
 * at insert time but become visible at commit, so a short settle window stops a
 * reader from moving its cursor past a change whose transaction has not committed.
 */
const settleSeconds = 5;

export interface FeedOptions {
  tenantId: string;
  cursor: number;
  limit?: number;
  entities: SyncEntity[];
  /** Skip changes that came from the reader itself (prevents echo). */
  excludeOrigin?: string;
  /** Branch scope; null = whole tenant. Tenant-wide rows are always included. */
  branchIds: string[] | null;
  mode: "peer" | "device";
}

interface ChangeRow {
  seq: bigint | number;
  tableName: string;
  rowId: string;
  op: string;
  fields: string | null;
  deltas: unknown;
  changedAt: Date | string;
}

function parseDeltas(value: unknown): Record<string, number> | null {
  if (value === null || value === undefined) return null;
  const parsed = typeof value === "string" ? JSON.parse(value) : value;
  if (!parsed || typeof parsed !== "object") return null;
  return Object.fromEntries(Object.entries(parsed as Record<string, unknown>).map(([key, delta]) => [key, Number(delta) || 0]));
}

function scopeClause(branchIds: string[] | null) {
  if (branchIds === null) return Prisma.empty;
  if (branchIds.length === 0) return Prisma.sql`AND branchId IS NULL AND branchId2 IS NULL`;
  const list = Prisma.join(branchIds);
  return Prisma.sql`AND (branchId IS NULL OR branchId IN (${list})) AND (branchId2 IS NULL OR branchId2 IN (${list}))`;
}

function compoundKey(entity: SyncEntity, rowId: string) {
  const parts = rowId.split("|");
  return Object.fromEntries(entity.pk.map((column, index) => [column, parts[index]]));
}

async function snapshotRows(tx: Prisma.TransactionClient, entity: SyncEntity, rowIds: string[]) {
  const delegate = (tx as unknown as Record<string, { findMany(args: unknown): Promise<Record<string, unknown>[]> }>)[entity.delegate];
  const where = entity.pk.length === 1
    ? { [entity.pk[0]]: { in: rowIds } }
    : { OR: rowIds.map((rowId) => compoundKey(entity, rowId)) };
  const rows = await delegate.findMany({ where });
  return new Map(rows.map((row) => [entity.pk.map((column) => String(row[column])).join("|"), row]));
}

function forDevice(entity: SyncEntity, row: Record<string, unknown>) {
  if (!entity.deviceOmit?.length) return row;
  const copy = { ...row };
  for (const column of entity.deviceOmit) delete copy[column];
  return copy;
}

export async function readFeed(options: FeedOptions): Promise<FeedPage> {
  const limit = Math.min(Math.max(options.limit ?? 300, 1), 1000);
  const tables = options.entities.map((entity) => entity.table);
  const serverTime = new Date().toISOString();
  if (!tables.length) return { items: [], cursor: options.cursor, hasMore: false, serverTime };

  return prisma.$transaction(async (tx) => {
    // First read establishes the REPEATABLE READ snapshot used for row snapshots below.
    const [head] = await tx.$queryRaw<{ seq: bigint }[]>`
      SELECT seq FROM sync_changes WHERE loggedAt <= UTC_TIMESTAMP(3) - INTERVAL ${settleSeconds} SECOND ORDER BY seq DESC LIMIT 1`;
    const safeHead = head ? Number(head.seq) : 0;
    if (safeHead <= options.cursor) return { items: [], cursor: options.cursor, hasMore: false, serverTime };

    const originClause = options.excludeOrigin ? Prisma.sql`AND origin <> ${options.excludeOrigin}` : Prisma.empty;
    const rows = await tx.$queryRaw<ChangeRow[]>`
      SELECT seq, tableName, rowId, op, fields, deltas, changedAt
      FROM sync_changes
      WHERE tenantId = ${options.tenantId} AND seq > ${options.cursor} AND seq <= ${safeHead}
        AND tableName IN (${Prisma.join(tables)}) ${originClause} ${scopeClause(options.branchIds)}
      ORDER BY seq
      LIMIT ${limit}`;

    const hasMore = rows.length === limit;
    const cursor = hasMore ? Number(rows[rows.length - 1].seq) : safeHead;

    // Group per row, keeping the position of the row's first change so parents stay ahead of children.
    const grouped = new Map<string, WireItem>();
    for (const row of rows) {
      const key = `${row.tableName}\u0000${row.rowId}`;
      let item = grouped.get(key);
      if (!item) {
        item = { table: row.tableName, rowId: row.rowId, row: null, changes: [] };
        grouped.set(key, item);
      }
      const change: WireChange = {
        seq: Number(row.seq),
        op: row.op as ChangeOp,
        fields: row.fields ? row.fields.split(",").filter(Boolean) : null,
        deltas: parseDeltas(row.deltas),
        changedAt: new Date(row.changedAt).toISOString()
      };
      item.changes.push(change);
    }

    const items = [...grouped.values()];
    const byTable = new Map<string, WireItem[]>();
    for (const item of items) byTable.set(item.table, [...(byTable.get(item.table) ?? []), item]);

    for (const [table, tableItems] of byTable) {
      const entity = entityForTable(table)!;
      const snapshots = await snapshotRows(tx, entity, tableItems.map((item) => item.rowId));
      for (const item of tableItems) {
        const snapshot = snapshots.get(item.rowId) ?? null;
        item.row = snapshot && options.mode === "device" ? forDevice(entity, snapshot) : snapshot;
        if (options.mode === "device") item.changes = [];
      }
    }

    return { items, cursor, hasMore, serverTime };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, timeout: 30_000 });
}
