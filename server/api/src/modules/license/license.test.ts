import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";
import { checkLicenseCode, deviceCodeFor } from "./license";
import { LICENSE_PUBLIC_KEY } from "./publicKey";

// Codes are signed exactly as the vendor tool does (mobile/scripts/license.ts), with the
// app's own signing code; loaded at run time because it lives outside this project.
const vendorModule = pathToFileURL(join(__dirname, "../../../../../mobile/src/license/license.ts")).href;
const { issueLicense, publicKeyFor } = (await import(/* @vite-ignore */ vendorModule)) as {
  issueLicense(secretKeyHex: string, payload: Record<string, unknown>): string;
  publicKeyFor(secretKeyHex: string): string;
};
const secret = randomBytes(32).toString("hex");
const publicKeyHex = publicKeyFor(secret);
const device = deviceCodeFor("test-machine-guid");
const day = 86_400_000;

function code(overrides: Record<string, unknown> = {}) {
  return issueLicense(secret, { v: 1, product: "office", id: "OFF-TEST", name: "Bella Foods", device, issued: "2026-11-01", expires: null, ...overrides });
}

describe("server licences", () => {
  it("uses the same public key as the Android app", () => {
    const mobileKey = readFileSync(join(__dirname, "../../../../../mobile/src/license/publicKey.ts"), "utf8");
    expect(mobileKey).toContain(LICENSE_PUBLIC_KEY);
  });

  it("gives each computer a stable, readable device code", () => {
    expect(device).toMatch(/^[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}$/);
    expect(deviceCodeFor("test-machine-guid")).toBe(device);
    expect(deviceCodeFor("another-computer")).not.toBe(device);
  });

  it("accepts a code signed for this computer", () => {
    const state = checkLicenseCode(code(), { deviceCode: device, publicKeyHex });
    expect(state).toMatchObject({ active: true, daysLeft: null, license: { name: "Bella Foods" } });
  });

  it("rejects the same code on another computer", () => {
    const state = checkLicenseCode(code(), { deviceCode: deviceCodeFor("copied-to-another-pc"), publicKeyHex });
    expect(state).toMatchObject({ active: false, reason: "wrong_device" });
  });

  it("rejects codes signed with another key, edited codes and phone codes", () => {
    expect(checkLicenseCode(code(), { deviceCode: device, publicKeyHex: publicKeyFor(randomBytes(32).toString("hex")) })).toMatchObject({ active: false, reason: "invalid" });

    const [body, signature] = code().split(".");
    const edited = Buffer.from(Buffer.from(body, "base64url").toString("utf8").replace("Bella Foods", "Pirate Shop")).toString("base64url");
    expect(checkLicenseCode(`${edited}.${signature}`, { deviceCode: device, publicKeyHex })).toMatchObject({ active: false, reason: "invalid" });

    const phone = issueLicense(secret, { v: 1, id: "LIC-PHONE", name: "Phone", device, issued: "2026-11-01", expires: null });
    expect(checkLicenseCode(phone, { deviceCode: device, publicKeyHex })).toMatchObject({ active: false, reason: "invalid" });
    expect(checkLicenseCode("not-a-code", { deviceCode: device, publicKeyHex })).toMatchObject({ active: false, reason: "invalid" });
  });

  it("carries the paid-for limits inside the signed code", () => {
    const state = checkLicenseCode(code({ limits: { branches: 2, staff: 10 } }), { deviceCode: device, publicKeyHex });
    expect(state.license?.limits).toEqual({ branches: 2, staff: 10 });
  });

  it("counts down to expiry and then locks", () => {
    const yearly = code({ expires: "2027-11-01" });
    expect(checkLicenseCode(yearly, { deviceCode: device, publicKeyHex, now: new Date(2027, 9, 25).getTime() })).toMatchObject({ active: true, daysLeft: 8 });
    expect(checkLicenseCode(yearly, { deviceCode: device, publicKeyHex, now: new Date(2027, 10, 2).getTime() })).toMatchObject({ active: false, reason: "expired" });
  });

  it("notices the clock being moved back", () => {
    const now = Date.now();
    expect(checkLicenseCode(code(), { deviceCode: device, publicKeyHex, now: now - 3 * day, lastSeen: now })).toMatchObject({ active: false, reason: "clock" });
    expect(checkLicenseCode(code(), { deviceCode: device, publicKeyHex, now: now - day, lastSeen: now })).toMatchObject({ active: true });
  });
});
