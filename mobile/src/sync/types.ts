/** Wire types; keep in sync with server/api/src/modules/sync/sync.wire.ts. */

export interface FeedItem {
  table: string;
  rowId: string;
  row: Record<string, unknown> | null;
}

export interface FeedPage {
  items: FeedItem[];
  cursor: number;
  hasMore: boolean;
  serverTime: string;
}

export type CommandType = "register.open" | "register.close" | "sale.create" | "customer.create";

export interface DeviceCommand {
  id: string;
  type: CommandType;
  staffId: string;
  createdAt: string;
  payload: Record<string, unknown>;
}

export interface DeviceCommandResult {
  id: string;
  status: "synced" | "conflict" | "failed";
  serverEntityId?: string;
  error?: string;
  idMap?: Record<string, string>;
}

export interface PairingCredentials {
  token: string;
  node: { id: string; tenantId: string; kind: string; nodeCode: string; terminalId?: string; branchIds: string[] };
  tenant: { id: string; name: string } | null;
  terminal?: { id: string; name: string; branchId: string };
  server: { nodeId: string; role: "cloud" | "office" };
}

/** Which server(s) this tablet talks to. */
export type SyncMode = "local" | "cloud" | "hybrid";
export type ServerKey = "local" | "cloud";
