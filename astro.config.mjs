import { defineConfig } from 'astro/config';
import mdx from '@astrojs/mdx';
import sitemap from '@astrojs/sitemap';
import tailwind from '@astrojs/tailwind';

const SITE = process.env.SITE_URL ?? 'https://jeromydarling.github.io';
const BASE = process.env.BASE_PATH ?? '/doomer-optimism';

export default defineConfig({
  site: SITE,
  base: BASE,
  trailingSlash: 'ignore',
  integrations: [
    mdx(),
    sitemap(),
    tailwind({ applyBaseStyles: false }),
  ],
  build: { format: 'directory' },
});
