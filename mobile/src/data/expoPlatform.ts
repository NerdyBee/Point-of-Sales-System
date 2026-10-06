import * as Crypto from "expo-crypto";
import * as SecureStore from "expo-secure-store";
import * as SQLite from "expo-sqlite";
import type { Db, Platform, SqlValue } from "./db";

function expoDb(database: SQLite.SQLiteDatabase): Db {
  return {
    exec: (sql) => database.execAsync(sql),
    run: async (sql, params: SqlValue[] = []) => {
      await database.runAsync(sql, params);
    },
    all: (sql, params: SqlValue[] = []) => database.getAllAsync(sql, params),
    first: (sql, params: SqlValue[] = []) => database.getFirstAsync(sql, params),
    transaction: (work) => database.withTransactionAsync(work)
  };
}

export async function createExpoPlatform(appVersion: string): Promise<Platform> {
  const database = await SQLite.openDatabaseAsync("naijapos.db");
  await database.execAsync("PRAGMA journal_mode = WAL;");
  return {
    db: expoDb(database),
    secrets: {
      get: (key) => SecureStore.getItemAsync(key),
      set: (key, value) => SecureStore.setItemAsync(key, value),
      remove: (key) => SecureStore.deleteItemAsync(key)
    },
    sha256Hex: (value) => Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, value, { encoding: Crypto.CryptoEncoding.HEX }),
    uuid: () => Crypto.randomUUID(),
    fetch: (input, init) => fetch(input, init),
    appVersion
  };
}
