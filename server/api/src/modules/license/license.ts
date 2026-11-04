import { createHash, createPublicKey, verify } from "node:crypto";
import { execFileSync } from "node:child_process";
import type { NextFunction, Request, Response } from "express";
import { prisma } from "../../shared/db/prisma";
import { getNodeIdentity } from "../sync/sync.identity";
import { LICENSE_PUBLIC_KEY } from "./publicKey";

/**
 * Activation for installed servers, so one copy cannot be installed on more computers than
 * were paid for. Same scheme and signing key as the Android app (mobile/src/license):
 *
 *   the server shows a device code derived from this computer (Windows MachineGuid; on
 *   other systems, this installation's id);
 *   the vendor signs a licence for that code: `npm run license -- issue --product office ...`
 *   (in mobile/); the server only holds the public key, so it can check codes offline.
 *
 * Activation code = base64url(JSON payload) + "." + base64url(Ed25519 signature)
 *
 * The check is switched on in release builds (scripts/release/build.mjs defines
 * AJOKE_LICENSE), so it cannot be turned off from .env; running from source skips it.
 */
export interface ServerLicense {
  v: 1;
  /** Must be "office": phone licences cannot activate a server. */
  product: "office";
  id: string;
  name: string;
  device: string;
  issued: string;
  /** Last valid day (YYYY-MM-DD), or null for no expiry. */
  expires: string | null;
  /** What was paid for; a missing number means unlimited. */
  limits?: LicenseLimits;
}

export interface LicenseLimits {
  branches?: number;
  staff?: number;
  terminals?: number;
}

export type LicenseState =
  | { active: true; deviceCode: string; license: ServerLicense; daysLeft: number | null }
  | { active: false; deviceCode: string; reason: "missing" | "invalid" | "wrong_device" | "expired" | "clock"; message: string; license?: ServerLicense };

export const licenseRequired = process.env.AJOKE_LICENSE === "required";
export const licenseWarnDays = 14;

const deviceAlphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

function machineGuid() {
  if (process.platform !== "win32") return null;
  try {
    const output = execFileSync("reg", ["query", "HKLM\\SOFTWARE\\Microsoft\\Cryptography", "/v", "MachineGuid"], { encoding: "utf8", windowsHide: true });
    return output.match(/MachineGuid\s+REG_SZ\s+(\S+)/i)?.[1] ?? null;
  } catch {
    return null;
  }
}

/** XXXX-XXXX-XXXX from any raw machine id; same alphabet and layout as phone codes. */
export function deviceCodeFor(raw: string) {
  const hex = createHash("sha256").update(`ajokepos-server:${raw}`).digest("hex");
  let code = "";
  for (let index = 0; index < 12; index += 1) code += deviceAlphabet[parseInt(hex.slice(index * 2, index * 2 + 2), 16) % deviceAlphabet.length];
  return `${code.slice(0, 4)}-${code.slice(4, 8)}-${code.slice(8)}`;
}

export function normalizeDeviceCode(code: string) {
  const clean = code.toUpperCase().replace(/[^A-Z0-9]/g, "");
  return clean.length === 12 ? `${clean.slice(0, 4)}-${clean.slice(4, 8)}-${clean.slice(8)}` : code.trim().toUpperCase();
}

let cachedDeviceCode: string | null = null;

export async function serverDeviceCode() {
  // Windows: tied to the computer, so reinstalling keeps the licence but another PC needs
  // its own. Elsewhere (the cloud's Docker container): this installation's id in the database.
  cachedDeviceCode ??= deviceCodeFor(machineGuid() ?? `node:${(await getNodeIdentity()).nodeId}`);
  return cachedDeviceCode;
}

function publicKey(hex: string) {
  // Raw 32-byte Ed25519 key wrapped in the standard SPKI header Node expects.
  return createPublicKey({ key: Buffer.concat([Buffer.from("302a300506032b6570032100", "hex"), Buffer.from(hex, "hex")]), format: "der", type: "spki" });
}

function endOfDay(isoDate: string) {
  const [year, month, day] = isoDate.slice(0, 10).split("-").map(Number);
  return new Date(year, month - 1, day, 23, 59, 59, 999).getTime();
}

export function checkLicenseCode(code: string, input: { deviceCode: string; publicKeyHex?: string; now?: number; lastSeen?: number | null }): LicenseState {
  const now = input.now ?? Date.now();
  const deviceCode = input.deviceCode;
  const invalid = { active: false as const, deviceCode, reason: "invalid" as const, message: "That is not a valid activation code. Copy the whole code you were sent." };
  const [bodyPart, signaturePart, extra] = code.trim().split(".");
  if (!bodyPart || !signaturePart || extra !== undefined) return invalid;

  let body: Buffer;
  let license: ServerLicense;
  try {
    body = Buffer.from(bodyPart, "base64url");
    license = JSON.parse(body.toString("utf8")) as ServerLicense;
    if (!verify(null, body, publicKey(input.publicKeyHex ?? LICENSE_PUBLIC_KEY), Buffer.from(signaturePart, "base64url"))) return { ...invalid, message: "This activation code is not genuine or was changed." };
  } catch {
    return invalid;
  }
  if (license.v !== 1 || license.product !== "office") return { ...invalid, message: "This code is not for an Ajoke POS server (phone codes only work on phones)." };
  if (normalizeDeviceCode(license.device) !== normalizeDeviceCode(deviceCode)) {
    return { active: false, deviceCode, reason: "wrong_device", license, message: `This code is for computer ${license.device}, not this one (${deviceCode}).` };
  }
  if (input.lastSeen && now < input.lastSeen - 36 * 60 * 60 * 1000) {
    return { active: false, deviceCode, reason: "clock", license, message: "This computer's date and time look wrong. Set the correct date to continue." };
  }
  if (license.expires) {
    const end = endOfDay(license.expires);
    if (now > end) return { active: false, deviceCode, reason: "expired", license, message: `This licence expired on ${license.expires.slice(0, 10)}. Contact your supplier to renew.` };
    return { active: true, deviceCode, license, daysLeft: Math.ceil((end - now) / 86_400_000) };
  }
  return { active: true, deviceCode, license, daysLeft: null };
}

let cached: { state: LicenseState; at: number } | null = null;

export async function licenseState(fresh = false): Promise<LicenseState> {
  if (!fresh && cached && Date.now() - cached.at < 60_000) return cached.state;

  const deviceCode = await serverDeviceCode();
  await getNodeIdentity();
  const row = await prisma.syncIdentity.findUnique({ where: { id: "self" }, select: { licenseCode: true, licenseSeenAt: true } });
  const lastSeen = row?.licenseSeenAt?.getTime() ?? null;
  const state: LicenseState = row?.licenseCode
    ? checkLicenseCode(row.licenseCode, { deviceCode, lastSeen })
    : { active: false, deviceCode, reason: "missing", message: "This copy of Ajoke POS is not activated yet." };

  // Remember the latest time seen (at most hourly writes) to catch the clock being moved back.
  if (state.active && (!lastSeen || Date.now() - lastSeen > 60 * 60 * 1000)) {
    await prisma.syncIdentity.update({ where: { id: "self" }, data: { licenseSeenAt: new Date() } });
  }
  cached = { state, at: Date.now() };
  return state;
}

export async function activateLicense(code: string) {
  const deviceCode = await serverDeviceCode();
  const state = checkLicenseCode(code, { deviceCode });
  if (!state.active) return state;
  await getNodeIdentity();
  await prisma.syncIdentity.update({ where: { id: "self" }, data: { licenseCode: code.trim(), licenseSeenAt: new Date() } });
  return licenseState(true);
}

/**
 * Limits for installed copies, taken only from the signed licence so they cannot be raised
 * by editing the database (missing = unlimited). Null when activation is not enforced
 * (running from source); the business's plan limits apply then.
 */
export async function licensedLimits() {
  if (!licenseRequired) return null;
  const limits = (await licenseState()).license?.limits ?? {};
  return {
    branches: limits.branches ?? Number.POSITIVE_INFINITY,
    staff: limits.staff ?? Number.POSITIVE_INFINITY,
    terminals: limits.terminals ?? Number.POSITIVE_INFINITY
  };
}

/** Public summary for the web app (no internals of the stored code). */
export function publicLicenseState(state: LicenseState) {
  return {
    required: licenseRequired,
    active: state.active,
    deviceCode: state.deviceCode,
    reason: state.active ? undefined : state.reason,
    message: state.active ? undefined : state.message,
    licensedTo: state.license?.name,
    limits: state.license?.limits ?? {},
    expires: state.license?.expires ?? null,
    daysLeft: state.active ? state.daysLeft : null,
    warn: state.active && state.daysLeft !== null && state.daysLeft <= licenseWarnDays
  };
}

/** Blocks the API (except activation itself) until this installation is activated. */
export async function requireLicense(req: Request, res: Response, next: NextFunction) {
  if (!licenseRequired || !req.path.startsWith("/api/") || req.path.startsWith("/api/v1/license")) return next();
  try {
    const state = await licenseState();
    if (state.active) return next();
    res.status(403).json({ error: state.message, code: "license_required" });
  } catch (error) {
    next(error);
  }
}
