// Apply fixes from docs/episode-audit-rss.md.
//
// Two groups, both safe:
//
// GROUP 1 — guest-haiku-error (3 high-confidence frontmatter guest corrections)
//   Episodes where the MDX title matches the RSS exactly, but the
//   frontmatter `guest` field is wrong/missing.
//   - Ep 230 → set guest: "Austin Frerich" (currently missing)
//   - Ep 243 → set guest: "Travis Logan" (currently missing)
//   - Ep 256 → fix guest: "Political Agency" → "Marie Gluesenkamp Perez"
//
// GROUP 2 — no-rss-match (11 scaffolded placeholders) → mark draft + log
//   The Anchor RSS at episode numbers 247, 253, 260, 265, 269, 273, 278,
//   282, 287, 291, 296 has REAL titles that are completely different
//   from our MDX placeholders. e.g. our "296 — Restoring the Oak Savanna
//   (Peter Allen)" → Anchor says "DO 296: Building Community in
//   Fragmented Times". The transcripts in our MDXes are real podcast
//   content but the rest of the metadata is v0-scaffold placeholder
//   stuff that never got reconciled with Anchor.
//
//   Conservative fix: mark all 11 as `draft: true` so they stop showing
//   publicly, and write a separate Markdown doc with what each one
//   *should* be (per RSS) so Ashley can review and decide whether to
//   rewrite, delete, or re-ingest each one.

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const EPISODES_DIR = 'src/content/episodes';
const rssSnapshot = JSON.parse(readFileSync('docs/rss-snapshot.json', 'utf8'));

// Build a map: episode number → RSS item.
function extractNumber(title) {
  const m = title.match(/^(?:DO|Episode)\s*#?\s*(\d+)\s*[-:–]/i) ||
            title.match(/^DO(\d+)\s*[-:–]/i);
  return m ? Number(m[1]) : null;
}
function stripPrefix(title) {
  return title.replace(/^(?:DO|Episode)\s*#?\s*\d+\s*[-:–]\s*/i, '').trim();
}
const rssByNumber = new Map();
for (const item of rssSnapshot) {
  const n = extractNumber(item.title);
  if (n != null) rssByNumber.set(n, item);
}
console.log(`Indexed ${rssByNumber.size} numbered RSS items.`);

// ── Frontmatter split / edit / recombine ───────────────────────
function splitFrontmatter(text) {
  // Match the very first ---\n .... \n---\n block.
  const m = text.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!m) return null;
  return { fm: m[1], body: m[2] };
}
function joinFrontmatter(fm, body) {
  return `---\n${fm}\n---\n${body}`;
}
// Replace `key: ...` if it exists, otherwise append `key: value`.
function setKey(fm, key, value) {
  const re = new RegExp(`^${key}:.*$`, 'm');
  if (re.test(fm)) {
    return fm.replace(re, `${key}: ${value}`);
  }
  return `${fm}\n${key}: ${value}`;
}

// ── GROUP 1: guest-field corrections ───────────────────────────
const guestFixes = [
  { file: '230-agriculture-for-the-people.mdx', guest: 'Austin Frerich' },
  { file: 'unnumbered-9561bb5f4416-d0-243-the-spiritual-quality-of-global-capitalism.mdx', guest: 'Travis Logan' },
  { file: '256-political-agency-with-marie-gluesenkamp-perez-and-james.mdx', guest: 'Marie Gluesenkamp Perez' },
];

let fixed1 = 0;
for (const fix of guestFixes) {
  const path = join(EPISODES_DIR, fix.file);
  const text = readFileSync(path, 'utf8');
  const parts = splitFrontmatter(text);
  if (!parts) { console.log(`  ⚠ ${fix.file}: no frontmatter found`); continue; }
  const fm2 = setKey(parts.fm, 'guest', `"${fix.guest}"`);
  writeFileSync(path, joinFrontmatter(fm2, parts.body));
  console.log(`  ✓ guest fix: ${fix.file} → ${fix.guest}`);
  fixed1++;
}

// ── GROUP 2: placeholder cleanup ──────────────────────────────
const placeholders = [247, 253, 260, 265, 269, 273, 278, 282, 287, 291, 296].map((n) => ({
  number: n,
  // We'll look the file up by number prefix:
}));

let fixed2 = 0;
const reviewRows = [];
for (const ep of placeholders) {
  // Find the MDX file by number prefix
  const fs = await import('node:fs');
  const files = fs.readdirSync(EPISODES_DIR).filter((f) => f.startsWith(`${ep.number}-`));
  if (!files.length) { console.log(`  ⚠ no MDX file found for ep ${ep.number}`); continue; }
  const path = join(EPISODES_DIR, files[0]);
  const text = readFileSync(path, 'utf8');
  const parts = splitFrontmatter(text);
  if (!parts) { console.log(`  ⚠ ${files[0]}: no frontmatter`); continue; }

  let fm = parts.fm;
  fm = setKey(fm, 'draft', 'true');
  if (/^featured:\s*true\s*$/m.test(fm)) {
    fm = fm.replace(/^featured:\s*true\s*$/m, 'featured: false');
  }
  writeFileSync(path, joinFrontmatter(fm, parts.body));

  const rss = rssByNumber.get(ep.number);
  const mdxTitleMatch = parts.fm.match(/^title:\s*"?(.*?)"?\s*$/m);
  const mdxGuestMatch = parts.fm.match(/^guest:\s*"?(.*?)"?\s*$/m);
  reviewRows.push({
    number: ep.number,
    file: files[0],
    mdxTitle: mdxTitleMatch ? mdxTitleMatch[1] : '(none)',
    mdxGuest: mdxGuestMatch ? mdxGuestMatch[1] : '(none)',
    rssTitle: rss ? stripPrefix(rss.title) : '(no RSS match)',
    rssAudioUrl: rss?.audioUrl || '',
    rssPubDate: rss?.pubDate || '',
  });
  console.log(`  ✓ placeholder ep ${ep.number} → draft=true`);
  fixed2++;
}

// ── Write the review doc ──────────────────────────────────────
mkdirSync('docs', { recursive: true });
const reviewLines = [];
reviewLines.push('# Placeholder episodes — needs manual reconciliation');
reviewLines.push('');
reviewLines.push(`Run: ${new Date().toISOString()}`);
reviewLines.push('');
reviewLines.push('These 11 MDX files were scaffolded as part of the v0 site before the Anchor RSS backfill pipeline existed. They have placeholder titles + guests that don\'t match the real Anchor episode at the same number. Their transcripts are real podcast content but they\'ve been **marked `draft: true`** in this pass so they stop appearing on the public site.');
reviewLines.push('');
reviewLines.push('For each row, Ashley decides one of:');
reviewLines.push('- **Rewrite**: update title + guest + summary to match RSS, then keep the file. Best when the transcript is from the matching RSS audio.');
reviewLines.push('- **Delete**: drop the file. Best when the transcript is unrelated content. The auto-watcher will pick up the real episode from RSS later.');
reviewLines.push('- **Keep as-is**: leave drafted indefinitely if the content is worth preserving for some other reason.');
reviewLines.push('');
reviewLines.push('| Ep | Current MDX title | Current MDX guest | Real Anchor title | audioUrl |');
reviewLines.push('|----|-------------------|-------------------|-------------------|----------|');
for (const r of reviewRows.sort((a, b) => a.number - b.number)) {
  reviewLines.push(
    `| ${r.number} | ${r.mdxTitle} | ${r.mdxGuest} | ${r.rssTitle} | \`${r.rssAudioUrl ? r.rssAudioUrl.slice(0, 60) + '…' : '—'}\` |`,
  );
}
writeFileSync('docs/placeholder-episodes-review.md', reviewLines.join('\n'));

console.log(`\n━━━ Applied ${fixed1 + fixed2} fixes ━━━`);
console.log(`  Guest-field corrections:        ${fixed1}`);
console.log(`  Placeholders marked draft:      ${fixed2}`);
console.log(`Review doc: docs/placeholder-episodes-review.md`);
