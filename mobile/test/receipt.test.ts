import { describe, expect, it } from "vitest";
import { EscPosBuilder, pairLines, toBase64, toPrintable, wrap } from "../src/print/escpos";
import { buildReceiptBytes, buildReceiptText, printMoney, type ReceiptData } from "../src/print/receipt";

const decode = (bytes: Uint8Array) => Array.from(bytes, (byte) => (byte >= 0x20 && byte <= 0x7e) || byte === 0x0a ? String.fromCharCode(byte) : `<${byte.toString(16)}>`).join("");
const printedLines = (bytes: Uint8Array) =>
  Array.from(bytes)
    .map((byte) => (byte >= 0x20 && byte <= 0x7e) || byte === 0x0a ? String.fromCharCode(byte) : "\u0000")
    .join("")
    .split("\n")
    .map((line) => line.replace(/\u0000+[^\u0000]?/g, (match) => (match.length > 1 && /[\x20-\x7e]/.test(match.slice(-1)) ? "" : "")).replace(/\u0000/g, ""));

const receipt: ReceiptData = {
  businessName: "Mama Nkechi Provisions",
  footer: "Thank you for your patronage",
  currency: "NGN",
  number: "MNP1-00012",
  createdAt: "2026-10-06T14:05:00.000Z",
  staffName: "Abdul",
  customer: { name: "Bayo" },
  summary: {
    lines: [
      { productId: "p1", name: "Golden Penny Semovita 2kg bag", quantity: 2, unitPrice: 4500, subtotal: 9000, discount: 0, vat: 675, total: 9675 },
      { productId: "p2", name: "Peak Milk", quantity: 1, unitPrice: 650, subtotal: 650, discount: 0, vat: 49, total: 699 }
    ],
    subtotal: 9650,
    discount: 0,
    serviceCharge: 0,
    vat: 724,
    total: 10374
  },
  payments: [{ method: "cash", amount: 10374 }],
  tendered: 11000
};

describe("ESC/POS encoding", () => {
  it("starts with initialise + code page and ends with a cut", () => {
    const bytes = new EscPosBuilder(58).line("Hi").cut().build();
    expect(Array.from(bytes.slice(0, 5))).toEqual([0x1b, 0x40, 0x1b, 0x74, 0x00]);
    expect(Array.from(bytes.slice(-4))).toEqual([0x1d, 0x56, 0x42, 0x00]);
  });

  it("reduces text to printable ASCII", () => {
    expect(toPrintable("₦1 200 – Café “Ọ̀rẹ́” × 2")).toBe('N1 200 - Cafe "Ore" x 2');
    expect(toPrintable("日本")).toBe("??");
  });

  it("wraps words and lays out left/right columns to the exact width", () => {
    expect(wrap("Golden Penny Semovita 2kg bag", 12)).toEqual(["Golden Penny", "Semovita 2kg", "bag"]);
    expect(pairLines("Total", "N10,374", 32)).toEqual([`Total${" ".repeat(32 - 5 - 7)}N10,374`]);
    const long = pairLines("A very long product description here", "N9,000", 32);
    expect(long.every((line) => line.length <= 32)).toBe(true);
    expect(long[long.length - 1].endsWith("N9,000")).toBe(true);
  });

  it("encodes base64 like the native side expects", () => {
    expect(toBase64(new Uint8Array([0x1b, 0x40]))).toBe(Buffer.from([0x1b, 0x40]).toString("base64"));
    const random = Uint8Array.from({ length: 257 }, (_, index) => (index * 37) % 256);
    expect(toBase64(random)).toBe(Buffer.from(random).toString("base64"));
  });
});

describe("receipt layout", () => {
  it("prints money in ASCII", () => {
    expect(printMoney(1234567, "NGN")).toBe("N1,234,567");
    expect(printMoney(-500, "GHS")).toBe("-GHS 500");
  });

  it.each([58, 80] as const)("fits every line on %smm paper and includes the key details", (width) => {
    const bytes = buildReceiptBytes(receipt, { width });
    const text = decode(bytes);
    const columns = width === 80 ? 48 : 32;
    for (const line of printedLines(bytes)) expect(line.length).toBeLessThanOrEqual(columns);
    for (const expected of ["MNP1-00012", "Served by", "Abdul", "Bayo", "N10,374", "Change", "N626", "Thank you for your patronage", "2 x N4,500", "N9,000"]) {
      expect(text).toContain(expected);
    }
  });

  it("can open the cash drawer and marks voided reprints", () => {
    const bytes = buildReceiptBytes({ ...receipt, voided: true, reprint: true }, { width: 58, openDrawer: true });
    expect(decode(bytes)).toContain("<1b>p<0><19><fa>");
    expect(decode(bytes)).toContain("*** VOIDED ***");
    expect(decode(bytes)).toContain("*** REPRINT ***");
  });

  it("builds a shareable text receipt", () => {
    const text = buildReceiptText(receipt);
    expect(text).toContain("TOTAL: N10,374");
    expect(text).toContain("2 x Golden Penny Semovita 2kg bag - N9,000");
  });
});
