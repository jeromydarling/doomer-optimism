// Buffer GraphQL API client. Schedules posts across IG, Threads, X, LinkedIn.
//
// We never post to TikTok (per Ashley's call). We never post to YouTube via
// Buffer (YouTube requires the channel owner; Ashley uploads YT manually
// and we just surface the cut clip in /admin for her to download).
//
// Buffer Essentials limits us to 6 channels, unlimited queue, 60 req/min.
// We schedule with min 4h gaps between platforms to avoid burst-y release.

const BUFFER_GRAPHQL = 'https://graphql.buffer.com/';

async function bufferRequest(query, variables = {}) {
  const token = process.env.BUFFER_API_TOKEN;
  if (!token) throw new Error('BUFFER_API_TOKEN not set');
  const res = await fetch(BUFFER_GRAPHQL, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ query, variables }),
  });
  if (!res.ok) throw new Error(`Buffer ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const json = await res.json();
  if (json.errors) throw new Error(`Buffer GraphQL: ${JSON.stringify(json.errors)}`);
  return json.data;
}

export async function listChannels() {
  const data = await bufferRequest(`query { viewer { channels { id name service } } }`);
  return data?.viewer?.channels || [];
}

const CHANNEL_ALIAS = {
  instagram: ['instagram'],
  threads: ['threads'],
  twitter: ['twitter', 'x'],
  linkedin: ['linkedin'],
};

export function pickChannelIds(channels, requestedAliases) {
  const out = [];
  for (const alias of requestedAliases) {
    const services = CHANNEL_ALIAS[alias] || [alias];
    const match = channels.find((c) => services.includes(c.service));
    if (match) out.push({ alias, channelId: match.id });
  }
  return out;
}

export async function schedulePost({ channelId, text, mediaUrl, scheduledAt }) {
  // Buffer's create-update mutation. Schema may vary by API version;
  // adjust if Buffer ships breaking changes.
  const mutation = `
    mutation CreateUpdate($input: CreatePostInput!) {
      createPost(input: $input) { id status }
    }
  `;
  const input = {
    channelIds: [channelId],
    text,
    media: mediaUrl ? [{ url: mediaUrl }] : undefined,
    scheduledAt,
  };
  return bufferRequest(mutation, { input });
}

// Stagger posts: base time + 4h * index per platform.
export function stagger(baseIso, count, gapHours = 4) {
  const base = new Date(baseIso).getTime();
  const out = [];
  for (let i = 0; i < count; i++) {
    out.push(new Date(base + i * gapHours * 3600 * 1000).toISOString());
  }
  return out;
}
