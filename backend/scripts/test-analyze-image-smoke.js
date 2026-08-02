/**
 * Smoke: analyze_image with a tiny PNG via getVisionConfig + executeAnalyzeImageTool.
 * Usage: node backend/scripts/test-analyze-image-smoke.js
 */
import { config } from 'dotenv';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: join(__dirname, '..', '.env') });
config({ path: join(__dirname, '../../deploy/.env') });

import { getVisionConfig } from '../src/config/tools.js';
import { executeAnalyzeImageTool } from '../src/services/image-vision-tools.js';

const cfg = getVisionConfig(null);
console.log('[smoke] vision config', {
  baseUrl: cfg.baseUrl,
  model: cfg.model,
  source: cfg.source,
  hasKey: Boolean(cfg.apiKey),
  error: cfg.error || null,
});
if (cfg.error || !cfg.apiKey) {
  console.error('[smoke] FAIL: vision not configured');
  process.exit(1);
}

const png = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64'
);

const out = await executeAnalyzeImageTool(
  {
    content_base64: png.toString('base64'),
    filename: 'pixel.png',
    mime_type: 'image/png',
    mode: 'describe',
    prompt: 'Say what color the pixel appears to be in one short sentence.',
  },
  'ceo-smoke-vision'
);
console.log('[smoke] ok', {
  mode: out.mode,
  model: out.model,
  chars: out.text?.length || 0,
  preview: String(out.text || '').slice(0, 200),
});
process.exit(0);
