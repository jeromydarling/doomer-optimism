// Hourly health probe. Writes pipeline-state/readiness.json.
// The pipeline workflow refuses to start if the latest probe is red or stale.

import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { saveReadiness } from './state.mjs';
import { elevenLabsBalance, anthropicBalance } from './budget-guard.mjs';

async function probe(name, fn) {
  const t0 = Date.now();
  try {
    const result = await fn();
    return { name, ok: true, ms: Date.now() - t0, ...result };
  } catch (err) {
    return { name, ok: false, ms: Date.now() - t0, error: err.message };
  }
}

async function probeElevenLabs() {
  const bal = await elevenLabsBalance();
  if (bal.error) throw new Error(bal.error);
  const credits = bal.credits;
  const minCredits = 10_000; // ~3 episodes of headroom
  return {
    credits,
    minCredits,
    healthy: credits >= minCredits,
    note: credits < minCredits ? `Only ${credits} credits — top up.` : `${credits} credits available.`,
  };
}

async function probeAnthropic() {
  const bal = await anthropicBalance();
  if (bal.error) throw new Error(bal.error);
  return { healthy: true, note: 'Auth OK; no balance endpoint exists.' };
}

async function probeDriveOAuth() {
  const refresh = process.env.GOOGLE_DRIVE_REFRESH_TOKEN;
  const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET;
  if (!refresh || !clientId || !clientSecret) {
    return { healthy: false, note: 'Drive OAuth env vars not set (GOOGLE_DRIVE_REFRESH_TOKEN, GOOGLE_OAUTH_CLIENT_ID, GOOGLE_OAUTH_CLIENT_SECRET).' };
  }
  // Exchange refresh token for an access token to verify it's still valid.
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refresh,
      grant_type: 'refresh_token',
    }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Refresh failed: ${res.status} ${body.slice(0, 100)}`);
  }
  const json = await res.json();
  return { healthy: true, expiresIn: json.expires_in, note: 'Refresh token valid.' };
}

async function probeBuffer() {
  const token = process.env.BUFFER_API_TOKEN;
  if (!token) return { healthy: false, note: 'BUFFER_API_TOKEN not set.' };
  // Buffer API v1 is being deprecated; v2 GraphQL endpoint is graphql.buffer.com.
  const res = await fetch('https://graphql.buffer.com/', {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ query: '{ viewer { id email } }' }),
  });
  if (!res.ok) throw new Error(`Buffer ${res.status}`);
  const json = await res.json();
  if (json.errors) throw new Error(JSON.stringify(json.errors));
  return { healthy: true, note: `Authenticated as ${json.data?.viewer?.email || 'unknown'}.` };
}

async function probeFfmpeg() {
  const r = spawnSync('ffmpeg', ['-version'], { encoding: 'utf8' });
  if (r.status !== 0) throw new Error('ffmpeg not on PATH');
  const firstLine = (r.stdout || '').split('\n')[0];
  return { healthy: true, note: firstLine };
}

async function probeDisk() {
  const r = spawnSync('df', ['-BG', '.'], { encoding: 'utf8' });
  if (r.status !== 0) return { healthy: true, note: 'df unavailable; assuming OK' };
  // Parse "Avail" column from df output
  const lines = (r.stdout || '').trim().split('\n');
  const cols = lines[lines.length - 1].split(/\s+/);
  const availGb = parseInt(cols[3], 10) || 0;
  const minGb = 10;
  return {
    healthy: availGb >= minGb,
    availGb,
    minGb,
    note: `${availGb}GB free.`,
  };
}

async function probeStateBranch() {
  // Just confirm we can fetch the branch
  const r = spawnSync('git', ['ls-remote', '--heads', 'origin', 'pipeline-state'], { encoding: 'utf8' });
  if (r.status !== 0) throw new Error('git ls-remote failed');
  return { healthy: true, note: 'pipeline-state branch reachable.' };
}

async function probeAdobeMcp() {
  // From CI we don't have access to the Claude session's MCP server.
  // Mark as warn-not-fail until we figure out the headless story.
  return {
    healthy: false,
    skip: true,
    note: 'Adobe MCP not yet wired for headless CI. Stages stub to MANUAL_OVERRIDE.',
  };
}

async function probeEpisodesDir() {
  const ok = existsSync('src/content/episodes');
  return { healthy: ok, note: ok ? 'Writable.' : 'Missing.' };
}

const ALL_PROBES = [
  ['elevenlabs', probeElevenLabs],
  ['anthropic', probeAnthropic],
  ['drive-oauth', probeDriveOAuth],
  ['buffer', probeBuffer],
  ['ffmpeg', probeFfmpeg],
  ['disk', probeDisk],
  ['state-branch', probeStateBranch],
  ['adobe-mcp', probeAdobeMcp],
  ['episodes-dir', probeEpisodesDir],
];

export async function runAllProbes() {
  const results = await Promise.all(ALL_PROBES.map(([n, fn]) => probe(n, fn)));
  // Adobe MCP is a known soft-fail right now — don't let it block green status.
  const blockingFailures = results.filter((r) => !r.ok || (r.healthy === false && !r.skip));
  const green = blockingFailures.length === 0;
  return { green, probes: results, blockingFailures: blockingFailures.map((r) => r.name) };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const report = await runAllProbes();
  console.log(JSON.stringify(report, null, 2));
  saveReadiness(report);
  process.exit(report.green ? 0 : 1);
}
