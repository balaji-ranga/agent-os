import { Router } from 'express';
import { attachAuthUser, requireAuth, requireTenantFullAccess } from '../middleware/auth.js';
import { isCeoDelegate } from '../services/org-permissions.js';
import { assertUserAgentAccess, resolveChatOwnerUserId } from '../services/agent-chat-scope.js';
import { resolveChannelActor } from '../services/channel-user-identity.js';
import { parseTenantOpenClawAgentId, resolveAgentFromOpenClawCallerId } from '../services/openclaw-tenant.js';
import { verifyToolBrokerSecret } from '../services/tool-scoped-token.js';
import { getDb } from '../db/schema.js';
import { commandSkillCatalog, commandToolCatalog, runAgentCommand } from '../services/agent-command-runtime.js';
const router = Router();
const deny = (message, status = 403) => { throw Object.assign(new Error(message), { status }); };
// Private gateway command handler: the model never supplies sender metadata.
router.post('/channel', async (req, res) => {
  try {
    const ip = String(req.socket?.remoteAddress || '').replace(/^::ffff:/, '');
    if (req.headers.forwarded || req.headers['x-forwarded-for'] || !(ip === '127.0.0.1' || ip === '::1' || ip.startsWith('10.') || ip.startsWith('192.168.') || /^172\.(1[6-9]|2\d|3[01])\./.test(ip))) return res.status(404).json({ error: 'Not found' });
    if (!verifyToolBrokerSecret(req.headers['x-agent-os-tool-broker'])) deny('Command broker authentication failed', 401);
    const body = req.body || {}, caller = String(body.agent_id || '');
    const tenant = parseTenantOpenClawAgentId(caller), agent = resolveAgentFromOpenClawCallerId(caller);
    if (body.channel !== 'whatsapp' || !tenant || !agent || body.account_id !== caller) deny('Verified tenant WhatsApp binding required');
    if (!String(body.session_key || '').startsWith(`agent:${caller}:`) && !String(body.session_key || '').startsWith(`agent::${caller}:`)) deny('Command session does not match bound agent');
    const channel = getDb().prepare("SELECT status FROM ceo_agent_channels WHERE owner_user_id=? AND agent_id=? AND channel='whatsapp'").get(tenant.ceoUserId, agent.id);
    if (channel?.status !== 'enabled') deny('WhatsApp channel is not enabled');
    // Reject group invocations: never post owner-private results to group members.
    if (body.is_group || /@g\.us|\bgroup[:/]/i.test(`${body.from || ''} ${body.session_key || ''}`)) deny('Use a private WhatsApp conversation for platform commands');
    const actor = resolveChannelActor({ ownerUserId: tenant.ceoUserId, senderId: body.sender_id, channel: 'whatsapp' });
    if (!isCeoDelegate(actor)) deny('CEO or CEO Delegate access required for platform commands');
    assertUserAgentAccess(actor, agent.id);
    const out = await runAgentCommand({ text: body.command, ownerUserId: tenant.ceoUserId, actor, agentId: agent.id, idempotencyKey: body.idempotency_key });
    res.json(out);
  } catch (e) { res.status(e.status || 500).json({ error: e.message }); }
});
router.use(attachAuthUser, requireAuth, requireTenantFullAccess);
router.get('/:agentId', (req, res) => {
  try {
    const owner = resolveChatOwnerUserId(req); assertUserAgentAccess(req.authUser, req.params.agentId);
    res.json({ tools: commandToolCatalog(owner, req.params.agentId), skills: commandSkillCatalog(owner, req.params.agentId) });
  } catch (e) { res.status(e.status || 500).json({ error: e.message }); }
});
router.post('/:agentId', async (req, res) => {
  try {
    const owner = resolveChatOwnerUserId(req); assertUserAgentAccess(req.authUser, req.params.agentId);
    res.json(await runAgentCommand({ text: req.body?.command, ownerUserId: owner, actor: { ...req.authUser, channel: 'web' }, agentId: req.params.agentId, idempotencyKey: req.body?.idempotency_key }));
  } catch (e) { res.status(e.status || 500).json({ error: e.message }); }
});
export default router;
