/// <reference types="node" />
import { createHash, randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import type { Db, Platform, SqlValue } from "../src/data/db";
import { migrate } from "../src/data/schema";

/** node:sqlite implementation of the app's Db interface, for tests. */
export function nodeDb(file = ":memory:"): Db {
  const database = new DatabaseSync(file);
  const normalize = <T>(row: unknown) => (row ? ({ ...(row as object) } as T) : null);
  return {
    exec: async (sql) => {
      database.exec(sql);
    },
    run: async (sql, params: SqlValue[] = []) => {
      database.prepare(sql).run(...params);
    },
    all: async <T>(sql: string, params: SqlValue[] = []) => database.prepare(sql).all(...params).map((row: unknown) => normalize<T>(row)!),
    first: async <T>(sql: string, params: SqlValue[] = []) => normalize<T>(database.prepare(sql).get(...params)),
    transaction: async (work) => {
      database.exec("BEGIN");
      try {
        await work();
        database.exec("COMMIT");
      } catch (error) {
        database.exec("ROLLBACK");
        throw error;
      }
    }
  };
}

export async function nodePlatform(): Promise<Platform> {
  const db = nodeDb();
  await migrate(db);
  const secrets = new Map<string, string>();
  return {
    db,
    secrets: {
      get: async (key) => secrets.get(key) ?? null,
      set: async (key, value) => {
        secrets.set(key, value);
      },
      remove: async (key) => {
        secrets.delete(key);
      }
    },
    sha256Hex: async (value) => createHash("sha256").update(value).digest("hex"),
    uuid: () => randomUUID(),
    fetch: (input, init) => fetch(input, init),
    appVersion: "test"
  };
}
