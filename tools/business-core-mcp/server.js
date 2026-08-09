/**
 * Flolah Business Core MCP v2 - real Twenty CRM + ERPNext tools for agents/workflows.
 * Proxies owner-scoped content-tool endpoints (not dummy stubs).
 * Auth: Authorization Bearer session|TOOLS_API_KEY + X-Ceo-User-Id.
 */
import http from 'http';

const PORT = Number(process.env.BUSINESS_CORE_MCP_PORT || process.env.PORT || 8082);
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
  crm_status: '/api/tools/crm-status',
  crm_list_people: '/api/tools/crm-list-people',
  crm_create_person: '/api/tools/crm-create-person',
  crm_list_companies: '/api/tools/crm-list-companies',
  crm_create_company: '/api/tools/crm-create-company',
  crm_list_opportunities: '/api/tools/crm-list-opportunities',
  crm_list_deals: '/api/tools/crm-list-deals',
  crm_create_opportunity: '/api/tools/crm-create-opportunity',
  crm_create_deal: '/api/tools/crm-create-deal',
  crm_update_opportunity: '/api/tools/crm-update-opportunity',
  crm_list_leads: '/api/tools/crm-list-leads',
  crm_create_lead: '/api/tools/crm-create-lead',
  crm_list_notes: '/api/tools/crm-list-notes',
  crm_list_tasks: '/api/tools/crm-list-tasks',
  crm_sync_org: '/api/tools/crm-sync-org',
  erp_status: '/api/tools/erp-status',
  erp_list_customers: '/api/tools/erp-list-customers',
  erp_create_customer: '/api/tools/erp-create-customer',
  erp_list_leads: '/api/tools/erp-list-leads',
  erp_create_lead: '/api/tools/erp-create-lead',
  erp_list_contacts: '/api/tools/erp-list-contacts',
  erp_create_contact: '/api/tools/erp-create-contact',
  erp_list_opportunities: '/api/tools/erp-list-opportunities',
  erp_create_opportunity: '/api/tools/erp-create-opportunity',
  erp_list_items: '/api/tools/erp-list-items',
  erp_create_item: '/api/tools/erp-create-item',
  erp_list_quotations: '/api/tools/erp-list-quotations',
  erp_create_quotation: '/api/tools/erp-create-quotation',
  erp_list_sales_orders: '/api/tools/erp-list-sales-orders',
  erp_create_sales_order: '/api/tools/erp-create-sales-order',
  erp_list_delivery_notes: '/api/tools/erp-list-delivery-notes',
  erp_create_delivery_note: '/api/tools/erp-create-delivery-note',
  erp_list_sales_invoices: '/api/tools/erp-list-sales-invoices',
  erp_create_sales_invoice: '/api/tools/erp-create-sales-invoice',
  erp_list_purchase_orders: '/api/tools/erp-list-purchase-orders',
  erp_create_purchase_order: '/api/tools/erp-create-purchase-order',
  erp_list_purchase_invoices: '/api/tools/erp-list-purchase-invoices',
  erp_create_purchase_invoice: '/api/tools/erp-create-purchase-invoice',
  erp_list_payment_entries: '/api/tools/erp-list-payment-entries',
  erp_create_payment_entry: '/api/tools/erp-create-payment-entry',
  erp_list_journal_entries: '/api/tools/erp-list-journal-entries',
  erp_create_journal_entry: '/api/tools/erp-create-journal-entry',
  erp_list_material_requests: '/api/tools/erp-list-material-requests',
  erp_create_material_request: '/api/tools/erp-create-material-request',
  erp_list_projects: '/api/tools/erp-list-projects',
  erp_create_project: '/api/tools/erp-create-project',
  erp_list_tasks: '/api/tools/erp-list-tasks',
  erp_create_task: '/api/tools/erp-create-task',
  erp_list_gl_entries: '/api/tools/erp-list-gl-entries',
  erp_profit_and_loss: '/api/tools/erp-profit-and-loss',
  erp_list_resource: '/api/tools/erp-list-resource',
  erp_get_resource: '/api/tools/erp-get-resource',
  erp_create_resource: '/api/tools/erp-create-resource',
  erp_update_resource: '/api/tools/erp-update-resource',
  erp_submit_doc: '/api/tools/erp-submit-doc',
  erp_cancel_doc: '/api/tools/erp-cancel-doc',
  erp_sync_org: '/api/tools/erp-sync-org',
};

const TOOLS = Object.keys(TOOL_ENDPOINT).map((name) => ({
  name,
  description:
    (name.startsWith('crm_') ? 'Twenty CRM real REST tool: ' : 'ERPNext Frappe REST tool: ') + name,
  inputSchema: {
    type: 'object',
    properties: { owner_user_id: { type: 'string', description: 'CEO owner id (or X-Ceo-User-Id header)' } },
    additionalProperties: true,
  },
}));

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
  const body = { ...args, owner_user_id: owner };
  delete body.ownerUserId;
  const res = await fetch(BACKEND + path, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(90000),
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
      serverInfo: { name: 'flolah-business-core-mcp', version: '2.0.0' },
      instructions:
        'Real Twenty CRM and ERPNext tools. Pass X-Ceo-User-Id. Twenty leads = early-stage opportunities.',
    });
  }
  if (method === 'notifications/initialized' || method === 'notifications/cancelled') return jsonRpcOk(id ?? null, {});
  if (method === 'tools/list') return jsonRpcOk(id, { tools: TOOLS });
  if (method === 'prompts/list') return jsonRpcOk(id, { prompts: [] });
  if (method === 'resources/list') return jsonRpcOk(id, { resources: [] });
  if (method === 'ping') return jsonRpcOk(id, {});
  if (method === 'tools/call') {
    try {
      const result = await callBackend(params?.name, params?.arguments || {}, req);
      return jsonRpcOk(id, {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
        structuredContent: result,
      });
    } catch (e) {
      return jsonRpcErr(id, -32000, e.message || String(e));
    }
  }
  return jsonRpcErr(id, -32601, 'Method not found: ' + method);
}

const server = http.createServer(async (req, res) => {
  try {
    if (req.method === 'GET' && (req.url === '/health' || req.url === '/')) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, service: 'flolah-business-core-mcp', version: '2.0.0', backend: BACKEND, tools: TOOLS.map((t) => t.name) }));
      return;
    }
    if (req.method === 'POST' && (req.url === '/mcp' || req.url?.startsWith('/mcp?'))) {
      const chunks = [];
      for await (const c of req) chunks.push(c);
      const raw = Buffer.concat(chunks).toString('utf8');
      let body = {};
      try {
        body = raw ? JSON.parse(raw) : {};
      } catch {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(jsonRpcErr(null, -32700, 'Parse error')));
        return;
      }
      const out = await handleMcp(body, req);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(out));
      return;
    }
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'not found' }));
  } catch (e) {
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: e.message || String(e) }));
  }
});

server.listen(PORT, '0.0.0.0', () => {
  console.info('[business-core-mcp] v2 listening :' + PORT + ' tools=' + TOOLS.length + ' backend=' + BACKEND);
});
