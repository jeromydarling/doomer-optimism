#!/usr/bin/env node
/**
 * scripts/render-ep307-thumbnail.mjs
 *
 * YouTube thumbnail for ep 307 (Jacob Hundt / Microcolleges). Same visual
 * language as ep 304-306: dark ink ground on the left with the wordmark +
 * ep # + terracotta title + cream guest line, big square headshot on the
 * right. Source is a 667×667 square headshot Jacob sent Ashley.
 */

import sharp from 'sharp';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';

const SRC = '/root/.claude/uploads/3678a490-aea1-58e9-a311-723eff63b0d0/be9492a4-1000014024.jpg';
const OUT_DIR = '/home/user/doomer-optimism/public/episodes/307';
const W = 1280, H = 720;

await mkdir(OUT_DIR, { recursive: true });
await sharp(SRC).jpeg({ quality: 92 }).toFile(join(OUT_DIR, 'guest.jpg'));

const RIGHT_W = 720;
const photoPane = await sharp(SRC).resize({ width: RIGHT_W, height: H, fit: 'cover' }).toBuffer();

const INK = '#1a140e';
const TAN = '#c9a37b';
const TERRA = '#c4632c';
const CREAM = '#e8d8b8';

// "Microcolleges" is a single 12-char word — bigger font fits.
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">
  <defs>
    <style>
      .wm-line { font-family: 'Cormorant Garamond', serif; font-weight: 600; font-size: 36px; fill: ${TAN}; letter-spacing: 0.5px; }
      .ep      { font-family: 'Inter', sans-serif; font-weight: 700; font-size: 64px; fill: ${TAN}; letter-spacing: 1px; }
      .title   { font-family: 'Inter', sans-serif; font-weight: 800; font-size: 64px; fill: ${TERRA}; letter-spacing: -1.5px; }
      .guests  { font-family: 'Inter', sans-serif; font-weight: 500; font-size: 32px; fill: ${CREAM}; }
    </style>
  </defs>
  <rect x="0" y="0" width="${W}" height="${H}" fill="${INK}" />
  <text x="60" y="80"  class="wm-line">Doomer</text>
  <text x="60" y="120" class="wm-line">Optimism</text>
  <text x="60" y="255" class="ep">DO 307</text>
  <text x="60" y="370" class="title">Microcolleges</text>
  <text x="60" y="440" class="guests">with Jacob Hundt</text>
</svg>`;

const textPane = await sharp(Buffer.from(svg)).png().toBuffer();

await sharp({ create: { width: W, height: H, channels: 4, background: INK } })
  .composite([
    { input: textPane, top: 0, left: 0 },
    { input: photoPane, top: 0, left: W - RIGHT_W },
  ])
  .jpeg({ quality: 90 })
  .toFile(join(OUT_DIR, 'thumbnail.jpg'));

console.log('Wrote', join(OUT_DIR, 'thumbnail.jpg'));
console.log('Wrote', join(OUT_DIR, 'guest.jpg'));
