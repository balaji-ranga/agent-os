/**
 * Smoke: MCP + External Agent auth templates render from prior-step context.
 * Run: node backend/scripts/test-workflow-auth-templates.js
 */
import { parseMcpAuthFromNodeConfig } from '../src/services/mcp-auth.js';
import { mergeExternalAgentAuthHeaders } from '../src/services/external-agents.js';
import { renderHttpHeadersJson } from '../src/services/http-headers.js';
import { renderWorkflowTemplates } from '../src/services/agent-workflow-io.js';

let passed = 0;
let failed = 0;

function assert(cond, msg) {
  if (cond) {
    passed += 1;
    console.log(`OK: ${msg}`);
  } else {
    failed += 1;
    console.error(`FAIL: ${msg}`);
  }
}

const context = {
  node_outputs: {
    'api-login': {
      body: { accessToken: 'tok_from_login', access_token: 'tok_oauth' },
      ok: true,
      status: 200,
    },
  },
  workflow_variables: { myToken: 'tok_var' },
  initial_input: 'hello',
};

const mcp = parseMcpAuthFromNodeConfig(
  {
    authBearer: '{{api-login.body.accessToken}}',
    httpHeadersJson: JSON.stringify({
      'X-Custom': '{{var.myToken}}',
      'X-Static': 'plain',
    }),
  },
  context
);

assert(mcp.headers.Authorization === 'Bearer tok_from_login', `MCP bearer template rendered (got ${mcp.headers.Authorization})`);
assert(mcp.headers['X-Custom'] === 'tok_var', `MCP header template rendered (got ${mcp.headers['X-Custom']})`);
assert(mcp.headers['X-Static'] === 'plain', 'MCP static header preserved');

const mcpLiteral = parseMcpAuthFromNodeConfig(
  { authBearer: 'literal-secret', httpHeadersJson: '{}' },
  context
);
assert(mcpLiteral.headers.Authorization === 'Bearer literal-secret', 'MCP static bearer preserved');

const row = { auth_header: 'registry-token', headers_json: JSON.stringify({ 'X-Reg': 'reg' }) };
const mergedRegistryOnly = mergeExternalAgentAuthHeaders(row, null);
assert(mergedRegistryOnly.Authorization === 'Bearer registry-token', 'A2A registry bearer');
assert(mergedRegistryOnly['X-Reg'] === 'reg', 'A2A registry header');

const dynHeaders = renderHttpHeadersJson({ 'X-Dyn': '{{api-login.body.accessToken}}' }, context);
const mergedOverride = mergeExternalAgentAuthHeaders(row, {
  authHeader: renderWorkflowTemplates('{{api-login.body.access_token}}', context),
  headers: dynHeaders,
});
assert(mergedOverride.Authorization === 'Bearer tok_oauth', `A2A node bearer overrides registry (got ${mergedOverride.Authorization})`);
assert(mergedOverride['X-Dyn'] === 'tok_from_login', `A2A dynamic header merged (got ${mergedOverride['X-Dyn']})`);
assert(mergedOverride['X-Reg'] === 'reg', 'A2A registry header kept when not overridden');

const { renderPayloadTemplates } = await import('../src/services/agent-workflow-io.js');
const toolPayload = renderPayloadTemplates(
  { indexSymbol: '{{var.index_symbol}}', force: false, nested: { cap: '{{var.daily_budget_usd}}' } },
  { workflow_variables: { index_symbol: 'QQQ', daily_budget_usd: 1000 } }
);
assert(toolPayload.indexSymbol === 'QQQ', `toolPayload indexSymbol interpolated (got ${toolPayload.indexSymbol})`);
assert(toolPayload.force === false, 'toolPayload boolean preserved');
assert(String(toolPayload.nested.cap) === '1000', `toolPayload nested var interpolated (got ${toolPayload.nested.cap})`);
assert(
  renderWorkflowTemplates('{{var.index_symbol}}', { workflow_variables: { index_symbol: 'QQQ' } }) === 'QQQ',
  'bare {{var}} string is not JSON-quoted'
);
assert(
  renderPayloadTemplates({ indexSymbol: '{{var.missing}}' }, { workflow_variables: {} }).indexSymbol === '',
  'missing var renders empty rather than leftover template'
);

console.log(`\n=== Done: ${passed} passed, ${failed} failed ===`);
process.exit(failed ? 1 : 0);
