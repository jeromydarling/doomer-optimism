// Pipeline orchestrator. Walks an episode through the state machine.
// Each stage is idempotent — already-completed stages skip immediately.
//
// SIGTERM/SIGINT handler ensures the in-flight episode's state is flushed
// before exit, even on the 6h cap-kill (matches transcribe-backfill.mjs
// pattern that saved us from the second fiasco).

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  loadEpisode, saveEpisode, transition, recordError, recordCost, recordArtifact,
  STATES, ensureStateWorktree,
} from './state.mjs';
import { assertBudget, projectTranscribeCost, projectEnrichCost } from './budget-guard.mjs';
import { downloadDriveFile, getDriveMetadata } from './drive-fetch.mjs';
import { extractAudio, probeDuration } from './audio-extract.mjs';
import { enhanceSpeech } from './audio-enhance.mjs';
import { transcribeWithScribe } from './transcribe.mjs';
import { enrichTranscript } from './enrich.mjs';
import { cutClips } from './clip-cuts.mjs';
import { writeQuoteCard } from './social-graphic.mjs';

const EPISODE_ID = process.env.EPISODE_ID;
if (!EPISODE_ID) {
  console.error('EPISODE_ID env var required');
  process.exit(1);
}

ensureStateWorktree();

const TMP_DIR = join('.pipeline-tmp', EPISODE_ID);
mkdirSync(TMP_DIR, { recursive: true });

// Crash safety: flush state on signal.
let shuttingDown = false;
function shutdownFlush(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`\n━━━ Caught ${signal} — final state checkpoint ━━━`);
  try {
    const ep = loadEpisode(EPISODE_ID);
    if (ep) {
      ep.errors ||= [];
      ep.errors.push({ stage: 'shutdown', message: `Signal ${signal}`, at: new Date().toISOString() });
      saveEpisode(ep);
    }
  } catch (err) {
    console.error('Final flush failed:', err.message);
  }
  process.exit(143);
}
process.on('SIGTERM', () => shutdownFlush('SIGTERM'));
process.on('SIGINT', () => shutdownFlush('SIGINT'));

// Stage helpers ---------------------------------------------------

const STAGE_ORDER = [
  STATES.DRIVE_DETECTED,
  STATES.RAW_ARCHIVED,
  STATES.AUDIO_EXTRACTED,
  STATES.SPEECH_ENHANCED,
  STATES.TRANSCRIBED,
  STATES.ENRICHED,
  STATES.MDX_WRITTEN,
  STATES.CLIPS_CUT,
  STATES.GRAPHIC_GENERATED,
  STATES.ASSETS_BUNDLED,
  STATES.HUMAN_REVIEW,
];

function stageIndex(state) {
  const i = STAGE_ORDER.indexOf(state);
  return i === -1 ? -1 : i;
}

async function runStage(name, fn) {
  const ep = loadEpisode(EPISODE_ID);
  if (!ep) throw new Error(`Episode ${EPISODE_ID} not found in state`);
  if (ep.state === STATES.BLOCKED_NEEDS_HUMAN || ep.state === STATES.WAITING_FOR_BUDGET) {
    console.log(`  → halt (${ep.state})`);
    process.exit(0);
  }
  if (stageIndex(ep.state) >= stageIndex(name)) {
    console.log(`  ✓ ${name} (already done)`);
    return ep;
  }
  console.log(`  → ${name}`);
  try {
    await fn(ep);
    return loadEpisode(EPISODE_ID);
  } catch (err) {
    console.error(`  ✗ ${name} failed: ${err.message}`);
    recordError(EPISODE_ID, name, err);
    transition(EPISODE_ID, STATES.BLOCKED_NEEDS_HUMAN, { blockedAt: name });
    process.exit(2);
  }
}

// Stages ---------------------------------------------------------

await runStage(STATES.RAW_ARCHIVED, async (ep) => {
  const meta = await getDriveMetadata(ep.driveFileId);
  const ext = (meta.name.match(/\.[a-z0-9]+$/i) || ['.bin'])[0];
  const rawPath = join(TMP_DIR, `raw${ext}`);
  await downloadDriveFile(ep.driveFileId, rawPath);
  recordArtifact(EPISODE_ID, 'raw', rawPath);
  transition(EPISODE_ID, STATES.RAW_ARCHIVED, {
    rawPath, rawSize: meta.size, rawMime: meta.mimeType, driveFilename: meta.name,
  });
});

await runStage(STATES.AUDIO_EXTRACTED, async (ep) => {
  const audioPath = join(TMP_DIR, 'audio.m4a');
  const result = extractAudio(ep.rawPath, audioPath);
  const durationSeconds = probeDuration(audioPath);
  recordArtifact(EPISODE_ID, 'audio', audioPath);
  transition(EPISODE_ID, STATES.AUDIO_EXTRACTED, { audioPath, durationSeconds, audioSize: result.sizeBytes });
});

await runStage(STATES.SPEECH_ENHANCED, async (ep) => {
  const enhancedPath = join(TMP_DIR, 'audio-enhanced.m4a');
  const result = await enhanceSpeech(ep.audioPath, enhancedPath);
  recordArtifact(EPISODE_ID, 'audio-enhanced', enhancedPath);
  transition(EPISODE_ID, STATES.SPEECH_ENHANCED, {
    enhancedPath,
    enhanced: result.enhanced,
    enhancementNote: result.reason,
  });
});

await runStage(STATES.TRANSCRIBED, async (ep) => {
  const projection = projectTranscribeCost(ep.durationSeconds);
  const guard = await assertBudget({
    provider: 'elevenlabs',
    projectedDollars: projection.dollars,
    episode: ep,
  });
  if (!guard.ok) {
    transition(EPISODE_ID, STATES.WAITING_FOR_BUDGET, { waitingFor: 'elevenlabs', guard });
    process.exit(0);
  }
  const scribePath = join(TMP_DIR, 'transcript.scribe.json');
  const json = await transcribeWithScribe(ep.enhancedPath, { outPath: scribePath });
  recordArtifact(EPISODE_ID, 'transcript', scribePath);
  recordCost(EPISODE_ID, 'transcribe', projection.dollars, { credits: projection.credits });
  transition(EPISODE_ID, STATES.TRANSCRIBED, { scribePath });
});

await runStage(STATES.ENRICHED, async (ep) => {
  const scribeJson = JSON.parse(readFileSync(ep.scribePath, 'utf8'));
  const transcriptText = (scribeJson.text || JSON.stringify(scribeJson));
  const projection = projectEnrichCost(transcriptText.length);
  const guard = await assertBudget({
    provider: 'anthropic',
    projectedDollars: projection.dollars,
    episode: ep,
  });
  if (!guard.ok) {
    transition(EPISODE_ID, STATES.WAITING_FOR_BUDGET, { waitingFor: 'anthropic', guard });
    process.exit(0);
  }
  const enrichedPath = join(TMP_DIR, 'enriched.json');
  // We don't yet know the canonical episode title/guest — Ashley confirms
  // in /admin. Use the Drive filename as a temporary signal for Haiku.
  const enriched = await enrichTranscript(scribeJson, {
    episodeTitle: ep.driveFilename,
    guestName: '(unknown — Ashley will confirm)',
    outPath: enrichedPath,
  });
  recordArtifact(EPISODE_ID, 'enriched', enrichedPath);
  recordCost(EPISODE_ID, 'enrich', projection.dollars);
  transition(EPISODE_ID, STATES.ENRICHED, { enrichedPath, enriched });
});

await runStage(STATES.MDX_WRITTEN, async (ep) => {
  // We write a draft MDX with placeholder frontmatter. Ashley sets the
  // canonical episode number, title, and guest slug in /admin during review.
  const enriched = ep.enriched || JSON.parse(readFileSync(ep.enrichedPath, 'utf8'));
  const slug = EPISODE_ID;
  const mdxPath = join('src/content/episodes', `${slug}.mdx`);
  const front = [
    '---',
    `number: 0   # Ashley will set the episode number in /admin`,
    `title: "${(enriched.summary || '').split('\n')[0].slice(0, 80).replace(/"/g, "'") || 'Untitled draft'}"`,
    `pubDate: ${new Date().toISOString().slice(0, 10)}`,
    `durationSeconds: ${Math.round(ep.durationSeconds)}`,
    `summary: |`,
    `  ${(enriched.summary || '').replace(/\n/g, '\n  ')}`,
    `pillar: ${enriched.suggestedPillar || 'regenerative-agriculture'}`,
    enriched.suggestedSecondaryPillar ? `secondaryPillar: ${enriched.suggestedSecondaryPillar}` : null,
    `guest: ""   # Ashley will set in /admin`,
    `bibliography:`,
    ...(enriched.bibliography || []).map((b) =>
      `  - { title: "${(b.title || '').replace(/"/g, "'")}", author: "${(b.author || '').replace(/"/g, "'")}", year: ${b.year || 'null'}, kind: "${b.kind || 'other'}"${b.isbn ? `, isbn: "${b.isbn}"` : ''}${b.href ? `, href: "${b.href}"` : ''} }`),
    `draft: true`,
    `pipelineEpisodeId: ${EPISODE_ID}`,
    '---',
    '',
    '## Pull quotes',
    '',
    ...(enriched.pullQuotes || []).map((q) => `> "${q.text}" — ${q.speaker || 'Speaker'}\n`),
    '',
    '## Chapters',
    '',
    ...(enriched.chapters || []).map((c) => `- **${formatTime(c.startSeconds)}** — ${c.title}`),
  ].filter(Boolean).join('\n');
  mkdirSync('src/content/episodes', { recursive: true });
  writeFileSync(mdxPath, front);
  recordArtifact(EPISODE_ID, 'mdx', mdxPath);
  transition(EPISODE_ID, STATES.MDX_WRITTEN, { mdxPath });
});

await runStage(STATES.CLIPS_CUT, async (ep) => {
  const enriched = ep.enriched || JSON.parse(readFileSync(ep.enrichedPath, 'utf8'));
  const scribeJson = JSON.parse(readFileSync(ep.scribePath, 'utf8'));
  const cuts = cutClips(ep.audioPath, scribeJson, enriched.pullQuotes || [], join(TMP_DIR, 'clips'));
  for (const c of cuts) recordArtifact(EPISODE_ID, 'clip', c.path);
  transition(EPISODE_ID, STATES.CLIPS_CUT, { clips: cuts });
});

await runStage(STATES.GRAPHIC_GENERATED, async (ep) => {
  const enriched = ep.enriched || JSON.parse(readFileSync(ep.enrichedPath, 'utf8'));
  const topQuote = (enriched.pullQuotes || [])[0];
  if (!topQuote) {
    transition(EPISODE_ID, STATES.GRAPHIC_GENERATED, { graphicSkipped: true });
    return;
  }
  const svgPath = join(TMP_DIR, 'graphic.svg');
  writeQuoteCard(svgPath, {
    quote: topQuote.text,
    speaker: topQuote.speaker || 'Doomer Optimism',
    episodeTitle: ep.driveFilename || '',
    episodeNumber: '',
  });
  recordArtifact(EPISODE_ID, 'graphic', svgPath);
  transition(EPISODE_ID, STATES.GRAPHIC_GENERATED, { graphicPath: svgPath });
});

await runStage(STATES.ASSETS_BUNDLED, async (ep) => {
  // Manifest of everything the /admin page should fetch when rendering review.
  const manifestPath = join(TMP_DIR, 'manifest.json');
  writeFileSync(manifestPath, JSON.stringify({
    episodeId: EPISODE_ID,
    artifacts: ep.artifacts,
    durationSeconds: ep.durationSeconds,
    enriched: ep.enriched,
    mdxPath: ep.mdxPath,
    clips: ep.clips,
    graphicPath: ep.graphicPath,
    enhancementNote: ep.enhancementNote,
    costSoFar: ep.costSoFar,
  }, null, 2));
  recordArtifact(EPISODE_ID, 'manifest', manifestPath);
  transition(EPISODE_ID, STATES.ASSETS_BUNDLED, { manifestPath });
});

await runStage(STATES.HUMAN_REVIEW, async (ep) => {
  // Final transition: episode is queued in /admin awaiting Ashley's review.
  transition(EPISODE_ID, STATES.HUMAN_REVIEW, { reviewQueuedAt: new Date().toISOString() });
});

console.log(`\n✓ Episode ${EPISODE_ID} ready for human review.`);
console.log(`  Total cost: $${(loadEpisode(EPISODE_ID).costSoFar || 0).toFixed(4)}`);

function formatTime(seconds) {
  const s = Math.round(seconds || 0);
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return `${m}:${String(sec).padStart(2, '0')}`;
}
