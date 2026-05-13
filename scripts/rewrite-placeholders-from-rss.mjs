// Rewrite the 11 v0-scaffold placeholder MDXes to match Anchor RSS:
//   - title    → real RSS title (with "DO ###" prefix stripped)
//   - audioUrl → real RSS enclosure URL
//   - pubDate  → real RSS pubDate (converted to YYYY-MM-DD)
//   - guest    → first non-host speaker tag from existing transcript,
//                if it looks like a real person's name
//   - summary  → "[Pending re-enrichment]" placeholder
//   - bibliography → emptied (was generated from the wrong topic)
//
// Stays draft: true until re-enrichment + human review.
//
// Body: keeps only the ## Transcript section. Wrong-topic chapters,
// pull quotes, and summary blocks are dropped — the re-enrichment
// workflow regenerates them from the (real) transcript content.

import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import yaml from 'js-yaml';

const EPISODES_DIR = 'src/content/episodes';
const rssSnapshot = JSON.parse(readFileSync('docs/rss-snapshot.json', 'utf8'));

function extractNumber(title) {
  const m = title.match(/^(?:DO|Episode)\s*#?\s*(\d+)\s*[-:–]/i) ||
            title.match(/^DO(\d+)\s*[-:–]/i);
  return m ? Number(m[1]) : null;
}
function stripPrefix(title) {
  return title.replace(/^(?:DO|Episode)\s*#?\s*\d+\s*[-:–]\s*/i, '').trim();
}
function rfcToISODate(s) {
  const m = String(s).match(/(\d{1,2}) (\w+) (\d{4})/);
  if (!m) return null;
  const months = { Jan: '01', Feb: '02', Mar: '03', Apr: '04', May: '05', Jun: '06', Jul: '07', Aug: '08', Sep: '09', Oct: '10', Nov: '11', Dec: '12' };
  return `${m[3]}-${months[m[2]] || '01'}-${m[1].padStart(2, '0')}`;
}

const rssByNumber = new Map();
for (const item of rssSnapshot) {
  const n = extractNumber(item.title);
  if (n != null) rssByNumber.set(n, item);
}

function splitFrontmatter(text) {
  const m = text.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!m) return null;
  return { fm: m[1], body: m[2] };
}

const HOSTS = new Set(['Ashley Colby Fitzgerald', 'Ashley Colby', 'Ashley Fitzgerald', 'Ashley']);
const NOT_PERSON_NAMES = /Doomer Optimism|Dark Aeon|Speaker [A-Z]|Saying No/i;

function firstGuestFromTranscript(body) {
  const idx = body.indexOf('## Transcript');
  if (idx === -1) return null;
  const opening = body.slice(idx, idx + 3000);
  const tags = [...opening.matchAll(/\*\*([A-Z][a-z]+(?:\s[A-Z][a-z]+){1,3})\*\*\s*\(\d+:\d+\)/g)]
    .map((m) => m[1])
    .filter((n) => !HOSTS.has(n) && !NOT_PERSON_NAMES.test(n));
  return tags[0] || null;
}

function extractTranscriptSection(body) {
  const idx = body.indexOf('## Transcript');
  return idx === -1 ? '' : body.slice(idx);
}

const placeholderNumbers = [247, 253, 260, 265, 269, 273, 278, 282, 287, 291, 296];
let count = 0;
for (const number of placeholderNumbers) {
  const files = readdirSync(EPISODES_DIR).filter((f) => f.startsWith(`${number}-`));
  if (!files.length) continue;
  const path = join(EPISODES_DIR, files[0]);
  const text = readFileSync(path, 'utf8');
  const parts = splitFrontmatter(text);
  if (!parts) continue;
  const rss = rssByNumber.get(number);
  if (!rss) { console.log(`  ⚠ ep ${number}: no RSS match, skipping`); continue; }

  // Parse YAML, mutate, dump
  const fmObj = yaml.load(parts.fm);
  fmObj.title = stripPrefix(rss.title);
  fmObj.audioUrl = rss.audioUrl;
  fmObj.pubDate = rfcToISODate(rss.pubDate) || fmObj.pubDate;
  const detectedGuest = firstGuestFromTranscript(parts.body);
  if (detectedGuest) fmObj.guest = detectedGuest;
  fmObj.summary = '[Pending re-enrichment from corrected metadata; transcript present below.]';
  fmObj.bibliography = [];
  fmObj.draft = true;
  // Drop featured if it was true (handled in earlier pass too, but be safe)
  if (fmObj.featured) fmObj.featured = false;

  const newFm = yaml.dump(fmObj, { lineWidth: 1000, noRefs: true }).trimEnd();

  // Body: keep only the transcript section. The summary, chapters, pull
  // quotes, and bibliography ARE in the body too; they were Haiku output
  // for the wrong topic and need to come back via re-enrichment.
  const transcriptSection = extractTranscriptSection(parts.body);
  const newBody = `\n${transcriptSection || '## Transcript\n\n_(no transcript present)_'}\n`;

  writeFileSync(path, `---\n${newFm}\n---\n${newBody}`);
  console.log(`  ✓ ep ${number}: "${fmObj.title.slice(0, 60)}…" (guest: ${fmObj.guest || '(none)'})`);
  count++;
}
console.log(`\nRewrote ${count} placeholders to match Anchor RSS.`);
console.log(`Re-enrichment workflow will regenerate summary/chapters/bibliography next.`);
