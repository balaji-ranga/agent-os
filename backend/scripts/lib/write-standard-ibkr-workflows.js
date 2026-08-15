/**
 * Write golden IBKR monthly workflow graphs into company-blueprints/standard/trading/.
 * Source: demo pack workflow_templates (or a live snapshot payload).
 */
import { existsSync, mkdirSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

export const TRADING_WORKFLOW_FILES = {
  'monthly-trading-w1-post-close': 'trading/workflow-w1-post-close.json',
  'monthly-trading-w2-execute': 'trading/workflow-w2-execute.json',
  'monthly-trading-w3-events': 'trading/workflow-w3-events.json',
  'monthly-trading-w5-weekly': 'trading/workflow-w5-weekly.json',
};

function nodeCount(graph) {
  return Array.isArray(graph?.nodes) ? graph.nodes.length : 0;
}

function portableTemplate(live, templateKey, rel) {
  return {
    template_key: templateKey,
    name: live.name || templateKey,
    description: live.description || '',
    chat_trigger_phrase: live.chat_trigger_phrase || '',
    trigger_modes: live.trigger_modes || ['manual'],
    schedule_cron: live.schedule_cron || '',
    kind: 'ibkr_monthly',
    status: 'ready',
    maintained_in: `company-blueprints/standard/${rel}`,
    variables: live.variables && typeof live.variables === 'object' ? live.variables : {},
    graph: live.graph,
  };
}

/**
 * @param {object} payload blueprint payload with workflow_templates[]
 * @param {{ standardRoot: string, dry?: boolean, sourceLabel?: string }} opts
 */
export function writeStandardIbkrWorkflows(payload, opts = {}) {
  const standardRoot = opts.standardRoot;
  const dry = !!opts.dry;
  const sourceLabel = opts.sourceLabel || 'blueprint payload';
  const report = { workflows: [] };
  const templates = payload?.workflow_templates || [];
  const byKey = new Map(templates.map((w) => [String(w.template_key || ''), w]));

  for (const [key, rel] of Object.entries(TRADING_WORKFLOW_FILES)) {
    const live = byKey.get(key);
    if (!live?.graph?.nodes?.length) {
      report.workflows.push({ key, action: 'missing_source' });
      continue;
    }
    const path = join(standardRoot, rel);
    const next = {
      ...portableTemplate(live, key, rel),
      regenerated_from: sourceLabel,
      regenerated_at: new Date().toISOString(),
    };
    if (!dry) {
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, `${JSON.stringify(next, null, 2)}\n`, 'utf8');
    }
    report.workflows.push({ key, action: dry ? 'would_write' : 'wrote', nodes: nodeCount(live.graph), file: rel });
  }

  if (!dry) {
    const manifestPath = join(standardRoot, 'trading/regeneration-manifest.json');
    mkdirSync(dirname(manifestPath), { recursive: true });
    writeFileSync(
      manifestPath,
      `${JSON.stringify({ source: sourceLabel, at: new Date().toISOString(), report }, null, 2)}\n`,
      'utf8'
    );
  }
  return report;
}

export function defaultStandardRootFromScripts() {
  return join(__dirname, '../../src/services/company-blueprints/standard');
}

export function defaultPackPathFromScripts() {
  return join(__dirname, '../../src/services/company-blueprints/packs/demo_balaji_ranganathan.json');
}

export function packExists(path = defaultPackPathFromScripts()) {
  return existsSync(path);
}
