/**
 * Replication helper for installers.
 *
 *   npm run sync -- setup                                 install triggers + backfill change log
 *   npm run sync -- status                                show identity, upstream and nodes
 *   npm run sync -- pair-office --name "Ikeja office"     (cloud) create an office pairing code
 *   npm run sync -- pair-device --terminal <id> --name "Tablet 1"   create a tablet pairing code
 *   npm run sync -- connect --url https://cloud.example.com --code ABCD-EFGH   (office) link to cloud
 *   npm run sync -- run                                   (office) run one push/pull cycle now
 *   npm run sync -- disconnect                            (office) remove the cloud link
 */
import { prisma } from "./shared/db/prisma";
import { connectUpstream, publicPeer, runUpstreamSync } from "./modules/sync/sync.agent";
import { getNodeIdentity } from "./modules/sync/sync.identity";
import { createPairing, listSyncNodes } from "./modules/sync/sync.nodes";
import { ensureSyncTriggers } from "./modules/sync/sync.triggers";

function option(name: string) {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? undefined : process.argv[index + 1];
}

async function tenantId() {
  const explicit = option("tenant");
  if (explicit) return explicit;
  const tenants = await prisma.tenant.findMany({ select: { id: true, name: true } });
  if (tenants.length !== 1) {
    throw new Error(`Found ${tenants.length} businesses in this database; pass --tenant <id> (${tenants.map((tenant) => tenant.id).join(", ")})`);
  }
  return tenants[0].id;
}

async function main() {
  const command = process.argv[2];

  switch (command) {
    case "setup": {
      const result = await ensureSyncTriggers({ force: true, log: console.log });
      const identity = await getNodeIdentity();
      console.log(`Triggers ${result.installed ? "installed" : "unchanged"}. Node ${identity.nodeId} (${identity.role}) code=${identity.nodeCode || "-"}`);
      break;
    }
    case "status": {
      const identity = await getNodeIdentity();
      const tenant = await tenantId();
      const peer = await prisma.syncPeer.findUnique({ where: { id: "upstream" } });
      console.log(JSON.stringify({ identity, upstream: publicPeer(peer), nodes: await listSyncNodes(tenant) }, null, 2));
      break;
    }
    case "pair-office":
    case "pair-device": {
      const kind = command === "pair-office" ? "office" : "device";
      const name = option("name") ?? (kind === "office" ? "Office server" : "Tablet");
      const branchIds = option("branches")?.split(",").filter(Boolean);
      const result = await createPairing(await tenantId(), "cli", { kind, name, branchIds, terminalId: option("terminal") });
      if (result.status !== "created") throw new Error(result.status);
      console.log(`Pairing code for ${kind} "${name}": ${result.pairingCode} (valid 24 hours)`);
      break;
    }
    case "connect": {
      const url = option("url");
      const code = option("code");
      if (!url || !code) throw new Error("Usage: connect --url <cloud url> --code <pairing code>");
      const result = await connectUpstream({ url, pairingCode: code, localTenantId: await tenantId() });
      if (result.status !== "connected") throw new Error(result.status);
      console.log("Connected to cloud. Running first sync...");
      console.log(JSON.stringify(await runUpstreamSync(), null, 2));
      break;
    }
    case "run":
      console.log(JSON.stringify(await runUpstreamSync(), null, 2));
      break;
    case "disconnect":
      await prisma.syncPeer.deleteMany({ where: { id: "upstream" } });
      console.log("Cloud link removed; this office now runs offline only.");
      break;
    default:
      console.log("Commands: setup | status | pair-office | pair-device | connect | run | disconnect");
  }
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
