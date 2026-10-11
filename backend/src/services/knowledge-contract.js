import { createHash } from 'node:crypto';

export const SOURCE_KINDS = new Set(['crm', 'erp', 'content']);
export const fingerprint = (value) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
export function entityId(owner, source, object) {
  if (!owner || !source || !object) throw new Error('Knowledge identity requires owner, source and object');
  return fingerprint([owner, source, object]);
}
export function validateSource(input = {}) {
  if (!SOURCE_KINDS.has(input.kind)) throw new Error('Unsupported knowledge source');
  const name = String(input.name || '').trim();
  if (!name || name.length > 160) throw new Error('Source name must contain 1–160 characters');
  const interval = Number(input.interval_seconds ?? 300);
  if (!Number.isInteger(interval) || interval < 60 || interval > 86400) throw new Error('Sync interval must be 60–86400 seconds');
  const collections = input.collections || [];
  const supported = {
    crm: ['companies', 'people', 'opportunities'],
    erp: ['Customer', 'Contact', 'Project', 'Sales Invoice'],
    content: ['uploaded', 'generated'],
  }[input.kind];
  if (!Array.isArray(collections) || !collections.length || collections.some(x => !supported.includes(x))) {
    throw new Error('Select supported source collections');
  }
  return { name, kind: input.kind, collections: [...new Set(collections)], interval_seconds: interval,
    graph_enabled: input.graph_enabled === true, enabled: input.enabled !== false };
}

// A graph edge must originate from a native relation or a deliberate mapping.
// Shared labels/names are never used as join keys.
export function validateMapping(input = {}) {
  const keys = ['from_source', 'from_object', 'to_source', 'to_object', 'relation'];
  const out = {};
  for (const key of keys) {
    const value = String(input[key] || '').trim();
    if (!value || value.length > 500) throw new Error(`${key} is required (max 500 characters)`);
    out[key] = value;
  }
  if (!/^[a-z][a-z0-9_]{0,63}$/.test(out.relation)) throw new Error('Use a lowercase relationship identifier');
  out.note = String(input.note || '').trim().slice(0, 2000);
  if (!out.note) throw new Error('Explain the evidence for this explicit relationship');
  return out;
}

export function boundedExpand(seeds, edges, eligible, { depth = 2, limit = 100 } = {}) {
  const maxDepth = Math.min(4, Math.max(0, Number(depth) || 0));
  const maxNodes = Math.min(250, Math.max(1, Number(limit) || 100));
  const found = new Set(seeds.filter(id => eligible.has(id)).slice(0, maxNodes));
  const used = [];
  let frontier = [...found];
  for (let hop = 0; hop < maxDepth && frontier.length; hop++) {
    const current = new Set(frontier); const next = [];
    for (const edge of edges) {
      if (!eligible.has(edge.from) || !eligible.has(edge.to)) continue;
      if (!current.has(edge.from) && !current.has(edge.to)) continue;
      const other = current.has(edge.from) ? edge.to : edge.from;
      if (!found.has(other)) {
        if (found.size >= maxNodes) continue;
        found.add(other); next.push(other);
      }
      if (!used.some(e => e.id === edge.id)) used.push(edge);
    }
    frontier = next;
  }
  return { ids: [...found], relationships: used };
}
