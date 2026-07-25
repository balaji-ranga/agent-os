/**
 * Seed departments (name + purpose) used when the CEO's master-data "departments" table is first
 * created. Runtime department options come from that table (see DepartmentPicker /
 * departmentsMasterData). Keep in sync with backend DEPARTMENT_PRESET_ROWS.
 */
export const DEPARTMENT_PRESET_ROWS = [
  { name: 'Executive', purpose: 'Company direction, priorities, approvals and escalations.' },
  { name: 'Research', purpose: 'Market, technical and competitive research; briefs and summaries.' },
  { name: 'Finance', purpose: 'Expenses, invoices, budgets and financial reporting.' },
  { name: 'Social', purpose: 'Social content creation, scheduling and community engagement.' },
  { name: 'Engineering', purpose: 'Build, automate and maintain workflows, integrations and code.' },
  { name: 'Operations', purpose: 'Day-to-day execution, coordination and process follow-through.' },
  { name: 'Job Pipeline', purpose: 'Sourcing, screening and tracking of job or candidate pipelines.' },
];

export const DEPARTMENT_PRESETS = DEPARTMENT_PRESET_ROWS.map((d) => d.name);

export const CEO_NODE_ID = '__ceo__';

/**
 * Map org leaf members (external / published A2A) into the same shape as internal agents so
 * {@link buildOrgTree} can hang them under their reports-to parent.
 */
export function mapOrgLeafMembersToAgents(members = []) {
  return (Array.isArray(members) ? members : [])
    .filter((m) => m && m.id && m.enabled !== false && m.enabled !== 0)
    .map((m) => ({
      id: m.id,
      name: m.display_name || m.name || m.id,
      role:
        m.purpose ||
        (m.kind === 'a2a_publish' ? 'Published A2A agent' : 'External A2A agent'),
      department: m.department || '',
      parent_id: m.parent_id || null,
      is_coo: false,
      agent_type: 'leaf',
      _leaf: true,
      _kind: m.kind === 'a2a_publish' ? 'a2a_publish' : 'external',
      _enabled: m.enabled !== false && m.enabled !== 0,
    }));
}

/** Internal agents + leaf members, ready for list / graph / department grouping. */
export function mergeAgentsWithLeafMembers(agents = [], members = []) {
  const internal = Array.isArray(agents) ? agents.map((a) => ({ ...a, _leaf: false })) : [];
  const leaves = mapOrgLeafMembersToAgents(members);
  const seen = new Set(internal.map((a) => a.id));
  return [...internal, ...leaves.filter((m) => !seen.has(m.id))];
}

/**
 * Build a recursive org tree from agents (parent_id edges).
 * Synthetic CEO sits at the root; COO (and orphans) hang under CEO.
 * External / A2A leaf members appear under their reports-to parent when merged in.
 */
export function buildOrgTree(agents = []) {
  const list = Array.isArray(agents) ? agents : [];
  const byId = new Map(list.map((a) => [a.id, a]));
  const coo = list.find((a) => a.is_coo) || null;

  const childrenOf = new Map();
  for (const a of list) {
    let parentKey = a.parent_id && byId.has(a.parent_id) ? a.parent_id : null;
    if (!parentKey) {
      // Root-level: COO and agents with missing parent attach under CEO
      parentKey = CEO_NODE_ID;
    }
    if (!childrenOf.has(parentKey)) childrenOf.set(parentKey, []);
    childrenOf.get(parentKey).push(a);
  }

  // Prefer COO first under CEO, then internal before leaf, then alpha by name
  const sortKids = (kids) =>
    [...kids].sort((a, b) => {
      if (a.is_coo && !b.is_coo) return -1;
      if (!a.is_coo && b.is_coo) return 1;
      if (!!a._leaf !== !!b._leaf) return a._leaf ? 1 : -1;
      return String(a.name || '').localeCompare(String(b.name || ''));
    });

  function makeNode(agent, depth) {
    const kids = sortKids(childrenOf.get(agent.id) || []);
    return {
      id: agent.id,
      name: agent.name,
      role: agent.role || '',
      department: agent.department || '',
      is_coo: !!agent.is_coo,
      agent_type: agent.agent_type || (agent._leaf ? 'leaf' : 'standard'),
      parent_id: agent.parent_id || null,
      _leaf: !!agent._leaf,
      _kind: agent._kind || null,
      depth,
      children: kids.map((c) => makeNode(c, depth + 1)),
      raw: agent,
    };
  }

  const rootChildren = sortKids(childrenOf.get(CEO_NODE_ID) || []);
  return {
    id: CEO_NODE_ID,
    name: 'CEO (me)',
    role: 'You',
    department: 'Executive',
    isCeo: true,
    depth: 0,
    children: rootChildren.map((c) => makeNode(c, 1)),
    coo,
  };
}

/** Flatten tree to rows for list view. */
export function flattenOrgTree(root) {
  const rows = [];
  function walk(node) {
    rows.push(node);
    for (const c of node.children || []) walk(c);
  }
  walk(root);
  return rows;
}

/** Group agents by department label. */
export function groupAgentsByDepartment(agents = []) {
  const groups = new Map();
  for (const a of agents) {
    const key = String(a.department || '').trim() || 'Unassigned';
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(a);
  }
  return [...groups.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([department, members]) => ({
      department,
      members: members.sort((x, y) => String(x.name || '').localeCompare(String(y.name || ''))),
    }));
}
