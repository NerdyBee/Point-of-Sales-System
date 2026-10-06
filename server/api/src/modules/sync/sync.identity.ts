import { randomBytes } from "node:crypto";
import { prisma } from "../../shared/db/prisma";

/**
 * cloud  - the online, multi-tenant server. Offices and devices sync to it.
 * office - an on-premise server for one tenant. Works fully offline; optionally
 *          syncs with the cloud (SyncPeer) when an internet connection exists.
 */
export type NodeRole = "cloud" | "office";

export function nodeRole(): NodeRole {
  return process.env.NODE_ROLE === "office" ? "office" : "cloud";
}

export function syncIntervalMs() {
  const configured = Number(process.env.SYNC_INTERVAL_MS ?? 30_000);
  return Number.isFinite(configured) ? Math.max(5_000, configured) : 30_000;
}

const codeAlphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

export function randomCode(length: number) {
  const bytes = randomBytes(length);
  return Array.from(bytes, (byte) => codeAlphabet[byte % codeAlphabet.length]).join("");
}

export interface NodeIdentity {
  nodeId: string;
  /** Short code embedded in document numbers (e.g. INV-K7QF-00012) so ids never collide across nodes. */
  nodeCode: string;
  role: NodeRole;
  triggerHash: string | null;
}

let cachedIdentity: NodeIdentity | null = null;

export async function getNodeIdentity(): Promise<NodeIdentity> {
  if (cachedIdentity) return cachedIdentity;

  const role = nodeRole();
  let identity = await prisma.syncIdentity.findUnique({ where: { id: "self" } });
  if (!identity) {
    identity = await prisma.syncIdentity.create({
      data: {
        id: "self",
        nodeId: process.env.NODE_ID?.trim() || `${role}-${randomCode(8).toLowerCase()}`,
        // The cloud keeps the legacy INV-00001 numbering unless NODE_CODE is set; every
        // office gets a code because it creates documents while disconnected.
        nodeCode: (process.env.NODE_CODE?.trim().toUpperCase() || (role === "office" ? randomCode(4) : "")).slice(0, 12),
        role
      }
    });
  }

  cachedIdentity = {
    nodeId: identity.nodeId,
    nodeCode: identity.nodeCode,
    role,
    triggerHash: identity.triggerHash
  };
  return cachedIdentity;
}

export async function setTriggerHash(hash: string) {
  await prisma.syncIdentity.update({ where: { id: "self" }, data: { triggerHash: hash } });
  if (cachedIdentity) cachedIdentity = { ...cachedIdentity, triggerHash: hash };
}

/** Prefix for sale numbers on this node, or null for the legacy global numbering. */
export async function documentNumberPrefix() {
  if (process.env.NODE_ENV === "test") return null;
  try {
    const identity = await getNodeIdentity();
    return identity.nodeCode || null;
  } catch (error) {
    // Sync tables missing (schema not pushed yet): keep selling with legacy numbering.
    if (nodeRole() === "office") console.error(`sync: no node identity, using legacy sale numbers - ${String(error)}`);
    return null;
  }
}
