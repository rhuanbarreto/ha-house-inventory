/**
 * Build script — builds the React frontend with Bun's bundler, then
 * generates index.html with hashed asset references.
 *
 * Usage: bun run scripts/build.ts
 */

import { rmSync, mkdirSync } from "node:fs";
import { join, basename } from "node:path";

const ROOT = join(import.meta.dir, "..");
const OUT_DIR = join(ROOT, "dist", "static");

// Clean previous build
rmSync(OUT_DIR, { recursive: true, force: true });
mkdirSync(OUT_DIR, { recursive: true });

// Build the frontend SPA
const result = await Bun.build({
  entrypoints: [join(ROOT, "src", "frontend", "main.tsx")],
  outdir: OUT_DIR,
  minify: true,
  splitting: true,
  target: "browser",
  format: "esm",
  naming: {
    entry: "[name]-[hash].[ext]",
    chunk: "chunk-[hash].[ext]",
    asset: "[name]-[hash].[ext]",
  },
});

if (!result.success) {
  console.error("Frontend build failed:");
  for (const log of result.logs) {
    console.error(log);
  }
  process.exit(1);
}

// Find the generated file names
let jsEntry = "";
let cssFile = "";

for (const output of result.outputs) {
  const name = basename(output.path);
  if (name.startsWith("main-") && name.endsWith(".js")) {
    jsEntry = name;
  } else if (name.endsWith(".css")) {
    cssFile = name;
  }
}

if (!jsEntry) {
  console.error("No JS entry found in build output");
  process.exit(1);
}

// Generate index.html
// The server injects the ingress path into the meta tag at serve time.
const html = `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width,initial-scale=1" />
    <meta name="ingress-path" content="" />
    <title>House Inventory</title>
    ${cssFile ? `<link rel="stylesheet" href="./static/${cssFile}" />` : ""}
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="./static/${jsEntry}"></script>
  </body>
</html>`;

await Bun.write(join(OUT_DIR, "index.html"), html);

console.log(`[build] Frontend built successfully:`);
console.log(`  JS:   ${jsEntry}`);
if (cssFile) console.log(`  CSS:  ${cssFile}`);
console.log(`  HTML: index.html`);
console.log(`  Out:  ${OUT_DIR}`);
