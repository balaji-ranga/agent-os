/**
 * Web scrape MCP — Crawlee sidecar.
 * POST /mcp  JSON-RPC tools: scrape_url, scrape_domain
 * POST /v1/scrape  same payload (workflow node / content tools)
 * GET  /health
 *
 * Auth: Bearer TOOLS_API_KEY when set. Owner id is logged from X-Ceo-User-Id (never used as a crawl target).
 */
import http from 'node:http';
import { runScrape } from './crawler.js';

const PORT = Number(process.env.WEB_SCRAPE_MCP_PORT || process.env.PORT || 8085);
const TOOLS_API_KEY = String(process.env.TOOLS_API_KEY || '').trim();
const INTERNAL_TOKEN = String(process.env.AGENT_OS_INTERNAL_TOKEN || '').trim();

function jsonRpcOk(id, result) {
  return { jsonrpc: '2.0', id, result };
}
function jsonRpcErr(id, code, message) {
  return { jsonrpc: '2.0', id, error: { code, message } };
}

function readBearer(req) {
  const auth = String(req.headers.authorization || '').trim();
  if (/^bearer\s+/i.test(auth)) return auth.replace(/^bearer\s+/i, '').trim();
  return '';
}

function authorize(req, pathname) {
  // MCP JSON-RPC is internal-compose only (no published ports), same as Brave MCP.
  if (String(pathname || '').startsWith('/mcp')) return true;
  if (!TOOLS_API_KEY && !INTERNAL_TOKEN) return true;
  const bearer = readBearer(req);
  if (TOOLS_API_KEY && bearer && bearer === TOOLS_API_KEY) return true;
  const internal = String(req.headers['x-agent-os-internal-token'] || '').trim();
  if (INTERNAL_TOKEN && (bearer === INTERNAL_TOKEN || internal === INTERNAL_TOKEN)) return true;
  return false;
}

function ownerFromReq(req) {
  return String(req.headers['x-ceo-user-id'] || req.headers['x-agent-os-user-id'] || '').trim() || null;
}

const TOOLS = [
  {
    name: 'scrape_url',
    description:
      'Fetch one HTTPS page and return title, main text, and optional phrase hits. Not for logged-in Browser Session recipes.',
    inputSchema: {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'HTTPS URL' },
        phrases: { type: 'array', items: { type: 'string' }, description: 'Optional search phrases' },
        render: { type: 'string', enum: ['auto', 'http', 'playwright'] },
        cookie: { type: 'string', description: 'Optional Cookie header (e.g. sessionid=…)' },
      },
      required: ['url'],
    },
  },
  {
    name: 'scrape_domain',
    description:
      'Crawl a website or domain (same-origin, robots.txt, capped pages/depth) and score pages by search phrases.',
    inputSchema: {
      type: 'object',
      properties: {
        startUrl: { type: 'string', description: 'HTTPS start URL or domain' },
        domain: { type: 'string' },
        phrases: { type: 'array', items: { type: 'string' } },
        maxPages: { type: 'number', description: 'Default 25, hard cap 200' },
        maxDepth: { type: 'number', description: 'Default 2, hard cap 6' },
        render: { type: 'string', enum: ['auto', 'http', 'playwright'] },
        includeGlobs: { type: 'array', items: { type: 'string' } },
        excludeGlobs: { type: 'array', items: { type: 'string' } },
        cookie: { type: 'string' },
      },
    },
  },
];

function mcpTextResult(payload) {
  const text = typeof payload?.text === 'string' ? payload.text : JSON.stringify(payload);
  return {
    content: [{ type: 'text', text }],
    structuredContent: payload,
    isError: payload?.ok === false,
  };
}

async function handleTool(name, args, ownerUserId) {
  const input = { ...(args || {}) };
  if (name === 'scrape_url') {
    input.startUrl = input.url || input.startUrl;
    input.maxPages = 1;
    input.maxDepth = 0;
  } else if (name !== 'scrape_domain') {
    throw Object.assign(new Error(`Unknown tool: ${name}`), { status: 400 });
  }
  console.info('[web-scrape-mcp] start', {
    tool: name,
    owner: ownerUserId || null,
    host: (() => {
      try {
        const raw = String(input.startUrl || input.url || input.domain || '');
        return new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`).hostname;
      } catch {
        return 'invalid';
      }
    })(),
    render: input.render || 'auto',
    maxPages: input.maxPages,
  });
  return runScrape(input);
}

async function handleMcp(body, req) {
  const { id, method, params } = body || {};
  if (method === 'initialize') {
    return jsonRpcOk(id, {
      protocolVersion: '2024-11-05',
      capabilities: { tools: {} },
      serverInfo: { name: 'web-scrape-mcp', version: '1.0.0' },
      instructions:
        'Generic HTTPS crawler (Crawlee). scrape_url for one page; scrape_domain for bounded same-origin crawl + phrase filter. Pass X-Ceo-User-Id. Optional Cookie for sites that need a session.',
    });
  }
  if (method === 'notifications/initialized' || method === 'notifications/cancelled') {
    return jsonRpcOk(id ?? null, {});
  }
  if (method === 'tools/list') return jsonRpcOk(id, { tools: TOOLS });
  if (method === 'prompts/list') return jsonRpcOk(id, { prompts: [] });
  if (method === 'resources/list') return jsonRpcOk(id, { resources: [] });
  if (method === 'ping') return jsonRpcOk(id, {});
  if (method === 'tools/call') {
    const name = params?.name;
    const args = params?.arguments || {};
    if (!TOOLS.some((t) => t.name === name)) {
      return jsonRpcErr(id, -32601, `Unknown tool: ${name}`);
    }
    try {
      const out = await handleTool(name, args, ownerFromReq(req));
      return jsonRpcOk(id, mcpTextResult(out));
    } catch (e) {
      const msg = String(e?.message || e).slice(0, 400);
      console.warn('[web-scrape-mcp] tool error', { tool: name, error: msg });
      return jsonRpcOk(id, {
        content: [{ type: 'text', text: msg }],
        isError: true,
      });
    }
  }
  return jsonRpcErr(id, -32601, `Unknown method: ${method}`);
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let n = 0;
    req.on('data', (c) => {
      n += c.length;
      if (n > 2 * 1024 * 1024) {
        reject(Object.assign(new Error('payload too large'), { status: 413 }));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      if (!raw) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch {
        reject(Object.assign(new Error('Invalid JSON'), { status: 400 }));
      }
    });
    req.on('error', reject);
  });
}

function send(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(body);
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url || '/', `http://${req.headers.host || '127.0.0.1'}`);
  if (req.method === 'GET' && (url.pathname === '/health' || url.pathname === '/')) {
    send(res, 200, { ok: true, service: 'web-scrape-mcp' });
    return;
  }
  if (req.method !== 'POST') {
    send(res, 405, { error: 'method not allowed' });
    return;
  }
  if (!authorize(req, url.pathname)) {
    send(res, 401, { error: 'unauthorized' });
    return;
  }
  try {
    const body = await readJson(req);
    if (url.pathname === '/mcp' || url.pathname === '/mcp/') {
      const out = await handleMcp(body, req);
      send(res, 200, out);
      return;
    }
    if (url.pathname === '/v1/scrape' || url.pathname === '/scrape') {
      const tool = body.tool === 'scrape_url' || body.maxPages === 1 ? 'scrape_url' : 'scrape_domain';
      const out = await handleTool(tool, body, ownerFromReq(req));
      send(res, 200, out);
      return;
    }
    send(res, 404, { error: 'not found' });
  } catch (e) {
    const status = Number(e?.status) || 500;
    const msg = String(e?.message || e).slice(0, 400);
    if (status >= 500) console.error('[web-scrape-mcp] error', msg);
    else console.warn('[web-scrape-mcp] reject', msg);
    send(res, status, { ok: false, error: msg });
  }
});

server.listen(PORT, '0.0.0.0', () => {
  console.info('[web-scrape-mcp] listening', { port: PORT, auth: TOOLS_API_KEY || INTERNAL_TOKEN ? 'required' : 'open-internal' });
});
