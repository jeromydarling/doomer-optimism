// Compose an episode hero image from photos Ashley uploads to Drive.
//
// Workflow:
//   Ashley uploads 2+ photos per episode (host + guest, plus optional
//   extras like a wide room shot) to a per-episode subfolder in the
//   shared Drive `Doomer Optimism Episodes/` folder. The pipeline
//   pulls them down, this script stitches them into a 1600×900 hero
//   on the site's parchment palette, and commits the result to
//   public/episodes/heroes/{slug}.jpg.
//
// Two compose modes:
//   - "side-by-side" (default): two photos in 800×900 panels, parchment
//     between, terracotta hairline divider, episode number top-center.
//     Best when the photos are headshots of host + guest separately.
//   - "single": one photo cover-fitted across the whole 1600×900 frame,
//     parchment vignette on top, episode number overlaid. Best when
//     Ashley uploads a single wide two-shot from the recording.
//
// Future stage (separate PR): pre-process each source via Adobe MCP
// `image_remove_background` so the people are cleanly cut out and
// floated on parchment. For now we do a clean crop-and-fit, which
// already looks miles better than procedural hedcuts.
//
// Usage:
//   node scripts/compose-hero-from-images.mjs <slug> <image1> [image2] [--mode=single|side-by-side]
//
// Example:
//   node scripts/compose-hero-from-images.mjs 296-peter-allen-keystone-restoration \
//     /tmp/drive/ep-296/ashley.jpg /tmp/drive/ep-296/elizabeth.jpg

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join, basename } from 'node:path';
import yaml from 'js-yaml';
import sharp from 'sharp';

const EPISODES_DIR = 'src/content/episodes';
const HEROES_DIR = 'public/episodes/heroes';

const PALETTE = {
  parchment: '#f4ecdb',
  parchmentDeep: '#ead9bf',
  ink: '#2a2117',
  inkSoft: '#5a4d3b',
  terracotta: '#a6582c',
};

const W = 1600;
const H = 900;

function parseArgs() {
  const argv = process.argv.slice(2);
  const flags = {};
  const positional = [];
  for (const a of argv) {
    if (a.startsWith('--')) {
      const [k, v] = a.slice(2).split('=');
      flags[k] = v ?? true;
    } else {
      positional.push(a);
    }
  }
  return { positional, flags };
}

function escapeXml(s) {
  return String(s).replace(/[<>&'"]/g, (c) =>
    ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' }[c]),
  );
}

function readEpisodeFrontmatter(slug) {
  const path = join(EPISODES_DIR, `${slug}.mdx`);
  if (!existsSync(path)) throw new Error(`No MDX at ${path}`);
  const text = readFileSync(path, 'utf8');
  const m = text.match(/^---\n([\s\S]*?)\n---/);
  if (!m) throw new Error(`No frontmatter in ${path}`);
  return yaml.load(m[1]);
}

async function loadImage(path) {
  return await sharp(path)
    .rotate() // honor EXIF orientation
    .toBuffer({ resolveWithObject: true });
}

// Crop-fit `img` to fill (panelW × panelH) using cover semantics.
async function fitCover(img, panelW, panelH) {
  return await sharp(img)
    .resize(panelW, panelH, { fit: 'cover', position: 'attention' })
    .toBuffer();
}

// Render a small SVG overlay (top eyebrow + bottom labels) on top of the
// composited photo panels.
function overlaySvg({ episodeNumber, hostName, guestName, mode }) {
  if (mode === 'single') {
    // Single-image mode: just an unobtrusive eyebrow text top-center.
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
      <rect x="0" y="0" width="${W}" height="120" fill="${PALETTE.parchment}" opacity="0.75"/>
      <text x="${W/2}" y="80" text-anchor="middle"
            font-family="Inter,system-ui,sans-serif" font-size="22" letter-spacing="6"
            fill="${PALETTE.ink}">
        DOOMER OPTIMISM · ${String(episodeNumber).padStart(3, '0')}
      </text>
      <rect x="40" y="40" width="${W - 80}" height="${H - 80}" fill="none"
            stroke="${PALETTE.ink}" stroke-width="1.5" opacity="0.4"/>
    </svg>`;
  }
  // side-by-side: top eyebrow, center divider, bottom name labels.
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
    <rect x="40" y="40" width="${W - 80}" height="${H - 80}" fill="none"
          stroke="${PALETTE.ink}" stroke-width="1.5" opacity="0.4"/>
    <line x1="${W/2}" y1="160" x2="${W/2}" y2="${H - 160}"
          stroke="${PALETTE.terracotta}" stroke-width="1.5" opacity="0.55"/>
    <text x="${W/2}" y="100" text-anchor="middle"
          font-family="Inter,system-ui,sans-serif" font-size="20" letter-spacing="6"
          fill="${PALETTE.ink}">
      DOOMER OPTIMISM · ${String(episodeNumber).padStart(3, '0')}
    </text>
    ${hostName ? `<text x="400" y="${H - 50}" text-anchor="middle"
          font-family="Cormorant Garamond,Georgia,serif" font-size="30"
          fill="${PALETTE.ink}">${escapeXml(hostName)}</text>` : ''}
    ${guestName ? `<text x="1200" y="${H - 50}" text-anchor="middle"
          font-family="Cormorant Garamond,Georgia,serif" font-size="30"
          fill="${PALETTE.ink}">${escapeXml(guestName)}</text>` : ''}
  </svg>`;
}

const { positional, flags } = parseArgs();
const [slug, ...imagePaths] = positional;
if (!slug || imagePaths.length === 0) {
  console.error('Usage: node scripts/compose-hero-from-images.mjs <slug> <image1> [image2] [--mode=single|side-by-side]');
  process.exit(1);
}

const mode = flags.mode || (imagePaths.length === 1 ? 'single' : 'side-by-side');
const fm = readEpisodeFrontmatter(slug);
const hostName = 'Ashley Colby Fitzgerald';
const guestName = fm.guest || '';

mkdirSync(HEROES_DIR, { recursive: true });
const outPath = join(HEROES_DIR, `${slug}.jpg`);

let composite;
if (mode === 'single') {
  const buf = await fitCover(imagePaths[0], W, H);
  composite = sharp(buf);
} else {
  // side-by-side: two 800×900 panels
  const PANEL_W = 800;
  const PANEL_H = H;
  const left = await fitCover(imagePaths[0], PANEL_W, PANEL_H);
  const right = await fitCover(imagePaths[1] || imagePaths[0], PANEL_W, PANEL_H);
  composite = sharp({
    create: {
      width: W,
      height: H,
      channels: 3,
      background: PALETTE.parchment,
    },
  }).composite([
    { input: left, left: 0, top: 0 },
    { input: right, left: PANEL_W, top: 0 },
  ]);
}

// Render overlay SVG separately to PNG buffer, then composite over the photo
const overlayPng = await sharp(Buffer.from(overlaySvg({
  episodeNumber: fm.number,
  hostName,
  guestName,
  mode,
}))).png().toBuffer();

await composite
  .composite([{ input: overlayPng, left: 0, top: 0 }])
  .jpeg({ quality: 88 })
  .toFile(outPath);

console.log(`  ✓ ${outPath}  (mode: ${mode})`);
console.log(`    Next: add to MDX frontmatter:`);
console.log(`      heroImage: /episodes/heroes/${slug}.jpg`);
