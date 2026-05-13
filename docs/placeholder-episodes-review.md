# Placeholder episodes — needs manual reconciliation

Run: 2026-05-13T22:57:35.411Z

These 11 MDX files were scaffolded as part of the v0 site before the Anchor RSS backfill pipeline existed. They have placeholder titles + guests that don't match the real Anchor episode at the same number. Their transcripts are real podcast content but they've been **marked `draft: true`** in this pass so they stop appearing on the public site.

For each row, Ashley decides one of:
- **Rewrite**: update title + guest + summary to match RSS, then keep the file. Best when the transcript is from the matching RSS audio.
- **Delete**: drop the file. Best when the transcript is unrelated content. The auto-watcher will pick up the real episode from RSS later.
- **Keep as-is**: leave drafted indefinitely if the content is worth preserving for some other reason.

| Ep | Current MDX title | Current MDX guest | Real Anchor title | audioUrl |
|----|-------------------|-------------------|-------------------|----------|
| 247 | The Classical Homeschool & the Coop | Anna Mussmann | What ever happened to climate? w/ Ilan Kelman, James Pogue and Ashley | `https://anchor.fm/s/68308b7c/podcast/play/96174901/https%3A%…` |
| 253 | Beyond the War on Invasives | Tao Orion | Plough Magazine and the Bruderhof w/ Alan Koppschall | `https://anchor.fm/s/68308b7c/podcast/play/97620311/https%3A%…` |
| 260 | Fatherhood After the Internet | Tucker Max | Hannah's Children w/ Catherine Pakaluk, Roxanne Ahern and Ashley | `https://anchor.fm/s/68308b7c/podcast/play/100009300/https%3A…` |
| 265 | Rural Labor, Trade Schools & the Right to Fix Your Own Truck | Rep. Marie Gluesenkamp Perez | Transition Engineering with Susan Krumdieck and Josh | `https://anchor.fm/s/68308b7c/podcast/play/101792219/https%3A…` |
| 269 | Stone, Lime & the Long Building | Patrick Lemmon | Engineering, education, empathy, and memetic warfare? Dr. Chuck Pezeshki & Josh | `https://anchor.fm/s/68308b7c/podcast/play/103939337/https%3A…` |
| 273 | Dark Aeon — Reading the Transhumanist Project | Joe Allen | The Future of DO with Ashley, Jason, and James | `https://anchor.fm/s/68308b7c/podcast/play/106172305/https%3A…` |
| 278 | A Small Farm Future, Honestly Argued | Chris Smaje | Thriving Through Homesteading | `https://anchor.fm/s/68308b7c/podcast/play/107706998/https%3A…` |
| 282 | Trucks, Tractors, and the Locked-Down Economy | Gord Magill | John Heers and Ashley on Learning Humility from Georgian Dinners and Forgotten Villages | `https://anchor.fm/s/68308b7c/podcast/play/109025470/https%3A…` |
| 287 | Land, Place & the End of the Long Boom | James Pogue | Graze Against the Machine: Breaking Up Big Ag, Rewilding America, and the Future of Food | `https://anchor.fm/s/68308b7c/podcast/play/110683419/https%3A…` |
| 291 | The Strong Town & the Suburban Experiment | Chuck Marohn | Building an Edible Perennial Nursery with Nick Wrenn of Living Soil Tree Farm | `https://anchor.fm/s/68308b7c/podcast/play/111477161/https%3A…` |
| 296 | Restoring the Oak Savanna | Peter Allen | Building Community in Fragmented Times | `https://anchor.fm/s/68308b7c/podcast/play/114289439/https%3A…` |