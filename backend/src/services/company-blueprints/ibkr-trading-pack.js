/**
 * Overlay golden IBKR monthly graphs from standard/trading/ onto demo / trading
 * blueprints at read time so Company setup Apply installs the tested W1–W5.
 *
 * Golden graphs stay in standard/trading/; this module does not copy them into
 * demo_balaji_ranganathan.json.
 */
import { getIbkrWorkflowManifest, loadIbkrWorkflowTemplate } from './standard-prefabs.js';

function workflowKey(t) {
  return String(t?.template_key || t?.id || t?.name || '')
    .trim()
    .toLowerCase();
}

function ibkrMonthlyKeys() {
  const manifest = getIbkrWorkflowManifest();
  return new Set(
    (manifest?.workflows || [])
      .filter((w) => w.file)
      .map((w) => String(w.template_key || w.id || '').trim().toLowerCase())
      .filter(Boolean)
  );
}

export function isIbkrMonthlyWorkflowTemplate(t) {
  if (!t || typeof t !== 'object') return false;
  if (String(t.kind || '').toLowerCase() === 'ibkr_monthly') return true;
  const key = workflowKey(t);
  return ibkrMonthlyKeys().has(key);
}

function portableIbkrWorkflowTemplates() {
  const manifest = getIbkrWorkflowManifest();
  const out = [];
  for (const w of manifest?.workflows || []) {
    if (!w.file) continue;
    const tpl = loadIbkrWorkflowTemplate(w.template_key || w.id);
    if (!tpl?.graph?.nodes?.length) continue;
    out.push({
      template_key: tpl.template_key || w.template_key || w.id,
      name: tpl.name || w.name,
      description: tpl.description || '',
      chat_trigger_phrase: tpl.chat_trigger_phrase || w.chat_phrase || '',
      trigger_modes: tpl.trigger_modes || ['manual'],
      schedule_cron: tpl.schedule_cron || '',
      kind: tpl.kind || 'ibkr_monthly',
      status: tpl.status || 'ready',
      standard_path: `standard/trading/${w.file}`,
      variables: tpl.variables || {},
      graph: tpl.graph,
    });
  }
  return out;
}

function mergeIbkrWorkflowTemplates(base = [], extra = []) {
  const by = new Map();
  for (const t of base || []) {
    const k = workflowKey(t);
    if (k) by.set(k, t);
  }
  for (const t of extra || []) {
    const k = workflowKey(t);
    if (!k) continue;
    const extraHasGraph = (t.graph?.nodes || []).length > 0;
    if (!extraHasGraph) continue;
    const prev = by.get(k);
    if (!prev || isIbkrMonthlyWorkflowTemplate(t)) {
      by.set(k, prev ? { ...prev, ...t, graph: t.graph, variables: t.variables || prev.variables } : t);
    }
  }
  return [...by.values()];
}

export function hydrateIbkrMonthlyWorkflows(bp) {
  if (!bp || typeof bp !== 'object') return bp;
  const golden = portableIbkrWorkflowTemplates();
  if (!golden.length) return bp;
  const keys = ibkrMonthlyKeys();
  const hasMonthly = (bp.workflow_templates || []).some((t) => keys.has(workflowKey(t)));
  const id = String(bp.id || bp.industry || '').toLowerCase();
  if (!hasMonthly && id !== 'demo_balaji_ranganathan' && !(bp.aliases || []).includes('balaji_demo')) {
    return bp;
  }
  return {
    ...bp,
    workflow_templates: mergeIbkrWorkflowTemplates(bp.workflow_templates || [], golden),
  };
}

export function overlayTestedIbkrWorkflows(bp) {
  return hydrateIbkrMonthlyWorkflows(bp);
}
