import { syncQueueInputSchema, syncQueueStatusSchema } from "@pos/validation";
import { Router, type Request, type Response } from "express";
import { canAccessAllBranches, canAccessScopedBranches, resolveBranchScope, requireAnyPermission, requirePermission, requireTenant } from "../../shared/http/tenantContext";
import { z } from "zod";
import { prisma } from "../../shared/db/prisma";
import { connectUpstream, publicPeer, runUpstreamSync } from "./sync.agent";
import { applyPeerItems } from "./sync.apply";
import { processDeviceCommands, processRequeuedDeviceCommands } from "./sync.commands";
import { deviceEntities, entitiesFlowing } from "./sync.entities";
import { readFeed } from "./sync.feed";
import { getNodeIdentity } from "./sync.identity";
import { createPairing, listSyncNodes, nodeBranchIds, redeemPairing, requireSyncNode, revokeSyncNode } from "./sync.nodes";
import { listSyncQueue, queueSyncRecord, updateSyncRecordStatus } from "./sync.repository";
import { wireReplacer, type DeviceCommand, type WireItem } from "./sync.wire";

export const syncRouter = Router();

function parseSyncDate(value: string | undefined, endOfDay = false) {
  if (!value) return null;
  const date = new Date(`${value}T${endOfDay ? "23:59:59.999" : "00:00:00.000"}`);
  return Number.isNaN(date.getTime()) ? null : date;
}

function requestedBranch(req: Request) {
  const requested = req.query.branchId?.toString() ?? req.header("x-branch-id");
  if (requested) return requested;

  if (canAccessAllBranches(req.tenantContext!) || canAccessScopedBranches(req.tenantContext!)) return undefined;
  return req.tenantContext!.branchId;
}

function resolveSyncBranch(req: Request, res: Response) {
  const scope = resolveBranchScope(req.tenantContext!, requestedBranch(req));
  if (scope.forbidden || (!canAccessAllBranches(req.tenantContext!) && !canAccessScopedBranches(req.tenantContext!) && !req.tenantContext!.branchId)) {
    res.status(403).json({ error: "Branch access denied" });
    return null;
  }

  return scope;
}

function effectiveBranchScope(scope: ReturnType<typeof resolveBranchScope>, requestedBranchId?: string) {
  return !requestedBranchId && scope.branchScopeIds?.length ? { ...scope, branchId: undefined } : scope;
}

syncRouter.get("/queue", requireTenant, requirePermission("sync.manage"), async (req, res) => {
  const requestedBranchId = requestedBranch(req);
  const scope = resolveBranchScope(req.tenantContext!, requestedBranchId);
  if (scope.forbidden || (!canAccessAllBranches(req.tenantContext!) && !canAccessScopedBranches(req.tenantContext!) && !req.tenantContext!.branchId)) {
    res.status(403).json({ error: "Branch access denied" });
    return;
  }
  const effectiveScope = effectiveBranchScope(scope, requestedBranchId);

  const startDateValue = req.query.startDate?.toString();
  const endDateValue = req.query.endDate?.toString();
  const startDate = parseSyncDate(startDateValue);
  const endDate = parseSyncDate(endDateValue, true);

  if ((startDateValue && !startDate) || (endDateValue && !endDate)) {
    res.status(400).json({ error: "Invalid sync date range" });
    return;
  }

  if (startDate && endDate && startDate.getTime() > endDate.getTime()) {
    res.status(400).json({ error: "Start date must be before end date" });
    return;
  }

  const records = await listSyncQueue(req.tenantContext!.tenantId, {
    branchId: effectiveScope.branchId,
    branchIds: !effectiveScope.branchId ? effectiveScope.branchScopeIds : undefined,
    terminalId: req.query.terminalId?.toString(),
    status: req.query.status?.toString(),
    startDate: startDate ?? undefined,
    endDate: endDate ?? undefined
  });

  res.json({ records });
});

syncRouter.post("/queue", requireTenant, requireAnyPermission(["sale.create", "sync.manage"]), async (req, res) => {
  const parsed = syncQueueInputSchema.safeParse(req.body);

  if (!parsed.success) {
    res.status(400).json({ error: "Invalid sync queue payload", issues: parsed.error.flatten() });
    return;
  }

  const scope = resolveBranchScope(req.tenantContext!, parsed.data.branchId);
  if (scope.forbidden || (!canAccessAllBranches(req.tenantContext!) && !canAccessScopedBranches(req.tenantContext!) && !req.tenantContext!.branchId)) {
    res.status(403).json({ error: "Branch access denied" });
    return;
  }

  const result = await queueSyncRecord(req.tenantContext!.tenantId, req.tenantContext!.userId, {
    ...parsed.data,
    branchId: scope.branchId ?? parsed.data.branchId
  });

  if (result.status === "branch_not_found") {
    res.status(404).json({ error: "Sync branch not found for this tenant" });
    return;
  }

  if (result.status === "terminal_not_found") {
    res.status(404).json({ error: "Sync terminal not found for this branch" });
    return;
  }

  res.status(result.status === "created" ? 201 : 200).json({ record: result.record, status: result.status });
});

syncRouter.patch("/queue/:recordId/status", requireTenant, requirePermission("sync.manage"), async (req, res) => {
  const parsed = syncQueueStatusSchema.safeParse(req.body);

  if (!parsed.success) {
    res.status(400).json({ error: "Invalid sync status payload", issues: parsed.error.flatten() });
    return;
  }

  const requestedBranchId = requestedBranch(req);
  const scope = resolveSyncBranch(req, res);
  if (!scope) return;
  const effectiveScope = effectiveBranchScope(scope, requestedBranchId);

  const result = await updateSyncRecordStatus(
    req.tenantContext!.tenantId,
    {
      branchId: effectiveScope.branchId,
      branchIds: !effectiveScope.branchId ? effectiveScope.branchScopeIds : undefined
    },
    req.tenantContext!.userId,
    req.params.recordId.toString(),
    parsed.data
  );

  if (result.status === "not_found") {
    res.status(404).json({ error: "Sync record not found" });
    return;
  }

  if (result.status === "finalized") {
    res.status(409).json({ error: "Synced sync records cannot be changed" });
    return;
  }

  // A manager re-queued a tablet command from the Sync monitor: replay it now.
  if (parsed.data.status === "queued" && !isDemoMode) {
    void processRequeuedDeviceCommands(req.tenantContext!.tenantId).catch(() => undefined);
  }

  res.json({ record: result.record });
});

// ---------------------------------------------------------------------------
// Replication: office <-> cloud, and tablets <-> office/cloud.
// See SYNC_ARCHITECTURE.md.
// ---------------------------------------------------------------------------

const isDemoMode = process.env.NODE_ENV === "test";

function replicationUnavailable(res: Response) {
  res.status(503).json({ error: "Replication requires database mode" });
}

const pairingCreateSchema = z.object({
  kind: z.enum(["office", "device"]),
  name: z.string().trim().min(2).max(120),
  branchIds: z.array(z.string().min(1)).max(50).optional(),
  terminalId: z.string().min(1).max(80).optional()
});

const pairSchema = z.object({
  pairingCode: z.string().min(6).max(20),
  appVersion: z.string().max(40).optional()
});

const feedQuerySchema = z.object({
  cursor: z.coerce.number().int().nonnegative().default(0),
  limit: z.coerce.number().int().min(1).max(1000).optional()
});

const wireItemSchema = z.object({
  table: z.string().min(1).max(64),
  rowId: z.string().min(1).max(200),
  row: z.record(z.string(), z.unknown()).nullable(),
  changes: z.array(z.object({
    seq: z.number().int().positive(),
    op: z.enum(["I", "U", "D"]),
    fields: z.array(z.string()).nullable(),
    deltas: z.record(z.string(), z.number()).nullable(),
    changedAt: z.string().min(10)
  })).min(1)
});

const pushSchema = z.object({ items: z.array(wireItemSchema).max(2000) });

const commandsSchema = z.object({
  commands: z.array(z.object({
    id: z.string().min(8).max(120),
    type: z.enum(["register.open", "register.close", "cash_movement.create", "sale.create", "customer.create"]),
    staffId: z.string().min(1).max(80),
    createdAt: z.string().min(10),
    payload: z.record(z.string(), z.unknown())
  })).max(200)
});

const upstreamConnectSchema = z.object({
  url: z.string().url().max(300),
  pairingCode: z.string().min(6).max(20)
});

/** Public: lets a tablet confirm a URL points at a NaijaPOS server before pairing. */
syncRouter.get("/hello", async (_req, res) => {
  if (isDemoMode) {
    res.json({ product: "naijapos", role: "cloud", nodeId: "demo", time: new Date().toISOString() });
    return;
  }
  const identity = await getNodeIdentity();
  res.json({ product: "naijapos", role: identity.role, nodeId: identity.nodeId, time: new Date().toISOString() });
});

/** Public: exchanges a one-time pairing code for a node token. */
syncRouter.post("/pair", async (req, res) => {
  if (isDemoMode) return replicationUnavailable(res);
  const parsed = pairSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid pairing payload", issues: parsed.error.flatten() });
    return;
  }

  const result = await redeemPairing(parsed.data);
  if (result.status !== "paired") {
    res.status(result.status === "expired" ? 410 : 404).json({ error: result.status === "expired" ? "Pairing code expired" : "Pairing code not recognised" });
    return;
  }
  res.status(201).json(result.credentials);
});

syncRouter.get("/status", requireTenant, requirePermission("sync.manage"), async (req, res) => {
  if (isDemoMode) return replicationUnavailable(res);
  const tenantId = req.tenantContext!.tenantId;
  const [identity, peer, nodes, openConflicts, pendingCommands, head] = await Promise.all([
    getNodeIdentity(),
    prisma.syncPeer.findUnique({ where: { id: "upstream" } }),
    listSyncNodes(tenantId),
    prisma.syncConflict.count({ where: { tenantId, status: "open" } }),
    prisma.syncQueueRecord.count({ where: { tenantId, status: { in: ["queued", "failed", "conflict"] } } }),
    prisma.$queryRaw<{ seq: bigint | null }[]>`SELECT MAX(seq) AS seq FROM sync_changes`
  ]);
  res.json({
    identity: { nodeId: identity.nodeId, nodeCode: identity.nodeCode, role: identity.role },
    upstream: publicPeer(peer && peer.tenantId === tenantId ? peer : null),
    changeLogHead: head[0]?.seq ? Number(head[0].seq) : 0,
    nodes,
    openConflicts,
    pendingCommands
  });
});

syncRouter.get("/nodes", requireTenant, requirePermission("sync.manage"), async (req, res) => {
  if (isDemoMode) return replicationUnavailable(res);
  res.json({ nodes: await listSyncNodes(req.tenantContext!.tenantId) });
});

syncRouter.post("/nodes", requireTenant, requirePermission("sync.manage"), async (req, res) => {
  if (isDemoMode) return replicationUnavailable(res);
  const parsed = pairingCreateSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid node payload", issues: parsed.error.flatten() });
    return;
  }

  const result = await createPairing(req.tenantContext!.tenantId, req.tenantContext!.userId, parsed.data);
  if (result.status !== "created") {
    const messages = {
      terminal_required: "Choose the terminal this tablet will act as",
      terminal_not_found: "Terminal not found",
      branch_not_found: "Branch not found"
    };
    res.status(result.status === "terminal_required" ? 400 : 404).json({ error: messages[result.status] });
    return;
  }
  res.status(201).json({ node: result.node, pairingCode: result.pairingCode });
});

syncRouter.post("/nodes/:nodeId/revoke", requireTenant, requirePermission("sync.manage"), async (req, res) => {
  if (isDemoMode) return replicationUnavailable(res);
  const result = await revokeSyncNode(req.tenantContext!.tenantId, req.params.nodeId.toString());
  if (result.status === "not_found") {
    res.status(404).json({ error: "Node not found" });
    return;
  }
  res.json({ node: result.node });
});

syncRouter.get("/conflicts", requireTenant, requirePermission("sync.manage"), async (req, res) => {
  if (isDemoMode) return replicationUnavailable(res);
  const status = req.query.status?.toString() ?? "open";
  const conflicts = await prisma.syncConflict.findMany({
    where: { tenantId: req.tenantContext!.tenantId, ...(status === "all" ? {} : { status }) },
    orderBy: { updatedAt: "desc" },
    take: 200
  });
  res.json({
    conflicts: conflicts.map((conflict) => ({
      id: conflict.id,
      source: conflict.source,
      tableName: conflict.tableName,
      rowId: conflict.rowId,
      error: conflict.error,
      attempts: conflict.attempts,
      status: conflict.status,
      createdAt: conflict.createdAt.toISOString(),
      updatedAt: conflict.updatedAt.toISOString()
    }))
  });
});

syncRouter.post("/conflicts/:conflictId/dismiss", requireTenant, requirePermission("sync.manage"), async (req, res) => {
  if (isDemoMode) return replicationUnavailable(res);
  const updated = await prisma.syncConflict.updateMany({
    where: { tenantId: req.tenantContext!.tenantId, id: req.params.conflictId.toString(), status: "open" },
    data: { status: "dismissed", resolvedAt: new Date() }
  });
  if (!updated.count) {
    res.status(404).json({ error: "Open conflict not found" });
    return;
  }
  res.json({ status: "dismissed" });
});

// --- Office side: optional connection to the cloud ------------------------

syncRouter.post("/upstream/connect", requireTenant, requirePermission("sync.manage"), async (req, res) => {
  if (isDemoMode) return replicationUnavailable(res);
  const parsed = upstreamConnectSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid cloud connection payload", issues: parsed.error.flatten() });
    return;
  }

  try {
    const result = await connectUpstream({ ...parsed.data, localTenantId: req.tenantContext!.tenantId });
    if (result.status === "not_office") {
      res.status(409).json({ error: "Only an office server (NODE_ROLE=office) can connect to a cloud server" });
      return;
    }
    if (result.status === "wrong_kind") {
      res.status(409).json({ error: "That pairing code is for a tablet, not an office server" });
      return;
    }
    if (result.status === "tenant_mismatch") {
      res.status(409).json({ error: `The cloud business (${result.cloudTenantId}) is not this office's business` });
      return;
    }
    res.json({ upstream: result.peer });
  } catch (error) {
    res.status(502).json({ error: error instanceof Error ? error.message : "Could not reach the cloud server" });
  }
});

syncRouter.patch("/upstream", requireTenant, requirePermission("sync.manage"), async (req, res) => {
  if (isDemoMode) return replicationUnavailable(res);
  const parsed = z.object({ enabled: z.boolean() }).safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid payload" });
    return;
  }
  const peer = await prisma.syncPeer.findUnique({ where: { id: "upstream" } });
  if (!peer || peer.tenantId !== req.tenantContext!.tenantId) {
    res.status(404).json({ error: "This server is not connected to a cloud server" });
    return;
  }
  const updated = await prisma.syncPeer.update({ where: { id: peer.id }, data: { enabled: parsed.data.enabled } });
  res.json({ upstream: publicPeer(updated) });
});

syncRouter.post("/upstream/run", requireTenant, requirePermission("sync.manage"), async (req, res) => {
  if (isDemoMode) return replicationUnavailable(res);
  const peer = await prisma.syncPeer.findUnique({ where: { id: "upstream" } });
  if (!peer || peer.tenantId !== req.tenantContext!.tenantId) {
    res.status(404).json({ error: "This server is not connected to a cloud server" });
    return;
  }
  res.json({ result: await runUpstreamSync() });
});

syncRouter.delete("/upstream", requireTenant, requirePermission("sync.manage"), async (req, res) => {
  if (isDemoMode) return replicationUnavailable(res);
  await prisma.syncPeer.deleteMany({ where: { id: "upstream", tenantId: req.tenantContext!.tenantId } });
  res.json({ status: "disconnected" });
});

// --- Cloud side: called by office servers ---------------------------------

syncRouter.get("/peer/changes", requireSyncNode("office"), async (req, res) => {
  const parsed = feedQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid cursor" });
    return;
  }
  const node = req.syncNode!;
  const page = await readFeed({
    tenantId: node.tenantId,
    cursor: parsed.data.cursor,
    limit: parsed.data.limit,
    entities: entitiesFlowing("cloud"),
    excludeOrigin: node.id,
    branchIds: nodeBranchIds(node),
    mode: "peer"
  });
  void prisma.syncNode.update({ where: { id: node.id }, data: { lastPullSeq: BigInt(page.cursor) } }).catch(() => undefined);
  res.type("application/json").send(JSON.stringify(page, wireReplacer));
});

syncRouter.post("/peer/changes", requireSyncNode("office"), async (req, res) => {
  const parsed = pushSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid change batch", issues: parsed.error.flatten() });
    return;
  }
  const node = req.syncNode!;
  const summary = await applyPeerItems(
    {
      source: node.id,
      originTag: node.id,
      tenantId: node.tenantId,
      tables: new Set(entitiesFlowing("office").map((entity) => entity.table)),
      branchScope: nodeBranchIds(node)
    },
    parsed.data.items as WireItem[]
  );
  void prisma.syncNode.update({ where: { id: node.id }, data: { lastPushAt: new Date() } }).catch(() => undefined);
  res.json({ summary });
});

// --- Called by devices (tablets) ------------------------------------------

syncRouter.get("/device/changes", requireSyncNode("device"), async (req, res) => {
  const parsed = feedQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid cursor" });
    return;
  }
  const node = req.syncNode!;
  const page = await readFeed({
    tenantId: node.tenantId,
    cursor: parsed.data.cursor,
    limit: parsed.data.limit,
    entities: deviceEntities(),
    branchIds: nodeBranchIds(node) ?? [],
    mode: "device"
  });
  void prisma.syncNode.update({ where: { id: node.id }, data: { lastPullSeq: BigInt(page.cursor) } }).catch(() => undefined);
  res.type("application/json").send(JSON.stringify(page, wireReplacer));
});

syncRouter.post("/device/commands", requireSyncNode("device"), async (req, res) => {
  const parsed = commandsSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid command batch", issues: parsed.error.flatten() });
    return;
  }
  const results = await processDeviceCommands(req.syncNode!, parsed.data.commands as DeviceCommand[]);
  res.json({ results });
});
