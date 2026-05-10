// Download a file from Google Drive using the API (NOT the public share
// link, which trips the virus-scan interstitial for files >100MB).
//
// Auth: refresh-token flow. We exchange the refresh token for an access
// token at runtime, then GET .../files/{id}?alt=media.

import { createWriteStream, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

async function getAccessToken() {
  const { GOOGLE_OAUTH_CLIENT_ID, GOOGLE_OAUTH_CLIENT_SECRET, GOOGLE_DRIVE_REFRESH_TOKEN } = process.env;
  if (!GOOGLE_OAUTH_CLIENT_ID || !GOOGLE_OAUTH_CLIENT_SECRET || !GOOGLE_DRIVE_REFRESH_TOKEN) {
    throw new Error('Drive OAuth env vars missing.');
  }
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: GOOGLE_OAUTH_CLIENT_ID,
      client_secret: GOOGLE_OAUTH_CLIENT_SECRET,
      refresh_token: GOOGLE_DRIVE_REFRESH_TOKEN,
      grant_type: 'refresh_token',
    }),
  });
  if (!res.ok) throw new Error(`Token refresh failed: ${res.status} ${await res.text()}`);
  const json = await res.json();
  return json.access_token;
}

export async function getDriveMetadata(fileId) {
  const token = await getAccessToken();
  const res = await fetch(
    `https://www.googleapis.com/drive/v3/files/${fileId}?fields=id,name,size,mimeType,createdTime,modifiedTime`,
    { headers: { authorization: `Bearer ${token}` } },
  );
  if (!res.ok) throw new Error(`Drive metadata ${res.status}: ${await res.text()}`);
  return res.json();
}

export async function downloadDriveFile(fileId, outPath) {
  const token = await getAccessToken();
  mkdirSync(dirname(outPath), { recursive: true });
  const res = await fetch(
    `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`,
    { headers: { authorization: `Bearer ${token}` } },
  );
  if (!res.ok) throw new Error(`Drive download ${res.status}: ${await res.text().catch(() => '')}`);
  await pipeline(Readable.fromWeb(res.body), createWriteStream(outPath));
  return outPath;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [fileId, outPath] = process.argv.slice(2);
  if (!fileId || !outPath) {
    console.error('Usage: node drive-fetch.mjs <fileId> <outPath>');
    process.exit(1);
  }
  const meta = await getDriveMetadata(fileId);
  console.log('Drive metadata:', meta);
  await downloadDriveFile(fileId, outPath);
  console.log(`Downloaded to ${outPath}`);
}
