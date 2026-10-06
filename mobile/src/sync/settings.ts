import type { Platform } from "../data/db";
import type { ServerKey, SyncMode } from "./types";

export interface ServerLink {
  url: string;
  nodeId: string;
  role: "cloud" | "office";
  pairedAt: string;
}

export interface DeviceSettings {
  mode: SyncMode;
  tenantId: string;
  tenantName: string;
  terminalId: string;
  terminalName: string;
  branchId: string;
  /** Short code used in this tablet's provisional receipt numbers. */
  deviceCode: string;
  servers: Partial<Record<ServerKey, ServerLink>>;
}

const settingsKey = "device.settings";
const tokenKey = (server: ServerKey) => `naijapos.token.${server}`;

export async function loadSettings(platform: Platform): Promise<DeviceSettings | null> {
  const row = await platform.db.first<{ value: string }>("SELECT value FROM kv WHERE key = ?", [settingsKey]);
  return row ? (JSON.parse(row.value) as DeviceSettings) : null;
}

export async function saveSettings(platform: Platform, settings: DeviceSettings) {
  await platform.db.run("INSERT INTO kv (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value", [settingsKey, JSON.stringify(settings)]);
}

export function getServerToken(platform: Platform, server: ServerKey) {
  return platform.secrets.get(tokenKey(server));
}

export async function setServerToken(platform: Platform, server: ServerKey, token: string | null) {
  if (token) await platform.secrets.set(tokenKey(server), token);
  else await platform.secrets.remove(tokenKey(server));
}

/** Servers the tablet may use, in order of preference (office LAN first). */
export function serverPreference(settings: DeviceSettings): ServerKey[] {
  const order: ServerKey[] = settings.mode === "cloud" ? ["cloud"] : settings.mode === "local" ? ["local"] : ["local", "cloud"];
  return order.filter((key) => settings.servers[key]);
}

export async function getKv(platform: Platform, key: string) {
  return (await platform.db.first<{ value: string }>("SELECT value FROM kv WHERE key = ?", [key]))?.value ?? null;
}

export async function setKv(platform: Platform, key: string, value: string) {
  await platform.db.run("INSERT INTO kv (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value", [key, value]);
}
