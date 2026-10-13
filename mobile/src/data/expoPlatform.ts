import * as Application from "expo-application";
import * as Crypto from "expo-crypto";
import { Platform as RNPlatform } from "react-native";
import * as SecureStore from "expo-secure-store";
import * as SQLite from "expo-sqlite";
import type { Db, Platform, SqlValue } from "./db";

function expoDb(database: SQLite.SQLiteDatabase): Db {
  // SQLite allows one transaction at a time per connection. Queue them so two quick actions
  // (e.g. a double tap) wait their turn instead of failing with "cannot start a transaction
  // within a transaction". Transactions must not be nested (the inner one would wait forever).
  let queue: Promise<unknown> = Promise.resolve();
  return {
    exec: (sql) => database.execAsync(sql),
    run: async (sql, params: SqlValue[] = []) => {
      await database.runAsync(sql, params);
    },
    all: (sql, params: SqlValue[] = []) => database.getAllAsync(sql, params),
    first: (sql, params: SqlValue[] = []) => database.getFirstAsync(sql, params),
    transaction: (work) => {
      const next = queue.then(() => database.withTransactionAsync(work));
      queue = next.catch(() => undefined);
      return next;
    }
  };
}

/**
 * Opens the shop database on a fresh connection. expo-sqlite otherwise hands back a cached
 * connection, which Android may already have closed (after a reload, or when the app comes
 * back from the background), and every query then fails with a NullPointerException.
 * The connection is checked with a real query and retried once before giving up.
 */
async function openShopDatabase() {
  let lastError: unknown;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const database = await SQLite.openDatabaseAsync("naijapos.db", { useNewConnection: true });
      await database.execAsync("PRAGMA journal_mode = WAL;");
      await database.getFirstAsync("SELECT 1");
      return database;
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError;
}

export async function createExpoPlatform(appVersion: string): Promise<Platform> {
  const database = await openShopDatabase();
  return {
    db: expoDb(database),
    secrets: {
      get: (key) => SecureStore.getItemAsync(key),
      set: (key, value) => SecureStore.setItemAsync(key, value),
      remove: (key) => SecureStore.deleteItemAsync(key)
    },
    sha256Hex: (value) => Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, value, { encoding: Crypto.CryptoEncoding.HEX }),
    uuid: () => Crypto.randomUUID(),
    randomBytes: (length) => Crypto.getRandomBytes(length),
    fetch: (input, init) => fetch(input, init),
    appVersion,
    deviceId: async () => {
      // Android ID: unique per device + app signing key; survives reinstalls, changes after a factory reset.
      if (RNPlatform.OS === "android") return Application.getAndroidId();
      if (RNPlatform.OS === "ios") {
        const id = await Application.getIosIdForVendorAsync();
        if (id) return id;
      }
      // Fallback (web/unknown): a random id kept in secure storage.
      const stored = await SecureStore.getItemAsync("naijapos.device.fallbackId");
      if (stored) return stored;
      const created = Crypto.randomUUID();
      await SecureStore.setItemAsync("naijapos.device.fallbackId", created);
      return created;
    }
  };
}
