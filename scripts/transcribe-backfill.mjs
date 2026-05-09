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
 *       [--dry-run] [--only=<guid-or-slug>]
 */

import { readFile, writeFile, readdir, mkdir } from 'node:fs/promises';
import { existsSync, createWriteStream } from 'node:fs';
import { join, basename } from 'node:path';
import { Blob } from 'node:buffer';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { createHash } from 'node:crypto';

const args = parseArgs(process.argv.slice(2));
const FEED = args.feed ?? 'https://anchor.fm/s/68308b7c/podcast/rss';
const MAX = Number(args.max ?? 500);
const DRY = !!args['dry-run'];
const ONLY = args.only ?? null;

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
for (const it of slice) {
  try {
    results.push(await processEpisode(it));
  } catch (err) {
    log(`  ✖ ${it.guid}: ${err.message}`);
    results.push({ guid: it.guid, title: it.title, error: err.message });
  }
}

const ok = results.filter((r) => !r.error);
const failed = results.filter((r) => r.error);
log('');
log(`Done. ${ok.length} processed, ${failed.length} failed.`);
if (failed.length) {
  log('Failures:');
  failed.forEach((r) => log(`  ${r.guid}  ${r.title}  →  ${r.error}`));
}

// =================================================================================

async function processEpisode(it) {
  const number = it.episodeNumber ?? extractEpisodeNumber(it.title);
  const slug = makeSlug(it.title);
  const baseName = number != null ? `${number}-${slug}` : `unnumbered-${shortHash(it.guid)}-${slug}`;
  const outMdxPath = join(EPISODES_DIR, `${baseName}.mdx`);

  log('');
  log(`▶ ${baseName}  ${it.title}`);

  if (DRY) {
    log(`  (dry) audio: ${it.audioUrl}`);
    log(`  (dry) would write → ${outMdxPath}`);
    return { guid: it.guid, title: it.title, slug: baseName, dry: true };
  }

  // 1a. Download audio (cached). Anchor enclosure URLs are public.
  const audioExt = inferAudioExt(it.audioUrl);
  const audioPath = join(AUDIO_DIR, `${shortHash(it.guid)}.${audioExt}`);
  if (!existsSync(audioPath)) {
    log('  • downloading audio…');
    await downloadFile(it.audioUrl, audioPath);
  } else {
    log('  • audio cached');
  }

  // 1b. ElevenLabs Scribe (cached)
  const txPath = join(CACHE_DIR, `${shortHash(it.guid)}.scribe.json`);
  let scribe;
  if (existsSync(txPath)) {
    scribe = JSON.parse(await readFile(txPath, 'utf8'));
    log('  • scribe transcript cached');
  } else {
    log('  • transcribing with ElevenLabs Scribe…');
    scribe = await scribeTranscribe(audioPath);
    await writeFile(txPath, JSON.stringify(scribe, null, 2));
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
    existingPath: existing.byNumber.get(number) ?? existing.bySlug.get(slug) ?? null,
  });
  await writeFile(outMdxPath, mdx);
  log(`  ✓ wrote ${outMdxPath}`);

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
    if (w.type && w.type !== 'word' && w.type !== 'audio_event') continue;
    const speaker = w.speaker_id ?? 'A';
    const text = w.text ?? '';
    if (!cur || cur.speaker !== speaker) {
      if (cur) utt.push(cur);
      cur = { speaker: normalizeSpeakerLabel(speaker), text, start: (w.start ?? 0) * 1000, end: (w.end ?? 0) * 1000 };
    } else {
      cur.text += (cur.text.endsWith(' ') ? '' : ' ') + text;
      cur.end = (w.end ?? cur.end) * 1000;
    }
  }
  if (cur) utt.push(cur);
  return utt.filter((u) => u.text.trim().length > 1);
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
  const cleaned = title.replace(/^(?:DO|Episode|Ep\.?)\s*\d+\s*[—\-:|]\s*/i, '');
  const beforeWith = cleaned.split(/\s+(?:w\/|with)\s+/i)[0];
  const beforeOn = beforeWith.split(/\s+on\s+/i)[0];
  return beforeOn.trim().slice(0, 80) || null;
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
  const totals = new Map();
  for (const u of utterances) totals.set(u.speaker, (totals.get(u.speaker) ?? 0) + (u.end - u.start));
  const ranked = [...totals.entries()].sort((a, b) => b[1] - a[1]);
  const map = {};
  ranked.forEach(([label], i) => {
    if (i === 0) map[label] = 'Ashley Colby Fitzgerald';
    else if (i === 1 && guestName) map[label] = guestName;
    else map[label] = `Speaker ${label}`;
  });
  return map;
}

async function buildMdx({ item, number, slug, utterances, speakers, enriched, existingPath }) {
  const transcriptBody = utterances
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

  const guest = speakers['B'] ?? speakers['A'] ?? 'Unknown Guest';
  const fm = [
    `number: ${number ?? '# TODO'}`,
    `title: ${yamlString(stripEpisodePrefix(item.title))}`,
    `guest: ${yamlString(guest)}`,
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
  return String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, 800).replace(/\n/g, '\n  ');
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
