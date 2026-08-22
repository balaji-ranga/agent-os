/**
 * Legacy keyword intent→graph helper (not used by Workflow Builder chat).
 * Chat create-intent is LLM + full node/agent/tool catalog (`agent-workflow-agent.js`).
 */
import { defaultBrainConfig } from './agent-workflow-agent-runtime-context.js';
import { enquireContentTools } from './content-tools-meta.js';

const TOOL_SKIP = new Set([
  'agent_workflow_list',
  'agent_workflow_enquire',
  'agent_workflow_trigger',
  'agent_workflow_runs',
  'agent_workflow_get_draft',
  'agent_workflow_mutate',
  'content_tools_enquire',
  'intent_classify_and_delegate',
  'kanban_move_status',
  'kanban_reassign_to_coo',
  'kanban_assign_task',
  'kanban_create_task',
  'kanban_get_task',
  'kanban_watch_tick',
  'learnings_summary',
  'browse_session_status',
  'browse_task_status',
  'browse_snapshot',
  'browse_act',
  'browse_recipe_list',
  'video_story_status',
  'video_characters_list',
  'video_characters_save',
  'video_characters_ensure_refs',
  'video_characters_bind_upload',
  'video_media_jobs',
  'video_media_ingest_clip',
  'video_media_generate',
  'video_assemble',
]);

const WEB_DESTINATIONS = [
  { re: /\byoutube\b|\byoutu\.be\b|\byt\b|youtube\s*studio/i, label: 'YouTube', url: 'https://studio.youtube.com' },
  { re: /\btiktok\b/i, label: 'TikTok', url: 'https://www.tiktok.com/upload' },
  { re: /\binstagram\b|\binsta\b/i, label: 'Instagram', url: 'https://www.instagram.com' },
  { re: /\b(?:twitter|x\.com)\b/i, label: 'X', url: 'https://x.com/compose/post' },
  { re: /\bfacebook\b|\bfb\b/i, label: 'Facebook', url: 'https://www.facebook.com' },
  { re: /\blinkedin\b/i, label: 'LinkedIn', url: 'https://www.linkedin.com/feed/' },
  { re: /\bmedium\b/i, label: 'Medium', url: 'https://medium.com/new-story' },
  { re: /\bhacker\s*news\b|\bnews\.ycombinator\b/i, label: 'Hacker News', url: 'https://news.ycombinator.com/submit' },
];

const CONNECTOR_HINTS = [
  { re: /\bhacker\s*news\b|\bhackernews\b/i, appId: 'hackernews', appName: 'Hacker News', actionId: 'hackernews.submit_story' },
  { re: /\bgithub\b/i, appId: 'github', appName: 'GitHub', actionId: 'github.create_issue' },
  { re: /\bgmail\b|\bemail\b/i, appId: 'gmail', appName: 'Gmail', actionId: 'gmail.send_email' },
  { re: /\blinkedin\b/i, appId: 'linkedin', appName: 'LinkedIn', actionId: 'linkedin.create_share' },
];

/** Public sites the compiler can scrape/search without inventing APIs. */
const KNOWN_SITES = [
  { re: /\bimdb\b/i, label: 'IMDb', url: 'https://www.imdb.com' },
  { re: /\brotten\s*tomatoes?\b/i, label: 'Rotten Tomatoes', url: 'https://www.rottentomatoes.com' },
  { re: /\bwikipedia\b/i, label: 'Wikipedia', url: 'https://en.wikipedia.org' },
  { re: /\breddit\b/i, label: 'Reddit', url: 'https://www.reddit.com' },
  { re: /\bnews\.ycombinator|hacker\s*news\b/i, label: 'Hacker News', url: 'https://news.ycombinator.com' },
];

const AGENT_STOPWORDS = new Set([
  'the', 'and', 'for', 'with', 'from', 'that', 'will', 'can', 'get', 'all', 'this', 'into',
]);

const BUSINESS_AGENT_RE = /\berp\b|\bcrm\b|invoice|ledger|\bpnl\b|maker.?checker|erp.?checker|crm.?checker/;

const STAGE_SPLIT =
  /\s+(?:and\s+then|then|,?\s*then)\s+|\s*→\s*|\s*->\s*|\s+and\s+(?=(?:generate|creates?|write|writes|draft|review|reviews|upload|uploads|publish|post|posts|send|share|notify|email|summar|look\s+up))/i;

function slugify(name) {
  return String(name || 'workflow')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 40);
}

function tokens(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .split(/\s+/)
    .filter((t) => t.length > 2);
}

export function stripCreatePrefix(message) {
  return String(message || '')
    .replace(
      /^(?:please\s+)?(?:create|build|make|add|set\s*up|setup)\s+(?:a\s+)?(?:new\s+)?workflow\s+(?:that\s+(?:will|can|should)\s+)?/i,
      ''
    )
    .replace(/^i\s+(?:want|need)\s+(?:a\s+)?(?:new\s+)?workflow\s+(?:that\s+(?:will|can|should)\s+)?/i, '')
    .replace(/\s+call(?:ed| it)\s+["']?[^"'\n.]+["']?\s*$/i, '')
    .replace(/[.]+$/g, '')
    .trim();
}

export function inferIntentWorkflowName(message) {
  const t = String(message || '');
  let m = t.match(/(?:called|named|call\s+it)\s+["']([^"']+)["']/i);
  if (m) return m[1].trim().slice(0, 80);
  m = t.match(/(?:called|named|call\s+it)\s+([^"'\n.]+)/i);
  if (m) return m[1].trim().slice(0, 80);
  const body = stripCreatePrefix(message);
  if (!body) return 'New workflow';
  return (body.charAt(0).toUpperCase() + body.slice(1)).slice(0, 70);
}

export function splitIntentStages(message) {
  const body = stripCreatePrefix(message);
  if (!body) return ['do the requested work'];
  const parts = body
    .split(STAGE_SPLIT)
    .map((p) => p.replace(/^that\s+will\s+/i, '').trim())
    .filter(Boolean);
  return parts.length ? parts.slice(0, 8) : [body];
}

export function isPublishStage(text) {
  return /\b(upload|uploads|publish|post|posts|share|send|submit)\b/i.test(text);
}

export function isScrapeIntent(text) {
  const t = String(text || '');
  return (
    /scrap/i.test(t) ||
    /\b(crawl|crawler|web\s*scrape|harvest\s+pages?|extract\s+from\s+(?:the\s+)?(?:web|site|page|imdb|rottentomatoes))\b/i.test(
      t
    )
  );
}

export function isWebSearchIntent(text) {
  return /\b(web\s+search|search\s+the\s+web|google\s+search|brave\s+search|search\s+online|search\s+the\s+internet)\b/i.test(
    String(text || '')
  );
}

export function extractSites(text) {
  const t = String(text || '');
  const out = [];
  const seen = new Set();
  const add = (label, url) => {
    const key = String(url || '').toLowerCase();
    if (!key || seen.has(key)) return;
    seen.add(key);
    out.push({ label, url });
  };
  for (const site of KNOWN_SITES) {
    if (site.re.test(t)) add(site.label, site.url);
  }
  for (const m of t.matchAll(/https?:\/\/[^\s,;]+/gi)) {
    try {
      const u = new URL(m[0].replace(/[),.\]]+$/, ''));
      if (u.protocol === 'https:') add(u.hostname.replace(/^www\./, ''), u.origin);
    } catch {
      /* skip */
    }
  }
  return out;
}

function extractScrapePhrases(text) {
  const phrases = [];
  if (/\breviews?\b/i.test(text)) phrases.push('reviews');
  if (/\bratings?\b/i.test(text)) phrases.push('ratings');
  if (/\bcritic/i.test(text)) phrases.push('critic reviews');
  if (/\buser\s+reviews?\b/i.test(text)) phrases.push('user reviews');
  return phrases.join(', ');
}

/** Collecting reviews/data from the web — not a QA employee step. */
export function isCollectContentStage(text) {
  const t = String(text || '');
  if (isScrapeIntent(t) || extractSites(t).length) return true;
  return /\b(get|collect|fetch|pull|gather)\s+(?:all\s+)?(?:the\s+)?reviews?\b/i.test(t);
}

/** Quality-check the previous generate step. Never used for "scrape reviews from a site". */
export function isReviewStage(text) {
  const t = String(text || '').trim();
  if (!t || isPublishStage(t) || isCollectContentStage(t)) return false;
  if (/^\s*reviews?\s*$/i.test(t)) return true;
  return /\b(review them|review the|quality\s+check|\bqa\b|peer review|approve)\b/i.test(t);
}

function catalogHas(runtime, type) {
  const types = runtime?.nodeTypes;
  if (!Array.isArray(types) || !types.length) return true;
  return types.includes(type);
}

function isBusinessCheckerAgent(agent) {
  return BUSINESS_AGENT_RE.test(`${agent?.id || ''} ${agent?.name || ''} ${agent?.role || ''}`);
}

function matchWebDestination(text) {
  return WEB_DESTINATIONS.find((d) => d.re.test(text)) || null;
}

function matchConnector(text, runtime) {
  const hinted = CONNECTOR_HINTS.find((c) => c.re.test(text));
  if (hinted) return hinted;
  const apps = runtime?.connectors || [];
  const hay = String(text || '').toLowerCase();
  return (
    apps.find((a) => {
      const name = String(a.name || a.appName || a.id || '').toLowerCase();
      return name && hay.includes(name);
    }) || null
  );
}

function scoreHay(hay, stageTokens) {
  let s = 0;
  for (const t of stageTokens) {
    if (hay.includes(t)) s += 2;
  }
  return s;
}

function matchAgent(stage, runtime) {
  const agents = runtime?.agents || [];
  const stageTokens = tokens(stage).filter((t) => !AGENT_STOPWORDS.has(t));
  if (!agents.length || !stageTokens.length) return null;
  const askedBiz = BUSINESS_AGENT_RE.test(stage);
  let best = null;
  let bestScore = 0;
  for (const a of agents) {
    if (!askedBiz && isBusinessCheckerAgent(a)) continue;
    const hay = `${a.id} ${a.name} ${a.role}`.toLowerCase();
    let s = scoreHay(hay, stageTokens);
    if (/scene/.test(stage) && /scene/.test(hay)) s += 4;
    if (/story/.test(stage) && /story/.test(hay) && !/storyboard/.test(stage)) s += 4;
    if (isReviewStage(stage) && /reviewer/.test(hay) && !/checker/.test(hay)) s += 3;
    if (/video/.test(stage) && /video/.test(hay)) s += 3;
    if (s > bestScore) {
      bestScore = s;
      best = a;
    }
  }
  return bestScore >= 5 ? best : null;
}

function rankContentTools(query, runtime) {
  const listed = Array.isArray(runtime?.contentTools) ? runtime.contentTools : [];
  const qTokens = tokens(query);
  if (listed.length && qTokens.length) {
    return listed
      .map((t) => {
        const hay = `${t.name} ${t.display_name || ''} ${t.purpose || ''}`.toLowerCase();
        return { ...t, score: scoreHay(hay, qTokens) };
      })
      .filter((t) => t.score > 0 && !TOOL_SKIP.has(t.name))
      .sort((a, b) => b.score - a.score);
  }
  try {
    return (enquireContentTools(query, { limit: 10 }).tools || []).filter((t) => !TOOL_SKIP.has(t.name));
  } catch {
    return [];
  }
}

function matchTool(stage, runtime) {
  if (isReviewStage(stage) || isPublishStage(stage) || isScrapeIntent(stage)) return null;
  const ranked = rankContentTools(stage, runtime);
  if (!ranked.length) return null;
  const boosted = ranked.map((t) => {
    let s = t.score || 0;
    if (/video|scene|story/.test(stage) && /generate_video|video_storyboard/.test(t.name)) s += 6;
    if (/image|picture|illustration/.test(stage) && t.name === 'generate_image') s += 6;
    if (isWebSearchIntent(stage) && t.name === 'brave_web_search') s += 8;
    if (/\bsummariz/.test(stage) && t.name === 'summarize_url') s += 6;
    return { ...t, score: s };
  }).sort((a, b) => b.score - a.score);
  const top = boosted[0];
  return top && top.score >= 3 ? top : null;
}

function matchMcp(stage, runtime) {
  const servers = runtime?.mcpServers || [];
  const stageTokens = tokens(stage);
  for (const s of servers) {
    for (const toolName of s.tools || []) {
      const hay = `${s.name} ${toolName}`.toLowerCase();
      if (scoreHay(hay, stageTokens) >= 4) {
        return { serverId: s.id, serverName: s.name, toolName };
      }
    }
  }
  return null;
}

function findToolByName(runtime, name) {
  const listed = runtime?.contentTools || [];
  if (listed.some((t) => t.name === name)) return name;
  try {
    const hit = enquireContentTools(name, { limit: 8 }).tools?.find((t) => t.name === name);
    return hit ? name : null;
  } catch {
    return null;
  }
}

function outputKeyFor(node) {
  if (!node) return 'text';
  if (node.type === 'tool') return 'result';
  if (node.type === 'api') return 'body';
  if (node.type === 'ceo_approval') return 'decision';
  if (node.type === 'trigger') return 'trigger_input';
  if (node.type === 'merge') return 'merged';
  if (node.type === 'web_scrape') return 'text';
  return 'text';
}

function titleCaseLabel(text) {
  const s = String(text || 'Step').trim();
  return (s.charAt(0).toUpperCase() + s.slice(1)).slice(0, 42);
}

function triggerNode(phrase, modes) {
  return {
    id: 'trigger-1',
    type: 'trigger',
    position: { x: 40, y: 120 },
    data: {
      label: 'Start',
      triggerModes: modes,
      scheduleCron: '',
      chatPhrase: modes.includes('chat') ? phrase : '',
      outputs: [{ id: 'trigger_input', label: 'Trigger payload' }],
    },
  };
}

function brainNode(id, label, x, y, systemPrompt, sourceNodeId, sourceOutputKey) {
  return {
    id,
    type: 'brain',
    position: { x, y },
    data: {
      label,
      inputBindings: [
        {
          id: 'userMessage',
          label: 'User message',
          mode: 'dynamic',
          sourceNodeId,
          sourceOutputKey,
        },
      ],
      taskConfig: {
        ...defaultBrainConfig(),
        maxTokens: 700,
        systemPrompt,
      },
    },
  };
}

function agentNode(id, label, x, y, agent, prompt, sourceNodeId, sourceOutputKey) {
  return {
    id,
    type: 'agent',
    position: { x, y },
    data: {
      label,
      agentId: agent.id,
      agentName: agent.name,
      prompt,
      inputBindings: [
        {
          id: 'prompt',
          label: 'Task / prompt',
          mode: 'dynamic',
          sourceNodeId,
          sourceOutputKey,
          value: '',
        },
      ],
      outputs: [{ id: 'text', label: 'Agent response' }],
    },
  };
}

function toolNode(id, label, x, y, toolName, payload, sourceNodeId, sourceOutputKey) {
  return {
    id,
    type: 'tool',
    position: { x, y },
    data: {
      label,
      toolName,
      toolPayload: payload || {},
      inputBindings: [
        {
          id: 'payload',
          label: 'Tool payload',
          mode: 'dynamic',
          sourceNodeId,
          sourceOutputKey,
        },
      ],
      outputs: [{ id: 'result', label: 'Tool result' }],
    },
  };
}

function connectorNode(id, label, x, y, conn, sourceNodeId, sourceOutputKey) {
  return {
    id,
    type: 'connector',
    position: { x, y },
    data: {
      label,
      inputBindings: [
        {
          id: 'input',
          label: 'Action input',
          mode: 'dynamic',
          sourceNodeId,
          sourceOutputKey,
          value: '',
        },
      ],
      taskConfig: {
        appId: conn.appId || conn.id,
        appName: conn.appName || conn.name,
        actionId: conn.actionId || `${conn.appId || conn.id}.default`,
        timeoutMs: 120000,
        timeoutAction: 'fail',
      },
    },
  };
}

function ceoApprovalNode(id, x, y, sourceNodeId) {
  return {
    id,
    type: 'ceo_approval',
    position: { x, y },
    data: {
      label: 'Your approval',
      inputBindings: [
        {
          id: 'summary',
          label: 'Summary',
          mode: 'dynamic',
          sourceNodeId,
          sourceOutputKey: 'text',
        },
      ],
      taskConfig: {
        title: 'Approve before publish / upload',
        instructions: 'Review the draft. Approve to continue to publish or upload. Reject to stop.',
      },
    },
  };
}

function ifApprovedNode(id, x, y) {
  return {
    id,
    type: 'if',
    position: { x, y },
    data: {
      label: 'If approved',
      taskConfig: {
        sourceNodeId: 'ceo-1',
        sourceOutputKey: 'decision',
        operator: 'eq',
        compareValue: 'approved',
      },
    },
  };
}

function scrapeNode(id, label, x, y, url, phrases) {
  return {
    id,
    type: 'web_scrape',
    position: { x, y },
    data: {
      label,
      inputBindings: [
        { id: 'startUrl', label: 'Start URL / domain', mode: 'static', value: url },
        { id: 'phrases', label: 'Search phrases', mode: 'static', value: phrases || '' },
        { id: 'cookie', label: 'Cookie header (optional)', mode: 'static', value: '' },
      ],
      outputs: [
        { id: 'ok', label: 'Success' },
        { id: 'text', label: 'Summary text' },
        { id: 'matches', label: 'Matching pages JSON' },
        { id: 'pages', label: 'Visited pages JSON' },
        { id: 'stats', label: 'Crawl stats JSON' },
        { id: 'result', label: 'Full result JSON' },
      ],
      taskConfig: {
        render: 'auto',
        maxPages: 25,
        maxDepth: 2,
        sameOriginOnly: true,
        respectRobotsTxt: true,
        timeoutMs: 180000,
        timeoutAction: 'fail',
        defaultTimeoutOutput: '{}',
      },
    },
  };
}

function parallelNode(id, x, y) {
  return {
    id,
    type: 'parallel',
    position: { x, y },
    data: { label: 'Fan out', inputBindings: [], outputs: [{ id: 'out', label: 'Branch signal' }] },
  };
}

function mergeNode(id, x, y) {
  return {
    id,
    type: 'merge',
    position: { x, y },
    data: { label: 'Join sites', inputBindings: [], outputs: [{ id: 'merged', label: 'Merged context' }] },
  };
}

function filesystemNode(id, label, x, y) {
  return {
    id,
    type: 'filesystem',
    position: { x, y },
    data: {
      label,
      inputBindings: [{ id: 'path', label: 'Path', mode: 'static', value: '' }],
      taskConfig: {
        transport: 'local',
        operation: 'list',
        timeoutMs: 120000,
        timeoutAction: 'fail',
      },
    },
  };
}

function masterdataNode(id, label, x, y, sourceNodeId, sourceOutputKey) {
  return {
    id,
    type: 'masterdata',
    position: { x, y },
    data: {
      label,
      inputBindings: [
        {
          id: 'query',
          label: 'Query / question',
          mode: 'dynamic',
          sourceNodeId,
          sourceOutputKey,
        },
      ],
      taskConfig: { mode: 'auto', topK: 5, summarize: true, timeoutMs: 120000, timeoutAction: 'fail' },
    },
  };
}

function bindStage(stage, runtime) {
  const sites = extractSites(stage);
  const wantsSiteData =
    isScrapeIntent(stage) ||
    (sites.length > 0 && /\b(reviews?|ratings?|crawl|extract|harvest|pages?)\b/i.test(stage));
  if (wantsSiteData && catalogHas(runtime, 'web_scrape')) {
    const scrapeSites = sites.length
      ? sites
      : [{ label: 'Start URL', url: '{{trigger-1.trigger_input}}' }];
    return {
      kind: 'scrape',
      sites: scrapeSites,
      phrases: extractScrapePhrases(stage),
      label: scrapeSites.length > 1 ? 'Scrape named sites' : `Scrape ${scrapeSites[0].label}`,
    };
  }

  if (isWebSearchIntent(stage)) {
    const brave = findToolByName(runtime, 'brave_web_search');
    if (brave) {
      return {
        kind: 'tool',
        tool: { name: brave },
        label: 'Web search',
        searchQuery: stage,
      };
    }
    const mcpSearch = matchMcp(stage, runtime);
    if (mcpSearch) return { kind: 'mcp', mcp: mcpSearch, label: 'Web search' };
  }

  if (catalogHas(runtime, 'filesystem') && /\b(folder|directory|ftp|sftp|local files)\b/i.test(stage)) {
    return { kind: 'filesystem', label: titleCaseLabel(stage) };
  }

  if (catalogHas(runtime, 'masterdata') && /\b(master data|knowledge base|\brag\b|our documents)\b/i.test(stage)) {
    return { kind: 'masterdata', label: titleCaseLabel(stage) };
  }

  if (isPublishStage(stage)) {
    const dest = matchWebDestination(stage);
    const conn = matchConnector(stage, runtime);
    const browse = findToolByName(runtime, 'browse_task_start') || findToolByName(runtime, 'browse_recipe_run');
    if (conn && !dest) {
      return { kind: 'connector', connector: conn, label: `Post to ${conn.appName || conn.name}` };
    }
    if (conn && dest && /hacker|linkedin|github|gmail/i.test(conn.appId || '')) {
      return { kind: 'connector', connector: conn, label: `Post to ${conn.appName || dest.label}` };
    }
    if (browse) {
      return {
        kind: 'browse',
        toolName: browse,
        dest,
        label: dest ? `Upload to ${dest.label}` : titleCaseLabel(stage),
      };
    }
    if (conn) {
      return { kind: 'connector', connector: conn, label: `Post to ${conn.appName || conn.name}` };
    }
    return {
      kind: 'brain',
      label: dest ? `Prepare ${dest.label} upload` : titleCaseLabel(stage),
      prompt: dest
        ? `Prepare a complete ${dest.label} upload package from the prior step: title, description, tags, and a short checklist for ${dest.url}. Do not invent credentials.\n\n{{input}}`
        : `Prepare a complete publish/upload package from the prior step (title, body, destination steps). Do not invent credentials.\n\n{{input}}`,
    };
  }

  if (isReviewStage(stage)) {
    const agent = matchAgent(stage, runtime);
    if (agent) {
      return {
        kind: 'agent',
        agent,
        label: `Review (${agent.name})`,
        prompt: `Review the prior step output for quality, safety, and completeness. Return a verdict (PASS or FAIL) plus specific edits.\n\n{{input}}`,
      };
    }
    return {
      kind: 'brain',
      label: 'Review',
      prompt:
        'Review the prior step. Check quality, safety, and whether it is ready to publish. Return PASS or FAIL, then a short punch list of fixes.\n\n{{input}}',
    };
  }

  const tool = matchTool(stage, runtime);
  if (tool) {
    return { kind: 'tool', tool, label: titleCaseLabel(stage) };
  }

  const mcp = matchMcp(stage, runtime);
  if (mcp) {
    return { kind: 'mcp', mcp, label: titleCaseLabel(stage) };
  }

  const agent = matchAgent(stage, runtime);
  if (agent) {
    return {
      kind: 'agent',
      agent,
      label: titleCaseLabel(stage),
      prompt: `Complete this step: ${stage}. Use the prior output and the run input.\n\n{{input}}`,
    };
  }

  return {
    kind: 'brain',
    label: titleCaseLabel(stage),
    prompt: `You are doing this step of a workflow: ${stage}.\nUse the prior output and the run input. Return the deliverable only.\n\n{{input}}`,
  };
}

function mcpToolNode(id, label, x, y, mcp, sourceNodeId, sourceOutputKey) {
  return {
    id,
    type: 'mcp_tool',
    position: { x, y },
    data: {
      label,
      inputBindings: [
        {
          id: 'arguments',
          label: 'Arguments (JSON)',
          mode: 'dynamic',
          sourceNodeId,
          sourceOutputKey,
        },
      ],
      taskConfig: {
        mcpInvokeKind: 'tool',
        mcpServerId: mcp.serverId,
        toolName: mcp.toolName,
        staticArguments: '{}',
        timeoutMs: 120000,
        timeoutAction: 'fail',
      },
    },
  };
}

function toolPayloadFor(binding, stage) {
  if (binding.kind === 'browse') {
    const dest = binding.dest;
    return {
      goal: dest
        ? `Using the prior step's media and copy, upload or publish to ${dest.label} (${dest.url}). Stay on that site. Do not invent passwords; use the signed-in Browser Session.`
        : `Using the prior step's media and copy, complete this publish step: ${stage}. Use the signed-in Browser Session. Do not invent passwords.`,
      start_url: dest?.url || '',
      mode: 'autonomous',
    };
  }
  if (binding.tool?.name === 'brave_web_search') {
    return { query: binding.searchQuery || binding.stage || '{{input}}', count: 10 };
  }
  if (binding.tool?.name === 'generate_video') {
    return { prompt: '{{input}}' };
  }
  if (binding.tool?.name === 'generate_image') {
    return { prompt: '{{input}}' };
  }
  if (binding.tool?.name === 'video_storyboard_export') {
    return { persist: true, formats: ['html', 'pdf'] };
  }
  return {};
}

/**
 * Compile any create-intent message into a create_workflow spec (name, graph, summary).
 */
export function synthesizeIntentWorkflow(message, runtime = {}) {
  const stages = splitIntentStages(message);
  const name = inferIntentWorkflowName(message);
  const phrase = `run ${slugify(name)}`;
  const modes = ['manual', 'chat'];
  const bindings = stages.map((stage) => ({ stage, ...bindStage(stage, runtime) }));

  const nodes = [triggerNode(phrase, modes)];
  const edges = [];
  let flowPrev = nodes[0];
  let dataPrev = nodes[0];
  let x = 280;
  let seq = 1;
  let usedApproval = false;
  const notes = [];

  const publishAt = bindings.findIndex((b) => isPublishStage(b.stage));
  const needsApproval = publishAt >= 0;

  const addEdge = (source, target, extra = {}) => {
    edges.push({ id: `e${edges.length + 1}`, source: source.id, target: target.id, ...extra });
  };

  const nextId = (prefix) => {
    const id = `${prefix}-${seq}`;
    seq += 1;
    return id;
  };

  const attach = (node, { dataFrom = dataPrev, edgeFrom = flowPrev, extraEdge = {} } = {}) => {
    const bindKey = outputKeyFor(dataFrom);
    if (node.data?.inputBindings?.length && !node.data.inputBindings[0].sourceNodeId) {
      node.data.inputBindings[0].sourceNodeId = dataFrom.id;
      node.data.inputBindings[0].sourceOutputKey = bindKey;
    }
    nodes.push(node);
    addEdge(edgeFrom, node, extraEdge);
    flowPrev = node;
    if (node.type !== 'if' && node.type !== 'ceo_approval') dataPrev = node;
    x += 240;
    return node;
  };

  for (let i = 0; i < bindings.length; i += 1) {
    const b = bindings[i];
    const enteringPublish = needsApproval && i === publishAt && !usedApproval;

    if (enteringPublish) {
      const ceo = ceoApprovalNode('ceo-1', x, 40, dataPrev.id);
      ceo.data.inputBindings[0].sourceOutputKey = outputKeyFor(dataPrev);
      attach(ceo, { dataFrom: dataPrev, edgeFrom: flowPrev });
      const iff = ifApprovedNode('if-1', x, 40);
      attach(iff, { dataFrom: dataPrev, edgeFrom: flowPrev });
      const rejected = brainNode(
        'brain-rejected',
        'Stopped after reject',
        x,
        260,
        'One sentence: the CEO rejected the draft, so nothing was published or uploaded.\n{{input}}',
        'ceo-1',
        'comment'
      );
      nodes.push(rejected);
      edges.push({ id: 'e-reject', source: 'if-1', target: 'brain-rejected', sourceHandle: 'false' });
      usedApproval = true;
    }

    const fromIf = flowPrev.type === 'if';
    const extraEdge = fromIf ? { sourceHandle: 'true' } : {};
    const y = fromIf ? 40 : 120;
    const srcKey = outputKeyFor(dataPrev);

    if (b.kind === 'scrape') {
      const sites = b.sites || [];
      const phrases = b.phrases || '';
      const scrapeNodes = [];
      if (sites.length >= 2) {
        const par = parallelNode(nextId('parallel'), x, y);
        attach(par, { extraEdge });
        sites.forEach((site, i) => {
          const sn = scrapeNode(
            nextId('scrape'),
            `Scrape ${site.label}`,
            x + 80,
            y + i * 140,
            site.url,
            phrases
          );
          nodes.push(sn);
          addEdge(par, sn);
          scrapeNodes.push(sn);
        });
        const mg = mergeNode(nextId('merge'), x + 320, y);
        nodes.push(mg);
        scrapeNodes.forEach((sn) => addEdge(sn, mg));
        flowPrev = mg;
        dataPrev = scrapeNodes[0];
        x += 480;
      } else {
        const site = sites[0] || { label: 'Site', url: '{{trigger-1.trigger_input}}' };
        const sn = scrapeNode(nextId('scrape'), `Scrape ${site.label}`, x, y, site.url, phrases);
        attach(sn, { extraEdge });
        scrapeNodes.push(sn);
      }
      const refs = scrapeNodes.map((n) => `${n.data.label}:\n{{${n.id}.text}}`).join('\n\n');
      const compile = brainNode(
        nextId('brain'),
        'Compile reviews',
        x,
        y,
        `Compile a structured review digest from the scrape output. Group by source. Quote titles, scores, and short excerpts. Do not invent reviews.\n\n${refs}\n\nAlso use:\n{{input}}`,
        scrapeNodes[0].id,
        'text'
      );
      compile.data.taskConfig.maxTokens = 1200;
      attach(compile);
      notes.push(`web_scrape ×${scrapeNodes.length}${phrases ? ` (${phrases})` : ''}`);
      continue;
    }
    if (b.kind === 'filesystem') {
      const fs = filesystemNode(nextId('fs'), b.label, x, y);
      nodes.push(fs);
      addEdge(flowPrev, fs, extraEdge);
      flowPrev = fs;
      dataPrev = fs;
      notes.push('filesystem');
      continue;
    }
    if (b.kind === 'masterdata') {
      attach(masterdataNode(nextId('md'), b.label, x, y, dataPrev.id, srcKey), { extraEdge });
      notes.push('master data');
      continue;
    }
    if (b.kind === 'agent') {
      attach(
        agentNode(nextId('agent'), b.label, x, y, b.agent, b.prompt, dataPrev.id, srcKey),
        { extraEdge }
      );
      notes.push(`employee ${b.agent.name}`);
      continue;
    }
    if (b.kind === 'tool') {
      if (b.tool?.name === 'video_storyboard_export' || b.tool?.name === 'generate_video') {
        const planner = brainNode(
          nextId('brain'),
          b.tool.name === 'video_storyboard_export' ? 'Write story scenes' : 'Write video prompt',
          x,
          y,
          b.tool.name === 'video_storyboard_export'
            ? `Write a storyboard JSON for this request: ${b.stage}. Include title, duration_sec, characters[], scenes[{title,action,dialogue,duration_sec}]. Return JSON only.\n\n{{input}}`
            : `Write one clear video-generation prompt for: ${b.stage}. Return the prompt only.\n\n{{input}}`,
          dataPrev.id,
          srcKey
        );
        attach(planner, { extraEdge });
        attach(
          toolNode(
            nextId('tool'),
            b.label,
            x,
            y,
            b.tool.name,
            toolPayloadFor(b, b.stage),
            dataPrev.id,
            'text'
          )
        );
      } else {
        attach(
          toolNode(
            nextId('tool'),
            b.label,
            x,
            y,
            b.tool.name,
            toolPayloadFor(b, b.stage),
            dataPrev.id,
            srcKey
          ),
          { extraEdge }
        );
      }
      notes.push(`tool ${b.tool.name}`);
      continue;
    }
    if (b.kind === 'browse') {
      attach(
        toolNode(
          nextId('tool'),
          b.label,
          x,
          y,
          b.toolName,
          toolPayloadFor(b, b.stage),
          dataPrev.id,
          srcKey
        ),
        { extraEdge }
      );
      notes.push(
        b.dest
          ? `${b.dest.label} via Browser Session (${b.toolName})`
          : `Browser Session (${b.toolName})`
      );
      continue;
    }
    if (b.kind === 'connector') {
      attach(
        connectorNode(nextId('connector'), b.label, x, y, b.connector, dataPrev.id, srcKey),
        { extraEdge }
      );
      notes.push(`connector ${b.connector.appName || b.connector.appId}`);
      continue;
    }
    if (b.kind === 'mcp') {
      attach(mcpToolNode(nextId('mcp'), b.label, x, y, b.mcp, dataPrev.id, srcKey), { extraEdge });
      notes.push(`MCP ${b.mcp.toolName}`);
      continue;
    }
    attach(brainNode(nextId('brain'), b.label, x, y, b.prompt, dataPrev.id, srcKey), { extraEdge });
    notes.push(`brain: ${b.label}`);
  }

  const summary = `Built from your ask (${stages.join(' → ')}). Uses ${notes.join(', ') || 'Ollama brains'}. Public upload/publish waits for your approval.`;

  console.info('[workflow-builder] compiled create intent', {
    name,
    stages: stages.length,
    nodeTypes: nodes.map((n) => n.type),
    notes,
  });

  return {
    name,
    chat_phrase: phrase,
    trigger_modes: modes,
    graph: { nodes, edges, viewport: { x: 0, y: 0, zoom: 0.7 } },
    autoTest: false,
    summary,
    stages,
  };
}

export function buildIntentCreateActionBatch(message, runtime) {
  const spec = synthesizeIntentWorkflow(message, runtime);
  return {
    spec,
    actions: [
      {
        action: 'create_workflow',
        name: spec.name,
        chat_phrase: spec.chat_phrase,
        trigger_modes: spec.trigger_modes,
        graph: spec.graph,
      },
      { action: 'publish' },
    ],
  };
}

export function actionsHaveSubstantialCreate(actions) {
  const list = Array.isArray(actions) ? actions : [];
  if (list.some((a) => ['create_from_template', 'clone_workflow'].includes(String(a?.action || '')))) {
    return true;
  }
  const create = list.find((a) => a.action === 'create_workflow');
  if ((create?.graph?.nodes?.length || 0) > 1) return true;
  if (list.some((a) => ['add_node', 'update_node'].includes(String(a?.action || '')))) return true;
  return false;
}
