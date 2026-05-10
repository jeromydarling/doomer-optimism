#!/usr/bin/env node
/**
 * scripts/transcribe-backfill.mjs
 *
 * Two-stage pipeline:
 *   1. ElevenLabs Scribe transcribes audio with speaker diarization.
 *   2. Claude Haiku 4.5 enriches the transcript with chapters, key topics,
 *      book/paper bibliography, suggested pillar, summary in the show's voice,
 *      and pull quotes.
 *
 * Audio source: the Anchor / Spotify-for-Creators podcast RSS feed
 * (https://anchor.fm/s/68308b7c/podcast/rss). Direct enclosure downloads —
 * no yt-dlp, no YouTube bot walls.
 *
 * Output: idempotent MDX writes into src/content/episodes/, preserving any
 * hand-curated frontmatter when an episode file already exists. Caches per-
 * episode audio + transcript JSON in .transcripts/ so reruns skip done work.
 *
 * Usage:
 *   ELEVENLABS_API_KEY=... ANTHROPIC_API_KEY=... \
 *     node scripts/transcribe-backfill.mjs \
 *       --feed "https://anchor.fm/s/68308b7c/podcast/rss" \
 *       --max 500 \
 *       [--dry-run] [--only=<guid-or-slug>] [--limit-new=N]
 */

import { readFile, writeFile, readdir, mkdir } from 'node:fs/promises';
import { existsSync, createWriteStream } from 'node:fs';
import { join, basename } from 'node:path';
import { Blob } from 'node:buffer';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';

const args = parseArgs(process.argv.slice(2));
const FEED = args.feed ?? 'https://anchor.fm/s/68308b7c/podcast/rss';
const MAX = Number(args.max ?? 500);
const DRY = !!args['dry-run'];
const ONLY = args.only ?? null;
const LIMIT_NEW = Number(args['limit-new'] ?? 0);  // 0 = unlimited; else cap how many *fresh* (non-cached) episodes to process

const ELEVEN_KEY = process.env.ELEVENLABS_API_KEY;
const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;
const HAIKU_MODEL = process.env.ANTHROPIC_MODEL ?? 'claude-haiku-4-5-20251001';

if (!DRY && (!ELEVEN_KEY || !ANTHROPIC_KEY)) {
  console.error('ELEVENLABS_API_KEY and ANTHROPIC_API_KEY are required (unless --dry-run).');
  process.exit(1);
}

// Declared up here (above top-level await) to avoid TDZ when the loop
// reaches enrichWithHaiku before module evaluation reaches the const below.
const SHOW_CONTEXT = `You are processing a transcript from Doomer Optimism, a podcast hosted by Ashley Colby Fitzgerald (PhD, Environmental Sociology; co-founder Rizoma Field School). The show explores how to live well in the age of the Machine. Its intellectual lineage runs through Wendell Berry, Ivan Illich, Christopher Lasch, and Morris Berman. It is rooted in Catholic Social Teaching but is ecumenical in conversation.

The site organizes around six content pillars (use these exact slugs):
- regenerative-agriculture
- conservation-environment
- built-environment
- technology-ai-transhumanism
- right-to-repair-surveillance
- tech-limited-child-rearing

You receive a transcript with speaker labels and timestamps. You return a structured analysis via the provided tool. The summary must be written in the show's voice: clear-eyed about systemic fragility, hopeful about practical community-led work, never glib. Bibliography entries should only include works that are actually mentioned or clearly referenced in the transcript — never invent citations. Pull quotes should be verbatim and self-contained.`;

const ROOT = process.cwd();
const CACHE_DIR = join(ROOT, '.transcripts');
const AUDIO_DIR = join(CACHE_DIR, 'audio');
const ENRICH_DIR = join(CACHE_DIR, 'enriched');
const EPISODES_DIR = join(ROOT, 'src', 'content', 'episodes');
await mkdir(CACHE_DIR, { recursive: true });
await mkdir(AUDIO_DIR, { recursive: true });
await mkdir(ENRICH_DIR, { recursive: true });

// ---- 1. fetch + parse RSS ------------------------------------------------------
log('▶ Fetching feed:', FEED);
const feedXml = await (await fetch(FEED)).text();
const items = parseRss(feedXml).filter((it) => !ONLY || it.guid === ONLY || makeSlug(it.title) === ONLY);
const slice = items.slice(0, MAX);
log(`  Found ${items.length} episodes in feed; processing ${slice.length}.`);

const existing = await loadExistingEpisodes();

const results = [];
let newProcessed = 0;
for (const it of slice) {
  // Pre-check the cache so we can stop after N fresh transcriptions.
  const txPath = join(CACHE_DIR, `${shortHash(it.guid)}.scribe.json`);
  const cached = existsSync(txPath);
  if (LIMIT_NEW > 0 && !cached && newProcessed >= LIMIT_NEW) {
    log('');
    log(`Hit --limit-new ${LIMIT_NEW}; stopping before any further fresh transcriptions.`);
    break;
  }
  try {
    results.push(await processEpisode(it));
    if (!cached) newProcessed++;
  } catch (err) {
    log(`  ✖ ${it.guid}: ${err.message}`);
    results.push({ guid: it.guid, title: it.title, error: err.message });
  }
}

const ok = results.filter((r) => !r.error);
const failed = results.filter((r) => r.error);
log('');
log(`Done. ${ok.length} processed (${newProcessed} freshly transcribed), ${failed.length} failed.`);
if (failed.length) {
  log('Failures:');
  failed.forEach((r) => log(`  ${r.guid}  ${r.title}  →  ${r.error}`));
}

// On dry-runs, print a cost projection so we know whether a real run
// will fit under the available ElevenLabs credit balance.
if (DRY) {
  const cached = [];
  const fresh = [];
  for (const it of slice) {
    const txPath = join(CACHE_DIR, `${shortHash(it.guid)}.scribe.json`);
    (existsSync(txPath) ? cached : fresh).push(it);
  }
  const sumSec = (xs) => xs.reduce((s, x) => s + (x.durationSeconds || 0), 0);
  const cachedSec = sumSec(cached);
  const freshSec = sumSec(fresh);
  const fmtH = (s) => {
    const h = Math.floor(s / 3600);
    const m = Math.round((s % 3600) / 60);
    return `${h}h ${String(m).padStart(2, '0')}m`;
  };
  const noDur = fresh.filter((x) => !x.durationSeconds).length;

  log('');
  log('━━━ Dry-run cost projection ━━━');
  log(`  Cached (skipped): ${cached.length} episodes / ${fmtH(cachedSec)}`);
  log(`  Fresh (would transcribe): ${fresh.length} episodes / ${fmtH(freshSec)}`);
  if (noDur) log(`    (note: ${noDur} fresh episodes have no <itunes:duration> in feed; cost may be undercounted)`);
  log('');
  log('  Per-episode list (fresh, sorted by episode number):');
  const sorted = [...fresh].sort((a, b) => (a.episodeNumber ?? 0) - (b.episodeNumber ?? 0));
  for (const it of sorted) {
    const num = it.episodeNumber != null ? `#${String(it.episodeNumber).padStart(3, ' ')}` : '#???';
    const dur = it.durationSeconds ? fmtH(it.durationSeconds) : '   ?  ';
    log(`    ${num}  ${dur}  ${it.title.slice(0, 80)}`);
  }
  log('');
  log('  Credit projection (Scribe v1, varies by plan tier):');
  const minutes = freshSec / 60;
  for (const rate of [25, 30, 35, 40, 45]) {
    const credits = Math.round(minutes * rate);
    log(`    @ ${rate} credits/min → ${credits.toLocaleString()} credits`);
  }
  log('');
  log('  Verify the empirical rate against your billing dashboard:');
  log('    last full run cost / minutes processed = your actual rate');
  log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
}

// =================================================================================

async function processEpisode(it) {
  const number = it.episodeNumber ?? extractEpisodeNumber(it.title);
  const slug = makeSlug(it.title);
  const baseName = number != null ? `${number}-${slug}` : `unnumbered-${shortHash(it.guid)}-${slug}`;

  // If a hand-curated file already exists for this episode number/slug, we
  // write back to *it* so curated frontmatter is preserved and we don't
  // duplicate the episode under a fresh RSS-derived filename.
  const existingPath = existing.byNumber.get(number) ?? existing.bySlug.get(slug) ?? null;
  const outMdxPath = (existingPath && existsSync(existingPath))
    ? existingPath
    : join(EPISODES_DIR, `${baseName}.mdx`);

  log('');
  log(`▶ ${baseName}  ${it.title}`);

  if (DRY) {
    log(`  (dry) audio: ${it.audioUrl}`);
    log(`  (dry) would write → ${outMdxPath}`);
    return { guid: it.guid, title: it.title, slug: baseName, dry: true };
  }

  // 1a + 1b. Audio + Scribe transcription. We only need the audio file on
  // disk if Scribe needs to run; if the .scribe.json is already cached, skip
  // the download entirely. (The CI cache no longer holds audio files, so a
  // re-run after a successful transcription doesn't re-download them.)
  const audioExt = inferAudioExt(it.audioUrl);
  const audioPath = join(AUDIO_DIR, `${shortHash(it.guid)}.${audioExt}`);
  const txPath = join(CACHE_DIR, `${shortHash(it.guid)}.scribe.json`);
  const scribeCached = existsSync(txPath);

  if (!scribeCached) {
    if (!existsSync(audioPath)) {
      log('  • downloading audio…');
      await downloadFile(it.audioUrl, audioPath);
    } else {
      log('  • audio cached');
    }
  }

  let scribe;
  if (scribeCached) {
    scribe = JSON.parse(await readFile(txPath, 'utf8'));
    log('  • scribe transcript cached');
  } else {
    log('  • transcribing with ElevenLabs Scribe…');
    scribe = await scribeTranscribe(audioPath);
    await writeFile(txPath, JSON.stringify(scribe, null, 2));
    // Critical: push this transcript to the durable branch immediately.
    // If the runner dies after the next line, this scribe.json is
    // already on origin/claude/transcripts-backfill — no rework, no
    // re-spend on Scribe. CHECKPOINT_PUSH=1 is set by CI; locally this
    // is a no-op so dev runs don't accidentally push.
    checkpointPush(`scribe.json for ${baseName}`);
  }

  const utterances = wordsToUtterances(scribe.words ?? []);
  const guestFromTitle = extractGuestName(it.title);
  const speakers = mapSpeakers(utterances, guestFromTitle);
  const transcriptText = utterances
    .map((u) => `${speakers[u.speaker] ?? `Speaker ${u.speaker}`} (${formatTimestamp(u.start)}): ${u.text}`)
    .join('\n\n');

  // 2. Haiku enrichment (cached)
  const enrichPath = join(ENRICH_DIR, `${shortHash(it.guid)}.json`);
  let enriched;
  if (existsSync(enrichPath)) {
    enriched = JSON.parse(await readFile(enrichPath, 'utf8'));
    log('  • enrichment cached');
  } else {
    log('  • enriching with Claude Haiku…');
    enriched = await enrichWithHaiku({ title: it.title, guest: speakers['B'] ?? guestFromTitle, transcriptText });
    await writeFile(enrichPath, JSON.stringify(enriched, null, 2));
  }

  // 3. MDX
  const mdx = await buildMdx({
    item: it,
    number,
    slug,
    utterances,
    speakers,
    enriched,
    existingPath: (existingPath && existsSync(existingPath)) ? existingPath : null,
  });
  await writeFile(outMdxPath, mdx);
  log(`  ✓ wrote ${outMdxPath}`);
  // Push the MDX (and any not-yet-pushed enrich.json) for this episode
  // before moving to the next. Combined with the scribe-time checkpoint
  // above, this means a runner death can lose at most the in-flight
  // episode's downstream artifacts — its scribe.json is already safe.
  checkpointPush(`episode ${baseName}`);

  return { guid: it.guid, title: it.title, number, path: outMdxPath };
}

// ---- RSS parsing ---------------------------------------------------------------
function parseRss(xml) {
  const items = [];
  const itemRe = /<item>([\s\S]*?)<\/item>/g;
  let m;
  while ((m = itemRe.exec(xml))) {
    const block = m[1];
    const title = stripCdata(matchOne(block, /<title>([\s\S]*?)<\/title>/));
    const pubDate = matchOne(block, /<pubDate>([\s\S]*?)<\/pubDate>/);
    const guid = stripCdata(matchOne(block, /<guid[^>]*>([\s\S]*?)<\/guid>/));
    const description = stripCdata(
      matchOne(block, /<description>([\s\S]*?)<\/description>/) ||
      matchOne(block, /<itunes:summary>([\s\S]*?)<\/itunes:summary>/),
    );
    const duration = matchOne(block, /<itunes:duration>([\s\S]*?)<\/itunes:duration>/);
    const epStr = matchOne(block, /<itunes:episode>([\s\S]*?)<\/itunes:episode>/);
    const enc = block.match(/<enclosure[^>]*url="([^"]+)"[^>]*\/?>/);
    if (!enc) continue;
    items.push({
      guid: guid ?? enc[1],
      title: (title ?? '').trim(),
      pubDate,
      description: description ?? '',
      durationSeconds: parseDuration(duration),
      episodeNumber: epStr ? Number(epStr) : null,
      audioUrl: enc[1],
    });
  }
  return items;
}

function matchOne(s, re) { const m = s.match(re); return m ? m[1] : null; }
function stripCdata(s) { return s == null ? null : s.replace(/^\s*<!\[CDATA\[/, '').replace(/\]\]>\s*$/, '').trim(); }
function parseDuration(d) {
  if (!d) return 0;
  const s = String(d).trim();
  if (/^\d+$/.test(s)) return Number(s);
  const parts = s.split(':').map(Number);
  if (parts.some(isNaN)) return 0;
  let total = 0;
  for (const p of parts) total = total * 60 + p;
  return total;
}
function inferAudioExt(url) {
  const m = url.match(/\.(mp3|m4a|aac|wav|ogg)(?:\?|$)/i);
  return m ? m[1].toLowerCase() : 'mp3';
}
function shortHash(s) { return createHash('sha1').update(String(s)).digest('hex').slice(0, 12); }

// Per-episode checkpoint: stage+commit+push the latest .transcripts/
// state to the current branch (claude/transcripts-backfill in CI). Best-
// effort — a network blip or git-lock contention logs a warning and
// keeps going. The next successful checkpoint catches up. Only fires
// when CHECKPOINT_PUSH=1 (set by the CI workflow); local dev is a no-op.
function checkpointPush(reason) {
  if (process.env.CHECKPOINT_PUSH !== '1') return;
  const run = (args) => spawnSync('git', args, { encoding: 'utf8', timeout: 60_000 });
  try {
    run(['add', '.transcripts/', 'src/content/episodes/']);
    const diff = run(['diff', '--cached', '--quiet']);
    if (diff.status === 0) return; // nothing staged → nothing to do
    const c = run(['commit', '-m', `Checkpoint: ${reason}`, '--quiet']);
    if (c.status !== 0) {
      log(`  ⚠ checkpoint commit failed (${(c.stderr || '').trim().slice(0, 120)})`);
      return;
    }
    const p = run(['push', 'origin', 'HEAD']);
    if (p.status !== 0) {
      log(`  ⚠ checkpoint push failed (${(p.stderr || '').trim().slice(0, 120)}); will retry next checkpoint`);
    } else {
      log('  • pushed checkpoint to claude/transcripts-backfill');
    }
  } catch (err) {
    log(`  ⚠ checkpoint error: ${err.message}`);
  }
}

// ---- Audio download ------------------------------------------------------------
async function downloadFile(url, outPath) {
  const res = await fetch(url, { redirect: 'follow' });
  if (!res.ok) throw new Error(`download ${res.status}: ${url}`);
  await pipeline(Readable.fromWeb(res.body), createWriteStream(outPath));
}

// ---- ElevenLabs Scribe ---------------------------------------------------------
async function scribeTranscribe(audioPath) {
  const data = await readFile(audioPath);
  const ext = audioPath.split('.').pop()?.toLowerCase() ?? 'mp3';
  const mime = { mp3: 'audio/mpeg', m4a: 'audio/m4a', aac: 'audio/aac', wav: 'audio/wav', ogg: 'audio/ogg' }[ext] ?? 'audio/mpeg';
  const form = new FormData();
  form.append('file', new Blob([data], { type: mime }), basename(audioPath));
  form.append('model_id', 'scribe_v1');
  form.append('diarize', 'true');
  form.append('timestamps_granularity', 'word');
  form.append('language_code', 'en');

  const res = await fetch('https://api.elevenlabs.io/v1/speech-to-text', {
    method: 'POST',
    headers: { 'xi-api-key': ELEVEN_KEY },
    body: form,
  });
  if (!res.ok) throw new Error(`scribe ${res.status}: ${await res.text()}`);
  return res.json();
}

function wordsToUtterances(words) {
  const utt = [];
  let cur = null;
  for (const w of words) {
    // Drop annotation events outright — "(laughs)", "(mysterious music)", etc.
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

// Light editorial cleanup of an utterance — preserve voice and content,
// strip the noise that makes a raw STT transcript painful to read.
function cleanUtteranceText(s) {
  if (!s) return '';
  let t = String(s);
  // Strip Scribe/Whisper-style control tokens like "<|agent|>", "<|en|>" —
  // they break MDX parsers because they look like JSX expressions.
  t = t.replace(/<\|[^|>]{1,40}\|>/g, '');
  // Remove parenthetical/bracketed stage directions: "(laughs)", "[music]".
  t = t.replace(/\s*[\(\[][^()\[\]]{1,40}[\)\]]/g, '');
  // Strip leading filler "Um, " / "Uh, " / "Erm, ".
  t = t.replace(/^\s*(?:um|uh|erm)[,\.\s]+/i, '');
  // Strip trailing same.
  t = t.replace(/[,\s]+(?:um|uh|erm)\s*$/i, '');
  // Collapse stutter repetitions: "I, I, I" -> "I"; "the, the" -> "the".
  // Two-or-more identical words separated only by commas/whitespace.
  t = t.replace(/\b(\w+)([,\s]+\1\b){1,4}/gi, '$1');
  // Tidy spacing around punctuation.
  t = t.replace(/\s+([,\.\?!:;])/g, '$1');
  t = t.replace(/\s{2,}/g, ' ');
  // Drop a leading bare acknowledgment if it now sits alone at the start.
  t = t.replace(/^\s*(?:Mm+|Mhm+|Hm+)[\.,]\s*/i, '');
  return t.trim();
}

// Combine consecutive utterances from the same speaker into a single block.
// After Scribe diarises, you often get "Speaker A: short fragment / Speaker A:
// longer thought / Speaker A: another fragment" because the model emits a new
// utterance on long pauses. For reading, those should be one paragraph.
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

function normalizeSpeakerLabel(id) {
  const m = String(id).match(/(\d+)$/);
  if (!m) return id;
  return String.fromCharCode(65 + Number(m[1]));
}

// ---- Claude Haiku enrichment ---------------------------------------------------
// SHOW_CONTEXT is declared near the top of this file (before the top-level
// await loop) to avoid a temporal-dead-zone error.

async function enrichWithHaiku({ title, guest, transcriptText }) {
  const MAX_CHARS = 240_000;
  const trimmed = transcriptText.length > MAX_CHARS
    ? transcriptText.slice(0, MAX_CHARS) + '\n\n[...transcript truncated for analysis...]'
    : transcriptText;

  const tools = [{
    name: 'record_episode_analysis',
    description: 'Record the structured analysis of a Doomer Optimism episode.',
    input_schema: {
      type: 'object',
      required: ['summary', 'chapters', 'keyTopics', 'bibliography', 'suggestedPillar', 'pullQuotes'],
      properties: {
        summary: { type: 'string', description: 'A 2-paragraph summary in the show\'s voice. ~120-180 words total.' },
        chapters: {
          type: 'array',
          items: {
            type: 'object',
            required: ['start', 'headline'],
            properties: {
              start: { type: 'string', description: 'Timestamp like "12:34" or "1:02:33".' },
              headline: { type: 'string' },
            },
          },
        },
        keyTopics: { type: 'array', items: { type: 'string' }, maxItems: 8 },
        bibliography: {
          type: 'array',
          items: {
            type: 'object',
            required: ['title', 'kind'],
            properties: {
              title: { type: 'string' },
              author: { type: 'string' },
              year: { type: 'number' },
              kind: { type: 'string', enum: ['book', 'paper', 'article', 'film', 'podcast', 'site'] },
            },
          },
        },
        suggestedPillar: {
          type: 'string',
          enum: [
            'regenerative-agriculture',
            'conservation-environment',
            'built-environment',
            'technology-ai-transhumanism',
            'right-to-repair-surveillance',
            'tech-limited-child-rearing',
          ],
        },
        secondaryPillar: { type: ['string', 'null'] },
        pullQuotes: { type: 'array', items: { type: 'string' }, maxItems: 4 },
      },
    },
  }];

  const body = {
    model: HAIKU_MODEL,
    max_tokens: 4096,
    system: [
      { type: 'text', text: SHOW_CONTEXT, cache_control: { type: 'ephemeral' } },
    ],
    tools,
    tool_choice: { type: 'tool', name: 'record_episode_analysis' },
    messages: [
      {
        role: 'user',
        content: [
          { type: 'text', text: `Episode title: ${title}\nGuest (heuristic): ${guest ?? 'unknown'}\n\nTranscript:\n${trimmed}` },
        ],
      },
    ],
  };

  // Anthropic rate-limits per minute. On 429/529/503, honor the Retry-After
  // header when present, else exponential backoff with jitter. Up to 8 attempts.
  for (let attempt = 0; attempt < 8; attempt++) {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_KEY,
        'anthropic-version': '2023-06-01',
        'anthropic-beta': 'prompt-caching-2024-07-31',
      },
      body: JSON.stringify(body),
    });
    if (res.status === 429 || res.status === 529 || res.status === 503) {
      const ra = parseFloat(res.headers.get('retry-after'));
      const wait = (Number.isFinite(ra) ? ra : Math.min(180, 20 * Math.pow(2, attempt))) + Math.random() * 5;
      log(`  ⏸  anthropic ${res.status}; sleeping ${wait.toFixed(1)}s (attempt ${attempt + 1}/8)`);
      await sleep(wait * 1000);
      continue;
    }
    if (!res.ok) throw new Error(`anthropic ${res.status}: ${await res.text()}`);
    const j = await res.json();
    const toolUse = (j.content ?? []).find((c) => c.type === 'tool_use');
    if (!toolUse) throw new Error('Haiku did not return a tool_use block');
    return toolUse.input;
  }
  throw new Error('anthropic: too many rate-limit retries');
}

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

// ---- Helpers, MDX generation ---------------------------------------------------
function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const eq = a.indexOf('=');
      if (eq >= 0) out[a.slice(2, eq)] = a.slice(eq + 1);
      else if (argv[i + 1] && !argv[i + 1].startsWith('--')) out[a.slice(2)] = argv[++i];
      else out[a.slice(2)] = true;
    }
  }
  return out;
}

function extractEpisodeNumber(title) {
  const m = title.match(/(?:^|\b)(?:DO|Episode|Ep\.?)\s*#?\s*(\d{1,3})\b/i);
  if (m) return Number(m[1]);
  const m2 = title.match(/^#?(\d{1,3})\s*[—\-:|]/);
  if (m2) return Number(m2[1]);
  return null;
}

function extractGuestName(title) {
  // Pull the segment that comes before the first connective ("with", "w/",
  // "on", "and", "featuring") or comma — that's where a guest name lives in
  // titles like "DO 296 - Peter Allen on regenerative ag" or "DO 96 - Inez
  // Stepman w/ Ashley Colby". For solo / topic-titled episodes there is no
  // such segment, so we return null and fall back to "Speaker B" for the
  // second voice (rather than wrongly labelling them with the topic title,
  // which is what the previous version did).
  const cleaned = title.replace(/^(?:DO|Episode|Ep\.?)\s*\d+\s*[—\-:|]\s*/i, '').trim();
  if (!cleaned) return null;
  const candidate = cleaned
    .split(/\s+(?:w\/|with|on|and|featuring|feat\.?)\s+|,\s+/i)[0]
    ?.trim();
  if (!candidate) return null;
  const words = candidate.split(/\s+/);
  // A proper name is 2–4 words, each beginning with an uppercase letter.
  // Allows "Dr.", "O'Neill", "Berman-Smith".
  if (words.length < 2 || words.length > 4) return null;
  if (candidate.length > 50) return null;
  const looksLikeName = words.every((w) => /^[A-Z][a-zA-Z'’‘\-\.]*$/.test(w));
  if (!looksLikeName) return null;
  return candidate;
}

function makeSlug(title) {
  return title
    .toLowerCase()
    .replace(/^(?:do|episode|ep\.?)\s*\d+\s*[—\-:|]\s*/i, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '')
    .slice(0, 80);
}

async function loadExistingEpisodes() {
  const byNumber = new Map();
  const bySlug = new Map();
  try {
    const entries = await readdir(EPISODES_DIR);
    for (const f of entries) {
      if (!f.endsWith('.mdx')) continue;
      const m = f.match(/^(\d+)-(.+)\.mdx$/);
      if (m) {
        byNumber.set(Number(m[1]), join(EPISODES_DIR, f));
        bySlug.set(m[2], join(EPISODES_DIR, f));
      }
    }
  } catch {}
  return { byNumber, bySlug };
}

function mapSpeakers(utterances, guestName) {
  // Step 1: figure out which speaker is Ashley.
  // Preferred signal: the first utterance in the first ~30 that says
  // "welcome to Doomer Optimism" / "welcome back to Doomer Optimism" /
  // "this is Doomer Optimism" / "I have <X> here" / "you're listening to
  // Doomer Optimism" — that speaker is the host. The previous "longest
  // talker = Ashley" heuristic was wrong for interview shows where the
  // guest dominates talk-time.
  const INTRO_RE = /\b(?:welcome (?:back )?to|this is|you'?re listening to)\s+(?:do(?:omer)?\s*optimism|do(?:omer)?\s*op)|i have\s+\w+\s+(?:here|with me|on)|hi(?:,| ).*welcome/i;
  let hostLabel = null;
  for (const u of utterances.slice(0, 30)) {
    if (INTRO_RE.test(u.text)) { hostLabel = u.speaker; break; }
  }

  // Fallback: longest cumulative talk time (the original heuristic).
  if (!hostLabel) {
    const totals = new Map();
    for (const u of utterances) totals.set(u.speaker, (totals.get(u.speaker) ?? 0) + (u.end - u.start));
    hostLabel = [...totals.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
  }

  // Step 2: rank everyone else by talk time so the longest non-host gets
  // the guest name; the rest stay as "Speaker C/D/...".
  const totals = new Map();
  for (const u of utterances) totals.set(u.speaker, (totals.get(u.speaker) ?? 0) + (u.end - u.start));
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

async function buildMdx({ item, number, slug, utterances, speakers, enriched, existingPath }) {
  // Merge consecutive same-speaker utterances into a single paragraph so the
  // page reads like a transcript instead of a chat log of one-line fragments.
  const merged = mergeAdjacentSameSpeaker(utterances);
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

  if (existingPath && existsSync(existingPath)) {
    const raw = await readFile(existingPath, 'utf8');
    const { frontmatter, body } = splitFrontmatter(raw);
    const newBody = body.includes('## Transcript')
      ? body
      : `${body.trim()}\n${chaptersBlock}${pullQuotesBlock}\n## Transcript\n\n${transcriptBody}\n`;
    return `---\n${frontmatter}\n---\n${newBody}`;
  }

  // Only emit a `guest:` field when we actually have a real name. Writing
  // `guest: "Speaker B"` to the schema-validated frontmatter is worse than
  // omitting it — the schema makes it optional and the page can fall back.
  const rawGuest = speakers['B'] ?? speakers['A'] ?? null;
  const guestLine = (rawGuest && !/^Speaker\s+[A-Z]$/.test(rawGuest))
    ? `guest: ${yamlString(rawGuest)}`
    : null;
  const fm = [
    `number: ${number ?? '# TODO'}`,
    `title: ${yamlString(stripEpisodePrefix(item.title))}`,
    guestLine,
    `pubDate: ${formatDate(item.pubDate)}`,
    `durationSeconds: ${item.durationSeconds || 0}`,
    `pillar: ${enriched.suggestedPillar ?? 'technology-ai-transhumanism # TODO: review'}`,
    enriched.secondaryPillar ? `secondaryPillar: ${enriched.secondaryPillar}` : null,
    `summary: >-\n  ${escapeYamlMultiline(enriched.summary ?? item.title)}`,
    `audioUrl: ${yamlString(item.audioUrl)}`,
    `bibliography:`,
    ...(enriched.bibliography ?? []).map((b) =>
      `  - { title: ${yamlString(b.title)}${b.author ? `, author: ${yamlString(b.author)}` : ''}${b.year ? `, year: ${b.year}` : ''}, kind: ${b.kind} }`
    ),
    `draft: true`,
  ].filter(Boolean).join('\n');

  return `---\n${fm}\n---\n\n## Summary\n\n${enriched.summary ?? '*Auto-generated; please edit before publishing.*'}\n${chaptersBlock}${pullQuotesBlock}\n## Transcript\n\n${transcriptBody}\n`;
}

function splitFrontmatter(raw) {
  const m = raw.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!m) return { frontmatter: '', body: raw };
  return { frontmatter: m[1], body: m[2] };
}

function yamlString(s) { return JSON.stringify(String(s ?? '').replace(/\s+/g, ' ').trim()); }
function escapeYamlMultiline(s) {
  // Collapse to single line then re-wrap at ~80 cols so the summary reads
  // cleanly in YAML block-scalar form. We used to slice(0, 800) which
  // chopped mid-sentence; let the literal block carry whatever Haiku gave us.
  const flat = String(s ?? '').replace(/\s+/g, ' ').trim();
  const wrapped = flat.replace(/(.{1,80})(?:\s|$)/g, '$1\n  ').trim();
  return wrapped;
}
function stripEpisodePrefix(t) { return t.replace(/^(?:DO|Episode|Ep\.?)\s*\d+\s*[—\-:|]\s*/i, '').trim(); }
function formatDate(rfc) {
  if (!rfc) return new Date().toISOString().slice(0, 10);
  const d = new Date(rfc);
  if (isNaN(d.valueOf())) return new Date().toISOString().slice(0, 10);
  return d.toISOString().slice(0, 10);
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
function log(...a) { console.log(...a); }
