import { describe, expect, it } from "vitest";
import { migrate } from "../src/data/schema";
import { nodeDb } from "./nodePlatform";

describe("database updates", () => {
  it("creates a new database and can run again safely", async () => {
    const db = nodeDb();
    await migrate(db);
    await migrate(db);
    expect((await db.first<{ version: number }>("SELECT version FROM schema_version"))?.version).toBe(2);
    expect(await db.all("SELECT * FROM schema_version")).toHaveLength(1);
    const columns = await db.all<{ name: string }>("PRAGMA table_info(shifts)");
    expect(columns.map((column) => column.name)).toContain("cashIn");
  });

  it("carries on after an update that was interrupted (column added, version not saved)", async () => {
    const db = nodeDb();
    await migrate(db);
    // What an older app left behind when it was closed half-way through the v2 update.
    await db.run("UPDATE schema_version SET version = 1");
    await migrate(db);
    expect((await db.first<{ version: number }>("SELECT version FROM schema_version"))?.version).toBe(2);
  });

  it("upgrades a device still on the first version", async () => {
    const db = nodeDb();
    await migrate(db);
    await db.exec("DROP TABLE shifts; CREATE TABLE shifts (id TEXT PRIMARY KEY, serverId TEXT, home TEXT, openedBy TEXT NOT NULL, openingBalance INTEGER NOT NULL, cashSales INTEGER NOT NULL DEFAULT 0, status TEXT NOT NULL, countedCash INTEGER, openedAt TEXT NOT NULL, closedAt TEXT)");
    await db.run("INSERT INTO shifts (id, openedBy, openingBalance, status, openedAt) VALUES ('s1', 'x', 500, 'open', '2026-10-13')");
    await db.run("UPDATE schema_version SET version = 1");
    await migrate(db);
    expect(await db.first("SELECT cashIn, openingBalance FROM shifts WHERE id = 's1'")).toEqual({ cashIn: 0, openingBalance: 500 });
  });
});
