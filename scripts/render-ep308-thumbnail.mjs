#!/usr/bin/env node
/**
 * scripts/render-ep308-thumbnail.mjs
 *
 * YouTube thumbnail for ep 308 (Growing Pecans with Lenny Wells).
 * Guest-host episode: Tom Ruby + Jason Snyder interview Lenny Wells.
 * Per Ashley: photos of Tom AND Lenny, split side by side.
 *
 * Layout: dark ink text panel on the left (~500px), two vertical photo
 * strips filling the right (Lenny pruning a pecan tree + Tom).
 */

import sharp from 'sharp';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';

// Lenny Wells — UGA extension photo, pruning a young pecan tree (landscape)
const LENNY = '/root/.claude/uploads/3678a490-aea1-58e9-a311-723eff63b0d0/28116ecc-1000014250.jpg';
// Tom Ruby — outdoor selfie (portrait)
const TOM = '/root/.claude/uploads/3678a490-aea1-58e9-a311-723eff63b0d0/87e4eed3-1000014249.jpg';

const OUT_DIR = '/home/user/doomer-optimism/public/episodes/308';
const W = 1280, H = 720;

await mkdir(OUT_DIR, { recursive: true });
await sharp(LENNY).jpeg({ quality: 90 }).toFile(join(OUT_DIR, 'lenny-wells.jpg'));
await sharp(TOM).jpeg({ quality: 90 }).toFile(join(OUT_DIR, 'tom-ruby.jpg'));

// Two photo strips: each 390 × 720. Lenny's photo is landscape, so 'attention'
// crop finds his face; Tom's selfie is portrait and crops naturally.
const STRIP_W = 390;
const lennyPane = await sharp(LENNY)
  .resize({ width: STRIP_W, height: H, fit: 'cover', position: sharp.strategy.attention })
  .toBuffer();
const tomPane = await sharp(TOM)
  .resize({ width: STRIP_W, height: H, fit: 'cover', position: sharp.strategy.attention })
  .toBuffer();

const INK = '#1a140e';
const TAN = '#c9a37b';
const TERRA = '#c4632c';
const CREAM = '#e8d8b8';

const TEXT_W = W - STRIP_W * 2; // 500

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">
  <defs>
    <style>
      .wm-line { font-family: 'Cormorant Garamond', serif; font-weight: 600; font-size: 36px; fill: ${TAN}; letter-spacing: 0.5px; }
      .ep      { font-family: 'Inter', sans-serif; font-weight: 700; font-size: 60px; fill: ${TAN}; letter-spacing: 1px; }
      .title   { font-family: 'Inter', sans-serif; font-weight: 800; font-size: 68px; fill: ${TERRA}; letter-spacing: -1px; }
      .guests  { font-family: 'Inter', sans-serif; font-weight: 500; font-size: 30px; fill: ${CREAM}; }
    </style>
  </defs>
  <rect x="0" y="0" width="${W}" height="${H}" fill="${INK}" />
  <text x="56" y="80"  class="wm-line">Doomer</text>
  <text x="56" y="120" class="wm-line">Optimism</text>
  <text x="56" y="250" class="ep">DO 308</text>
  <text x="56" y="365" class="title">Growing</text>
  <text x="56" y="440" class="title">Pecans</text>
  <text x="56" y="520" class="guests">with Lenny Wells</text>
</svg>`;

const textPane = await sharp(Buffer.from(svg)).png().toBuffer();

// Thin ink divider between the two photo strips so they read as two frames.
const DIVIDER_W = 6;
await sharp({ create: { width: W, height: H, channels: 4, background: INK } })
  .composite([
    { input: textPane, top: 0, left: 0 },
    { input: lennyPane, top: 0, left: TEXT_W },
    { input: tomPane, top: 0, left: TEXT_W + STRIP_W + DIVIDER_W / 2 },
  ])
  .jpeg({ quality: 90 })
  .toFile(join(OUT_DIR, 'thumbnail.jpg'));

console.log('Wrote', join(OUT_DIR, 'thumbnail.jpg'));
