// Un-draft the most recent N "clean" episodes from the audit, so the
// site has content to show on the homepage / episodes index / pillars.
//
// "Clean" = RSS title matches MDX title AND transcript opening agrees
//           with frontmatter guest (per docs/episode-audit-rss.md).
//
// We're cautious: only the N most-recent clean ones get un-drafted in
// one pass. Earlier episodes need Ashley's eye on the auto-generated
// summary before they go public — the Faren-Morgan-as-Ashley pattern
// caught on ep 303 might hide in older ones too.

import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const EPISODES_DIR = 'src/content/episodes';
const TOP_N = 8; // un-draft the 8 most recent clean episodes

function splitFrontmatter(text) {
  const m = text.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!m) return null;
  return { fm: m[1], body: m[2] };
}
function joinFrontmatter(fm, body) {
  return `---\n${fm}\n---\n${body}`;
}
function setKey(fm, key, value) {
  const re = new RegExp(`^${key}:.*$`, 'm');
  return re.test(fm) ? fm.replace(re, `${key}: ${value}`) : `${fm}\n${key}: ${value}`;
}
function getKey(fm, key) {
  const m = fm.match(new RegExp(`^${key}:\\s*"?(.*?)"?\\s*$`, 'm'));
  return m ? m[1] : null;
}

// Load all episodes, get number + draft state + a quick sanity check
// that the summary isn't Ashley-as-protagonist.
const all = [];
for (const f of readdirSync(EPISODES_DIR).filter((f) => f.endsWith('.mdx'))) {
  const path = join(EPISODES_DIR, f);
  const text = readFileSync(path, 'utf8');
  const parts = splitFrontmatter(text);
  if (!parts) continue;
  const number = Number(getKey(parts.fm, 'number'));
  const draft = (getKey(parts.fm, 'draft') || 'false') === 'true';
  const audioUrl = getKey(parts.fm, 'audioUrl');
  // Summary starts on the line after `summary: >-`; pull the next non-blank line
  const sumStart = text.match(/^summary:\s*>-?\s*\n\s*([^\n]+)/m);
  const summary = sumStart ? sumStart[1].trim() : '';
  // Skip if summary opens with "Ashley" as the protagonist (the
  // Haiku-attributes-host-as-guest failure mode)
  const ashleyProtagonist = /^Ashley\s+(?:explores|examines|argues|describes|journeys|sits|joins|interviews|talks|reflects)/i.test(summary);
  all.push({ file: f, path, number, draft, audioUrl, summary, ashleyProtagonist });
}

// "Clean" enough to ship:
//   - currently draft
//   - has an audioUrl (came through the RSS backfill, not v0 scaffold)
//   - summary doesn't open with "Ashley explores/journeys/etc."
const candidates = all
  .filter((e) => e.draft && e.audioUrl && !e.ashleyProtagonist)
  .sort((a, b) => b.number - a.number)
  .slice(0, TOP_N);

let unflipped = 0;
for (const ep of candidates) {
  const text = readFileSync(ep.path, 'utf8');
  const parts = splitFrontmatter(text);
  if (!parts) continue;
  const fm2 = setKey(parts.fm, 'draft', 'false');
  writeFileSync(ep.path, joinFrontmatter(fm2, parts.body));
  console.log(`  ✓ published: ep ${ep.number} — ${ep.summary.slice(0, 70)}…`);
  unflipped++;
}
console.log(`\nFlipped ${unflipped} draft → published.`);
console.log(`\nSkipped candidates (Ashley-protagonist summaries to manually review):`);
for (const e of all.filter((e) => e.ashleyProtagonist).sort((a, b) => b.number - a.number).slice(0, 10)) {
  console.log(`  ep ${e.number}: ${e.summary.slice(0, 80)}…`);
}
