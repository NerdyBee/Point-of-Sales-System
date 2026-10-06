import type { SyncPeer } from "@prisma/client";
import { prisma } from "../../shared/db/prisma";
import { applyPeerItems } from "./sync.apply";
import { processRequeuedDeviceCommands } from "./sync.commands";
import { entitiesFlowing } from "./sync.entities";
import { readFeed } from "./sync.feed";
import { getNodeIdentity, nodeRole, syncIntervalMs } from "./sync.identity";
import { wireReplacer, type ApplySummary, type FeedPage } from "./sync.wire";

/**
 * Office -> cloud replication. Runs on an interval when this server is an office
 * and an upstream connection exists and is enabled. Completely optional: with no
 * SyncPeer row the office simply runs offline.
 */

export const upstreamSource = "upstream";
const maxPagesPerRun = 50;
const requestTimeoutMs = 30_000;

export class UpstreamError extends Error {
  constructor(message: string, readonly status?: number) {
    super(message);
  }
}

export async function upstreamRequest<T>(url: string, path: string, init: { method?: string; token?: string; body?: unknown } = {}) {
  const identity = await getNodeIdentity();
  let response: Response;
  try {
    response = await fetch(new URL(`/api/v1/sync${path}`, url), {
      method: init.method ?? "GET",
      headers: {
        "content-type": "application/json",
        "x-app-version": `office/${identity.nodeId}`,
        ...(init.token ? { "x-sync-token": init.token } : {})
      },
      body: init.body === undefined ? undefined : JSON.stringify(init.body, wireReplacer),
      signal: AbortSignal.timeout(requestTimeoutMs)
    });
  } catch (error) {
    throw new UpstreamError(`Cloud unreachable: ${error instanceof Error ? error.message : String(error)}`);
  }

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new UpstreamError((payload as { error?: string }).error ?? `Cloud returned ${response.status}`, response.status);
  return payload as T;
}

export function publicPeer(peer: SyncPeer | null) {
  if (!peer) return null;
  return {
    url: peer.url,
    tenantId: peer.tenantId,
    nodeId: peer.nodeId,
    enabled: peer.enabled,
    pullCursor: Number(peer.pullCursor),
    pushCursor: Number(peer.pushCursor),
    lastPullAt: peer.lastPullAt?.toISOString(),
    lastPushAt: peer.lastPushAt?.toISOString(),
    lastError: peer.lastError ?? undefined,
    lastErrorAt: peer.lastErrorAt?.toISOString()
  };
}

export interface UpstreamRunResult {
  pushed: number;
  pulled: ApplySummary;
  error?: string;
}

let running: Promise<UpstreamRunResult> | null = null;

/** One push+pull cycle. Concurrent callers share the in-flight run. */
export function runUpstreamSync(): Promise<UpstreamRunResult> {
  running ??= runOnce().finally(() => {
    running = null;
  });
  return running;
}

async function runOnce(): Promise<UpstreamRunResult> {
  const result: UpstreamRunResult = { pushed: 0, pulled: { applied: 0, skipped: 0, conflicts: 0 } };
  const peer = await prisma.syncPeer.findUnique({ where: { id: "upstream" } });
  if (!peer || !peer.enabled) return result;

  try {
    // Push first so the cloud sees our latest writes before we merge theirs.
    let pushCursor = Number(peer.pushCursor);
    for (let page = 0; page < maxPagesPerRun; page += 1) {
      const feed = await readFeed({
        tenantId: peer.tenantId,
        cursor: pushCursor,
        entities: entitiesFlowing("office"),
        excludeOrigin: upstreamSource,
        branchIds: null,
        mode: "peer"
      });
      if (feed.items.length) {
        await upstreamRequest<{ summary: ApplySummary }>(peer.url, "/peer/changes", { method: "POST", token: peer.token, body: { items: feed.items } });
        result.pushed += feed.items.length;
      }
      if (feed.cursor !== pushCursor) {
        pushCursor = feed.cursor;
        await prisma.syncPeer.update({ where: { id: peer.id }, data: { pushCursor: BigInt(pushCursor), lastPushAt: new Date() } });
      }
      if (!feed.hasMore) break;
    }

    let pullCursor = Number(peer.pullCursor);
    const tables = new Set(entitiesFlowing("cloud").map((entity) => entity.table));
    for (let page = 0; page < maxPagesPerRun; page += 1) {
      const feed = await upstreamRequest<FeedPage>(peer.url, `/peer/changes?cursor=${pullCursor}`, { token: peer.token });
      if (feed.items.length) {
        const summary = await applyPeerItems(
          { source: upstreamSource, originTag: upstreamSource, tenantId: peer.tenantId, tables, branchScope: null },
          feed.items
        );
        result.pulled.applied += summary.applied;
        result.pulled.skipped += summary.skipped;
        result.pulled.conflicts += summary.conflicts;
      }
      pullCursor = feed.cursor;
      await prisma.syncPeer.update({ where: { id: peer.id }, data: { pullCursor: BigInt(pullCursor), lastPullAt: new Date(), lastError: null, lastErrorAt: null } });
      if (!feed.hasMore) break;
    }
  } catch (error) {
    result.error = error instanceof Error ? error.message : String(error);
    await prisma.syncPeer.update({ where: { id: peer.id }, data: { lastError: result.error.slice(0, 500), lastErrorAt: new Date() } }).catch(() => undefined);
  }

  return result;
}

/** Connects this office to the cloud using a pairing code created in the cloud admin. */
export async function connectUpstream(input: { url: string; pairingCode: string; localTenantId: string }) {
  const identity = await getNodeIdentity();
  if (identity.role !== "office") return { status: "not_office" as const };

  const url = new URL(input.url).origin;
  const paired = await upstreamRequest<{
    token: string;
    node: { id: string; tenantId: string; kind: string };
  }>(url, "/pair", { method: "POST", body: { pairingCode: input.pairingCode, appVersion: `office/${identity.nodeId}` } });

  if (paired.node.kind !== "office") return { status: "wrong_kind" as const };
  if (paired.node.tenantId !== input.localTenantId) return { status: "tenant_mismatch" as const, cloudTenantId: paired.node.tenantId };

  const peer = await prisma.syncPeer.upsert({
    where: { id: "upstream" },
    create: { id: "upstream", url, tenantId: paired.node.tenantId, nodeId: paired.node.id, token: paired.token, enabled: true },
    update: { url, tenantId: paired.node.tenantId, nodeId: paired.node.id, token: paired.token, enabled: true, pullCursor: 0n, pushCursor: 0n, lastError: null }
  });

  void runUpstreamSync();
  return { status: "connected" as const, peer: publicPeer(peer) };
}

let timer: NodeJS.Timeout | null = null;

export function startSyncAgent(log: (message: string) => void = console.log) {
  if (timer || process.env.NODE_ENV === "test") return;
  const interval = syncIntervalMs();

  timer = setInterval(() => {
    void (async () => {
      await processRequeuedDeviceCommands().catch((error) => log(`sync: requeue processing failed: ${String(error)}`));
      if (nodeRole() !== "office") return;
      const result = await runUpstreamSync();
      if (result.error) log(`sync: upstream ${result.error}`);
      else if (result.pushed || result.pulled.applied || result.pulled.conflicts) {
        log(`sync: pushed ${result.pushed}, pulled ${result.pulled.applied} (${result.pulled.conflicts} conflicts)`);
      }
    })();
  }, interval);
  timer.unref();
  log(`sync: agent started (${nodeRole()}, every ${Math.round(interval / 1000)}s)`);
}
