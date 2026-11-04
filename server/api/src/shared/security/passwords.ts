import { createHash, randomBytes, scrypt, timingSafeEqual, type ScryptOptions } from "node:crypto";

/**
 * Staff password hashing: salted scrypt, stored as `scrypt$N$r$p$<salt>$<hash>` (base64url).
 *
 * Older records hold unsalted `sha256:<hex>` (see demoSecretHash); they still verify, and
 * `needsPasswordRehash` tells the login to upgrade them. PINs stay `sha256:` because tablets
 * verify them offline the same way (mobile/src/auth/pin.ts).
 */
const cost = { N: 16384, r: 8, p: 1 };
const keyLength = 32;

function derive(secret: string, salt: Buffer, options: ScryptOptions) {
  return new Promise<Buffer>((resolve, reject) => {
    scrypt(secret, salt, keyLength, { ...options, maxmem: 64 * 1024 * 1024 }, (error, key) => (error ? reject(error) : resolve(key)));
  });
}

function sameBytes(left: Buffer, right: Buffer) {
  return left.length === right.length && timingSafeEqual(left, right);
}

export async function hashPassword(password: string) {
  const salt = randomBytes(16);
  const key = await derive(password, salt, cost);
  return `scrypt$${cost.N}$${cost.r}$${cost.p}$${salt.toString("base64url")}$${key.toString("base64url")}`;
}

export async function verifyPassword(password: string, stored?: string | null) {
  if (!stored) return false;

  if (stored.startsWith("scrypt$")) {
    const [, n, r, p, salt, hash] = stored.split("$");
    if (!salt || !hash) return false;
    const key = await derive(password, Buffer.from(salt, "base64url"), { N: Number(n), r: Number(r), p: Number(p) });
    return sameBytes(key, Buffer.from(hash, "base64url"));
  }

  if (stored.startsWith("sha256:")) {
    const legacy = `sha256:${createHash("sha256").update(password).digest("hex")}`;
    return sameBytes(Buffer.from(legacy), Buffer.from(stored));
  }

  return false;
}

export function needsPasswordRehash(stored?: string | null) {
  return Boolean(stored) && !stored!.startsWith(`scrypt$${cost.N}$${cost.r}$${cost.p}$`);
}
