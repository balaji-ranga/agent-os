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
  if (manifest.environment !== 'paper') throw new Error('IBKRNew blueprint must remain paper-only');
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
