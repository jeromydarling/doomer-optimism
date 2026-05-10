// Allocate an episode ID and write the initial DRIVE_DETECTED state file.
//
// Inputs (env): EVENT_PAYLOAD (JSON from repository_dispatch) or
//               INPUT_DRIVE_FILE_ID + INPUT_NAME (from workflow_dispatch).
//
// Output: writes `episode_id=<id>` to GITHUB_OUTPUT.
//
// Episode ID format: ep-YYYYMMDD-{slug-from-name-or-driveid}
//   e.g. ep-20260510-zoom-recording-2026-05-10-acf-paul-kingsnorth
// We don't try to assign sequential episode numbers here — that's a /admin
// concern (Ashley confirms or edits during HUMAN_REVIEW).

import { appendFileSync } from 'node:fs';
import { transition, STATES } from './state.mjs';

function parsePayload() {
  const raw = process.env.EVENT_PAYLOAD;
  if (raw && raw !== 'null') {
    try {
      const p = JSON.parse(raw);
      if (p?.driveFileId) return { driveFileId: p.driveFileId, name: p.name || p.driveFileId };
    } catch {}
  }
  const id = process.env.INPUT_DRIVE_FILE_ID;
  if (id) return { driveFileId: id, name: process.env.INPUT_NAME || id };
  throw new Error('No driveFileId in payload or inputs.');
}

function slugify(s) {
  return String(s)
    .toLowerCase()
    .replace(/\.[a-z0-9]+$/i, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
}

const { driveFileId, name } = parsePayload();
const today = new Date().toISOString().slice(0, 10).replace(/-/g, '');
const episodeId = `ep-${today}-${slugify(name) || slugify(driveFileId)}`;

console.log(`Ingest: ${episodeId}`);
console.log(`  driveFileId=${driveFileId}`);
console.log(`  name=${name}`);

transition(episodeId, STATES.DRIVE_DETECTED, {
  driveFileId,
  driveFilename: name,
  detectedAt: new Date().toISOString(),
  errors: [],
  artifacts: [],
  costSoFar: 0,
});

if (process.env.GITHUB_OUTPUT) {
  appendFileSync(process.env.GITHUB_OUTPUT, `episode_id=${episodeId}\n`);
}
console.log(`State initialized: DRIVE_DETECTED`);
