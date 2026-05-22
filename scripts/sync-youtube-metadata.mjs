// YouTube → MDX sync, both update and create.
//
// Per Ashley's production doc:
//   "For episodes 1-302 can we just have the exact name, title and
//    description that is currently on youtube get copied over to the
//    site, so I don't have to cross check every episode for accuracy?"
//
// Behavior per YouTube video:
//   - If an MDX with the matching episode number exists, UPDATE
//     title/summary/youtubeId/audioUrl/pubDate/duration in place.
//   - Otherwise CREATE a new MDX as draft: true. Includes a heuristic
//     pillar guess from title keywords; Ashley re-classifies via the
//     pillar audit doc.
//
// Untouched on updates: guest, pillar, secondaryPillar, host, draft,
// bibliography. Ashley flagged title+description as wrong; the rest of
// the metadata we've curated stays.
//
// Flags:
//   --dry-run     print what would change; don't write
//   --only=N,M    limit to specific episode numbers
//   --no-create   skip creating missing-episode MDXes
//
// Cost: ~30 YouTube Data API calls per run. Free quota: 10,000/day.

import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import { join, basename } from 'node:path';
import yaml from 'js-yaml';

const EPISODES_DIR = 'src/content/episodes';
const RSS_SNAPSHOT = 'docs/rss-snapshot.json';
const CHANNEL_ID = process.env.YOUTUBE_CHANNEL_ID;
const API_KEY = process.env.YOUTUBE_API_KEY;

const argv = process.argv.slice(2);
const flags = Object.fromEntries(argv.filter((a) => a.startsWith('--')).map((a) => {
  const [k, v] = a.slice(2).split('=');
  return [k, v ?? true];
}));
const onlyNumbers = flags.only ? new Set(flags.only.split(',').map(Number)) : null;
const dryRun = !!flags['dry-run'];
const skipCreate = !!flags['no-create'];

if (!CHANNEL_ID) { console.error('YOUTUBE_CHANNEL_ID missing'); process.exit(1); }
if (!API_KEY) { console.error('YOUTUBE_API_KEY missing'); process.exit(1); }

// ── YouTube Data API helpers ─────────────────────────────────────────
async function ytGet(endpoint, params) {
  const qs = new URLSearchParams({ ...params, key: API_KEY }).toString();
  const url = `https://www.googleapis.com/youtube/v3/${endpoint}?${qs}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${endpoint}: ${res.status} ${(await res.text()).slice(0, 200)}`);
  return res.json();
}

async function getUploadsPlaylistId() {
  const json = await ytGet('channels', { part: 'contentDetails', id: CHANNEL_ID });
  return json.items?.[0]?.contentDetails?.relatedPlaylists?.uploads;
}

async function getAllUploadIds(playlistId) {
  const ids = [];
  let pageToken = '';
  while (true) {
    const json = await ytGet('playlistItems', {
      part: 'contentDetails', playlistId, maxResults: '50', pageToken,
    });
    for (const it of json.items || []) ids.push(it.contentDetails.videoId);
    pageToken = json.nextPageToken || '';
    if (!pageToken) break;
  }
  return ids;
}

// snippet + contentDetails so we get title/desc/publishedAt AND duration
async function getVideoDetails(videoIds) {
  const out = new Map();
  for (let i = 0; i < videoIds.length; i += 50) {
    const batch = videoIds.slice(i, i + 50);
    const json = await ytGet('videos', {
      part: 'snippet,contentDetails', id: batch.join(','),
    });
    for (const v of json.items || []) {
      out.set(v.id, {
        id: v.id,
        title: v.snippet.title,
        description: v.snippet.description,
        publishedAt: v.snippet.publishedAt,
        duration: v.contentDetails.duration, // ISO 8601 PT#H#M#S
      });
    }
  }
  return out;
}

// ── Helpers ──────────────────────────────────────────────────────────
function extractEpisodeNumber(youtubeTitle) {
  const m = youtubeTitle.match(/^(?:DO|Episode|EP)\s*#?\s*(\d+)\s*[-:–—]/i) ||
            youtubeTitle.match(/^DO(\d+)\s*[-:–—]/i);
  return m ? Number(m[1]) : null;
}

function stripPrefix(title) {
  return title.replace(/^(?:DO|Episode|EP)\s*#?\s*\d+\s*[-:–—]\s*/i, '').trim();
}

function isoDurationToSeconds(iso) {
  // PT#H#M#S → seconds
  if (!iso) return 0;
  const m = iso.match(/^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/);
  if (!m) return 0;
  return (Number(m[1]) || 0) * 3600 + (Number(m[2]) || 0) * 60 + (Number(m[3]) || 0);
}

function slugify(s) {
  return String(s).toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

function isoDateOnly(iso) {
  return iso ? iso.slice(0, 10) : '';
}

// Pillar heuristic from title + description keywords.
function guessPillar(title, description) {
  const text = (title + ' ' + (description || '')).toLowerCase();
  // Ordered by specificity — first match wins.
  const rules = [
    ['technology-ai-transhumanism', /\b(ai|artificial intelligence|gpt|anthropic|openai|transhuman|robot|llm|machine learning|silicon valley|extinction|singularity|chatgpt|joe allen)\b/],
    ['right-to-repair-surveillance', /\b(right.to.repair|surveillance|monopoly|antitrust|cartel|magill|truck|jeromy|spyware)\b/],
    ['tech-limited-child-rearing', /\b(homeschool|classical school|child.rearing|babies|fatherhood|motherhood|teen|kids|family|hannah|tucker max|pakaluk|catholic education)\b/],
    ['built-environment', /\b(built environment|strong towns|marohn|town|urban|suburb|zoning|architecture|mason|construction|housing|courtyard|wagon box|lemmon|jacobs|home builder|building|main street)\b/],
    ['conservation-environment', /\b(conservation|wildlife|forest|kelman|pogue|climate|nepa|wildfire|fire|land use|deglobalization|woodhouse|invasive)\b/],
    ['regenerative-agriculture', /\b(farm|farming|farmer|soil|cattle|herd|pasture|grain|cow|sheep|grass|smaje|peter allen|gunthorp|silvopasture|permaculture|wendell berry|food system|orchard|garden|ranch|abattoir|callicrate|wool|frerich)\b/],
  ];
  for (const [slug, re] of rules) {
    if (re.test(text)) return slug;
  }
  return 'regenerative-agriculture'; // most common default
}

// Best-guess single guest name from YouTube title.
function guessGuest(youtubeTitle) {
  const title = stripPrefix(youtubeTitle);
  // Patterns like "Topic with X" or "Topic w/ X" — pull the post-with name.
  const m =
    title.match(/\b(?:with|w\/|featuring|ft\.?|feat\.?)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+){1,3})/) ||
    title.match(/\b([A-Z][a-z]+\s+[A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)\s+(?:on|discusses|talks)\b/);
  if (m && !/^(?:Ashley|Jason|James|Nate|Josh|Chris)$/.test(m[1])) {
    return m[1];
  }
  return undefined; // omit field when no clear single guest
}

// ── Frontmatter editing ──────────────────────────────────────────────
function splitFrontmatter(text) {
  const m = text.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  return m ? { fm: m[1], body: m[2] } : null;
}

// ── Load RSS audioUrl lookup if available ────────────────────────────
const rssByNumber = new Map();
if (existsSync(RSS_SNAPSHOT)) {
  const rss = JSON.parse(readFileSync(RSS_SNAPSHOT, 'utf8'));
  for (const item of rss) {
    const m = item.title.match(/^(?:DO|Episode)\s*#?\s*(\d+)\s*[-:–—]/i) ||
              item.title.match(/^DO(\d+)\s*[-:–—]/i);
    if (m) rssByNumber.set(Number(m[1]), item);
  }
  console.log(`Loaded ${rssByNumber.size} numbered RSS items from snapshot.`);
}

// ── Main ─────────────────────────────────────────────────────────────
console.log('Fetching YouTube channel data…');
const playlistId = await getUploadsPlaylistId();
if (!playlistId) { console.error(`No uploads playlist for channel ${CHANNEL_ID}`); process.exit(2); }
console.log(`  uploads playlist: ${playlistId}`);

const videoIds = await getAllUploadIds(playlistId);
console.log(`  ${videoIds.length} videos on channel`);

const videos = await getVideoDetails(videoIds);
console.log(`  fetched details for ${videos.size} videos`);

const ytByNumber = new Map();
for (const v of videos.values()) {
  const n = extractEpisodeNumber(v.title);
  if (n != null && !ytByNumber.has(n)) ytByNumber.set(n, v);
}
console.log(`  ${ytByNumber.size} videos with parseable episode numbers`);

// Build inverse lookup: which MDX numbers we already have
const mdxByNumber = new Map();
for (const f of readdirSync(EPISODES_DIR).filter((f) => f.endsWith('.mdx'))) {
  const text = readFileSync(join(EPISODES_DIR, f), 'utf8');
  const parts = splitFrontmatter(text);
  if (!parts) continue;
  const fm = yaml.load(parts.fm);
  if (typeof fm?.number === 'number') {
    mdxByNumber.set(fm.number, { file: f, fm, body: parts.body });
  }
}
console.log(`  ${mdxByNumber.size} MDX episodes on disk`);

let updated = 0, created = 0, skipped = 0;

for (const [number, v] of ytByNumber) {
  if (onlyNumbers && !onlyNumbers.has(number)) continue;
  const rss = rssByNumber.get(number);
  const existing = mdxByNumber.get(number);

  if (existing) {
    // ── Update existing ─────────────────────────────────────────────
    const fm = existing.fm;
    const newTitle = stripPrefix(v.title);
    const newSummary = v.description;
    const newYoutubeId = v.id;
    const newAudioUrl = rss?.audioUrl;
    const newPubDate = isoDateOnly(v.publishedAt);
    const newDuration = isoDurationToSeconds(v.duration);

    let changed = false;
    if (fm.title !== newTitle) { fm.title = newTitle; changed = true; }
    if (fm.summary !== newSummary) { fm.summary = newSummary; changed = true; }
    if (fm.youtubeId !== newYoutubeId) { fm.youtubeId = newYoutubeId; changed = true; }
    if (newAudioUrl && fm.audioUrl !== newAudioUrl) { fm.audioUrl = newAudioUrl; changed = true; }
    // Only update pubDate/duration if missing or clearly wrong (zero/empty)
    if (!fm.pubDate || (typeof fm.pubDate === 'string' && fm.pubDate.length < 8)) {
      if (newPubDate) { fm.pubDate = newPubDate; changed = true; }
    }
    if (!fm.durationSeconds && newDuration) {
      fm.durationSeconds = newDuration;
      changed = true;
    }
    if (!changed) continue;

    if (!dryRun) {
      const newFm = yaml.dump(fm, { sortKeys: false, lineWidth: 1000, noRefs: true }).trimEnd();
      writeFileSync(join(EPISODES_DIR, existing.file), `---\n${newFm}\n---\n${existing.body}`);
    }
    updated++;
    console.log(`  ✓ update ep ${number}: ${newTitle.slice(0, 60)}`);
  } else if (!skipCreate) {
    // ── Create new ───────────────────────────────────────────────────
    const title = stripPrefix(v.title);
    const slug = `${number}-${slugify(title)}`;
    const file = `${slug}.mdx`;
    const guest = guessGuest(v.title);
    const pillar = guessPillar(v.title, v.description);
    const pubDate = isoDateOnly(v.publishedAt);
    const duration = isoDurationToSeconds(v.duration);

    const fm = {
      number,
      title,
      ...(guest ? { guest } : {}),
      pubDate,
      durationSeconds: duration,
      pillar,
      summary: v.description,
      youtubeId: v.id,
      ...(rss?.audioUrl ? { audioUrl: rss.audioUrl } : {}),
      bibliography: [],
      draft: true,
    };
    const fmStr = yaml.dump(fm, { sortKeys: false, lineWidth: 1000, noRefs: true }).trimEnd();
    const body = '\n## Summary\n\n' + (v.description || '') + '\n';

    if (!dryRun) {
      writeFileSync(join(EPISODES_DIR, file), `---\n${fmStr}\n---\n${body}`);
    }
    created++;
    console.log(`  + create ep ${number}: ${title.slice(0, 60)} (pillar=${pillar}, guest=${guest || 'none'})`);
  } else {
    skipped++;
  }
}

console.log('');
console.log('━━━ Summary ━━━');
console.log(`  Channel videos with episode #: ${ytByNumber.size}`);
console.log(`  MDX episodes on disk before:    ${mdxByNumber.size}`);
console.log(`  Updated:                        ${updated}`);
console.log(`  Created (draft):                ${created}`);
console.log(`  Skipped --no-create:            ${skipped}`);
if (dryRun) console.log('  (dry-run — no files written)');
