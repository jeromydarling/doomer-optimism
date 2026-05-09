#!/usr/bin/env node
/**
 * scripts/rerender-cached.mjs
 *
 * One-off cleanup: take each cached .transcripts/*.scribe.json + its enriched
 * sibling, find the MDX file that was generated from it, and re-render it
 * using the improved cleanup helpers (filler stripping, paragraph merging,
 * smarter speaker detection, untruncated summaries).
 *
 * No RSS fetch (the Anchor feed is unreachable from local sandboxes), no API
 * calls — operates purely on the cached files and the existing MDX bodies.
 *
 * Match strategy: shingle-overlap each scribe's first ~80 word-tokens against
 * each MDX body. Highest score wins. Collision-free in practice across the
 * back catalogue.
 */
import { readFile, writeFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';

const ROOT = process.cwd();
const CACHE_DIR = join(ROOT, '.transcripts');
const ENRICH_DIR = join(CACHE_DIR, 'enriched');
const EPISODES_DIR = join(ROOT, 'src', 'content', 'episodes');

// ---- helpers (copied from transcribe-backfill.mjs to keep this script
// self-contained and runnable without the script's top-level RSS fetch) ----

function normalizeSpeakerLabel(id) {
  const m = String(id).match(/(\d+)$/);
  if (!m) return id;
  return String.fromCharCode(65 + Number(m[1]));
}

function cleanUtteranceText(s) {
  if (!s) return '';
  let t = String(s);
  t = t.replace(/\s*[\(\[][^()\[\]]{1,40}[\)\]]/g, '');
  t = t.replace(/^\s*(?:um|uh|erm)[,\.\s]+/i, '');
  t = t.replace(/[,\s]+(?:um|uh|erm)\s*$/i, '');
  t = t.replace(/\b(\w+)([,\s]+\1\b){1,4}/gi, '$1');
  t = t.replace(/\s+([,\.\?!:;])/g, '$1');
  t = t.replace(/\s{2,}/g, ' ');
  t = t.replace(/^\s*(?:Mm+|Mhm+|Hm+)[\.,]\s*/i, '');
  return t.trim();
}

function wordsToUtterances(words) {
  const utt = [];
  let cur = null;
  for (const w of words) {
    if (w.type && w.type !== 'word') continue;
    const speaker = normalizeSpeakerLabel(w.speaker_id ?? 'A');
    const text = w.text ?? '';
    if (!cur || cur.speaker !== speaker) {
      if (cur) utt.push(cur);
      cur = { speaker, text, start: (w.start ?? 0) * 1000, end: (w.end ?? 0) * 1000 };
    } else {
      const sep = (cur.text === '' || /^[.,!?:;'’”)\]}]/.test(text)) ? '' : ' ';
      cur.text += sep + text;
      cur.end = (w.end ?? cur.end) * 1000;
    }
  }
  if (cur) utt.push(cur);
  return utt
    .map((u) => ({ ...u, text: cleanUtteranceText(u.text) }))
    .filter((u) => u.text.length > 1);
}

function mergeAdjacentSameSpeaker(utterances) {
  const out = [];
  for (const u of utterances) {
    const prev = out[out.length - 1];
    if (prev && prev.speaker === u.speaker) {
      prev.text = (prev.text + ' ' + u.text).replace(/\s{2,}/g, ' ').trim();
      prev.end = u.end;
    } else {
      out.push({ ...u });
    }
  }
  return out;
}

function mapSpeakers(utterances, guestName) {
  const totals = new Map();
  for (const u of utterances) totals.set(u.speaker, (totals.get(u.speaker) ?? 0) + (u.end - u.start));
  const totalAll = [...totals.values()].reduce((a, b) => a + b, 0);

  // Try the show-intro pattern in the first 30 utterances. Only trust the
  // match if that speaker is also a substantial talker (>=10% of total) —
  // otherwise it's a brief intro clip from someone other than Ashley.
  const INTRO_RE = /\b(?:welcome (?:back )?to|this is|you'?re listening to)\s+(?:do(?:omer)?\s*optimism|do(?:omer)?\s*op|do more optimism)|i (?:am|have)\s+\w+\s+(?:here|with me|on)|hi(?:,| ).*welcome/i;
  let hostLabel = null;
  for (const u of utterances.slice(0, 30)) {
    if (INTRO_RE.test(u.text)) {
      const share = (totals.get(u.speaker) ?? 0) / Math.max(1, totalAll);
      if (share >= 0.1) { hostLabel = u.speaker; break; }
    }
  }
  if (!hostLabel) hostLabel = [...totals.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;

  const others = [...totals.entries()]
    .filter(([label]) => label !== hostLabel)
    .sort((a, b) => b[1] - a[1])
    .map(([label]) => label);
  const map = {};
  if (hostLabel) map[hostLabel] = 'Ashley Colby Fitzgerald';
  others.forEach((label, i) => {
    if (i === 0 && guestName) map[label] = guestName;
    else map[label] = `Speaker ${label}`;
  });
  return map;
}

function formatTimestamp(ms) {
  const totalSec = Math.floor(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  return h > 0
    ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
    : `${m}:${String(s).padStart(2, '0')}`;
}

function splitFrontmatter(raw) {
  const m = raw.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!m) return { frontmatter: '', body: raw };
  return { frontmatter: m[1], body: m[2] };
}

// Pull a guest name from the title or, if the title is a topic phrase, from
// the Haiku enrichment summary (which almost always names the guest in its
// first sentence). We ignore the existing `guest:` frontmatter — the
// previous run polluted it with topic phrases. Returns null when nothing
// confident matches; the speaker stays "Speaker B" in that case.
function extractGuestName(fm, summary) {
  const titleRaw = fm.match(/^title:\s*"?([^"\n]+?)"?\s*$/m)?.[1] ?? '';
  const t = titleRaw.replace(/^["']|["']$/g, '').trim();
  const fromTitle = guestFromTitle(t);
  if (fromTitle) return fromTitle;
  const fromSummary = guestFromSummary(summary);
  if (fromSummary) return fromSummary;
  return null;
}

function guestFromSummary(s) {
  if (!s) return null;
  const first = String(s).split(/(?<=[.!?])\s+/)[0] ?? '';
  let cleaned = first;
  const STRIPS = [
    /^(?:In this (?:[a-z\-]+\s+)?(?:episode|conversation|livestream|chat|milestone\s+\d+\w*\s+episode)\s*,?\s+)/i,
    /^(?:This (?:episode|is|milestone[^,]*|livestream|conversation|wide-ranging[^,]*)[^,]*,\s+)/i,
    /^(?:This is the [^,]+,\s+)/i,
    /^(?:Doomer Optimism[^,\.]*[,\.]\s+)/i,
    /^(?:Ashley\s+(?:Colby\s+Fitzgerald\s+)?(?:and|interviews|sits down with|talks with|hosts)\s+)/i,
    /^(?:Ashley\s+(?:grapples|explores|reflects|discusses)\b[^,\.]*[,\.]\s*)/i,
  ];
  for (let i = 0; i < 4; i++) for (const r of STRIPS) cleaned = cleaned.replace(r, '');
  cleaned = cleaned.trim();

  const m = cleaned.match(/^([A-Z][a-zA-Z'’]+(?:\s+[A-Z][a-zA-Z'’]+){0,2})(?:\s+and\s+([A-Z][a-zA-Z'’]+(?:\s+[A-Z][a-zA-Z'’]+){0,2}))?[\s,]+/);
  if (!m) return null;
  return isPlausibleName(m[1]) ? m[1] : (m[2] && isPlausibleName(m[2]) ? m[2] : null);
}

// Reject false positives like "This", "Doomer", "Ashley".
const NAME_BLOCKLIST = new Set([
  'this', 'that', 'these', 'those', 'doomer', 'optimism',
  'ashley', 'episode', 'in', 'on', 'the',
]);
function isPlausibleName(s) {
  if (!s) return false;
  const first = s.trim().split(/\s+/)[0]?.toLowerCase().replace(/[^a-z]/g, '') ?? '';
  return !NAME_BLOCKLIST.has(first);
}

function guestFromTitle(t) {
  if (!t) return null;
  // Pattern A: "with <Two-Three Capital Words>".
  const withMatch = t.match(/\bwith\s+(?:Dr\.?\s+)?([A-Z][a-zA-Z'’]+(?:\s+[A-Z][a-zA-Z'’]+){1,2})\b/);
  if (withMatch) return withMatch[1];
  // Pattern B: "—|: <Name Name> on …".
  const colonOn = t.match(/[:—-]\s*(?:Dr\.?\s+)?([A-Z][a-zA-Z'’]+\s+[A-Z][a-zA-Z'’]+(?:\s+[A-Z][a-zA-Z'’]+)?)\s+on\b/);
  if (colonOn) return colonOn[1];
  // Pattern C: leading "<Name Name> on|—|: …".
  const leadingName = t.match(/^(?:Dr\.?\s+)?([A-Z][a-zA-Z'’]+\s+[A-Z][a-zA-Z'’]+(?:\s+[A-Z][a-zA-Z'’]+)?)\s+(?:on\b|[—\-:])/);
  if (leadingName) return leadingName[1];
  return null;
}

function scribeSignature(words) {
  return (words ?? [])
    .filter((w) => !w.type || w.type === 'word')
    .slice(0, 80)
    .map((w) => (w.text ?? '').toLowerCase())
    .join(' ')
    .replace(/[^\w\s']/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function bodySignature(body) {
  return body.toLowerCase().replace(/[^\w\s']/g, ' ').replace(/\s+/g, ' ').trim();
}

function shingleOverlap(needle, hay) {
  const tokens = needle.split(' ');
  let hits = 0;
  for (let i = 0; i + 4 <= tokens.length; i++) {
    const shingle = tokens.slice(i, i + 4).join(' ');
    if (hay.includes(shingle)) hits++;
  }
  return hits;
}

// ---- main ---------------------------------------------------------------

const scribeFiles = (await readdir(CACHE_DIR))
  .filter((f) => f.endsWith('.scribe.json'))
  .map((f) => join(CACHE_DIR, f));

const mdxFiles = (await readdir(EPISODES_DIR))
  .filter((f) => f.endsWith('.mdx'))
  .map((f) => join(EPISODES_DIR, f));

console.log(`Found ${scribeFiles.length} cached scribe files, ${mdxFiles.length} MDX files.`);

const mdxLoaded = await Promise.all(mdxFiles.map(async (p) => {
  const raw = await readFile(p, 'utf8');
  const { frontmatter, body } = splitFrontmatter(raw);
  return { path: p, raw, frontmatter, body, sig: bodySignature(body) };
}));

let updated = 0;
let skipped = 0;

for (const scribePath of scribeFiles) {
  const scribe = JSON.parse(await readFile(scribePath, 'utf8'));
  const sig = scribeSignature(scribe.words);
  if (!sig) { console.log(`  ⊘ ${scribePath} — empty scribe`); skipped++; continue; }

  let best = null;
  for (const mdx of mdxLoaded) {
    const score = shingleOverlap(sig, mdx.sig);
    if (!best || score > best.score) best = { mdx, score };
  }
  if (!best || best.score < 5) {
    console.log(`  ⊘ ${scribePath} — no matching MDX (best score ${best?.score ?? 0})`);
    skipped++;
    continue;
  }

  const enrichPath = join(ENRICH_DIR, scribePath.split('/').pop().replace('.scribe.json', '.json'));
  let enriched = {};
  try { enriched = JSON.parse(await readFile(enrichPath, 'utf8')); } catch {}

  const guestName = extractGuestName(best.mdx.frontmatter, enriched.summary);
  const utterances = wordsToUtterances(scribe.words ?? []);
  const speakers = mapSpeakers(utterances, guestName);
  const merged = mergeAdjacentSameSpeaker(utterances);

  // Rewrite the frontmatter `guest:` field if it's clearly wrong (host's
  // own name, a Speaker sentinel, or empty) and we have a better candidate.
  let frontmatter = best.mdx.frontmatter;
  if (guestName) {
    const cur = frontmatter.match(/^guest:\s*"?([^"\n]+?)"?\s*$/m)?.[1]?.trim() ?? '';
    const stripped = cur.replace(/^["']|["']$/g, '');
    const looksWrong =
      !stripped ||
      /ashley\s+colby/i.test(stripped) ||
      /^speaker\s+[a-z]$/i.test(stripped) ||
      /unknown/i.test(stripped);
    if (looksWrong && stripped !== guestName) {
      const replacement = `guest: ${JSON.stringify(guestName)}`;
      if (/^guest:.*$/m.test(frontmatter)) {
        frontmatter = frontmatter.replace(/^guest:.*$/m, replacement);
      } else {
        frontmatter = frontmatter + `\n${replacement}`;
      }
    }
  }

  const transcriptBody = merged
    .map((u) => {
      const ts = formatTimestamp(u.start);
      const name = speakers[u.speaker] ?? `Speaker ${u.speaker}`;
      return `**${name}** (${ts})\n\n${u.text.trim()}`;
    })
    .join('\n\n');

  const chaptersBlock = enriched.chapters?.length
    ? '\n## Chapters\n\n' + enriched.chapters.map((c) => `- **${c.start}** — ${c.headline}`).join('\n') + '\n'
    : '';

  const pullQuotesBlock = enriched.pullQuotes?.length
    ? '\n## Pull quotes\n\n' + enriched.pullQuotes.map((q) => `> ${q}`).join('\n\n') + '\n'
    : '';

  // Replace anything from "## Chapters", "## Pull quotes", or "## Transcript"
  // onward; preserve the curated body above (Summary, custom notes, etc.).
  const cutAt = Math.min(
    ...['## Chapters', '## Pull quotes', '## Transcript']
      .map((m) => best.mdx.body.indexOf(m))
      .filter((i) => i >= 0),
  );
  const preserved = Number.isFinite(cutAt) && cutAt > 0
    ? best.mdx.body.slice(0, cutAt).trimEnd() + '\n'
    : best.mdx.body.trimEnd() + '\n';

  const newBody = `${preserved}${chaptersBlock}${pullQuotesBlock}\n## Transcript\n\n${transcriptBody}\n`;
  const out = `---\n${frontmatter}\n---\n${newBody}`;
  await writeFile(best.mdx.path, out);
  const hostLabel = Object.entries(speakers).find(([,n]) => n === 'Ashley Colby Fitzgerald')?.[0] ?? '?';
  const guestLabel = Object.entries(speakers).find(([,n]) => n !== 'Ashley Colby Fitzgerald' && !/^Speaker /.test(n))?.[1] ?? '—';
  console.log(`  ✓ ${best.mdx.path.split('/').pop()}  (host=${hostLabel}, guest=${guestLabel})`);
  updated++;
}

console.log(`\nDone. Updated ${updated}, skipped ${skipped}.`);
