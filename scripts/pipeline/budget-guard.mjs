// Pre-flight budget checks. Every paid stage calls `assertBudget()` before
// the API call. Failures don't throw — they return `{ ok: false, ... }`
// and the caller transitions the episode to WAITING_FOR_BUDGET.

const ELEVENLABS_API = 'https://api.elevenlabs.io';
const ANTHROPIC_API = 'https://api.anthropic.com';

// Per-episode hard ceiling. If costSoFar + projected > ceiling, abort.
export const PER_EPISODE_CEILING_USD = 10;
export const PER_EPISODE_ALERT_USD = 5;

export async function elevenLabsBalance() {
  const key = process.env.ELEVENLABS_API_KEY;
  if (!key) return { error: 'ELEVENLABS_API_KEY not set' };
  const res = await fetch(`${ELEVENLABS_API}/v1/user/subscription`, {
    headers: { 'xi-api-key': key },
  });
  if (!res.ok) return { error: `ElevenLabs ${res.status}` };
  const json = await res.json();
  // character_count is used credits; character_limit is total. Remaining = limit - count.
  const remaining = (json.character_limit || 0) - (json.character_count || 0);
  return { credits: remaining, raw: json };
}

export async function anthropicBalance() {
  // Anthropic doesn't expose a balance endpoint on the standard API.
  // We use a tiny ping call to verify auth + capacity instead.
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return { error: 'ANTHROPIC_API_KEY not set' };
  const res = await fetch(`${ANTHROPIC_API}/v1/messages`, {
    method: 'POST',
    headers: {
      'x-api-key': key,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 1,
      messages: [{ role: 'user', content: 'hi' }],
    }),
  });
  if (res.status === 401) return { error: 'auth' };
  if (res.status === 402) return { error: 'no credits' };
  if (res.status === 429) return { error: 'rate limited' };
  if (!res.ok) return { error: `Anthropic ${res.status}` };
  return { ok: true };
}

// Project transcription cost in USD given an episode's audio duration.
// Empirically ~3,300 credits per hour-long episode.
// $0.0001 per credit on the pay-per-use plan.
export function projectTranscribeCost(durationSeconds) {
  const credits = (durationSeconds / 60) * 55; // ~55 cred/min ≈ 3,300/hr
  const dollars = credits * 0.0001;
  return { credits, dollars };
}

// Project enrichment cost. Haiku 4.5 input ~ $1/Mtok, output ~ $5/Mtok.
// Typical episode transcript ~15k input tokens, ~3k output tokens.
export function projectEnrichCost(transcriptChars) {
  const inputTokens = transcriptChars / 4; // rough
  const outputTokens = 3000;
  return {
    dollars: (inputTokens * 1) / 1_000_000 + (outputTokens * 5) / 1_000_000,
  };
}

// Generic guard. Call BEFORE the paid API hit.
export async function assertBudget({ provider, projectedDollars, episode }) {
  // Episode-level ceiling
  const after = (episode.costSoFar || 0) + projectedDollars;
  if (after > PER_EPISODE_CEILING_USD) {
    return {
      ok: false,
      reason: 'ceiling',
      message: `Episode ${episode.id} would exceed $${PER_EPISODE_CEILING_USD} ceiling (so far: $${(episode.costSoFar || 0).toFixed(2)}, projected: $${projectedDollars.toFixed(2)}).`,
    };
  }
  // Provider balance
  if (provider === 'elevenlabs') {
    const bal = await elevenLabsBalance();
    if (bal.error) return { ok: false, reason: 'unreachable', message: bal.error };
    const projectedCredits = projectedDollars / 0.0001;
    if (projectedCredits > bal.credits * 0.95) {
      return {
        ok: false,
        reason: 'insufficient-balance',
        provider,
        need: projectedCredits,
        have: bal.credits,
        message: `Need ~${Math.ceil(projectedCredits)} ElevenLabs credits, have ${bal.credits}.`,
      };
    }
    return { ok: true, balance: bal.credits };
  }
  if (provider === 'anthropic') {
    const bal = await anthropicBalance();
    if (bal.error === 'no credits') {
      return { ok: false, reason: 'insufficient-balance', provider, message: 'Anthropic 402 — out of credits.' };
    }
    if (bal.error) return { ok: false, reason: 'unreachable', message: bal.error };
    return { ok: true };
  }
  // For Adobe / Buffer: assume ok (subscription-based, not pay-per-call).
  return { ok: true };
}
