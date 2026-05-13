# Episode audit — cross-referenced against Anchor RSS

Run: 2026-05-13T22:51:20.158Z

**Total episodes:** 87

| Verdict | Count | Meaning |
|---|---|---|
| clean | 34 | RSS, MDX, and transcript all agree. |
| guest-haiku-error | 5 | RSS confirms MDX title, but the frontmatter `guest` field disagrees with the transcript. Safe to auto-fix: set `guest` to the transcript-detected name. |
| no-rss-match | 11 | audioUrl is not in the current Anchor feed. May be a deleted episode, an Anchor URL change, or a stale link. |
| unverifiable | 37 | RSS and MDX agree, but the transcript opening had no clear guest tag to verify against. No action needed unless content review reveals a problem. |

## guest-haiku-error (5)

### Ep 230 — `230-agriculture-for-the-people.mdx`

- **MDX title:** Agriculture for the People
- **RSS title:** DO 230 - Agriculture for the People
- **MDX guest:** (none)
- **Transcript guests:** Austin Frerich

**Recommendation:** RSS title and MDX title agree. But frontmatter guest "(missing)" doesn't match transcript opening (Austin Frerich). **Recommend: set guest: "Austin Frerich".**

### Ep 243 — `unnumbered-9561bb5f4416-d0-243-the-spiritual-quality-of-global-capitalism.mdx`

- **MDX title:** D0 243 - The spiritual quality of global capitalism
- **RSS title:** D0 243 - The spiritual quality of global capitalism
- **MDX guest:** (none)
- **Transcript guests:** Travis Logan, Matt Crawford

**Recommendation:** RSS title and MDX title agree. But frontmatter guest "(missing)" doesn't match transcript opening (Travis Logan, Matt Crawford). **Recommend: set guest: "Travis Logan".**

### Ep 256 — `256-political-agency-with-marie-gluesenkamp-perez-and-james.mdx`

- **MDX title:** Political Agency with Marie Gluesenkamp Perez and James
- **RSS title:** DO 256 - Political Agency with Marie Gluesenkamp Perez and James
- **MDX guest:** Political Agency
- **Transcript guests:** Marie Gluesenkamp Perez, John Lechner

**Recommendation:** RSS title and MDX title agree. But frontmatter guest "Political Agency" doesn't match transcript opening (Marie Gluesenkamp Perez, John Lechner). **Recommend: set guest: "Marie Gluesenkamp Perez".**

### Ep 257 — `257-building-the-benedict-option-w-leah-sargeant-and-ashley.mdx`

- **MDX title:** Building the Benedict Option w/ Leah Sargeant and Ashley
- **RSS title:** DO 257 - Building the Benedict Option w/ Leah Sargeant and Ashley
- **MDX guest:** Leah Sargeant
- **Transcript guests:** Leah Sargent

**Recommendation:** RSS title and MDX title agree. But frontmatter guest "Leah Sargeant" doesn't match transcript opening (Leah Sargent). **Recommend: set guest: "Leah Sargent".**

### Ep 267 — `267-doomer-optimism-w-matt-smith-graham-summers-chris-ellis.mdx`

- **MDX title:** Doomer Optimism w/ Matt Smith + Graham Summers + Chris Ellis
- **RSS title:** DO 267 - Doomer Optimism w/ Matt Smith + Graham Summers + Chris Ellis
- **MDX guest:** Matt Smith
- **Transcript guests:** Graham Summers, Gram Summers, Doug Casey

**Recommendation:** RSS title and MDX title agree. But frontmatter guest "Matt Smith" doesn't match transcript opening (Graham Summers, Gram Summers, Doug Casey). **Recommend: set guest: "Graham Summers".**

## no-rss-match (11)

### Ep 247 — `247-anna-mussmann-classical-homeschool.mdx`

- **MDX title:** The Classical Homeschool & the Coop
- **MDX guest:** Anna Mussmann
- **Transcript guests:** (none detected)

**Recommendation:** No audioUrl in frontmatter; cannot cross-reference against RSS.

### Ep 253 — `253-tao-orion-restoration-ecology.mdx`

- **MDX title:** Beyond the War on Invasives
- **MDX guest:** Tao Orion
- **Transcript guests:** Alan Copshall, Paul Kingsnorth

**Recommendation:** No audioUrl in frontmatter; cannot cross-reference against RSS.

### Ep 260 — `260-tucker-max-fatherhood.mdx`

- **MDX title:** Fatherhood After the Internet
- **MDX guest:** Tucker Max
- **Transcript guests:** Catherine Pakaluk, Roxanne Ahern

**Recommendation:** No audioUrl in frontmatter; cannot cross-reference against RSS.

### Ep 265 — `265-marie-gluesenkamp-perez-rural-labor.mdx`

- **MDX title:** Rural Labor, Trade Schools & the Right to Fix Your Own Truck
- **MDX guest:** Rep. Marie Gluesenkamp Perez
- **Transcript guests:** Susan Krumdieck

**Recommendation:** No audioUrl in frontmatter; cannot cross-reference against RSS.

### Ep 269 — `269-patrick-lemmon-orthodox-masonry.mdx`

- **MDX title:** Stone, Lime & the Long Building
- **MDX guest:** Patrick Lemmon
- **Transcript guests:** (none detected)

**Recommendation:** No audioUrl in frontmatter; cannot cross-reference against RSS.

### Ep 273 — `273-joe-allen-dark-aeon.mdx`

- **MDX title:** Dark Aeon — Reading the Transhumanist Project
- **MDX guest:** Joe Allen
- **Transcript guests:** (none detected)

**Recommendation:** No audioUrl in frontmatter; cannot cross-reference against RSS.

### Ep 278 — `278-chris-smaje-small-farm-future.mdx`

- **MDX title:** A Small Farm Future, Honestly Argued
- **MDX guest:** Chris Smaje
- **Transcript guests:** (none detected)

**Recommendation:** No audioUrl in frontmatter; cannot cross-reference against RSS.

### Ep 282 — `282-gord-magill-right-to-repair.mdx`

- **MDX title:** Trucks, Tractors, and the Locked-Down Economy
- **MDX guest:** Gord Magill
- **Transcript guests:** John Heers

**Recommendation:** No audioUrl in frontmatter; cannot cross-reference against RSS.

### Ep 287 — `287-james-pogue-deglobalization.mdx`

- **MDX title:** Land, Place & the End of the Long Boom
- **MDX guest:** James Pogue
- **Transcript guests:** Wendell Berry

**Recommendation:** No audioUrl in frontmatter; cannot cross-reference against RSS.

### Ep 291 — `291-chuck-marohn-strong-towns.mdx`

- **MDX title:** The Strong Town & the Suburban Experiment
- **MDX guest:** Chuck Marohn
- **Transcript guests:** (none detected)

**Recommendation:** No audioUrl in frontmatter; cannot cross-reference against RSS.

### Ep 296 — `296-peter-allen-keystone-restoration.mdx`

- **MDX title:** Restoring the Oak Savanna
- **MDX guest:** Peter Allen
- **Transcript guests:** Elizabeth Oldfield

**Recommendation:** No audioUrl in frontmatter; cannot cross-reference against RSS.

## unverifiable (37)

### Ep 212 — `212-should-i-stay-or-should-i-go-w-andy-keturah-ashley-and-patrick.mdx`

- **MDX title:** Should I stay or should I go? w/ Andy, Keturah, Ashley and Patrick
- **RSS title:** DO 212 - Should I stay or should I go? w/ Andy, Keturah, Ashley and Patrick
- **MDX guest:** Andy
- **Transcript guests:** (none detected)

**Recommendation:** RSS title matches MDX title. Transcript opening had no clear guest tag — cannot auto-verify.

### Ep 213 — `213-limicon-panel.mdx`

- **MDX title:** Limicon Panel
- **RSS title:** DO 213 - Limicon Panel
- **MDX guest:** Limicon Panel
- **Transcript guests:** (none detected)

**Recommendation:** RSS title matches MDX title. Transcript opening had no clear guest tag — cannot auto-verify.

### Ep 215 — `215-building-local-community.mdx`

- **MDX title:** Building Local Community
- **RSS title:** DO 215 - Building Local Community
- **MDX guest:** (none)
- **Transcript guests:** (none detected)

**Recommendation:** RSS title matches MDX title. Transcript opening had no clear guest tag — cannot auto-verify.

### Ep 216 — `216-doomer-optimist-guide-to-geopolitics-w-james-pogue-chris-mott-and-ashley.mdx`

- **MDX title:** Doomer Optimist Guide to Geopolitics w/ James Pogue, Chris Mott and Ashley
- **RSS title:** DO 216 - Doomer Optimist Guide to Geopolitics w/ James Pogue, Chris Mott and Ashley
- **MDX guest:** James Pogue
- **Transcript guests:** (none detected)

**Recommendation:** RSS title matches MDX title. Transcript opening had no clear guest tag — cannot auto-verify.

### Ep 221 — `221-ecologica-americana-with-c-sandbatch-roland-gunn-and-jason.mdx`

- **MDX title:** Ecologica Americana with C. Sandbatch, Roland Gunn, and Jason
- **RSS title:** DO 221 - Ecologica Americana with C. Sandbatch, Roland Gunn, and Jason
- **MDX guest:** C. Sandbatch
- **Transcript guests:** (none detected)

**Recommendation:** RSS title matches MDX title. Transcript opening had no clear guest tag — cannot auto-verify.

### Ep 222 — `222-cultural-renewal-with-donald-and-mike.mdx`

- **MDX title:** Cultural Renewal with Donald and Mike
- **RSS title:** DO 222 - Cultural Renewal with Donald and Mike
- **MDX guest:** Donald
- **Transcript guests:** (none detected)

**Recommendation:** RSS title matches MDX title. Transcript opening had no clear guest tag — cannot auto-verify.

### Ep 223 — `223-along-the-shore-a-journey-with-james-of-michigan.mdx`

- **MDX title:** Along the Shore: A Journey with James of Michigan
- **RSS title:** DO 223 - Along the Shore: A Journey with James of Michigan
- **MDX guest:** James
- **Transcript guests:** (none detected)

**Recommendation:** RSS title matches MDX title. Transcript opening had no clear guest tag — cannot auto-verify.

### Ep 225 — `225-goethean-science-w-arie-and-ashley.mdx`

- **MDX title:** Goethean Science w/ Arie and Ashley
- **RSS title:** DO 225 - Goethean Science w/ Arie and Ashley
- **MDX guest:** Arie
- **Transcript guests:** (none detected)

**Recommendation:** RSS title matches MDX title. Transcript opening had no clear guest tag — cannot auto-verify.

### Ep 226 — `226-food-hub-round-table-discussion.mdx`

- **MDX title:** Food Hub Round Table Discussion
- **RSS title:** DO 226 - Food Hub Round Table Discussion
- **MDX guest:** (none)
- **Transcript guests:** (none detected)

**Recommendation:** RSS title matches MDX title. Transcript opening had no clear guest tag — cannot auto-verify.

### Ep 227 — `227-paul-mcniel-and-the-wagon-box-with-ashley.mdx`

- **MDX title:** Paul McNiel and the Wagon Box with Ashley
- **RSS title:** DO 227 - Paul McNiel and the Wagon Box with Ashley
- **MDX guest:** Paul McNiel
- **Transcript guests:** (none detected)

**Recommendation:** RSS title matches MDX title. Transcript opening had no clear guest tag — cannot auto-verify.

### Ep 228 — `228-at-work-in-the-ruins-retreat-w-dougald-hine-and-ashley.mdx`

- **MDX title:** At Work in the Ruins Retreat w/ Dougald Hine and Ashley
- **RSS title:** DO 228 - At Work in the Ruins Retreat w/ Dougald Hine and Ashley
- **MDX guest:** Dougald Hine
- **Transcript guests:** (none detected)

**Recommendation:** RSS title matches MDX title. Transcript opening had no clear guest tag — cannot auto-verify.

### Ep 231 — `231-chief-chainsaw-officer-with-jason.mdx`

- **MDX title:** Chief Chainsaw Officer with Jason
- **RSS title:** DO 231 - Chief Chainsaw Officer with Jason
- **MDX guest:** Jason
- **Transcript guests:** (none detected)

**Recommendation:** RSS title matches MDX title. Transcript opening had no clear guest tag — cannot auto-verify.

### Ep 233 — `233-do-emergency-2024-election-coverage-w-ashley-jason-nate-and-josh.mdx`

- **MDX title:** DO Emergency 2024 Election Coverage w/ Ashley, Jason, Nate and Josh
- **RSS title:** DO 233 - DO Emergency 2024 Election Coverage w/ Ashley, Jason, Nate and Josh
- **MDX guest:** Jason
- **Transcript guests:** (none detected)

**Recommendation:** RSS title matches MDX title. Transcript opening had no clear guest tag — cannot auto-verify.

### Ep 241 — `241-motherhood-sabbatical-w-ashley-and-sean-blanda.mdx`

- **MDX title:** Motherhood Sabbatical w/ Ashley and Sean Blanda
- **RSS title:** DO 241 - Motherhood Sabbatical w/ Ashley and Sean Blanda
- **MDX guest:** Sean Blanda
- **Transcript guests:** (none detected)

**Recommendation:** RSS title matches MDX title. Transcript opening had no clear guest tag — cannot auto-verify.

### Ep 244 — `244-do-egirl-crossover-w-twitter-s-audrey-horne-and-going-godward.mdx`

- **MDX title:** DO + egirl crossover w/ Twitter's Audrey Horne and Going Godward
- **RSS title:** DO 244 - DO + egirl crossover w/ Twitter's Audrey Horne and Going Godward
- **MDX guest:** Twitter's Audrey Horne
- **Transcript guests:** (none detected)

**Recommendation:** RSS title matches MDX title. Transcript opening had no clear guest tag — cannot auto-verify.

### Ep 249 — `249-nepa-babies-w-jimmy-tobias-james-pogue-and-ashley.mdx`

- **MDX title:** NEPA babies w/ Jimmy Tobias, James Pogue and Ashley
- **RSS title:** DO 249 - NEPA babies w/ Jimmy Tobias, James Pogue and Ashley
- **MDX guest:** Jimmy Tobias
- **Transcript guests:** (none detected)

**Recommendation:** RSS title matches MDX title. Transcript opening had no clear guest tag — cannot auto-verify.

### Ep 251 — `251-la-fires-w-leighton-woodhouse-and-james-pogue.mdx`

- **MDX title:** LA Fires w/ Leighton Woodhouse and James Pogue
- **RSS title:** DO 251 - LA Fires w/ Leighton Woodhouse and James Pogue
- **MDX guest:** LA Fires
- **Transcript guests:** (none detected)

**Recommendation:** RSS title matches MDX title. Transcript opening had no clear guest tag — cannot auto-verify.

### Ep 252 — `252-brick-and-mortar-localism-w-ben-lucy-longstory-farms-and-ashley.mdx`

- **MDX title:** Brick and Mortar Localism w/ Ben, Lucy, Longstory Farms and Ashley
- **RSS title:** DO 252 - Brick and Mortar Localism w/ Ben, Lucy, Longstory Farms and Ashley
- **MDX guest:** Ben
- **Transcript guests:** (none detected)

**Recommendation:** RSS title matches MDX title. Transcript opening had no clear guest tag — cannot auto-verify.

### Ep 254 — `254-the-spiritual-side-of-childbirth-w-leah-tallsnail-and-ashley.mdx`

- **MDX title:** The Spiritual Side of Childbirth w/ Leah @TallSnail and Ashley
- **RSS title:** DO 254 - The Spiritual Side of Childbirth w/ Leah @TallSnail and Ashley
- **MDX guest:** Leah
- **Transcript guests:** (none detected)

**Recommendation:** RSS title matches MDX title. Transcript opening had no clear guest tag — cannot auto-verify.

### Ep 255 — `255-post-woke-synthesis.mdx`

- **MDX title:** Post Woke Synthesis
- **RSS title:** DO 255 - Post Woke Synthesis
- **MDX guest:** (none)
- **Transcript guests:** (none detected)

**Recommendation:** RSS title matches MDX title. Transcript opening had no clear guest tag — cannot auto-verify.

### Ep 258 — `258-enchantment-magic-supernatural-technologies-w-historian-dr-francis-young.mdx`

- **MDX title:** Enchantment, Magic, & Supernatural technologies w/ Historian Dr. Francis Young
- **RSS title:** DO 258 - Enchantment, Magic, & Supernatural technologies w/ Historian Dr. Francis Young
- **MDX guest:** Historian Dr. Francis Young
- **Transcript guests:** (none detected)

**Recommendation:** RSS title matches MDX title. Transcript opening had no clear guest tag — cannot auto-verify.

### Ep 262 — `262-ontology-or-on-sunscreen-w-olek-pisera-and-ashley.mdx`

- **MDX title:** Ontology, or On Sunscreen w/ Olek Pisera and Ashley
- **RSS title:** DO 262 - Ontology, or On Sunscreen w/ Olek Pisera and Ashley
- **MDX guest:** Olek Pisera
- **Transcript guests:** (none detected)

**Recommendation:** RSS title matches MDX title. Transcript opening had no clear guest tag — cannot auto-verify.

### Ep 263 — `263-what-s-the-matter-with-texas-w-casey-spinks-and-james-decker.mdx`

- **MDX title:** What's the matter with Texas? w/ Casey Spinks and James Decker
- **RSS title:** DO 263 - What's the matter with Texas? w/ Casey Spinks and James Decker
- **MDX guest:** Casey Spinks
- **Transcript guests:** (none detected)

**Recommendation:** RSS title matches MDX title. Transcript opening had no clear guest tag — cannot auto-verify.

### Ep 264 — `264-natural-law-w-plasmarob-and-ashley.mdx`

- **MDX title:** Natural Law w/ PlasmaRob and Ashley
- **RSS title:** DO264 - Natural Law w/ PlasmaRob and Ashley
- **MDX guest:** PlasmaRob
- **Transcript guests:** (none detected)

**Recommendation:** RSS title matches MDX title. Transcript opening had no clear guest tag — cannot auto-verify.

### Ep 266 — `266-ashley-chris-and-jason.mdx`

- **MDX title:** Ashley, Chris, and Jason
- **RSS title:** DO 266 - Ashley, Chris, and Jason
- **MDX guest:** (none)
- **Transcript guests:** (none detected)

**Recommendation:** RSS title matches MDX title. Transcript opening had no clear guest tag — cannot auto-verify.

### Ep 268 — `268-matt-p-on-do.mdx`

- **MDX title:** Matt P on DO
- **RSS title:** DO 268 - Matt P on DO
- **MDX guest:** Matt
- **Transcript guests:** (none detected)

**Recommendation:** RSS title matches MDX title. Transcript opening had no clear guest tag — cannot auto-verify.

### Ep 270 — `270-leaving-the-20th-century-w-james-donald-and-ashley.mdx`

- **MDX title:** Leaving the 20th century w/ James, Donald and Ashley
- **RSS title:** DO 270 - Leaving the 20th century w/ James, Donald and Ashley
- **MDX guest:** Donald
- **Transcript guests:** (none detected)

**Recommendation:** RSS title matches MDX title. Transcript opening had no clear guest tag — cannot auto-verify.

### Ep 274 — `274-kentucky-catholicism-and-agrarian-revival.mdx`

- **MDX title:** Kentucky, Catholicism, and Agrarian Revival
- **RSS title:** DO 274 - Kentucky, Catholicism, and Agrarian Revival
- **MDX guest:** (none)
- **Transcript guests:** (none detected)

**Recommendation:** RSS title matches MDX title. Transcript opening had no clear guest tag — cannot auto-verify.

### Ep 276 — `276-peter-allen-how-to-become-a-keystone-species-and-restore-the-earth.mdx`

- **MDX title:** Peter Allen: How to Become a Keystone Species and Restore the Earth
- **RSS title:** DO 276 - Peter Allen: How to Become a Keystone Species and Restore the Earth
- **MDX guest:** Peter Allen
- **Transcript guests:** (none detected)

**Recommendation:** RSS title matches MDX title. Transcript opening had no clear guest tag — cannot auto-verify.

### Ep 279 — `279-community-bunkers-and-the-future-of-preparedness.mdx`

- **MDX title:** Community, Bunkers, and the Future of Preparedness
- **RSS title:** DO 279 - Community, Bunkers, and the Future of Preparedness
- **MDX guest:** (none)
- **Transcript guests:** (none detected)

**Recommendation:** RSS title matches MDX title. Transcript opening had no clear guest tag — cannot auto-verify.

### Ep 284 — `284-group-chat-live.mdx`

- **MDX title:** Group Chat Live
- **RSS title:** DO 284 - Group Chat Live
- **MDX guest:** (none)
- **Transcript guests:** (none detected)

**Recommendation:** RSS title matches MDX title. Transcript opening had no clear guest tag — cannot auto-verify.

### Ep 285 — `285-ai-and-the-95-extinction-threshold.mdx`

- **MDX title:** AI and The 95% Extinction Threshold
- **RSS title:** DO 285 - AI and The 95% Extinction Threshold
- **MDX guest:** (none)
- **Transcript guests:** (none detected)

**Recommendation:** RSS title matches MDX title. Transcript opening had no clear guest tag — cannot auto-verify.

### Ep 286 — `286-building-a-regenerative-landscaping-business-with-tres-of-greenbox-homes.mdx`

- **MDX title:** Building a Regenerative Landscaping Business with Tres of GreenBox Homes
- **RSS title:** DO 286 - Building a Regenerative Landscaping Business with Tres of GreenBox Homes
- **MDX guest:** Tres
- **Transcript guests:** (none detected)

**Recommendation:** RSS title matches MDX title. Transcript opening had no clear guest tag — cannot auto-verify.

### Ep 289 — `289-beef-bartering-and-the-agorist-s-guide-to-not-starving-with-nigel-nate-and-jason.mdx`

- **MDX title:** Beef, Bartering, and the Agorist's Guide to Not Starving with Nigel, Nate, and Jason
- **RSS title:** DO 289 - Beef, Bartering, and the Agorist's Guide to Not Starving with Nigel, Nate, and Jason
- **MDX guest:** Nigel Best
- **Transcript guests:** (none detected)

**Recommendation:** RSS title matches MDX title. Transcript opening had no clear guest tag — cannot auto-verify.

### Ep 290 — `290-distributism-local-commons-and-agrarian-futures-with-chris-smaje.mdx`

- **MDX title:** Distributism, Local Commons, and Agrarian Futures with Chris Smaje
- **RSS title:** DO 290 - Distributism, Local Commons, and Agrarian Futures with Chris Smaje
- **MDX guest:** Chris Smaje
- **Transcript guests:** (none detected)

**Recommendation:** RSS title matches MDX title. Transcript opening had no clear guest tag — cannot auto-verify.

### Ep 293 — `293-antitrust-law-beef-politics-and-actually-using-government-power.mdx`

- **MDX title:** Antitrust Law, Beef Politics, and Actually Using Government Power
- **RSS title:** DO 293 - Antitrust Law, Beef Politics, and Actually Using Government Power
- **MDX guest:** (none)
- **Transcript guests:** (none detected)

**Recommendation:** RSS title matches MDX title. Transcript opening had no clear guest tag — cannot auto-verify.

### Ep 303 — `303-ai-existential-risk-and-the-future-of-the-human-soul.mdx`

- **MDX title:** AI, Existential Risk, and the Future of the Human Soul
- **RSS title:** DO 303 - AI, Existential Risk, and the Future of the Human Soul
- **MDX guest:** Farron Morgan
- **Transcript guests:** (none detected)

**Recommendation:** RSS title matches MDX title. Transcript opening had no clear guest tag — cannot auto-verify.
