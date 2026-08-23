/**
 * Seed browser session / task content tools.
 */
import { getDb } from './schema.js';

const BROWSER_TOOLS = [
  {
    name: 'browse_session_status',
    display_name: 'Browse session status',
    endpoint: '/api/tools/browse-session-status',
    method: 'POST',
    purpose:
      'API tool: check CEO browser mode (managed Playwright vs client Chrome relay), gateway reachability, and setup steps. Do not use exec.',
    model_used: '',
    enabled: 1,
    is_builtin: 1,
  },
  {
    name: 'browse_task_start',
    display_name: 'Browse task start',
    endpoint: '/api/tools/browse-task-start',
    method: 'POST',
    purpose:
      'API tool: start a natural-language browser task (async). Pass goal, optional start_url, mode autonomous|recorder|recipe_replay. Prefer browse_recipe_run to play saved recipes (requires that tool grant). For recipe_replay via this tool you also need browse_recipe_run granted; pass recipe_name or recipe_id. Then call browse_task_status once with wait_ms up to 90000; if still running, report the task id. Prefer this one wait over many polls. For Client Session goals, do not use the built-in browser tool. Flight goals may omit homepage start_url (backend deep-links Cheapflights). Do not use exec.',
    model_used: '',
    enabled: 1,
    is_builtin: 1,
  },
  {
    name: 'browse_task_status',
    display_name: 'Browse task status',
    endpoint: '/api/tools/browse-task-status',
    method: 'POST',
    purpose:
      'API tool: get browser task status/result by task_id, or list recent tasks. Supports wait_ms up to 90000 to wait for a terminal status in one call; prefer one wait over many polls. For Client Session goals, do not use the built-in browser tool. Do not use exec.',
    model_used: '',
    enabled: 1,
    is_builtin: 1,
  },
  {
    name: 'browse_snapshot',
    display_name: 'Browse snapshot',
    endpoint: '/api/tools/browse-snapshot',
    method: 'POST',
    purpose: 'API tool: accessibility snapshot of the current browser session page. Do not use exec.',
    model_used: '',
    enabled: 1,
    is_builtin: 1,
  },
  {
    name: 'browse_act',
    display_name: 'Browse act',
    endpoint: '/api/tools/browse-act',
    method: 'POST',
    purpose: 'API tool: perform a browser action (click/type/open) on the CEO session. Prefer browse_task_start for multi-step goals. Do not use exec.',
    model_used: '',
    enabled: 1,
    is_builtin: 1,
  },
  {
    name: 'browse_recipe_list',
    display_name: 'Browse recipe list',
    endpoint: '/api/tools/browse-recipe-list',
    method: 'POST',
    purpose:
      'API tool: list saved browser recipes (recorded trails) for this CEO. Returns name, status, actionable_steps, and required_inputs. To play a recipe, call browse_recipe_run with recipe_name (preferred) or recipe_id and supply every required input in inputs. Grant browse_recipe_run separately in Agent Workspace → Tool access. Do not use exec.',
    model_used: '',
    enabled: 1,
    is_builtin: 1,
  },
  {
    name: 'browse_recipe_run',
    display_name: 'Browse recipe run',
    endpoint: '/api/tools/browse-recipe-run',
    method: 'POST',
    purpose:
      'API tool: play/run a saved browser recipe for this CEO (async). Pass recipe_name (exact, preferred) or recipe_id, inputs as an object containing every name returned in required_inputs, and optional start_url and wait_ms (up to 90000). Example: {"recipe_name":"LinkedIn post","inputs":{"post_content":"Text to publish"}}. Missing required inputs fail before any browser action. Returns task_id; then use browse_task_status if needed. Requires tool grant browse_recipe_run (list alone is not enough). Do not use exec.',
    model_used: '',
    enabled: 1,
    is_builtin: 1,
  },
];

export function seedBrowserSessionToolsIfMissing() {
  const db = getDb();
  const insert = db.prepare(
    `INSERT OR IGNORE INTO content_tools_meta (name, display_name, endpoint, method, purpose, model_used, enabled, is_builtin)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  );
  const update = db.prepare(
    'UPDATE content_tools_meta SET purpose = ?, display_name = ?, endpoint = ?, method = ? WHERE name = ?'
  );
  for (const t of BROWSER_TOOLS) {
    insert.run(t.name, t.display_name, t.endpoint, t.method, t.purpose, t.model_used, t.enabled, t.is_builtin);
    update.run(t.purpose, t.display_name, t.endpoint, t.method, t.name);
  }
  console.info('[startup] browser session tools seeded (%s)', BROWSER_TOOLS.length);
}
export const BROWSER_SESSION_TOOL_NAMES = BROWSER_TOOLS.map((t) => t.name);
const BROWSER_TOOL_NAMES = BROWSER_SESSION_TOOL_NAMES;

/**
 * Optional client-browser / recipe tools — do not auto-grant to every custom agent.
 * Grant only to core org agents; CEOs enable for user-defined agents via Agent Workspace → Tool access.
 */
const DEFAULT_BROWSER_TOOL_AGENT_BASE_IDS = ['balserve', 'workflowbuilder', 'platformhelp', 'techresearcher'];

export function grantBrowserSessionToolsToDefaultAgents() {
  const db = getDb();
  const agents = db.prepare('SELECT id FROM agents').all();
  const insert = db.prepare(
    'INSERT OR IGNORE INTO agent_tool_grants (agent_id, tool_name) VALUES (?, ?)'
  );
  let n = 0;
  for (const a of agents) {
    const id = String(a.id || '');
    const base = id.includes('--') ? id.split('--').pop() : id;
    if (!DEFAULT_BROWSER_TOOL_AGENT_BASE_IDS.includes(base)) continue;
    for (const name of BROWSER_TOOL_NAMES) {
      const info = insert.run(a.id, name);
      n += info.changes || 0;
    }
  }
  // Agents that already had list/start (pre browse_recipe_run) keep recipe play access.
  n += grantBrowseRecipeRunToPriorBrowserAgents();
  return n;
}

/**
 * Grant browse_recipe_run to agents that already had browse_recipe_list or browse_task_start
 * so list-only new grants stay possible, but existing browser-capable agents can still play recipes.
 */
export function grantBrowseRecipeRunToPriorBrowserAgents() {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT DISTINCT agent_id FROM agent_tool_grants
       WHERE tool_name IN ('browse_recipe_list', 'browse_task_start')`
    )
    .all();
  const insert = db.prepare(
    'INSERT OR IGNORE INTO agent_tool_grants (agent_id, tool_name) VALUES (?, ?)'
  );
  let n = 0;
  for (const r of rows) {
    const info = insert.run(r.agent_id, 'browse_recipe_run');
    n += info.changes || 0;
  }
  if (n > 0) {
    console.info('[startup] granted browse_recipe_run to %s prior browser-capable agent(s)', n);
  }
  return n;
}

/** @deprecated use grantBrowserSessionToolsToDefaultAgents — kept for callers during deploy. */
export function grantBrowserSessionToolsToAllAgents() {
  return grantBrowserSessionToolsToDefaultAgents();
}
