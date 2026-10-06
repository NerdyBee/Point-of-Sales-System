import { convertIndexedToRgb, decode as decodePng } from "fast-png";
import type { PaperWidth } from "./escpos";

/**
 * Turns the shop's logo (PNG) into an ESC/POS raster image:
 * transparent areas -> white, greyscale, scaled to fit the paper, Floyd-Steinberg
 * dithering to black/white dots, then GS v 0 commands sent in bands.
 */

export interface GreyImage {
  width: number;
  height: number;
  /** 0 = black ... 255 = white, row by row. */
  pixels: Uint8Array;
}

const base64Chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

export function base64ToBytes(base64: string) {
  const clean = base64.replace(/^data:[^,]*,/, "").replace(/[^A-Za-z0-9+/]/g, "");
  const bytes = new Uint8Array(Math.floor((clean.length * 3) / 4));
  let buffer = 0;
  let bits = 0;
  let index = 0;
  for (const char of clean) {
    buffer = (buffer << 6) | base64Chars.indexOf(char);
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      bytes[index++] = (buffer >> bits) & 0xff;
    }
  }
  return bytes.subarray(0, index);
}

/** Decodes a PNG into greyscale, compositing any transparency onto white paper. */
export function decodeLogo(png: Uint8Array): GreyImage {
  const decoded = decodePng(png);
  let data: ArrayLike<number> = decoded.data;
  let channels = decoded.channels;
  if (decoded.palette) {
    data = convertIndexedToRgb(decoded);
    channels = decoded.palette[0]?.length ?? 3;
  }
  const max = decoded.depth === 16 ? 65535 : (1 << decoded.depth) - 1;
  const { width, height } = decoded;
  const pixels = new Uint8Array(width * height);
  const hasAlpha = channels === 2 || channels === 4;
  for (let index = 0; index < width * height; index += 1) {
    const base = index * channels;
    const value = (offset: number) => (Number(data[base + offset]) / max) * 255;
    const lum = channels >= 3 ? 0.299 * value(0) + 0.587 * value(1) + 0.114 * value(2) : value(0);
    const alpha = hasAlpha ? value(channels - 1) / 255 : 1;
    pixels[index] = Math.round(lum * alpha + 255 * (1 - alpha));
  }
  return { width, height, pixels };
}

/** Area-average downscale (or nearest upscale) to the given size. */
export function resizeGrey(image: GreyImage, width: number, height: number): GreyImage {
  const out = new Uint8Array(width * height);
  const scaleX = image.width / width;
  const scaleY = image.height / height;
  for (let y = 0; y < height; y += 1) {
    const y0 = Math.floor(y * scaleY);
    const y1 = Math.max(y0 + 1, Math.min(image.height, Math.floor((y + 1) * scaleY)));
    for (let x = 0; x < width; x += 1) {
      const x0 = Math.floor(x * scaleX);
      const x1 = Math.max(x0 + 1, Math.min(image.width, Math.floor((x + 1) * scaleX)));
      let sum = 0;
      for (let sy = y0; sy < y1; sy += 1) for (let sx = x0; sx < x1; sx += 1) sum += image.pixels[sy * image.width + sx];
      out[y * width + x] = Math.round(sum / ((y1 - y0) * (x1 - x0)));
    }
  }
  return { width, height, pixels: out };
}

/** Largest logo size on each paper width, in printer dots (8 dots per mm). */
export function logoBox(paper: PaperWidth) {
  return paper === 80 ? { width: 320, height: 200 } : { width: 256, height: 160 };
}

/** Fits the image in the box keeping proportions; width is rounded to whole bytes. */
export function fitSize(image: { width: number; height: number }, box: { width: number; height: number }) {
  const scale = Math.min(box.width / image.width, box.height / image.height, 1.5);
  const width = Math.max(8, Math.round((image.width * scale) / 8) * 8);
  const height = Math.max(1, Math.round(image.height * (width / image.width)));
  return { width, height: Math.min(height, box.height) };
}

/** Floyd-Steinberg dithering to 1 bit per pixel, packed MSB first (1 = black dot). */
export function ditherToBits(image: GreyImage) {
  const { width, height } = image;
  const work = Float32Array.from(image.pixels);
  const bytesPerRow = Math.ceil(width / 8);
  const bits = new Uint8Array(bytesPerRow * height);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = y * width + x;
      const old = work[index];
      const black = old < 128;
      const error = old - (black ? 0 : 255);
      if (black) bits[y * bytesPerRow + (x >> 3)] |= 0x80 >> (x & 7);
      if (x + 1 < width) work[index + 1] += (error * 7) / 16;
      if (y + 1 < height) {
        if (x > 0) work[index + width - 1] += (error * 3) / 16;
        work[index + width] += (error * 5) / 16;
        if (x + 1 < width) work[index + width + 1] += error / 16;
      }
    }
  }
  return { bits, bytesPerRow, height };
}

/** GS v 0 raster commands, split into bands so small printer buffers keep up. */
export function rasterCommands(raster: { bits: Uint8Array; bytesPerRow: number; height: number }, bandRows = 64) {
  const out: number[] = [];
  for (let top = 0; top < raster.height; top += bandRows) {
    const rows = Math.min(bandRows, raster.height - top);
    out.push(0x1d, 0x76, 0x30, 0x00, raster.bytesPerRow & 0xff, (raster.bytesPerRow >> 8) & 0xff, rows & 0xff, (rows >> 8) & 0xff);
    const start = top * raster.bytesPerRow;
    for (let index = start; index < start + rows * raster.bytesPerRow; index += 1) out.push(raster.bits[index]);
  }
  return Uint8Array.from(out);
}

/** Full pipeline: base64 PNG -> printer bytes for the given paper. Returns null if the image can't be read. */
export function logoForPrinter(pngBase64: string, paper: PaperWidth) {
  try {
    const image = decodeLogo(base64ToBytes(pngBase64));
    const size = fitSize(image, logoBox(paper));
    return rasterCommands(ditherToBits(resizeGrey(image, size.width, size.height)));
  } catch {
    return null;
  }
}
