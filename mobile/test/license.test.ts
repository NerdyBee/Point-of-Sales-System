import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { resetLocalData } from "../src/data/schema";
import { deviceCodeFor, fromBase64Url, issueLicense, normalizeDeviceCode, publicKeyFor, toBase64Url, verifyLicense, type LicensePayload } from "../src/license/license";
import { activateLicense, deviceCode, loadLicense } from "../src/license/licenseStore";
import { nodePlatform } from "./nodePlatform";

const secret = randomBytes(32).toString("hex");
const publicKeyHex = publicKeyFor(secret);
const day = 86_400_000;

function license(device: string, overrides: Partial<LicensePayload> = {}): LicensePayload {
  return { v: 1, id: "LIC-TEST", name: "Mama Nkechi Stores", device, issued: "2026-10-01", expires: null, ...overrides };
}

describe("device codes", () => {
  it("are short, readable, stable per device and different across devices", async () => {
    const phoneA = await nodePlatform("android-id-aaaa");
    const phoneB = await nodePlatform("android-id-bbbb");
    const codeA = await deviceCode(phoneA);
    expect(codeA).toMatch(/^[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}$/);
    expect(await deviceCode(phoneA)).toBe(codeA);
    expect(await deviceCode(phoneB)).not.toBe(codeA);
    expect(codeA).not.toContain("android");
    expect(normalizeDeviceCode(" abcd efgh-jklm ")).toBe("ABCD-EFGH-JKLM");
    expect(await deviceCodeFor("x", async () => "00".repeat(32))).toBe("AAAA-AAAA-AAAA");
  });

  it("round-trips base64url", () => {
    const bytes = Uint8Array.from({ length: 70 }, (_, index) => (index * 53) % 256);
    expect(Array.from(fromBase64Url(toBase64Url(bytes)))).toEqual(Array.from(bytes));
    expect(toBase64Url(bytes)).toBe(Buffer.from(bytes).toString("base64url"));
  });
});

describe("activation codes", () => {
  it("unlock only the device they were issued for", () => {
    const code = issueLicense(secret, license("ABCD-EFGH-JKLM"));
    expect(verifyLicense(code, { publicKeyHex, deviceCode: "ABCD-EFGH-JKLM" })).toMatchObject({ ok: true, daysLeft: null });
    expect(verifyLicense(code, { publicKeyHex, deviceCode: "ZZZZ-EFGH-JKLM" })).toMatchObject({ ok: false, reason: "wrong_device" });
  });

  it("rejects codes that were edited, signed with another key, or garbled", () => {
    const code = issueLicense(secret, license("ABCD-EFGH-JKLM"));
    const [body, signature] = code.split(".");
    const forgedBody = toBase64Url(new TextEncoder().encode(new TextDecoder().decode(fromBase64Url(body)).replace("ABCD-EFGH-JKLM", "ZZZZ-EFGH-JKLM")));
    expect(verifyLicense(`${forgedBody}.${signature}`, { publicKeyHex, deviceCode: "ZZZZ-EFGH-JKLM" })).toMatchObject({ ok: false, reason: "signature" });

    const otherVendor = issueLicense(randomBytes(32).toString("hex"), license("ABCD-EFGH-JKLM"));
    expect(verifyLicense(otherVendor, { publicKeyHex, deviceCode: "ABCD-EFGH-JKLM" })).toMatchObject({ ok: false, reason: "signature" });

    for (const garbage of ["", "hello", "a.b.c", `${body}`, "@@@.###"]) {
      expect(verifyLicense(garbage, { publicKeyHex, deviceCode: "ABCD-EFGH-JKLM" }).ok).toBe(false);
    }
  });

  it("expires at the end of the expiry day and reports days left", () => {
    const code = issueLicense(secret, license("ABCD-EFGH-JKLM", { expires: "2026-12-31" }));
    expect(verifyLicense(code, { publicKeyHex, deviceCode: "ABCD-EFGH-JKLM", now: new Date(2026, 11, 31, 22, 0).getTime() })).toMatchObject({ ok: true, daysLeft: 1 });
    expect(verifyLicense(code, { publicKeyHex, deviceCode: "ABCD-EFGH-JKLM", now: new Date(2026, 11, 1, 12, 0).getTime() })).toMatchObject({ ok: true, daysLeft: 31 });
    expect(verifyLicense(code, { publicKeyHex, deviceCode: "ABCD-EFGH-JKLM", now: new Date(2027, 0, 1, 0, 5).getTime() })).toMatchObject({ ok: false, reason: "expired" });
  });

  it("notices the clock being turned back to dodge expiry", () => {
    const code = issueLicense(secret, license("ABCD-EFGH-JKLM", { expires: "2027-01-31" }));
    const lastSeen = new Date(2027, 0, 20).getTime();
    expect(verifyLicense(code, { publicKeyHex, deviceCode: "ABCD-EFGH-JKLM", now: lastSeen - 10 * day, lastSeen })).toMatchObject({ ok: false, reason: "clock" });
    expect(verifyLicense(code, { publicKeyHex, deviceCode: "ABCD-EFGH-JKLM", now: lastSeen - 60 * 60 * 1000, lastSeen }).ok).toBe(true); // small drift is fine
  });
});

describe("activating a device", () => {
  it("stores a valid code, refuses it on another phone, and survives a data reset", async () => {
    const phone = await nodePlatform("android-id-shop-1");
    const otherPhone = await nodePlatform("android-id-copy-2");
    expect((await loadLicense(phone, publicKeyHex)).check).toBeNull();

    const code = issueLicense(secret, license(await deviceCode(phone), { expires: null }));
    expect((await activateLicense(otherPhone, code, publicKeyHex)).ok).toBe(false);
    expect((await loadLicense(otherPhone, publicKeyHex)).check).toBeNull();

    expect((await activateLicense(phone, "not a code", publicKeyHex)).ok).toBe(false);
    expect((await activateLicense(phone, `  ${code}\n`, publicKeyHex)).ok).toBe(true);
    expect((await loadLicense(phone, publicKeyHex)).check).toMatchObject({ ok: true, license: { name: "Mama Nkechi Stores" } });

    await resetLocalData(phone.db);
    expect((await loadLicense(phone, publicKeyHex)).check?.ok).toBe(true);
  });
});
