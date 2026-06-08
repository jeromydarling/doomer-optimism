#!/usr/bin/env node
/**
 * scripts/render-ep305-thumbnail.mjs
 *
 * YouTube thumbnail for ep 305 (Patrick Lemmon + Seth Harris / Orthodox
 * Masonry). The source is an iOS screenshot of a portrait photo: Patrick
 * stands inside the brick arch, Seth sits on the step to his right. Both
 * are guests — both must be visible in the thumbnail.
 *
 * Layout: photo on the right (640×720) with both figures in frame, text
 * block on the left, matching ep 304's style.
 */

import sharp from 'sharp';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';

const SRC = '/root/.claude/uploads/3678a490-aea1-58e9-a311-723eff63b0d0/51dec415-1000012851.png';
const OUT_DIR = '/home/user/doomer-optimism/public/episodes/305';
const W = 1280, H = 720;

// ---- 1. clean the screenshot ---------------------------------------------------
// Source: 1179 × 2556 iOS screenshot. The brick-wall photo runs y≈110..1900.
// Patrick stands in the arch (head ~y=720, feet ~y=1450). Seth sits on the
// stone step to his right (head ~y=1450, feet ~y=1850). Keep the full photo
// so both figures are inside the frame.
const photoSrc = await sharp(SRC)
  .extract({ left: 0, top: 110, width: 1179, height: 1790 })
  .toBuffer();

await mkdir(OUT_DIR, { recursive: true });
await sharp(photoSrc).jpeg({ quality: 88 }).toFile(join(OUT_DIR, 'guests.jpg'));

// ---- 2. right-pane photo crop --------------------------------------------------
// Photo is portrait (1179 × 1395, aspect 0.85). The right pane is 640 × 720
// (aspect 0.89). Sharp's cover fit scales by width (factor 0.543), giving an
// intermediate 640 × 758. We need to crop 38px of height. Use a numerical
// `top:` offset that keeps both figures: Patrick standing (orig y≈600..1100)
// and Seth sitting on the step (orig y≈1100..1450). Scaled positions:
//   Patrick: 326..597    Seth: 597..787 (of 757 total).
// Bias the crop hard to the bottom so Seth doesn't get cut off.
// Scale the photo by HEIGHT — no cropping. The full source is shown, both
// figures intact. The resulting pane is narrower than half the thumbnail,
// which is fine — the wide text block balances it.
const photoPane = await sharp(photoSrc)
  .resize({ height: H })  // height-fit, no extract; full image preserved
  .toBuffer();
const photoMeta = await sharp(photoPane).metadata();
const RIGHT_W = photoMeta.width;

// ---- 3. SVG text overlay (matches the 304 thumbnail visual language) ----------
const INK = '#1a140e';
const TAN = '#c9a37b';
const TERRA = '#c4632c';
const CREAM = '#e8d8b8';

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">
  <defs>
    <style>
      .wm-line { font-family: 'Cormorant Garamond', serif; font-weight: 600; font-size: 36px; fill: ${TAN}; letter-spacing: 0.5px; }
      .ep      { font-family: 'Inter', sans-serif; font-weight: 700; font-size: 64px; fill: ${TAN}; letter-spacing: 1px; }
      .title   { font-family: 'Inter', sans-serif; font-weight: 800; font-size: 78px; fill: ${TERRA}; letter-spacing: -1px; }
      .guests  { font-family: 'Inter', sans-serif; font-weight: 500; font-size: 32px; fill: ${CREAM}; }
    </style>
  </defs>
  <rect x="0" y="0" width="${W}" height="${H}" fill="${INK}" />
  <text x="60" y="80"  class="wm-line">Doomer</text>
  <text x="60" y="120" class="wm-line">Optimism</text>
  <text x="60" y="245" class="ep">DO 305</text>
  <text x="60" y="345" class="title">Orthodox</text>
  <text x="60" y="425" class="title">Masonry</text>
  <text x="60" y="495" class="guests">with Patrick Lemmon</text>
  <text x="60" y="535" class="guests">&amp; Seth Harris</text>
</svg>`;

const textPane = await sharp(Buffer.from(svg)).png().toBuffer();

// ---- 4. final composite --------------------------------------------------------
await sharp({ create: { width: W, height: H, channels: 4, background: INK } })
  .composite([
    { input: textPane, top: 0, left: 0 },
    { input: photoPane, top: 0, left: W - RIGHT_W },
  ])
  .jpeg({ quality: 90 })
  .toFile(join(OUT_DIR, 'thumbnail.jpg'));

console.log('Wrote', join(OUT_DIR, 'thumbnail.jpg'));
console.log('Wrote', join(OUT_DIR, 'guests.jpg'));
