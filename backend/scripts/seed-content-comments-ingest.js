/**
 * Seed content-comments-ingest + community triage using standard workflow nodes only:
 *   trigger → mcp_tool (Meta Graph) → brain (MCP tool loop) → agent (master_data_*) → ceo_approval → brain reply
 * No new platform content tools.
 *
 *   WORKFLOW_SEED_OWNER_ID=ceo-... node backend/scripts/seed-content-comments-ingest.js
 */
import { config } from 'dotenv';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: join(__dirname, '..', '.env') });
config({ path: join(__dirname, '../../deploy/.env') });

import { initDb, getDb } from '../src/db/schema.js';
import * as store from '../src/services/agent-workflow-store.js';
import { listAgentsForUser } from '../src/services/users.js';
import { createTable, findTableByName, ensureTableColumns } from '../src/services/master-data.js';
import { createScheduledGoal, listScheduledGoals } from '../src/services/scheduled-goals.js';
import { META_GRAPH_MCP_ID } from './seed-meta-graph-mcp.js';
import { tryResolveUserApiKey, PLATFORM_BYOK_KEY_NAME } from '../src/services/user-api-keys.js';

initDb();

export const INGEST_WORKFLOW_ID = 'content-comments-ingest';
export const INGEST_CHAT = 'sync social comments';

const OWNER =
  process.env.WORKFLOW_SEED_OWNER_ID ||
  process.env.SOURCE_OWNER_USER_ID ||
  process.env.OWNER_USER_ID ||
  'ceo-content-api-phase01-057515';

const COMMENT_COLS = [
  'when',
  'platform',
  'author',
  'comment_text',
  'risk',
  'status',
  'draft_reply',
  'external_id',
  'post_id',
  'post_url',
  'parent_comment_id',
  'reply_external_id',
];

export const INGEST_SCHEMA = {
  type: 'object',
  properties: {
    platform: {
      type: 'string',
      description: 'facebook (primary Graph MCP path)',
      enum: ['facebook'],
      default: 'facebook',
    },
    page_id: {
      type: 'string',
      description: 'Facebook Page id (optional if OAuth has managed pages)',
    },
    post_id: {
      type: 'string',
      description: 'Optional: limit to one post',
    },
    limit_posts: { type: 'number', description: 'Max posts to scan (default 5)' },
    limit_comments: { type: 'number', description: 'Max comments per post (default 25)' },
  },
  additionalProperties: true,
};

/**
 * Brain needs a per-CEO vault key (platform .env is not allowed on workflow Brain nodes).
 * Prefer Platform_BYOK; fall back to ollama if no vault key.
 */
function brainProviderConfig(ownerUserId = OWNER) {
  const forcedRef = String(process.env.CONTENT_COMMENTS_BRAIN_KEY_REF || '').trim();
  const refs = forcedRef
    ? [forcedRef]
    : [PLATFORM_BYOK_KEY_NAME, 'openai', 'OPENAI', 'OpenAI', 'openrouter', 'OPENROUTER'];
  for (const ref of refs) {
    const hit = ownerUserId ? tryResolveUserApiKey(ownerUserId, ref) : null;
    if (hit?.value) {
      const isOr = /openrouter/i.test(ref);
      return {
        modelSource: isOr ? 'openrouter' : 'openai',
        model: isOr
          ? process.env.OPENROUTER_MODEL || 'openai/gpt-4o-mini'
          : process.env.OPENAI_PRIMARY_MODEL || 'gpt-4o-mini',
        maxTokens: 4000,
        apiKeyRef: ref,
      };
    }
  }
  // No vault key: ollama (no key required) — usable if Ollama is on the host/network.
  console.warn(
    '[seed-content-comments] no Platform_BYOK vault key for brain; using ollama. Set Management → API keys Platform_BYOK for OpenAI-quality fan-out.'
  );
  return {
    modelSource: 'ollama',
    apiEndpoint: process.env.OLLAMA_BASE_URL || 'http://ollama:11434/v1',
    model: process.env.OLLAMA_MODEL || process.env.OPENCLAW_OLLAMA_MODEL || 'llama3.2',
    maxTokens: 4000,
  };
}

function mcpToolNode(id, label, toolName, argsJson, x, y) {
  return {
    id,
    type: 'mcp_tool',
    position: { x, y },
    data: {
      label,
      taskConfig: {
        mcpInvokeKind: 'tool',
        mcpServerId: META_GRAPH_MCP_ID,
        toolName,
        staticArguments: '{}',
        timeoutMs: 120000,
        timeoutAction: 'fail',
      },
      inputBindings: [
        {
          id: 'arguments',
          label: 'Arguments (JSON)',
          mode: 'static',
          value: argsJson,
          sourceNodeId: '',
          sourceOutputKey: 'text',
        },
      ],
      outputs: [
        { id: 'text', label: 'Response text' },
        { id: 'result', label: 'Full result' },
        { id: 'ok', label: 'Success' },
      ],
    },
  };
}

function brainMcpNode(id, label, systemPrompt, allowlist, x, y, inputBindings = []) {
  return {
    id,
    type: 'brain',
    position: { x, y },
    data: {
      label,
      taskConfig: {
        ...brainProviderConfig(OWNER),
        mcpToolCalling: true,
        mcpServerIds: [META_GRAPH_MCP_ID],
        mcpToolAllowlist: allowlist,
        mcpMaxToolRounds: 12,
        systemPrompt,
      },
      inputBindings,
      outputs: [
        { id: 'text', label: 'Response' },
        { id: 'result', label: 'Full result' },
        { id: 'mcp_tool_calls', label: 'MCP tool calls' },
      ],
    },
  };
}

/**
 * Ingest: explicit Meta Graph MCP nodes + brain fan-out + agent writes comment_inbox via existing master_data tools.
 */
export function buildIngestGraph() {
  const myPagesArgs = JSON.stringify({ limit: 10 });
  const fanOutPrompt = [
    'You are the Facebook comment ingest coordinator. You have Meta Graph MCP tools.',
    'Context: prior nodes may include get_my_pages and/or get_page_posts results in the workflow payload.',
    'Trigger input fields: page_id, post_id, limit_posts (default 5), limit_comments (default 25).',
    '',
    'Rules:',
    '1. Start from get_my_pages output in context (do not re-list unless needed). If trigger post_id is set: call get_post_comments once for that post_id.',
    '2. Else use page_id from trigger; if empty, pick the first managed page from get_my_pages result.',
    '3. If you only have pages so far, call get_page_posts for that page_id.',
    '4. For each recent post (up to limit_posts), call get_post_comments (limit_comments).',
    '5. Produce a final JSON object (no markdown fence) exactly shaped:',
    '{"platform":"facebook","page_id":"...","comments":[{"external_id":"...","post_id":"...","post_url":"","author":"...","comment_text":"...","when":"..."}]}',
    '6. Deduplicate by external_id. Do not invent comments. If MCP returns empty, comments:[].',
    '7. Do not post replies in this step.',
  ].join('\n');

  const persistPrompt = [
    'You store Facebook comments into Master Data table comment_inbox.',
    'Input is JSON from the previous Brain step with comments[].',
    'For each comment:',
    '- Use master_data_list_rows on table_name=comment_inbox to check external_id if needed.',
    '- master_data_insert_row with data: when, platform=facebook, author, comment_text, risk=unknown, status=open, draft_reply="", external_id, post_id, post_url, parent_comment_id="", reply_external_id="".',
    'Skip rows already present for the same external_id. Summarize inserted vs skipped counts.',
    'If the table is missing columns, still insert available fields. Never invent comments not in the brain JSON.',
  ].join('\n');

  return {
    nodes: [
      {
        id: 'trigger-1',
        type: 'trigger',
        position: { x: 40, y: 200 },
        data: {
          label: 'Start (page_id / post_id)',
          triggerModes: ['manual', 'chat', 'event'],
          scheduleCron: '',
          chatPhrase: INGEST_CHAT,
          inputSchema: INGEST_SCHEMA,
          outputs: [
            { id: 'text', label: 'Input text' },
            { id: 'trigger_input', label: 'Trigger payload' },
          ],
        },
      },
      mcpToolNode('mcp-my-pages', 'MCP get_my_pages', 'get_my_pages', myPagesArgs, 280, 180),
      brainMcpNode(
        'brain-fanout',
        'Brain + MCP get_page_posts / get_post_comments',
        fanOutPrompt,
        ['get_page_posts', 'get_post_comments', 'get_post'],
        560,
        180,
        [
          {
            id: 'pages',
            mode: 'dynamic',
            sourceNodeId: 'mcp-my-pages',
            sourceOutputKey: 'text',
            value: '',
          },
          {
            id: 'trigger',
            mode: 'dynamic',
            sourceNodeId: 'trigger-1',
            sourceOutputKey: 'trigger_input',
            value: '',
          },
        ]
      ),
      {
        id: 'agent-persist',
        type: 'agent',
        position: { x: 860, y: 180 },
        data: {
          label: 'Persist comment_inbox',
          // agentId filled at seed time
          prompt: persistPrompt,
          inputBindings: [
            {
              id: 'payload',
              mode: 'dynamic',
              sourceNodeId: 'brain-fanout',
              sourceOutputKey: 'text',
              value: '',
            },
          ],
          outputs: [
            { id: 'text', label: 'Summary' },
            { id: 'result', label: 'Full result' },
          ],
        },
      },
    ],
    edges: [
      { id: 'e0', source: 'trigger-1', target: 'mcp-my-pages' },
      { id: 'e1', source: 'mcp-my-pages', target: 'brain-fanout' },
      { id: 'e2', source: 'brain-fanout', target: 'agent-persist' },
    ],
    viewport: { x: 0, y: 0, zoom: 0.75 },
  };
}

/**
 * Community triage: same MCP ingest path, CM drafts, CEO gate, brain posts replies via MCP reply_to_comment.
 */
export function buildCommunityLiveGraph(agents) {
  const cm = match(agents, /community manager|community/i);
  if (!cm) throw new Error('Community Manager required');
  const ingest = buildIngestGraph();
  // Clone ingest nodes/edges then append triage after agent-persist
  const nodes = structuredClone(ingest.nodes);
  const edges = structuredClone(ingest.edges);

  // Bind persist agent
  const persist = nodes.find((n) => n.id === 'agent-persist');
  if (persist) {
    persist.data.agentId = cm.id;
    persist.data.agentName = cm.name;
    persist.data.label = `${cm.name} — write inbox`;
  }

  const draftPrompt = [
    'You are Community Manager. Prior steps ingested live Facebook comments into comment_inbox.',
    '1) master_data_list_rows table_name=comment_inbox (status open preferred).',
    '2) For each open comment: assign risk low|medium|high; write draft_reply (professional, brand-safe; no sexual/abusive/discriminatory content).',
    '3) master_data_update_row to set draft_reply and status=pending_approval (or ignored for spam).',
    '4) Output DRAFT_REPLIES as lines: external_id | risk | draft_text',
    'Do NOT call Graph reply tools here — public replies happen after CEO approval.',
  ].join('\n');

  const replyBrainPrompt = [
    'CEO approved community reply drafts (see prior agent + approval text).',
    'For each APPROVED facebook external_id with a draft_reply, call MCP tool reply_to_comment with comment_id=<external_id> and message=<draft>.',
    'Skip rejected, ignored, high-risk if CEO rejected. Do not invent comment IDs.',
    'Then summarize which external_ids were replied successfully vs failed.',
  ].join('\n');

  nodes.push(
    {
      id: 'agent-draft',
      type: 'agent',
      position: { x: 1120, y: 180 },
      data: {
        label: `${cm.name} — draft replies`,
        agentId: cm.id,
        agentName: cm.name,
        prompt: draftPrompt,
        inputBindings: [
          {
            id: 'payload',
            mode: 'dynamic',
            sourceNodeId: 'agent-persist',
            sourceOutputKey: 'text',
            value: '',
          },
        ],
        outputs: [
          { id: 'text', label: 'Draft replies' },
          { id: 'result', label: 'Full result' },
        ],
      },
    },
    {
      id: 'ceo-1',
      type: 'ceo_approval',
      position: { x: 1380, y: 180 },
      data: {
        label: 'CEO gate (public replies)',
        title: 'Approve community reply drafts',
        instructions: 'Approve to allow Facebook reply_to_comment via MCP. Reject to stop.',
        inputBindings: [
          {
            id: 'summary',
            mode: 'dynamic',
            sourceNodeId: 'agent-draft',
            sourceOutputKey: 'text',
            value: '',
          },
        ],
        outputs: [
          { id: 'decision', label: 'Decision' },
          { id: 'text', label: 'Outcome' },
        ],
      },
    },
    brainMcpNode(
      'brain-reply',
      'Brain + MCP reply_to_comment',
      replyBrainPrompt,
      ['reply_to_comment'],
      1640,
      180,
      [
        {
          id: 'drafts',
          mode: 'dynamic',
          sourceNodeId: 'agent-draft',
          sourceOutputKey: 'text',
          value: '',
        },
        {
          id: 'decision',
          mode: 'dynamic',
          sourceNodeId: 'ceo-1',
          sourceOutputKey: 'text',
          value: '',
        },
      ]
    )
  );
  edges.push(
    { id: 'e5', source: 'agent-persist', target: 'agent-draft' },
    { id: 'e6', source: 'agent-draft', target: 'ceo-1' },
    { id: 'e7', source: 'ceo-1', target: 'brain-reply' }
  );

  return {
    nodes,
    edges,
    viewport: { x: 0, y: 0, zoom: 0.55 },
  };
}

function match(agents, re) {
  const r = typeof re === 'string' ? new RegExp(re, 'i') : re;
  return agents.find((a) => r.test(`${a.name || ''} ${a.role || ''}`));
}

function ensureInbox(ownerUserId) {
  let table = findTableByName(ownerUserId, 'comment_inbox');
  if (!table) {
    table = createTable(ownerUserId, {
      name: 'comment_inbox',
      description: 'Inbound social comments (Facebook Graph MCP ingest). status: open|pending_approval|replied|ignored',
      columns: COMMENT_COLS,
    });
  } else {
    ensureTableColumns(ownerUserId, table.id, COMMENT_COLS);
  }
  return table;
}

function upsert(wf) {
  const actor = { id: 'seed-content-comments', name: 'Seed comments' };
  const prior = store.getDefinition(wf.id, OWNER);
  const patch = {
    name: wf.name,
    description: wf.description,
    graph: wf.graph,
    trigger_modes: ['manual', 'chat', 'event'],
    schedule_cron: '',
    chat_trigger_phrase: wf.chatPhrase || '',
  };
  if (prior) {
    store.updateDraft(wf.id, OWNER, patch, actor);
  } else {
    store.createDefinition({
      id: wf.id,
      name: wf.name,
      description: wf.description,
      ownerUserId: OWNER,
      actor,
      graph: wf.graph,
      trigger_modes: patch.trigger_modes,
      schedule_cron: '',
      chat_trigger_phrase: wf.chatPhrase || '',
    });
  }
  store.publishDefinition(wf.id, OWNER, actor);
  return wf.id;
}

function grantCmMasterDataTools() {
  const db = getDb();
  const ins = db.prepare('INSERT OR IGNORE INTO agent_tool_grants (agent_id, tool_name) VALUES (?, ?)');
  const del = db.prepare('DELETE FROM agent_tool_grants WHERE agent_id = ? AND tool_name = ?');
  const agents = listAgentsForUser(OWNER);
  const cm = match(agents, /community/i);
  const keep = [
    'master_data_list_rows',
    'master_data_update_row',
    'master_data_insert_row',
    'master_data_rag',
    'master_data_list_tables',
    'notify_ceo',
    'learnings_summary',
    'kanban_create_task',
  ];
  const remove = ['content_comments_sync', 'content_comment_reply', 'content_comments_list_open'];
  let n = 0;
  if (cm) {
    for (const t of keep) {
      if (ins.run(cm.id, t).changes) n += 1;
    }
    for (const t of remove) {
      del.run(cm.id, t);
    }
  }
  return { agent: cm?.id, grants: n };
}

export async function seedContentCommentsForOwner(ownerUserId = OWNER) {
  ensureInbox(ownerUserId);
  const agents = listAgentsForUser(ownerUserId);
  const grants = grantCmMasterDataTools();

  const ingestGraph = buildIngestGraph();
  const cm = match(agents, /community/i) || match(agents, /coo/i) || agents[0];
  const persist = ingestGraph.nodes.find((n) => n.id === 'agent-persist');
  if (persist && cm) {
    persist.data.agentId = cm.id;
    persist.data.agentName = cm.name;
  }

  const ingestId = upsert({
    id: INGEST_WORKFLOW_ID,
    name: 'Content comments ingest (FB Graph)',
    description:
      'Standard nodes: Meta Graph mcp_tool (get_my_pages, get_page_posts) → brain MCP loop (get_post_comments) → agent writes comment_inbox via master_data_*. Requires CEO OAuth on Connectors → MCPs (mcp-meta-graph).',
    graph: ingestGraph,
    chatPhrase: INGEST_CHAT,
  });

  let communityId = null;
  try {
    communityId = (`operate-${ownerUserId}-community_triage`)
      .replace(/[^a-zA-Z0-9-_]/g, '-')
      .slice(0, 64);
    upsert({
      id: communityId,
      name: 'Operate - Community comment triage',
      description:
        'MCP nodes + brain fan-out → comment_inbox → Community Manager drafts → CEO gate → brain MCP reply_to_comment. No custom content tools.',
      graph: buildCommunityLiveGraph(agents),
      chatPhrase: 'run community triage',
    });
  } catch (e) {
    console.warn('[seed-content-comments] community graph', e?.message || e);
  }

  const goalTitle = 'Weekly community triage (FB Graph MCP)';
  let goal = listScheduledGoals(ownerUserId).find((g) => String(g.title || '').startsWith('Weekly community triage'));
  if (!goal && cm) {
    goal = await createScheduledGoal(ownerUserId, {
      approve_plan: true,
      title: goalTitle,
      prompt: [
        'Run community triage workflow (chat: run community triage).',
        'Uses Meta Graph MCP nodes for Facebook comments into comment_inbox, drafts, CEO gate, then reply_to_comment.',
        'If OAuth missing, report Connectors → MCPs needed — do not invent comments.',
      ].join(' '),
      agent_id: cm.id,
      cadence: 'weekly',
      weekday: 2,
      time_local: '10:00',
      source: 'seed-content-comments',
    });
  }

  return {
    ok: true,
    owner: ownerUserId,
    style: 'workflow_nodes_only',
    mcp_server: META_GRAPH_MCP_ID,
    ingest_workflow_id: ingestId,
    community_workflow_id: communityId,
    grants,
    goal: goal?.id || null,
  };
}

const isMain =
  process.argv[1] &&
  (process.argv[1].replace(/\\/g, '/').endsWith('seed-content-comments-ingest.js') ||
    process.argv[1].includes('seed-content-comments-ingest'));

if (isMain) {
  const out = await seedContentCommentsForOwner(OWNER);
  console.log(JSON.stringify(out, null, 2));
}