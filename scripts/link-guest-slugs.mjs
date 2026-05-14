// Auto-link each episode's `guestSlug` to a contributor entry when the
// frontmatter `guest` name matches a contributor's `name` exactly. Fixes
// the "Appearances" section on every contributor page (which was empty
// because the schema-level reference was missing across the catalog).
//
// Safe by design: only matches on exact name equality, only sets
// guestSlug when missing, never overrides an existing slug. Multi-guest
// panel episodes where the `guest` field holds a single name still
// link to that one contributor.

import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { join, basename } from 'node:path';
import yaml from 'js-yaml';

const EPISODES_DIR = 'src/content/episodes';
const CONTRIBUTORS_DIR = 'src/content/contributors';

const contribByName = new Map();
for (const f of readdirSync(CONTRIBUTORS_DIR).filter((f) => f.endsWith('.md'))) {
  const text = readFileSync(join(CONTRIBUTORS_DIR, f), 'utf8');
  const m = text.match(/^---\n([\s\S]*?)\n---/);
  if (!m) continue;
  const fm = yaml.load(m[1]);
  if (fm?.name) {
    contribByName.set(fm.name.trim(), basename(f, '.md'));
  }
}
console.log(`Indexed ${contribByName.size} contributors.`);

function splitFrontmatter(text) {
  const m = text.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  return m ? { fm: m[1], body: m[2] } : null;
}

let linked = 0;
let already = 0;
let unmatched = 0;
const unmatchedNames = new Set();

for (const f of readdirSync(EPISODES_DIR).filter((f) => f.endsWith('.mdx'))) {
  const path = join(EPISODES_DIR, f);
  const text = readFileSync(path, 'utf8');
  const parts = splitFrontmatter(text);
  if (!parts) continue;
  const fm = yaml.load(parts.fm);
  if (!fm.guest) continue;
  if (fm.guestSlug) { already++; continue; }

  const guestName = String(fm.guest).trim();
  const slug = contribByName.get(guestName);
  if (!slug) {
    unmatched++;
    unmatchedNames.add(guestName);
    continue;
  }
  fm.guestSlug = slug;
  const newFm = yaml.dump(fm, { sortKeys: false, lineWidth: 1000, noRefs: true }).trimEnd();
  writeFileSync(path, `---\n${newFm}\n---\n${parts.body}`);
  console.log(`  ✓ ${basename(f).slice(0, 50)} → guestSlug: ${slug}`);
  linked++;
}

console.log(`\n━━━ Auto-link complete ━━━`);
console.log(`  Linked:           ${linked}`);
console.log(`  Already linked:   ${already}`);
console.log(`  Unmatched guests: ${unmatched}`);
if (unmatchedNames.size) {
  console.log(`\nUnmatched guest names (no contributor page exists):`);
  for (const n of [...unmatchedNames].sort()) console.log(`  - ${n}`);
}
