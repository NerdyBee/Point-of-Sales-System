import { encode as encodePng } from "fast-png";
import { describe, expect, it } from "vitest";
import { base64ToBytes, decodeLogo, ditherToBits, fitSize, logoBox, logoForPrinter, rasterCommands, resizeGrey } from "../src/print/logo";
import { buildReceiptBytes, buildReceiptText, type ReceiptData } from "../src/print/receipt";

function png(width: number, height: number, pixel: (x: number, y: number) => [number, number, number, number]) {
  const data = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) data.set(pixel(x, y), (y * width + x) * 4);
  return encodePng({ width, height, data, channels: 4, depth: 8 });
}

const toBase64 = (bytes: Uint8Array) => Buffer.from(bytes).toString("base64");

describe("logo processing", () => {
  it("decodes base64 like Buffer does", () => {
    const bytes = Uint8Array.from({ length: 300 }, (_, index) => (index * 31) % 256);
    expect(Array.from(base64ToBytes(toBase64(bytes)))).toEqual(Array.from(bytes));
    expect(Array.from(base64ToBytes(`data:image/png;base64,${toBase64(bytes)}`))).toEqual(Array.from(bytes));
  });

  it("puts transparent areas on white paper and keeps solid colours", () => {
    const image = decodeLogo(png(2, 1, (x) => (x === 0 ? [0, 0, 0, 0] : [0, 0, 0, 255])));
    expect(Array.from(image.pixels)).toEqual([255, 0]);
  });

  it("fits logos to the paper, keeping proportions and whole printer bytes", () => {
    expect(fitSize({ width: 1000, height: 500 }, logoBox(58))).toEqual({ width: 256, height: 128 });
    expect(fitSize({ width: 400, height: 800 }, logoBox(58))).toEqual({ width: 80, height: 160 });
    expect(fitSize({ width: 2000, height: 1000 }, logoBox(80)).width).toBe(320);
    expect(fitSize({ width: 101, height: 37 }, logoBox(58)).width % 8).toBe(0);
  });

  it("dithers black/white exactly and mid-grey to about half the dots", () => {
    const black = ditherToBits({ width: 16, height: 2, pixels: new Uint8Array(32).fill(0) });
    expect(Array.from(black.bits)).toEqual([0xff, 0xff, 0xff, 0xff]);
    const white = ditherToBits({ width: 16, height: 2, pixels: new Uint8Array(32).fill(255) });
    expect(Array.from(white.bits)).toEqual([0, 0, 0, 0]);
    const grey = ditherToBits({ width: 64, height: 64, pixels: new Uint8Array(64 * 64).fill(128) });
    const dots = Array.from(grey.bits).reduce((sum, byte) => sum + byte.toString(2).split("1").length - 1, 0);
    expect(dots / (64 * 64)).toBeGreaterThan(0.4);
    expect(dots / (64 * 64)).toBeLessThan(0.6);
  });

  it("emits GS v 0 bands with correct sizes", () => {
    const raster = ditherToBits({ width: 16, height: 70, pixels: new Uint8Array(16 * 70).fill(0) });
    const bytes = Array.from(rasterCommands(raster, 64));
    expect(bytes.slice(0, 8)).toEqual([0x1d, 0x76, 0x30, 0x00, 2, 0, 64, 0]);
    expect(bytes.slice(8 + 2 * 64, 8 + 2 * 64 + 8)).toEqual([0x1d, 0x76, 0x30, 0x00, 2, 0, 6, 0]);
    expect(bytes.length).toBe(8 + 128 + 8 + 12);
  });

  it("downscales by averaging", () => {
    const half = resizeGrey({ width: 4, height: 2, pixels: Uint8Array.from([0, 255, 0, 255, 0, 255, 0, 255]) }, 2, 1);
    expect(Array.from(half.pixels)).toEqual([128, 128]);
  });

  it("returns null for anything that is not a PNG", () => {
    expect(logoForPrinter("bm90IGFuIGltYWdl", 58)).toBeNull();
  });
});

describe("receipt header", () => {
  const receipt: ReceiptData = {
    businessName: "Mama Nkechi Provisions",
    phone: "0803 123 4567",
    address: "12 Market Road, Onitsha",
    currency: "NGN",
    number: "MNP-00001",
    createdAt: "2026-10-06T10:00:00.000Z",
    staffName: "Abdul",
    summary: { lines: [{ productId: "p", name: "Rice", quantity: 1, unitPrice: 1000, subtotal: 1000, discount: 0, vat: 0, total: 1000 }], subtotal: 1000, discount: 0, serviceCharge: 0, vat: 0, total: 1000 },
    payments: [{ method: "cash", amount: 1000 }]
  };

  it("prints phone and address under the business name, and the logo above it", () => {
    const logo = toBase64(png(120, 60, (x) => (x < 60 ? [0, 0, 0, 255] : [255, 255, 255, 255])));
    const withLogo = Array.from(buildReceiptBytes({ ...receipt, logoPng: logo }, { width: 58 }));
    const text = String.fromCharCode(...withLogo.filter((byte) => byte >= 0x20 && byte < 0x7f));
    expect(text).toContain("12 Market Road, Onitsha");
    expect(text).toContain("Tel: 0803 123 4567");
    const rasterAt = withLogo.findIndex((byte, index) => byte === 0x1d && withLogo[index + 1] === 0x76 && withLogo[index + 2] === 0x30);
    const nameAt = text.indexOf("Mama");
    expect(rasterAt).toBeGreaterThan(0);
    expect(rasterAt).toBeLessThan(withLogo.findIndex((_, index) => String.fromCharCode(...withLogo.slice(index, index + 4)) === "Mama"));
    expect(nameAt).toBeGreaterThan(-1);

    const withoutLogo = Array.from(buildReceiptBytes(receipt, { width: 58 }));
    expect(withoutLogo.some((byte, index) => byte === 0x1d && withoutLogo[index + 1] === 0x76)).toBe(false);
  });

  it("includes phone and address in the shared text receipt", () => {
    const text = buildReceiptText(receipt);
    expect(text.split("\n").slice(0, 3)).toEqual(["Mama Nkechi Provisions", "12 Market Road, Onitsha", "Tel: 0803 123 4567"]);
  });
});
