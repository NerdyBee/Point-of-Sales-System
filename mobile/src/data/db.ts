/**
 * Minimal async SQLite interface. The app uses expo-sqlite (see expoDb.ts); tests
 * use Node's built-in node:sqlite with the same SQL, so the sync engine and POS
 * logic are exercised for real outside the device.
 */
export type SqlValue = string | number | null;

export interface Db {
  exec(sql: string): Promise<void>;
  run(sql: string, params?: SqlValue[]): Promise<void>;
  all<T>(sql: string, params?: SqlValue[]): Promise<T[]>;
  first<T>(sql: string, params?: SqlValue[]): Promise<T | null>;
  /** Runs `work` atomically. Calls must not be nested. */
  transaction(work: () => Promise<void>): Promise<void>;
}

export interface SecretStore {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  remove(key: string): Promise<void>;
}

/** Platform services injected into the core. */
export interface Platform {
  db: Db;
  secrets: SecretStore;
  sha256Hex(value: string): Promise<string>;
  uuid(): string;
  fetch: typeof fetch;
  appVersion: string;
  /** Stable per-install device id (Android ID / iOS vendor id), used for licensing. */
  deviceId(): Promise<string>;
}
