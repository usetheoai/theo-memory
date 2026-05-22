/**
 * Render Excalidraw JSON to SVG using @excalidraw/utils (no browser needed).
 * Then convert SVG to PNG via Playwright screenshot.
 *
 * Usage:
 *   node render_excalidraw.mjs <input.excalidraw> [--output path.png] [--scale 2]
 *
 * First-time setup:
 *   cd .claude/skills/excalidraw/references
 *   npm install
 *   npx playwright install chromium
 */

import { readFileSync, writeFileSync } from "fs";
import { resolve, basename, dirname, join } from "path";

// Dynamic import for @excalidraw/utils (CJS module)
const { exportToSvg } = await import("@excalidraw/utils");

// Parse CLI args
const args = process.argv.slice(2);
if (args.length === 0 || args.includes("--help")) {
  console.log("Usage: node render_excalidraw.mjs <input.excalidraw> [--output path.png] [--scale 2] [--svg-only]");
  process.exit(0);
}

const inputPath = resolve(args[0]);
let outputPath = null;
let scale = 2;
let svgOnly = false;

for (let i = 1; i < args.length; i++) {
  if (args[i] === "--output" || args[i] === "-o") outputPath = resolve(args[++i]);
  if (args[i] === "--scale" || args[i] === "-s") scale = parseInt(args[++i]);
  if (args[i] === "--svg-only") svgOnly = true;
}

// Read and parse
const raw = readFileSync(inputPath, "utf-8");
const data = JSON.parse(raw);

if (data.type !== "excalidraw") {
  console.error("ERROR: Not a valid excalidraw file");
  process.exit(1);
}

const elements = data.elements || [];
const appState = {
  ...(data.appState || {}),
  exportBackground: true,
  viewBackgroundColor: data.appState?.viewBackgroundColor || "#ffffff",
};

// Export to SVG string
const svg = await exportToSvg({ elements, appState, files: data.files || {} });
const svgString = typeof svg === "string" ? svg : svg.outerHTML || new (await import("xmldom")).XMLSerializer().serializeToString(svg);

// Save SVG
const dir = dirname(inputPath);
const base = basename(inputPath, ".excalidraw");
const svgPath = outputPath?.replace(/\.png$/, ".svg") || join(dir, `${base}.svg`);
writeFileSync(svgPath, svgString);
console.log(svgPath);

if (svgOnly) {
  process.exit(0);
}

// Convert SVG to PNG via Playwright
const pngPath = outputPath || join(dir, `${base}.png`);

try {
  const { chromium } = await import("playwright");
  const browser = await chromium.launch({ headless: true, args: ["--no-sandbox"] });
  const page = await browser.newPage({
    viewport: { width: 1400, height: 900 },
    deviceScaleFactor: scale,
  });

  // Load SVG as data URI
  const svgBase64 = Buffer.from(svgString).toString("base64");
  const dataUri = `data:image/svg+xml;base64,${svgBase64}`;

  await page.setContent(`
    <!DOCTYPE html>
    <html><head><style>
      * { margin: 0; padding: 0; }
      body { background: transparent; display: inline-block; }
      img { display: block; }
    </style></head>
    <body><img id="diagram" src="${dataUri}" /></body></html>
  `);

  await page.waitForSelector("#diagram");
  // Wait for image to load
  await page.waitForFunction('document.querySelector("#diagram").complete');

  const img = await page.$("#diagram");
  await img.screenshot({ path: pngPath, omitBackground: false });
  await browser.close();

  console.log(pngPath);
} catch (err) {
  console.error(`WARNING: PNG conversion failed (${err.message}). SVG was saved successfully.`);
  process.exit(0); // SVG still works
}
