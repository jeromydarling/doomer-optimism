export const site = {
  title: 'Doomer Optimism',
  tagline: 'Living well in the age of the Machine.',
  description:
    'A pluralistic conversation about how to build human-scale, regenerative, and rooted communities — clear-eyed about systemic fragility, hopeful about the work of rebuilding.',
  host: 'Ashley Colby Fitzgerald',
  episodeCount: '300+',
  founded: 2021,
  social: {
    youtube: 'https://www.youtube.com/@doomeroptimism',
    substack: 'https://substack.com/@doomeroptimism',
    twitter: 'https://x.com/DoomerOptimism',
    apple: 'https://podcasts.apple.com/us/podcast/doomer-optimism/id1561218755',
    spotify: 'https://anchor.fm/doomer-optimism',
  },
  sponsor: {
    name: 'CROS',
    tagline: 'replacing Silicon Valley with Sanctus Valley.',
    href: 'https://thecros.app',
  },
  // Stable URLs for the auto-rendered 60-second promo. Updated on
  // every render-promo workflow run via a rolling tag, so these
  // links never break across re-renders.
  promo: {
    videoUrl:
      'https://github.com/jeromydarling/doomer-optimism/releases/download/latest-promo/promo.mp4',
    posterUrl:
      'https://github.com/jeromydarling/doomer-optimism/releases/download/latest-promo/poster.jpg',
  },
} as const;

export const pillarOrder = [
  'regenerative-agriculture',
  'conservation-environment',
  'built-environment',
  'technology-ai-transhumanism',
  'right-to-repair-surveillance',
  'tech-limited-child-rearing',
] as const;

export type PillarSlug = (typeof pillarOrder)[number];

export const formatDate = (d: Date | string) => {
  const date = typeof d === 'string' ? new Date(d) : d;
  return date.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
};

export const formatDuration = (seconds: number) => {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (h) return `${h}h ${m}m`;
  return `${m} min`;
};

export const withBase = (path: string) => {
  const base = (import.meta.env.BASE_URL ?? '/').replace(/\/$/, '');
  if (!path.startsWith('/')) path = '/' + path;
  return base + path;
};

/**
 * Build a Bookshop.org link for a book title via its ISBN. When
 * BOOKSHOP_AFFILIATE_ID is set in the build environment the link routes
 * through the configured affiliate; otherwise it's a plain Bookshop URL
 * (still useful to readers, just no commission). Returns null for
 * missing/invalid ISBNs so callers can fall back to plain italic text.
 */
export const bookshopUrl = (isbn?: string | null): string | null => {
  if (!isbn) return null;
  const clean = String(isbn).replace(/[^0-9X]/gi, '');
  if (clean.length !== 10 && clean.length !== 13) return null;
  const id = String(import.meta.env.BOOKSHOP_AFFILIATE_ID ?? '').trim();
  return id
    ? `https://bookshop.org/a/${id}/${clean}`
    : `https://bookshop.org/p/books/_/${clean}`;
};
