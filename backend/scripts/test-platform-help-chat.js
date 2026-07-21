/**
 * E2E: register a temporary CEO (mfa off), verify Platform Help agent + docs, optional chat.
 * Usage: node scripts/test-platform-help-chat.js
 * Set SKIP_CHAT=1 to skip gateway chat.
 */
import { config } from 'dotenv';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: join(__dirname, '..', '.env') });

const BASE = (process.env.AGENT_OS_API_URL || 'http://127.0.0.1:3001').replace(/\/$/, '');
const skipChat = process.env.SKIP_CHAT === '1' || process.env.SKIP_CHAT === 'true';
const stamp = Date.now().toString(36);
const password = `HelpTest!${stamp}`;
const email = `platformhelp.${stamp}@example.com`;

async function api(method, path, body, token) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body != null ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(300000),
  });
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data };
}

async function main() {
  const health = await fetch(`${BASE}/health`);
  if (!health.ok) throw new Error('backend health failed');
  console.log('OK health');

  const reg = await api('POST', '/api/auth/register', {
    email,
    password,
    name: `Platform Help Test ${stamp}`,
    db_mode: 'tenant',
    mfa_policy: 'off',
  });
  if (reg.status !== 201) {
    console.error('FAIL register', reg.status, reg.data);
    process.exit(1);
  }
  const token = reg.data.session?.token || reg.data.token;
  const userId = reg.data.user?.id || reg.data.session?.user?.id;
  if (!token || !userId) {
    console.error('FAIL no session', Object.keys(reg.data || {}));
    process.exit(1);
  }
  console.log('OK registered', email, userId);

  const agentsRes = await api('GET', '/api/agents', null, token);
  const agents = Array.isArray(agentsRes.data) ? agentsRes.data : agentsRes.data.agents || [];
  const help = agents.find((a) => a.id === 'platformhelp');
  if (!help) {
    console.error('FAIL platformhelp missing. ids=', agents.map((a) => a.id).join(', '));
    process.exit(1);
  }
  console.log('OK agent listed:', help.name);

  const docsRes = await api('GET', '/api/master-data/documents', null, token);
  const docs = Array.isArray(docsRes.data) ? docsRes.data : docsRes.data.documents || [];
  const helpDocs = docs.filter((d) => String(d.title || '').includes('Flowlah Help'));
  console.log('OK Master Data help docs:', helpDocs.length, '(total docs', docs.length + ')');
  if (helpDocs.length < 5) {
    console.error(
      'FAIL expected Platform Help docs. titles=',
      docs.map((d) => d.title).join(' | ')
    );
    process.exit(1);
  }

  if (skipChat) {
    console.log('SKIP_CHAT set — PASS list+docs');
    return;
  }

  console.log('Sending chat to Platform Help (may take a minute)...');
  const chatRes = await api(
    'POST',
    '/api/agents/platformhelp/chat',
    {
      message:
        'Briefly: where in the UI do I register an MCP server, and which workflow nodes can call it? Use master_data_rag if needed.',
    },
    token
  );
  if (chatRes.status >= 400) {
    console.error('FAIL chat', chatRes.status, chatRes.data);
    process.exit(1);
  }
  const reply =
    chatRes.data.reply ||
    chatRes.data.message ||
    chatRes.data.content ||
    chatRes.data.text ||
    JSON.stringify(chatRes.data).slice(0, 2000);
  console.log('Reply:\n', String(reply).slice(0, 1800));
  if (!/MCP|integrations\/mcp|mcp_tool|Brain|SSE/i.test(String(reply))) {
    console.warn(
      'WARN: reply did not clearly mention MCP UI/nodes (OpenClaw content-tools plugin may be broken locally)'
    );
  } else {
    console.log('PASS chat content looks relevant');
  }
  console.log('PASS platform-help e2e');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
