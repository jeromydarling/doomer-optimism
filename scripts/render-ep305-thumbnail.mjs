#!/usr/bin/env node
/**
 * scripts/render-ep305-thumbnail.mjs
 *
 * One-off: crop the iOS screenshot of Patrick + Seth in front of their brick
 * arch, then composite a 1280×720 YouTube thumbnail in the same shape as
 * Ashley's ep 304 thumbnail (dark ground, terracotta title, photo right).
 */

import sharp from 'sharp';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const SRC = '/root/.claude/uploads/3678a490-aea1-58e9-a311-723eff63b0d0/51dec415-1000012851.png';
const OUT_DIR = '/home/user/doomer-optimism/public/episodes/305';
const W = 1280, H = 720;

// ---- 1. clean the screenshot ---------------------------------------------------
// Source is 1179 × 2556 (iOS screenshot). The brick-wall photo content runs
// y=110..1505. Patrick stands in the arch (face ~y=700), Seth sits to his
// right (face ~y=1130). Crop tight to a box that includes both faces + a
// bit of the surrounding arch.
const photoSrc = await sharp(SRC)
  .extract({ left: 200, top: 580, width: 800, height: 920 })
  .toBuffer();

await mkdir(OUT_DIR, { recursive: true });
await sharp(photoSrc).jpeg({ quality: 88 }).toFile(join(OUT_DIR, 'guests.jpg'));

// ---- 2. thumbnail compose ------------------------------------------------------
// Right half = photo cropped to focus on the arch + people.
// The cleaned photo is 1179 × ~1530 (portrait). For the thumbnail's right pane
// (~640 × 720), we crop a portrait slice centered on the figures.
// Pre-crop is already tight around both faces; centre fit will frame them.
const RIGHT_W = 640;
const photoPane = await sharp(photoSrc)
  .resize({ width: RIGHT_W, height: H, fit: 'cover', position: 'centre' })
  .toBuffer();

// ---- 3. SVG text overlay -------------------------------------------------------
// Match 304's hierarchy: small "Doomer Optimism" wordmark, big "DO 305",
// huge terracotta title, cream guest line.
const INK = '#1a140e';        // very dark brown background
const TAN = '#c9a37b';        // wordmark + "DO 305"
const TERRA = '#c4632c';      // title accent
const CREAM = '#e8d8b8';      // body cream

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">
  <defs>
    <style>
      .wm-line { font-family: 'Cormorant Garamond', serif; font-weight: 600; font-size: 36px; fill: ${TAN}; letter-spacing: 0.5px; }
      .ep      { font-family: 'Inter', sans-serif; font-weight: 700; font-size: 64px; fill: ${TAN}; letter-spacing: 1px; }
      .title   { font-family: 'Inter', sans-serif; font-weight: 800; font-size: 78px; fill: ${TERRA}; letter-spacing: -1px; }
      .guests  { font-family: 'Inter', sans-serif; font-weight: 500; font-size: 32px; fill: ${CREAM}; }
    </style>
  </defs>
  <!-- dark ground -->
  <rect x="0" y="0" width="${W}" height="${H}" fill="${INK}" />
  <!-- left text block -->
  <text x="60" y="80"  class="wm-line">Doomer</text>
  <text x="60" y="120" class="wm-line">Optimism</text>
  <text x="60" y="245" class="ep">DO 305</text>
  <text x="60" y="345" class="title">Orthodox</text>
  <text x="60" y="425" class="title">Masonry</text>
  <text x="60" y="495" class="guests">with Patrick Lemmon</text>
  <text x="60" y="535" class="guests">&amp; Seth Harris</text>
</svg>`;

const textPane = await sharp(Buffer.from(svg))
  .png()
  .toBuffer();

// ---- 4. final composite --------------------------------------------------------
const thumbnail = await sharp({
  create: { width: W, height: H, channels: 4, background: INK },
})
  .composite([
    { input: textPane, top: 0, left: 0 },
    { input: photoPane, top: 0, left: W - RIGHT_W },
  ])
  .jpeg({ quality: 90 })
  .toFile(join(OUT_DIR, 'thumbnail.jpg'));

console.log('Wrote', join(OUT_DIR, 'thumbnail.jpg'));
console.log('Wrote', join(OUT_DIR, 'guests.jpg'));
