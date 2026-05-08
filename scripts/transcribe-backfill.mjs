#!/usr/bin/env node
/**
 * scripts/transcribe-backfill.mjs
 *
 * Pulls the Doomer Optimism YouTube channel, transcribes each episode via
 * AssemblyAI (Best tier, with diarization + auto-chapters), and emits MDX
 * files into src/content/episodes/. Idempotent — cached results in
 * .transcripts/ are reused on rerun.
 *
 * Usage:
 *   ASSEMBLYAI_API_KEY=... node scripts/transcribe-backfill.mjs \
 *     --channel "https://www.youtube.com/@doomeroptimism" \
 *     --max 300 \
 *     [--dry-run]                # list videos, don't transcribe
 *     [--only=<videoId>]         # process a single episode
 *
 * Designed to run in GitHub Actions; will work locally too if yt-dlp + ffmpeg
 * are on PATH and the API key is set.
 */

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, readFile, writeFile, access } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';

const exec = promisify(execFile);

const args = parseArgs(process.argv.slice(2));
const CHANNEL = args.channel ?? 'https://www.youtube.com/@doomeroptimism';
const MAX = Number(args.max ?? 500);
const DRY = !!args['dry-run'];
const ONLY = args.only ?? null;
const API_KEY = process.env.ASSEMBLYAI_API_KEY;

if (!DRY && !API_KEY) {
  console.error('ASSEMBLYAI_API_KEY env var is required (unless --dry-run).');
  process.exit(1);
}

const ROOT = process.cwd();
const CACHE_DIR = join(ROOT, '.transcripts');
const AUDIO_DIR = join(ROOT, '.transcripts', 'audio');
const EPISODES_DIR = join(ROOT, 'src', 'content', 'episodes');
await mkdir(CACHE_DIR, { recursive: true });
await mkdir(AUDIO_DIR, { recursive: true });

// ---- Step 1: enumerate the channel via yt-dlp -----------------------------------
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

// Existing episode files — we preserve hand-curated frontmatter
const existing = await loadExistingEpisodes();

const results = [];
for (const v of videos) {
  try {
    const r = await processVideo(v);
    results.push(r);
  } catch (err) {
    log(`  ✖ ${v.id}: ${err.message}`);
    results.push({ id: v.id, title: v.title, error: err.message });
  }
}

// ---- Summary report -------------------------------------------------------------
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

  // 1. Download audio (cached)
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

  // 2. AssemblyAI transcript (cached)
  const txPath = join(CACHE_DIR, `${v.id}.json`);
  let transcript;
  if (existsSync(txPath)) {
    transcript = JSON.parse(await readFile(txPath, 'utf8'));
    log('  • transcript cached');
  } else {
    log('  • uploading to AssemblyAI…');
    const uploadUrl = await aaiUpload(audioPath);
    log('  • requesting transcription…');
    transcript = await aaiTranscribe(uploadUrl);
    await writeFile(txPath, JSON.stringify(transcript, null, 2));
    log('  • transcript saved');
  }

  // 3. Build MDX (preserves hand-curated frontmatter when present)
  const guestFromTitle = extractGuestName(v.title);
  const speakers = mapSpeakers(transcript, guestFromTitle);
  const mdx = await buildMdx({
    video: v,
    number,
    slug,
    transcript,
    speakers,
    existingPath: existing.byNumber.get(number) ?? existing.bySlug.get(slug) ?? null,
  });
  await writeFile(outMdxPath, mdx);
  log(`  ✓ wrote ${outMdxPath}`);

  return { id: v.id, title: v.title, number, path: outMdxPath };
}

// ---- yt-dlp wrapper -------------------------------------------------------------
async function ytdlp(args) {
  const { stdout } = await exec('yt-dlp', args, { maxBuffer: 200 * 1024 * 1024 });
  return stdout;
}

// ---- AssemblyAI client ----------------------------------------------------------
const AAI = 'https://api.assemblyai.com/v2';
async function aaiUpload(filePath) {
  const data = await readFile(filePath);
  const res = await fetch(`${AAI}/upload`, {
    method: 'POST',
    headers: { Authorization: API_KEY, 'Transfer-Encoding': 'chunked' },
    body: data,
  });
  if (!res.ok) throw new Error(`upload failed: ${res.status} ${await res.text()}`);
  const j = await res.json();
  return j.upload_url;
}

async function aaiTranscribe(audioUrl) {
  const res = await fetch(`${AAI}/transcript`, {
    method: 'POST',
    headers: { Authorization: API_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      audio_url: audioUrl,
      speech_model: 'best',
      speaker_labels: true,
      auto_chapters: true,
      iab_categories: true,
      punctuate: true,
      format_text: true,
      language_code: 'en',
    }),
  });
  if (!res.ok) throw new Error(`transcript create failed: ${res.status}`);
  const { id } = await res.json();
  // Poll
  for (let i = 0; i < 600; i++) {
    await sleep(5000);
    const p = await fetch(`${AAI}/transcript/${id}`, { headers: { Authorization: API_KEY } });
    const j = await p.json();
    if (j.status === 'completed') return j;
    if (j.status === 'error') throw new Error(`AAI: ${j.error}`);
  }
  throw new Error('transcription timed out');
}

// ---- Helpers --------------------------------------------------------------------
function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const eq = a.indexOf('=');
      if (eq >= 0) out[a.slice(2, eq)] = a.slice(eq + 1);
      else if (argv[i + 1] && !argv[i + 1].startsWith('--')) {
        out[a.slice(2)] = argv[++i];
      } else out[a.slice(2)] = true;
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
  // Patterns like "Episode 296 - Peter Allen on …" or "DO 96 - Inez Stepman w/ Ashley"
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
    const entries = await (await import('node:fs/promises')).readdir(EPISODES_DIR);
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

function mapSpeakers(transcript, guestName) {
  // Sum speaking time per speaker label (A, B, C, …)
  const utt = transcript.utterances ?? [];
  const totals = new Map();
  for (const u of utt) {
    totals.set(u.speaker, (totals.get(u.speaker) ?? 0) + (u.end - u.start));
  }
  const ranked = [...totals.entries()].sort((a, b) => b[1] - a[1]);
  const map = {};
  ranked.forEach(([label], i) => {
    if (i === 0) map[label] = 'Ashley Colby Fitzgerald';
    else if (i === 1 && guestName) map[label] = guestName;
    else map[label] = `Speaker ${label}`;
  });
  return map;
}

async function buildMdx({ video, number, slug, transcript, speakers, existingPath }) {
  const utterances = transcript.utterances ?? [];
  const chapters = transcript.chapters ?? [];
  const summary = transcript.summary ?? '';

  // Build the readable transcript body
  const transcriptBody = utterances
    .map((u) => {
      const ts = formatTimestamp(u.start);
      const name = speakers[u.speaker] ?? `Speaker ${u.speaker}`;
      return `**${name}** (${ts})\n\n${u.text.trim()}`;
    })
    .join('\n\n');

  // Chapters → bibliography seeds (we'll let the human curate, just surface chapter titles)
  const chaptersBlock = chapters.length
    ? '\n## Chapters\n\n' + chapters.map((c) => `- **${formatTimestamp(c.start)}** — ${c.headline}`).join('\n') + '\n'
    : '';

  // Try to preserve the existing curated frontmatter when we have one
  if (existingPath && existsSync(existingPath)) {
    const raw = await readFile(existingPath, 'utf8');
    const { frontmatter, body } = splitFrontmatter(raw);
    // Only update transcript; only inject chapters if not already there
    const newFrontmatter = upsertFrontmatterField(frontmatter, 'transcript', `|\n  ${escapeYaml(summarizeForFrontmatter(transcriptBody))}`);
    const newBody = ensureTranscriptSection(body, transcriptBody, chaptersBlock);
    return `---\n${newFrontmatter}\n---\n${newBody}`;
  }

  // New file — fresh frontmatter
  const guest = speakers['B'] ?? speakers['A'] ?? 'Unknown Guest';
  const fm = [
    `number: ${number ?? '# TODO: assign episode number'}`,
    `title: ${yamlString(stripEpisodePrefix(video.title))}`,
    `guest: ${yamlString(guest)}`,
    `pubDate: ${formatDate(video.upload_date ?? video.timestamp ?? new Date())}`,
    `durationSeconds: ${Math.round(video.duration ?? 0)}`,
    `pillar: technology-ai-transhumanism # TODO: assign correct pillar`,
    `summary: >-\n  ${yamlMultiline(summary || video.title)}`,
    `youtubeId: ${video.id}`,
    `bibliography: []`,
    `draft: true`,
  ].join('\n');

  return `---\n${fm}\n---\n\n## Summary\n\n${summary || '*Auto-generated from chapters; please edit before publishing.*'}\n${chaptersBlock}\n## Transcript\n\n${transcriptBody}\n`;
}

function ensureTranscriptSection(body, transcriptBody, chaptersBlock) {
  if (body.includes('## Transcript')) return body; // already present, leave alone
  return `${body.trim()}\n${chaptersBlock}\n## Transcript\n\n${transcriptBody}\n`;
}

function splitFrontmatter(raw) {
  const m = raw.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!m) return { frontmatter: '', body: raw };
  return { frontmatter: m[1], body: m[2] };
}

function upsertFrontmatterField(fm, key, value) {
  const re = new RegExp(`^${key}:.*$`, 'm');
  return re.test(fm) ? fm : `${fm}\n${key}: ${value}`;
}

function summarizeForFrontmatter() {
  // We don't actually inline the full transcript into frontmatter — the body holds it.
  // This stub exists for symmetry; returning empty disables the field write.
  return '';
}

function escapeYaml(s) { return String(s).replace(/\n/g, '\n  '); }
function yamlString(s) { return JSON.stringify(String(s ?? '').replace(/\s+/g, ' ').trim()); }
function yamlMultiline(s) { return String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, 500); }
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
function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }
function log(...a) { console.log(...a); }
