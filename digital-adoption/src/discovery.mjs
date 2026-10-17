import { createHash } from 'node:crypto';

// Frontier only. Browser adapter performs navigation and returns observations;
// this engine never invokes a click, form write, or arbitrary URL fetch.
export function createDiscovery({ origin, seed, approvedReadOnlyPaths, maxPages = 30, maxDepth = 4 }) {
  const base = new URL(origin);
  if (base.origin !== origin || !['https:','http:'].includes(base.protocol) ||
      !Number.isInteger(maxPages) || maxPages < 1 || maxPages > 200 ||
      !Number.isInteger(maxDepth) || maxDepth < 0 || maxDepth > 10 || !Array.isArray(approvedReadOnlyPaths)) throw new Error('Invalid discovery limits');
  const approved = new Set(approvedReadOnlyPaths);
  const canonical = path => {
    if (typeof path !== 'string' || path.length > 500) return null;
    const url = new URL(path, base);
    if (url.origin !== origin || url.username || url.password || url.search || url.hash || !approved.has(url.pathname)) return null;
    return url.pathname;
  };
  const start = canonical(seed); if (!start) throw new Error('Seed is not approved read-only navigation');
  const frontier = [{ path: start, depth: 0 }], seen = new Set([start]), nodes = new Map(), blocked = [];
  let paused = false, stopped = false, active = null;
  return {
    next({ authorized, hasUnsavedWork = false }) {
      if (authorized !== true || hasUnsavedWork) { paused = true; return null; }
      if (paused || stopped || nodes.size >= maxPages) return null;
      if (active) return { ...active }; // Retrying observation does not advance the queue.
      active = frontier.shift() || null;
      return active && { ...active };
    },
    observe({ path, fields = [], links = [] }) {
      if (paused || stopped || !active || path !== active.path || !Array.isArray(fields) || !Array.isArray(links)) throw new Error('Unexpected discovery observation');
      const safeFields = fields.slice(0,60).map(f => {
        if (!f || typeof f.id !== 'string' || !/^[a-zA-Z][a-zA-Z0-9_-]{0,79}$/.test(f.id) ||
            /password|token|secret|otp|cvv/i.test(f.id) || !['text','number','email','date','select','textarea','checkbox'].includes(f.type)) return null;
        return { id: f.id, type: f.type, required: f.required === true };
      }).filter(Boolean);
      const fingerprint = createHash('sha256').update(JSON.stringify(safeFields.slice().sort((a,b) => a.id.localeCompare(b.id)))).digest('hex');
      nodes.set(path, { path, fields: safeFields, fingerprint, status: 'discovered-not-tested' });
      for (const link of links.slice(0,100)) {
        const target = canonical(link);
        if (!target) { if (blocked.length < 100) blocked.push({ reason: 'Not approved read-only navigation' }); continue; }
        if (!seen.has(target) && active.depth < maxDepth && seen.size < maxPages) { seen.add(target); frontier.push({ path: target, depth: active.depth + 1 }); }
      }
      active = null;
    },
    pause() { paused = true; },
    resume({ authorized }) { if (authorized !== true || stopped) throw new Error('Discovery cannot resume'); paused = false; },
    stop() { stopped = true; active = null; },
    report() { return { nodes: structuredClone([...nodes.values()]), blocked: structuredClone(blocked),
      remaining: frontier.length + Number(Boolean(active)), paused, stopped, completeness: 'bounded-approved-scope-only' }; },
  };
}
