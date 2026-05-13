// Clean transcript prose in episode MDX files per Ashley's feedback:
//   1. "Do More Optimism" → "Doomer Optimism"   (Scribe typo of the show name)
//   2. Same-prefix stutters → final word         ("T-totally" → "totally",
//                                                 "Wel-welcome" → "Welcome",
//                                                 "h-huh" → "huh")
//
// What we deliberately DO NOT touch:
//   - Real compound hyphenated words (self-care, long-term, right-to-repair, etc.)
//     — guarded by the length cap (prefix > 3 chars is preserved as-is) and
//     by the same-start-letter check.
//   - "you know" / "um" / "uh" filler — that's a separate, riskier pass.
//
// Operates only on MDX files under src/content/episodes/. Writes in place.
// Prints a diff summary at the end.

import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const EPISODES_DIR = 'src/content/episodes';

function fixDoMoreOptimism(text) {
  // "Do More Optimism" → "Doomer Optimism"
  // "do more optimism" → "doomer optimism" (lowercase form too)
  // Restricted to the exact two-word phrase + Optimism to avoid touching
  // legitimate "do more" prose ("we should do more research").
  let count = 0;
  text = text.replace(/\bDo More Optimism\b/g, () => { count++; return 'Doomer Optimism'; });
  text = text.replace(/\bdo more optimism\b/g, () => { count++; return 'doomer optimism'; });
  return { text, count };
}

function collapseStutters(text) {
  // Match word1-word2 where:
  //   - word1 is 1-3 chars (single letter or short prefix like "Wel-")
  //   - lowercase(word1) is a prefix of lowercase(word2)
  //   - word2 is strictly longer than word1
  // In that case drop word1 (and the dash); keep word2.
  //
  // Preserves original capitalization of word2. If the original prefix
  // was capitalized (sentence-start case like "Wel-welcome"), recapitalize
  // word2's first letter.
  let count = 0;
  const out = text.replace(
    /\b([A-Za-z]{1,3})-([A-Za-z][a-z]+)\b/g,
    (match, prefix, word) => {
      const p = prefix.toLowerCase();
      const w = word.toLowerCase();
      if (!w.startsWith(p)) return match;
      if (w.length <= p.length) return match;
      count++;
      // If prefix was capitalized, recapitalize the result
      if (prefix[0] === prefix[0].toUpperCase() && prefix[0] !== prefix[0].toLowerCase()) {
        return word[0].toUpperCase() + word.slice(1);
      }
      return word;
    },
  );
  return { text: out, count };
}

function fixTDashWord(text) {
  // Catches the literal "X dash word" pattern Ashley specifically called out
  // ("we're T dash totally kindred spirits" → "we're totally kindred spirits").
  // Conservative: only when the dash-word is a single letter, and only
  // when the following word starts with the same letter.
  let count = 0;
  const out = text.replace(
    /\b([A-Za-z]) dash ([A-Za-z][a-z]+)\b/g,
    (match, letter, word) => {
      if (letter.toLowerCase() !== word[0].toLowerCase()) return match;
      count++;
      return word;
    },
  );
  return { text: out, count };
}

const files = readdirSync(EPISODES_DIR).filter((f) => f.endsWith('.mdx'));
const totals = { doMore: 0, stutter: 0, dashWord: 0, filesChanged: 0 };

for (const f of files) {
  const path = join(EPISODES_DIR, f);
  const original = readFileSync(path, 'utf8');
  let { text, count: c1 } = fixDoMoreOptimism(original);
  const { text: t2, count: c2 } = collapseStutters(text);
  text = t2;
  const { text: t3, count: c3 } = fixTDashWord(text);
  text = t3;
  if (text !== original) {
    writeFileSync(path, text);
    totals.filesChanged++;
    totals.doMore += c1;
    totals.stutter += c2;
    totals.dashWord += c3;
    console.log(`  ${f}: -${c1} doMore, -${c2} stutter, -${c3} dashWord`);
  }
}

console.log(`\n━━━ Cleaned ${totals.filesChanged} files ━━━`);
console.log(`  "Do More Optimism" → "Doomer Optimism":  ${totals.doMore}`);
console.log(`  Same-prefix stutters collapsed:           ${totals.stutter}`);
console.log(`  "X dash word" pattern collapsed:          ${totals.dashWord}`);
