/**
 * Meta Graph MCP (HTTP) - multi-tenant Bearer token auth.
 * Agent OS injects each CEO Facebook token from Connectors > MCPs OAuth.
 */
import http from 'http';

const PORT = Number(process.env.META_GRAPH_MCP_PORT || process.env.PORT || 8081);
const GRAPH = 'https://graph.facebook.com/v21.0';

function extractToken(req) {
  const auth = String(req.headers.authorization || '').trim();
  if (!auth) return '';
  if (/^bearer\s+/i.test(auth)) return auth.replace(/^bearer\s+/i, '').trim();
  return auth;
}
function jsonRpcOk(id, result) { return { jsonrpc: '2.0', id, result }; }
function jsonRpcErr(id, code, message) { return { jsonrpc: '2.0', id, error: { code, message } }; }
function toolResult(data) {
  return { content: [{ type: 'text', text: typeof data === 'string' ? data : JSON.stringify(data, null, 2) }], isError: false };
}
function toolError(msg) { return { content: [{ type: 'text', text: String(msg || 'error') }], isError: true }; }

async function graph(token, path, { method = 'GET', query = {}, body = null } = {}) {
  const u = new URL(path.startsWith('http') ? path : GRAPH + (path.startsWith('/') ? path : '/' + path));
  for (const [k, v] of Object.entries(query || {})) {
    if (v != null && String(v) !== '') u.searchParams.set(k, String(v));
  }
  if (!u.searchParams.has('access_token')) u.searchParams.set('access_token', token);
  const opts = { method, headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(60000) };
  if (body && method !== 'GET') {
    opts.headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(body);
  }
  const res = await fetch(u.toString(), opts);
  const text = await res.text();
  let data;
  try { data = JSON.parse(text); } catch { throw new Error('Graph non-JSON: ' + text.slice(0, 300)); }
  if (!res.ok || data.error) {
    const msg = data.error?.message || data.error || ('HTTP ' + res.status);
    throw new Error('Meta API Error [' + (data.error?.code || res.status) + ']: ' + msg);
  }
  return data;
}

const TOOLS = [
  { name: 'test_connection', description: 'Validate OAuth token (GET /me).', inputSchema: { type: 'object', properties: {} } },
  { name: 'get_my_pages', description: 'List managed Facebook Pages.', inputSchema: { type: 'object', properties: { limit: { type: 'number' } } } },
  { name: 'get_page', description: 'Get Facebook Page by id.', inputSchema: { type: 'object', properties: { page_id: { type: 'string' } }, required: ['page_id'] } },
  { name: 'create_page_post', description: 'Create a Page post.', inputSchema: { type: 'object', properties: { page_id: { type: 'string' }, message: { type: 'string' }, link: { type: 'string' }, page_access_token: { type: 'string' } }, required: ['page_id'] } },
  { name: 'get_page_posts', description: 'List Page posts.', inputSchema: { type: 'object', properties: { page_id: { type: 'string' }, limit: { type: 'number' } }, required: ['page_id'] } },
  { name: 'get_post', description: 'Get a post.', inputSchema: { type: 'object', properties: { post_id: { type: 'string' } }, required: ['post_id'] } },
  { name: 'delete_post', description: 'Delete a post.', inputSchema: { type: 'object', properties: { post_id: { type: 'string' }, page_access_token: { type: 'string' } }, required: ['post_id'] } },
  { name: 'get_post_comments', description: 'List comments on a post.', inputSchema: { type: 'object', properties: { post_id: { type: 'string' }, limit: { type: 'number' } }, required: ['post_id'] } },
  { name: 'reply_to_comment', description: 'Reply to a comment.', inputSchema: { type: 'object', properties: { comment_id: { type: 'string' }, message: { type: 'string' }, page_access_token: { type: 'string' } }, required: ['comment_id', 'message'] } },
  { name: 'delete_comment', description: 'Delete a comment.', inputSchema: { type: 'object', properties: { comment_id: { type: 'string' }, page_access_token: { type: 'string' } }, required: ['comment_id'] } },
  { name: 'upload_photo', description: 'Upload photo URL to a Page.', inputSchema: { type: 'object', properties: { page_id: { type: 'string' }, url: { type: 'string' }, caption: { type: 'string' }, published: { type: 'boolean' }, page_access_token: { type: 'string' } }, required: ['page_id', 'url'] } },
  { name: 'get_page_insights', description: 'Page insights.', inputSchema: { type: 'object', properties: { page_id: { type: 'string' }, metric: { type: 'string' }, period: { type: 'string' } }, required: ['page_id'] } },
  { name: 'get_post_insights', description: 'Post insights.', inputSchema: { type: 'object', properties: { post_id: { type: 'string' }, metric: { type: 'string' } }, required: ['post_id'] } },
  { name: 'get_instagram_account', description: 'IG business account for a Page.', inputSchema: { type: 'object', properties: { page_id: { type: 'string' } }, required: ['page_id'] } },
  { name: 'get_instagram_media', description: 'List Instagram media.', inputSchema: { type: 'object', properties: { ig_user_id: { type: 'string' }, limit: { type: 'number' } }, required: ['ig_user_id'] } },
  { name: 'create_instagram_post', description: 'Create IG image post.', inputSchema: { type: 'object', properties: { ig_user_id: { type: 'string' }, image_url: { type: 'string' }, caption: { type: 'string' } }, required: ['ig_user_id', 'image_url'] } },
  { name: 'get_instagram_comments', description: 'List IG media comments.', inputSchema: { type: 'object', properties: { media_id: { type: 'string' }, limit: { type: 'number' } }, required: ['media_id'] } },
  { name: 'reply_to_instagram_comment', description: 'Reply to IG comment.', inputSchema: { type: 'object', properties: { comment_id: { type: 'string' }, message: { type: 'string' } }, required: ['comment_id', 'message'] } },
  { name: 'get_instagram_insights', description: 'IG account insights.', inputSchema: { type: 'object', properties: { ig_user_id: { type: 'string' }, metric: { type: 'string' }, period: { type: 'string' } }, required: ['ig_user_id'] } },
];

function tok(a, fb) { return String(a?.page_access_token || fb || '').trim(); }

/** Prefer explicit page_access_token; else resolve from /me/accounts for page_id (required for Page posts). */
async function resolvePageToken(a, userToken) {
  const explicit = String(a?.page_access_token || '').trim();
  if (explicit) return explicit;
  const pageId = String(a?.page_id || '').trim();
  if (!pageId || !userToken) return String(userToken || '').trim();
  const pages = await graph(userToken, '/me/accounts', {
    query: { fields: 'id,access_token,tasks', limit: a?.limit || 50 },
  });
  const list = Array.isArray(pages?.data) ? pages.data : [];
  const match = list.find((p) => String(p?.id) === pageId);
  if (match?.access_token) return String(match.access_token);
  throw new Error(
    'No Page access token for page_id=' + pageId + '. Ensure the Facebook user is a Page admin and granted pages_manage_posts + pages_read_engagement, then reconnect OAuth if the Page was created after the last Connect.'
  );
}

async function callTool(name, a, token) {
  a = a || {};
  switch (name) {
    case 'test_connection': return toolResult(await graph(token, '/me', { query: { fields: 'id,name' } }));
    case 'get_my_pages': return toolResult(await graph(token, '/me/accounts', { query: { fields: 'id,name,access_token,category,tasks', limit: a.limit || 25 } }));
    case 'get_page': return toolResult(await graph(token, '/' + a.page_id, { query: { fields: 'id,name,about,fan_count,link,picture' } }));
    case 'create_page_post': {
      const t = await resolvePageToken(a, token);
      const body = {};
      if (a.message) body.message = a.message; if (a.link) body.link = a.link;
      return toolResult(await graph(t, '/' + a.page_id + '/feed', { method: 'POST', body }));
    }
    case 'get_page_posts': return toolResult(await graph(token, '/' + a.page_id + '/posts', { query: { fields: 'id,message,created_time,permalink_url', limit: a.limit || 10 } }));
    case 'get_post': return toolResult(await graph(token, '/' + a.post_id, { query: { fields: 'id,message,created_time,permalink_url,shares,likes.summary(true),comments.summary(true)' } }));
    case 'delete_post': return toolResult(await graph(tok(a, token), '/' + a.post_id, { method: 'DELETE' }));
    case 'get_post_comments': return toolResult(await graph(token, '/' + a.post_id + '/comments', { query: { fields: 'id,message,from,created_time', limit: a.limit || 25 } }));
    case 'reply_to_comment': return toolResult(await graph(tok(a, token), '/' + a.comment_id + '/comments', { method: 'POST', body: { message: a.message } }));
    case 'delete_comment': return toolResult(await graph(tok(a, token), '/' + a.comment_id, { method: 'DELETE' }));
    case 'upload_photo': {
      const t = await resolvePageToken(a, token);
      const body = { url: a.url, published: a.published !== false };
      if (a.caption) body.caption = a.caption;
      return toolResult(await graph(t, '/' + a.page_id + '/photos', { method: 'POST', body }));
    }
    case 'get_page_insights': return toolResult(await graph(token, '/' + a.page_id + '/insights', { query: { metric: a.metric || 'page_impressions,page_engaged_users,page_fans', period: a.period || 'day' } }));
    case 'get_post_insights': return toolResult(await graph(token, '/' + a.post_id + '/insights', { query: { metric: a.metric || 'post_impressions,post_engaged_users' } }));
    case 'get_instagram_account': return toolResult(await graph(token, '/' + a.page_id, { query: { fields: 'instagram_business_account{id,username,name,profile_picture_url,followers_count}' } }));
    case 'get_instagram_media': return toolResult(await graph(token, '/' + a.ig_user_id + '/media', { query: { fields: 'id,caption,media_type,media_url,permalink,timestamp', limit: a.limit || 10 } }));
    case 'create_instagram_post': {
      const container = await graph(token, '/' + a.ig_user_id + '/media', { method: 'POST', body: { image_url: a.image_url, caption: a.caption || '' } });
      const published = await graph(token, '/' + a.ig_user_id + '/media_publish', { method: 'POST', body: { creation_id: container.id } });
      return toolResult({ container, published });
    }
    case 'get_instagram_comments': return toolResult(await graph(token, '/' + a.media_id + '/comments', { query: { fields: 'id,text,username,timestamp', limit: a.limit || 25 } }));
    case 'reply_to_instagram_comment': return toolResult(await graph(token, '/' + a.comment_id + '/replies', { method: 'POST', body: { message: a.message } }));
    case 'get_instagram_insights': return toolResult(await graph(token, '/' + a.ig_user_id + '/insights', { query: { metric: a.metric || 'impressions,reach,profile_views', period: a.period || 'day' } }));
    default: return toolError('Unknown tool: ' + name);
  }
}

async function handleMcp(body, req) {
  const { id, method, params } = body || {};
  if (method === 'initialize') {
    return jsonRpcOk(id, {
      protocolVersion: '2024-11-05', capabilities: { tools: {} },
      serverInfo: { name: 'meta-graph-mcp', version: '1.0.0' },
      instructions: 'Meta Graph MCP. Pass Facebook long-lived user token as Authorization Bearer. Connect via Agent OS Connectors MCPs OAuth first.',
    });
  }
  if (method === 'notifications/initialized' || method === 'notifications/cancelled') return jsonRpcOk(id ?? null, {});
  if (method === 'tools/list') return jsonRpcOk(id, { tools: TOOLS });
  if (method === 'prompts/list') return jsonRpcOk(id, { prompts: [] });
  if (method === 'resources/list') return jsonRpcOk(id, { resources: [] });
  if (method === 'ping') return jsonRpcOk(id, {});
  if (method === 'tools/call') {
    const token = extractToken(req);
    if (!token) return jsonRpcErr(id, -32001, 'Facebook access token required (Authorization Bearer). Connect OAuth on Connectors MCPs.');
    try { return jsonRpcOk(id, await callTool(params?.name, params?.arguments || {}, token)); }
    catch (err) { return jsonRpcOk(id, toolError(err.message || String(err))); }
  }
  return jsonRpcErr(id, -32601, 'Method not found: ' + method);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      if (!raw) return resolve({});
      try { resolve(JSON.parse(raw)); } catch (e) { reject(e); }
    });
    req.on('error', reject);
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url || '/', 'http://' + (req.headers.host || 'localhost'));
  if (req.method === 'GET' && (url.pathname === '/health' || url.pathname === '/')) {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, tools: TOOLS.map((t) => t.name) }));
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
  console.log('[meta-graph-mcp] listening on 0.0.0.0:' + PORT + ' (Bearer per request)');
});
