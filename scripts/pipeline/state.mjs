// Episode state machine — single source of truth for pipeline progress.
//
// State lives on the `pipeline-state` branch as JSON files:
//   pipeline-state/episodes/{episodeId}.json
//   pipeline-state/readiness.json
//
// Every read goes through `loadEpisode`, every write through `saveEpisode`.
// Saves are atomic: write → git add → git commit → git push, with retries.
// On push race (someone else updated the branch), we fetch+rebase+retry.
//
// Locally (no GITHUB_ACTIONS env var) we still write to the local branch
// checkout but don't push. Useful for dry-runs.

import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';

export const STATES = Object.freeze({
  DRIVE_DETECTED: 'DRIVE_DETECTED',
  RAW_ARCHIVED: 'RAW_ARCHIVED',
  AUDIO_EXTRACTED: 'AUDIO_EXTRACTED',
  SPEECH_ENHANCED: 'SPEECH_ENHANCED',
  TRANSCRIBED: 'TRANSCRIBED',
  ENRICHED: 'ENRICHED',
  MDX_WRITTEN: 'MDX_WRITTEN',
  CLIPS_CUT: 'CLIPS_CUT',
  GRAPHIC_GENERATED: 'GRAPHIC_GENERATED',
  ASSETS_BUNDLED: 'ASSETS_BUNDLED',
  HUMAN_REVIEW: 'HUMAN_REVIEW',
  BUFFER_QUEUED: 'BUFFER_QUEUED',
  PUBLISHED: 'PUBLISHED',
  WAITING_FOR_BUDGET: 'WAITING_FOR_BUDGET',
  BLOCKED_NEEDS_HUMAN: 'BLOCKED_NEEDS_HUMAN',
  MANUAL_OVERRIDE: 'MANUAL_OVERRIDE',
});

const TERMINAL_OK = new Set([STATES.PUBLISHED]);
const TERMINAL_BLOCKED = new Set([STATES.BLOCKED_NEEDS_HUMAN]);

const STATE_BRANCH = 'pipeline-state';
const STATE_DIR = '.pipeline-state'; // local working dir for the worktree
const EPISODES_SUBDIR = 'episodes';
const READINESS_FILE = 'readiness.json';

function git(args, opts = {}) {
  return spawnSync('git', args, { encoding: 'utf8', timeout: 60_000, ...opts });
}

function inCi() {
  return !!process.env.GITHUB_ACTIONS;
}

// Use a separate git worktree pinned to the pipeline-state branch so we can
// read/write state without disturbing the working tree of the main checkout.
// Idempotent: if the worktree already exists we just use it.
export function ensureStateWorktree() {
  if (existsSync(STATE_DIR) && existsSync(join(STATE_DIR, '.git'))) {
    // Already set up. Pull latest.
    if (inCi()) {
      git(['fetch', 'origin', STATE_BRANCH], { cwd: STATE_DIR });
      git(['reset', '--hard', `origin/${STATE_BRANCH}`], { cwd: STATE_DIR });
    }
    return STATE_DIR;
  }
  // Fetch the branch (creates it if missing on remote)
  const ls = git(['ls-remote', '--heads', 'origin', STATE_BRANCH]);
  const remoteExists = (ls.stdout || '').trim().length > 0;
  if (remoteExists) {
    git(['fetch', 'origin', STATE_BRANCH]);
    git(['worktree', 'add', '-B', STATE_BRANCH, STATE_DIR, `origin/${STATE_BRANCH}`]);
  } else {
    // Initialize an orphan branch with no shared history.
    git(['worktree', 'add', '--detach', STATE_DIR, 'HEAD']);
    git(['checkout', '--orphan', STATE_BRANCH], { cwd: STATE_DIR });
    git(['rm', '-rf', '.'], { cwd: STATE_DIR });
    mkdirSync(join(STATE_DIR, EPISODES_SUBDIR), { recursive: true });
    writeFileSync(join(STATE_DIR, 'README.md'),
      '# Pipeline state\n\nMachine-managed. Do not hand-edit.\n');
    git(['add', '.'], { cwd: STATE_DIR });
    git(['-c', 'user.name=pipeline-bot', '-c', 'user.email=bot@doomer.local',
         'commit', '-m', 'init pipeline-state branch'], { cwd: STATE_DIR });
    if (inCi()) {
      git(['push', '-u', 'origin', STATE_BRANCH], { cwd: STATE_DIR });
    }
  }
  return STATE_DIR;
}

function episodePath(episodeId) {
  return join(STATE_DIR, EPISODES_SUBDIR, `${episodeId}.json`);
}

export function loadEpisode(episodeId) {
  ensureStateWorktree();
  const p = episodePath(episodeId);
  if (!existsSync(p)) return null;
  return JSON.parse(readFileSync(p, 'utf8'));
}

export function listEpisodes(filter = () => true) {
  ensureStateWorktree();
  const dir = join(STATE_DIR, EPISODES_SUBDIR);
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .map((f) => JSON.parse(readFileSync(join(dir, f), 'utf8')))
    .filter(filter);
}

// Save with optimistic concurrency: write → commit → push → on conflict, fetch+rebase, retry.
export function saveEpisode(episode) {
  ensureStateWorktree();
  const p = episodePath(episode.id);
  mkdirSync(dirname(p), { recursive: true });
  episode.lastTransitionAt = new Date().toISOString();
  writeFileSync(p, JSON.stringify(episode, null, 2) + '\n');
  if (!inCi()) return; // local mode: don't push
  commitAndPush(`state: ${episode.id} → ${episode.state}`);
}

export function transition(episodeId, nextState, patch = {}) {
  const ep = loadEpisode(episodeId) || { id: episodeId, attempts: {}, errors: [], artifacts: [], costSoFar: 0 };
  ep.state = nextState;
  ep.attempts ||= {};
  ep.attempts[nextState] = (ep.attempts[nextState] || 0) + 1;
  Object.assign(ep, patch);
  saveEpisode(ep);
  return ep;
}

export function recordError(episodeId, stage, error) {
  const ep = loadEpisode(episodeId) || { id: episodeId, errors: [], artifacts: [], costSoFar: 0 };
  ep.errors ||= [];
  ep.errors.push({
    stage,
    message: error?.message || String(error),
    at: new Date().toISOString(),
  });
  saveEpisode(ep);
}

export function recordCost(episodeId, stage, dollars, meta = {}) {
  const ep = loadEpisode(episodeId);
  if (!ep) return;
  ep.costSoFar = (ep.costSoFar || 0) + dollars;
  ep.costs ||= [];
  ep.costs.push({ stage, dollars, at: new Date().toISOString(), ...meta });
  saveEpisode(ep);
}

export function recordArtifact(episodeId, kind, ref) {
  const ep = loadEpisode(episodeId);
  if (!ep) return;
  ep.artifacts ||= [];
  ep.artifacts.push({ kind, ref, at: new Date().toISOString() });
  saveEpisode(ep);
}

function commitAndPush(message) {
  const cwd = STATE_DIR;
  git(['add', '.'], { cwd });
  const diff = git(['diff', '--cached', '--quiet'], { cwd });
  if (diff.status === 0) return; // nothing to commit
  const commit = git(['-c', 'user.name=pipeline-bot', '-c', 'user.email=bot@doomer.local',
                      'commit', '-m', message, '--quiet'], { cwd });
  if (commit.status !== 0) return;
  for (let attempt = 1; attempt <= 5; attempt++) {
    const push = git(['push', 'origin', STATE_BRANCH], { cwd });
    if (push.status === 0) return;
    git(['fetch', 'origin', STATE_BRANCH], { cwd });
    git(['rebase', '--autostash', `origin/${STATE_BRANCH}`], { cwd });
    // Backoff: 1s, 2s, 4s, 8s, 16s
    const ms = 1000 * 2 ** (attempt - 1);
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
  }
  throw new Error(`Failed to push pipeline state after 5 attempts: ${message}`);
}

// Readiness probe storage
export function loadReadiness() {
  ensureStateWorktree();
  const p = join(STATE_DIR, READINESS_FILE);
  if (!existsSync(p)) return null;
  return JSON.parse(readFileSync(p, 'utf8'));
}

export function saveReadiness(report) {
  ensureStateWorktree();
  const p = join(STATE_DIR, READINESS_FILE);
  report.at = new Date().toISOString();
  writeFileSync(p, JSON.stringify(report, null, 2) + '\n');
  if (!inCi()) return;
  commitAndPush(`readiness: ${report.green ? 'green' : 'red'}`);
}

export function isTerminal(state) {
  return TERMINAL_OK.has(state) || TERMINAL_BLOCKED.has(state);
}

export function isHealthy(report) {
  if (!report) return false;
  if (!report.green) return false;
  const ageMs = Date.now() - new Date(report.at).getTime();
  return ageMs < 2 * 60 * 60 * 1000; // <2h old
}
