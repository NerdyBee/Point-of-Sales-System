import type { Db, Platform } from "../data/db";
import { loadSettings } from "../sync/settings";

/** Low-level helpers shared by the standalone modules (business, credit, inventory). */

export const now = () => new Date().toISOString();

export async function putRow(db: Db, table: string, id: string, data: Record<string, unknown>, branchId: string | null = null) {
  await db.run(
    `INSERT INTO rows (tbl, id, branchId, data, updatedAt) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(tbl, id) DO UPDATE SET branchId = excluded.branchId, data = excluded.data, updatedAt = excluded.updatedAt`,
    [table, id, branchId, JSON.stringify(data), now()]
  );
}

export async function getRow<T>(db: Db, table: string, id: string) {
  const row = await db.first<{ data: string }>("SELECT data FROM rows WHERE tbl = ? AND id = ?", [table, id]);
  return row ? (JSON.parse(row.data) as T) : null;
}

/** Settings of a standalone device; throws in server-connected modes. */
export async function context(platform: Platform) {
  const settings = await loadSettings(platform);
  if (!settings || settings.mode !== "standalone") throw new Error("Only available when the device runs on its own");
  return settings;
}
