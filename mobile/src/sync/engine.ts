import type { Platform } from "../data/db";
import { getKv, getServerToken, loadSettings, saveSettings, serverPreference, setKv, setServerToken, type DeviceSettings } from "./settings";
import type { DeviceCommand, DeviceCommandResult, FeedPage, PairingCredentials, ServerKey, SyncMode } from "./types";

/**
 * Tablet sync engine.
 *
 * Down (read model): pages through /sync/device/changes and mirrors rows locally.
 * Up (commands):     sends the outbox in strict order to /sync/device/commands.
 *
 * Routing in hybrid mode (office server + cloud):
 * - reads come from the first reachable server (office LAN preferred);
 * - every command for a shift goes to the server the shift was opened on ("home"),
 *   because only that server knows the shift until the office syncs with the cloud;
 * - a command is pinned to the first server it was sent to, so a lost response can
 *   never cause it to be executed twice on two different servers.
 */

const requestTimeoutMs = 15_000;
const helloTimeoutMs = 4_000;
const reachabilityTtlMs = 10_000;
const pageLimit = 500;

export class SyncHttpError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

interface OutboxRow {
  seq: number;
  id: string;
  type: DeviceCommand["type"];
  staffId: string;
  payload: string;
  createdAt: string;
  shiftLocalId: string | null;
  target: ServerKey | null;
  attempts: number;
  nextAttemptAt: string | null;
}

export interface SyncStatus {
  running: boolean;
  reachable: Partial<Record<ServerKey, boolean>>;
  pending: number;
  conflicts: number;
  lastSyncAt?: string;
  lastPullFrom?: ServerKey;
  lastError?: string;
  revoked?: boolean;
}

function normalizeUrl(url: string) {
  const trimmed = url.trim().replace(/\/+$/, "");
  return /^https?:\/\//i.test(trimmed) ? trimmed : `http://${trimmed}`;
}

async function request<T>(platform: Platform, url: string, path: string, init: { method?: string; token?: string | null; body?: unknown; timeoutMs?: number } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), init.timeoutMs ?? requestTimeoutMs);
  try {
    const response = await platform.fetch(`${normalizeUrl(url)}/api/v1/sync${path}`, {
      method: init.method ?? "GET",
      headers: {
        "content-type": "application/json",
        "x-app-version": platform.appVersion,
        ...(init.token ? { "x-sync-token": init.token } : {})
      },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
      signal: controller.signal
    });
    const payload = (await response.json().catch(() => ({}))) as T & { error?: string };
    if (!response.ok) throw new SyncHttpError(payload.error ?? `Server returned ${response.status}`, response.status);
    return payload as T;
  } finally {
    clearTimeout(timer);
  }
}

/** Checks a URL is a NaijaPOS server (used by the setup screen). */
export async function probeServer(platform: Platform, url: string) {
  return request<{ product: string; role: "cloud" | "office"; nodeId: string }>(platform, url, "/hello", { timeoutMs: helloTimeoutMs });
}

/**
 * Pairs this tablet with a server using a code from Admin > Sync > Devices.
 * In hybrid mode the tablet is paired twice (office and cloud) with codes issued for
 * the same terminal.
 */
export async function pairServer(platform: Platform, input: { server: ServerKey; url: string; pairingCode: string; mode: SyncMode }) {
  const url = normalizeUrl(input.url);
  const credentials = await request<PairingCredentials>(platform, url, "/pair", {
    method: "POST",
    body: { pairingCode: input.pairingCode.trim(), appVersion: platform.appVersion }
  });
  if (credentials.node.kind !== "device" || !credentials.terminal) {
    throw new Error("That pairing code is not for a tablet. Create a device code for a terminal.");
  }

  const existing = await loadSettings(platform);
  if (existing && (existing.tenantId !== credentials.node.tenantId || existing.terminalId !== credentials.terminal.id)) {
    throw new Error(`This tablet is set up as terminal ${existing.terminalName}. Issue the code for that same terminal.`);
  }

  const settings: DeviceSettings = {
    mode: input.mode,
    tenantId: credentials.node.tenantId,
    tenantName: credentials.tenant?.name ?? credentials.node.tenantId,
    terminalId: credentials.terminal.id,
    terminalName: credentials.terminal.name,
    branchId: credentials.terminal.branchId,
    deviceCode: existing?.deviceCode ?? credentials.node.nodeCode,
    servers: {
      ...existing?.servers,
      [input.server]: { url, nodeId: credentials.node.id, role: credentials.server.role, pairedAt: new Date().toISOString() }
    }
  };
  await setServerToken(platform, input.server, credentials.token);
  await saveSettings(platform, settings);
  return settings;
}

export class SyncEngine {
  private status: SyncStatus = { running: false, reachable: {}, pending: 0, conflicts: 0 };
  private reachableAt: Partial<Record<ServerKey, number>> = {};
  private listeners = new Set<(status: SyncStatus) => void>();
  private inFlight: Promise<SyncStatus> | null = null;

  constructor(private readonly platform: Platform) {}

  subscribe(listener: (status: SyncStatus) => void) {
    this.listeners.add(listener);
    listener(this.status);
    return () => {
      this.listeners.delete(listener);
    };
  }

  getStatus() {
    return this.status;
  }

  private emit(patch: Partial<SyncStatus>) {
    this.status = { ...this.status, ...patch };
    for (const listener of this.listeners) listener(this.status);
  }

  async refreshCounts() {
    const counts = await this.platform.db.first<{ pending: number; conflicts: number }>(
      "SELECT SUM(status = 'pending') AS pending, SUM(status = 'conflict') AS conflicts FROM outbox"
    );
    this.emit({ pending: Number(counts?.pending ?? 0), conflicts: Number(counts?.conflicts ?? 0) });
  }

  private async server(key: ServerKey) {
    const settings = await loadSettings(this.platform);
    const link = settings?.servers[key];
    const token = link ? await getServerToken(this.platform, key) : null;
    return link && token ? { url: link.url, token } : null;
  }

  async isReachable(key: ServerKey, force = false) {
    const checkedAt = this.reachableAt[key];
    if (!force && checkedAt && Date.now() - checkedAt < reachabilityTtlMs && this.status.reachable[key] !== undefined) {
      return this.status.reachable[key]!;
    }
    const server = await this.server(key);
    let reachable = false;
    if (server) {
      try {
        await request(this.platform, server.url, "/hello", { timeoutMs: helloTimeoutMs });
        reachable = true;
      } catch {
        reachable = false;
      }
    }
    this.reachableAt[key] = Date.now();
    this.emit({ reachable: { ...this.status.reachable, [key]: reachable } });
    return reachable;
  }

  private markUnreachable(key: ServerKey) {
    this.reachableAt[key] = Date.now();
    this.emit({ reachable: { ...this.status.reachable, [key]: false } });
  }

  /** First reachable server in preference order. */
  async preferredServer(): Promise<ServerKey | null> {
    const settings = await loadSettings(this.platform);
    if (!settings) return null;
    for (const key of serverPreference(settings)) {
      if (await this.isReachable(key)) return key;
    }
    return null;
  }

  /** Push the outbox, then pull the read model. Concurrent callers share one run. */
  syncNow(): Promise<SyncStatus> {
    this.inFlight ??= this.run().finally(() => {
      this.inFlight = null;
    });
    return this.inFlight;
  }

  private async run() {
    this.emit({ running: true });
    try {
      await this.push();
      const source = await this.preferredServer();
      if (source) {
        await this.pull(source);
        this.emit({ lastSyncAt: new Date().toISOString(), lastPullFrom: source, lastError: undefined });
      } else {
        this.emit({ lastError: "No server reachable - working offline" });
      }
    } catch (error) {
      if (error instanceof SyncHttpError && error.status === 401) {
        this.emit({ revoked: true, lastError: "This tablet's access was revoked. Pair it again." });
      } else {
        this.emit({ lastError: error instanceof Error ? error.message : String(error) });
      }
    } finally {
      await this.refreshCounts();
      this.emit({ running: false });
    }
    return this.status;
  }

  // ----- down: read model ---------------------------------------------------

  async pull(key: ServerKey) {
    const server = await this.server(key);
    if (!server) return;
    const cursorKey = `cursor.${key}`;
    let cursor = Number((await getKv(this.platform, cursorKey)) ?? 0);

    for (let page = 0; page < 200; page += 1) {
      let feed: FeedPage;
      try {
        feed = await request<FeedPage>(this.platform, server.url, `/device/changes?cursor=${cursor}&limit=${pageLimit}`, { token: server.token });
      } catch (error) {
        if (!(error instanceof SyncHttpError)) this.markUnreachable(key);
        throw error;
      }

      await this.platform.db.transaction(async () => {
        const now = new Date().toISOString();
        for (const item of feed.items) {
          if (item.row === null) {
            await this.platform.db.run("DELETE FROM rows WHERE tbl = ? AND id = ?", [item.table, item.rowId]);
          } else {
            const branchId = typeof item.row.branchId === "string" ? item.row.branchId : null;
            await this.platform.db.run(
              `INSERT INTO rows (tbl, id, branchId, data, updatedAt) VALUES (?, ?, ?, ?, ?)
               ON CONFLICT(tbl, id) DO UPDATE SET branchId = excluded.branchId, data = excluded.data, updatedAt = excluded.updatedAt`,
              [item.table, item.rowId, branchId, JSON.stringify(item.row), now]
            );
          }
        }
        await setKv(this.platform, cursorKey, String(feed.cursor));
      });
      cursor = feed.cursor;
      if (!feed.hasMore) break;
    }

    await this.reconcileAfterPull(key);
  }

  /** Ties local records to the server rows that now represent them. */
  private async reconcileAfterPull(source: ServerKey) {
    const db = this.platform.db;
    // A local sale is reflected in server stock once its server sale row is here.
    await db.run(
      `UPDATE sales SET reconciled = 1
       WHERE reconciled = 0 AND idempotencyKey IN (SELECT json_extract(data, '$.idempotencyKey') FROM rows WHERE tbl = 'completed_sales')`
    );
    // Shifts closed by a manager on the server are closed here too.
    await db.run(
      `UPDATE shifts SET status = 'closed', closedAt = COALESCE(closedAt, ?)
       WHERE status <> 'closed' AND serverId IN (SELECT id FROM rows WHERE tbl = 'register_shifts' AND json_extract(data, '$.status') = 'closed')`,
      [new Date().toISOString()]
    );
    // Customers created on the tablet: drop the placeholder once the real row arrived.
    await db.run(
      `DELETE FROM rows WHERE tbl = 'customers' AND id LIKE 'local-%'
       AND id IN (SELECT m.localId FROM id_map m JOIN rows r ON r.tbl = 'customers' AND r.id = m.serverId)`
    );
    // Adopt a shift opened on the server for this terminal (e.g. from the web app).
    const settings = await loadSettings(this.platform);
    if (!settings) return;
    const open = await db.first<{ data: string }>(
      "SELECT data FROM rows WHERE tbl = 'register_shifts' AND json_extract(data, '$.terminalId') = ? AND json_extract(data, '$.status') = 'open'",
      [settings.terminalId]
    );
    if (open) {
      const shift = JSON.parse(open.data) as { id: string; cashierId: string; openingBalance: number; openedAt: string };
      const known = await db.first<{ id: string }>("SELECT id FROM shifts WHERE serverId = ? OR id = ?", [shift.id, shift.id]);
      const localOpen = await db.first<{ id: string }>("SELECT id FROM shifts WHERE status IN ('open', 'closing') AND serverId IS NULL");
      if (!known && !localOpen) {
        await db.run(
          "INSERT INTO shifts (id, serverId, home, openedBy, openingBalance, status, openedAt) VALUES (?, ?, ?, ?, ?, 'open', ?)",
          [shift.id, shift.id, source, shift.cashierId, Number(shift.openingBalance), String(shift.openedAt)]
        );
      }
    }
  }

  // ----- up: commands -------------------------------------------------------

  private async targetFor(command: OutboxRow): Promise<ServerKey | null> {
    if (command.target) return command.target;
    if (command.shiftLocalId) {
      const shift = await this.platform.db.first<{ home: ServerKey | null }>("SELECT home FROM shifts WHERE id = ?", [command.shiftLocalId]);
      if (shift?.home) return shift.home;
    }
    return this.preferredServer();
  }

  async push() {
    const db = this.platform.db;
    for (let round = 0; round < 100; round += 1) {
      const queue = await db.all<OutboxRow>("SELECT * FROM outbox WHERE status = 'pending' ORDER BY seq LIMIT 50");
      if (!queue.length) return;

      const head = queue[0];
      if (head.nextAttemptAt && Date.parse(head.nextAttemptAt) > Date.now()) return;
      const target = await this.targetFor(head);
      if (!target || !(await this.isReachable(target))) return;

      const batch: OutboxRow[] = [];
      for (const command of queue) {
        if ((await this.targetFor(command)) !== target) break;
        batch.push(command);
      }

      // Pin before sending: once a server may have seen a command, only it may run it.
      for (const command of batch) {
        if (!command.target) await db.run("UPDATE outbox SET target = ? WHERE id = ?", [target, command.id]);
        if (command.type === "register.open" && command.shiftLocalId) {
          await db.run("UPDATE shifts SET home = COALESCE(home, ?) WHERE id = ?", [target, command.shiftLocalId]);
        }
      }

      const server = await this.server(target);
      if (!server) return;
      let results: DeviceCommandResult[];
      try {
        const response = await request<{ results: DeviceCommandResult[] }>(this.platform, server.url, "/device/commands", {
          method: "POST",
          token: server.token,
          body: {
            commands: batch.map<DeviceCommand>((command) => ({
              id: command.id,
              type: command.type,
              staffId: command.staffId,
              createdAt: command.createdAt,
              payload: JSON.parse(command.payload)
            }))
          }
        });
        results = response.results;
      } catch (error) {
        if (!(error instanceof SyncHttpError)) {
          this.markUnreachable(target);
          return;
        }
        throw error;
      }

      let blocked = false;
      for (const result of results) {
        await this.applyResult(result);
        if (result.status === "failed") blocked = true;
      }
      if (blocked || results.length === 0) return;
    }
  }

  private async applyResult(result: DeviceCommandResult) {
    const db = this.platform.db;
    const command = await db.first<OutboxRow>("SELECT * FROM outbox WHERE id = ?", [result.id]);
    if (!command) return;
    const now = new Date().toISOString();

    await db.transaction(async () => {
      if (result.status === "failed") {
        const attempts = command.attempts + 1;
        const backoffMs = Math.min(5 * 60_000, 5_000 * 2 ** Math.min(attempts, 6));
        await db.run("UPDATE outbox SET attempts = ?, error = ?, nextAttemptAt = ? WHERE id = ?", [
          attempts,
          result.error ?? "Server error",
          new Date(Date.now() + backoffMs).toISOString(),
          command.id
        ]);
        return;
      }

      await db.run("UPDATE outbox SET status = ?, error = ?, serverEntityId = ?, syncedAt = ?, attempts = attempts + 1 WHERE id = ?", [
        result.status,
        result.error ?? null,
        result.serverEntityId ?? null,
        result.status === "synced" ? now : null,
        command.id
      ]);

      for (const [localId, serverId] of Object.entries(result.idMap ?? {})) {
        await db.run("INSERT INTO id_map (localId, serverId) VALUES (?, ?) ON CONFLICT(localId) DO UPDATE SET serverId = excluded.serverId", [localId, serverId]);
      }

      const payload = JSON.parse(command.payload) as Record<string, string>;
      if (command.type === "sale.create") {
        await db.run("UPDATE sales SET status = ?, serverId = ? WHERE id = ?", [result.status, result.serverEntityId ?? null, payload.localSaleId]);
      }
      if (command.type === "register.open" && result.status === "synced") {
        await db.run("UPDATE shifts SET serverId = ? WHERE id = ?", [result.serverEntityId ?? null, payload.localShiftId]);
      }
    });
  }

  /** Lists recent outbox entries for the Sync screen. */
  async recentCommands(limit = 50) {
    return this.platform.db.all<{ id: string; type: string; status: string; error: string | null; createdAt: string; target: string | null; serverEntityId: string | null }>(
      "SELECT id, type, status, error, createdAt, target, serverEntityId FROM outbox ORDER BY seq DESC LIMIT ?",
      [limit]
    );
  }

  /** Re-sends a failed command immediately (conflicts are fixed by a manager on the server). */
  async retryNow() {
    await this.platform.db.run("UPDATE outbox SET nextAttemptAt = NULL WHERE status = 'pending'");
    return this.syncNow();
  }
}

export async function enqueueCommand(platform: Platform, command: Omit<DeviceCommand, "id" | "createdAt"> & { shiftLocalId?: string }) {
  const id = `cmd-${platform.uuid()}`;
  await platform.db.run("INSERT INTO outbox (id, type, staffId, payload, createdAt, shiftLocalId) VALUES (?, ?, ?, ?, ?, ?)", [
    id,
    command.type,
    command.staffId,
    JSON.stringify(command.payload),
    new Date().toISOString(),
    command.shiftLocalId ?? null
  ]);
  return id;
}
