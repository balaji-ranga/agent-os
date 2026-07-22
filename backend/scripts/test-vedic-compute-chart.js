/**
 * Smoke: vedic_compute_chart returns chart_spec; generate_chart renders it.
 * Usage: node scripts/test-vedic-compute-chart.js
 */
import { config } from 'dotenv';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { existsSync } from 'fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: join(__dirname, '..', '.env') });

import { getOpenClawMediaDir } from '../src/config/openclaw-paths.js';
import { computeVedicChart } from '../src/services/vedic-chart.js';
import { generateChartsFromSpec } from '../src/services/chart-spec.js';

const mediaDir = getOpenClawMediaDir('generated');
const out = computeVedicChart({
  birth_date: '1990-05-15',
  birth_time: '14:30',
  timezone_offset_hours: 5.5,
  latitude: 13.0827,
  longitude: 80.2707,
  place_name: 'Chennai',
  chart_style: 'both',
  include_navamsa: true,
  include_dasha: true,
});

if (!out.lagna?.sign) throw new Error('missing lagna');
if (!out.planets?.length) throw new Error('missing planets');
if (!out.chart_spec?.charts?.length) throw new Error('missing chart_spec');
if (out.north_chart_url) throw new Error('vedic_compute_chart must not render SVG urls');

const rendered = generateChartsFromSpec({ spec: out.chart_spec }, { mediaDir });
if (!rendered.chart_urls?.d1_north || !rendered.chart_urls?.d1_south) {
  throw new Error('generate_chart missing d1 urls');
}
const northFile = join(mediaDir, rendered.chart_urls.d1_north.split('/').pop());
if (!existsSync(northFile)) throw new Error('north svg not on disk');

console.log('OK lagna', out.lagna.sign, 'planets', out.planets.length);
console.log('OK chart_spec charts', out.chart_spec.charts.length);
console.log('OK rendered', Object.keys(rendered.chart_urls).join(','));
if (out.dasha?.current) console.log('OK dasha', out.dasha.current.lord);
console.log('PASS vedic_compute_chart + generate_chart');
