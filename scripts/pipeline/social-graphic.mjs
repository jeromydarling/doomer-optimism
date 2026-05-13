// Generate a 1080x1080 quote card for social posts.
//
// V1 uses an SVG → PNG pipeline (no Adobe Express dependency) so we can
// ship without external services. The output uses the site's typography
// tokens (Cormorant Garamond display, EB Garamond body) baked into the
// SVG. /admin can render an inline preview directly.
//
// When Adobe MCP is wired, swap to `image_*` for fancier templates.

import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

function escapeXml(s) {
  return String(s).replace(/[<>&'"]/g, (c) =>
    ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' }[c]),
  );
}

// Wrap text into lines of approximately N chars without breaking words.
function wrap(text, maxChars) {
  const words = String(text).split(/\s+/);
  const lines = [];
  let current = '';
  for (const w of words) {
    if ((current + ' ' + w).trim().length > maxChars) {
      lines.push(current.trim());
      current = w;
    } else {
      current = (current + ' ' + w).trim();
    }
  }
  if (current) lines.push(current);
  return lines;
}

export function quoteCardSvg({ quote, speaker, episodeTitle, episodeNumber }) {
  const lines = wrap(quote, 36);
  const lineHeight = 64;
  const startY = 540 - (lines.length * lineHeight) / 2 + lineHeight / 2;
  const tspans = lines
    .map((l, i) => `<tspan x="540" y="${startY + i * lineHeight}">${escapeXml(l)}</tspan>`)
    .join('');

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="1080" viewBox="0 0 1080 1080">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#f5ecdc"/>
      <stop offset="1" stop-color="#ead9bf"/>
    </linearGradient>
  </defs>
  <rect width="1080" height="1080" fill="url(#bg)"/>
  <rect x="60" y="60" width="960" height="960" fill="none" stroke="#3a2a1a" stroke-width="1.5" opacity="0.4"/>
  <text x="540" y="120" font-family="Inter,system-ui" font-size="20" letter-spacing="6" text-anchor="middle" fill="#3a2a1a" opacity="0.7">
    DOOMER OPTIMISM · ${escapeXml(String(episodeNumber || '').padStart(3, '0'))}
  </text>
  <text font-family="Cormorant Garamond,Georgia,serif" font-size="56" text-anchor="middle" fill="#3a2a1a" font-style="italic">
    ${tspans}
  </text>
  <text x="540" y="940" font-family="Inter,system-ui" font-size="22" text-anchor="middle" fill="#a4452f" font-weight="600">
    — ${escapeXml(speaker || 'Doomer Optimism')}
  </text>
  <text x="540" y="1000" font-family="EB Garamond,Georgia,serif" font-size="24" text-anchor="middle" fill="#3a2a1a" opacity="0.65">
    ${escapeXml(episodeTitle || '')}
  </text>
</svg>`;
}

export function writeQuoteCard(outPath, args) {
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, quoteCardSvg(args));
  return outPath;
}
