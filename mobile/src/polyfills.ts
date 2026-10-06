/**
 * React Native's TextDecoder only understands UTF-8, but fast-png (used to print the shop logo)
 * creates `new TextDecoder("latin1")` when it loads. This adds single-byte decoding (latin1 /
 * ASCII) and passes every other encoding to the built-in decoder. It is installed only when the
 * built-in decoder rejects latin1, and is imported in index.ts after `expo` (which installs the built-in decoder) and before the app.
 */

const singleByteLabels = new Set(["latin1", "iso-8859-1", "iso8859-1", "l1", "ascii", "us-ascii", "windows-1252", "cp1252"]);

type DecoderInput = ArrayBuffer | ArrayBufferView | undefined;

function toBytes(input: DecoderInput) {
  if (!input) return new Uint8Array(0);
  if (input instanceof ArrayBuffer) return new Uint8Array(input);
  return new Uint8Array(input.buffer, input.byteOffset, input.byteLength);
}

/** Builds a TextDecoder class that adds latin1 on top of `Native`. Exported for tests. */
export function withSingleByteDecoding(Native: typeof TextDecoder): typeof TextDecoder {
  class SingleByteAwareTextDecoder {
    private readonly native: TextDecoder | null;
    readonly encoding: string;
    readonly fatal: boolean;
    readonly ignoreBOM: boolean;

    constructor(label = "utf-8", options?: TextDecoderOptions) {
      const normalized = String(label).trim().toLowerCase();
      if (singleByteLabels.has(normalized)) {
        this.native = null;
        this.encoding = "windows-1252";
        this.fatal = Boolean(options?.fatal);
        this.ignoreBOM = Boolean(options?.ignoreBOM);
      } else {
        this.native = new Native(label, options);
        this.encoding = this.native.encoding;
        this.fatal = this.native.fatal;
        this.ignoreBOM = this.native.ignoreBOM;
      }
    }

    decode(input?: DecoderInput, options?: TextDecodeOptions) {
      if (this.native) return this.native.decode(input as BufferSource | undefined, options);
      const bytes = toBytes(input);
      let out = "";
      for (let index = 0; index < bytes.length; index += 8192) {
        out += String.fromCharCode(...bytes.subarray(index, index + 8192));
      }
      return out;
    }
  }
  return SingleByteAwareTextDecoder as unknown as typeof TextDecoder;
}

function needsShim() {
  const Native = (globalThis as { TextDecoder?: typeof TextDecoder }).TextDecoder;
  if (!Native) return false;
  try {
    new Native("latin1");
    return false;
  } catch {
    return true;
  }
}

if (needsShim()) {
  Object.defineProperty(globalThis, "TextDecoder", {
    value: withSingleByteDecoding(globalThis.TextDecoder),
    writable: true,
    configurable: true,
    enumerable: false
  });
}
