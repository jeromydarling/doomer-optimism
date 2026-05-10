// Scribe v2 transcription, factored out of the backfill script so the
// pipeline can call it on a single audio file.
//
// Reuses the keyterm prompting + no_verbatim flags + self-heal retry from
// scripts/transcribe-backfill.mjs. Returns the parsed JSON response.

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

const SCRIBE_KEYTERMS = [
  'Doomer Optimism', 'Ashley Colby Fitzgerald', 'Rizoma Field School',
  'Wendell Berry', 'Paul Kingsnorth', 'Ivan Illich', 'Christopher Lasch',
  'Morris Berman', 'Alasdair MacIntyre', 'Patrick Deneen', 'Charles Taylor',
  'Allan Carlson', 'Rod Dreher', 'Chris Smaje',
  'regenerative agriculture', 'permaculture', 'distributism', 'localism',
  'right to repair', 'Catholic Social Teaching', 'tech-limited childhood',
  'Sanctus Valley', 'CROS',
];

export async function transcribeWithScribe(audioPath, opts = {}) {
  const key = process.env.ELEVENLABS_API_KEY;
  if (!key) throw new Error('ELEVENLABS_API_KEY not set');

  const buf = readFileSync(audioPath);
  const blob = new Blob([buf]);

  const buildForm = ({ skipKeyterms = false, skipNoVerbatim = false } = {}) => {
    const form = new FormData();
    form.append('model_id', 'scribe_v2');
    form.append('file', blob, audioPath.split('/').pop());
    form.append('diarize', 'true');
    form.append('language_code', 'en');
    if (!skipKeyterms) form.append('keyterms', JSON.stringify(SCRIBE_KEYTERMS));
    if (!skipNoVerbatim) form.append('no_verbatim', 'true');
    return form;
  };

  let res = await fetch('https://api.elevenlabs.io/v1/speech-to-text', {
    method: 'POST',
    headers: { 'xi-api-key': key },
    body: buildForm(),
  });

  // Self-heal: if Scribe v2 rejects keyterms or no_verbatim (e.g. param
  // renamed in a future API version), retry without them rather than failing.
  if (!res.ok && res.status >= 400 && res.status < 500) {
    const errBody = await res.text();
    const skipKeyterms = /keyterms?/i.test(errBody);
    const skipNoVerbatim = /no_?verbatim/i.test(errBody);
    if (skipKeyterms || skipNoVerbatim) {
      console.log(`  Scribe ${res.status}; retrying without ${[skipKeyterms && 'keyterms', skipNoVerbatim && 'no_verbatim'].filter(Boolean).join(' + ')}`);
      res = await fetch('https://api.elevenlabs.io/v1/speech-to-text', {
        method: 'POST',
        headers: { 'xi-api-key': key },
        body: buildForm({ skipKeyterms, skipNoVerbatim }),
      });
    } else {
      throw new Error(`Scribe ${res.status}: ${errBody.slice(0, 200)}`);
    }
  }
  if (!res.ok) throw new Error(`Scribe ${res.status}: ${(await res.text()).slice(0, 200)}`);

  const json = await res.json();
  if (opts.outPath) {
    mkdirSync(dirname(opts.outPath), { recursive: true });
    writeFileSync(opts.outPath, JSON.stringify(json, null, 2));
  }
  return json;
}
