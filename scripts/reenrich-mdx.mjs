// Regenerate summary / chapters / bibliography / pull quotes for one or
// more episode MDX files using Haiku. Reads the transcript out of the
// `## Transcript` body section and the title/guest/pillar from frontmatter,
// then asks Haiku to produce a clean editorial summary in the guest's
// voice (NOT Ashley-as-protagonist), an outline of chapters, a small
// bibliography, and 2–3 pull quotes.
//
// Used by .github/workflows/reenrich-episodes.yml after a placeholder
// rewrite to backfill summaries against the now-correct metadata.
//
// Usage: node scripts/reenrich-mdx.mjs <file1> <file2> ...
//   Or:  node scripts/reenrich-mdx.mjs --all-pending
//        (any episode whose summary starts with '[Pending re-enrichment')

import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import yaml from 'js-yaml';

const EPISODES_DIR = 'src/content/episodes';
const PILLAR_SLUGS = [
  'regenerative-agriculture',
  'conservation-environment',
  'built-environment',
  'technology-ai-transhumanism',
  'right-to-repair-surveillance',
  'tech-limited-child-rearing',
];

function splitFrontmatter(text) {
  const m = text.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!m) return null;
  return { fm: m[1], body: m[2] };
}

function extractTranscriptText(body) {
  const idx = body.indexOf('## Transcript');
  if (idx === -1) return '';
  const txt = body.slice(idx + '## Transcript'.length);
  // Strip speaker tags + timestamps to give Haiku cleaner prose
  return txt
    .replace(/\*\*[^*]+\*\*\s*\(\d+:\d+\)\s*\n+/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
    .slice(0, 80_000); // ~20k tokens — well within Haiku context
}

async function callHaiku(transcript, fm) {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) throw new Error('ANTHROPIC_API_KEY missing');

  const prompt = `You are enriching a podcast episode for "Doomer Optimism" (host: Ashley Colby Fitzgerald).

Episode title: ${fm.title}
Guest (per Anchor RSS): ${fm.guest || '(unspecified)'}
Pillar (currently set): ${fm.pillar}
Episode duration: ${fm.durationSeconds || '(unknown)'} seconds${fm.durationSeconds ? ` (${Math.floor(fm.durationSeconds / 60)}:${String(fm.durationSeconds % 60).padStart(2, '0')})` : ''}

Pillars available (pick the most accurate primary; only set a secondary when the
episode genuinely spans two pillars at roughly equal weight — DO NOT add a
secondary pillar just because one was briefly mentioned):
${PILLAR_SLUGS.map((p) => `  - ${p}`).join('\n')}

Voice: write the summary in GUEST-CENTRIC voice. Don't say "Ashley
explores X" or "Ashley journeys to Y" — Ashley is the host, not the
protagonist. The substantive content is the GUEST's work, perspective,
journey. If multiple guests, name them; if the episode is a panel of
internal hosts (e.g. "with Ashley, Jason, and James") describe what
the panel covers.

CRITICAL chapter rules (Haiku has hallucinated past the actual episode
duration in the past — these rules exist to prevent that):
- Every chapter's startSeconds MUST be < the episode duration above.
- Chapters are sequential; each startSeconds must be > the previous one.
- 6-12 chapters total is the right density for a 30-90 minute episode.
- The LAST chapter should start no later than (duration - 120) seconds.
- If you're unsure about a timestamp, prefer fewer chapters over inventing one.

CRITICAL grounding rules — the transcript is the ONLY source of truth:
- Every person's name, organization, book title, year, and URL in the
  summary or bibliography MUST appear verbatim in the transcript.
  Don't supplement from outside knowledge. Examples of recent misses:
  - Guest said "Pope Leo's encyclical" → bibliography author is Pope Leo,
    NOT Pope Francis (regardless of who you remember as the Pope).
  - Guest mentioned a book without a year → leave year null. Don't infer.
  - Guest mentioned an organization without a URL → leave href null.
- If a detail (year, ISBN, URL, middle name, affiliation) isn't stated
  in the transcript, omit the field entirely. Empty/null is correct.
- Spell guest and author names exactly as they appear in the transcript's
  speaker tags or in the guest's own self-introduction.

Output STRICT JSON only — no prose, no markdown fences:

{
  "summary": "2-3 paragraphs, editorial voice, guest-centric",
  "chapters": [{ "startSeconds": <int, less than episode duration>, "title": "<title>" }, ...],
  "topics": ["topic 1", "topic 2", ...],
  "bibliography": [
    { "title": "...", "author": "...", "year": <int|null>, "kind": "book|article|paper|film|podcast|site", "isbn": "...", "href": "..." }
  ],
  "pullQuotes": [{ "speaker": "<name>", "text": "..." }, ...],
  "suggestedPillar": "<pillar slug from list above>",
  "suggestedSecondaryPillar": "<pillar slug or null — leave null if the secondary fit is weak>"
}

Transcript follows. (Speaker tags removed; this is plain prose.)

${transcript}`;

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
  if (!res.ok) throw new Error(`Anthropic ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const json = await res.json();
  const text = json?.content?.[0]?.text || '';
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) throw new Error(`Haiku returned non-JSON: ${text.slice(0, 200)}`);
  return JSON.parse(match[0]);
}

function fmt(seconds) {
  const s = Math.round(seconds || 0);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

function rebuildBody(originalBody, enriched) {
  // Replace everything BEFORE ## Transcript with summary + chapters +
  // pull quotes regenerated from the enrichment. Keep transcript verbatim.
  const idx = originalBody.indexOf('## Transcript');
  const transcriptSection = idx === -1 ? '' : originalBody.slice(idx);

  const parts = [];
  if (enriched.summary) {
    parts.push('## Summary', '', enriched.summary, '');
  }
  if (enriched.chapters?.length) {
    parts.push('## Chapters', '');
    for (const c of enriched.chapters) {
      parts.push(`- **${fmt(c.startSeconds)}** — ${c.title}`);
    }
    parts.push('');
  }
  if (enriched.pullQuotes?.length) {
    parts.push('## Pull quotes', '');
    for (const q of enriched.pullQuotes) {
      parts.push(`> "${q.text}" — ${q.speaker || 'Speaker'}`, '');
    }
  }
  if (transcriptSection) {
    parts.push(transcriptSection);
  }
  return '\n' + parts.join('\n');
}

function listFilesByMode() {
  const args = process.argv.slice(2);
  if (args[0] === '--all-pending') {
    return readdirSync(EPISODES_DIR)
      .filter((f) => f.endsWith('.mdx'))
      .map((f) => join(EPISODES_DIR, f))
      .filter((p) => {
        const text = readFileSync(p, 'utf8');
        return /summary:\s*['"]?\[Pending re-enrichment/.test(text);
      });
  }
  return args;
}

const files = listFilesByMode();
console.log(`Re-enriching ${files.length} file(s)…`);
let ok = 0, fail = 0;
for (const path of files) {
  try {
    const text = readFileSync(path, 'utf8');
    const parts = splitFrontmatter(text);
    if (!parts) { console.log(`  ⚠ ${path}: no frontmatter`); fail++; continue; }
    const fm = yaml.load(parts.fm);
    const transcript = extractTranscriptText(parts.body);
    if (!transcript || transcript.length < 200) {
      console.log(`  ⚠ ${path}: no usable transcript`); fail++; continue;
    }

    const enriched = await callHaiku(transcript, fm);

    // Belt-and-suspenders chapter validation: even with the explicit
    // duration constraint in the prompt, Haiku has been seen to drift
    // past the actual episode length. Drop any chapter past duration.
    if (Array.isArray(enriched.chapters) && fm.durationSeconds) {
      const before = enriched.chapters.length;
      enriched.chapters = enriched.chapters
        .filter((c) => Number(c.startSeconds) < fm.durationSeconds - 30)
        .sort((a, b) => Number(a.startSeconds) - Number(b.startSeconds));
      if (enriched.chapters.length < before) {
        console.log(`    (clamped ${before - enriched.chapters.length} chapter(s) past episode duration ${fm.durationSeconds}s)`);
      }
    }
    // Guard against weak secondary-pillar assignments — Haiku occasionally
    // labels something tangentially related (e.g. one mention of a farm)
    // as a secondary pillar. If the suggestion matches the primary, drop.
    if (enriched.suggestedSecondaryPillar === enriched.suggestedPillar) {
      enriched.suggestedSecondaryPillar = null;
    }

    fm.summary = enriched.summary;
    // Sanitize: Haiku emits `null` and empty strings for missing optional
    // fields; the schema treats optional as missing-or-T (not nullable),
    // and href must be a real URL. Strip both before saving.
    fm.bibliography = (enriched.bibliography || []).map((entry) => {
      const clean = {};
      for (const [k, v] of Object.entries(entry)) {
        if (v === null || v === undefined || v === '') continue;
        if (k === 'href' && (typeof v !== 'string' || !/^https?:\/\//.test(v) || /\s/.test(v))) continue;
        if (k === 'isbn' && /\s/.test(String(v))) continue;
        clean[k] = v;
      }
      return clean;
    });
    if (enriched.suggestedPillar && PILLAR_SLUGS.includes(enriched.suggestedPillar)) {
      fm.pillar = enriched.suggestedPillar;
    }
    if (enriched.suggestedSecondaryPillar && PILLAR_SLUGS.includes(enriched.suggestedSecondaryPillar)) {
      fm.secondaryPillar = enriched.suggestedSecondaryPillar;
    }
    const newFm = yaml.dump(fm, { lineWidth: 1000, noRefs: true }).trimEnd();
    const newBody = rebuildBody(parts.body, enriched);
    writeFileSync(path, `---\n${newFm}\n---\n${newBody}`);

    console.log(`  ✓ ${path}: enriched (${enriched.summary.length} chars summary, ${enriched.bibliography?.length || 0} biblio, ${enriched.chapters?.length || 0} chapters)`);
    ok++;
  } catch (err) {
    console.log(`  ✗ ${path}: ${err.message}`);
    fail++;
  }
}
console.log(`\nDone. ${ok} enriched, ${fail} failed.`);
process.exit(fail > 0 ? 1 : 0);
