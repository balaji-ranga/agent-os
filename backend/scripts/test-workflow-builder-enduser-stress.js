/**
 * Workflow Builder end-user stress test.
 * Plain-English CEO prompts: build, secrets/BYOK, Ollama, publish/draft/A2A/delete.
 *
 * Usage: node scripts/test-workflow-builder-enduser-stress.js
 */
import { config } from 'dotenv';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: join(__dirname, '..', '.env') });

import { initDb } from '../src/db/schema.js';
import { seedWorkflowBuilderAgent } from './seed-workflow-builder-agent.js';
import { getBalaCeoAuthId } from '../src/services/job-applicant-ceo.js';
import * as store from '../src/services/agent-workflow-store.js';
import { applyWorkflowBuilderActions } from '../src/services/agent-workflow-builder.js';
import { runWorkflowBuilderChat, parseAgentJson } from '../src/services/agent-workflow-agent.js';
import { parseWorkflowAgentCommand, waitForRunTerminal } from '../src/services/agent-workflow-chat-tools.js';
import { matchWorkflowRecipe, isWorkflowCreateIntent, isContentPromoteIntent, extractPromoteTopic } from '../src/services/agent-workflow-recipes.js';
import {
  formatCatalogForPrompt,
  formatNodeSelectionGuide,
  LLM_CREATE_GRAPH_CONTRACT,
} from '../src/services/agent-workflow-builder-catalog.js';
import { formatRuntimeContextForPrompt, selectConnectorsForWorkflowPrompt } from '../src/services/agent-workflow-agent-runtime-context.js';
import {
  looksLikeSecretLiteral,
  sanitizeWorkflowGraphSecrets,
  probeOllamaAvailable,
  pickOllamaChatModel,
} from '../src/services/agent-workflow-secrets.js';
import { startAgentWorkflowRun } from '../src/services/agent-workflow-runner.js';
import { getPublicationById, listAllPublishedA2AAgents } from '../src/services/workflow-a2a-publish.js';
import { PLATFORM_BYOK_KEY_NAME } from '../src/services/user-api-keys.js';

initDb();
seedWorkflowBuilderAgent();

const owner = getBalaCeoAuthId();
const actor = { id: 'workflowbuilder', name: 'Workflow Builder', type: 'workflow_builder' };
const stamp = Date.now().toString(36);
const createdIds = [];
const a2aIds = [];

let passed = 0;
let failed = 0;
const notes = [];

function assert(cond, msg) {
  if (cond) {
    passed += 1;
    console.log(`  OK: ${msg}`);
  } else {
    failed += 1;
    console.error(`  FAIL: ${msg}`);
  }
}

function graphJson(def) {
  return JSON.stringify(def?.draft_graph || def?.published_graph || {});
}

function hasSecretLiteral(def, needle) {
  const blob = graphJson(def);
  if (needle && blob.includes(needle)) return true;
  const { stripped } = sanitizeWorkflowGraphSecrets(def?.draft_graph || {});
  return stripped.length > 0 && blob.match(/sk-[A-Za-z0-9_-]{12,}/);
}

async function chat(message, workflowId = null) {
  return runWorkflowBuilderChat({
    ownerUserId: owner,
    workflowId,
    message,
    history: [],
    actor,
    persist: false,
  });
}

function remember(id) {
  if (id) createdIds.push(id);
  return id;
}

console.log('=== Workflow Builder end-user stress ===');
console.log('Owner:', owner);
const ollamaOk = await probeOllamaAvailable({ timeoutMs: 1200, force: true });
console.log('Ollama:', ollamaOk ? 'reachable (free model)' : 'not reachable — expect bind-key fallback');

// --------------------------------------------------------------------------
console.log('\n— Unit: secret sanitizer');
{
  const dirty = {
    nodes: [
      {
        id: 'brain-1',
        type: 'brain',
        position: { x: 0, y: 0 },
        data: {
          label: 'Brain',
          taskConfig: { modelSource: 'openai', apiKey: 'sk-test-SHOULD-NOT-STORE-abc123' },
        },
      },
    ],
    edges: [],
  };
  const out = sanitizeWorkflowGraphSecrets(dirty);
  assert(!JSON.stringify(out.graph).includes('sk-test-SHOULD-NOT-STORE'), 'literal stripped from graph');
  assert(out.graph.nodes[0].data.taskConfig.apiKeyRef === PLATFORM_BYOK_KEY_NAME, 'bound Platform_BYOK');
  assert(looksLikeSecretLiteral('sk-or-v1-abcdefghijklmnop'), 'detects OpenRouter-shaped key');
  assert(!looksLikeSecretLiteral('ollama'), 'ollama placeholder is not a secret');
  assert(!looksLikeSecretLiteral('https://jsonplaceholder.typicode.com/todos/1'), 'URL is not a secret');
  assert(
    pickOllamaChatModel(['deepseek-r1:8b', 'llama-w1-ctx32k:latest'], 'llama3.2') === 'llama-w1-ctx32k:latest',
    'picks installed llama tag when llama3.2 is missing'
  );
  assert(
    pickOllamaChatModel(['llama3.2:latest', 'deepseek-r1:8b'], 'llama3.2') === 'llama3.2:latest',
    'prefers llama3.2 when installed'
  );
}

console.log('\n— Unit: English lifecycle parsers');
{
  assert(parseWorkflowAgentCommand('please take it live', { workflowId: 'wf-1' })?.cmd === 'publish_workflow', 'go live → publish');
  assert(parseWorkflowAgentCommand('put it back in draft', { workflowId: 'wf-1' })?.cmd === 'unpublish_workflow', 'draft phrasing');
  assert(
    parseWorkflowAgentCommand('share this so other companies can call it', { workflowId: 'wf-1' })?.cmd === 'publish_a2a',
    'A2A share phrasing'
  );
  assert(parseWorkflowAgentCommand('delete this workflow, I do not need it', { workflowId: 'wf-1' })?.cmd === 'delete_workflow', 'delete phrasing');
  assert(
    isWorkflowCreateIntent('I need something that takes a note I type in and writes a short friendly summary'),
    'plain-English create intent'
  );
  assert(
    isContentPromoteIntent(
      'build a workflow that will promote our product on Hackernews, Medium with blogs about the product'
    ),
    'promote + channels is create/promote intent'
  );
  assert(extractPromoteTopic('blogs about acme analytics it can be about platform intro') === 'acme analytics', 'topic from about X');
  const ytAsk = 'build a workflow that will generate story scenes and reviews and uploads to youtube';
  assert(isWorkflowCreateIntent(ytAsk), 'youtube/story ask is create intent');
  assert(!matchWorkflowRecipe(ytAsk), 'youtube/story ask is not a curated recipe — LLM + catalog decides nodes');
  const scrapeAsk = 'Create a workflow that will scrape imdb and rottentomatoes to get all reviews';
  assert(isWorkflowCreateIntent(scrapeAsk), 'scrape reviews is create intent');
  assert(isWorkflowCreateIntent('scrape imdb for reviews', { noWorkflowOpen: true }), 'bare outcome on list page is create');
  const fenced = parseAgentJson('```json\n{"reply":"ok","actions":[{"action":"create_workflow","name":"T"}]}\n```');
  assert(fenced.actions[0]?.action === 'create_workflow', 'parses fenced create_workflow JSON');
  const prose = parseAgentJson('Here is the graph:\n{"reply":"built","actions":[{"action":"create_workflow","name":"X","graph":{"nodes":[{}]}}]}');
  assert(prose.actions[0]?.action === 'create_workflow', 'parses create_workflow JSON after prose');
  assert(!matchWorkflowRecipe(scrapeAsk), 'scrape reviews is not a curated recipe');
  const catalog = formatCatalogForPrompt();
  assert(/"type": "web_scrape"/.test(catalog) && /Crawl an HTTPS/.test(catalog), 'full catalog includes web_scrape schema');
  assert(/"type": "ceo_approval"/.test(catalog), 'full catalog includes ceo_approval');
  assert(/startUrl/.test(catalog) && /maxPages/.test(catalog), 'web_scrape I/O and config in catalog');
  const compact = formatCatalogForPrompt({ compact: true });
  assert(/web_scrape/.test(compact) && compact.length < catalog.length, 'compact catalog is shorter');
  const guide = formatNodeSelectionGuide();
  assert(/not by matching words/i.test(guide), 'node selection is purpose-based, not keyword tables');
  assert(!/ERP\/CRM Checker/i.test(guide), 'selection guide does not name a specific employee');
  assert(/CREATE CONTRACT/.test(LLM_CREATE_GRAPH_CONTRACT), 'create contract tells LLM to emit a graph');
  const picked = selectConnectorsForWorkflowPrompt([
    { id: 'hackernews', name: 'Hacker News', connected: false, suggested: true },
    { id: 'github', name: 'GitHub', connected: false, suggested: true },
    { id: 'gmail', name: 'Gmail', connected: true },
  ]);
  assert(picked.some((c) => c.id === 'hackernews'), 'keeps no-key Hacker News');
  assert(picked.some((c) => c.id === 'gmail'), 'keeps connected Gmail');
  assert(!picked.some((c) => c.id === 'github'), 'drops unconnected GitHub');
  const runtimePrompt = formatRuntimeContextForPrompt({
    agents: [{ id: 'erp-checker', name: 'ERP Checker', role: 'ERP maker checker' }],
    nodeTypes: ['trigger', 'web_scrape', 'brain', 'agent'],
    connectors: [{ id: 'hackernews', name: 'Hacker News', needsKey: false, purpose: 'Public HN items' }],
    contentTools: [{ name: 'browse_task_start', purpose: 'Start a natural-language browser task' }],
  });
  assert(/ERP Checker/.test(runtimePrompt) && /role: ERP maker checker/.test(runtimePrompt), 'employees include role for the LLM');
  assert(/browse_task_start/.test(runtimePrompt), 'content tools listed with purpose');
  assert(/hackernews/.test(runtimePrompt), 'connectors listed for the LLM');
}

// --------------------------------------------------------------------------
console.log('\n— S1: Morning Recap (plain English)');
{
  const msg = `I need something that takes a note I type in and writes a short friendly summary. Call it Morning Recap ${stamp}.`;
  const recipe = matchWorkflowRecipe(msg);
  assert(recipe?.id === 'enduser-note-summary', `recipe ${recipe?.id || 'none'}`);
  const res = await chat(msg);
  const id = remember(res.workflow_id);
  const def = store.getDefinition(id, owner);
  assert(!!id && !!def, 'created definition');
  assert(def?.name?.toLowerCase().includes('morning recap'), `name=${def?.name}`);
  const types = (def?.draft_graph?.nodes || []).map((n) => n.type);
  assert(types.includes('trigger') && types.includes('brain'), `nodes=${types.join(',')}`);
  const brain = def.draft_graph.nodes.find((n) => n.type === 'brain');
  assert(brain?.data?.taskConfig?.modelSource === 'ollama', 'brain uses ollama');
  assert(!String(brain?.data?.taskConfig?.apiKey || ''), 'no brain apiKey literal');
  const brainModel = String(brain?.data?.taskConfig?.model || '');
  assert(!/deepseek-v4|gpt-4o|claude/i.test(brainModel), `brain model is local not cloud (${brainModel})`);
  assert(/ollama|no api key|none required/i.test(res.reply || res.keys_summary || ''), 'reply mentions free model / no key');
}

// --------------------------------------------------------------------------
console.log('\n— S2: Public lookup + briefing');
{
  const msg = `When I run it, look up a public webpage and write me a one-paragraph briefing. Don't ask me for technical details. Call it Public Briefing ${stamp}.`;
  const recipe = matchWorkflowRecipe(msg);
  assert(!!recipe && recipe.id === 'enduser-research-briefing', `recipe ${recipe?.id || 'none'}`);
  const res = await chat(msg);
  const def = store.getDefinition(remember(res.workflow_id), owner);
  const types = (def?.draft_graph?.nodes || []).map((n) => n.type);
  assert(types.includes('api') && types.includes('brain'), `nodes=${types.join(',')}`);
  const api = def.draft_graph.nodes.find((n) => n.type === 'api');
  assert(/jsonplaceholder|httpbin|example/i.test(JSON.stringify(api)), 'uses a public no-key URL');
  assert(api?.data?.taskConfig?.authType === 'none', 'API auth none');
}

// --------------------------------------------------------------------------
console.log('\n— S3: Connector briefing');
{
  const msg = `Use my connected apps to pull Hacker News and explain the top stories in plain English. Call it News Recap ${stamp}.`;
  const recipe = matchWorkflowRecipe(msg);
  assert(recipe?.id === 'enduser-connector-briefing', `recipe ${recipe?.id || 'none'}`);
  const res = await chat(msg);
  const def = store.getDefinition(remember(res.workflow_id), owner);
  const conn = def?.draft_graph?.nodes?.find((n) => n.type === 'connector');
  assert(conn?.data?.taskConfig?.actionId === 'hackernews.get_top_stories', 'Hacker News connector');
  assert(def.draft_graph.nodes.some((n) => n.type === 'brain'), 'has summary brain');
}

// --------------------------------------------------------------------------
console.log('\n— S4: Complex API + Connector + MCP recap');
{
  const msg = `Look something up on the web, also check Hacker News, and if I have extra tools wired up use those too — then give me a recap I can act on. Call it Ops Recap ${stamp}.`;
  const recipe = matchWorkflowRecipe(msg);
  assert(recipe?.id === 'enduser-complex-ops', `recipe ${recipe?.id || 'none'}`);
  const res = await chat(msg);
  const def = store.getDefinition(remember(res.workflow_id), owner);
  const types = new Set((def?.draft_graph?.nodes || []).map((n) => n.type));
  assert(types.has('api') && types.has('connector') && types.has('brain'), `types=${[...types].join(',')}`);
  if (types.has('mcp_tool')) notes.push('S4 included MCP (healthy server present)');
  else notes.push('S4 skipped MCP node (no healthy MCP) — acceptable');
  assert(!hasSecretLiteral(def), 'complex graph has no secret literals');
}

// --------------------------------------------------------------------------
console.log('\n— S5: Pasted secret must not persist');
{
  const secret = `sk-test-SHOULD-NOT-STORE-${stamp}abc123xyz`;
  const res = await applyWorkflowBuilderActions(
    owner,
    null,
    [
      {
        action: 'create_workflow',
        name: `Secret Leak ${stamp}`,
        trigger_modes: ['manual'],
        graph: {
          nodes: [
            { id: 'trigger-1', type: 'trigger', position: { x: 40, y: 80 }, data: { label: 'Start', triggerModes: ['manual'] } },
            {
              id: 'brain-1',
              type: 'brain',
              position: { x: 260, y: 80 },
              data: {
                label: 'Paid brain',
                taskConfig: { modelSource: 'openai', apiKey: secret, systemPrompt: 'Hi' },
              },
            },
          ],
          edges: [{ id: 'e1', source: 'trigger-1', target: 'brain-1' }],
        },
      },
    ],
    actor
  );
  const def = store.getDefinition(remember(res.workflow_id), owner);
  assert(!graphJson(def).includes(secret), 'pasted key absent from stored graph');
  const brain = def.draft_graph.nodes.find((n) => n.type === 'brain');
  const cfg = brain.data.taskConfig || {};
  const bound = String(cfg.apiKeyRef || cfg.api_key_ref || '');
  const fellBackOllama = String(cfg.modelSource || '') === 'ollama' && !cfg.apiKey;
  assert(bound === PLATFORM_BYOK_KEY_NAME || fellBackOllama, `bound or ollama (source=${cfg.modelSource} ref=${bound})`);
  assert((res.keys_required || []).length || fellBackOllama || res.keys_summary, 'keys summary present');
}

// --------------------------------------------------------------------------
console.log('\n— S6: Which model?');
{
  const res = await chat('Which model should I use? Do I need an API key?');
  assert(/ollama|Platform_BYOK|API Keys/i.test(res.reply || ''), 'answers with Ollama or bind-key');
  assert(!res.workflow_id || res.actions_applied?.length === 0, 'does not invent a workflow');
}

// --------------------------------------------------------------------------
console.log('\n— S7: Explicit OpenRouter still binds a vault name');
{
  const msg = `create a new workflow called demo openrouter ${stamp}. Get this workflow triggered manually and on chat. Make the Brain of this workflow use openrouter provider and invoke a API after brain to echo the brain response`;
  assert(matchWorkflowRecipe(msg)?.id === 'brain-openrouter-api-echo', 'openrouter recipe');
  const res = await chat(msg);
  const def = store.getDefinition(remember(res.workflow_id), owner);
  const brain = def.draft_graph.nodes.find((n) => n.id === 'brain-1');
  assert(brain?.data?.taskConfig?.modelSource === 'openrouter', 'keeps OpenRouter when asked');
  assert(!brain.data.taskConfig.apiKey, 'no literal OpenRouter key');
  assert(brain.data.taskConfig.apiKeyRef === PLATFORM_BYOK_KEY_NAME, 'binds Platform_BYOK');
  assert(/Platform_BYOK|API Keys/i.test(`${res.reply}\n${res.keys_summary || ''}`), 'summarizes BYOK key');
}

// --------------------------------------------------------------------------
console.log('\n— S8: Promote on Hacker News + Medium (plain English blogs)');
{
  const msg =
    'build a workflow that will promote acme analytics on Hackernews, Medium with blogs about acme analytics it can be about platform intro, platform features and usercase examples.';
  const recipe = matchWorkflowRecipe(msg);
  assert(recipe?.id === 'enduser-content-promote', `recipe ${recipe?.id || 'none'} (must not be HN reader)`);
  const res = await chat(msg);
  const def = store.getDefinition(remember(res.workflow_id), owner);
  const nodes = def?.draft_graph?.nodes || [];
  const types = nodes.map((n) => n.type);
  assert(types.includes('brain') && types.includes('ceo_approval'), `nodes=${types.join(',')}`);
  const medium = nodes.find((n) => n.id === 'api-medium-post');
  assert(medium?.data?.taskConfig?.bearerTokenRef === 'MEDIUM_INTEGRATION_TOKEN', 'Medium binds vault key');
  assert(!String(medium?.data?.taskConfig?.bearerToken || ''), 'no Medium token literal');
  const hn = nodes.find((n) => n.id === 'connector-hn');
  assert(hn?.data?.taskConfig?.appId === 'hackernews', 'Hacker News connector present');
  assert(hn?.data?.taskConfig?.actionId !== 'hackernews.get_top_stories', 'HN is submit not top-stories reader');
  assert(/acme analytics/i.test(JSON.stringify(nodes.find((n) => n.id === 'brain-draft')?.data?.taskConfig?.systemPrompt || '')), 'draft is about the named product');
  assert(/MEDIUM_INTEGRATION_TOKEN|API Keys|Medium/i.test(`${res.reply}\n${res.keys_summary || ''}`), 'summarizes Medium key');
  assert(!hasSecretLiteral(def), 'promote graph has no secret literals');
}

// --------------------------------------------------------------------------
console.log('\n— S9: Generic create intent (story scenes + review + YouTube, LLM + catalog)');
{
  const msg = `build a workflow that will generate story scenes and reviews and uploads to youtube. Call it Story YouTube ${stamp}.`;
  assert(!matchWorkflowRecipe(msg), 'not a curated recipe — LLM chooses nodes from catalog');
  const res = await chat(msg);
  const id = remember(res.workflow_id);
  const def = store.getDefinition(id, owner);
  assert(!!id && !!def, 'created definition from generic intent (not chat-only)');
  const nodes = def?.draft_graph?.nodes || def?.published_graph?.nodes || [];
  const types = nodes.map((n) => n.type);
  const agentNames = nodes.filter((n) => n.type === 'agent').map((n) => `${n.data?.agentName || ''} ${n.data?.agentId || ''}`);
  assert(!agentNames.some((n) => /erp|crm.?checker/i.test(n)), `must not bind ERP/CRM checker (${agentNames.join(',')})`);
  assert(types.includes('trigger'), `has trigger types=${types.join(',')}`);
  assert(nodes.length >= 3, `wired graph nodeCount=${nodes.length}`);
  assert(
    types.includes('ceo_approval') || /youtube|browse_task_start|studio\.youtube/i.test(JSON.stringify(nodes)),
    'LLM wired approval and/or YouTube/Browser Session from catalog'
  );
  assert(!hasSecretLiteral(def), 'generic graph has no secret literals');
}

// --------------------------------------------------------------------------
console.log('\n— S10: Scrape IMDb + Rotten Tomatoes reviews (LLM chooses catalog nodes)');
{
  const msg = `Create a workflow that will scrape imdb and rottentomatoes to get all reviews. Call it Movie Reviews ${stamp}.`;
  assert(!matchWorkflowRecipe(msg), 'scrape reviews is not a curated recipe');
  const res = await chat(msg);
  const id = remember(res.workflow_id);
  const def = store.getDefinition(id, owner);
  assert(!!id && !!def, 'created scrape workflow (not chat-only)');
  const nodes = def?.draft_graph?.nodes || def?.published_graph?.nodes || [];
  const types = nodes.map((n) => n.type);
  const agentNames = nodes.filter((n) => n.type === 'agent').map((n) => `${n.data?.agentName || ''} ${n.data?.agentId || ''}`);
  assert(!agentNames.some((n) => /erp|crm.?checker/i.test(n)), `must not bind ERP/CRM checker (${agentNames.join(',')})`);
  const blob = JSON.stringify(nodes);
  assert(/imdb/i.test(blob) && /rottentomato/i.test(blob), 'graph names both sites');
  assert(
    types.includes('web_scrape') || types.includes('api') || types.includes('tool'),
    `LLM used a catalog fetch capability types=${types.join(',')}`
  );
}

// --------------------------------------------------------------------------
console.log('\n— Lifecycle L1–L4 on Morning Recap');
{
  const target =
    store.listDefinitions(owner).find((w) => w.name?.includes(`Morning Recap ${stamp}`)) ||
    (createdIds[0] ? store.getDefinition(createdIds[0], owner) : null);
  assert(!!target, 'found Morning Recap');
  if (!target) {
    console.error('  skip lifecycle — Morning Recap missing');
  } else {
  const wfId = target.id;

  const live = await chat('Please take it live.', wfId);
  let def = store.getDefinition(wfId, owner);
  assert(def.status === 'published', `after go-live status=${def.status}`);
  assert(live.actions_applied?.some((a) => a.action === 'publish'), 'publish applied');

  if (ollamaOk) {
    try {
      const run = await startAgentWorkflowRun(wfId, owner, {
        trigger: 'manual',
        input: 'Team shipped the weekly recap a day early.',
        actor,
      });
      const done = await waitForRunTerminal(owner, run.id, 180_000);
      notes.push(`Ollama run #${done?.run_number || run.run_number} status=${done?.status || run.status}`);
      assert(done?.status === 'completed', `Ollama live run completed (status=${done?.status || run.status})`);
    } catch (e) {
      notes.push(`Ollama run skipped: ${e.message}`);
    }
  } else {
    notes.push('Skipped live Brain run (Ollama down)');
  }

  const draft = await chat('Put it back in draft.', wfId);
  def = store.getDefinition(wfId, owner);
  assert(def.status === 'draft', `after draft status=${def.status}`);
  assert(draft.actions_applied?.some((a) => a.action === 'unpublish'), 'unpublish applied');

  await chat('Please take it live.', wfId);
  const a2a = await chat('Share this so other companies can call it.', wfId);
  const pub = a2a.actions_applied?.find((a) => a.action === 'publish_a2a' && a.ok);
  assert(!!pub?.publish_id, `A2A publish_id=${pub?.publish_id || 'none'} err=${a2a.actions_applied?.find((a) => a.action === 'publish_a2a')?.error || ''}`);
  if (pub?.publish_id) {
    a2aIds.push(pub.publish_id);
    const listed = listAllPublishedA2AAgents();
    assert(listed.some((a) => a.id === pub.publish_id), 'listed on Agent Exchange');
    const card = getPublicationById(pub.publish_id);
    assert(!!card?.agent_card?.name, 'agent card present');
  }

  const del = await chat("Delete this workflow, I don't need it.", wfId);
  assert(del.actions_applied?.some((a) => a.action === 'delete_workflow' && a.ok), 'delete applied');
  assert(!store.getDefinition(wfId, owner), 'definition removed');
  }
}

// --------------------------------------------------------------------------
console.log('\n— Cleanup remaining stress workflows');
for (const id of createdIds) {
  try {
    const still = store.getDefinition(id, owner);
    if (still) {
      await applyWorkflowBuilderActions(owner, id, [{ action: 'delete_workflow', workflow_id: id }], actor);
    }
  } catch (e) {
    notes.push(`cleanup ${id}: ${e.message}`);
  }
}

console.log('\n=== RESULT ===');
console.log(`passed=${passed} failed=${failed}`);
for (const n of notes) console.log(`note: ${n}`);
if (failed) {
  console.error('WORKFLOW_BUILDER_ENDUSER_STRESS_FAIL');
  process.exit(1);
}
console.log('WORKFLOW_BUILDER_ENDUSER_STRESS_OK');
