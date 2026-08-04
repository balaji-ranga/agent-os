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

function extractJson(text) {
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
    const { content, modelUsed } = await chatCompletions({
      messages: [
        {
          role: 'system',
          content:
            'You design AI company organizations for Flolah. Reply with a single JSON object only. No markdown prose.',
        },
        { role: 'user', content: userMsg },
      ],
      maxTokens: 1600,
      ownerUserId,
    });
    const parsed = extractJson(content);
    const design = sanitizeDesign(parsed, fallback);
    design.model_used = modelUsed || null;
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