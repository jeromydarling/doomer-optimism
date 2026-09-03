#!/usr/bin/env node
/**
 * scripts/render-ep310-thumbnail.mjs
 *
 * YouTube thumbnail for ep 310 (Chapter House Books — Josh & Hannah Centers).
 * No guest headshots this time; per Ashley, the visual is Chapter House's
 * clothbound book covers (pulled from https://chapter.house/). Three covers
 * staggered on the dark ink ground: Beowulf (gold), Iliad (blue),
 * Odyssey (red).
 */

import sharp from 'sharp';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';

const SRC_DIR = '/tmp/claude-0/-home-user-doomer-optimism/3678a490-aea1-58e9-a311-723eff63b0d0/scratchpad';
const OUT_DIR = '/home/user/doomer-optimism/public/episodes/310';
const W = 1280, H = 720;

await mkdir(OUT_DIR, { recursive: true });

// Archive the covers we used (webp → jpg on white for the repo).
const COVERS = ['CH2_Beowulf', 'CH3_Iliad', 'CH4_Odyssey'];
for (const c of COVERS) {
  await sharp(join(SRC_DIR, `${c}.webp`))
    .flatten({ background: '#f4ecdb' })
    .jpeg({ quality: 90 })
    .toFile(join(OUT_DIR, `${c.replace(/^CH\d_/, '').toLowerCase()}-cover.jpg`));
}

// Books: each ~270px wide (aspect 800:1193 → ~403px tall), staggered
// vertically and slightly overlapping so they read as a set on a shelf.
const BOOK_W = 270;
const books = await Promise.all(
  COVERS.map((c) => sharp(join(SRC_DIR, `${c}.webp`)).resize({ width: BOOK_W }).png().toBuffer()),
);

const INK = '#1a140e';
const TAN = '#c9a37b';
const TERRA = '#c4632c';
const CREAM = '#e8d8b8';

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">
  <defs>
    <style>
      .wm-line { font-family: 'Cormorant Garamond', serif; font-weight: 600; font-size: 36px; fill: ${TAN}; letter-spacing: 0.5px; }
      .ep      { font-family: 'Inter', sans-serif; font-weight: 700; font-size: 60px; fill: ${TAN}; letter-spacing: 1px; }
      .title   { font-family: 'Inter', sans-serif; font-weight: 800; font-size: 66px; fill: ${TERRA}; letter-spacing: -1px; }
      .guests  { font-family: 'Inter', sans-serif; font-weight: 500; font-size: 29px; fill: ${CREAM}; }
    </style>
  </defs>
  <rect x="0" y="0" width="${W}" height="${H}" fill="${INK}" />
  <text x="56" y="80"  class="wm-line">Doomer</text>
  <text x="56" y="120" class="wm-line">Optimism</text>
  <text x="56" y="250" class="ep">DO 310</text>
  <text x="56" y="365" class="title">Chapter</text>
  <text x="56" y="437" class="title">House Books</text>
  <text x="56" y="517" class="guests">with Josh &amp; Hannah Centers</text>
</svg>`;

const textPane = await sharp(Buffer.from(svg)).png().toBuffer();

// Staggered shelf: Beowulf high-left, Iliad low-center, Odyssey mid-right.
// Book height at 270w ≈ 403h.
await sharp({ create: { width: W, height: H, channels: 4, background: INK } })
  .composite([
    { input: textPane, top: 0, left: 0 },
    { input: books[0], top: 90,  left: 560 },   // Beowulf (gold)
    { input: books[1], top: 250, left: 790 },   // Iliad (blue)
    { input: books[2], top: 140, left: 1010 },  // Odyssey (red) — bleeds off right edge
  ])
  .jpeg({ quality: 90 })
  .toFile(join(OUT_DIR, 'thumbnail.jpg'));

console.log('Wrote', join(OUT_DIR, 'thumbnail.jpg'));
