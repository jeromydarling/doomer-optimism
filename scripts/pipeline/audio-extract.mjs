// Extract a clean audio track from the source video (or pass through if
// it's already audio). Uses ffmpeg. Output: 16kHz mono m4a (Scribe-friendly).

import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, statSync } from 'node:fs';
import { dirname, extname } from 'node:path';

export function extractAudio(inputPath, outputPath) {
  if (!existsSync(inputPath)) throw new Error(`Input not found: ${inputPath}`);
  mkdirSync(dirname(outputPath), { recursive: true });
  const ext = extname(inputPath).toLowerCase();
  const isAlreadyAudio = ['.m4a', '.mp3', '.wav', '.aac', '.opus', '.ogg', '.flac'].includes(ext);

  // Even if it's already audio, transcode to a normalized m4a so
  // downstream stages have a predictable format.
  const args = [
    '-y',
    '-i', inputPath,
    '-vn',
    '-ac', '1',          // mono
    '-ar', '16000',      // 16kHz (plenty for speech)
    '-c:a', 'aac',
    '-b:a', '64k',
    outputPath,
  ];
  const r = spawnSync('ffmpeg', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  if (r.status !== 0) {
    throw new Error(`ffmpeg exit ${r.status}: ${(r.stderr || '').slice(-500)}`);
  }
  const stat = statSync(outputPath);
  return { path: outputPath, sizeBytes: stat.size, wasVideo: !isAlreadyAudio };
}

export function probeDuration(audioPath) {
  const r = spawnSync('ffprobe', [
    '-v', 'error',
    '-show_entries', 'format=duration',
    '-of', 'default=noprint_wrappers=1:nokey=1',
    audioPath,
  ], { encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`ffprobe exit ${r.status}: ${r.stderr}`);
  const seconds = parseFloat((r.stdout || '0').trim());
  if (!isFinite(seconds) || seconds <= 0) throw new Error('ffprobe gave invalid duration');
  return seconds;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [input, output] = process.argv.slice(2);
  const result = extractAudio(input, output);
  const dur = probeDuration(output);
  console.log({ ...result, durationSeconds: dur });
}
