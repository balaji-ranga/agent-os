/**
 * Brave Search MCP (HTTP) — bring-your-own-key only.
 *
 * Does NOT read BRAVE_API_KEY from the environment for tool calls.
 * Clients must send the Brave Search API key on each MCP request via:
 *   - X-Subscription-Token: <key>
 *   - or Authorization: Bearer <key>
 *
 * Endpoints:
 *   POST /mcp     MCP JSON-RPC (initialize, tools/list, tools/call, …)
 *   GET  /health  Health check
 *
 * Env:
 *   PORT / BRAVE_MCP_PORT = 8080
 */
import http from 'http';

const PORT = Number(process.env.BRAVE_MCP_PORT || process.env.PORT || 8080);
const BRAVE_WEB_URL = 'https://api.search.brave.com/res/v1/web/search';

function extractBraveKey(req) {
  const sub = String(req.headers['x-subscription-token'] || '').trim();
  if (sub) return sub;
  const auth = String(req.headers.authorization || '').trim();
  if (!auth) return '';
  if (/^bearer\s+/i.test(auth)) return auth.replace(/^bearer\s+/i, '').trim();
  return auth;
}

function jsonRpcOk(id, result) {
  return { jsonrpc: '2.0', id, result };
}

function jsonRpcErr(id, code, message) {
  return { jsonrpc: '2.0', id, error: { code, message } };
}

const TOOLS = [
  {
    name: 'brave_web_search',
    description: 'Brave web search. Requires X-Subscription-Token or Authorization Bearer on the MCP request (BYOK; no server env key).',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Search query' },
        count: { type: 'number', description: 'Result count (1-20)', default: 5 },
      },
      required: ['query'],
    },
  },
];

async function braveWebSearch(apiKey, { query, count = 5 } = {}) {
  const q = String(query || '').trim();
  if (!q) throw new Error('query is required');
  const n = Math.min(Math.max(Number(count) || 5, 1), 20);
  const url = new URL(BRAVE_WEB_URL);
  url.searchParams.set('q', q);
  url.searchParams.set('count', String(n));

  const res = await fetch(url, {
    method: 'GET',
    headers: {
      Accept: 'application/json',
      'X-Subscription-Token': apiKey,
    },
    signal: AbortSignal.timeout(60000),
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`Brave API HTTP ${res.status}: ${text.slice(0, 400)}`);
  }
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error('Brave API returned non-JSON');
  }
  const results = (data.web?.results || []).map((r) => ({
    title: r.title,
    url: r.url,
    description: r.description,
  }));
  return {
    query: q,
    count: results.length,
    results,
  };
}

async function handleMcp(body, req) {
  const { id, method, params } = body || {};

  if (method === 'initialize') {
    return jsonRpcOk(id, {
      protocolVersion: '2024-11-05',
      capabilities: { tools: {} },
      serverInfo: { name: 'brave-search-mcp-byok', version: '1.0.0' },
      instructions:
        'Bring-your-own-key Brave Search. Pass X-Subscription-Token or Authorization: Bearer <BRAVE_API_KEY> on every MCP request. Platform BRAVE_API_KEY env is ignored.',
    });
  }
  if (method === 'notifications/initialized' || method === 'notifications/cancelled') {
    return jsonRpcOk(id ?? null, {});
  }
  if (method === 'tools/list') {
    return jsonRpcOk(id, { tools: TOOLS });
  }
  if (method === 'prompts/list') {
    return jsonRpcOk(id, { prompts: [] });
  }
  if (method === 'resources/list') {
    return jsonRpcOk(id, { resources: [] });
  }
  if (method === 'ping') {
    return jsonRpcOk(id, {});
  }
  if (method === 'tools/call') {
    const name = params?.name;
    const args = params?.arguments || {};
    const apiKey = extractBraveKey(req);
    if (!apiKey) {
      return jsonRpcErr(
        id,
        -32001,
        'Brave API key required on this MCP request (X-Subscription-Token or Authorization Bearer). Platform env key is not used.'
      );
    }
    if (name !== 'brave_web_search') {
      return jsonRpcErr(id, -32601, `Unknown tool: ${name}`);
    }
    try {
      const out = await braveWebSearch(apiKey, args);
      return jsonRpcOk(id, {
        content: [{ type: 'text', text: JSON.stringify(out, null, 2) }],
        isError: false,
      });
    } catch (err) {
      return jsonRpcOk(id, {
        content: [{ type: 'text', text: err.message || String(err) }],
        isError: true,
      });
    }
  }
  return jsonRpcErr(id, -32601, `Method not found: ${method}`);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      if (!raw) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch (e) {
        reject(e);
      }
    });
    req.on('error', reject);
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);

  if (req.method === 'GET' && (url.pathname === '/health' || url.pathname === '/')) {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, mode: 'byok', tools: TOOLS.map((t) => t.name) }));
    return;
  }

  if (req.method === 'POST' && (url.pathname === '/mcp' || url.pathname === '/')) {
    try {
      const body = await readBody(req);
      const reply = await handleMcp(body, req);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(reply));
    } catch (err) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(jsonRpcErr(null, -32700, err.message || 'Parse error')));
    }
    return;
  }

  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: 'not found' }));
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`[brave-search-mcp-byok] listening on 0.0.0.0:${PORT} (BYOK only — no env key fallback)`);
});
