// /admin Approve handler. Triggered as workflow_dispatch from the admin
// page using Ashley's GitHub OAuth token.
//
// Inputs (env): EPISODE_ID, CAPTION, SCHEDULED_AT, CHANNELS
//
// Steps:
//  1. Verify state == HUMAN_REVIEW (refuse if not — stale request)
//  2. POST scheduled posts to Buffer (one per channel)
//  3. Flip MDX `draft: false`, commit + push to main
//  4. Transition state → BUFFER_QUEUED → PUBLISHED

import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import {
  loadEpisode, transition, recordError, recordArtifact, STATES, ensureStateWorktree,
} from './state.mjs';
import { listChannels, pickChannelIds, schedulePost, stagger } from './buffer-queue.mjs';

const { EPISODE_ID, CAPTION, SCHEDULED_AT, CHANNELS = 'instagram,threads,twitter,linkedin' } = process.env;
if (!EPISODE_ID || !CAPTION || !SCHEDULED_AT) {
  console.error('EPISODE_ID, CAPTION, SCHEDULED_AT required');
  process.exit(1);
}

ensureStateWorktree();

const ep = loadEpisode(EPISODE_ID);
if (!ep) {
  console.error(`Episode ${EPISODE_ID} not found in state.`);
  process.exit(1);
}
if (ep.state !== STATES.HUMAN_REVIEW) {
  console.error(`Episode ${EPISODE_ID} state is ${ep.state}, not HUMAN_REVIEW. Refusing.`);
  process.exit(1);
}

// 1. Schedule Buffer posts
const requestedAliases = CHANNELS.split(',').map((s) => s.trim()).filter(Boolean);
let queued = [];
try {
  const channels = await listChannels();
  const targets = pickChannelIds(channels, requestedAliases);
  if (!targets.length) {
    console.error('No matching Buffer channels found. Confirm channels are connected on Buffer Essentials.');
    transition(EPISODE_ID, STATES.BLOCKED_NEEDS_HUMAN, { blockedAt: 'buffer-channels' });
    process.exit(2);
  }
  const times = stagger(SCHEDULED_AT, targets.length);
  for (let i = 0; i < targets.length; i++) {
    const target = targets[i];
    const result = await schedulePost({
      channelId: target.channelId,
      text: CAPTION,
      scheduledAt: times[i],
      // V1: no media attachment yet (Ashley downloads clip + uploads to YT/IG manually)
    });
    queued.push({ alias: target.alias, channelId: target.channelId, scheduledAt: times[i], result });
    console.log(`  ✓ ${target.alias} scheduled for ${times[i]}`);
  }
  transition(EPISODE_ID, STATES.BUFFER_QUEUED, { queued });
} catch (err) {
  console.error(`Buffer scheduling failed: ${err.message}`);
  recordError(EPISODE_ID, 'buffer-queue', err);
  transition(EPISODE_ID, STATES.BLOCKED_NEEDS_HUMAN, { blockedAt: 'buffer-queue' });
  process.exit(2);
}

// 2. Flip MDX draft: false on main
if (ep.mdxPath && existsSync(ep.mdxPath)) {
  const text = readFileSync(ep.mdxPath, 'utf8');
  const flipped = text.replace(/^draft: true$/m, 'draft: false');
  if (flipped !== text) {
    writeFileSync(ep.mdxPath, flipped);
    spawnSync('git', ['add', ep.mdxPath]);
    spawnSync('git', ['-c', 'user.name=pipeline-bot', '-c', 'user.email=bot@doomer.local',
      'commit', '-m', `Publish ${EPISODE_ID}: flip draft → false`]);
    for (let attempt = 1; attempt <= 5; attempt++) {
      const push = spawnSync('git', ['push', 'origin', 'HEAD:main']);
      if (push.status === 0) break;
      spawnSync('git', ['fetch', 'origin', 'main']);
      spawnSync('git', ['rebase', '--autostash', 'origin/main']);
    }
  }
}

transition(EPISODE_ID, STATES.PUBLISHED, { publishedAt: new Date().toISOString(), queuedPosts: queued });
console.log(`\n✓ Episode ${EPISODE_ID} published.`);
