/**
 * Wire format shared by servers (office <-> cloud) and devices (tablet <- server).
 * Keep in sync with mobile/src/sync/types.ts.
 */

export type ChangeOp = "I" | "U" | "D";

export interface WireChange {
  seq: number;
  op: ChangeOp;
  /** Columns changed by an update; null for insert/delete (= all columns). */
  fields: string[] | null;
  /** Counter deltas (NEW - OLD; for inserts the initial value). */
  deltas: Record<string, number> | null;
  /** ISO time the change was originally authored. */
  changedAt: string;
}

export interface WireItem {
  table: string;
  rowId: string;
  /** Current row on the sending node, or null when it no longer exists there. */
  row: Record<string, unknown> | null;
  /** Individual changes since the cursor (peer mode only). */
  changes: WireChange[];
}

export interface FeedPage {
  items: WireItem[];
  cursor: number;
  hasMore: boolean;
  serverTime: string;
}

export interface ApplySummary {
  applied: number;
  skipped: number;
  conflicts: number;
}

export type DeviceCommandType = "register.open" | "register.close" | "cash_movement.create" | "sale.create" | "customer.create";

export interface DeviceCommand {
  /** Unique per device; used as the idempotency key. */
  id: string;
  type: DeviceCommandType;
  staffId: string;
  createdAt: string;
  payload: Record<string, unknown>;
}

export type DeviceCommandStatus = "synced" | "conflict" | "failed";

export interface DeviceCommandResult {
  id: string;
  status: DeviceCommandStatus;
  serverEntityId?: string;
  error?: string;
  /** Local ids resolved by this command, e.g. { "local-shift-1": "shift-123" }. */
  idMap?: Record<string, string>;
}

/** JSON.stringify replacer that survives BigInt columns. */
export function wireReplacer(_key: string, value: unknown) {
  return typeof value === "bigint" ? Number(value) : value;
}
