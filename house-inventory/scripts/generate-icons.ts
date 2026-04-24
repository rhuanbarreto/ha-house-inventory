/**
 * Generate icon.png (128×128) and logo.png (250×100) from the SVG source.
 *
 * Uses @resvg/resvg-js (a Rust-based SVG renderer) to produce high-quality
 * rasterised PNGs that match the icon.svg design exactly.
 *
 * Usage:
 *   bun run scripts/generate-icons.ts
 */

import { Resvg } from "@resvg/resvg-js";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const DIR = join(import.meta.dir, "..");
const svgSource = readFileSync(join(DIR, "icon.svg"), "utf-8");

// ---- icon.png — 128×128, direct render of the SVG at native size -----------

const iconResvg = new Resvg(svgSource, {
  fitTo: { mode: "width", value: 128 },
  font: {
    // Use a generic sans-serif so the "INVENTORY" text renders.
    defaultFontFamily: "Arial, Helvetica, sans-serif",
    loadSystemFonts: true,
  },
});
const iconPng = iconResvg.render().asPng();
await Bun.write(join(DIR, "icon.png"), iconPng);
console.log(`icon.png  — ${iconPng.byteLength} bytes (128×128)`);

// ---- logo.png — 250×100, the icon centred on a dark canvas -----------------

// Build a wider SVG that embeds the icon centred in a 250×100 canvas, with
// the brand name to the right.
const logoSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 250 100" fill="none">
  <rect width="250" height="100" rx="12" fill="#0b0b0f"/>

  <!-- Scaled-down icon (80×80) placed on the left -->
  <g transform="translate(10 10) scale(0.625)">
    <rect x="16" y="16" width="96" height="96" rx="12" fill="#131318" stroke="#27272a" stroke-width="1.5"/>
    <g transform="translate(32 28)" stroke="#60a5fa" stroke-width="2" fill="none">
      <rect x="0" y="0" width="32" height="22" rx="3"/>
      <rect x="32" y="0" width="32" height="22" rx="3"/>
      <rect x="0" y="22" width="32" height="22" rx="3"/>
      <rect x="32" y="22" width="32" height="22" rx="3" fill="#1e3a8a"/>
      <rect x="0" y="44" width="32" height="22" rx="3"/>
      <rect x="32" y="44" width="32" height="22" rx="3"/>
    </g>
  </g>

  <!-- Brand text -->
  <text x="105" y="43" fill="#f4f4f5" font-family="system-ui, -apple-system, sans-serif" font-weight="600" font-size="18" letter-spacing="-0.01em">House</text>
  <text x="105" y="68" fill="#60a5fa" font-family="system-ui, -apple-system, sans-serif" font-weight="600" font-size="18" letter-spacing="-0.01em">Inventory</text>
</svg>`;

const logoResvg = new Resvg(logoSvg, {
  fitTo: { mode: "width", value: 250 },
  font: {
    defaultFontFamily: "Arial, Helvetica, sans-serif",
    loadSystemFonts: true,
  },
});
const logoPng = logoResvg.render().asPng();
await Bun.write(join(DIR, "logo.png"), logoPng);
console.log(`logo.png  — ${logoPng.byteLength} bytes (250×100)`);

console.log("Done.");
