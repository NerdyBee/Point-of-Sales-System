import type { Platform } from "../data/db";
import { readModel, type Staff } from "../data/readModel";

const maxFailures = 5;
const lockoutMs = 5 * 60 * 1000;
const failures = new Map<string, { count: number; lockedUntil?: number }>();

/**
 * Offline PIN check against the synced staff record. The server stores
 * `sha256:<hex>` (see demoSecretHash), so the tablet verifies the same way.
 */
export async function verifyPin(platform: Platform, staffId: string, pin: string): Promise<{ ok: true; staff: Staff } | { ok: false; reason: string }> {
  const state = failures.get(staffId);
  if (state?.lockedUntil && state.lockedUntil > Date.now()) {
    return { ok: false, reason: "Too many attempts. Try again in a few minutes." };
  }

  const staff = await readModel.staff(platform.db, staffId);
  if (!staff || !staff.active || !staff.pinEnabled || !staff.pinHash) return { ok: false, reason: "This staff member cannot sign in here" };

  const expected = `sha256:${await platform.sha256Hex(pin)}`;
  if (expected !== staff.pinHash) {
    const count = (state?.count ?? 0) + 1;
    failures.set(staffId, { count, lockedUntil: count >= maxFailures ? Date.now() + lockoutMs : undefined });
    return { ok: false, reason: "Wrong PIN" };
  }

  failures.delete(staffId);
  return { ok: true, staff };
}
