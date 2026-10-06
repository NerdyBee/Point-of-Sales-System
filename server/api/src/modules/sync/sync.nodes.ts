import type { SyncNode } from "@prisma/client";
import { createHash, randomBytes } from "node:crypto";
import type { NextFunction, Request, Response } from "express";
import { prisma } from "../../shared/db/prisma";
import { getNodeIdentity, randomCode } from "./sync.identity";

export type SyncNodeKind = "office" | "device";

const pairingTtlMs = 24 * 60 * 60 * 1000;
const seenWriteIntervalMs = 60 * 1000;

declare global {
  namespace Express {
    interface Request {
      syncNode?: SyncNode;
    }
  }
}

export function hashSecret(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function normalizePairingCode(code: string) {
  return code.replace(/[^A-Za-z0-9]/g, "").toUpperCase();
}

export function nodeBranchIds(node: Pick<SyncNode, "branchIds">): string[] | null {
  const ids = Array.isArray(node.branchIds) ? (node.branchIds as unknown[]).map(String).filter(Boolean) : [];
  return ids.length ? ids : null;
}

export function publicNode(node: SyncNode) {
  return {
    id: node.id,
    tenantId: node.tenantId,
    kind: node.kind as SyncNodeKind,
    name: node.name,
    nodeCode: node.nodeCode,
    branchIds: nodeBranchIds(node) ?? [],
    terminalId: node.terminalId ?? undefined,
    status: node.status,
    pairingExpiresAt: node.pairingExpiresAt?.toISOString(),
    appVersion: node.appVersion ?? undefined,
    lastSeenAt: node.lastSeenAt?.toISOString(),
    lastPullSeq: node.lastPullSeq === null ? undefined : Number(node.lastPullSeq),
    lastPushAt: node.lastPushAt?.toISOString(),
    createdBy: node.createdBy,
    createdAt: node.createdAt.toISOString()
  };
}

export async function listSyncNodes(tenantId: string) {
  const nodes = await prisma.syncNode.findMany({ where: { tenantId }, orderBy: { createdAt: "desc" } });
  return nodes.map(publicNode);
}

export async function createPairing(
  tenantId: string,
  createdBy: string,
  input: { kind: SyncNodeKind; name: string; branchIds?: string[]; terminalId?: string }
) {
  let branchIds = input.branchIds?.filter(Boolean) ?? [];
  if (input.kind === "device") {
    if (!input.terminalId) return { status: "terminal_required" as const };
    const terminal = await prisma.terminal.findFirst({ where: { tenantId, id: input.terminalId } });
    if (!terminal) return { status: "terminal_not_found" as const };
    branchIds = [terminal.branchId];
  } else if (branchIds.length) {
    const found = await prisma.branch.count({ where: { tenantId, id: { in: branchIds } } });
    if (found !== branchIds.length) return { status: "branch_not_found" as const };
  }

  const pairingCode = randomCode(8);
  const node = await prisma.syncNode.create({
    data: {
      id: `${input.kind}-${randomCode(10).toLowerCase()}`,
      tenantId,
      kind: input.kind,
      name: input.name.trim(),
      nodeCode: randomCode(4),
      branchIds,
      terminalId: input.kind === "device" ? input.terminalId : null,
      status: "pending",
      pairingCodeHash: hashSecret(pairingCode),
      pairingExpiresAt: new Date(Date.now() + pairingTtlMs),
      createdBy
    }
  });

  return { status: "created" as const, node: publicNode(node), pairingCode: `${pairingCode.slice(0, 4)}-${pairingCode.slice(4)}` };
}

/** Exchanges a one-time pairing code for a long-lived node token. */
export async function redeemPairing(input: { pairingCode: string; appVersion?: string }) {
  const node = await prisma.syncNode.findUnique({ where: { pairingCodeHash: hashSecret(normalizePairingCode(input.pairingCode)) } });
  if (!node || node.status !== "pending") return { status: "invalid_code" as const };
  if (node.pairingExpiresAt && node.pairingExpiresAt.getTime() < Date.now()) return { status: "expired" as const };

  const token = `nps_${randomBytes(32).toString("base64url")}`;
  const activated = await prisma.syncNode.update({
    where: { id: node.id },
    data: {
      status: "active",
      tokenHash: hashSecret(token),
      pairingCodeHash: null,
      pairingExpiresAt: null,
      appVersion: input.appVersion?.slice(0, 40),
      lastSeenAt: new Date()
    }
  });

  const [tenant, identity, terminal] = await Promise.all([
    prisma.tenant.findUnique({ where: { id: node.tenantId }, select: { id: true, name: true } }),
    getNodeIdentity(),
    node.terminalId ? prisma.terminal.findUnique({ where: { id: node.terminalId } }) : null
  ]);

  return {
    status: "paired" as const,
    credentials: {
      token,
      node: publicNode(activated),
      tenant,
      terminal: terminal ? { id: terminal.id, name: terminal.name, branchId: terminal.branchId } : undefined,
      server: { nodeId: identity.nodeId, role: identity.role }
    }
  };
}

export async function revokeSyncNode(tenantId: string, nodeId: string) {
  const node = await prisma.syncNode.findFirst({ where: { tenantId, id: nodeId } });
  if (!node) return { status: "not_found" as const };
  const revoked = await prisma.syncNode.update({
    where: { id: node.id },
    data: { status: "revoked", tokenHash: null, pairingCodeHash: null }
  });
  return { status: "revoked" as const, node: publicNode(revoked) };
}

/** Authenticates offices/devices by the `x-sync-token` header. */
export function requireSyncNode(kind: SyncNodeKind) {
  return async (req: Request, res: Response, next: NextFunction) => {
    if (process.env.NODE_ENV === "test") {
      res.status(503).json({ error: "Replication requires database mode" });
      return;
    }

    const token = req.header("x-sync-token")?.trim();
    if (!token) {
      res.status(401).json({ error: "Sync token is required" });
      return;
    }

    try {
      const node = await prisma.syncNode.findUnique({ where: { tokenHash: hashSecret(token) } });
      if (!node || node.status !== "active") {
        res.status(401).json({ error: "Sync token is invalid or revoked" });
        return;
      }
      if (node.kind !== kind) {
        res.status(403).json({ error: `This endpoint is for ${kind} nodes` });
        return;
      }

      req.syncNode = node;
      if (!node.lastSeenAt || Date.now() - node.lastSeenAt.getTime() > seenWriteIntervalMs) {
        const appVersion = req.header("x-app-version")?.slice(0, 40);
        void prisma.syncNode.update({ where: { id: node.id }, data: { lastSeenAt: new Date(), ...(appVersion ? { appVersion } : {}) } }).catch(() => undefined);
      }
      next();
    } catch (error) {
      next(error);
    }
  };
}
