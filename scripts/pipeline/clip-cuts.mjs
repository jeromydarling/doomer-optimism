// Pull 3-5 vertical (9:16) reel clips from the episode.
//
// Strategy: pick the strongest pull quotes from the enrichment step,
// snap to the nearest sentence boundary in the transcript, and use
// ffmpeg to cut + crop. Adobe MCP `video_create_quick_cut` would do a
// fancier job (auto reframing, captions burn-in) — left as TODO.
//
// In v1 we only cut the audio + still frame so the asset exists for
// /admin review, and Ashley can do the final video polish in CapCut /
// Adobe Express manually if desired. This avoids burning credits on
// expensive video stages until we know the format works.

import { spawnSync } from 'node:child_process';
import { mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

function findQuoteTimestamp(scribeJson, quoteText) {
  // Naive: substring match against word-level transcript.
  // Returns { startSeconds, endSeconds } or null.
  if (!scribeJson?.words) return null;
  const tokens = quoteText.toLowerCase().replace(/[^\w\s]/g, '').split(/\s+/).filter(Boolean);
  if (tokens.length < 3) return null;
  const words = scribeJson.words.map((w) => ({ ...w, normalized: (w.text || '').toLowerCase().replace(/[^\w]/g, '') }));
  for (let i = 0; i < words.length - tokens.length; i++) {
    let matched = 0;
    for (let j = 0; j < tokens.length && matched < tokens.length; j++) {
      if (words[i + j]?.normalized === tokens[j]) matched++;
      else break;
    }
    if (matched === tokens.length) {
      return {
        startSeconds: Math.max(0, words[i].start - 1.5),
        endSeconds: words[i + tokens.length - 1].end + 1.5,
      };
    }
  }
  return null;
}

export function cutClips(audioPath, scribeJson, pullQuotes, outDir) {
  mkdirSync(outDir, { recursive: true });
  const cuts = [];
  for (const [i, quote] of (pullQuotes || []).slice(0, 5).entries()) {
    const ts = findQuoteTimestamp(scribeJson, quote.text);
    if (!ts) continue;
    const out = join(outDir, `clip-${String(i + 1).padStart(2, '0')}.m4a`);
    const r = spawnSync('ffmpeg', [
      '-y',
      '-i', audioPath,
      '-ss', String(ts.startSeconds),
      '-to', String(ts.endSeconds),
      '-c:a', 'copy',
      out,
    ], { encoding: 'utf8' });
    if (r.status === 0 && existsSync(out)) {
      cuts.push({
        path: out,
        quote: quote.text,
        speaker: quote.speaker,
        startSeconds: ts.startSeconds,
        endSeconds: ts.endSeconds,
      });
    }
  }
  return cuts;
}
