// Auto-composite a 1600×900 editorial hero image for an episode using
// procedural hedcuts of host (Ashley) and guest (per episode frontmatter).
// Output: public/episodes/heroes/{slug}.jpg
//
// Generates a parchment-toned two-shot with the show wordmark — a stand-in
// while real photography or commissioned hedcuts come online. Visually
// distinct from a YouTube screenshot, matches the site palette.

import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { join, basename } from 'node:path';
import yaml from 'js-yaml';
import sharp from 'sharp';

const EPISODES_DIR = 'src/content/episodes';
const HEROES_DIR = 'public/episodes/heroes';

// Palette tokens from src/styles/global.css
const PALETTE = {
  parchment: '#f4ecdb',
  parchmentDeep: '#ead9bf',
  ink: '#2a2117',
  inkSoft: '#5a4d3b',
  terracotta: '#a6582c',
  moss: '#4e6b46',
};

// Hedcut SVG (extracted from src/components/HedcutPlaceholder.astro).
// Returns an inner <g> that can be positioned inside a parent SVG.
function hedcutGroup(name, { tx = 0, ty = 0, scale = 1, stroke = PALETTE.ink } = {}) {
  const seed = Array.from(name).reduce((a, c) => a + c.charCodeAt(0), 0);
  const rand = (n, salt = 0) => {
    const x = Math.sin(seed * 9301 + n * 49297 + salt * 233280) * 10000;
    return x - Math.floor(x);
  };
  const headCx = 60, headCy = 56, headRx = 30, headRy = 36;

  const hatchLines = [];
  for (let i = 0; i < 22; i++) {
    const y = headCy - headRy + (i / 21) * (headRy * 2);
    const t = (y - headCy) / headRy;
    const half = headRx * Math.sqrt(Math.max(0, 1 - t * t));
    if (half < 1) continue;
    const jitter = rand(i, 1) * 1.3;
    hatchLines.push({
      x1: headCx - half + jitter,
      y1: y,
      x2: headCx + half - jitter,
      y2: y + (rand(i, 2) - 0.5) * 0.8,
      w: 0.45 + rand(i, 3) * 0.5,
    });
  }
  const browY = headCy - headRy * 0.45;
  const initials = name.split(' ').filter(Boolean).map((n) => n[0]).slice(0, 2).join('').toUpperCase();

  const clipId = `clip-${seed}-${Math.floor(Math.random() * 1e6)}`;
  const hatching = hatchLines.map(
    (l) => `<line x1="${l.x1}" y1="${l.y1}" x2="${l.x2}" y2="${l.y2}" stroke-width="${l.w}"/>`,
  ).join('');

  return `
  <g transform="translate(${tx} ${ty}) scale(${scale})" stroke="${stroke}" fill="none">
    <defs>
      <clipPath id="${clipId}">
        <ellipse cx="${headCx}" cy="${headCy}" rx="${headRx}" ry="${headRy}"/>
      </clipPath>
    </defs>
    <!-- collar -->
    <path d="M 18 140 Q 30 110 ${headCx - 14} ${headCy + headRy - 4} Q ${headCx} ${headCy + headRy + 6} ${headCx + 14} ${headCy + headRy - 4} Q 90 110 102 140 Z" stroke-width="0.9"/>
    <!-- head -->
    <ellipse cx="${headCx}" cy="${headCy}" rx="${headRx}" ry="${headRy}" stroke-width="1"/>
    <!-- hatching inside head -->
    <g clip-path="url(#${clipId})" stroke-linecap="round" opacity="0.78">
      ${hatching}
    </g>
    <!-- brow -->
    <path d="M ${headCx - 14} ${browY + (rand(99, 4) - 0.5) * 1.5} Q ${headCx} ${browY - 6} ${headCx + 14} ${browY + (rand(99, 5) - 0.5) * 1.5}" stroke-width="1.2"/>
    <!-- initials watermark -->
    <text x="60" y="132" text-anchor="middle" font-family="Cormorant Garamond, Georgia, serif" font-size="8" letter-spacing="2" fill="${stroke}" stroke="none" opacity="0.55">${initials}</text>
  </g>`;
}

function escapeXml(s) {
  return String(s).replace(/[<>&'"]/g, (c) =>
    ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' }[c]),
  );
}

function buildHeroSvg({ episodeNumber, hostName, guestName }) {
  // 1600 × 900 canvas. Hedcut native size is 120×140. Scale to ~600 tall.
  // Each hedcut sits in a 750-wide column with breathing room.
  // Scale: 600/140 = ~4.3 → use 4.5 for a bit more presence.
  const SCALE = 4.5;
  const HEDCUT_WIDTH = 120 * SCALE;   // 540
  const HEDCUT_HEIGHT = 140 * SCALE;  // 630
  const Y_TOP = (900 - HEDCUT_HEIGHT) / 2;  // ~135

  // Left hedcut centered at x=400 (in a 0-800 column).
  // Right hedcut centered at x=1200 (in a 800-1600 column).
  const leftX = 400 - HEDCUT_WIDTH / 2;
  const rightX = 1200 - HEDCUT_WIDTH / 2;

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="900" viewBox="0 0 1600 900">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="${PALETTE.parchment}"/>
      <stop offset="1" stop-color="${PALETTE.parchmentDeep}"/>
    </linearGradient>
    <radialGradient id="leftHalo" cx="25%" cy="50%" r="35%">
      <stop offset="0" stop-color="${PALETTE.parchment}" stop-opacity="0.6"/>
      <stop offset="1" stop-color="${PALETTE.parchment}" stop-opacity="0"/>
    </radialGradient>
    <radialGradient id="rightHalo" cx="75%" cy="50%" r="35%">
      <stop offset="0" stop-color="${PALETTE.parchment}" stop-opacity="0.6"/>
      <stop offset="1" stop-color="${PALETTE.parchment}" stop-opacity="0"/>
    </radialGradient>
  </defs>

  <!-- Background -->
  <rect width="1600" height="900" fill="url(#bg)"/>
  <rect width="1600" height="900" fill="url(#leftHalo)"/>
  <rect width="1600" height="900" fill="url(#rightHalo)"/>

  <!-- Frame border -->
  <rect x="40" y="40" width="1520" height="820" fill="none" stroke="${PALETTE.ink}" stroke-width="1.5" opacity="0.35"/>

  <!-- Center thin divider in terracotta -->
  <line x1="800" y1="160" x2="800" y2="740" stroke="${PALETTE.terracotta}" stroke-width="1.5" opacity="0.45"/>

  <!-- Top ornament: small caps episode number -->
  <text x="800" y="100" text-anchor="middle" font-family="Inter,system-ui,sans-serif" font-size="18" letter-spacing="6" fill="${PALETTE.inkSoft}">
    DOOMER OPTIMISM · ${String(episodeNumber).padStart(3, '0')}
  </text>

  <!-- Host hedcut (left) -->
  ${hedcutGroup(hostName, { tx: leftX, ty: Y_TOP, scale: SCALE })}

  <!-- Guest hedcut (right) -->
  ${hedcutGroup(guestName, { tx: rightX, ty: Y_TOP, scale: SCALE })}

  <!-- Bottom labels under each hedcut -->
  <text x="400" y="${Y_TOP + HEDCUT_HEIGHT + 50}" text-anchor="middle" font-family="Cormorant Garamond,Georgia,serif" font-size="28" fill="${PALETTE.ink}">
    ${escapeXml(hostName)}
  </text>
  <text x="400" y="${Y_TOP + HEDCUT_HEIGHT + 75}" text-anchor="middle" font-family="Inter,system-ui,sans-serif" font-size="13" letter-spacing="3" fill="${PALETTE.inkSoft}">
    HOST
  </text>

  <text x="1200" y="${Y_TOP + HEDCUT_HEIGHT + 50}" text-anchor="middle" font-family="Cormorant Garamond,Georgia,serif" font-size="28" fill="${PALETTE.ink}">
    ${escapeXml(guestName)}
  </text>
  <text x="1200" y="${Y_TOP + HEDCUT_HEIGHT + 75}" text-anchor="middle" font-family="Inter,system-ui,sans-serif" font-size="13" letter-spacing="3" fill="${PALETTE.inkSoft}">
    GUEST
  </text>
</svg>`;
}

function splitFrontmatter(text) {
  const m = text.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  return m ? { fm: m[1], body: m[2] } : null;
}

const targetSlugs = process.argv.slice(2);
if (!targetSlugs.length) {
  console.error('Usage: node scripts/generate-hero-image.mjs <episode-slug> [<episode-slug>...]');
  console.error('Example: node scripts/generate-hero-image.mjs 296-peter-allen-keystone-restoration');
  process.exit(1);
}

const files = readdirSync(EPISODES_DIR).filter((f) => f.endsWith('.mdx'));
for (const target of targetSlugs) {
  const match = files.find((f) => f === `${target}.mdx` || f.startsWith(`${target.split('-')[0]}-`));
  if (!match) { console.error(`No episode file matches "${target}"`); continue; }
  const path = join(EPISODES_DIR, match);
  const text = readFileSync(path, 'utf8');
  const parts = splitFrontmatter(text);
  if (!parts) { console.error(`No frontmatter in ${match}`); continue; }
  const fm = yaml.load(parts.fm);

  const guestName = fm.guest || 'Guest';
  const hostName = 'Ashley Colby Fitzgerald';
  const svg = buildHeroSvg({
    episodeNumber: fm.number,
    hostName,
    guestName,
  });

  const slug = basename(match, '.mdx');
  const outPath = join(HEROES_DIR, `${slug}.jpg`);

  await sharp(Buffer.from(svg))
    .jpeg({ quality: 88 })
    .toFile(outPath);

  console.log(`  ✓ ${slug}.jpg  (host: ${hostName}, guest: ${guestName})`);
}
