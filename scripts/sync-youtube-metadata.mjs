// One-time backfill: copy YouTube titles + descriptions onto every
// episode MDX. Ashley's ask: "For episodes 1-302 can we just have the
// exact name, title and description that is currently on youtube get
// copied over to the site, so I don't have to cross check every episode."
//
// What we do per episode:
//   - Match by episode number parsed from the YouTube video title
//     (formats: "DO 296: ...", "DO 296 - ...", "Episode 67 - ...", etc.)
//   - title  ← YouTube title with "DO ###:" prefix stripped (number is
//             already shown separately on the episode card)
//   - summary ← YouTube description verbatim
//   - youtubeId ← video ID
//
// What we DO NOT touch:
//   - draft, pillar, guest, audioUrl, pubDate, durationSeconds,
//     bibliography — these are independent metadata. Ashley flagged
//     title/description inaccuracies, not the rest.
//
// Flags:
//   --dry-run      print what would change; don't write
//   --only=296,304 limit to specific episode numbers
//
// Cost: ~30 YouTube Data API calls (free tier: 10,000/day quota). The
// API key is restricted to YouTube Data API v3 only.

import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { join, basename } from 'node:path';
import yaml from 'js-yaml';

const EPISODES_DIR = 'src/content/episodes';
const CHANNEL_ID = process.env.YOUTUBE_CHANNEL_ID;
const API_KEY = process.env.YOUTUBE_API_KEY;

const argv = process.argv.slice(2);
const flags = Object.fromEntries(argv.filter((a) => a.startsWith('--')).map((a) => {
  const [k, v] = a.slice(2).split('=');
  return [k, v ?? true];
}));
const onlyNumbers = flags.only ? new Set(flags.only.split(',').map(Number)) : null;
const dryRun = !!flags['dry-run'];

if (!CHANNEL_ID) { console.error('YOUTUBE_CHANNEL_ID missing'); process.exit(1); }
if (!API_KEY) { console.error('YOUTUBE_API_KEY missing'); process.exit(1); }

// ── Pull every video from the channel's uploads playlist ──────────────
async function getUploadsPlaylistId() {
  const url = `https://www.googleapis.com/youtube/v3/channels?part=contentDetails&id=${CHANNEL_ID}&key=${API_KEY}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`channels.list: ${res.status} ${await res.text()}`);
  const json = await res.json();
  return json.items?.[0]?.contentDetails?.relatedPlaylists?.uploads;
}

async function getAllUploadIds(playlistId) {
  const ids = [];
  let pageToken = '';
  while (true) {
    const url = `https://www.googleapis.com/youtube/v3/playlistItems?part=contentDetails&playlistId=${playlistId}&maxResults=50&pageToken=${pageToken}&key=${API_KEY}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`playlistItems.list: ${res.status} ${await res.text()}`);
    const json = await res.json();
    for (const item of json.items || []) {
      ids.push(item.contentDetails.videoId);
    }
    pageToken = json.nextPageToken || '';
    if (!pageToken) break;
  }
  return ids;
}

async function getVideoDetails(videoIds) {
  const out = new Map();
  for (let i = 0; i < videoIds.length; i += 50) {
    const batch = videoIds.slice(i, i + 50);
    const url = `https://www.googleapis.com/youtube/v3/videos?part=snippet&id=${batch.join(',')}&key=${API_KEY}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`videos.list: ${res.status} ${await res.text()}`);
    const json = await res.json();
    for (const v of json.items || []) {
      out.set(v.id, {
        id: v.id,
        title: v.snippet.title,
        description: v.snippet.description,
        publishedAt: v.snippet.publishedAt,
      });
    }
  }
  return out;
}

// ── Match by episode number ──────────────────────────────────────────
function extractEpisodeNumber(youtubeTitle) {
  // Common formats:
  //   "DO 296: Building Community in Fragmented Times"
  //   "DO 296 - Building Community ..."
  //   "DO296 - Building..."
  //   "Episode 67 - Brendan Barnard w/ Ashley Colby ..."
  //   "DO #4 - ..."
  const m = youtubeTitle.match(/^(?:DO|Episode|EP)\s*#?\s*(\d+)\s*[-:–—]/i) ||
            youtubeTitle.match(/^DO(\d+)\s*[-:–—]/i);
  return m ? Number(m[1]) : null;
}

function stripPrefix(title) {
  return title.replace(/^(?:DO|Episode|EP)\s*#?\s*\d+\s*[-:–—]\s*/i, '').trim();
}

// ── Frontmatter editing ──────────────────────────────────────────────
function splitFrontmatter(text) {
  const m = text.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  return m ? { fm: m[1], body: m[2] } : null;
}

// ── Main ─────────────────────────────────────────────────────────────
console.log('Fetching YouTube channel data…');
const playlistId = await getUploadsPlaylistId();
if (!playlistId) {
  console.error(`No uploads playlist found for channel ${CHANNEL_ID}`);
  process.exit(2);
}
console.log(`  uploads playlist: ${playlistId}`);

const videoIds = await getAllUploadIds(playlistId);
console.log(`  ${videoIds.length} videos on channel`);

const videos = await getVideoDetails(videoIds);
console.log(`  fetched details for ${videos.size} videos`);

const byNumber = new Map();
for (const v of videos.values()) {
  const n = extractEpisodeNumber(v.title);
  if (n != null && !byNumber.has(n)) byNumber.set(n, v);
}
console.log(`  ${byNumber.size} videos with parseable episode numbers`);

const files = readdirSync(EPISODES_DIR).filter((f) => f.endsWith('.mdx'));
let matched = 0, updated = 0, missed = 0;
const changes = [];

for (const f of files) {
  const path = join(EPISODES_DIR, f);
  const text = readFileSync(path, 'utf8');
  const parts = splitFrontmatter(text);
  if (!parts) continue;
  const fm = yaml.load(parts.fm);
  if (onlyNumbers && !onlyNumbers.has(Number(fm.number))) continue;

  const v = byNumber.get(Number(fm.number));
  if (!v) { missed++; continue; }
  matched++;

  const newTitle = stripPrefix(v.title);
  const newSummary = v.description;

  const titleChanged = fm.title !== newTitle;
  const summaryChanged = fm.summary !== newSummary;
  const youtubeIdChanged = fm.youtubeId !== v.id;
  if (!titleChanged && !summaryChanged && !youtubeIdChanged) continue;

  changes.push({
    file: f,
    number: fm.number,
    oldTitle: fm.title,
    newTitle,
    oldSummary: (fm.summary || '').slice(0, 80),
    newSummary: (newSummary || '').slice(0, 80),
    youtubeIdNew: youtubeIdChanged ? v.id : null,
  });

  if (!dryRun) {
    fm.title = newTitle;
    fm.summary = newSummary;
    fm.youtubeId = v.id;
    const newFm = yaml.dump(fm, { sortKeys: false, lineWidth: 1000, noRefs: true }).trimEnd();
    writeFileSync(path, `---\n${newFm}\n---\n${parts.body}`);
    updated++;
  }
}

console.log('');
console.log(`━━━ Summary ━━━`);
console.log(`  Episode MDXes processed: ${files.length}`);
console.log(`  Matched to a YouTube video: ${matched}`);
console.log(`  No YouTube match: ${missed}`);
console.log(`  Changes detected: ${changes.length}`);
if (!dryRun) console.log(`  Updated on disk: ${updated}`);
console.log('');
if (dryRun) {
  console.log('Sample of pending changes (first 8):');
  for (const c of changes.slice(0, 8)) {
    console.log(`  ep ${c.number}:`);
    console.log(`    title  '${c.oldTitle.slice(0, 60)}' → '${c.newTitle.slice(0, 60)}'`);
    console.log(`    summ.  '${c.oldSummary}…' → '${c.newSummary}…'`);
    if (c.youtubeIdNew) console.log(`    yt id  → ${c.youtubeIdNew}`);
  }
}
