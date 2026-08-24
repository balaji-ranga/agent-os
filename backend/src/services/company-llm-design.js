/**
 * LLM-designed company org when no dedicated industry blueprint exists.
 */
import { chatCompletions } from '../config/llm.js';
import { getBlueprint, hasDedicatedCompanyTemplate, resolveCompanyTypeId } from './company-blueprints/index.js';

const ALLOWED_TOOLS = [
  'learnings_summary',
  'master_data_rag',
  'notify_ceo',
  'kanban_create_task',
  'kanban_move_status',
  'summarize_url',
  'generate_image',
  'generate_video',
  'email_send',
  'browser',
  'browse_task_start',
  'browse_task_status',
  'browse_recipe_list',
  'browse_recipe_run',
  'brave_web_search',
];

const DEFAULT_TOOLS = ['learnings_summary', 'master_data_rag', 'notify_ceo', 'kanban_create_task'];

export function extractCompanyDesignJson(text) {
  const raw = String(text || '').trim();
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    /* fall through */
  }
  const fence = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) {
    try {
      return JSON.parse(fence[1].trim());
    } catch {
      /* fall through */
    }
  }
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start >= 0 && end > start) {
    try {
      return JSON.parse(raw.slice(start, end + 1));
    } catch {
      return null;
    }
  }
  return null;
}

export function hasUsableCompanyDesign(parsed) {
  return (
    parsed != null &&
    typeof parsed === 'object' &&
    Array.isArray(parsed.departments) &&
    parsed.departments.some((department) => String(department?.name || '').trim()) &&
    Array.isArray(parsed.agents) &&
    parsed.agents.some((agent) => String(agent?.name || '').trim())
  );
}

/**
 * Request a compact JSON org design and retry once when a provider returns
 * prose, truncated JSON, or an object without departments/agents.
 */
export async function requestCompanyDesignJson({
  messages,
  maxTokens,
  ownerUserId,
  chatFn = chatCompletions,
}) {
  const run = async (attemptMessages, attempt) => {
    const result = await chatFn({
      messages: attemptMessages,
      maxTokens,
      ownerUserId,
      responseFormat: 'json_object',
      temperature: attempt === 1 ? 0.2 : 0,
    });
    return { ...result, parsed: extractCompanyDesignJson(result?.content) };
  };

  const first = await run(messages, 1);
  if (hasUsableCompanyDesign(first.parsed)) return { ...first, attempts: 1 };

  console.warn('[company-llm-design] invalid structured response; retrying compact JSON');
  const second = await run(
    [
      ...messages,
      {
        role: 'system',
        content: [
          'Your previous response was not a complete usable JSON organization.',
          'Regenerate the answer from the original request.',
          'Return exactly one compact JSON object with non-empty departments and agents arrays.',
          'Do not include markdown, commentary, or text outside the JSON object.',
          'Keep descriptions concise so the entire object fits in the response limit.',
        ].join(' '),
      },
    ],
    2
  );
  return { ...second, attempts: 2 };
}

function clampTools(tools) {
  const list = Array.isArray(tools) ? tools : DEFAULT_TOOLS;
  const out = [];
  for (const t of list) {
    const id = String(t || '').trim();
    if (ALLOWED_TOOLS.includes(id) && !out.includes(id)) out.push(id);
  }
  return out.length ? out.slice(0, 8) : [...DEFAULT_TOOLS];
}

function sanitizeDesign(parsed, fallbackBlueprint) {
  const deptsIn = Array.isArray(parsed?.departments) ? parsed.departments : [];
  const agentsIn = Array.isArray(parsed?.agents) ? parsed.agents : [];
  const departments = deptsIn
    .slice(0, 6)
    .map((d) => ({
      name: String(d?.name || '').trim().slice(0, 80),
      purpose: String(d?.purpose || '').trim().slice(0, 240),
    }))
    .filter((d) => d.name);
  const agents = agentsIn
    .slice(0, 8)
    .map((a) => ({
      name: String(a?.name || '').trim().slice(0, 80),
      role: String(a?.role || a?.name || '').trim().slice(0, 160),
      department: String(a?.department || departments[0]?.name || 'Operations').trim().slice(0, 80),
      tools: clampTools(a?.tools),
    }))
    .filter((a) => a.name);
  const workflows = (Array.isArray(parsed?.workflows) ? parsed.workflows : [])
    .map((w) => String(w).trim().slice(0, 200))
    .filter(Boolean)
    .slice(0, 6);
  const channels = (Array.isArray(parsed?.channels) ? parsed.channels : [])
    .map((c) => String(c).trim().slice(0, 200))
    .filter(Boolean)
    .slice(0, 6);

  if (!departments.length || !agents.length) {
    return {
      departments: fallbackBlueprint.departments,
      agents: fallbackBlueprint.agents,
      workflows: fallbackBlueprint.workflows || [],
      channels: fallbackBlueprint.channels || [],
      design_source: 'template_fallback',
    };
  }

  return {
    departments,
    agents,
    workflows: workflows.length ? workflows : fallbackBlueprint.workflows || [],
    channels: channels.length ? channels : fallbackBlueprint.channels || [],
    design_source: 'llm',
  };
}

/**
 * True when industry lacks a dedicated pack (deep Content Creator, SaaS, talent, trading).
 * Maps like restaurant→general_ops should use LLM.
 */
export function shouldUseLlmOrgDesign(companyType, { describe = '', industry = '' } = {}) {
  if (hasDedicatedCompanyTemplate(companyType)) return false;
  // No dedicated industry pack: use LLM for org design (context improves quality).
  return true;
}

export async function designCompanyOrgWithLlm(ownerUserId, context = {}) {
  const {
    company_name: companyName = '',
    company_type: companyType = 'general_ops',
    company_type_label: typeLabel = '',
    describe_company: describe = '',
    industry = '',
    country = '',
    headcount = '',
    mission = '',
    org_dna: orgDna = '',
    org_dna_notes: orgDnaNotes = '',
  } = context;

  const resolved = resolveCompanyTypeId(companyType);
  const fallback = getBlueprint(resolved);
  const flolahContext = `
Flolah is an AI Company OS. Users hire AI employees (not "configure agents" in UI).
Core platform surfaces: Home chat, My Org, AI Employees (workspaces), Knowledge (tables + docs/RAG),
Kanban, Workflows, Connectors (OpenConnector), Browser Session (human-in-the-browser for social/login sites),
API Keys (BYOK for media), Policies (management style), Agent Channels (Slack/WhatsApp).
COO + lean platform helpers already exist — design specialty AI employees only.
Do not invent native social API publishing; public posts go through Browser Session checklists.
`.trim();

  const userMsg = `
Design departments and AI employees for this company.

Company name: ${companyName || '(unnamed)'}
Selected type / card: ${typeLabel || companyType || resolved}
Resolved template id (no dedicated deep pack): ${resolved}
Describe: ${describe || '(none)'}
Industry: ${industry || '(none)'}
Country/region: ${country || '(none)'}
Team size: ${headcount || '(none)'}
Mission: ${mission || '(none)'}
Organization DNA: ${orgDna || '(none)'} ${orgDnaNotes || ''}
Build around: human CEO owns mission and DNA; design AI specialists who support the CEO (not replace ownership).

Platform context:
${flolahContext}

Allowed tool names (pick only from this list): ${ALLOWED_TOOLS.join(', ')}

Return JSON only with shape:
{
  "departments": [{"name":"...","purpose":"..."}],
  "agents": [{"name":"...","role":"...","department":"...","tools":["..."]}],
  "workflows": ["..."],
  "channels": ["..."]
}
Constraints: 2-5 departments, 2-6 agents; each agent maps to a listed department; roles must match industry; tools must be allowed list only.
`.trim();

  console.info(
    '[company-llm-design] design start owner=',
    ownerUserId,
    'type=',
    resolved,
    'describe_len=',
    String(describe || '').length
  );

  try {
    const { parsed, modelUsed, attempts } = await requestCompanyDesignJson({
      messages: [
        {
          role: 'system',
          content:
            'You design AI company organizations for Flolah. Reply with a single JSON object only. No markdown prose.',
        },
        { role: 'user', content: userMsg },
      ],
      maxTokens: 2800,
      ownerUserId,
    });
    const design = sanitizeDesign(parsed, fallback);
    design.model_used = modelUsed || null;
    design.design_attempts = attempts;
    console.info(
      '[company-llm-design] design done source=',
      design.design_source,
      'depts=',
      design.departments?.length,
      'agents=',
      design.agents?.length,
      'model=',
      modelUsed
    );
    return design;
  } catch (e) {
    console.warn('[company-llm-design] design failed', e?.message || e);
    return {
      departments: fallback.departments,
      agents: fallback.agents,
      workflows: fallback.workflows || [],
      channels: fallback.channels || [],
      design_source: 'template_fallback',
      design_error: e?.message || String(e),
    };
  }
}

/**
 * Conversational refine of existing departments + AI employees.
 * Always uses LLM (even when start design was a template pack).
 * Returns sanitized design + short assistant reply (no JSON in reply field for the UI).
 */
export async function refineCompanyOrgWithLlm(ownerUserId, context = {}) {
  const {
    company_name: companyName = '',
    company_type: companyType = 'general_ops',
    company_type_label: typeLabel = '',
    mission = '',
    org_dna: orgDna = '',
    org_dna_notes: orgDnaNotes = '',
    describe_company: describe = '',
    industry = '',
    message = '',
    current = {},
    history = [],
  } = context;

  const resolved = resolveCompanyTypeId(companyType);
  const fallback = getBlueprint(resolved);
  const baseDepts =
    Array.isArray(current.departments) && current.departments.length
      ? current.departments
      : fallback.departments || [];
  const baseAgents =
    Array.isArray(current.agents) && current.agents.length ? current.agents : fallback.agents || [];
  const baseWorkflows = Array.isArray(current.workflows)
    ? current.workflows
    : fallback.workflows || [];
  const baseChannels = Array.isArray(current.channels) ? current.channels : fallback.channels || [];

  const msg = String(message || '').trim().slice(0, 2000);
  if (!msg) {
    const err = new Error('Message required to refine organization');
    err.status = 400;
    throw err;
  }

  const currentJson = JSON.stringify(
    {
      departments: baseDepts,
      agents: baseAgents,
      workflows: baseWorkflows,
      channels: baseChannels,
    },
    null,
    2
  ).slice(0, 8000);

  const histLines = (Array.isArray(history) ? history : [])
    .slice(-8)
    .map(
      (h) =>
        `${h.role === 'assistant' ? 'Assistant' : 'CEO'}: ${String(h.content || '').slice(0, 500)}`
    )
    .join('\n');

  const system = [
    'You refine an AI company org chart for Flolah (AI employees under a human CEO).',
    'Reply with ONE JSON object only (no markdown fences), shape:',
    '{',
    '  "reply": "short plain-language summary of changes (1-4 sentences)",',
    '  "departments": [{"name":"...","purpose":"..."}],',
    '  "agents": [{"name":"...","role":"...","department":"...","tools":["..."]}],',
    '  "workflows": ["..."],',
    '  "channels": ["..."]',
    '}',
    'Rules:',
    '- Apply the CEO request: add/remove/rename departments or AI employees, change roles, merge teams.',
    '- Keep 1-6 departments and 1-8 specialty agents (not platform COO/helpers).',
    `- tools must be from: ${ALLOWED_TOOLS.join(', ')}`,
    '- Prefer updating relative to CURRENT org when request is incremental; full replace only if asked.',
    '- Never invent live social OAuth; Browser Session is the social path.',
  ].join('\n');

  const userMsg = [
    `Company: ${companyName || '(unnamed)'}`,
    `Type: ${typeLabel || companyType} (${resolved})`,
    `Mission: ${mission || '(none)'}`,
    `DNA: ${orgDna || ''} ${orgDnaNotes || ''}`,
    `Describe: ${describe || ''} Industry: ${industry || ''}`,
    '',
    'CURRENT org JSON:',
    currentJson,
    '',
    'Recent conversation:',
    histLines || '(none)',
    '',
    'CEO request:',
    msg,
  ].join('\n');

  console.info(
    '[company-llm-design] refine start owner=',
    ownerUserId,
    'type=',
    resolved,
    'msg_len=',
    msg.length
  );

  try {
    const { parsed, modelUsed, attempts } = await requestCompanyDesignJson({
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: userMsg },
      ],
      maxTokens: 3200,
      ownerUserId,
    });
    const design = sanitizeDesign(parsed || {}, {
      departments: baseDepts,
      agents: baseAgents,
      workflows: baseWorkflows,
      channels: baseChannels,
    });
    if (design.design_source === 'template_fallback' && baseAgents.length) {
      design.departments = baseDepts;
      design.agents = baseAgents;
      design.workflows = baseWorkflows;
      design.channels = baseChannels;
      design.design_source = 'llm_refine_unchanged';
    } else {
      design.design_source = 'llm_refine';
    }
    design.model_used = modelUsed || null;
    design.design_attempts = attempts;
    design.reply =
      String(parsed?.reply || '')
        .trim()
        .slice(0, 800) ||
      (design.design_source === 'llm_refine'
        ? `Updated org: ${design.departments.length} department(s), ${design.agents.length} AI employee(s).`
        : 'Could not parse a new org chart; kept your current team. Try a shorter request.');
    console.info(
      '[company-llm-design] refine done source=',
      design.design_source,
      'depts=',
      design.departments?.length,
      'agents=',
      design.agents?.length
    );
    return design;
  } catch (e) {
    console.warn('[company-llm-design] refine failed', e?.message || e);
    return {
      departments: baseDepts,
      agents: baseAgents,
      workflows: baseWorkflows,
      channels: baseChannels,
      design_source: 'llm_refine_error',
      design_error: e?.message || String(e),
      reply: 'Refine failed; keeping your current team. Try again in a moment.',
    };
  }
}
