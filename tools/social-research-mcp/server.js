/**
 * Social Research MCP — proxies owner-scoped content tools (adapter layer).
 * Auth: Authorization Bearer TOOLS_API_KEY or session + X-Ceo-User-Id.
 */
import http from 'http';

const PORT = Number(process.env.SOCIAL_RESEARCH_MCP_PORT || process.env.PORT || 8084);
const BACKEND = String(process.env.AGENT_OS_TOOLS_URL || process.env.AGENT_OS_INTERNAL_API_URL || 'http://backend:3001')
  .trim()
  .replace(/\/+$/, '');
const TOOLS_API_KEY = String(process.env.TOOLS_API_KEY || '').trim();

function jsonRpcOk(id, result) {
  return { jsonrpc: '2.0', id, result };
}
function jsonRpcErr(id, code, message) {
  return { jsonrpc: '2.0', id, error: { code, message } };
}

const TOOL_ENDPOINT = {
  social_research_search: '/api/tools/social-research-search',
  social_research_instagram: '/api/tools/social-research-instagram',
  social_research_x: '/api/tools/social-research-x',
  social_research_facebook: '/api/tools/social-research-facebook',
  social_research_profile: '/api/tools/social-research-profile',
  google_places_geocode: '/api/tools/google-places-geocode',
  google_places_nearby: '/api/tools/google-places-nearby',
  business_discover: '/api/tools/business-discover',
};

const TOOLS = [
  {
    name: 'social_research_search',
    description: 'Public indexed web search for LinkedIn, X, Facebook, Instagram (not a crawler).',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string' },
        site: { type: 'string' },
        count: { type: 'number' },
        days: { type: 'number' },
      },
      required: ['query'],
    },
  },
  {
    name: 'social_research_instagram',
    description:
      'Instagram research. Instaloader (optional INSTAGRAM_SESSIONID); else hydrates post images from /p/{shortcode}/. Use posts[] not indexed_results.',
    inputSchema: {
      type: 'object',
      properties: {
        handle: { type: 'string' },
        brand: { type: 'string' },
        days: { type: 'number' },
      },
    },
  },
  {
    name: 'social_research_x',
    description:
      'X/Twitter research. Official API when configured; else hydrates tweet text+media from status URLs. Use posts[] not indexed_results.',
    inputSchema: {
      type: 'object',
      properties: {
        handle: { type: 'string' },
        brand: { type: 'string' },
        days: { type: 'number' },
      },
    },
  },
  {
    name: 'social_research_facebook',
    description: 'Facebook research via Meta Graph OAuth when connected (owned Pages only); else indexed search (not a post feed).',
    inputSchema: {
      type: 'object',
      properties: { brand: { type: 'string' }, days: { type: 'number' } },
    },
  },
  {
    name: 'social_research_profile',
    description: 'Analyse a brand across Instagram, X, LinkedIn, Facebook.',
    inputSchema: {
      type: 'object',
      properties: {
        brand: { type: 'string' },
        handle: { type: 'string' },
        platforms: { type: 'array', items: { type: 'string' } },
        days: { type: 'number' },
      },
      required: ['brand'],
    },
  },
  {
    name: 'google_places_geocode',
    description: 'Geocode a locality with Google Places API (New).',
    inputSchema: {
      type: 'object',
      properties: { locality: { type: 'string' } },
      required: ['locality'],
    },
  },
  {
    name: 'google_places_nearby',
    description: 'Nearby Search (New) by locality or lat/lng, type, radius, min rating.',
    inputSchema: {
      type: 'object',
      properties: {
        locality: { type: 'string' },
        lat: { type: 'number' },
        lng: { type: 'number' },
        radius_meters: { type: 'number' },
        business_type: { type: 'string' },
        min_rating: { type: 'number' },
        max_results: { type: 'number' },
        rank_preference: { type: 'string' },
      },
    },
  },
  {
    name: 'business_discover',
    description:
      'Find businesses, enrich social presence, skip Knowledge duplicates, Kanban handoff to CRM or CEO.',
    inputSchema: {
      type: 'object',
      properties: {
        locality: { type: 'string' },
        business_type: { type: 'string' },
        query: { type: 'string' },
        radius_km: { type: 'number' },
        min_rating: { type: 'number' },
        max_results: { type: 'number' },
      },
      required: ['locality'],
    },
  },
];

function extractAuth(req) {
  const auth = String(req.headers.authorization || '').trim();
  const bearer = auth.replace(/^bearer\s+/i, '').trim();
  const owner = String(req.headers['x-ceo-user-id'] || req.headers['x-agent-os-user-id'] || '').trim();
  const sessionToken = bearer && bearer !== TOOLS_API_KEY ? bearer : '';
  return { bearer, owner, sessionToken };
}

async function callBackend(toolName, args, req) {
  const path = TOOL_ENDPOINT[toolName];
  if (!path) throw new Error('Unknown tool ' + toolName);
  const { bearer, owner: headerOwner, sessionToken } = extractAuth(req);
  const ownerFromArg = String(args?.owner_user_id || args?.ownerUserId || args?.ceo_user_id || '').trim();
  const owner = headerOwner || ownerFromArg;
  if (!owner) throw new Error('owner_user_id required (X-Ceo-User-Id header or arg)');
  const headers = {
    Accept: 'application/json',
    'Content-Type': 'application/json',
    'x-ceo-user-id': owner,
    'x-agent-os-user-id': owner,
  };
  if (sessionToken) headers.Authorization = 'Bearer ' + sessionToken;
  else if (TOOLS_API_KEY) headers.Authorization = 'Bearer ' + TOOLS_API_KEY;
  else if (bearer) headers.Authorization = 'Bearer ' + bearer;
  else throw new Error('TOOLS_API_KEY not configured and no client bearer');
  const body = { ...args };
  delete body.owner_user_id;
  delete body.ownerUserId;
  delete body.ceo_user_id;
  const res = await fetch(BACKEND + path, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(120000),
  });
  const text = await res.text();
  let data;
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { raw: text };
  }
  if (!res.ok) throw new Error(data.error || data.message || 'HTTP ' + res.status + ': ' + text.slice(0, 300));
  return data;
}

async function handleMcp(body, req) {
  const { id, method, params } = body || {};
  if (method === 'initialize') {
    return jsonRpcOk(id, {
      protocolVersion: '2024-11-05',
      capabilities: { tools: {} },
      serverInfo: { name: 'flolah-social-research-mcp', version: '1.0.0' },
      instructions:
        'Social Research adapters (Instaloader, X hydrate, Meta Graph, Google Places). Pass X-Ceo-User-Id. Use posts[] for actual posts; indexed_results are search hits only.',
    });
  }
  if (method === 'notifications/initialized') return jsonRpcOk(id, {});
  if (method === 'tools/list') return jsonRpcOk(id, { tools: TOOLS });
  if (method === 'tools/call') {
    const name = String(params?.name || '').trim();
    const args = params?.arguments && typeof params.arguments === 'object' ? params.arguments : {};
    try {
      const data = await callBackend(name, args, req);
      return jsonRpcOk(id, {
        content: [{ type: 'text', text: JSON.stringify(data, null, 2) }],
        isError: false,
      });
    } catch (e) {
      return jsonRpcOk(id, {
        content: [{ type: 'text', text: String(e.message || e) }],
        isError: true,
      });
    }
  }
  if (method === 'ping') return jsonRpcOk(id, {});
  return jsonRpcErr(id, -32601, 'Method not found: ' + method);
}

const server = http.createServer(async (req, res) => {
  const url = String(req.url || '');
  if (req.method === 'GET' && (url === '/health' || url.startsWith('/health?'))) {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, service: 'social-research-mcp' }));
    return;
  }
  if (req.method !== 'POST' || !(url === '/mcp' || url.startsWith('/mcp?'))) {
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'not found' }));
    return;
  }
  const chunks = [];
  for await (const c of req) chunks.push(c);
  let body;
  try {
    body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
  } catch {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(jsonRpcErr(null, -32700, 'Parse error')));
    return;
  }
  try {
    const out = await handleMcp(body, req);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(out));
  } catch (e) {
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(jsonRpcErr(body?.id ?? null, -32603, String(e.message || e))));
  }
});

server.listen(PORT, '0.0.0.0', () => {
  console.info('[social-research-mcp] listening port=%s backend=%s', PORT, BACKEND);
});
