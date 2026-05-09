#!/usr/bin/env node
/**
 * scripts/match-youtube.mjs
 *
 * Fetches the Doomer Optimism YouTube channel's RSS feed and tries to fill in
 * `youtubeId` for any episode MDX file that doesn't have one yet. Match is by
 * normalized title similarity; we only set the field when the score crosses
 * a confidence threshold so we don't pollute frontmatter with bad guesses.
 *
 * Designed to be safe to run on every cron tick: idempotent, never overwrites
 * an existing `youtubeId`, never invents one.
 *
 * Usage:
 *   YOUTUBE_CHANNEL_ID=UC... node scripts/match-youtube.mjs
 *     [--max 25]            # only consider the N most recent episodes
 *     [--threshold 0.55]    # minimum word-overlap score to accept
 *     [--dry-run]           # report matches without writing
 */
import { readFile, writeFile, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

const args = parseArgs(process.argv.slice(2));
const CHANNEL_ID = process.env.YOUTUBE_CHANNEL_ID;
const MAX = Number(args.max ?? 25);
const THRESHOLD = Number(args.threshold ?? 0.55);
const DRY = !!args['dry-run'];

if (!CHANNEL_ID) {
  console.log('YOUTUBE_CHANNEL_ID is not set; skipping YouTube match.');
  process.exit(0);
}

const ROOT = process.cwd();
const EPISODES_DIR = join(ROOT, 'src', 'content', 'episodes');

// 1. Fetch the channel feed.
const feedUrl = `https://www.youtube.com/feeds/videos.xml?channel_id=${CHANNEL_ID}`;
log(`▶ Fetching ${feedUrl}`);
const feedXml = await (await fetch(feedUrl)).text();
const ytItems = parseYouTubeFeed(feedXml);
log(`  Found ${ytItems.length} videos in channel feed.`);
if (ytItems.length === 0) {
  log('  (empty feed; nothing to do)');
  process.exit(0);
}

// 2. Walk the episode MDX files, sorted newest-first, take the most recent N.
const files = (await readdir(EPISODES_DIR))
  .filter((f) => f.endsWith('.mdx'))
  .map((f) => join(EPISODES_DIR, f));

const episodes = [];
for (const path of files) {
  const raw = await readFile(path, 'utf8');
  const fm = matchOne(raw, /^---\n([\s\S]*?)\n---/);
  if (!fm) continue;
  const title = unquote(matchOne(fm, /^title:\s*(.+)$/m));
  const number = Number(matchOne(fm, /^number:\s*(\d+)$/m) ?? 0);
  const pubDate = matchOne(fm, /^pubDate:\s*([0-9-]+)/m);
  const youtubeId = unquote(matchOne(fm, /^youtubeId:\s*(.+)$/m));
  episodes.push({ path, fm, raw, title, number, pubDate, youtubeId });
}
episodes.sort((a, b) => (b.pubDate ?? '').localeCompare(a.pubDate ?? ''));
const candidates = episodes.slice(0, MAX).filter((e) => !e.youtubeId);
log(`  Considering ${candidates.length} of the ${MAX} most recent episodes (those missing a youtubeId).`);

// 3. For each candidate, find its best YouTube match.
let updated = 0;
const claimed = new Set(); // a YouTube video belongs to at most one episode
for (const ep of candidates) {
  let best = null;
  for (const yt of ytItems) {
    if (claimed.has(yt.videoId)) continue;
    const score = titleSimilarity(ep.title, yt.title);
    if (!best || score > best.score) best = { yt, score };
  }
  if (!best || best.score < THRESHOLD) {
    log(`  · ${ep.number}  "${truncate(ep.title, 60)}" — no confident match (best ${best ? best.score.toFixed(2) + ' "' + truncate(best.yt.title, 40) + '"' : 'none'})`);
    continue;
  }
  log(`  ✓ ${ep.number}  "${truncate(ep.title, 60)}"  →  ${best.yt.videoId}  (${best.score.toFixed(2)} "${truncate(best.yt.title, 40)}")`);
  claimed.add(best.yt.videoId);
  if (!DRY) {
    const newRaw = writeYouTubeId(ep.raw, best.yt.videoId);
    if (newRaw !== ep.raw) { await writeFile(ep.path, newRaw); updated++; }
  } else {
    updated++;
  }
}
log('');
log(`Done. ${updated} episode${updated === 1 ? '' : 's'} ${DRY ? 'would be' : ''} updated.`);

// =================================================================================

function parseYouTubeFeed(xml) {
  const out = [];
  const entryRe = /<entry>([\s\S]*?)<\/entry>/g;
  let m;
  while ((m = entryRe.exec(xml))) {
    const block = m[1];
    const videoId = matchOne(block, /<yt:videoId>([\s\S]*?)<\/yt:videoId>/);
    const title = matchOne(block, /<title>([\s\S]*?)<\/title>/);
    const published = matchOne(block, /<published>([\s\S]*?)<\/published>/);
    if (!videoId || !title) continue;
    out.push({ videoId, title: stripCdata(title), published });
  }
  return out;
}

// Word-overlap similarity (Jaccard on lower-cased word tokens, with a few
// stopwords removed). Robust to "Doomer Optimism #303 -" prefixes, "with" /
// "w/" connectives, and trailing show-tag suffixes.
const STOPWORDS = new Set([
  'the', 'a', 'an', 'and', 'or', 'of', 'to', 'in', 'on', 'with', 'w',
  'do', 'doomer', 'optimism', 'episode', 'ep', 'podcast', 'no',
]);
function tokenize(s) {
  return String(s ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]+/g, ' ')
    .split(/\s+/)
    .filter((t) => t && !STOPWORDS.has(t) && !/^\d{1,3}$/.test(t));
}
function titleSimilarity(a, b) {
  const A = new Set(tokenize(a));
  const B = new Set(tokenize(b));
  if (A.size === 0 || B.size === 0) return 0;
  let inter = 0;
  for (const t of A) if (B.has(t)) inter++;
  return inter / new Set([...A, ...B]).size; // Jaccard
}

// Insert or replace `youtubeId: "..."` inside the frontmatter block.
function writeYouTubeId(raw, videoId) {
  const fmMatch = raw.match(/^(---\n)([\s\S]*?)(\n---\n)/);
  if (!fmMatch) return raw;
  let fm = fmMatch[2];
  if (/^youtubeId:.*$/m.test(fm)) {
    fm = fm.replace(/^youtubeId:.*$/m, `youtubeId: ${JSON.stringify(videoId)}`);
  } else {
    // Insert after audioUrl if present, else at the end of the frontmatter.
    if (/^audioUrl:.*$/m.test(fm)) {
      fm = fm.replace(/^(audioUrl:.*)$/m, `$1\nyoutubeId: ${JSON.stringify(videoId)}`);
    } else {
      fm = fm + `\nyoutubeId: ${JSON.stringify(videoId)}`;
    }
  }
  return raw.slice(0, fmMatch.index) + fmMatch[1] + fm + fmMatch[3] + raw.slice(fmMatch.index + fmMatch[0].length);
}

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) continue;
    const eq = a.indexOf('=');
    if (eq >= 0) out[a.slice(2, eq)] = a.slice(eq + 1);
    else if (argv[i + 1] && !argv[i + 1].startsWith('--')) out[a.slice(2)] = argv[++i];
    else out[a.slice(2)] = true;
  }
  return out;
}

function matchOne(s, re) { const m = s?.match(re); return m ? m[1].trim() : null; }
function stripCdata(s) { return s.replace(/^\s*<!\[CDATA\[/, '').replace(/\]\]>\s*$/, '').trim(); }
function unquote(s) { return s ? s.replace(/^['"]|['"]$/g, '') : null; }
function truncate(s, n) { return (s ?? '').length > n ? s.slice(0, n - 1) + '…' : (s ?? ''); }
function log(...a) { console.log(...a); }
