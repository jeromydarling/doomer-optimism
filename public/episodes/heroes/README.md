# Episode hero images

Edited two-shot photos of host + guest, used as the hero on each episode
detail page and as the homepage's "latest episode" card.

## Spec
- **Aspect ratio:** 16:9 (e.g. 1600 × 900 or 1200 × 675)
- **Format:** JPG (preferred) or PNG
- **Composition:** host + guest, both clearly visible, looking at camera or
  in conversation. Studio lighting or warm room light. Not a YouTube
  screenshot.
- **Filename:** match the MDX slug — e.g. `296-peter-allen-keystone-restoration.jpg`
  matches `src/content/episodes/296-peter-allen-keystone-restoration.mdx`
- **Wire into the episode**: in the MDX frontmatter add:
  ```yaml
  heroImage: /episodes/heroes/296-peter-allen-keystone-restoration.jpg
  heroImageCredit: "Photo by Jane Doe"   # optional
  ```

## Reference
Ashley's reference is [The Sacred substack](https://www.thesacredpodcast.com)
— large bold title, italic subtitle, small avatar byline, a polished
two-shot of host + guest in the hero slot. The site's episode page
auto-falls-back to a typographic card if `heroImage` isn't set, so adding
images is incremental.
