import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { verifyPin } from "../src/auth/pin";
import { issueLicense, issuePinReset, parsePinResetRequest, publicKeyFor, type PinResetPayload } from "../src/license/license";
import { deviceCode } from "../src/license/licenseStore";
import { createStandaloneBusiness, listStaff, saveStaff } from "../src/standalone/business";
import { checkPinResetCode, completePinReset, pinResetRequest } from "../src/standalone/pinRecovery";
import { nodePlatform } from "./nodePlatform";

const secret = randomBytes(32).toString("hex");
const publicKeyHex = publicKeyFor(secret);

async function shop(deviceId = "android-id-shop") {
  const platform = await nodePlatform(deviceId);
  const { owner } = await createStandaloneBusiness(platform, {
    businessName: "PIN Corner",
    currency: "NGN",
    vatPercent: 0,
    serviceChargePercent: 0,
    ownerName: "Femi Ade",
    ownerPin: "602731"
  });
  return { platform, owner };
}

/** What the vendor's `npm run license -- reset-pin --request <code>` does. */
function vendorReset(requestCode: string, key = secret) {
  const parsed = parsePinResetRequest(requestCode)!;
  const payload: PinResetPayload = { v: 1, kind: "pin_reset", id: "PIN-TEST", device: parsed.device, nonce: parsed.nonce, issued: "2026-10-12" };
  return issuePinReset(key, payload);
}

describe("owner PIN recovery", () => {
  it("resets a forgotten owner PIN with a one-time code from the vendor", async () => {
    const { platform, owner } = await shop();
    // Locked out after wrong guesses.
    for (let attempt = 0; attempt < 5; attempt += 1) await verifyPin(platform, owner.id, "111222");
    expect(await verifyPin(platform, owner.id, "602731")).toMatchObject({ ok: false, reason: expect.stringContaining("Too many attempts") });

    const { requestCode } = await pinResetRequest(platform, owner.id);
    expect(requestCode).toMatch(/^[A-Z2-9]{4}(-[A-Z2-9]{4}){4}$/);
    expect(requestCode.startsWith(await deviceCode(platform))).toBe(true);
    // Asking again gives the same code, so a code already sent keeps working.
    expect((await pinResetRequest(platform, owner.id)).requestCode).toBe(requestCode);

    const resetCode = vendorReset(requestCode);
    await expect(completePinReset(platform, { staffId: owner.id, resetCode, pin: "111111" }, publicKeyHex)).rejects.toThrow("harder to guess");
    const updated = await completePinReset(platform, { staffId: owner.id, resetCode, pin: "480913" }, publicKeyHex);
    expect((updated as unknown as { pinResetAt: string }).pinResetAt).toBeTruthy();

    // New PIN works at once (lockout lifted); the old one does not.
    expect(await verifyPin(platform, owner.id, "480913")).toMatchObject({ ok: true });
    expect(await verifyPin(platform, owner.id, "602731")).toMatchObject({ ok: false });

    // The code works once only.
    await expect(completePinReset(platform, { staffId: owner.id, resetCode, pin: "735142" }, publicKeyHex)).rejects.toThrow("no open reset request");
    // Everything else is untouched.
    expect((await listStaff(platform)).map((staff) => staff.name)).toEqual(["Femi Ade"]);
  });

  it("refuses codes that are forged, for another phone, or for an older request", async () => {
    const { platform, owner } = await shop("android-id-one");
    const { requestCode } = await pinResetRequest(platform, owner.id);

    const forged = vendorReset(requestCode, randomBytes(32).toString("hex"));
    await expect(checkPinResetCode(platform, owner.id, forged, publicKeyHex)).rejects.toThrow("not genuine");
    await expect(checkPinResetCode(platform, owner.id, "nonsense", publicKeyHex)).rejects.toThrow("not a valid reset code");

    // A real code made for a different phone.
    const other = await shop("android-id-two");
    const otherRequest = await pinResetRequest(other.platform, other.owner.id);
    await expect(checkPinResetCode(platform, owner.id, vendorReset(otherRequest.requestCode), publicKeyHex)).rejects.toThrow("different device");

    // A licence (activation) code is not a reset code, even though it is signed with the same key.
    const licence = issueLicense(secret, { v: 1, id: "LIC-1", name: "PIN Corner", device: await deviceCode(platform), issued: "2026-10-12", expires: null });
    await expect(checkPinResetCode(platform, owner.id, licence, publicKeyHex)).rejects.toThrow("not genuine");

    // Tampering with the request (a guessed nonce) does not match the request the phone is waiting on.
    const [device] = [requestCode.slice(0, 14)];
    await expect(checkPinResetCode(platform, owner.id, vendorReset(`${device}-AAAA-AAAA`), publicKeyHex)).rejects.toThrow("older request");

    await expect(checkPinResetCode(platform, owner.id, vendorReset(requestCode), publicKeyHex)).resolves.toMatchObject({ kind: "pin_reset" });
  });

  it("is only for active owners, and the request belongs to one owner", async () => {
    const { platform, owner } = await shop();
    const cashier = await saveStaff(platform, { name: "Bisi Cashier", role: "cashier", pin: "582014" });
    await expect(pinResetRequest(platform, cashier.id)).rejects.toThrow("Only an active owner");

    const second = await saveStaff(platform, { name: "Ngozi Ade", role: "owner", pin: "739104" });
    const first = await pinResetRequest(platform, owner.id);
    const forSecond = await pinResetRequest(platform, second.id);
    expect(forSecond.requestCode).not.toBe(first.requestCode);
    // The reset code for the second owner cannot change the first owner's PIN.
    await expect(completePinReset(platform, { staffId: owner.id, resetCode: vendorReset(forSecond.requestCode), pin: "480913" }, publicKeyHex)).rejects.toThrow("no open reset request");
    await completePinReset(platform, { staffId: second.id, resetCode: vendorReset(forSecond.requestCode), pin: "480913" }, publicKeyHex);
    expect(await verifyPin(platform, second.id, "480913")).toMatchObject({ ok: true });
    expect(await verifyPin(platform, owner.id, "602731")).toMatchObject({ ok: true });
  });

  it("reads request codes typed with spaces or lower case", () => {
    expect(parsePinResetRequest(" 3cun b7en-mawb 7kq2 x9td ")).toEqual({ device: "3CUN-B7EN-MAWB", nonce: "7KQ2X9TD" });
    expect(parsePinResetRequest("3CUN-B7EN-MAWB")).toBeNull();
    expect(parsePinResetRequest("3CUN-B7EN-MAWB-7KQ2-X9T1")).toBeNull();
  });
});
