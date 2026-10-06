import { createApp } from "./app";
import { startSyncAgent } from "./modules/sync/sync.agent";
import { getNodeIdentity } from "./modules/sync/sync.identity";
import { ensureSyncTriggers } from "./modules/sync/sync.triggers";

export const apiModules = [
  "tenants",
  "branches",
  "auth",
  "catalog",
  "orders",
  "payments",
  "inventory",
  "purchasing",
  "registers",
  "reports",
  "subscriptions",
  "audit",
  "sync"
];

const port = Number(process.env.PORT ?? 4000);
const host = process.env.HOST ?? "0.0.0.0";

async function prepareReplication() {
  try {
    const identity = await getNodeIdentity();
    await ensureSyncTriggers({ log: (message) => console.log(message) });
    console.log(`sync: node ${identity.nodeId} (${identity.role}${identity.nodeCode ? `, code ${identity.nodeCode}` : ""})`);
    startSyncAgent();
  } catch (error) {
    // The POS keeps working without replication; this usually means the sync tables
    // are missing (run `npm run db:push`) or the DB user lacks the TRIGGER privilege.
    console.error(`sync: replication disabled - ${error instanceof Error ? error.message : String(error)}`);
  }
}

if (process.env.NODE_ENV !== "test") {
  void prepareReplication().finally(() => {
    createApp().listen(port, host, () => {
      console.log(`NaijaPOS API listening on http://${host === "0.0.0.0" ? "127.0.0.1" : host}:${port}`);
    });
  });
}
