/**
 * Smoke: generate_chart renders SVGs from chart_spec JSON.
 * Usage: node scripts/test-generate-chart.js
 */
import { config } from 'dotenv';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { existsSync } from 'fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: join(__dirname, '..', '.env') });

import { getOpenClawMediaDir } from '../src/config/openclaw-paths.js';
import {
  generateChartsFromSpec,
  chartSpecSchemaSummary,
  CHART_SPEC_VERSION,
} from '../src/services/chart-spec.js';

const schema = chartSpecSchemaSummary();
if (schema.schema_version !== CHART_SPEC_VERSION) throw new Error('schema version mismatch');
if (!schema.schema?.properties?.charts) throw new Error('missing schema.charts');

const mediaDir = getOpenClawMediaDir('generated');
const out = generateChartsFromSpec(
  {
    schema_version: '1.0',
    charts: [
      {
        type: 'vedic_north_indian',
        id: 'd1_north',
        title: 'Test North',
        lagna_sign_index: 11,
        planets: [
          { abbr: 'Su', sign_index: 0, house: 2 },
          { abbr: 'Mo', sign_index: 3, house: 5 },
        ],
      },
      {
        type: 'vedic_south_indian',
        id: 'd1_south',
        title: 'Test South',
        lagna_sign_index: 11,
        planets: [
          { abbr: 'Su', sign_index: 0, house: 2 },
          { abbr: 'Mo', sign_index: 3, house: 5 },
        ],
      },
      {
        type: 'labeled_grid',
        id: 'summary',
        title: 'Summary',
        columns: 2,
        cells: [
          { label: 'Lagna', value: 'Pisces' },
          { label: 'Moon', value: 'Cancer' },
        ],
      },
    ],
  },
  { mediaDir }
);

if (!out.chart_urls?.d1_north || !out.chart_urls?.d1_south) throw new Error('missing chart urls');
if (!out.visuals_markdown?.includes(out.chart_urls.d1_north)) throw new Error('visuals_markdown order');
const northFile = join(mediaDir, out.chart_urls.d1_north.split('/').pop());
if (!existsSync(northFile)) throw new Error('north svg missing on disk');
console.log('OK urls', Object.keys(out.chart_urls).join(','));
console.log('PASS generate_chart');
