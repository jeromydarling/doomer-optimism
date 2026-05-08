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
    name: 'TheCROS',
    tagline: 'Catholic Social Teaching, encoded.',
    href: 'https://thecros.app',
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
