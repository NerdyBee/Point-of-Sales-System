import { afterAll, describe, expect, it, vi } from "vitest";
// The UTF-8-only decoder Expo installs on React Native (the one that crashed with "Unknown encoding: latin1").
import { TextDecoder as ExpoTextDecoder } from "../node_modules/expo/src/winter/TextDecoder";
import { withSingleByteDecoding } from "../src/polyfills";

const original = globalThis.TextDecoder;
afterAll(() => {
  Object.defineProperty(globalThis, "TextDecoder", { value: original, writable: true, configurable: true });
});

describe("TextDecoder latin1 shim", () => {
  it("reproduces the device crash with Expo's decoder", () => {
    expect(() => new ExpoTextDecoder("latin1")).toThrow(/Unknown encoding: latin1/);
  });

  it("adds latin1/ASCII and leaves UTF-8 to the built-in decoder", () => {
    const Patched = withSingleByteDecoding(ExpoTextDecoder as unknown as typeof TextDecoder);
    const latin1 = new Patched("latin1");
    expect(latin1.encoding).toBe("windows-1252");
    expect(latin1.decode(Uint8Array.from([0x43, 0x61, 0x66, 0xe9]))).toBe("Café");
    expect(latin1.decode(new Uint8Array(20000).fill(0x41)).length).toBe(20000);
    expect(new Patched("utf-8").decode(new TextEncoder().encode("₦1,200 ✓"))).toBe("₦1,200 ✓");
    expect(() => new Patched("shift_jis")).toThrow();
  });

  it("lets fast-png load and decode a PNG (with a text chunk) on a UTF-8-only runtime", async () => {
    Object.defineProperty(globalThis, "TextDecoder", { value: ExpoTextDecoder, writable: true, configurable: true });
    vi.resetModules();
    await import("../src/polyfills");
    expect(() => new globalThis.TextDecoder("latin1")).not.toThrow();

    const fastPng = await import("fast-png");
    const png = fastPng.encode({ width: 2, height: 1, data: Uint8Array.from([0, 0, 0, 255, 255, 255, 255, 255]), channels: 4, depth: 8, text: { Software: "Ajoke POS" } });
    const decoded = fastPng.decode(png);
    expect(decoded.width).toBe(2);
    expect(decoded.text).toEqual({ Software: "Ajoke POS" });
  });
});
