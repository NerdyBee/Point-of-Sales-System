import type { Platform } from "../data/db";
import type { Staff } from "../data/readModel";
import { newPinResetNonce, pinResetRequestCode, verifyPinReset, type PinResetPayload } from "../license/license";
import { deviceCode } from "../license/licenseStore";
import { LICENSE_PUBLIC_KEY } from "../license/publicKey";
import { clearPinFailures } from "../auth/pin";
import { pinHash, validatePin } from "./business";
import { getRow, now, putRow } from "./store";

/**
 * "Forgot PIN?" for an owner on a standalone device.
 *
 * The pending request lives in secure storage (not the shop database), so it is not carried
 * in backups. A reset code works once: the request is removed as soon as the PIN is changed.
 */
const requestKey = "naijapos.pinReset.request";
/** A request (and the reset code made for it) can be used for this long. */
export const PIN_RESET_REQUEST_DAYS = 7;

interface PendingRequest {
  staffId: string;
  nonce: string;
  createdAt: string;
}

type StaffRow = Staff & Record<string, unknown>;

async function loadOwner(platform: Platform, staffId: string) {
  const staff = await getRow<StaffRow>(platform.db, "staff_members", staffId);
  if (!staff || staff.role !== "owner" || !staff.active) throw new Error("Only an active owner's PIN can be reset with a code. Other staff: ask an owner to set a new PIN.");
  return staff;
}

async function pending(platform: Platform): Promise<PendingRequest | null> {
  const raw = await platform.secrets.get(requestKey);
  if (!raw) return null;
  const request = JSON.parse(raw) as PendingRequest;
  const age = Date.now() - new Date(request.createdAt).getTime();
  return age >= 0 && age < PIN_RESET_REQUEST_DAYS * 86_400_000 ? request : null;
}

/**
 * The request code to send to the vendor. Reuses the open request for the same owner, so a
 * code already sent keeps working; asking for a different owner starts a new request.
 */
export async function pinResetRequest(platform: Platform, staffId: string) {
  await loadOwner(platform, staffId);
  let request = await pending(platform);
  if (!request || request.staffId !== staffId) {
    request = { staffId, nonce: await newPinResetNonce(platform.uuid(), platform.sha256Hex), createdAt: now() };
    await platform.secrets.set(requestKey, JSON.stringify(request));
  }
  return { requestCode: pinResetRequestCode(await deviceCode(platform), request.nonce), createdAt: request.createdAt };
}

/** Checks a pasted reset code against this device and the open request (does not use it up). */
export async function checkPinResetCode(platform: Platform, staffId: string, resetCode: string, publicKeyHex = LICENSE_PUBLIC_KEY): Promise<PinResetPayload> {
  const request = await pending(platform);
  if (!request || request.staffId !== staffId) throw new Error("There is no open reset request for this owner. Tap Forgot PIN? again to get a request code.");
  const result = verifyPinReset(resetCode, { publicKeyHex, deviceCode: await deviceCode(platform), nonce: request.nonce });
  if (!result.ok) throw new Error(result.message);
  return result.reset;
}

/** Sets the owner's new PIN with a valid reset code, and closes the request. */
export async function completePinReset(platform: Platform, input: { staffId: string; resetCode: string; pin: string }, publicKeyHex = LICENSE_PUBLIC_KEY) {
  const reset = await checkPinResetCode(platform, input.staffId, input.resetCode, publicKeyHex);
  const problem = validatePin(input.pin);
  if (problem) throw new Error(problem);
  const owner = await loadOwner(platform, input.staffId);
  const updated = { ...owner, pinEnabled: true, pinHash: await pinHash(platform, input.pin), pinResetAt: now(), pinResetId: reset.id };
  await putRow(platform.db, "staff_members", owner.id, updated);
  await platform.secrets.remove(requestKey);
  await clearPinFailures(platform, owner.id);
  return updated as unknown as Staff;
}
