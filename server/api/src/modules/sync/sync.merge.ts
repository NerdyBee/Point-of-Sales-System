import type { SyncEntity } from "./sync.entities";
import type { WireChange, WireItem } from "./sync.wire";

/**
 * Pure merge rules used when a peer's changes are applied locally.
 *
 * - Ordering: upserts parent-first (rank ascending), deletes child-first.
 * - Fields:   last-writer-wins per column, using original authoring time.
 * - Counters: additive. Each change's delta is applied exactly once.
 */

export function orderForApply(items: WireItem[], rankOf: (table: string) => number) {
  const position = new Map(items.map((item, index) => [item, index]));
  const upserts = items.filter((item) => item.row !== null);
  const deletes = items.filter((item) => item.row === null);
  upserts.sort((left, right) => rankOf(left.table) - rankOf(right.table) || position.get(left)! - position.get(right)!);
  deletes.sort((left, right) => rankOf(right.table) - rankOf(left.table) || position.get(left)! - position.get(right)!);
  return [...upserts, ...deletes];
}

/** Merge the changes of a parked (conflicted) item with a newer delivery of the same row. */
export function mergeItems(older: WireItem, newer: WireItem): WireItem {
  const bySeq = new Map<number, WireChange>();
  for (const change of [...older.changes, ...newer.changes]) bySeq.set(change.seq, change);
  return { ...newer, changes: [...bySeq.values()].sort((left, right) => left.seq - right.seq) };
}

export function pendingChanges(changes: WireChange[], lastAppliedSeq: number) {
  return changes.filter((change) => change.seq > lastAppliedSeq);
}

/** Latest authoring time per column across incoming changes. Inserts touch every tracked column. */
export function incomingFieldTimes(changes: WireChange[], tracked: string[]) {
  const times = new Map<string, number>();
  for (const change of changes) {
    const touched = change.op === "I" || change.fields === null ? tracked : change.fields;
    const at = Date.parse(change.changedAt);
    for (const field of touched) {
      if (!tracked.includes(field)) continue;
      times.set(field, Math.max(times.get(field) ?? 0, at));
    }
  }
  return times;
}

export interface LocalChange {
  op: string;
  fields: string | null;
  changedAt: Date | string;
}

/** Columns where this node holds a newer write than the incoming one (those are kept). */
export function blockedFields(incoming: Map<string, number>, local: LocalChange[], tracked: string[]) {
  const blocked = new Set<string>();
  for (const change of local) {
    if (change.op === "D") continue;
    const at = new Date(change.changedAt).getTime();
    const touched = change.op === "I" || !change.fields ? tracked : change.fields.split(",");
    for (const field of touched) {
      const incomingAt = incoming.get(field);
      if (incomingAt !== undefined && at > incomingAt) blocked.add(field);
    }
  }
  return blocked;
}

/**
 * Sum of counter deltas. When the row already exists locally an incoming insert is
 * a second, independent copy of the row (e.g. both nodes were seeded), so its
 * initial value is not added on top of ours.
 */
export function counterDeltas(entity: SyncEntity, changes: WireChange[], rowExists: boolean) {
  const totals: Record<string, number> = {};
  for (const counter of entity.counters ?? []) totals[counter] = 0;
  for (const change of changes) {
    if (!change.deltas) continue;
    if (rowExists && change.op === "I") continue;
    for (const counter of entity.counters ?? []) totals[counter] += Number(change.deltas[counter] ?? 0);
  }
  return totals;
}

export function hasInsert(changes: WireChange[]) {
  return changes.some((change) => change.op === "I");
}

export function latestChangedAt(changes: WireChange[]) {
  return changes.reduce((latest, change) => Math.max(latest, Date.parse(change.changedAt)), 0);
}
