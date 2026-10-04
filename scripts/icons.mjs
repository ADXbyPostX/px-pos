#!/usr/bin/env node
/**
 * Renders pos-app launcher/splash icons from the brand SVGs with Inkscape.
 * Source: apps/pos-app/assets/brand/favicon/{favicon,px-white}.svg (Mandy's PX mark) for the icons,
 * apps/pos-app/assets/brand/pxpos/pxpos-white.svg (PXPOS wordmark) for the splash.
 * Output: apps/pos-app/assets/generated/*.png (referenced by app.config.ts).
 *
 *   npm run icons
 *
 * Why generated: the supplied PNGs stop at 512 px, while store icons need 1024 px,
 * iOS rejects transparency (full-bleed tile), and Android adaptive icons need the
 * mark inside the 66 dp safe circle (extra padding).
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const brand = join(root, "apps/pos-app/assets/brand/favicon");
const out = join(root, "apps/pos-app/assets/generated");
mkdirSync(out, { recursive: true });
const tmp = mkdtempSync(join(tmpdir(), "pxpos-icons-"));

const INKSCAPE = process.env.INKSCAPE ?? "inkscape";

function render(svg, name, size, { background } = {}) {
  const src = join(tmp, `${name}.svg`);
  writeFileSync(src, svg);
  const args = [src, "--export-type=png", `--export-filename=${join(out, `${name}.png`)}`, `--export-width=${size}`, `--export-height=${size}`];
  if (background) args.push(`--export-background=${background}`, "--export-background-opacity=1");
  else args.push("--export-background-opacity=0");
  execFileSync(INKSCAPE, args, { stdio: "pipe" });
  console.log(`  ✓ ${name}.png (${size}×${size})`);
}

const favicon = readFileSync(join(brand, "favicon.svg"), "utf8");
const pxposWhite = readFileSync(join(root, "apps/pos-app/assets/brand/pxpos/pxpos-white.svg"), "utf8");
const pxWhite = readFileSync(join(brand, "px-white.svg"), "utf8");

// The mark's centre in px-white.svg user units (viewBox 966.1 -271.9 1138.8 1138.8).
const CX = 966.1 + 1138.8 / 2;
const CY = -271.9 + 1138.8 / 2;
/** Re-frame the mark so it spans `fraction` of the canvas width (measured: 83% at the original viewBox). */
function reframe(svg, fraction) {
  const size = (1138.8 * 0.83) / fraction;
  const vb = `${(CX - size / 2).toFixed(1)} ${(CY - size / 2).toFixed(1)} ${size.toFixed(1)} ${size.toFixed(1)}`;
  return svg.replace(/viewBox="[^"]+"/, `viewBox="${vb}"`);
}

/** The wide wordmark centred on a transparent square; `fraction` = its viewBox width / the square's side. */
function squareWordmark(svg, fraction) {
  const [x, y, w, h] = svg.match(/viewBox="([^"]+)"/)[1].split(/\s+/).map(Number);
  const size = w / fraction;
  const vb = `${(x + w / 2 - size / 2).toFixed(1)} ${(y + h / 2 - size / 2).toFixed(1)} ${size.toFixed(1)} ${size.toFixed(1)}`;
  return svg.replace(/viewBox="[^"]+"/, `viewBox="${vb}"`).replace(/width="[^"]+"/, 'width="1024"').replace(/height="[^"]+"/, 'height="1024"');
}

console.log("Rendering pos-app icons →", out);
// iOS / legacy icon: full-bleed black square (no transparent corners; iOS applies its own mask).
render(favicon.replace(/rx="[^"]+"/, 'rx="0"'), "icon", 1024, { background: "#000000" });
// App Store rejects any alpha channel, even a fully opaque one: flatten with ImageMagick.
execFileSync(process.env.MAGICK ?? "magick", [join(out, "icon.png"), "-background", "#000000", "-alpha", "remove", "-alpha", "off", join(out, "icon.png")]);
console.log("  ✓ icon.png flattened (no alpha)");
// Android adaptive foreground: transparent, mark at ~52% so its diagonal fits the 66dp safe circle.
render(reframe(pxWhite, 0.52), "adaptive-foreground", 1024);
// Android 13 themed icon: same framing, single colour (white) silhouette.
render(reframe(pxWhite, 0.52).replace(/#fe0101/gi, "#ffffff"), "adaptive-monochrome", 1024);
// Splash: the PXPOS wordmark (Mandy, 2026-10-05). Expo centres the image at `imageWidth` (200 dp) in a
// 288 dp canvas and Android 12+ shows only the middle 192 dp circle. The SVG's viewBox carries side
// padding, so at 1.06 the letters span ~86% of the square (≈172 × 49 dp) with the corners still
// inside the circle.
render(squareWordmark(pxposWhite, 1.06), "splash", 1024);

rmSync(tmp, { recursive: true, force: true });
console.log("Done.");
