import { readFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const BLUEPRINT_ROOT = join(dirname(fileURLToPath(import.meta.url)), 'company-blueprints', 'standard', 'trading', 'ibkrnew');
const CONFIG_KINDS = Object.freeze(['policy', 'strategy', 'strategy_skill', 'universe', 'market_data']);

function readBlueprint(filename) {
  if (basename(filename) !== filename || !filename.endsWith('.json')) throw new Error(`Invalid IBKRNew blueprint filename: ${filename}`);
  return JSON.parse(readFileSync(join(BLUEPRINT_ROOT, filename), 'utf8'));
}

function clone(value) { return structuredClone(value); }

function assertBlueprintContract(manifest, configs, goal, workflows) {
  if (manifest.blueprint_id !== 'IBKRNew0' || Number(manifest.schema_version) < 1) throw new Error('IBKRNew blueprint manifest is invalid');
  if (manifest.environment !== 'mode_aware' || !['paper', 'live'].every((mode) => manifest.supported_environments?.includes(mode))) throw new Error('IBKRNew blueprint must declare paper and live environments');
  for (const kind of CONFIG_KINDS) {
    if (!manifest.config_blueprints?.[kind] || !configs[kind] || Number(configs[kind].schema_version) < 1) throw new Error(`IBKRNew ${kind} blueprint is missing or unversioned`);
  }
  if (goal?.name?.startsWith('IBKRNew') !== true || Number(goal.schema_version) < 1) throw new Error('IBKRNew goal blueprint is invalid');
  if (workflows?.delivery !== 'event_driven' || !Array.isArray(workflows.workflows) || workflows.workflows.length !== 6) throw new Error('IBKRNew event workflow blueprint is invalid');
  const agentNames = new Set();
  const workflowIds = new Set();
  for (const workflow of workflows.workflows) {
    if (!String(workflow.workflow_id || '').startsWith('IBKRNew') || !String(workflow.agent_name || '').startsWith('IBKRNew') || !Array.isArray(workflow.subscriptions) || !workflow.subscriptions.length) throw new Error('IBKRNew workflow definitions must be named IBKRNew* and subscribe to events');
    if (agentNames.has(workflow.agent_name) || workflowIds.has(workflow.workflow_id)) throw new Error('IBKRNew workflow and agent names must be unique');
    agentNames.add(workflow.agent_name); workflowIds.add(workflow.workflow_id);
  }
  const templates = manifest.agent_templates || [];
  if (templates.length !== agentNames.size || templates.some((template) => !agentNames.has(template.agent_name) || template.template_base_id !== template.agent_name || template.workspace_template !== `openclaw-workspace-templates/${template.agent_name}/`)) throw new Error('IBKRNew agent templates must map every workflow agent to its matching OpenClaw template');
}

const manifest = readBlueprint('manifest.json');
const configs = Object.fromEntries(CONFIG_KINDS.map((kind) => [kind, readBlueprint(manifest.config_blueprints?.[kind])]));
const goal = readBlueprint(manifest.goal_blueprint);
const workflows = readBlueprint(manifest.workflow_blueprint);
assertBlueprintContract(manifest, configs, goal, workflows);

export const IBKRNEW_CONFIG_KINDS = CONFIG_KINDS;

// The blueprints are the source of truth for both runtime defaults and the
// schema shown to operators.  Deriving the schema from the checked-in
// documents keeps the editor and the server from drifting apart.
const FIELD_DESCRIPTIONS = {
  schema_version: 'Version of the configuration contract.',
  name: 'Human-readable name for this configuration.',
  enabled: 'Whether this capability is enabled.',
  mode: 'Goal lifecycle mode.',
  target_return_pct: 'Target net return percentage for the goal cycle.',
  duration_days: 'Maximum calendar duration of a goal cycle.',
  executable_source: 'Authoritative source for executable market data.',
  allow_delayed_for_execution: 'Whether delayed data may be used for execution (must remain false).',
  index_match: 'How selected index memberships are combined.',
  fail_closed: 'Block decisions when required data is unavailable or stale.',
};
const ENUMS = {
  mode: ['ONE_TIME', 'PERPETUAL'],
  index_match: ['ANY', 'ALL'],
  executable_source: ['IBKR'],
  session: ['REGULAR'],
  execution_mode: ['automatic', 'approval_required', 'advisory'],
  selector: ['ACTIVE_IBKRNEW_GOAL'],
  environment: ['paper'],
  allocation_mode: ['DIVERSIFIED', 'CONCENTRATED'],
};
function titleFor(key) { return String(key).replaceAll('_', ' ').replace(/\b\w/g, (c) => c.toUpperCase()); }
function schemaForValue(key, value) {
  if (Array.isArray(value)) {
    const schema = { type: 'array', title: titleFor(key), description: FIELD_DESCRIPTIONS[key] || `${titleFor(key)} values.` };
    if (value.length && value.every((item) => typeof item === 'string')) { schema.items = { type: 'string' }; if (value.length <= 12) schema.examples = [value]; }
    return schema;
  }
  if (value && typeof value === 'object') {
    const properties = {}; for (const [childKey, child] of Object.entries(value)) properties[childKey] = schemaForValue(childKey, child);
    return { type: 'object', title: titleFor(key), description: FIELD_DESCRIPTIONS[key] || `${titleFor(key)} settings.`, properties, additionalProperties: false };
  }
  const type = typeof value === 'boolean' ? 'boolean' : typeof value === 'number' ? 'number' : 'string';
  const schema = { type, title: titleFor(key), description: FIELD_DESCRIPTIONS[key] || `${titleFor(key)} value.` };
  if (ENUMS[key]) schema.enum = ENUMS[key];
  if (key.includes('maximum') || key.includes('minimum') || key.includes('days') || key.includes('hours') || key.includes('pct') || key.includes('usd')) schema.minimum = 0;
  return schema;
}
function withRequired(schema, value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return schema;
  schema.required = Object.keys(value);
  for (const [key, child] of Object.entries(value)) withRequired(schema.properties[key], child);
  return schema;
}
export function getIbkrNewSchema(kind) {
  if (kind === 'goal') return withRequired(schemaForValue('goal', goal), goal);
  if (!CONFIG_KINDS.includes(kind)) throw Object.assign(new Error('unsupported IBKRNew schema kind'), { status: 400 });
  return withRequired(schemaForValue(kind, configs[kind]), configs[kind]);
}
export function getIbkrNewSchemas() { return Object.fromEntries(['goal', ...CONFIG_KINDS].map((kind) => [kind, getIbkrNewSchema(kind)])); }
export function getIbkrNewBlueprintManifest() { return clone(manifest); }
export function getIbkrNewConfigBlueprint(kind) {
  if (!CONFIG_KINDS.includes(kind)) throw Object.assign(new Error('unsupported IBKRNew configuration kind'), { status: 400 });
  return clone(configs[kind]);
}
export function getIbkrNewGoalBlueprint() { return clone(goal); }
export function getIbkrNewWorkflowBlueprints() { return clone(workflows.workflows); }
export function getIbkrNewAgentTemplateBlueprints() { return clone(manifest.agent_templates); }
export function validateIbkrNewBlueprints() {
  assertBlueprintContract(manifest, configs, goal, workflows);
  return { blueprint_id: manifest.blueprint_id, schema_version: manifest.schema_version, config_kinds: [...CONFIG_KINDS], workflows: workflows.workflows.length, agent_templates: manifest.agent_templates.length };
}
