#!/usr/bin/env node
/**
 * scripts/hedcut.mjs — local hedcut-style portrait generator.
 *
 * Pipeline:
 *   raw photo  ->  bg-aware crop + grayscale buffer  ->  SVG variants.
 *
 * Three output variants per input:
 *   v1-woodcut.svg     — high-contrast B&W threshold (bold paper-cut feel)
 *   v2-halftone.svg    — variable-radius dots scaled by darkness (newspaper-portrait feel)
 *   v3-stipple.svg     — fine-grain stipple pattern (closest to a true hand-engraved hedcut)
 *
 * Usage:
 *   node scripts/hedcut.mjs <input-image> <output-dir> [--name=Chris]
 *
 * Outputs are SVGs — they scale perfectly and slot directly into the contributor card
 * component as a drop-in replacement for HedcutPlaceholder.astro when commissioned art lands.
 */

import sharp from 'sharp';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, basename, extname, join } from 'node:path';

const args = process.argv.slice(2);
if (args.length < 2) {
  console.error('Usage: node scripts/hedcut.mjs <input> <output-dir> [--name=...]');
  process.exit(2);
}
const [input, outputDir, ...rest] = args;
const name = (rest.find((a) => a.startsWith('--name='))?.split('=')[1]) || basename(input, extname(input));

const INK = '#2A2117';
const PAPER = '#F4ECDB';

const seeded = (seed) => {
  let s = seed | 0 || 1;
  return () => {
    s = Math.imul(s ^ (s >>> 15), 0x2c1b3c6d);
    s ^= s >>> 12;
    s = Math.imul(s ^ (s << 3), 0x297a2d39);
    s ^= s >>> 7;
    return ((s >>> 0) / 0xffffffff);
  };
};

await mkdir(outputDir, { recursive: true });

// We want a portrait crop. The input is whatever shape the user has; we crop to a 4:5 aspect
// centered on the detected subject (sharp's smart crop attends to entropy/face heuristics).
const TARGET_W = 480;
const TARGET_H = 600;

// Preprocess: smart-crop to portrait aspect, grayscale, normalize, sharpen, then
// re-map tones aggressively so the face occupies the bulk of the dynamic range
// (this rescues detail that would otherwise be lost when the background is bright,
// e.g. snowy outdoor photos).
const baseBuf = await sharp(input)
  .rotate() // honor EXIF
  .resize(TARGET_W, TARGET_H, { fit: 'cover', position: sharp.strategy.attention })
  .grayscale()
  .normalise()
  .sharpen({ sigma: 1.2, m1: 0.6, m2: 2.5 })
  .linear(1.45, -42) // a*x + b — push contrast, lift shadows slightly
  .toBuffer();

const meta = await sharp(baseBuf).metadata();
const W = meta.width;
const H = meta.height;

// Downsample to a coarse luminance grid for SVG rendering.
const cell = (cellPx) => {
  const cw = Math.round(W / cellPx);
  const ch = Math.round(H / cellPx);
  return { cw, ch, cellPx };
};

const sampleGrid = async (cellPx) => {
  const { cw, ch } = cell(cellPx);
  const raw = await sharp(baseBuf).resize(cw, ch, { kernel: 'lanczos3' }).raw().toBuffer();
  // raw is single-channel grayscale, length = cw * ch
  return { cw, ch, cellPx, raw };
};

const svgHeader = (w, h) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" preserveAspectRatio="xMidYMid meet">` +
  `<rect width="${w}" height="${h}" fill="${PAPER}"/>` +
  `<g fill="${INK}" stroke="none">`;
const svgFooter = `</g><title>${escapeXml(name)} — hedcut</title></svg>`;

function escapeXml(s) {
  return String(s).replace(/[<>&"']/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' }[c]));
}

// === V1: high-contrast B&W threshold (woodcut feel) =============================
// Use Otsu's method for an adaptive threshold per source photo so faces survive
// regardless of background brightness.
function otsuThreshold(raw) {
  const hist = new Array(256).fill(0);
  for (let i = 0; i < raw.length; i++) hist[raw[i]]++;
  const total = raw.length;
  let sum = 0;
  for (let i = 0; i < 256; i++) sum += i * hist[i];
  let sumB = 0, wB = 0, wF = 0, mB, mF, max = 0, between, threshold = 128;
  for (let i = 0; i < 256; i++) {
    wB += hist[i];
    if (wB === 0) continue;
    wF = total - wB;
    if (wF === 0) break;
    sumB += i * hist[i];
    mB = sumB / wB;
    mF = (sum - sumB) / wF;
    between = wB * wF * (mB - mF) * (mB - mF);
    if (between > max) { max = between; threshold = i; }
  }
  return threshold;
}

async function variantWoodcut() {
  const cellPx = 3;
  const { cw, ch, raw } = await sampleGrid(cellPx);
  // Slight bias toward keeping more black so facial detail reads in print.
  const T = Math.min(180, otsuThreshold(raw) + 18);
  let body = svgHeader(W, H);
  for (let y = 0; y < ch; y++) {
    let runStart = -1;
    for (let x = 0; x < cw; x++) {
      const lum = raw[y * cw + x];
      const isBlack = lum < T;
      if (isBlack && runStart < 0) runStart = x;
      if ((!isBlack || x === cw - 1) && runStart >= 0) {
        const runEnd = isBlack ? x : x - 1;
        body += `<rect x="${runStart * cellPx}" y="${y * cellPx}" width="${(runEnd - runStart + 1) * cellPx}" height="${cellPx}"/>`;
        runStart = -1;
      }
    }
  }
  body += svgFooter;
  return body;
}

// === V2: halftone dots (newspaper-portrait feel) ================================
async function variantHalftone() {
  const cellPx = 6;
  const { cw, ch, raw } = await sampleGrid(cellPx);
  let body = svgHeader(W, H);
  for (let y = 0; y < ch; y++) {
    for (let x = 0; x < cw; x++) {
      const lum = raw[y * cw + x];
      const darkness = 1 - lum / 255;
      if (darkness < 0.04) continue;
      const r = darkness * 0.62 * cellPx;
      const cx = x * cellPx + cellPx / 2;
      const cy = y * cellPx + cellPx / 2;
      body += `<circle cx="${cx}" cy="${cy}" r="${r.toFixed(2)}"/>`;
    }
  }
  body += svgFooter;
  return body;
}

// === V3: fine stipple (hand-engraved hedcut feel) ==============================
async function variantStipple() {
  const cellPx = 3;
  const { cw, ch, raw } = await sampleGrid(cellPx);
  let body = svgHeader(W, H);
  const rng = seeded(name.split('').reduce((a, c) => a + c.charCodeAt(0), 0));
  const dotR = 0.55;
  for (let y = 0; y < ch; y++) {
    for (let x = 0; x < cw; x++) {
      const lum = raw[y * cw + x];
      const darkness = 1 - lum / 255;
      if (darkness < 0.06) continue;
      // Number of stipple dots in this 3x3-ish cell scales with darkness; up to ~6.
      const n = Math.min(6, Math.round(darkness * darkness * 7.2));
      for (let i = 0; i < n; i++) {
        const jx = (rng() * 0.95 + 0.025) * cellPx;
        const jy = (rng() * 0.95 + 0.025) * cellPx;
        const cx = x * cellPx + jx;
        const cy = y * cellPx + jy;
        body += `<circle cx="${cx.toFixed(2)}" cy="${cy.toFixed(2)}" r="${dotR}"/>`;
      }
    }
  }
  body += svgFooter;
  return body;
}

const writeOut = async (filename, content) => {
  const path = join(outputDir, filename);
  await writeFile(path, content, 'utf8');
  return path;
};

console.log(`Source : ${input}`);
console.log(`Subject: ${name}`);
console.log(`Canvas : ${W}×${H}`);
console.log('');

const v1 = await variantWoodcut();
const v2 = await variantHalftone();
const v3 = await variantStipple();

const p1 = await writeOut(`${slug(name)}-v1-woodcut.svg`, v1);
const p2 = await writeOut(`${slug(name)}-v2-halftone.svg`, v2);
const p3 = await writeOut(`${slug(name)}-v3-stipple.svg`, v3);

// Also write a side-by-side preview HTML for the pitch deck
const compareHtml = `<!doctype html><html><head><meta charset="utf-8"/>
<title>${escapeXml(name)} — hedcut variants</title>
<style>
  body { background:#F4ECDB; color:#2A2117; font-family: 'EB Garamond', Georgia, serif; padding: 3rem 2rem; margin: 0; }
  h1 { font-family: 'Cormorant Garamond', Garamond, serif; font-weight: 500; font-size: 2.5rem; margin: 0 0 0.5rem; }
  p.lede { font-style: italic; max-width: 56ch; color: #5A4D3B; margin: 0 0 2.5rem; }
  .grid { display: grid; gap: 2rem; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); max-width: 1180px; margin: 0 auto; }
  figure { margin: 0; border: 1px solid rgba(42,33,23,0.18); padding: 1.25rem; background: rgba(255,255,255,0.35); }
  figure img { width: 100%; height: auto; display: block; }
  figcaption { font-size: 0.72rem; text-transform: uppercase; letter-spacing: 0.18em; color: #5A4D3B; margin-top: 1rem; font-family: 'Inter', system-ui, sans-serif; }
  figcaption b { display: block; font-family: 'Cormorant Garamond', Garamond, serif; font-weight: 500; font-size: 1.4rem; letter-spacing: 0; text-transform: none; color: #2A2117; margin-bottom: 0.35rem; }
</style>
</head><body>
<div class="grid" style="grid-template-columns: 1fr; max-width: 720px;">
  <h1>${escapeXml(name)} — hedcut variants</h1>
  <p class="lede">Three local-pipeline stylizations of a single source photo, generated from sharp + a deterministic SVG renderer. All three scale perfectly; pick the one Ashley likes and we batch the rest of the contributors with the same settings.</p>
</div>
<div class="grid">
  <figure><img src="${slug(name)}-v1-woodcut.svg" alt="v1 woodcut"/><figcaption><b>V1 · Woodcut</b>High-contrast threshold. Bold, paper-cut feel.</figcaption></figure>
  <figure><img src="${slug(name)}-v2-halftone.svg" alt="v2 halftone"/><figcaption><b>V2 · Halftone</b>Variable-radius dots scaled by darkness. Newspaper-portrait classic.</figcaption></figure>
  <figure><img src="${slug(name)}-v3-stipple.svg" alt="v3 stipple"/><figcaption><b>V3 · Stipple</b>Fine-grain random stipple. Closest to a hand-engraved hedcut.</figcaption></figure>
</div>
</body></html>`;
const pHtml = await writeOut(`${slug(name)}-compare.html`, compareHtml);

console.log('Wrote:');
console.log('  ' + p1);
console.log('  ' + p2);
console.log('  ' + p3);
console.log('  ' + pHtml);

function slug(s) {
  return String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
}
