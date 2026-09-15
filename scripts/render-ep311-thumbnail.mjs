#!/usr/bin/env node
/**
 * scripts/render-ep311-thumbnail.mjs
 *
 * YouTube thumbnail for ep 311 (Mike Healy — Manufacturing Community).
 *
 * Source is Mike's photo of the Wilmot Productions crew on the plant floor
 * (Halloween 2025, shot on a phone — EXIF orientation 6, so .rotate() must
 * run before anything else or it composites sideways).
 *
 * The crew spans the full frame width in the lower half, so the usual
 * text-left / photo-right split would crop people off at both edges.
 * Instead: full-bleed photo with a gradient scrim over the empty plant
 * floor in the upper left, and the text on that.
 *
 * Title hierarchy follows Ashley's email spec — guest name is the headline,
 * "Manufacturing Community" is the subtitle.
 */

import sharp from 'sharp';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';

const SRC = '/tmp/claude-0/-home-user-doomer-optimism/3678a490-aea1-58e9-a311-723eff63b0d0/scratchpad/healy-crew.jpg';
const OUT_DIR = '/home/user/doomer-optimism/public/episodes/311';
const W = 1280, H = 720;

await mkdir(OUT_DIR, { recursive: true });

// 1. Auto-orient from EXIF, then archive a web-sized copy of the full frame.
const oriented = await sharp(SRC).rotate().toBuffer();
const { width: OW, height: OH } = await sharp(oriented).metadata();

await sharp(oriented)
  .resize({ width: 1600, withoutEnlargement: true })
  .jpeg({ quality: 88 })
  .toFile(join(OUT_DIR, 'wilmot-crew.jpg'));

// 2. Crop a 16:9 window at full width. Placed so the band of empty floor
//    above the crew lands in the upper third (text zone) while every face
//    stays in frame; the crew is cut around the waist at the bottom.
const cropH = Math.round(OW * 9 / 16);          // 3072 → 1728
const cropTop = Math.round(OH * 0.372);         // ≈1524 of 4096
const photo = await sharp(oriented)
  .extract({ left: 0, top: cropTop, width: OW, height: cropH })
  .resize({ width: W, height: H })
  .modulate({ brightness: 0.97 })
  .toBuffer();

// 3. Scrim: a radial vignette anchored to the top-left corner. Avoid SVG
//    masks with blend modes here — librsvg (what sharp renders with) ignores
//    mix-blend-mode inside a mask and flattens it to a full-frame scrim,
//    which dims the whole crew. A radialGradient renders correctly and the
//    falloff keeps the darkening on the empty floor behind the text.
const scrim = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">
  <defs>
    <radialGradient id="corner" cx="0%" cy="0%" r="86%">
      <stop offset="0%"  stop-color="#150f09" stop-opacity="0.93"/>
      <stop offset="52%" stop-color="#150f09" stop-opacity="0.80"/>
      <stop offset="80%" stop-color="#150f09" stop-opacity="0.30"/>
      <stop offset="100%" stop-color="#150f09" stop-opacity="0"/>
    </radialGradient>
  </defs>
  <rect width="${W}" height="${H}" fill="url(#corner)" />
</svg>`;

// 4. Text. Terracotta is nudged brighter than the flat-ink layouts so it
//    holds up over photography.
const TAN = '#c9a37b';
const TERRA = '#e0702f';
const CREAM = '#efe3c8';

// Each line is drawn twice — a dark copy offset down-right, then the real
// one on top. That hand-rolled shadow keeps the lower lines legible where
// the vignette has thinned out over the bright plant floor, without having
// to darken the scrim enough to dull the crew.
const LINES = [
  { x: 56, y: 72,  cls: 'wm-line', s: 'Doomer' },
  { x: 56, y: 112, cls: 'wm-line', s: 'Optimism' },
  { x: 56, y: 222, cls: 'ep',      s: 'DO 311' },
  { x: 56, y: 316, cls: 'title',   s: 'Mike Healy' },
  { x: 56, y: 372, cls: 'sub',     s: 'Manufacturing Community' },
];
const shadowed = LINES.map(
  (l) => `<text x="${l.x + 3}" y="${l.y + 3}" class="${l.cls} shadow">${l.s}</text>`,
).join('\n  ');
const foreground = LINES.map(
  (l) => `<text x="${l.x}" y="${l.y}" class="${l.cls}">${l.s}</text>`,
).join('\n  ');

const text = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">
  <defs>
    <style>
      .wm-line { font-family: 'Cormorant Garamond', serif; font-weight: 600; font-size: 36px; fill: ${TAN}; letter-spacing: 0.5px; }
      .ep      { font-family: 'Inter', sans-serif; font-weight: 700; font-size: 58px; fill: ${TAN}; letter-spacing: 1px; }
      .title   { font-family: 'Inter', sans-serif; font-weight: 800; font-size: 76px; fill: ${TERRA}; letter-spacing: -1.5px; }
      .sub     { font-family: 'Inter', sans-serif; font-weight: 500; font-size: 33px; fill: ${CREAM}; }
      .shadow  { fill: #0d0906; fill-opacity: 0.75; }
    </style>
  </defs>
  ${shadowed}
  ${foreground}
</svg>`;

await sharp(photo)
  .composite([
    { input: Buffer.from(scrim), top: 0, left: 0 },
    { input: Buffer.from(text), top: 0, left: 0 },
  ])
  .jpeg({ quality: 90 })
  .toFile(join(OUT_DIR, 'thumbnail.jpg'));

console.log('Wrote', join(OUT_DIR, 'thumbnail.jpg'));
console.log('Wrote', join(OUT_DIR, 'wilmot-crew.jpg'));
