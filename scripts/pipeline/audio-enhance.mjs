// Speech enhancement stage. Adobe MCP `media_enhance_speech` removes
// noise / normalizes loudness / de-esses.
//
// Important: Adobe MCP is currently a Claude Code session-bound server.
// It is NOT available from headless GitHub Actions. We stub this stage
// to a pass-through and surface a MANUAL_OVERRIDE hint in the state
// file when Adobe credentials aren't present.
//
// When Adobe ships a service-account API token (or we wire the Claude
// SDK to call an MCP server from CI), flip the `if` below and call
// the real endpoint.

import { copyFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

export async function enhanceSpeech(inputPath, outputPath) {
  mkdirSync(dirname(outputPath), { recursive: true });
  if (!process.env.ADOBE_MCP_TOKEN) {
    // Pass-through. Mark as not-actually-enhanced so /admin can warn Ashley.
    copyFileSync(inputPath, outputPath);
    return {
      path: outputPath,
      enhanced: false,
      reason: 'Adobe MCP not wired for headless CI; pass-through.',
    };
  }
  // TODO: real Adobe MCP call once the headless story exists.
  copyFileSync(inputPath, outputPath);
  return { path: outputPath, enhanced: false, reason: 'TODO: implement Adobe call' };
}
