/**
 * Mock OpenConnector MCP server for Agent OS e2e tests.
 * Mirrors OpenConnector's discovery-oriented MCP tools:
 *   list_apps, search_actions, get_action_guide, execute_action
 *
 * Env:
 *   OPENCONNECTOR_MOCK_PORT=3105
 *   OPENCONNECTOR_MOCK_TOKEN=   — optional Bearer required on /mcp
 *
 * Run: node tools/openconnector-mcp-mock/server.js
 */
import http from 'http';

const PORT = Number(process.env.OPENCONNECTOR_MOCK_PORT || 3105);
const TOKEN = String(process.env.OPENCONNECTOR_MOCK_TOKEN || '').trim();

const APPS = [
  { id: 'hackernews', name: 'Hacker News', actions: ['hackernews.get_top_stories'] },
  { id: 'github', name: 'GitHub', actions: ['github.get_current_user'] },
];

const ACTIONS = {
  'hackernews.get_top_stories': {
    id: 'hackernews.get_top_stories',
    service: 'hackernews',
    description: 'Fetch top Hacker News story ids (mock)',
    inputSchema: { type: 'object', properties: { limit: { type: 'number' } } },
  },
  'github.get_current_user': {
    id: 'github.get_current_user',
    service: 'github',
    description: 'Get authenticated GitHub user (mock)',
    inputSchema: { type: 'object', properties: {} },
  },
};

function authOk(req) {
  if (!TOKEN) return true;
  const h = String(req.headers.authorization || '');
  const bearer = h.startsWith('Bearer ') ? h.slice(7).trim() : '';
  return bearer === TOKEN;
}

function json(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}

function toolResult(text, structured) {
  return {
    content: [{ type: 'text', text: typeof text === 'string' ? text : JSON.stringify(text) }],
    structuredContent: structured,
  };
}

async function handleToolsCall(name, args = {}) {
  if (name === 'list_apps') {
    return toolResult(APPS, { apps: APPS });
  }
  if (name === 'search_actions') {
    const q = String(args.query || args.q || '').toLowerCase();
    const hits = Object.values(ACTIONS).filter(
      (a) => !q || a.id.includes(q) || a.service.includes(q) || a.description.toLowerCase().includes(q)
    );
    return toolResult(hits, { actions: hits });
  }
  if (name === 'get_action_guide') {
    const id = String(args.actionId || args.action_id || '').trim();
    const action = ACTIONS[id];
    if (!action) throw new Error(`Unknown action: ${id}`);
    const guide = `# ${action.id}\n\n${action.description}\n\nInput schema:\n\`\`\`json\n${JSON.stringify(action.inputSchema, null, 2)}\n\`\`\``;
    return toolResult(guide, { actionId: id, guide });
  }
  if (name === 'execute_action') {
    const id = String(args.actionId || args.action_id || '').trim();
    const action = ACTIONS[id];
    if (!action) throw new Error(`Unknown action: ${id}`);
    const data =
      id === 'hackernews.get_top_stories'
        ? { stories: [1, 2, 3].slice(0, Number(args.input?.limit) || 3), mock: true }
        : { login: 'mock-user', id: 42, mock: true };
    return toolResult(data, { actionId: id, success: true, data });
  }
  throw new Error(`Unknown tool: ${name}`);
}

const TOOLS = [
  {
    name: 'list_apps',
    description: 'List connected OpenConnector apps/providers',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'search_actions',
    description: 'Search OpenConnector actions by query',
    inputSchema: {
      type: 'object',
      properties: { query: { type: 'string' }, q: { type: 'string' } },
    },
  },
  {
    name: 'get_action_guide',
    description: 'Get markdown guide for one action id',
    inputSchema: {
      type: 'object',
      properties: { actionId: { type: 'string' }, action_id: { type: 'string' } },
      required: ['actionId'],
    },
  },
  {
    name: 'execute_action',
    description: 'Execute an OpenConnector action',
    inputSchema: {
      type: 'object',
      properties: {
        actionId: { type: 'string' },
        action_id: { type: 'string' },
        input: { type: 'object' },
      },
      required: ['actionId'],
    },
  },
];

async function handleRpc(msg) {
  const { id, method, params } = msg || {};
  if (method === 'initialize') {
    return {
      jsonrpc: '2.0',
      id,
      result: {
        protocolVersion: '2024-11-05',
        capabilities: { tools: {} },
        serverInfo: { name: 'openconnector-mcp-mock', version: '1.0.0' },
      },
    };
  }
  if (method === 'notifications/initialized') {
    return null;
  }
  if (method === 'tools/list') {
    return { jsonrpc: '2.0', id, result: { tools: TOOLS } };
  }
  if (method === 'tools/call') {
    try {
      const result = await handleToolsCall(params?.name, params?.arguments || {});
      return { jsonrpc: '2.0', id, result };
    } catch (e) {
      return {
        jsonrpc: '2.0',
        id,
        result: {
          content: [{ type: 'text', text: e.message }],
          isError: true,
        },
      };
    }
  }
  if (method === 'prompts/list') {
    return { jsonrpc: '2.0', id, result: { prompts: [] } };
  }
  if (method === 'resources/list') {
    return { jsonrpc: '2.0', id, result: { resources: [] } };
  }
  return {
    jsonrpc: '2.0',
    id,
    error: { code: -32601, message: `Method not found: ${method}` },
  };
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url || '/', `http://127.0.0.1:${PORT}`);

  if (req.method === 'GET' && url.pathname === '/health') {
    return json(res, 200, { ok: true, service: 'openconnector-mcp-mock' });
  }

  if (req.method === 'GET' && url.pathname === '/mcp/tools') {
    if (!authOk(req)) return json(res, 401, { error: 'Unauthorized' });
    return json(res, 200, { tools: TOOLS });
  }

  if (req.method === 'POST' && (url.pathname === '/mcp' || url.pathname === '/mcp/')) {
    if (!authOk(req)) return json(res, 401, { error: 'Unauthorized' });
    let body = '';
    for await (const chunk of req) body += chunk;
    let msg;
    try {
      msg = JSON.parse(body || '{}');
    } catch {
      return json(res, 400, { error: 'Invalid JSON' });
    }
    const reply = await handleRpc(msg);
    if (reply == null) {
      res.writeHead(204);
      return res.end();
    }
    return json(res, 200, reply);
  }

  json(res, 404, { error: 'Not found' });
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`[openconnector-mcp-mock] http://127.0.0.1:${PORT}/mcp`);
});
