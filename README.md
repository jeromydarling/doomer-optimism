# Doomer Optimism — site

The hub for [Doomer Optimism](https://substack.com/@doomeroptimism) — a podcast hosted by [Ashley Colby Fitzgerald](https://rizomafieldschool.com) on how to live well in the age of the Machine.

This repository builds the static site that holds the full episode archive, categorized research library, contributor pages, events, and the searchable bibliography across all episodes. It is deployed to GitHub Pages from the `claude/doomer-optimism-site-Ime4V` branch via GitHub Actions.

## Quick start

```bash
nvm use            # picks up Node 22
npm install
npm run dev        # http://localhost:4321
npm run build      # Astro build + Pagefind index
```

## Stack

- [Astro 5](https://astro.build) with content collections and MDX
- [Tailwind CSS](https://tailwindcss.com) with a parchment + earth-tone palette
- [`@fontsource`](https://fontsource.org) for self-hosted **EB Garamond** + **Cormorant Garamond** + **Inter**
- [Pagefind](https://pagefind.app) for client-side full-text search

## Repo map

```
src/
  content/
    config.ts         # collection schemas
    episodes/         # one MDX per episode
    pillars/          # the six content pillars
    contributors/     # hosts + lead voices + recurring guests
    articles/         # companion essays
    events/           # annual gatherings
  layouts/            # base layouts
  components/         # SiteHeader, EpisodeCard, HedcutPlaceholder, etc.
  pages/              # routes
  lib/site.ts         # metadata + helpers
.github/workflows/deploy.yml   # Pages deploy
CLAUDE.md             # contributor guide for Claude Code agents
```

## Adding an episode

Create `src/content/episodes/{number}-{guest-slug}.mdx` matching the schema in `src/content/config.ts`. Push to `claude/doomer-optimism-site-Ime4V` — GitHub Actions builds and deploys.

## License

Content © Doomer Optimism. Source code under MIT.
