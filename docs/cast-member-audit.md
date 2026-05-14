# Cast-member audit

Run: 2026-05-14

The "cast member flow" — how a contributor (guest or lead voice) sees themselves represented on the site — was audited end-to-end. Findings + what's fixed in this PR + what still needs Ashley's hand.

## Fixed in this PR

1. **Contributor page episode-matching is broader.** Before, the "Appearances" section on each contributor page only showed episodes with an explicit `guestSlug: <contributor>` reference. After, it ALSO shows episodes where the contributor's name appears in the title — so James Pogue's page now picks up panel episodes like "DO 216 — Doomer Optimist Guide to Geopolitics w/ James Pogue, Chris Mott and Ashley", not just episodes where he's the single primary guest.

2. **Host special case.** Ashley's page no longer shows an empty "0 appearances" section. Instead it shows "Hosts every conversation — N+ published episodes" with a link to `/episodes`.

3. **Graceful empty state.** Contributors with zero matching episodes (e.g. Gord Magill, whose real Anchor ep 207 isn't yet in our backfill) now show "No episodes in the public archive yet. As the backfill catches up, this section will fill in automatically." — instead of the section silently disappearing.

## Current cast-member status

| Contributor | Featured | Appearances | Portrait | External link |
|---|---|---|---|---|
| Ashley Colby Fitzgerald | ✓ | host special-case | placeholder | rizomafieldschool.com |
| Chris Smaje | ✓ | 2 | ✓ real | smallfarmfuture.org.uk |
| Peter Allen | ✓ | 1 | placeholder | mastodonvalleyfarm.com |
| James Pogue | ✓ | 3 (after this PR's fix) | placeholder | — |
| Gord Magill | ✓ | 0 (real ep 207 not backfilled) | placeholder | — |
| Chuck Marohn | (unfeatured) | 0 (real ep 34 not backfilled) | placeholder | strongtowns.org |
| Joe Allen | (unfeatured) | 1 (ep 277) | placeholder | — |
| Patrick Lemmon | (unfeatured) | 0 (never on the show) | placeholder | — |

## What still needs Ashley

### Real portraits for 7 contributors

Only Chris Smaje has a commissioned hedcut. The other seven render as procedural WSJ-style placeholders (deterministic from name, but obviously not the real person). Generating real hedcuts requires Adobe Firefly with a reference photo for each contributor — that's a manual flow Ashley needs to drive (or commission a graphic designer to do all eight in one sitting for visual consistency).

### Backfill the real episodes for under-represented featured contributors

These contributors are featured on the homepage's "Voices" section but their pages don't have any episodes because their real Anchor episodes aren't yet in our MDX:

- **Gord Magill** → real ep 207: "DO 207 - What has happened to the left? With Ashley Frawley, Gord Magill and Ashley Colby"
- **Chuck Marohn** → real ep 34: "Episode 34 - Chuck Marohn w/ Anarcho-Contrarian and Kara Marshall"
- **Tom Murphy** → real ep 246 (currently published with name in title but no contributor page)

Running the backfill workflow with appropriate `--only` filters would pull these in. Cost: ~$0.30/episode in ElevenLabs credits.

### Decisions to make about under-utilized contributor pages

- **Patrick Lemmon** has a contributor page but never appeared on the podcast. Should the page be deleted, or kept as a placeholder for a future episode?
- **Joe Allen** has one real episode (ep 277). Lift him back to `featured: true` if Ashley wants him as a recurring voice on the technology-AI pillar.

### New contributor pages for frequent guests

The following guests appear in the published catalog but have no contributor page (so visitors see their name as plain text on episode pages, not a profile link):

Catherine Pakaluk · Dougald Hine · Elizabeth Oldfield · Farron Morgan · Geoffrey Long · Greg Gunthorp · Greg Sello · Ilan Kelman · John Heers · Leah Sargeant · Marcin Jakubowski · Marie Gluesenkamp Perez · Mike Callicrate · Nick Wrenn · Roxanne Ahearn · Susan Krumdieck · Tom Murphy · Willy Denner

Creating contributor pages for these is editorial work — each needs a bio (1-2 sentences), affiliation, role label, external link, and pillar association. Best done with Ashley in a single sitting; the templated MDX takes <2 min per person once she has the basic data in hand.

### Add `featured: true` to Jason Snyder

Per Ashley's voice review, Jason Snyder should be on the lead-voices list. He has no contributor page yet — create one when bio details are known.
