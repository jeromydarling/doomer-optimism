#!/usr/bin/env node
/**
 * scripts/clean-frontmatter.mjs
 *
 * One-off cleanup for episode MDX frontmatter, focused on the `guest:`
 * field. The pipeline has been writing one of three failure modes:
 *
 *   1. The host's own name ("Ashley Colby Fitzgerald") — most common
 *      when speaker mapping fell back to longest-talker without a real
 *      guest hint.
 *   2. "Speaker B" / "Speaker C" sentinels — when the speaker map
 *      knew there were N speakers but couldn't put a name on B.
 *   3. A topic phrase ("Goethean Science", "Food", "Three") that an
 *      earlier guest-extraction regex grabbed from the summary.
 *
 * For each bot-touched MDX (anything with ## Transcript), this script:
 *
 *   - Pulls the title, the Haiku-written summary, and the first ~40
 *     lines of transcript body.
 *   - Tries title patterns first ("with X", "with X and Y", leading
 *     proper-name + em-dash). Title is the strongest signal because it
 *     reflects what the show itself called the episode.
 *   - Falls back to transcript-intro patterns ("I'm here with X",
 *     "I have X here today", "I'm joined by X").
 *   - Falls back to summary patterns ("X is a Y…").
 *   - Drops the host's name and a NAME_BLOCKLIST of common false
 *     positives.
 *   - When no confident name is found, REMOVES the guest line
 *     entirely (schema makes it optional). An empty field is honest;
 *     a wrong field misleads readers.
 *
 * Idempotent. Safe to run repeatedly. Reports a diff per file.
 */
import { readFile, writeFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';

const ROOT = process.cwd();
const EPISODES_DIR = join(ROOT, 'src', 'content', 'episodes');
const DRY = process.argv.includes('--dry-run');

const HOST_NAMES = [/ashley\s+colby/i, /^\s*ashley\s*$/i];
const NAME_BLOCKLIST = new Set([
  // pronouns / openers that creep in when a regex picks the first
  // capital word it sees in a summary
  'this', 'that', 'these', 'those', 'doomer', 'optimism',
  'the', 'a', 'an', 'in', 'on', 'with', 'and', 'or',
  'episode', 'today', 'birth', 'food', 'three', 'two', 'four',
  'should', 'goethean', 'southern', 'western', 'eastern',
  'climate', 'texas', 'antitrust', 'open', 'wool', 'farm', 'farms',
  'small', 'large', 'rural', 'urban', 'building', 'science',
  'extinction', 'existential', 'sacred', 'agrarian',
  'speaker', 'host', 'guest',
]);

function isHostName(s) {
  return HOST_NAMES.some((re) => re.test(s ?? ''));
}
function isPlausibleName(s) {
  if (!s) return false;
  const t = String(s).trim();
  if (!t) return false;
  if (isHostName(t)) return false;
  if (/^speaker\s+[a-z]$/i.test(t)) return false;
  const words = t.split(/\s+/);
  if (words.length === 0) return false;
  if (words.length > 4) return false; // probably a topic phrase, not a name
  // first word must not be a blocklisted word
  const first = words[0].toLowerCase().replace(/[^a-z]/g, '');
  if (NAME_BLOCKLIST.has(first)) return false;
  // every word must look name-shaped (Capitalized + apostrophe/dash/period)
  if (!words.every((w) => /^[A-Z][a-zA-Z'’\-\.]*$/.test(w))) return false;
  return true;
}

function dropHostsAndJunk(name) {
  if (!name) return null;
  // Strip "and Ashley" / ", Ashley" / "Ashley and " etc.
  let t = String(name)
    .replace(/^\s*Ashley(\s+Colby(\s+Fitzgerald)?)?\s+and\s+/i, '')
    .replace(/[\s,]+and\s+(?:Ashley|GG|the\s+team)\s*$/i, '')
    .replace(/[\s,]+Ashley(\s+Colby(\s+Fitzgerald)?)?\s*$/i, '')
    .trim();
  // If the result starts with a comma or "and", strip it.
  t = t.replace(/^[,;\s]+|[,;\s]+$/g, '');
  return t || null;
}

// ---- title-based extraction --------------------------------------------

function fromTitle(title) {
  if (!title) return null;
  // Strip show-prefix like "DO 296 - "
  let t = title.replace(/^(?:DO|Episode|Ep\.?)\s*\d+\s*[—\-:|]\s*/i, '').trim();
  t = t.replace(/^["']|["']$/g, '');

  // Match the LAST occurrence of "with"/"w/" — earlier ones might be
  // idioms ("matter with Texas") rather than guest indicators. The
  // leading `.*` is greedy, so it consumes as much as possible before
  // backtracking to find the latest "with".
  const m = t.match(/.*\b(?:with|w\/)\s+(.+)$/i);
  if (m) return pickFirstName(m[1]);
  return null;
}

// Given a fragment like "Tucker Max, Ashley Colby Fitzgerald" or
// "Donald and Mike", return the first plausible non-host proper name.
function pickFirstName(fragment) {
  if (!fragment) return null;
  const cleaned = dropHostsAndJunk(fragment);
  if (!cleaned) return null;
  // Split on connectives.
  const parts = cleaned.split(/\s*,\s*|\s+and\s+|\s+&\s+/i).map((s) => s.trim()).filter(Boolean);
  for (const p of parts) {
    // Take first 1–4 capitalized tokens.
    const m = p.match(/^(?:Dr\.?\s+)?([A-Z][a-zA-Z'’\-\.]+(?:\s+[A-Z][a-zA-Z'’\-\.]+){0,3})/);
    if (!m) continue;
    if (isPlausibleName(m[1])) return m[1];
    // 1-word names are accepted in the "with" context — but only if
    // they aren't the host or a blocklisted topic word.
    const words = m[1].split(/\s+/);
    if (
      words.length === 1 &&
      !NAME_BLOCKLIST.has(words[0].toLowerCase()) &&
      !isHostName(words[0])
    ) {
      return m[1];
    }
  }
  return null;
}

// ---- transcript-intro-based extraction ---------------------------------

function fromTranscript(body) {
  if (!body) return null;
  // Take a generous chunk after the first **Ashley Colby Fitzgerald** label —
  // Ashley typically introduces the guest in her opening turn.
  const lines = body.split('\n');
  const opening = [];
  let inAshley = false;
  let utts = 0;
  for (const line of lines) {
    if (/^\*\*[^*]+\*\*\s*\(/i.test(line)) {
      utts++;
      if (utts > 6) break; // first ~6 speaker turns is enough
      inAshley = /^\*\*Ashley Colby Fitzgerald\*\*/i.test(line);
      continue;
    }
    if (inAshley) opening.push(line);
  }
  const text = opening.join(' ').replace(/\s+/g, ' ');
  if (!text) return null;

  // Try a battery of patterns the host actually uses.
  const patterns = [
    /\bI(?:'m| am)\s+(?:here\s+)?(?:joined\s+)?(?:with|by)\s+(?:Dr\.?\s+)?([A-Z][a-zA-Z'’\-\.]+(?:\s+[A-Z][a-zA-Z'’\-\.]+){0,3})/,
    /\bI\s+have\s+(?:Dr\.?\s+)?([A-Z][a-zA-Z'’\-\.]+(?:\s+[A-Z][a-zA-Z'’\-\.]+){0,3})\s+(?:here|with me|on)/,
    /\b(?:welcome|hi),?\s+(?:Dr\.?\s+)?([A-Z][a-zA-Z'’\-\.]+(?:\s+[A-Z][a-zA-Z'’\-\.]+){0,3})\b/,
    /\btoday(?:'s| is)\s+(?:guest\s+is\s+)?(?:Dr\.?\s+)?([A-Z][a-zA-Z'’\-\.]+(?:\s+[A-Z][a-zA-Z'’\-\.]+){0,3})/,
  ];
  for (const re of patterns) {
    const m = text.match(re);
    if (m && isPlausibleName(m[1])) return m[1];
  }
  return null;
}

// ---- summary-based extraction (lowest priority) ------------------------

function fromSummary(summary) {
  if (!summary) return null;
  const flat = String(summary).replace(/\s+/g, ' ').trim();
  // Find a "X (is|sits|was|joined|recounts|operates|brings) " pattern at
  // sentence start. These narrative openers introduce the guest by name.
  const m = flat.match(/^(?:Dr\.?\s+)?([A-Z][a-zA-Z'’\-\.]+(?:\s+[A-Z][a-zA-Z'’\-\.]+){1,3})\s+(?:is\b|sits\b|was\b|joined\b|recounts\b|operates\b|brings\b|left\b|founded\b|spent\b|has\s+)/);
  if (m && isPlausibleName(m[1])) return m[1];
  return null;
}

// ---- frontmatter helpers ----------------------------------------------

function splitFrontmatter(raw) {
  const m = raw.match(/^(---\n)([\s\S]*?)(\n---\n)([\s\S]*)$/);
  if (!m) return null;
  return { open: m[1], fm: m[2], close: m[3], body: m[4] };
}

function readFmField(fm, key) {
  const re = new RegExp(`^${key}:\\s*(.+)$`, 'm');
  const m = fm.match(re);
  if (!m) return null;
  return m[1].trim().replace(/^["']|["']$/g, '');
}

function setFmField(fm, key, value) {
  const re = new RegExp(`^${key}:.*$`, 'm');
  if (value == null) {
    if (re.test(fm)) return fm.replace(re, '').replace(/\n\n+/g, '\n').trim() + '\n';
    return fm;
  }
  const line = `${key}: ${JSON.stringify(value)}`;
  if (re.test(fm)) return fm.replace(re, line);
  // Insert after `title:` if present, else at the end.
  if (/^title:/m.test(fm)) {
    return fm.replace(/^(title:.*)$/m, `$1\n${line}`);
  }
  return fm + `\n${line}`;
}

// ---- main --------------------------------------------------------------

const files = (await readdir(EPISODES_DIR))
  .filter((f) => f.endsWith('.mdx'))
  .sort()
  .map((f) => join(EPISODES_DIR, f));

let updated = 0, unchanged = 0, skipped = 0;

for (const path of files) {
  const raw = await readFile(path, 'utf8');
  const split = splitFrontmatter(raw);
  if (!split) { skipped++; continue; }
  // Only act on bot-touched files (those with a transcript section).
  if (!split.body.includes('## Transcript')) { skipped++; continue; }

  const title = readFmField(split.fm, 'title');
  const currentGuest = readFmField(split.fm, 'guest');
  const summary = readFmField(split.fm, 'summary');

  const candidates = [
    fromTitle(title),
    fromTranscript(split.body),
    fromSummary(summary),
  ].filter(Boolean);

  // Pick the first that's plausible.
  const chosen = candidates.find(isPlausibleName) ?? null;

  // Decision rule: only OVERRIDE the existing guest when it's clearly
  // junk (host name, "Speaker X" sentinel, topic-blocklist single
  // word). Otherwise, keep what's there — don't downgrade "Marcin
  // Jakubowski" to "Marcin" or "James Decker" to "James" just because
  // the title only spelled the first name.
  const currentValid = currentGuest && isPlausibleName(currentGuest);
  let newGuest;
  if (currentValid) {
    newGuest = currentGuest; // keep — it's not host, not sentinel, not blocklist
  } else {
    newGuest = chosen; // current is junk; replace with best candidate, or null
  }

  if (newGuest === currentGuest) { unchanged++; continue; }

  const before = currentGuest ?? '(none)';
  const after = newGuest ?? '(none)';
  console.log(`  ${path.split('/').pop().slice(0, 70).padEnd(72)}  ${before}  →  ${after}`);

  if (!DRY) {
    const newFm = setFmField(split.fm, 'guest', newGuest);
    const out = `${split.open}${newFm}${split.close}${split.body}`;
    await writeFile(path, out);
  }
  updated++;
}

console.log(`\nDone. ${updated} updated, ${unchanged} unchanged, ${skipped} skipped.${DRY ? ' (dry run)' : ''}`);
