/**
 * Seed labels used when the CEO's master-data "departments" table is first created.
 * Runtime department options come from that table (see DepartmentPicker / departmentsMasterData).
 */
export const DEPARTMENT_PRESETS = [
  'Executive',
  'Research',
  'Finance',
  'Social',
  'Engineering',
  'Operations',
  'Job Pipeline',
];

export const CEO_NODE_ID = '__ceo__';

/**
 * Build a recursive org tree from agents (parent_id edges).
 * Synthetic CEO sits at the root; COO (and orphans) hang under CEO.
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

  // Prefer COO first under CEO, then alpha by name
  const sortKids = (kids) =>
    [...kids].sort((a, b) => {
      if (a.is_coo && !b.is_coo) return -1;
      if (!a.is_coo && b.is_coo) return 1;
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
      agent_type: agent.agent_type || 'standard',
      parent_id: agent.parent_id || null,
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
