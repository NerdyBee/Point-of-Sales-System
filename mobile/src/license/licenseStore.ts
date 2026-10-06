import type { Platform } from "../data/db";
import { deviceCodeFor, verifyLicense, type LicenseCheck } from "./license";
import { LICENSE_PUBLIC_KEY } from "./publicKey";

/**
 * The activation code and the "last seen" clock mark live in secure storage, not in the
 * shop database, so resetting the device's data or restoring a backup keeps the licence
 * (and a backup restored on another phone does not carry it).
 */
const codeKey = "naijapos.license.code";
const lastSeenKey = "naijapos.license.lastSeen";

export interface LicenseState {
  deviceCode: string;
  check: LicenseCheck | null;
}

export async function deviceCode(platform: Platform) {
  return deviceCodeFor(await platform.deviceId(), platform.sha256Hex);
}

export async function loadLicense(platform: Platform, publicKeyHex = LICENSE_PUBLIC_KEY): Promise<LicenseState> {
  const code = await deviceCode(platform);
  const stored = await platform.secrets.get(codeKey);
  if (!stored) return { deviceCode: code, check: null };
  const lastSeen = Number((await platform.secrets.get(lastSeenKey)) ?? 0) || null;
  const check = verifyLicense(stored, { publicKeyHex, deviceCode: code, lastSeen });
  if (check.ok && (!lastSeen || Date.now() > lastSeen)) await platform.secrets.set(lastSeenKey, String(Date.now()));
  return { deviceCode: code, check };
}

/** Checks a pasted activation code and stores it only if it is valid for this device. */
export async function activateLicense(platform: Platform, activationCode: string, publicKeyHex = LICENSE_PUBLIC_KEY) {
  const code = await deviceCode(platform);
  const lastSeen = Number((await platform.secrets.get(lastSeenKey)) ?? 0) || null;
  const check = verifyLicense(activationCode, { publicKeyHex, deviceCode: code, lastSeen });
  if (check.ok) {
    await platform.secrets.set(codeKey, activationCode.trim());
    await platform.secrets.set(lastSeenKey, String(Math.max(Date.now(), lastSeen ?? 0)));
  }
  return check;
}
