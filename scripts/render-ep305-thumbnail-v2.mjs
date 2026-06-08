#!/usr/bin/env node
/**
 * Variant B: photo full-bleed background, dark gradient on the left holds
 * the text. Better for this particular composition because both guys are
 * visible in the source photo at different sizes (Patrick standing,
 * Seth sitting) and chopping the photo to a tight portrait crops Seth out.
 */

import sharp from 'sharp';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const SRC = '/root/.claude/uploads/3678a490-aea1-58e9-a311-723eff63b0d0/51dec415-1000012851.png';
const OUT_DIR = '/home/user/doomer-optimism/public/episodes/305';
const W = 1280, H = 720;

// 1. Tight crop of the actual photo content from the screenshot.
const photoSrc = await sharp(SRC)
  .extract({ left: 100, top: 250, width: 1000, height: 1255 })
  .toBuffer();

// 2. Fit photo to full thumbnail size with cover (1280×720, position south
//    to keep both guys; the arch tapers nicely into the top).
const bgPhoto = await sharp(photoSrc)
  .resize({ width: W, height: H, fit: 'cover', position: 'south' })
  // Slight darkening to make the text overlay legible
  .modulate({ brightness: 0.85 })
  .toBuffer();

// 3. Left-side dark gradient overlay (semi-transparent).
const gradient = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">
  <defs>
    <linearGradient id="g" x1="0%" y1="0%" x2="100%" y2="0%">
      <stop offset="0%"  stop-color="#1a140e" stop-opacity="0.92"/>
      <stop offset="40%" stop-color="#1a140e" stop-opacity="0.86"/>
      <stop offset="65%" stop-color="#1a140e" stop-opacity="0.0"/>
    </linearGradient>
  </defs>
  <rect width="${W}" height="${H}" fill="url(#g)" />
</svg>`;

// 4. Text overlay (same hierarchy as 304).
const TAN = '#c9a37b';
const TERRA = '#e8732e';
const CREAM = '#efe3c8';

const text = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">
  <defs>
    <style>
      .wm-line { font-family: 'Cormorant Garamond', serif; font-weight: 600; font-size: 38px; fill: ${TAN}; letter-spacing: 0.5px; }
      .ep      { font-family: 'Inter', sans-serif; font-weight: 700; font-size: 62px; fill: ${TAN}; letter-spacing: 1px; }
      .title   { font-family: 'Inter', sans-serif; font-weight: 800; font-size: 82px; fill: ${TERRA}; letter-spacing: -1.5px; }
      .guests  { font-family: 'Inter', sans-serif; font-weight: 500; font-size: 30px; fill: ${CREAM}; }
    </style>
  </defs>
  <text x="60" y="80"  class="wm-line">Doomer</text>
  <text x="60" y="125" class="wm-line">Optimism</text>
  <text x="60" y="245" class="ep">DO 305</text>
  <text x="60" y="355" class="title">Orthodox</text>
  <text x="60" y="445" class="title">Masonry</text>
  <text x="60" y="525" class="guests">with Patrick Lemmon</text>
  <text x="60" y="565" class="guests">&amp; Seth Harris</text>
</svg>`;

await mkdir(OUT_DIR, { recursive: true });
await sharp(bgPhoto)
  .composite([
    { input: Buffer.from(gradient), top: 0, left: 0 },
    { input: Buffer.from(text), top: 0, left: 0 },
  ])
  .jpeg({ quality: 90 })
  .toFile(join(OUT_DIR, 'thumbnail-v2.jpg'));

console.log('Wrote', join(OUT_DIR, 'thumbnail-v2.jpg'));
