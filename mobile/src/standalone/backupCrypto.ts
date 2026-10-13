import { xchacha20poly1305 } from "@noble/ciphers/chacha.js";
import { ed25519, x25519 } from "@noble/curves/ed25519.js";
import { pbkdf2Async } from "@noble/hashes/pbkdf2.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { fromBase64Url, hexToBytes, toBase64Url } from "../license/license";

/**
 * Locked (encrypted) backup files.
 *
 * The shop's records are encrypted with a random data key (XChaCha20-Poly1305). The data key
 * is stored in the file twice, each copy locked separately:
 *   - with a key derived from the owner's backup password (PBKDF2-SHA256), and
 *   - for recovery, to the vendor's licence key (X25519, converted from the Ed25519 key), so
 *     Ajoke Code Sphere can open it with `npm run license -- open-backup` if the password is lost.
 * Without the password or the vendor's private key the file is unreadable.
 */

export const PASSWORD_ITERATIONS = 100_000;
const vendorContext = new TextEncoder().encode("naijapos-backup-vendor-v1");

/** The owner's password turned into a key (kept on the phone so later backups need no prompt). */
export interface PasswordKey {
  salt: string;
  iterations: number;
  key: string;
}

export interface LockedPayload {
  cipher: "xchacha20poly1305";
  /** nonce + ciphertext of the backup contents. */
  data: string;
  keys: {
    password: { kdf: "pbkdf2-sha256"; iterations: number; salt: string; wrapped: string };
    vendor: { alg: "x25519"; ephemeral: string; wrapped: string };
  };
}

export class WrongBackupPassword extends Error {
  constructor() {
    super("That backup password is not right. Check it and try again. If it is lost, Ajoke Code Sphere can unlock the backup for you.");
  }
}

const concat = (...parts: Uint8Array[]) => {
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
};

/** nonce (24 bytes) + ciphertext. */
function seal(key: Uint8Array, plaintext: Uint8Array, random: (length: number) => Uint8Array) {
  const nonce = random(24);
  return concat(nonce, xchacha20poly1305(key, nonce).encrypt(plaintext));
}

function unseal(key: Uint8Array, sealed: Uint8Array) {
  return xchacha20poly1305(key, sealed.subarray(0, 24)).decrypt(sealed.subarray(24));
}

export async function derivePasswordKey(password: string, salt: Uint8Array, iterations = PASSWORD_ITERATIONS) {
  return pbkdf2Async(sha256, new TextEncoder().encode(password.normalize("NFKC")), salt, { c: iterations, dkLen: 32, asyncTick: 20 });
}

export async function newPasswordKey(password: string, random: (length: number) => Uint8Array): Promise<PasswordKey> {
  const salt = random(16);
  return { salt: toBase64Url(salt), iterations: PASSWORD_ITERATIONS, key: toBase64Url(await derivePasswordKey(password, salt)) };
}

function vendorKek(shared: Uint8Array, ephemeralPublic: Uint8Array, vendorMontgomery: Uint8Array) {
  return sha256(concat(vendorContext, shared, ephemeralPublic, vendorMontgomery));
}

/** Encrypts the backup contents for the owner's password and the vendor's recovery key. */
export function lockBackup(contents: string, input: { passwordKey: PasswordKey; vendorPublicKeyHex: string; random: (length: number) => Uint8Array }): LockedPayload {
  const dataKey = input.random(32);
  const vendorMontgomery = ed25519.utils.toMontgomery(hexToBytes(input.vendorPublicKeyHex));
  const ephemeralSecret = input.random(32);
  const ephemeralPublic = x25519.getPublicKey(ephemeralSecret);
  const kek = vendorKek(x25519.getSharedSecret(ephemeralSecret, vendorMontgomery), ephemeralPublic, vendorMontgomery);
  return {
    cipher: "xchacha20poly1305",
    data: toBase64Url(seal(dataKey, new TextEncoder().encode(contents), input.random)),
    keys: {
      password: {
        kdf: "pbkdf2-sha256",
        iterations: input.passwordKey.iterations,
        salt: input.passwordKey.salt,
        wrapped: toBase64Url(seal(fromBase64Url(input.passwordKey.key), dataKey, input.random))
      },
      vendor: { alg: "x25519", ephemeral: toBase64Url(ephemeralPublic), wrapped: toBase64Url(seal(kek, dataKey, input.random)) }
    }
  };
}

/** Opens a locked backup with the owner's password. Returns the contents and the password key. */
export async function unlockWithPassword(locked: LockedPayload, password: string) {
  const { salt, iterations, wrapped } = locked.keys.password;
  const key = await derivePasswordKey(password, fromBase64Url(salt), iterations);
  let dataKey: Uint8Array;
  try {
    dataKey = unseal(key, fromBase64Url(wrapped));
  } catch {
    throw new WrongBackupPassword();
  }
  const contents = new TextDecoder().decode(unseal(dataKey, fromBase64Url(locked.data)));
  const passwordKey: PasswordKey = { salt, iterations, key: toBase64Url(key) };
  return { contents, passwordKey };
}

/** Vendor side (scripts/license.ts open-backup): opens a locked backup with the licence private key. */
export function unlockWithVendorKey(locked: LockedPayload, vendorSecretKeyHex: string) {
  const secret = hexToBytes(vendorSecretKeyHex);
  const vendorMontgomery = ed25519.utils.toMontgomery(ed25519.getPublicKey(secret));
  const ephemeralPublic = fromBase64Url(locked.keys.vendor.ephemeral);
  const kek = vendorKek(x25519.getSharedSecret(ed25519.utils.toMontgomerySecret(secret), ephemeralPublic), ephemeralPublic, vendorMontgomery);
  let dataKey: Uint8Array;
  try {
    dataKey = unseal(kek, fromBase64Url(locked.keys.vendor.wrapped));
  } catch {
    throw new Error("This backup was not locked with your licence key (made with a different key, or the file is damaged).");
  }
  return new TextDecoder().decode(unseal(dataKey, fromBase64Url(locked.data)));
}
