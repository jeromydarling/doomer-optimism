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
 * Audio source: yt-dlp against the YouTube channel.
 * Output: idempotent MDX writes into src/content/episodes/, preserving any
 * hand-curated frontmatter when an episode file already exists.
 *
 * Caches per-video JSON in .transcripts/ so reruns skip done work.
 *
 * Usage:
 *   ELEVENLABS_API_KEY=... ANTHROPIC_API_KEY=... \
 *     node scripts/transcribe-backfill.mjs \
 *       --channel "https://www.youtube.com/@doomeroptimism" \
 *       --max 300 \
 *       [--dry-run] [--only=<videoId>]
 */

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, readFile, writeFile, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, basename } from 'node:path';
import { Blob } from 'node:buffer';

const exec = promisify(execFile);

const args = parseArgs(process.argv.slice(2));
const CHANNEL = args.channel ?? 'https://www.youtube.com/@doomeroptimism';
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

const ROOT = process.cwd();
const CACHE_DIR = join(ROOT, '.transcripts');
const AUDIO_DIR = join(CACHE_DIR, 'audio');
const ENRICH_DIR = join(CACHE_DIR, 'enriched');
const EPISODES_DIR = join(ROOT, 'src', 'content', 'episodes');
await mkdir(CACHE_DIR, { recursive: true });
await mkdir(AUDIO_DIR, { recursive: true });
await mkdir(ENRICH_DIR, { recursive: true });

// ---- 1. enumerate channel ----
log('▶ Enumerating channel:', CHANNEL);
const listJson = await ytdlp([
  '--flat-playlist',
  '--dump-json',
  '--playlist-end', String(MAX),
  CHANNEL,
]);
const videos = listJson
  .split('\n')
  .filter(Boolean)
  .map((line) => JSON.parse(line))
  .filter((v) => !ONLY || v.id === ONLY);
log(`  Found ${videos.length} videos.`);

const existing = await loadExistingEpisodes();

const results = [];
for (const v of videos) {
  try {
    results.push(await processVideo(v));
  } catch (err) {
    log(`  ✖ ${v.id}: ${err.message}`);
    results.push({ id: v.id, title: v.title, error: err.message });
  }
}

const ok = results.filter((r) => !r.error);
const failed = results.filter((r) => r.error);
log('');
log(`Done. ${ok.length} processed, ${failed.length} failed.`);
if (failed.length) {
  log('Failures:');
  failed.forEach((r) => log(`  ${r.id}  ${r.title}  →  ${r.error}`));
}

// =================================================================================

async function processVideo(v) {
  const number = extractEpisodeNumber(v.title);
  const slug = makeSlug(v.title);
  const baseName = number != null ? `${number}-${slug}` : `unnumbered-${v.id}-${slug}`;
  const outMdxPath = join(EPISODES_DIR, `${baseName}.mdx`);

  log('');
  log(`▶ ${v.id}  ${v.title}`);

  if (DRY) {
    log(`  (dry) would write → ${outMdxPath}`);
    return { id: v.id, title: v.title, slug: baseName, dry: true };
  }

  // 1a. Download audio (cached)
  const audioPath = join(AUDIO_DIR, `${v.id}.m4a`);
  if (!existsSync(audioPath)) {
    log('  • downloading audio…');
    await ytdlp([
      '-f', 'bestaudio[ext=m4a]/bestaudio',
      '--no-playlist',
      '-o', audioPath,
      `https://www.youtube.com/watch?v=${v.id}`,
    ]);
  } else {
    log('  • audio cached');
  }

  // 1b. ElevenLabs Scribe transcript (cached)
  const txPath = join(CACHE_DIR, `${v.id}.scribe.json`);
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
  const guestFromTitle = extractGuestName(v.title);
  const speakers = mapSpeakers(utterances, guestFromTitle);
  const transcriptText = utterances
    .map((u) => `${speakers[u.speaker] ?? `Speaker ${u.speaker}`} (${formatTimestamp(u.start)}): ${u.text}`)
    .join('\n\n');

  // 2. Haiku enrichment (cached)
  const enrichPath = join(ENRICH_DIR, `${v.id}.json`);
  let enriched;
  if (existsSync(enrichPath)) {
    enriched = JSON.parse(await readFile(enrichPath, 'utf8'));
    log('  • enrichment cached');
  } else {
    log('  • enriching with Claude Haiku…');
    enriched = await enrichWithHaiku({ title: v.title, guest: speakers['B'] ?? guestFromTitle, transcriptText });
    await writeFile(enrichPath, JSON.stringify(enriched, null, 2));
  }

  // 3. MDX
  const mdx = await buildMdx({
    video: v,
    number,
    slug,
    utterances,
    speakers,
    enriched,
    existingPath: existing.byNumber.get(number) ?? existing.bySlug.get(slug) ?? null,
  });
  await writeFile(outMdxPath, mdx);
  log(`  ✓ wrote ${outMdxPath}`);

  return { id: v.id, title: v.title, number, path: outMdxPath };
}

// ---- ElevenLabs Scribe ---------------------------------------------------------
async function scribeTranscribe(audioPath) {
  const data = await readFile(audioPath);
  const form = new FormData();
  form.append('file', new Blob([data], { type: 'audio/m4a' }), basename(audioPath));
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
      cur = { speaker: normalizeSpeakerLabel(speaker), text: text, start: (w.start ?? 0) * 1000, end: (w.end ?? 0) * 1000 };
    } else {
      cur.text += (cur.text.endsWith(' ') ? '' : ' ') + text;
      cur.end = (w.end ?? cur.end) * 1000;
    }
  }
  if (cur) utt.push(cur);
  // Glue tiny utterances back into neighbors (artifacts of single-word speaker flips)
  return utt.filter((u) => u.text.trim().length > 1);
}

function normalizeSpeakerLabel(id) {
  // Scribe uses "speaker_0", "speaker_1" — convert to "A", "B", "C", …
  const m = String(id).match(/(\d+)$/);
  if (!m) return id;
  return String.fromCharCode(65 + Number(m[1]));
}

// ---- Claude Haiku enrichment ---------------------------------------------------
const SHOW_CONTEXT = `You are processing a transcript from Doomer Optimism, a podcast hosted by Ashley Colby Fitzgerald (PhD, Environmental Sociology; co-founder Rizoma Field School). The show explores how to live well in the age of the Machine. Its intellectual lineage runs through Wendell Berry, Ivan Illich, Christopher Lasch, and Morris Berman. It is rooted in Catholic Social Teaching but is ecumenical in conversation.

The site organizes around six content pillars (use these exact slugs):
- regenerative-agriculture
- conservation-environment
- built-environment
- technology-ai-transhumanism
- right-to-repair-surveillance
- tech-limited-child-rearing

You receive a transcript with speaker labels and timestamps. You return a structured analysis via the provided tool. The summary must be written in the show's voice: clear-eyed about systemic fragility, hopeful about practical community-led work, never glib. Bibliography entries should only include works that are actually mentioned or clearly referenced in the transcript — never invent citations. Pull quotes should be verbatim and self-contained.`;

async function enrichWithHaiku({ title, guest, transcriptText }) {
  // Truncate very long transcripts to stay within context (Haiku 200k context, but cost grows)
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
      // Cache the show context — the same long preamble runs 300 times.
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
  if (!res.ok) throw new Error(`anthropic ${res.status}: ${await res.text()}`);
  const j = await res.json();
  const toolUse = (j.content ?? []).find((c) => c.type === 'tool_use');
  if (!toolUse) throw new Error('Haiku did not return a tool_use block');
  return toolUse.input;
}

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

async function buildMdx({ video, number, slug, utterances, speakers, enriched, existingPath }) {
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
    `title: ${yamlString(stripEpisodePrefix(video.title))}`,
    `guest: ${yamlString(guest)}`,
    `pubDate: ${formatDate(video.upload_date ?? video.timestamp ?? new Date())}`,
    `durationSeconds: ${Math.round(video.duration ?? 0)}`,
    `pillar: ${enriched.suggestedPillar ?? 'technology-ai-transhumanism # TODO: review'}`,
    enriched.secondaryPillar ? `secondaryPillar: ${enriched.secondaryPillar}` : null,
    `summary: >-\n  ${escapeYamlMultiline(enriched.summary ?? video.title)}`,
    `youtubeId: ${video.id}`,
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
function formatDate(ymd) {
  if (typeof ymd === 'string' && /^\d{8}$/.test(ymd)) return `${ymd.slice(0,4)}-${ymd.slice(4,6)}-${ymd.slice(6,8)}`;
  if (typeof ymd === 'number') return new Date(ymd * 1000).toISOString().slice(0, 10);
  return new Date(ymd).toISOString().slice(0, 10);
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
async function ytdlp(args) {
  const { stdout } = await exec('yt-dlp', args, { maxBuffer: 200 * 1024 * 1024 });
  return stdout;
}
function log(...a) { console.log(...a); }
