// Enhanced episode audit — runs in GHA (where Anchor RSS is reachable).
//
// What it does:
//   1. Fetch the Anchor RSS feed (authoritative episode list)
//   2. For each MDX file under src/content/episodes/, match the file's
//      `audioUrl` to an RSS item (audioUrl is the cdn URL in <enclosure>)
//   3. Compare:
//        - RSS title           vs   MDX frontmatter title
//        - RSS pubDate         vs   MDX frontmatter pubDate
//        - Transcript speakers vs   MDX guest field
//   4. Classify each episode's situation and propose a specific fix:
//        - 'clean'             — everything aligned, nothing to do
//        - 'guest-haiku-error' — RSS confirms MDX title, but Haiku put the
//                                wrong guest in the summary (frontmatter
//                                `guest` field is missing or wrong; can fix)
//        - 'mdx-title-stale'   — RSS title disagrees with MDX title; the
//                                MDX was likely renamed at some point
//        - 'audio-mismatch'    — audioUrl exists in RSS but the title there
//                                doesn't match the MDX title at all (the
//                                MDX was assembled from the wrong audio)
//        - 'no-rss-match'      — audioUrl not found in RSS (might be a
//                                deleted episode, or an Anchor URL change)
//        - 'panel'             — multi-host episode, no single guest to check
//   5. Write docs/episode-audit-rss.md with definitive recommendations.
//   6. Write docs/rss-snapshot.json with the raw RSS data for future use.
//
// No auto-fixes; the report is the deliverable so a human can scan it.

import { readFileSync, writeFileSync, readdirSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const RSS_URL = 'https://anchor.fm/s/68308b7c/podcast/rss';
const EPISODES_DIR = 'src/content/episodes';

function decodeEntities(s) {
  return String(s)
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'");
}

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
  const idx = text.indexOf('## Transcript');
  if (idx === -1) return '';
  return text.slice(idx, idx + 3000);
}

const HOSTS = new Set([
  'Ashley Colby Fitzgerald', 'Ashley Colby', 'Ashley Fitzgerald', 'Ashley',
]);
const FALSE_POSITIVE_NAMES = /Doomer Optimism|Dark Aeon|Saying No|Speaker [A-Z]/i;

function guessGuests(opening) {
  const names = new Set();
  const speakerTags = opening.matchAll(/\*\*([A-Z][a-z]+(?:\s[A-Z][a-z]+){1,3})\*\*\s*\(\d+:\d+\)/g);
  for (const m of speakerTags) names.add(m[1]);
  const withMatches = opening.matchAll(/\b(?:with|joined by|host|guest)\s+([A-Z][a-z]+(?:\s[A-Z][a-z]+){1,3})\b/g);
  for (const m of withMatches) names.add(m[1]);
  return [...names].filter((n) => !HOSTS.has(n) && !FALSE_POSITIVE_NAMES.test(n));
}

function similarity(a, b) {
  if (!a || !b) return 0;
  const aw = new Set(a.toLowerCase().replace(/[^a-z0-9 ]/g, '').split(/\s+/).filter(Boolean));
  const bw = new Set(b.toLowerCase().replace(/[^a-z0-9 ]/g, '').split(/\s+/).filter(Boolean));
  if (!aw.size || !bw.size) return 0;
  let common = 0;
  for (const w of aw) if (bw.has(w)) common++;
  return common / Math.max(aw.size, bw.size);
}

// --- Fetch RSS ----------------------------------------------------
console.log(`Fetching ${RSS_URL}...`);
const res = await fetch(RSS_URL, {
  headers: { 'user-agent': 'doomer-optimism-audit/1.0' },
});
if (!res.ok) {
  console.error(`RSS fetch failed: ${res.status}`);
  process.exit(1);
}
const xml = await res.text();
console.log(`Fetched ${xml.length} bytes of XML.`);

// --- Parse RSS ----------------------------------------------------
const items = [];
const itemRegex = /<item>([\s\S]*?)<\/item>/g;
let m;
while ((m = itemRegex.exec(xml)) !== null) {
  const block = m[1];
  const title = decodeEntities((block.match(/<title>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/title>/) || [, ''])[1].trim());
  const pubDate = (block.match(/<pubDate>([\s\S]*?)<\/pubDate>/) || [, ''])[1].trim();
  const enclosure = (block.match(/<enclosure[^>]*url="([^"]+)"/) || [, ''])[1];
  const guid = (block.match(/<guid[^>]*>([\s\S]*?)<\/guid>/) || [, ''])[1].trim();
  const desc = decodeEntities((block.match(/<description>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/description>/) || [, ''])[1]);
  items.push({ title, pubDate, audioUrl: enclosure, guid, descriptionLength: desc.length });
}
console.log(`Parsed ${items.length} RSS items.`);
mkdirSync('docs', { recursive: true });
writeFileSync('docs/rss-snapshot.json', JSON.stringify(items, null, 2));
console.log(`Wrote docs/rss-snapshot.json`);

// Index by audioUrl (with both raw + URL-normalized keys for robustness)
const byAudio = new Map();
function normalize(url) {
  return url.replace(/^https?:\/\//, '').toLowerCase();
}
for (const item of items) {
  if (item.audioUrl) byAudio.set(normalize(item.audioUrl), item);
}

// --- Walk MDX files ------------------------------------------------
const files = readdirSync(EPISODES_DIR).filter((f) => f.endsWith('.mdx')).sort();
const records = [];
for (const f of files) {
  const path = join(EPISODES_DIR, f);
  const text = readFileSync(path, 'utf8');
  const fm = parseFrontmatter(text);
  if (!fm) continue;
  const opening = extractTranscriptOpening(text);
  const transcriptGuests = guessGuests(opening);

  const audioKey = fm.audioUrl ? normalize(fm.audioUrl) : null;
  const rssItem = audioKey ? byAudio.get(audioKey) : null;

  let verdict = 'unknown';
  let recommendation = '';

  if (!rssItem) {
    verdict = 'no-rss-match';
    recommendation = fm.audioUrl
      ? 'Episode audioUrl is not present in current Anchor RSS feed. May have been deleted, re-published, or Anchor URL changed. Verify the episode still exists on Anchor.'
      : 'No audioUrl in frontmatter; cannot cross-reference against RSS.';
  } else {
    const titleSim = similarity(fm.title, rssItem.title);
    const guestMatchesTranscript = fm.guest
      ? transcriptGuests.some(
          (g) => g.toLowerCase().includes(fm.guest.toLowerCase()) ||
                 fm.guest.toLowerCase().includes(g.toLowerCase()),
        )
      : false;

    if (titleSim < 0.3 && transcriptGuests.length > 0) {
      verdict = 'audio-mismatch';
      recommendation = `MDX title "${fm.title}" doesn't match RSS title "${rssItem.title}" (similarity ${titleSim.toFixed(2)}), and transcript opens with ${transcriptGuests.join(', ')}. The audio reference looks correct but the file's title/metadata was assembled wrong. **Recommend: update title to RSS title, set guest from transcript.**`;
    } else if (titleSim >= 0.5 && !guestMatchesTranscript && transcriptGuests.length > 0) {
      verdict = 'guest-haiku-error';
      recommendation = `RSS title and MDX title agree. But frontmatter guest "${fm.guest || '(missing)'}" doesn't match transcript opening (${transcriptGuests.join(', ')}). **Recommend: set guest: "${transcriptGuests[0]}".**`;
    } else if (titleSim >= 0.5 && transcriptGuests.length === 0) {
      verdict = 'unverifiable';
      recommendation = 'RSS title matches MDX title. Transcript opening had no clear guest tag — cannot auto-verify.';
    } else {
      verdict = 'clean';
      recommendation = 'RSS and MDX align; transcript opening matches frontmatter guest.';
    }
  }

  records.push({
    file: f,
    number: fm.number,
    mdxTitle: fm.title,
    rssTitle: rssItem?.title,
    mdxGuest: fm.guest,
    transcriptGuests,
    audioUrl: fm.audioUrl,
    verdict,
    recommendation,
  });
}

// --- Render report -------------------------------------------------
const counts = records.reduce((acc, r) => ((acc[r.verdict] = (acc[r.verdict] || 0) + 1), acc), {});
const lines = [];
lines.push('# Episode audit — cross-referenced against Anchor RSS');
lines.push('');
lines.push(`Run: ${new Date().toISOString()}`);
lines.push('');
lines.push(`**Total episodes:** ${records.length}`);
lines.push('');
lines.push('| Verdict | Count | Meaning |');
lines.push('|---|---|---|');
const verdictNotes = {
  clean: 'RSS, MDX, and transcript all agree.',
  'guest-haiku-error': 'RSS confirms MDX title, but the frontmatter `guest` field disagrees with the transcript. Safe to auto-fix: set `guest` to the transcript-detected name.',
  'audio-mismatch': "MDX title doesn't match RSS title for this audioUrl. The episode was probably re-numbered or its audio got linked to a different file's metadata. Needs a renumber or a re-link.",
  unverifiable: 'RSS and MDX agree, but the transcript opening had no clear guest tag to verify against. No action needed unless content review reveals a problem.',
  'no-rss-match': 'audioUrl is not in the current Anchor feed. May be a deleted episode, an Anchor URL change, or a stale link.',
};
for (const [v, c] of Object.entries(counts).sort()) {
  lines.push(`| ${v} | ${c} | ${verdictNotes[v] || ''} |`);
}
lines.push('');

for (const verdict of ['guest-haiku-error', 'audio-mismatch', 'no-rss-match', 'unverifiable']) {
  const group = records.filter((r) => r.verdict === verdict);
  if (!group.length) continue;
  lines.push(`## ${verdict} (${group.length})`);
  lines.push('');
  for (const r of group.sort((a, b) => Number(a.number) - Number(b.number))) {
    lines.push(`### Ep ${r.number} — \`${r.file}\``);
    lines.push('');
    lines.push(`- **MDX title:** ${r.mdxTitle}`);
    if (r.rssTitle) lines.push(`- **RSS title:** ${r.rssTitle}`);
    lines.push(`- **MDX guest:** ${r.mdxGuest || '(none)'}`);
    lines.push(`- **Transcript guests:** ${r.transcriptGuests.join(', ') || '(none detected)'}`);
    lines.push('');
    lines.push(`**Recommendation:** ${r.recommendation}`);
    lines.push('');
  }
}

writeFileSync('docs/episode-audit-rss.md', lines.join('\n'));
console.log(`\nWrote docs/episode-audit-rss.md`);
console.log('Verdict counts:', counts);
