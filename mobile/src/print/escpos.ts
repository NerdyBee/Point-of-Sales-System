/**
 * Minimal ESC/POS command builder for 58 mm / 80 mm thermal receipt printers
 * (Xprinter, GOOJPRT, MTP-II, Rongta, Epson TM and compatible clones).
 *
 * Text is reduced to printable ASCII so it prints the same on every code page.
 */

const ESC = 0x1b;
const GS = 0x1d;
const LF = 0x0a;

export type PaperWidth = 58 | 80;
export type Align = "left" | "center" | "right";

/** Characters per line in the default font. */
export function charsPerLine(width: PaperWidth) {
  return width === 80 ? 48 : 32;
}

const replacements: Record<string, string> = {
  "₦": "N",
  "₵": "C",
  "€": "EUR",
  "£": "GBP",
  "×": "x",
  "−": "-",
  "–": "-",
  "—": "-",
  "‘": "'",
  "’": "'",
  "“": '"',
  "”": '"',
  "…": "...",
  "•": "*",
  " ": " ",
  " ": " "
};

/** Converts any string to printable ASCII (accents stripped, symbols replaced). */
export function toPrintable(text: string) {
  return text
    .replace(/[₦₵€£×−–—‘’“”…•  ]/g, (char) => replacements[char] ?? "?")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^\x20-\x7e\n]/g, "?");
}

export class EscPosBuilder {
  private bytes: number[] = [];

  constructor(readonly width: PaperWidth = 58) {
    this.raw(ESC, 0x40); // initialise
    this.raw(ESC, 0x74, 0x00); // code page PC437 (ASCII range is identical everywhere)
  }

  get columns() {
    return charsPerLine(this.width);
  }

  raw(...values: number[]) {
    for (const value of values) this.bytes.push(value & 0xff);
    return this;
  }

  /** Appends a prepared block of bytes (e.g. a raster image). */
  append(bytes: Uint8Array) {
    for (const value of bytes) this.bytes.push(value);
    return this;
  }

  align(value: Align) {
    return this.raw(ESC, 0x61, value === "left" ? 0 : value === "center" ? 1 : 2);
  }

  bold(on: boolean) {
    return this.raw(ESC, 0x45, on ? 1 : 0);
  }

  /** Double width and height for headings/totals. Halves the characters per line. */
  large(on: boolean) {
    return this.raw(GS, 0x21, on ? 0x11 : 0x00);
  }

  text(value: string) {
    for (const char of toPrintable(value)) this.bytes.push(char.charCodeAt(0));
    return this;
  }

  line(value = "") {
    return this.text(value).raw(LF);
  }

  /** Wraps long text to the line width. */
  wrapped(value: string, columns = this.columns) {
    for (const line of wrap(toPrintable(value), columns)) this.line(line);
    return this;
  }

  /** Left text and right text on one line, e.g. "2 x Bread ........ 2,400". */
  pair(left: string, right: string, columns = this.columns) {
    for (const line of pairLines(toPrintable(left), toPrintable(right), columns)) this.line(line);
    return this;
  }

  divider(char = "-") {
    return this.line(char.repeat(this.columns));
  }

  feed(lines = 1) {
    return this.raw(ESC, 0x64, Math.max(0, Math.min(lines, 255)));
  }

  /** Partial cut (ignored by printers without a cutter). */
  cut() {
    return this.feed(3).raw(GS, 0x56, 0x42, 0x00);
  }

  /** Pulse to open a cash drawer connected to the printer. */
  openDrawer() {
    return this.raw(ESC, 0x70, 0x00, 0x19, 0xfa);
  }

  build() {
    return Uint8Array.from(this.bytes);
  }
}

export function wrap(text: string, columns: number) {
  const lines: string[] = [];
  for (const paragraph of text.split("\n")) {
    let current = "";
    for (const word of paragraph.split(/\s+/).filter(Boolean)) {
      if (word.length > columns) {
        if (current) lines.push(current);
        for (let index = 0; index < word.length; index += columns) lines.push(word.slice(index, index + columns));
        current = "";
        continue;
      }
      if (!current) current = word;
      else if (current.length + 1 + word.length <= columns) current += ` ${word}`;
      else {
        lines.push(current);
        current = word;
      }
    }
    lines.push(current);
  }
  return lines;
}

/** Lays out left/right text; the left side wraps, the right side sits on the last line. */
export function pairLines(left: string, right: string, columns: number) {
  const room = Math.max(1, columns - right.length - 1);
  const lines = wrap(left, room);
  const last = lines.pop() ?? "";
  return [...lines, `${last}${" ".repeat(Math.max(1, columns - last.length - right.length))}${right}`];
}

const base64Chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

export function toBase64(bytes: Uint8Array) {
  let output = "";
  for (let index = 0; index < bytes.length; index += 3) {
    const a = bytes[index];
    const b = bytes[index + 1];
    const c = bytes[index + 2];
    output += base64Chars[a >> 2];
    output += base64Chars[((a & 3) << 4) | ((b ?? 0) >> 4)];
    output += b === undefined ? "=" : base64Chars[((b & 15) << 2) | ((c ?? 0) >> 6)];
    output += c === undefined ? "=" : base64Chars[c & 63];
  }
  return output;
}
