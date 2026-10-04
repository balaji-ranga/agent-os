/** Provision a disposable non-Balaji CEO and IBKR SME for VPS acceptance tests. */
import crypto from 'node:crypto';
import { initDb, getDb } from '../src/db/schema.js';
import { registerCeoUser } from '../src/services/users.js';
import { createFullAgent } from '../src/services/create-full-agent.js';
import { listHireableRoleTemplates } from '../src/services/hireable-role-templates.js';
import { seedIbkrTradingToolsIfMissing } from '../src/db/seed-ibkr-trading-tools.js';

initDb();
seedIbkrTradingToolsIfMissing();
const db = getDb();
const email = String(process.env.IBKR_SME_TEST_EMAIL || 'ibkr-sme-test@flolah.local').trim().toLowerCase();
let user = db.prepare('SELECT id, email, name FROM platform_users WHERE email = ? AND role = ?').get(email, 'ceo');
if (!user) {
  const password = String(process.env.IBKR_SME_TEST_PASSWORD || `${crypto.randomBytes(20).toString('base64url')}Aa9!`).slice(0, 96);
  await registerCeoUser({ email, password, name: 'IBKR SME Test User', country: 'SG', region: 'Singapore', industry: 'personal', accept_terms: true, require_terms_accept: false });
  user = db.prepare('SELECT id, email, name FROM platform_users WHERE email = ? AND role = ?').get(email, 'ceo');
}
if (!user || /^ceo-bal/i.test(user.id) || /balaji/i.test(user.email)) throw new Error('Refusing to use Balaji as the IBKR SME test owner');
let agent = db.prepare("SELECT * FROM agents WHERE owner_user_id = ? AND template_base_id = 'ibkr-portfolio-strategy-sme' LIMIT 1").get(user.id);
if (!agent) {
  const role = listHireableRoleTemplates().find((r) => r.id === 'ibkr-portfolio-strategy-sme');
  agent = await createFullAgent({ ownerUserId: user.id, name: role.name, role: role.role, department: role.department, template_base_id: role.template_base_id, parent_id: 'balserve' });
}
const grants = db.prepare('SELECT tool_name FROM agent_tool_grants WHERE agent_id = ? ORDER BY tool_name').all(agent.id).map((r) => r.tool_name);
const required = ['ibkr_quant_signal_infer', 'ibkr_strategy_bundle_draft', 'ibkr_strategy_bundle_validate', 'market_history', 'brave_web_search', 'web_scrape_url'];
const missing = required.filter((name) => !grants.includes(name));
if (missing.length) throw new Error(`IBKR SME grants missing: ${missing.join(', ')}`);
console.log(JSON.stringify({ ok: true, test_user: user, agent: { id: agent.id, name: agent.name, template_base_id: agent.template_base_id }, grants: required }, null, 2));
