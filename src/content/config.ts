import { defineCollection, reference, z } from 'astro:content';

const pillars = defineCollection({
  type: 'content',
  schema: z.object({
    title: z.string(),
    shortTitle: z.string().optional(),
    blurb: z.string(),
    accent: z.enum(['terracotta', 'moss', 'umber', 'oxblood']).default('terracotta'),
    order: z.number(),
    leadVoice: z.string().optional(),
  }),
});

const contributors = defineCollection({
  type: 'content',
  schema: z.object({
    name: z.string(),
    role: z.string().optional(),
    affiliation: z.string().optional(),
    bio: z.string(),
    pillars: z.array(reference('pillars')).default([]),
    portrait: z.string().optional(),
    portraitCredit: z.string().optional(),
    links: z
      .object({
        website: z.string().url().optional(),
        twitter: z.string().optional(),
        substack: z.string().url().optional(),
        wikipedia: z.string().url().optional(),
      })
      .optional(),
    featured: z.boolean().default(false),
  }),
});

const episodes = defineCollection({
  type: 'content',
  schema: z.object({
    number: z.number(),
    title: z.string(),
    // Guest is optional because panel/solo episodes don't have a single
    // identifiable guest, and the bot pipeline omits the field rather than
    // writing a "Speaker B" sentinel.
    guest: z.string().optional(),
    guestSlug: reference('contributors').optional(),
    pubDate: z.coerce.date(),
    durationSeconds: z.number().int().nonnegative(),
    pillar: reference('pillars'),
    secondaryPillar: reference('pillars').optional(),
    summary: z.string(),
    youtubeId: z.string().optional(),
    audioUrl: z.string().url().optional(),
    substackUrl: z.string().url().optional(),
    bibliography: z
      .array(
        z.object({
          title: z.string(),
          author: z.string().optional(),
          year: z.number().optional(),
          href: z.string().url().optional(),
          isbn: z.string().optional(),
          // Haiku emits a long tail of values here ("publication", "website",
          // "essay", etc.) that don't all map cleanly to our preferred enum.
          // Accept any string; BibliographyLink picks rendering by ISBN/href.
          kind: z.string().default('article'),
        }),
      )
      .default([]),
    transcript: z.string().optional(),
    featured: z.boolean().default(false),
    draft: z.boolean().default(false),
  }),
});

const articles = defineCollection({
  type: 'content',
  schema: z.object({
    title: z.string(),
    subtitle: z.string().optional(),
    author: z.string(),
    pubDate: z.coerce.date(),
    pillar: reference('pillars'),
    episode: reference('episodes').optional(),
    summary: z.string(),
    readingMinutes: z.number().int().positive().default(8),
    substackUrl: z.string().url().optional(),
    featured: z.boolean().default(false),
    draft: z.boolean().default(false),
  }),
});

const events = defineCollection({
  type: 'content',
  schema: z.object({
    title: z.string(),
    location: z.string(),
    startDate: z.coerce.date(),
    endDate: z.coerce.date().optional(),
    summary: z.string(),
    status: z.enum(['upcoming', 'past', 'tentative']).default('upcoming'),
    registrationUrl: z.string().url().optional(),
  }),
});

export const collections = { pillars, contributors, episodes, articles, events };
