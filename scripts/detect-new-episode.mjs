#!/usr/bin/env node
/**
 * scripts/detect-new-episode.mjs
 *
 * Cheap probe that fetches the Anchor RSS feed and prints whether the
 * newest episode has been transcribed yet. Output format is shell-friendly
 * key=value lines so the workflow can pick the values up directly.
 *
 *   new=true|false
 *   title=...     (only when new=true)
 *   guid=...      (only when new=true)
 *
 * No API keys, no external state — just RSS + a glob of .transcripts/.
 */
import { readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';

const FEED = process.env.FEED ?? 'https://anchor.fm/s/68308b7c/podcast/rss';
const ROOT = process.cwd();
const CACHE_DIR = join(ROOT, '.transcripts');

const xml = await (await fetch(FEED)).text();
const itemMatch = xml.match(/<item>([\s\S]*?)<\/item>/);
if (!itemMatch) {
  console.log('new=false');
  console.error('No <item> in feed');
  process.exit(0);
}
const block = itemMatch[1];
const title = stripCdata(matchOne(block, /<title>([\s\S]*?)<\/title>/));
const guid = stripCdata(matchOne(block, /<guid[^>]*>([\s\S]*?)<\/guid>/));
const enc = block.match(/<enclosure[^>]*url="([^"]+)"/);
const id = guid || (enc && enc[1]) || title;
const hash = createHash('sha1').update(String(id)).digest('hex').slice(0, 12);
const scribePath = join(CACHE_DIR, `${hash}.scribe.json`);

if (existsSync(scribePath)) {
  console.log('new=false');
  console.error(`Latest "${title}" already transcribed (hash ${hash})`);
} else {
  console.log('new=true');
  console.log(`title=${title}`);
  console.log(`guid=${id}`);
  console.error(`Latest "${title}" is new (hash ${hash}) — will transcribe.`);
}

function matchOne(s, re) { const m = s.match(re); return m ? m[1].trim() : null; }
function stripCdata(s) { return s == null ? null : s.replace(/^\s*<!\[CDATA\[/, '').replace(/\]\]>\s*$/, '').trim(); }
