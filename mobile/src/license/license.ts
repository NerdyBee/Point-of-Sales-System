import { ed25519 } from "@noble/curves/ed25519.js";

/**
 * Device-locked licences.
 *
 * The app shows a device code derived from the phone's ID. The vendor signs a licence for
 * that exact code with a private Ed25519 key (scripts/license.ts); the app only holds the
 * public key, so it can check activation codes offline but nobody can create them.
 *
 * Activation code = base64url(JSON payload) + "." + base64url(signature)
 */

export interface LicensePayload {
  /** Format version. */
  v: 1;
  /** Licence id, for the vendor's records. */
  id: string;
  /** Shop / customer the licence was sold to. */
  name: string;
  /** Device code this licence is locked to. */
  device: string;
  /** ISO date issued. */
  issued: string;
  /** ISO date (end of that day) after which the app locks, or null for no expiry. */
  expires: string | null;
}

export type LicenseCheck =
  | { ok: true; license: LicensePayload; daysLeft: number | null }
  | { ok: false; reason: "malformed" | "signature" | "wrong_device" | "expired" | "clock"; license?: LicensePayload; message: string };

const deviceAlphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

/** Turns the phone's raw id into a short, readable, non-reversible code: XXXX-XXXX-XXXX. */
export async function deviceCodeFor(rawDeviceId: string, sha256Hex: (value: string) => Promise<string>) {
  const hex = await sha256Hex(`naijapos-device:${rawDeviceId}`);
  let code = "";
  for (let index = 0; index < 12; index += 1) code += deviceAlphabet[parseInt(hex.slice(index * 2, index * 2 + 2), 16) % deviceAlphabet.length];
  return `${code.slice(0, 4)}-${code.slice(4, 8)}-${code.slice(8)}`;
}

export function normalizeDeviceCode(code: string) {
  const clean = code.toUpperCase().replace(/[^A-Z0-9]/g, "");
  return clean.length === 12 ? `${clean.slice(0, 4)}-${clean.slice(4, 8)}-${clean.slice(8)}` : code.trim().toUpperCase();
}

// ----- base64url (no Buffer in React Native) ---------------------------------------------

const b64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

export function toBase64Url(bytes: Uint8Array) {
  let out = "";
  for (let index = 0; index < bytes.length; index += 3) {
    const a = bytes[index];
    const b = bytes[index + 1];
    const c = bytes[index + 2];
    out += b64[a >> 2] + b64[((a & 3) << 4) | ((b ?? 0) >> 4)];
    if (b !== undefined) out += b64[((b & 15) << 2) | ((c ?? 0) >> 6)];
    if (c !== undefined) out += b64[c & 63];
  }
  return out;
}

export function fromBase64Url(text: string) {
  const clean = text.replace(/[^A-Za-z0-9_-]/g, "");
  const bytes: number[] = [];
  let buffer = 0;
  let bits = 0;
  for (const char of clean) {
    const value = b64.indexOf(char);
    if (value < 0) throw new Error("bad base64url");
    buffer = (buffer << 6) | value;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      bytes.push((buffer >> bits) & 0xff);
    }
  }
  return Uint8Array.from(bytes);
}

const utf8 = (text: string) => new TextEncoder().encode(text);
const fromUtf8 = (bytes: Uint8Array) => new TextDecoder().decode(bytes);

export function hexToBytes(hex: string) {
  const clean = hex.trim();
  if (!/^[0-9a-f]*$/i.test(clean) || clean.length % 2) throw new Error("bad hex");
  return Uint8Array.from(clean.match(/../g) ?? [], (pair) => parseInt(pair, 16));
}

export function bytesToHex(bytes: Uint8Array) {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

// ----- issue / verify ---------------------------------------------------------------------

/** Vendor side: signs a licence (used by scripts/license.ts and tests). */
export function issueLicense(secretKeyHex: string, payload: LicensePayload) {
  const body = utf8(JSON.stringify(payload));
  const signature = ed25519.sign(body, hexToBytes(secretKeyHex));
  return `${toBase64Url(body)}.${toBase64Url(signature)}`;
}

export function publicKeyFor(secretKeyHex: string) {
  return bytesToHex(ed25519.getPublicKey(hexToBytes(secretKeyHex)));
}

function endOfDay(isoDate: string) {
  const [year, month, day] = isoDate.slice(0, 10).split("-").map(Number);
  return new Date(year, month - 1, day, 23, 59, 59, 999).getTime();
}

/**
 * App side: checks an activation code against this device. `lastSeen` is the latest time
 * the app has run; a clock far behind it means the date was moved back to dodge expiry.
 */
export function verifyLicense(code: string, input: { publicKeyHex: string; deviceCode: string; now?: number; lastSeen?: number | null }): LicenseCheck {
  const now = input.now ?? Date.now();
  const [bodyPart, signaturePart, extra] = code.trim().split(".");
  if (!bodyPart || !signaturePart || extra !== undefined) return { ok: false, reason: "malformed", message: "That is not a valid activation code. Copy the whole code you were sent." };

  let body: Uint8Array;
  let license: LicensePayload;
  try {
    body = fromBase64Url(bodyPart);
    license = JSON.parse(fromUtf8(body)) as LicensePayload;
  } catch {
    return { ok: false, reason: "malformed", message: "That is not a valid activation code. Copy the whole code you were sent." };
  }

  let valid = false;
  try {
    valid = ed25519.verify(fromBase64Url(signaturePart), body, hexToBytes(input.publicKeyHex));
  } catch {
    valid = false;
  }
  if (!valid || license.v !== 1) return { ok: false, reason: "signature", message: "This activation code is not genuine or was changed." };

  if (normalizeDeviceCode(license.device) !== normalizeDeviceCode(input.deviceCode)) {
    return { ok: false, reason: "wrong_device", license, message: `This code is for device ${license.device}, not this device (${input.deviceCode}).` };
  }

  if (input.lastSeen && now < input.lastSeen - 36 * 60 * 60 * 1000) {
    return { ok: false, reason: "clock", license, message: "The phone's date and time look wrong. Set the correct date to continue." };
  }

  if (license.expires) {
    const end = endOfDay(license.expires);
    if (now > end) return { ok: false, reason: "expired", license, message: `This licence expired on ${license.expires.slice(0, 10)}. Contact your supplier to renew.` };
    return { ok: true, license, daysLeft: Math.ceil((end - now) / 86_400_000) };
  }
  return { ok: true, license, daysLeft: null };
}
