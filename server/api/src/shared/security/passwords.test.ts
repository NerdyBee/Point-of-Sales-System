import { describe, expect, it } from "vitest";
import { demoSecretHash } from "../data/demoStore";
import { hashPassword, needsPasswordRehash, verifyPassword } from "./passwords";

describe("staff passwords", () => {
  it("hashes with a fresh salt and verifies only the right password", async () => {
    const first = await hashPassword("Secret123!");
    const second = await hashPassword("Secret123!");

    expect(first).toMatch(/^scrypt\$16384\$8\$1\$/);
    expect(first).not.toBe(second);
    expect(await verifyPassword("Secret123!", first)).toBe(true);
    expect(await verifyPassword("Secret123?", first)).toBe(false);
    expect(needsPasswordRehash(first)).toBe(false);
  });

  it("still accepts old sha256 hashes and flags them for upgrade", async () => {
    const legacy = demoSecretHash("Password123!");

    expect(await verifyPassword("Password123!", legacy)).toBe(true);
    expect(await verifyPassword("wrong", legacy)).toBe(false);
    expect(needsPasswordRehash(legacy)).toBe(true);
  });

  it("rejects missing or malformed hashes", async () => {
    expect(await verifyPassword("x", null)).toBe(false);
    expect(await verifyPassword("x", "")).toBe(false);
    expect(await verifyPassword("x", "scrypt$16384$8$1$")).toBe(false);
    expect(await verifyPassword("x", "plain-text")).toBe(false);
  });
});
