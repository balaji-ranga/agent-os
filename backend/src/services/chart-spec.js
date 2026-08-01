/**
 * Generic chart generation from a versioned JSON chart_spec.
 * Agents / LLMs produce JSON matching CHART_SPEC_SCHEMA; this module validates and renders SVGs.
 */
import { writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { randomUUID } from 'crypto';
import { enrichGeneratedOpenClawMedia } from './media-url.js';

export const CHART_SPEC_VERSION = '1.0';

const SIGN_SA = [
  'Meṣa',
  'Vṛṣabha',
  'Mithuna',
  'Karka',
  'Siṁha',
  'Kanyā',
  'Tulā',
  'Vṛścika',
  'Dhanu',
  'Makara',
  'Kumbha',
  'Mīna',
];

/**
 * JSON Schema (draft-07 style) for LLM / agent tool input.
 * Pass as `spec` to generate_chart (or the body itself).
 */
export const CHART_SPEC_SCHEMA = {
  $schema: 'http://json-schema.org/draft-07/schema#',
  $id: 'https://agent-os.local/schemas/chart-spec/v1.json',
  title: 'Agent OS Chart Spec',
  description:
    'Declarative chart document. Build this JSON then call generate_chart. Supported types: vedic_north_indian, vedic_south_indian, labeled_grid.',
  type: 'object',
  required: ['schema_version', 'charts'],
  additionalProperties: false,
  properties: {
    schema_version: {
      type: 'string',
      const: CHART_SPEC_VERSION,
      description: 'Must be "1.0"',
    },
    charts: {
      type: 'array',
      minItems: 1,
      maxItems: 8,
      items: {
        oneOf: [
          { $ref: '#/definitions/vedic_north_indian' },
          { $ref: '#/definitions/vedic_south_indian' },
          { $ref: '#/definitions/labeled_grid' },
        ],
      },
    },
  },
  definitions: {
    planet_mark: {
      type: 'object',
      required: ['abbr', 'sign_index', 'house'],
      additionalProperties: true,
      properties: {
        abbr: { type: 'string', description: 'Short label drawn on chart (e.g. Su, Mo, As)' },
        name: { type: 'string' },
        sign_index: { type: 'integer', minimum: 0, maximum: 11, description: '0=Aries … 11=Pisces' },
        house: { type: 'integer', minimum: 1, maximum: 12 },
      },
    },
    vedic_north_indian: {
      type: 'object',
      required: ['type', 'lagna_sign_index', 'planets'],
      additionalProperties: true,
      properties: {
        type: { const: 'vedic_north_indian' },
        id: { type: 'string', description: 'Optional id; used as key in chart_urls' },
        title: { type: 'string' },
        subtitle: { type: 'string' },
        footer: { type: 'string' },
        lagna_sign_index: { type: 'integer', minimum: 0, maximum: 11 },
        planets: { type: 'array', items: { $ref: '#/definitions/planet_mark' } },
      },
    },
    vedic_south_indian: {
      type: 'object',
      required: ['type', 'lagna_sign_index', 'planets'],
      additionalProperties: true,
      properties: {
        type: { const: 'vedic_south_indian' },
        id: { type: 'string' },
        title: { type: 'string' },
        subtitle: { type: 'string' },
        footer: { type: 'string' },
        lagna_sign_index: { type: 'integer', minimum: 0, maximum: 11 },
        planets: { type: 'array', items: { $ref: '#/definitions/planet_mark' } },
      },
    },
    labeled_grid: {
      type: 'object',
      required: ['type', 'columns', 'cells'],
      additionalProperties: true,
      properties: {
        type: { const: 'labeled_grid' },
        id: { type: 'string' },
        title: { type: 'string' },
        subtitle: { type: 'string' },
        footer: { type: 'string' },
        columns: { type: 'integer', minimum: 1, maximum: 6 },
        cells: {
          type: 'array',
          items: {
            type: 'object',
            required: ['label'],
            properties: {
              label: { type: 'string' },
              value: { type: 'string' },
              col: { type: 'integer', minimum: 0 },
              row: { type: 'integer', minimum: 0 },
            },
          },
        },
      },
    },
  },
};

function escapeXml(s) {
  return String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function signForHouse(lagnaSignIndex, house) {
  return (Number(lagnaSignIndex) + (house - 1)) % 12;
}

function normalizePlanet(p) {
  const abbr = String(p.abbr || p.name || '?').slice(0, 4);
  const sign_index = Number(p.sign_index ?? p.signIndex);
  const house = Number(p.house);
  if (!Number.isInteger(sign_index) || sign_index < 0 || sign_index > 11) {
    throw new Error(`planet ${abbr}: sign_index must be 0–11`);
  }
  if (!Number.isInteger(house) || house < 1 || house > 12) {
    throw new Error(`planet ${abbr}: house must be 1–12`);
  }
  return { abbr, name: p.name || abbr, sign_index, house };
}

function normalizeVedicChart(raw) {
  const lagna_sign_index = Number(raw.lagna_sign_index ?? raw.lagnaSignIndex ?? raw.lagna?.sign_index);
  if (!Number.isInteger(lagna_sign_index) || lagna_sign_index < 0 || lagna_sign_index > 11) {
    throw new Error(`${raw.type}: lagna_sign_index must be 0–11`);
  }
  const planets = (raw.planets || []).map(normalizePlanet);
  return {
    type: raw.type,
    id: raw.id || null,
    title: raw.title || '',
    subtitle: raw.subtitle || '',
    footer: raw.footer || 'Whole-sign houses',
    lagna_sign_index,
    planets,
  };
}

/** North Indian diamond chart SVG. */
export function renderNorthIndianSvg(chart) {
  const size = 640;
  const cx = size / 2;
  const cy = size / 2;
  const pad = 24;
  const houseCenters = {
    1: [cx, cy - 150],
    2: [cx - 90, cy - 90],
    3: [cx - 150, cy],
    4: [cx - 90, cy + 90],
    5: [cx, cy + 150],
    6: [cx + 90, cy + 90],
    7: [cx + 150, cy],
    8: [cx + 90, cy - 90],
    9: [cx - 45, cy - 45],
    10: [cx - 45, cy + 45],
    11: [cx + 45, cy + 45],
    12: [cx + 45, cy - 45],
  };
  const byHouse = {};
  for (let h = 1; h <= 12; h++) byHouse[h] = [];
  for (const p of chart.planets) {
    byHouse[p.house]?.push(p.abbr);
  }
  byHouse[1].unshift('As');

  let bodies = '';
  for (let h = 1; h <= 12; h++) {
    const [x, y] = houseCenters[h];
    const label = byHouse[h].join(' ');
    const sign = SIGN_SA[signForHouse(chart.lagna_sign_index, h)];
    bodies += `<text x="${x}" y="${y - 8}" text-anchor="middle" font-size="11" fill="#334">${escapeXml(sign)}</text>`;
    bodies += `<text x="${x}" y="${y + 10}" text-anchor="middle" font-size="13" font-weight="600" fill="#111">${escapeXml(label || '·')}</text>`;
  }

  const title = escapeXml(chart.title || 'North Indian chart');
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <rect width="100%" height="100%" fill="#faf8f5"/>
  <text x="${cx}" y="28" text-anchor="middle" font-size="16" font-weight="700" fill="#1a1a1a">${title}</text>
  <text x="${cx}" y="48" text-anchor="middle" font-size="11" fill="#666">${escapeXml(chart.subtitle || '')}</text>
  <polygon points="${pad},${cy} ${cx},${pad} ${size - pad},${cy} ${cx},${size - pad}" fill="none" stroke="#222" stroke-width="2"/>
  <line x1="${pad}" y1="${cy}" x2="${size - pad}" y2="${cy}" stroke="#222" stroke-width="1.5"/>
  <line x1="${cx}" y1="${pad}" x2="${cx}" y2="${size - pad}" stroke="#222" stroke-width="1.5"/>
  <line x1="${pad + 40}" y1="${pad + 40}" x2="${size - pad - 40}" y2="${size - pad - 40}" stroke="#444" stroke-width="1"/>
  <line x1="${size - pad - 40}" y1="${pad + 40}" x2="${pad + 40}" y2="${size - pad - 40}" stroke="#444" stroke-width="1"/>
  ${bodies}
  <text x="${cx}" y="${size - 12}" text-anchor="middle" font-size="10" fill="#888">${escapeXml(chart.footer || '')}</text>
</svg>`;
}

/** South Indian rectangular chart SVG. */
export function renderSouthIndianSvg(chart) {
  const size = 640;
  const cell = 140;
  const ox = (size - cell * 4) / 2;
  const oy = 70;
  const signCells = [
    [0, 0, 11],
    [1, 0, 0],
    [2, 0, 1],
    [3, 0, 2],
    [3, 1, 3],
    [3, 2, 4],
    [3, 3, 5],
    [2, 3, 6],
    [1, 3, 7],
    [0, 3, 8],
    [0, 2, 9],
    [0, 1, 10],
  ];
  const planetsBySign = Array.from({ length: 12 }, () => []);
  for (const p of chart.planets) {
    planetsBySign[p.sign_index].push(p.abbr);
  }
  planetsBySign[chart.lagna_sign_index].unshift('As');

  let cells = '';
  for (const [col, row, signIdx] of signCells) {
    const x = ox + col * cell;
    const y = oy + row * cell;
    const label = planetsBySign[signIdx].join(' ');
    cells += `<rect x="${x}" y="${y}" width="${cell}" height="${cell}" fill="#fff" stroke="#222" stroke-width="1.5"/>`;
    cells += `<text x="${x + 8}" y="${y + 18}" font-size="11" fill="#555">${escapeXml(SIGN_SA[signIdx])}</text>`;
    cells += `<text x="${x + cell / 2}" y="${y + cell / 2 + 6}" text-anchor="middle" font-size="14" font-weight="600" fill="#111">${escapeXml(label || '')}</text>`;
  }
  cells += `<rect x="${ox + cell}" y="${oy + cell}" width="${cell * 2}" height="${cell * 2}" fill="#f3f0ea" stroke="#222" stroke-width="1.5"/>`;
  cells += `<text x="${ox + cell * 2}" y="${oy + cell * 2}" text-anchor="middle" font-size="12" fill="#444">Chart</text>`;

  const title = escapeXml(chart.title || 'South Indian chart');
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <rect width="100%" height="100%" fill="#faf8f5"/>
  <text x="${size / 2}" y="28" text-anchor="middle" font-size="16" font-weight="700" fill="#1a1a1a">${title}</text>
  <text x="${size / 2}" y="48" text-anchor="middle" font-size="11" fill="#666">${escapeXml(chart.subtitle || '')}</text>
  ${cells}
  <text x="${size / 2}" y="${size - 12}" text-anchor="middle" font-size="10" fill="#888">${escapeXml(chart.footer || '')}</text>
</svg>`;
}

function renderLabeledGridSvg(chart) {
  const cols = Math.max(1, Math.min(6, Number(chart.columns) || 2));
  const cells = Array.isArray(chart.cells) ? chart.cells : [];
  if (!cells.length) throw new Error('labeled_grid: cells required');
  const placed = cells.map((c, i) => ({
    label: String(c.label || ''),
    value: String(c.value || ''),
    col: Number.isInteger(c.col) ? c.col : i % cols,
    row: Number.isInteger(c.row) ? c.row : Math.floor(i / cols),
  }));
  const maxRow = Math.max(...placed.map((c) => c.row), 0);
  const maxCol = Math.max(...placed.map((c) => c.col), cols - 1);
  const cellW = 160;
  const cellH = 100;
  const ox = 40;
  const oy = 70;
  const width = ox * 2 + (maxCol + 1) * cellW;
  const height = oy + 40 + (maxRow + 1) * cellH;

  let body = '';
  for (const c of placed) {
    const x = ox + c.col * cellW;
    const y = oy + c.row * cellH;
    body += `<rect x="${x}" y="${y}" width="${cellW - 8}" height="${cellH - 8}" rx="8" fill="#fff" stroke="#222" stroke-width="1.5"/>`;
    body += `<text x="${x + 12}" y="${y + 28}" font-size="12" fill="#555">${escapeXml(c.label)}</text>`;
    body += `<text x="${x + (cellW - 8) / 2}" y="${y + 58}" text-anchor="middle" font-size="14" font-weight="600" fill="#111">${escapeXml(c.value)}</text>`;
  }

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <rect width="100%" height="100%" fill="#f7f8f9"/>
  <text x="${width / 2}" y="28" text-anchor="middle" font-size="16" font-weight="700" fill="#1a1a1a">${escapeXml(chart.title || 'Grid')}</text>
  <text x="${width / 2}" y="48" text-anchor="middle" font-size="11" fill="#666">${escapeXml(chart.subtitle || '')}</text>
  ${body}
  <text x="${width / 2}" y="${height - 12}" text-anchor="middle" font-size="10" fill="#888">${escapeXml(chart.footer || '')}</text>
</svg>`;
}

export function persistSvg(svgText, mediaDir) {
  mkdirSync(mediaDir, { recursive: true });
  const filename = `${randomUUID()}.svg`;
  writeFileSync(join(mediaDir, filename), svgText, 'utf8');
  return enrichGeneratedOpenClawMedia(filename);
}

/**
 * Normalize / lightly validate a chart_spec object.
 * @returns {{ schema_version: string, charts: object[] }}
 */
export function normalizeChartSpec(input) {
  let raw = input;
  if (raw && typeof raw === 'object' && raw.spec && !raw.charts) raw = raw.spec;
  if (typeof raw === 'string') {
    try {
      raw = JSON.parse(raw);
    } catch {
      throw new Error('spec must be a JSON object (or JSON string)');
    }
  }
  if (!raw || typeof raw !== 'object') throw new Error('spec is required');

  // Allow a single chart object as shorthand
  if (raw.type && !raw.charts) {
    raw = { schema_version: CHART_SPEC_VERSION, charts: [raw] };
  }

  const schema_version = String(raw.schema_version || raw.schemaVersion || CHART_SPEC_VERSION);
  if (schema_version !== CHART_SPEC_VERSION) {
    throw new Error(`schema_version must be "${CHART_SPEC_VERSION}" (got ${schema_version})`);
  }
  const list = Array.isArray(raw.charts) ? raw.charts : [];
  if (!list.length) throw new Error('charts array must contain at least one chart');
  if (list.length > 8) throw new Error('charts array max is 8');

  const charts = list.map((c, i) => {
    const type = String(c.type || '').trim();
    if (type === 'vedic_north_indian' || type === 'vedic_south_indian') {
      return normalizeVedicChart({ ...c, type });
    }
    if (type === 'labeled_grid') {
      const columns = Number(c.columns);
      if (!Number.isInteger(columns) || columns < 1 || columns > 6) {
        throw new Error(`charts[${i}]: labeled_grid columns must be 1–6`);
      }
      if (!Array.isArray(c.cells) || !c.cells.length) {
        throw new Error(`charts[${i}]: labeled_grid cells required`);
      }
      return {
        type,
        id: c.id || null,
        title: c.title || '',
        subtitle: c.subtitle || '',
        footer: c.footer || '',
        columns,
        cells: c.cells,
      };
    }
    throw new Error(
      `charts[${i}]: unsupported type "${type}". Use vedic_north_indian | vedic_south_indian | labeled_grid`
    );
  });

  return { schema_version, charts };
}

function renderOne(chart) {
  if (chart.type === 'vedic_north_indian') return renderNorthIndianSvg(chart);
  if (chart.type === 'vedic_south_indian') return renderSouthIndianSvg(chart);
  if (chart.type === 'labeled_grid') return renderLabeledGridSvg(chart);
  throw new Error(`unsupported chart type: ${chart.type}`);
}

/**
 * Render chart_spec → SVG URLs.
 * @param {object} input - chart_spec or { spec }
 * @param {{ mediaDir: string }} opts
 */
export function generateChartsFromSpec(input, opts = {}) {
  const mediaDir = opts.mediaDir;
  if (!mediaDir) throw new Error('mediaDir is required');
  const spec = normalizeChartSpec(input);
  const chart_urls = {};
  const urls = [];
  const rendered = [];

  spec.charts.forEach((chart, i) => {
    const svg = renderOne(chart);
    const media = persistSvg(svg, mediaDir);
    const mediaUri = media.media_uri || media.url;
    const key = String(chart.id || `${chart.type}_${i + 1}`).replace(/[^a-zA-Z0-9_-]/g, '_');
    chart_urls[key] = mediaUri;
    urls.push(mediaUri);
    rendered.push({
      id: key,
      type: chart.type,
      title: chart.title || null,
      url: mediaUri,
      paste_exactly: media.paste_exactly || mediaUri,
      relative_url: media.relative_url,
      absolute_url: media.public_url || media.absolute_url,
      public_url: media.public_url || media.absolute_url,
      local_path: media.local_path,
      media_uri: mediaUri,
      web_markdown: media.web_markdown,
    });
  });

  // MEDIA: lines only — auth HTTPS in the same reply causes WhatsApp "Media failed".
  const visuals_markdown = `${rendered.map((r) => r.media_uri).join('\n')}\n\n_Paste MEDIA: lines so WhatsApp embeds charts; Dashboard chat renders them too._`;

  return {
    ok: true,
    schema_version: spec.schema_version,
    charts: rendered,
    chart_urls,
    visuals_markdown,
    paste_exactly: rendered.map((r) => r.media_uri).join('\n'),
    notes:
      'Paste visuals_markdown / paste_exactly (MEDIA: lines) at the top of the reply. Do not paste auth-only /api/media HTTPS URLs on WhatsApp.',
  };
}

/** Compact schema summary for tool responses / docs. */
export function chartSpecSchemaSummary() {
  return {
    schema_version: CHART_SPEC_VERSION,
    schema: CHART_SPEC_SCHEMA,
    example: {
      schema_version: '1.0',
      charts: [
        {
          type: 'vedic_north_indian',
          id: 'd1_north',
          title: 'Rāśi (D-1) — North Indian',
          subtitle: 'Chennai · 1990-05-15',
          lagna_sign_index: 11,
          planets: [
            { abbr: 'Su', sign_index: 0, house: 2 },
            { abbr: 'Mo', sign_index: 3, house: 5 },
          ],
        },
        {
          type: 'vedic_south_indian',
          id: 'd1_south',
          title: 'Rāśi (D-1) — South Indian',
          lagna_sign_index: 11,
          planets: [
            { abbr: 'Su', sign_index: 0, house: 2 },
            { abbr: 'Mo', sign_index: 3, house: 5 },
          ],
        },
      ],
    },
  };
}
