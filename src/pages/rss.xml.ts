import rss from '@astrojs/rss';
import { getCollection } from 'astro:content';
import { site } from '../lib/site';
import type { APIContext } from 'astro';

export async function GET(context: APIContext) {
  const episodes = await getCollection('episodes', (e) => !e.data.draft);
  const articles = await getCollection('articles', (a) => !a.data.draft);

  const items = [
    ...episodes.map((e) => ({
      title: `Ep ${e.data.number} — ${e.data.title}`,
      pubDate: e.data.pubDate,
      description: e.data.summary,
      link: `/episodes/${e.slug}`,
    })),
    ...articles.map((a) => ({
      title: a.data.title,
      pubDate: a.data.pubDate,
      description: a.data.summary,
      link: `/library/${a.slug}`,
    })),
  ].sort((x, y) => y.pubDate.valueOf() - x.pubDate.valueOf());

  return rss({
    title: site.title,
    description: site.description,
    site: context.site ?? 'https://example.com',
    items,
    customData: '<language>en-us</language>',
  });
}
