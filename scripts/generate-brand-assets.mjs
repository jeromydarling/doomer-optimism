// Generate the Doomer Optimism brand assets:
//   public/brand/wordmark-light.png  (full wordmark on parchment, 2400×600)
//   public/brand/wordmark-dark.png   (full wordmark on dark umber, 2400×600)
//   public/brand/wordmark-transparent.png (transparent bg)
//   public/brand/do-monogram-light.png (square "DO" on parchment, 2048×2048)
//   public/brand/do-monogram-dark.png  (square "DO" on dark umber)
//   public/brand/do-monogram-transparent.png
//
// Renders SVG with the same Cormorant Garamond pairing used in the site
// header (.wordmark: ink "Doomer" + italic terracotta "Optimism"), then
// rasterizes via sharp with the font installed at ~/.fonts.

import { writeFileSync, mkdirSync } from 'node:fs';
import sharp from 'sharp';

const OUT = 'public/brand';
mkdirSync(OUT, { recursive: true });

const PALETTE = {
  parchment: '#f4ecdb',
  parchmentDeep: '#ead9bf',
  ink: '#2a2117',
  terracotta: '#a6582c',
};

function wordmarkSvg({ width, height, background }) {
  // Font sizing: target ~46% of height for cap height of the title,
  // leaving safe margins for the italic Optimism "m" descender.
  const fs = Math.round(height * 0.46);
  const cy = Math.round(height * 0.64);
  const cx = width / 2;
  const bgRect = background
    ? `<rect width="${width}" height="${height}" fill="${background}"/>`
    : '';
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  ${bgRect}
  <text x="${cx}" y="${cy}" text-anchor="middle"
        font-family="Cormorant Garamond"
        font-size="${fs}"
        fill="${PALETTE.ink}"
        font-weight="500"
        letter-spacing="-2">Doomer<tspan
          font-style="italic" font-weight="400"
          fill="${PALETTE.terracotta}"
          dx="${Math.round(fs * 0.12)}"
        >Optimism</tspan></text>
</svg>`;
}

function monogramSvg({ size, background }) {
  // Square D + O. D in ink, O in terracotta italic. Both centered.
  const fs = Math.round(size * 0.68);
  const cy = Math.round(size * 0.72);
  const bgRect = background
    ? `<rect width="${size}" height="${size}" fill="${background}"/>`
    : '';
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  ${bgRect}
  <text x="${size / 2}" y="${cy}" text-anchor="middle"
        font-family="Cormorant Garamond" font-size="${fs}"
        fill="${PALETTE.ink}" font-weight="500" letter-spacing="-${Math.round(fs * 0.04)}">D<tspan
          font-style="italic" font-weight="400"
          fill="${PALETTE.terracotta}"
        >O</tspan></text>
</svg>`;
}

async function renderToPng(svg, outPath) {
  await sharp(Buffer.from(svg), { density: 300 })
    .png()
    .toFile(outPath);
  console.log(`  ✓ ${outPath}`);
}

const W = 2400, H = 600;
await renderToPng(wordmarkSvg({ width: W, height: H, background: PALETTE.parchment }), `${OUT}/wordmark-light.png`);
await renderToPng(wordmarkSvg({ width: W, height: H, background: PALETTE.ink }), `${OUT}/wordmark-dark.png`);
await renderToPng(wordmarkSvg({ width: W, height: H, background: null }), `${OUT}/wordmark-transparent.png`);

const S = 2048;
await renderToPng(monogramSvg({ size: S, background: PALETTE.parchment }), `${OUT}/do-monogram-light.png`);
await renderToPng(monogramSvg({ size: S, background: PALETTE.ink }), `${OUT}/do-monogram-dark.png`);
await renderToPng(monogramSvg({ size: S, background: null }), `${OUT}/do-monogram-transparent.png`);

// Also dump the SVG sources so anyone can edit them in Illustrator / Figma
writeFileSync(`${OUT}/wordmark.svg`, wordmarkSvg({ width: W, height: H, background: null }));
writeFileSync(`${OUT}/do-monogram.svg`, monogramSvg({ size: S, background: null }));
console.log(`  ✓ ${OUT}/wordmark.svg`);
console.log(`  ✓ ${OUT}/do-monogram.svg`);
