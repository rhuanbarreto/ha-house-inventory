/**
 * Generate icon.png (128x128) and logo.png (250x100) placeholder images.
 *
 * These are minimal valid PNGs with the brand colour (#0b0b0f background,
 * #60a5fa accent). They satisfy HA's presentation requirement for PNG
 * icon + logo files.
 *
 * For production-quality icons, replace them with properly designed assets
 * (e.g. rasterised from icon.svg via rsvg-convert or Figma export).
 *
 * Usage:
 *   bun run scripts/generate-icons.ts
 */

import { deflateSync } from "node:zlib";
import { join } from "node:path";

const DIR = join(import.meta.dir, "..");

// ---- Minimal PNG encoder ----------------------------------------------------
// PNG spec: https://www.w3.org/TR/png/

function crc32(buf: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c = (c >>> 8) ^ crcTable[(c ^ buf[i]!) & 0xff]!;
  }
  return (c ^ 0xffffffff) >>> 0;
}

const crcTable: number[] = [];
for (let n = 0; n < 256; n++) {
  let c = n;
  for (let k = 0; k < 8; k++) {
    c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  }
  crcTable[n] = c;
}

function chunk(type: string, data: Uint8Array): Uint8Array {
  const typeBytes = new TextEncoder().encode(type);
  const len = new DataView(new ArrayBuffer(4));
  len.setUint32(0, data.length);

  const crcInput = new Uint8Array(typeBytes.length + data.length);
  crcInput.set(typeBytes, 0);
  crcInput.set(data, typeBytes.length);
  const crcVal = crc32(crcInput);
  const crcBuf = new DataView(new ArrayBuffer(4));
  crcBuf.setUint32(0, crcVal);

  const out = new Uint8Array(4 + 4 + data.length + 4);
  out.set(new Uint8Array(len.buffer), 0);
  out.set(typeBytes, 4);
  out.set(data, 8);
  out.set(new Uint8Array(crcBuf.buffer), 8 + data.length);
  return out;
}

function makePng(
  w: number,
  h: number,
  bgR: number,
  bgG: number,
  bgB: number,
  accentR: number,
  accentG: number,
  accentB: number,
): Uint8Array {
  // IHDR
  const ihdr = new DataView(new ArrayBuffer(13));
  ihdr.setUint32(0, w);
  ihdr.setUint32(4, h);
  ihdr.setUint8(8, 8); // bit depth
  ihdr.setUint8(9, 2); // colour type = RGB
  ihdr.setUint8(10, 0); // compression
  ihdr.setUint8(11, 0); // filter
  ihdr.setUint8(12, 0); // interlace

  // Raw image data: each row = filter byte (0) + RGB pixels
  const rowBytes = 1 + w * 3;
  const raw = new Uint8Array(h * rowBytes);

  // Draw a simple design: bg fill with a centred accent rectangle
  const boxW = Math.floor(w * 0.5);
  const boxH = Math.floor(h * 0.4);
  const boxX = Math.floor((w - boxW) / 2);
  const boxY = Math.floor((h - boxH) / 2);

  for (let y = 0; y < h; y++) {
    const rowOffset = y * rowBytes;
    raw[rowOffset] = 0; // filter = none
    for (let x = 0; x < w; x++) {
      const px = rowOffset + 1 + x * 3;
      const inBox =
        x >= boxX && x < boxX + boxW && y >= boxY && y < boxY + boxH;
      if (inBox) {
        raw[px] = accentR;
        raw[px + 1] = accentG;
        raw[px + 2] = accentB;
      } else {
        raw[px] = bgR;
        raw[px + 1] = bgG;
        raw[px + 2] = bgB;
      }
    }
  }

  const compressed = deflateSync(raw);

  // Assemble
  const signature = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdrChunk = chunk("IHDR", new Uint8Array(ihdr.buffer));
  const idatChunk = chunk("IDAT", compressed);
  const iendChunk = chunk("IEND", new Uint8Array(0));

  const png = new Uint8Array(
    signature.length + ihdrChunk.length + idatChunk.length + iendChunk.length,
  );
  let off = 0;
  png.set(signature, off);
  off += signature.length;
  png.set(ihdrChunk, off);
  off += ihdrChunk.length;
  png.set(idatChunk, off);
  off += idatChunk.length;
  png.set(iendChunk, off);

  return png;
}

// ---- Generate ---------------------------------------------------------------

// Brand colours from app.css: bg=#0b0b0f, accent=#60a5fa
const bg = { r: 0x0b, g: 0x0b, b: 0x0f };
const accent = { r: 0x60, g: 0xa5, b: 0xfa };

const icon = makePng(128, 128, bg.r, bg.g, bg.b, accent.r, accent.g, accent.b);
const logo = makePng(250, 100, bg.r, bg.g, bg.b, accent.r, accent.g, accent.b);

await Bun.write(join(DIR, "icon.png"), icon);
await Bun.write(join(DIR, "logo.png"), logo);

console.log("Generated icon.png (128x128) and logo.png (250x100)");
console.log(
  "These are placeholders — replace with properly designed assets for production.",
);
