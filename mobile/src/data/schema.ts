import type { Db } from "./db";

/**
 * Local database layout.
 *
 * rows       Read model mirrored from the server (products, staff, tenant settings,
 *            shifts, sales...). Stored as JSON documents keyed by (table, id) so the
 *            tablet keeps working when the server adds columns.
 * outbox     Commands captured on the tablet, sent in order when a server is reachable.
 * shifts     Register shifts as the tablet knows them (opened offline or adopted).
 * sales      Sales rung up on this tablet, with their sync state.
 * id_map     Tablet-local ids (local-...) -> server ids, learned from command results.
 * kv         Device settings and sync cursors.
 */
const migrations: (string | ((db: Db) => Promise<void>))[] = [
  `CREATE TABLE IF NOT EXISTS kv (key TEXT PRIMARY KEY, value TEXT NOT NULL);
   CREATE TABLE IF NOT EXISTS rows (
     tbl TEXT NOT NULL,
     id TEXT NOT NULL,
     branchId TEXT,
     data TEXT NOT NULL,
     updatedAt TEXT NOT NULL,
     PRIMARY KEY (tbl, id)
   );
   CREATE INDEX IF NOT EXISTS rows_tbl_branch ON rows (tbl, branchId);
   CREATE TABLE IF NOT EXISTS outbox (
     seq INTEGER PRIMARY KEY AUTOINCREMENT,
     id TEXT NOT NULL UNIQUE,
     type TEXT NOT NULL,
     staffId TEXT NOT NULL,
     payload TEXT NOT NULL,
     createdAt TEXT NOT NULL,
     shiftLocalId TEXT,
     status TEXT NOT NULL DEFAULT 'pending',
     target TEXT,
     attempts INTEGER NOT NULL DEFAULT 0,
     nextAttemptAt TEXT,
     error TEXT,
     serverEntityId TEXT,
     syncedAt TEXT
   );
   CREATE INDEX IF NOT EXISTS outbox_status ON outbox (status, seq);
   CREATE TABLE IF NOT EXISTS shifts (
     id TEXT PRIMARY KEY,
     serverId TEXT,
     home TEXT,
     openedBy TEXT NOT NULL,
     openingBalance INTEGER NOT NULL,
     cashSales INTEGER NOT NULL DEFAULT 0,
     status TEXT NOT NULL,
     countedCash INTEGER,
     openedAt TEXT NOT NULL,
     closedAt TEXT
   );
   CREATE TABLE IF NOT EXISTS sales (
     id TEXT PRIMARY KEY,
     number TEXT NOT NULL,
     shiftId TEXT NOT NULL,
     idempotencyKey TEXT NOT NULL UNIQUE,
     staffId TEXT NOT NULL,
     customerId TEXT,
     data TEXT NOT NULL,
     total INTEGER NOT NULL,
     status TEXT NOT NULL,
     serverId TEXT,
     reconciled INTEGER NOT NULL DEFAULT 0,
     createdAt TEXT NOT NULL
   );
   CREATE INDEX IF NOT EXISTS sales_created ON sales (createdAt);
   CREATE TABLE IF NOT EXISTS id_map (localId TEXT PRIMARY KEY, serverId TEXT NOT NULL);`,
  // v2: cash received for customer account payments, counted in the drawer.
  async (db) => {
    // Skip if an earlier, interrupted start already added the column.
    const columns = await db.all<{ name: string }>("PRAGMA table_info(shifts)");
    if (!columns.some((column) => column.name === "cashIn")) await db.exec("ALTER TABLE shifts ADD COLUMN cashIn INTEGER NOT NULL DEFAULT 0;");
  },
  // v3: cash paid out of the drawer for expenses.
  async (db) => {
    const columns = await db.all<{ name: string }>("PRAGMA table_info(shifts)");
    if (!columns.some((column) => column.name === "cashOut")) await db.exec("ALTER TABLE shifts ADD COLUMN cashOut INTEGER NOT NULL DEFAULT 0;");
  }
];

/**
 * Brings the database up to date. Each step and its version number are saved together, so
 * an app closed half-way through an update simply carries on from that step next time.
 */
export async function migrate(db: Db) {
  await db.exec("CREATE TABLE IF NOT EXISTS schema_version (version INTEGER NOT NULL)");
  if (!(await db.first("SELECT version FROM schema_version"))) await db.run("INSERT INTO schema_version (version) VALUES (0)");
  const current = (await db.first<{ version: number }>("SELECT version FROM schema_version"))?.version ?? 0;
  for (let index = current; index < migrations.length; index += 1) {
    const step = migrations[index];
    await db.transaction(async () => {
      if (typeof step === "string") await db.exec(step);
      else await step(db);
      await db.run("UPDATE schema_version SET version = ?", [index + 1]);
    });
  }
}

/** Wipes everything (used by "Reset device"). */
export async function resetLocalData(db: Db) {
  await db.exec("DELETE FROM kv; DELETE FROM rows; DELETE FROM outbox; DELETE FROM shifts; DELETE FROM sales; DELETE FROM id_map;");
}
