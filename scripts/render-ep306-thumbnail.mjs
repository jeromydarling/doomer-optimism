#!/usr/bin/env node
/**
 * scripts/render-ep306-thumbnail.mjs
 *
 * YouTube thumbnail for ep 306 (Jackson Solway / Building New Athens).
 * Source is a proper 2000×2000 square headshot — no need for the cropping
 * gymnastics ep 305 required. Layout mirrors 304 + 305: dark ground, small
 * "Doomer Optimism" wordmark, big DO 306, terracotta title, cream guest line.
 */

import sharp from 'sharp';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';

const SRC = '/root/.claude/uploads/3678a490-aea1-58e9-a311-723eff63b0d0/3105c0d2-1000013350.jpg';
const OUT_DIR = '/home/user/doomer-optimism/public/episodes/306';
const W = 1280, H = 720;

// Keep an archive copy of the source photo, resized to a sensible max width.
await mkdir(OUT_DIR, { recursive: true });
await sharp(SRC).resize({ width: 1600, withoutEnlargement: true }).jpeg({ quality: 90 }).toFile(join(OUT_DIR, 'guest.jpg'));

// Right pane: 720×720 square headshot at full thumbnail height.
const RIGHT_W = 720;
const photoPane = await sharp(SRC).resize({ width: RIGHT_W, height: H, fit: 'cover' }).toBuffer();

// SVG text block — same visual language as ep 305.
const INK = '#1a140e';
const TAN = '#c9a37b';
const TERRA = '#c4632c';
const CREAM = '#e8d8b8';

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">
  <defs>
    <style>
      .wm-line { font-family: 'Cormorant Garamond', serif; font-weight: 600; font-size: 36px; fill: ${TAN}; letter-spacing: 0.5px; }
      .ep      { font-family: 'Inter', sans-serif; font-weight: 700; font-size: 64px; fill: ${TAN}; letter-spacing: 1px; }
      .title   { font-family: 'Inter', sans-serif; font-weight: 800; font-size: 70px; fill: ${TERRA}; letter-spacing: -1px; }
      .guests  { font-family: 'Inter', sans-serif; font-weight: 500; font-size: 32px; fill: ${CREAM}; }
    </style>
  </defs>
  <rect x="0" y="0" width="${W}" height="${H}" fill="${INK}" />
  <text x="60" y="80"  class="wm-line">Doomer</text>
  <text x="60" y="120" class="wm-line">Optimism</text>
  <text x="60" y="245" class="ep">DO 306</text>
  <text x="60" y="345" class="title">Building</text>
  <text x="60" y="425" class="title">New Athens</text>
  <text x="60" y="505" class="guests">with Jackson Solway</text>
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
