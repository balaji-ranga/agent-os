/**
 * Member key helpers (dependency-free so hot paths can import them without pulling in
 * the A2A / external-agent clients).
 *
 * Internal OpenClaw agents use their bare `agents.id`; org leaf members use `ext:<id>` or
 * `a2a:<id>` (see org-agent-members.js).
 */

export function isOrgMemberKey(key) {
  const k = String(key || '');
  return k.startsWith('ext:') || k.startsWith('a2a:');
}

/** Split a COO allocation (`{ target: query }`) into internal agents and leaf members. */
export function splitAllocationByKind(allocated = {}) {
  const internal = {};
  const leaf = {};
  for (const [rawKey, query] of Object.entries(allocated || {})) {
    if (isOrgMemberKey(rawKey)) leaf[rawKey] = query;
    else internal[rawKey] = query;
  }
  return { internal, leaf };
}
