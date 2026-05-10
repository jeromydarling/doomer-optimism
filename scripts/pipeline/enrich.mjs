// Haiku 4.5 enrichment: chapters, key topics, bibliography, suggested
// pillar, summary, pull quotes — all in one structured-output call.
//
// The full backfill script (scripts/transcribe-backfill.mjs) has the
// battle-tested version; this is a slimmer pipeline-specific entry point
// that takes a transcript JSON and an episode metadata blob.

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

const PILLARS = [
  'regenerative-agriculture',
  'conservation-environment',
  'built-environment',
  'technology-ai-transhumanism',
  'right-to-repair-surveillance',
  'tech-limited-child-rearing',
];

function transcriptToText(scribeJson) {
  if (!scribeJson?.words) return '';
  // Build a speaker-labeled transcript
  const lines = [];
  let currentSpeaker = null;
  let currentLine = [];
  for (const w of scribeJson.words) {
    const sp = w.speaker_id || 'unknown';
    if (sp !== currentSpeaker) {
      if (currentLine.length) lines.push(`${currentSpeaker}: ${currentLine.join(' ')}`);
      currentSpeaker = sp;
      currentLine = [];
    }
    if (w.text) currentLine.push(w.text);
  }
  if (currentLine.length) lines.push(`${currentSpeaker}: ${currentLine.join(' ')}`);
  return lines.join('\n');
}

export async function enrichTranscript(scribeJson, { episodeTitle, guestName, outPath } = {}) {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) throw new Error('ANTHROPIC_API_KEY not set');

  const transcriptText = transcriptToText(scribeJson);
  const truncated = transcriptText.slice(0, 80_000); // ~20k tokens; episodes rarely exceed

  const prompt = `You are enriching a podcast transcript for "Doomer Optimism" hosted by Ashley Colby Fitzgerald.
Episode title: ${episodeTitle || '(unknown)'}
Guest: ${guestName || '(unknown)'}

Pillars (pick the best fit):
${PILLARS.map((p) => `  - ${p}`).join('\n')}

Output STRICT JSON (no prose) with this schema:
{
  "summary": "1-2 paragraph editorial summary",
  "chapters": [{ "startSeconds": int, "title": "..." }, ...],
  "topics": ["topic 1", "topic 2", ...],
  "bibliography": [{ "title": "...", "author": "...", "year": int|null, "kind": "book|article|film|other", "isbn": "...", "href": "..." }, ...],
  "pullQuotes": [{ "speaker": "Ashley|guest", "text": "..." }, ...],
  "suggestedPillar": "one of the pillar slugs above",
  "suggestedSecondaryPillar": "one of the pillar slugs or null"
}

Transcript:
${truncated}`;

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': key,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 4096,
      messages: [{ role: 'user', content: prompt }],
    }),
  });
  if (!res.ok) throw new Error(`Anthropic ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const json = await res.json();
  const text = json?.content?.[0]?.text || '';
  // Extract JSON (Haiku sometimes wraps in ```json ... ```)
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) throw new Error(`Haiku returned non-JSON: ${text.slice(0, 200)}`);
  const enriched = JSON.parse(match[0]);

  if (outPath) {
    mkdirSync(dirname(outPath), { recursive: true });
    writeFileSync(outPath, JSON.stringify(enriched, null, 2));
  }
  return enriched;
}
