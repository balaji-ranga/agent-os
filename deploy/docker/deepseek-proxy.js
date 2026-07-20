/**
 * Internal OpenAI-compatible proxy → DeepSeek API (api.deepseek.com).
 * Injects DEEPSEEK_API_KEY so Brain nodes / platform LLM can call DeepSeek without per-node keys.
 */
import http from 'http';
import https from 'https';

const PORT = Number(process.env.DEEPSEEK_PROXY_PORT || 8080);
const UPSTREAM = String(process.env.DEEPSEEK_UPSTREAM_URL || 'https://api.deepseek.com/v1').replace(/\/$/, '');
const API_KEY = String(process.env.DEEPSEEK_API_KEY || '').trim();

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function proxyRequest(req, res, targetUrl, body) {
  const url = new URL(targetUrl);
  const lib = url.protocol === 'https:' ? https : http;
  const headers = { ...req.headers, host: url.host, authorization: `Bearer ${API_KEY}` };
  delete headers['content-length'];
  if (body?.length) headers['content-length'] = String(body.length);

  const upstream = lib.request(
    {
      hostname: url.hostname,
      port: url.port || (url.protocol === 'https:' ? 443 : 80),
      path: `${url.pathname}${url.search}`,
      method: req.method,
      headers,
    },
    (upRes) => {
      res.writeHead(upRes.statusCode || 502, upRes.headers);
      upRes.pipe(res);
    }
  );
  upstream.on('error', (err) => {
    if (!res.headersSent) {
      res.writeHead(502, { 'Content-Type': 'application/json' });
    }
    res.end(JSON.stringify({ error: err.message || 'upstream error' }));
  });
  if (body?.length) upstream.write(body);
  upstream.end();
}

const server = http.createServer(async (req, res) => {
  try {
    const path = req.url || '/';
    if (path === '/health' || path === '/health/') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          ok: true,
          service: 'deepseek-proxy',
          upstream: UPSTREAM,
          key_configured: !!API_KEY,
          ready: !!API_KEY,
        })
      );
      return;
    }

    if (!API_KEY) {
      res.writeHead(503, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'DEEPSEEK_API_KEY not configured on deepseek proxy' }));
      return;
    }

    const body = ['GET', 'HEAD'].includes(req.method || '') ? null : await readBody(req);
    const suffix = path.startsWith('/') ? path : `/${path}`;
    const target = suffix.startsWith('/v1') ? `${UPSTREAM}${suffix}` : `${UPSTREAM}${suffix}`;
    proxyRequest(req, res, target, body);
  } catch (err) {
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: err.message || 'proxy error' }));
  }
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`deepseek-proxy listening on :${PORT} → ${UPSTREAM} (key=${API_KEY ? 'set' : 'missing'})`);
});
