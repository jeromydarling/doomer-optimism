// Episode/title/pillar accuracy audit (read-only — flags issues, doesn't auto-fix).
//
// Triggered by Ashley's review: she flagged that ep 296 is actually Elizabeth
// Oldfield (not Peter Allen), ep 253 isn't the "Beyond the War on Invasive
// Species" episode (that one's much earlier), and ep 278's pillar may be off.
//
// What this script does, per episode MDX file under src/content/episodes/:
//   1. Parse the frontmatter (title, guest, number)
//   2. Look at the first ~10 lines of the body's `## Transcript` block — they
//      typically start with "Welcome back to Doomer Optimism, today I'm here
//      with X..." or similar self-identification.
//   3. Compare the transcript's self-identification to the frontmatter guest.
//   4. Flag any mismatch with a confidence note.
//
// Output: docs/episode-audit.md (markdown report with one row per flagged ep).
// Deliberately NOT writing back into the MDX files — Ashley needs to confirm
// every fix herself before we touch episode numbers / pillars.

import { readFileSync, writeFileSync, readdirSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const EPISODES_DIR = 'src/content/episodes';
const OUT = 'docs/episode-audit.md';

function parseFrontmatter(text) {
  const m = text.match(/^---\n([\s\S]*?)\n---/);
  if (!m) return null;
  const fm = {};
  for (const line of m[1].split('\n')) {
    const kv = line.match(/^([a-zA-Z_]+):\s*"?(.*?)"?\s*$/);
    if (kv) fm[kv[1]] = kv[2];
  }
  return fm;
}

function extractTranscriptOpening(text) {
  // Take 2000 chars after the `## Transcript` header (if any) for analysis.
  const idx = text.indexOf('## Transcript');
  if (idx === -1) return '';
  return text.slice(idx, idx + 2000);
}

// Known host: she's at the top of every transcript and is irrelevant noise
// for the guest-name match.
const HOST_NAMES = ['Ashley Colby Fitzgerald', 'Ashley Colby', 'Ashley Fitzgerald', 'Ashley'];

// Pull the most likely guest names from the transcript opening:
// patterns like "with X", "joined by X", "host X", "guest X", or speaker tags
// at the top of the transcript ("**Foo Bar** (0:06)").
function guessGuests(opening) {
  const names = new Set();
  const speakerTags = opening.matchAll(/\*\*([A-Z][a-z]+(?:\s[A-Z][a-z]+){1,3})\*\*\s*\(\d+:\d+\)/g);
  for (const m of speakerTags) names.add(m[1]);
  const withMatches = opening.matchAll(/\b(?:with|joined by|host|guest)\s+([A-Z][a-z]+(?:\s[A-Z][a-z]+){1,3})\b/g);
  for (const m of withMatches) names.add(m[1]);
  // Strip host noise + obvious false positives (book titles captured as names)
  const cleaned = [...names].filter(
    (n) => !HOST_NAMES.includes(n) && !/Doomer Optimism|Dark Aeon|Saying No/i.test(n),
  );
  return cleaned;
}

function compareToFrontmatter(guestField, guestsInTranscript) {
  if (!guestField) return { match: 'unknown', reason: 'no guest field in frontmatter' };
  const guest = guestField.toLowerCase();
  if (guest.includes('panel') || guest.includes('round')) return { match: 'panel', reason: 'panel/round-table' };
  for (const g of guestsInTranscript) {
    if (g.toLowerCase() === guest) return { match: 'ok', reason: `transcript names "${g}"` };
    if (guest.includes(g.toLowerCase()) || g.toLowerCase().includes(guest)) {
      return { match: 'partial', reason: `frontmatter "${guestField}" partial overlap with transcript "${g}"` };
    }
  }
  if (!guestsInTranscript.length) return { match: 'unknown', reason: 'no clear guest names in transcript opening' };
  return {
    match: 'mismatch',
    reason: `frontmatter says "${guestField}", transcript opens with: ${guestsInTranscript.join(', ')}`,
  };
}

const files = readdirSync(EPISODES_DIR).filter((f) => f.endsWith('.mdx')).sort();
const flagged = [];
const stats = { total: 0, ok: 0, mismatch: 0, partial: 0, unknown: 0, panel: 0 };

for (const f of files) {
  const text = readFileSync(join(EPISODES_DIR, f), 'utf8');
  const fm = parseFrontmatter(text);
  if (!fm) continue;
  stats.total++;
  const opening = extractTranscriptOpening(text);
  const guesses = guessGuests(opening);
  const result = compareToFrontmatter(fm.guest, guesses);
  stats[result.match]++;
  if (result.match === 'mismatch' || result.match === 'partial') {
    flagged.push({
      file: f,
      number: fm.number,
      titleInFrontmatter: fm.title,
      guestInFrontmatter: fm.guest,
      pillar: fm.pillar,
      transcriptGuests: guesses,
      verdict: result.match,
      reason: result.reason,
    });
  }
}

flagged.sort((a, b) => Number(a.number) - Number(b.number));

// Render the report
const lines = [];
lines.push('# Episode accuracy audit');
lines.push('');
lines.push(`Run: ${new Date().toISOString()}`);
lines.push('');
lines.push(`**Total episodes:** ${stats.total} · **Clean:** ${stats.ok} · **Mismatch flagged:** ${stats.mismatch} · **Partial:** ${stats.partial} · **Unknown (no clear guest in transcript):** ${stats.unknown} · **Panel:** ${stats.panel}`);
lines.push('');
lines.push('## How to read this');
lines.push('');
lines.push('Each row is an episode where the `guest` frontmatter field doesn\'t cleanly match the names Scribe captured at the top of the transcript. **No automatic fixes are applied** — the script is read-only, because correcting episode numbers or guest names requires Ashley\'s judgement (she may have the right number with a wrong title, or vice versa). Use this as a worklist.');
lines.push('');
lines.push('## Flagged (verdict: mismatch or partial)');
lines.push('');
if (flagged.length === 0) {
  lines.push('_None — every episode\'s frontmatter aligns with its transcript opening._');
} else {
  lines.push('| Ep # | File | Frontmatter guest | Transcript guests | Verdict |');
  lines.push('|------|------|-------------------|-------------------|---------|');
  for (const f of flagged) {
    lines.push(
      `| ${f.number} | \`${f.file}\` | ${f.guestInFrontmatter || '—'} | ${f.transcriptGuests.join(', ') || '—'} | ${f.verdict} |`,
    );
  }
}
lines.push('');
lines.push('## Ashley\'s specific callouts');
lines.push('');
lines.push('- **Ep 296** "Restoring the Oak Savannah with Peter Allen" → Ashley says this is actually an Elizabeth Oldfield episode.');
lines.push('- **Ep 253** "Beyond the War on Invasive Species" → Ashley says this is NOT ep 253; the Tao Orion episode is much earlier in the archive.');
lines.push('- **Ep 278** "A Small Farm Future" by Chris Smaje → may be in the wrong pillar slot (Ashley uncertain).');
lines.push('');
lines.push('Cross-check those against the rows above. Where they match, fix; where the audit disagrees with Ashley\'s memory, default to Ashley.');

mkdirSync('docs', { recursive: true });
writeFileSync(OUT, lines.join('\n'));
console.log(`Audit complete. ${flagged.length} episodes flagged.`);
console.log(`  ok: ${stats.ok} | mismatch: ${stats.mismatch} | partial: ${stats.partial} | unknown: ${stats.unknown} | panel: ${stats.panel} | total: ${stats.total}`);
console.log(`Report: ${OUT}`);
