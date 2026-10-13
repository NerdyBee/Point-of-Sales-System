import type { Platform } from "../data/db";
import { readModel, type Staff } from "../data/readModel";

const maxFailures = 5;
const lockoutMs = 5 * 60 * 1000;

interface FailureState {
  count: number;
  lockedUntil?: number;
}

/**
 * Wrong-PIN attempts are kept in the device database (not memory), so closing and reopening
 * the app does not reset the lockout. After 5 wrong tries the person waits 5 minutes; each
 * further wrong try locks again until a correct PIN is entered.
 */
const failureKey = (staffId: string) => `pin.failures.${staffId}`;

async function loadFailures(platform: Platform, staffId: string): Promise<FailureState | null> {
  try {
    const row = await platform.db.first<{ value: string }>("SELECT value FROM kv WHERE key = ?", [failureKey(staffId)]);
    return row ? (JSON.parse(row.value) as FailureState) : null;
  } catch {
    return null;
  }
}

async function saveFailures(platform: Platform, staffId: string, state: FailureState | null) {
  if (!state) {
    await platform.db.run("DELETE FROM kv WHERE key = ?", [failureKey(staffId)]);
    return;
  }
  await platform.db.run("INSERT INTO kv (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value", [failureKey(staffId), JSON.stringify(state)]);
}

/**
 * Offline PIN check against the synced staff record. The server stores
 * `sha256:<hex>` (see demoSecretHash), so the tablet verifies the same way.
 */
export async function verifyPin(platform: Platform, staffId: string, pin: string): Promise<{ ok: true; staff: Staff } | { ok: false; reason: string }> {
  const state = await loadFailures(platform, staffId);
  if (state?.lockedUntil && state.lockedUntil > Date.now()) {
    // If the clock was moved back, restart the wait from now so it never exceeds one lockout.
    if (state.lockedUntil - Date.now() > lockoutMs) await saveFailures(platform, staffId, { ...state, lockedUntil: Date.now() + lockoutMs });
    const remaining = Math.min(state.lockedUntil - Date.now(), lockoutMs);
    const minutes = Math.max(1, Math.ceil(remaining / 60_000));
    return { ok: false, reason: `Too many attempts. Try again in ${minutes} minute${minutes === 1 ? "" : "s"}.` };
  }

  const staff = await readModel.staff(platform.db, staffId);
  if (!staff || !staff.active || !staff.pinEnabled || !staff.pinHash) return { ok: false, reason: "This staff member cannot sign in here" };

  const expected = `sha256:${await platform.sha256Hex(pin)}`;
  if (expected !== staff.pinHash) {
    const count = (state?.count ?? 0) + 1;
    await saveFailures(platform, staffId, { count, lockedUntil: count >= maxFailures ? Date.now() + lockoutMs : undefined });
    const left = maxFailures - count;
    return { ok: false, reason: left > 0 ? `Wrong PIN. ${left} ${left === 1 ? "try" : "tries"} left before a 5-minute wait.` : "Wrong PIN. Too many attempts: try again in 5 minutes." };
  }

  await saveFailures(platform, staffId, null);
  return { ok: true, staff };
}

/** Lifts the wrong-PIN lockout, e.g. after an owner's PIN is reset. */
export async function clearPinFailures(platform: Platform, staffId: string) {
  await saveFailures(platform, staffId, null);
}
