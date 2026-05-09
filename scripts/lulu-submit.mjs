#!/usr/bin/env node
/**
 * scripts/lulu-submit.mjs
 *
 * Submit a print job to the Lulu Print API for a given Annual.
 *
 * Workflow:
 *   1. Render /annual/{year} and /annual/{year}/cover in Chrome → save PDFs to
 *      public/annual/{year}/interior.pdf and public/annual/{year}/cover.pdf
 *   2. Commit + push so they deploy to GitHub Pages and become public URLs
 *   3. Run this script with shipping address + contact email
 *
 * Usage:
 *   LULU_CLIENT_KEY=… LULU_CLIENT_SECRET=… node scripts/lulu-submit.mjs \
 *     --year 2026 \
 *     --to-name "Ashley Colby Fitzgerald" \
 *     --to-street1 "123 Main St" \
 *     --to-city "Colonia" \
 *     --to-state "CO" \
 *     --to-postcode "70000" \
 *     --to-country "UY" \
 *     --to-email "ashley@rizomafieldschool.com" \
 *     --to-phone "+1 555 555 5555" \
 *     --quantity 1 \
 *     [--site-base "https://jeromydarling.github.io/doomer-optimism"] \
 *     [--sandbox]    # use api.sandbox.lulu.com (test prints, not billed)
 *     [--dry-run]    # build the request body, log it, do not submit
 *
 * Lulu credentials:
 *   developers.lulu.com → My Apps → create a Client Credentials app.
 *   You get a Key + Secret (or, in their UI, a single base64-encoded
 *   "Authorization" string — paste into LULU_CLIENT_KEY and leave SECRET empty).
 */

import { Buffer } from 'node:buffer';

const args = parseArgs(process.argv.slice(2));
const YEAR = Number(args.year ?? new Date().getFullYear());
const QTY = Number(args.quantity ?? 1);
const SANDBOX = !!args.sandbox;
const DRY = !!args['dry-run'];
const SITE = (args['site-base'] ?? 'https://jeromydarling.github.io/doomer-optimism').replace(/\/$/, '');

const LULU_BASE = SANDBOX ? 'https://api.sandbox.lulu.com' : 'https://api.lulu.com';
const LULU_AUTH = SANDBOX
  ? 'https://api.sandbox.lulu.com/auth/realms/glasstree/protocol/openid-connect/token'
  : 'https://api.lulu.com/auth/realms/glasstree/protocol/openid-connect/token';

// 6×9 paperback, B&W interior on 60# cream uncoated, perfect bound — Lulu's
// preferred POD package for trade paperbacks. See the Lulu price calculator
// for alternates (e.g. hardcover, premium colour) once we want to upsell.
const POD_PACKAGE_ID = args['pod-package-id'] ?? '0600X0900BWSTDPB060UW444MXX';

const KEY = process.env.LULU_CLIENT_KEY;
const SECRET = process.env.LULU_CLIENT_SECRET ?? '';

if (!KEY) {
  console.error('LULU_CLIENT_KEY is required (paste from developers.lulu.com → My Apps).');
  console.error('If your app shows a single base64 "Authorization" string, set LULU_CLIENT_KEY to it and leave LULU_CLIENT_SECRET unset.');
  process.exit(1);
}

const required = ['to-name', 'to-street1', 'to-city', 'to-postcode', 'to-country', 'to-email'];
for (const r of required) {
  if (!args[r]) {
    console.error(`Missing required arg --${r}`);
    process.exit(1);
  }
}

const interiorUrl = `${SITE}/annual/${YEAR}/interior.pdf`;
const coverUrl = `${SITE}/annual/${YEAR}/cover.pdf`;

const body = {
  contact_email: args['to-email'],
  external_id: `doomer-optimism-annual-${YEAR}-${Date.now()}`,
  line_items: [
    {
      external_id: `annual-${YEAR}`,
      printable_normalization: {
        cover: { source_url: coverUrl },
        interior: { source_url: interiorUrl },
        pod_package_id: POD_PACKAGE_ID,
      },
      quantity: QTY,
      title: `The Doomer Optimism Annual ${YEAR}`,
    },
  ],
  shipping_address: {
    name: args['to-name'],
    street1: args['to-street1'],
    street2: args['to-street2'] ?? undefined,
    city: args['to-city'],
    state_code: args['to-state'] ?? undefined,
    postcode: args['to-postcode'],
    country_code: args['to-country'].toUpperCase(),
    phone_number: args['to-phone'] ?? undefined,
    email: args['to-email'],
  },
  shipping_level: args['shipping-level'] ?? 'MAIL',
};

console.log('Print-job request body:');
console.log(JSON.stringify(body, null, 2));

if (DRY) {
  console.log('');
  console.log('Dry run — exiting before submission.');
  console.log('Verify the URLs are publicly accessible:');
  console.log(' ', interiorUrl);
  console.log(' ', coverUrl);
  process.exit(0);
}

console.log('');
console.log(`Authenticating with Lulu (${SANDBOX ? 'SANDBOX' : 'PRODUCTION'})…`);
const accessToken = await getAccessToken();

console.log('Submitting print job…');
const res = await fetch(`${LULU_BASE}/print-jobs/`, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${accessToken}`,
    'Accept': 'application/json',
  },
  body: JSON.stringify(body),
});

if (!res.ok) {
  const text = await res.text();
  console.error(`Lulu ${res.status}: ${text}`);
  process.exit(1);
}

const job = await res.json();
console.log('');
console.log(`✓ Print job created.`);
console.log(`  ID: ${job.id}`);
console.log(`  Status: ${job.status?.name ?? '(unknown)'}`);
console.log(`  Tracking URL: ${LULU_BASE.replace('api.', '')}/print-jobs/${job.id}/`);
console.log('');
console.log('Lulu validates the PDFs over the next few minutes. Status flows:');
console.log('  CREATED → UNPAID → PAYMENT_IN_PROGRESS → PRODUCTION_READY → IN_PRODUCTION → SHIPPED');

// =================================================================================

async function getAccessToken() {
  // Lulu accepts either OAuth2 client_credentials (key + secret) OR a single
  // base64 "Authorization: Basic …" header pasted as KEY (no SECRET).
  const auth = SECRET
    ? 'Basic ' + Buffer.from(`${KEY}:${SECRET}`, 'utf8').toString('base64')
    : KEY.startsWith('Basic ') ? KEY : `Basic ${KEY}`;

  const res = await fetch(LULU_AUTH, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Authorization': auth,
    },
    body: 'grant_type=client_credentials',
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Auth failed (${res.status}): ${text}`);
  }
  const j = await res.json();
  return j.access_token;
}

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const eq = a.indexOf('=');
      if (eq >= 0) out[a.slice(2, eq)] = a.slice(eq + 1);
      else if (argv[i + 1] && !argv[i + 1].startsWith('--')) out[a.slice(2)] = argv[++i];
      else out[a.slice(2)] = true;
    }
  }
  return out;
}
