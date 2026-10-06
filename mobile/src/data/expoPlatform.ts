import * as Application from "expo-application";
import * as Crypto from "expo-crypto";
import { Platform as RNPlatform } from "react-native";
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
