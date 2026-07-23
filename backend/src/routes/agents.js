import { Router } from 'express';
import { join } from 'path';
import { existsSync, rmSync, writeFileSync, readFileSync } from 'fs';
import { getDb } from '../db/schema.js';
import { requireAuth, requireCeoOrAdmin, resolveAuthenticatedCeoUserId, resolveCeoDataUserIdFromRequest } from '../middleware/auth.js';
import { allowInternalOrAuth } from '../middleware/internal-auth.js';
import { listAgentsForUser } from '../services/users.js';
import {
  assertUserAgentAccess,
  chatOwnerIdsForRead,
  clearOpenClawSessionForUser,
  extractOwnerUserIdFromText,
  resolveChatOwnerUserId,
  userCanAccessAgent,
} from '../services/agent-chat-scope.js';
import { registerOpenClawSessionOwner, registerActiveDashboardChat, clearActiveDashboardChat } from '../services/tool-owner-scope.js';
import * as openclaw from '../gateway/openclaw.js';
import { tryTriggerWorkflowFromChat } from '../services/agent-workflow-runner.js';
import * as workspace from '../workspace/adapter.js';
import { normalizeReplyContent } from '../services/delegation-queue.js';
import { createFullAgent } from '../services/create-full-agent.js';
import { ensureManagedBrowserReady } from '../services/job-browser-auth.js';
import * as agentTools from '../services/openclaw-agent-tools.js';
import { ensureTenantOpenClawAgent } from '../services/openclaw-tenant.js';
import { tryHandleCooReachMeRequest } from '../services/reach-me-delegation.js';
import { tryHandleCooSpecialtyDelegation } from '../services/coo-specialty-delegation.js';
import { tryHandleCooOrgAgentsList } from '../services/coo-org-agents-list.js';
import {
  tryBuildSpecialtyReferral,
  buildActiveChatNotifyHint,
} from '../services/specialty-referral.js';
import { attachToolCallsToChatTurns, listToolCallsSince } from '../services/chat-tool-calls.js';
import {
  startNewChatSession,
  autoSplitFatChatSession,
  shouldAutoSplitFatContext,
  getChatThreadId,
  detectTopicShiftHeuristic,
} from '../services/chat-session-policy.js';
import { resolveLlmConfigForUser } from '../services/user-llm-settings.js';

const router = Router();

/** Strip local-model echo of CEO-scoping instructions accidentally pasted into the reply. */
function stripEchoedCeoScope(text) {
  let s = String(text || '');
  s = s.replace(
    /^You are assisting CEO user id[\s\S]*?never workflows belonging to other users\.\s*/i,
    ''
  );
  s = s.replace(/^\[ceo_user_id:[^\]]*\]\s*/i, '');
  s = s.replace(/^\[owner_user_id:[^\]]*\]\s*/i, '');
  s = s.replace(/^Important:\s*You are assisting CEO[\s\S]*?\n+/i, '');
  return s.trim();
}
const homedir = process.env.USERPROFILE || process.env.HOME || '';
const OPENCLAW_DIR = join(homedir, '.openclaw');
const OPENCLAW_CONFIG_PATH = process.env.OPENCLAW_CONFIG_PATH || join(OPENCLAW_DIR, 'openclaw.json');

/** Remove agent from openclaw.json (agents.list, tools.agentToAgent.allow) and delete its workspace + agent dirs. */
function removeAgentFromOpenClaw(id) {
  if (existsSync(OPENCLAW_CONFIG_PATH)) {
    try {
      let config = JSON.parse(readFileSync(OPENCLAW_CONFIG_PATH, 'utf8'));
      if (Array.isArray(config?.agents?.list)) {
        config.agents.list = config.agents.list.filter((a) => (a.id || '').toLowerCase() !== id.toLowerCase());
      }
      if (Array.isArray(config?.tools?.agentToAgent?.allow)) {
        config.tools.agentToAgent.allow = config.tools.agentToAgent.allow.filter((a) => String(a).toLowerCase() !== id.toLowerCase());
      }
      writeFileSync(OPENCLAW_CONFIG_PATH, JSON.stringify(config, null, 2), 'utf8');
    } catch (e) {
      console.warn('removeAgentFromOpenClaw: could not update openclaw.json', e?.message);
    }
  }
  const workspacePath = join(OPENCLAW_DIR, `workspace-${id}`);
  const agentsSubDir = join(OPENCLAW_DIR, 'agents', id);
  for (const dir of [workspacePath, agentsSubDir]) {
    if (existsSync(dir)) {
      try {
        rmSync(dir, { recursive: true });
      } catch (e) {
        console.warn('removeAgentFromOpenClaw: could not remove dir', dir, e?.message);
      }
    }
  }
}

function db() {
  return getDb();
}

/** Prefer per-CEO tenant workspace (where Resync writes ORG.md / AGENTS.md). */
function getAgentWorkspaceRoot(agent, req = null) {
  let ceoUserId = '';
  if (req?.authUser) {
    if (req.authUser.role === 'ceo' || req.authUser.impersonation) {
      ceoUserId = String(req.authUser.id || '').trim();
    } else if (req.authUser.role === 'admin') {
      ceoUserId = String(
        req.query?.owner_user_id || req.query?.ownerUserId || req.body?.owner_user_id || req.body?.ownerUserId || ''
      ).trim();
    }
  }
  return workspace.resolveAgentWorkspaceRoot(agent, { healDb: false, ceoUserId: ceoUserId || undefined });
}

router.get('/', requireAuth, (req, res) => {
  try {
    if (req.authUser.role === 'admin' && !req.authUser.impersonation) {
      return res.json([]);
    }
    return res.json(listAgentsForUser(req.authUser.id));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

/**
 * POST /org/sync — rebuild ORG.md (all agent workspaces) + COO AGENTS.md (session keys) from DB.
 * CEO: own org. Admin: pass owner_user_id.
 */
router.post('/org/sync', requireAuth, requireCeoOrAdmin, async (req, res) => {
  try {
    let ownerUserId = null;
    if (req.authUser.role === 'ceo' || req.authUser.impersonation) {
      ownerUserId = String(req.authUser.id).trim();
    } else if (req.authUser.role === 'admin') {
      ownerUserId = String(req.body?.owner_user_id || req.body?.ownerUserId || '').trim();
      if (!ownerUserId) {
        return res.status(400).json({ error: 'owner_user_id required when admin syncs org docs' });
      }
    }
    if (!ownerUserId) return res.status(403).json({ error: 'Could not resolve CEO for org sync' });

    const { syncOrgContextForCeo, buildOrgContextForCeo } = await import('../services/org-context.js');
    const { ensureAllTenantOpenClawAgentsForCeo } = await import('../services/openclaw-tenant.js');
    const { syncAllowlistsFile } = await import('../services/openclaw-agent-tools.js');

    const tenantEnsured = ensureAllTenantOpenClawAgentsForCeo(ownerUserId);
    const workspacesSynced = await syncOrgContextForCeo(ownerUserId);
    syncAllowlistsFile();

    const ctx = buildOrgContextForCeo(ownerUserId);
    res.json({
      ok: true,
      owner_user_id: ownerUserId,
      workspaces_synced: workspacesSynced,
      tenant_agents_ensured: tenantEnsured,
      agent_count: ctx.agents.length,
      delegatee_count: ctx.delegatees.length,
      message: `Refreshed ORG.md in ${workspacesSynced} workspace(s) and COO AGENTS.md (tenant session keys).`,
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.get('/:id', requireAuth, (req, res) => {
  try {
    assertUserAgentAccess(req.authUser, req.params.id);
    const row = db().prepare('SELECT * FROM agents WHERE id = ?').get(req.params.id);
    if (!row) return res.status(404).json({ error: 'Agent not found' });
    res.json(row);
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
});

// Per-agent content tool grants (UI → DB → hot allowlists file, no gateway restart)
router.get('/:id/tools', requireAuth, (req, res) => {
  try {
    const agent = db().prepare('SELECT * FROM agents WHERE id = ?').get(req.params.id);
    if (!agent) return res.status(404).json({ error: 'Agent not found' });
    if (req.authUser.role === 'ceo' && !userCanAccessAgent(req.authUser, agent.id)) {
      return res.status(404).json({ error: 'Agent not found' });
    }
    res.json({
      grants: agentTools.getAgentToolGrants(agent.id),
      openclaw_agent_id: agentTools.resolveOpenClawAgentId(agent),
      tools: agentTools.listToolsCatalogForAgent(agent.id),
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.put('/:id/tools', requireAuth, async (req, res) => {
  try {
    const agent = db().prepare('SELECT * FROM agents WHERE id = ?').get(req.params.id);
    if (!agent) return res.status(404).json({ error: 'Agent not found' });
    if (req.authUser.role === 'ceo' && !userCanAccessAgent(req.authUser, agent.id)) {
      return res.status(404).json({ error: 'Agent not found' });
    }
    const names = Array.isArray(req.body?.tools) ? req.body.tools : req.body?.grants || [];
    const result = agentTools.setAgentToolGrants(agent, names);
    if (req.body?.sync_tools_md) {
      await agentTools.writeAgentToolsMd(agent, result.grants);
    }
    res.json({
      ...result,
      tools: agentTools.listToolsCatalogForAgent(agent.id),
    });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

router.post('/:id/tools/sync-template-md', requireAuth, async (req, res) => {
  try {
    const agent = db().prepare('SELECT * FROM agents WHERE id = ?').get(req.params.id);
    if (!agent) return res.status(404).json({ error: 'Agent not found' });
    const text = await agentTools.syncToolsMdFromTemplate(agent, req.body?.template_id);
    res.json({ ok: true, bytes: text.length });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// Per-agent workspace (MD files)
router.get('/:id/workspace/files', requireAuth, async (req, res) => {
  try {
    assertUserAgentAccess(req.authUser, req.params.id);
    const agent = db().prepare('SELECT * FROM agents WHERE id = ?').get(req.params.id);
    if (!agent) return res.status(404).json({ error: 'Agent not found' });
    const root = getAgentWorkspaceRoot(agent, req);
    // Persist remapped path only for non-tenant roots (agents.workspace_path is shared across CEOs).
    const posix = root.replace(/\\/g, '/');
    const isTenant = /\/tenants\//i.test(posix);
    if (!isTenant && existsSync(root) && posix !== String(agent.workspace_path || '').replace(/\\/g, '/')) {
      db().prepare('UPDATE agents SET workspace_path = ? WHERE id = ?').run(posix, agent.id);
    }
    const result = await workspace.listWorkspaceFiles(root);
    res.json({ ...result, workspace_root: posix });
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
});

router.get('/:id/workspace/files/:name', requireAuth, async (req, res) => {
  try {
    assertUserAgentAccess(req.authUser, req.params.id);
    const agent = db().prepare('SELECT * FROM agents WHERE id = ?').get(req.params.id);
    if (!agent) return res.status(404).json({ error: 'Agent not found' });
    const root = getAgentWorkspaceRoot(agent, req);
    const result = await workspace.readWorkspaceFile(req.params.name, { workspaceRoot: root });
    res.json(result);
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
});

router.put('/:id/workspace/files/:name', requireAuth, async (req, res) => {
  try {
    assertUserAgentAccess(req.authUser, req.params.id);
    const agent = db().prepare('SELECT * FROM agents WHERE id = ?').get(req.params.id);
    if (!agent) return res.status(404).json({ error: 'Agent not found' });
    const root = getAgentWorkspaceRoot(agent, req);
    const text = typeof req.body === 'string' ? req.body : (req.body?.text ?? req.body?.content ?? '');
    await workspace.writeWorkspaceFile(req.params.name, text, { workspaceRoot: root });
    const read = await workspace.readWorkspaceFile(req.params.name, { workspaceRoot: root });
    res.json({ path: read.path, text: read.text });
  } catch (e) {
    res.status(e.status || 400).json({ error: e.message });
  }
});

// POST /api/agents/:id/sessions/clear — clear this user's OpenClaw session + chat history for the agent
router.post('/:id/sessions/clear', requireAuth, (req, res) => {
  try {
    const ownerUserId = resolveChatOwnerUserId(req, req.body || {});
    assertUserAgentAccess(req.authUser, req.params.id);
    const agent = db().prepare('SELECT id, openclaw_agent_id FROM agents WHERE id = ?').get(req.params.id);
    if (!agent) return res.status(404).json({ error: 'Agent not found' });
    const ensured = ensureTenantOpenClawAgent(agent, ownerUserId);
    const result = startNewChatSession({
      agentId: agent.id,
      openclawAgentId: ensured.openclawAgentId,
      ownerUserId,
    });
    res.json({ ok: true, message: `Your session cleared for agent ${req.params.id}`, ...result });
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
});

// POST /api/agents/:id/sessions/new — New chat (same as clear + explicit new thread); entitlements required
router.post('/:id/sessions/new', requireAuth, (req, res) => {
  try {
    const ownerUserId = resolveChatOwnerUserId(req, req.body || {});
    assertUserAgentAccess(req.authUser, req.params.id);
    const agent = db().prepare('SELECT id, openclaw_agent_id FROM agents WHERE id = ?').get(req.params.id);
    if (!agent) return res.status(404).json({ error: 'Agent not found' });
    const ensured = ensureTenantOpenClawAgent(agent, ownerUserId);
    const result = startNewChatSession({
      agentId: agent.id,
      openclawAgentId: ensured.openclawAgentId,
      ownerUserId,
    });
    res.json(result);
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
});

// POST /api/agents — create a full OpenClaw agent owned by the signed-in CEO
router.post('/', requireAuth, requireCeoOrAdmin, async (req, res) => {
  try {
    const { id, name, role, parent_id, reportingTo, reporting_to, department, tools } = req.body || {};
    let ownerUserId = null;
    if (req.authUser.role === 'ceo') {
      ownerUserId = req.authUser.id;
    } else if (req.authUser.role === 'admin') {
      ownerUserId = (req.body?.owner_user_id || req.body?.ownerUserId || '').trim() || null;
      if (!ownerUserId) {
        return res.status(400).json({ error: 'owner_user_id required when admin creates an agent' });
      }
    }
    let parentId = parent_id || reportingTo || reporting_to || null;
    if (!parentId) {
      const coo = db().prepare('SELECT id FROM agents WHERE is_coo = 1 LIMIT 1').get();
      parentId = coo?.id || null;
    }
    const row = await createFullAgent({
      name: name || 'Unnamed',
      role: role || '',
      parent_id: parentId,
      department: department || '',
      id: id && String(id).trim() ? String(id).trim() : undefined,
      ownerUserId,
      tools: Array.isArray(tools) ? tools : undefined,
    });
    res.status(201).json(row);
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

router.patch('/:id', requireAuth, requireCeoOrAdmin, (req, res) => {
  try {
    const { id } = req.params;
    const row = db().prepare('SELECT * FROM agents WHERE id = ?').get(id);
    if (!row) return res.status(404).json({ error: 'Agent not found' });
    const updates = { ...(req.body || {}) };
    // reportingTo alias → parent_id
    if (updates.reportingTo !== undefined && updates.parent_id === undefined) {
      updates.parent_id = updates.reportingTo;
    }
    if (updates.reporting_to !== undefined && updates.parent_id === undefined) {
      updates.parent_id = updates.reporting_to;
    }
    const allowed = ['name', 'role', 'parent_id', 'department', 'workspace_path', 'openclaw_agent_id', 'is_coo'];
    const set = [];
    const values = [];
    for (const k of allowed) {
      if (updates[k] !== undefined) {
        set.push(`${k} = ?`);
        values.push(k === 'is_coo' ? (updates[k] ? 1 : 0) : updates[k]);
      }
    }
    if (set.length) {
      db().prepare(`UPDATE agents SET ${set.join(', ')} WHERE id = ?`).run(...values, id);
    }
    const updated = db().prepare('SELECT * FROM agents WHERE id = ?').get(id);
    res.json(updated);
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

router.delete('/:id', requireAuth, requireCeoOrAdmin, (req, res) => {
  try {
    const id = req.params.id;
    const agent = db().prepare('SELECT * FROM agents WHERE id = ?').get(id);
    if (!agent) return res.status(404).json({ error: 'Agent not found' });
    if (agent.is_coo) return res.status(400).json({ error: 'Cannot delete the COO agent' });

    removeAgentFromOpenClaw(id);

    db().prepare('DELETE FROM activities WHERE agent_id = ?').run(id);
    db().prepare('DELETE FROM chat_turns WHERE agent_id = ?').run(id);
    db().prepare('DELETE FROM standup_responses WHERE agent_id = ?').run(id);
    db().prepare('DELETE FROM agent_delegation_tasks WHERE to_agent_id = ?').run(id);
    db().prepare('DELETE FROM user_agents WHERE agent_id = ?').run(id);
    db().prepare('DELETE FROM agent_tool_grants WHERE agent_id = ?').run(id);
    db().prepare('UPDATE agents SET parent_id = NULL WHERE parent_id = ?').run(id);
    const r = db().prepare('DELETE FROM agents WHERE id = ?').run(id);
    if (r.changes === 0) return res.status(404).json({ error: 'Agent not found' });
    res.status(204).send();
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Chat: get recent turns for an agent (scoped to signed-in user)
router.get('/:id/chat', requireAuth, (req, res) => {
  try {
    const ownerUserId = resolveChatOwnerUserId(req, req.query || {});
    assertUserAgentAccess(req.authUser, req.params.id);
    const ownerIds = chatOwnerIdsForRead(ownerUserId);
    const placeholders = ownerIds.map(() => '?').join(',');
    const turns = db()
      .prepare(
        `SELECT id, role, content, created_at FROM chat_turns
         WHERE agent_id = ? AND owner_user_id IN (${placeholders})
         ORDER BY created_at`
      )
      .all(req.params.id, ...ownerIds);
    res.json(attachToolCallsToChatTurns(turns, req.params.id, ownerUserId));
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
});

// Chat: send message and get reply (OpenClaw gateway)
router.post('/:id/chat', requireAuth, async (req, res) => {
  try {
    const agentId = req.params.id;
    const ownerUserId = resolveChatOwnerUserId(req, req.body || {});
    assertUserAgentAccess(req.authUser, agentId);
    const agent = db().prepare('SELECT * FROM agents WHERE id = ?').get(agentId);
    if (!agent) return res.status(404).json({ error: 'Agent not found' });

    const message = typeof req.body?.message === 'string' ? req.body.message : (req.body?.content ?? req.body?.text ?? '');
    if (!message.trim()) return res.status(400).json({ error: 'message is required' });

    // Hard path: "ask social media expert to reach me" — notify as specialist, skip COO LLM notify_ceo
    if (agent.is_coo) {
      const reach = await tryHandleCooReachMeRequest(ownerUserId, message.trim());
      if (reach?.ok) {
        db()
          .prepare('INSERT INTO chat_turns (agent_id, owner_user_id, role, content) VALUES (?, ?, ?, ?)')
          .run(agentId, ownerUserId, 'user', message);
        db()
          .prepare('INSERT INTO chat_turns (agent_id, owner_user_id, role, content) VALUES (?, ?, ?, ?)')
          .run(agentId, ownerUserId, 'assistant', reach.cooReply);
        return res.json({
          reply: reach.cooReply,
          agent_id: agentId,
          reach_me: {
            specialist_id: reach.specialist?.id,
            specialist_name: reach.specialist?.name,
            chat_url: reach.chat_url,
            notify_sent: reach.notify?.sent === true,
          },
          workflow_triggered: null,
        });
      }

      // Hard path: "what agents are in the org?" — list from DB (Ollama often confuses this with workflows)
      const orgList = tryHandleCooOrgAgentsList(ownerUserId, message.trim());
      if (orgList?.ok) {
        db()
          .prepare('INSERT INTO chat_turns (agent_id, owner_user_id, role, content) VALUES (?, ?, ?, ?)')
          .run(agentId, ownerUserId, 'user', message);
        db()
          .prepare('INSERT INTO chat_turns (agent_id, owner_user_id, role, content) VALUES (?, ?, ?, ?)')
          .run(agentId, ownerUserId, 'assistant', orgList.cooReply);
        return res.json({
          reply: orgList.cooReply,
          agent_id: agentId,
          org_agents_list: { count: orgList.agent_count },
          workflow_triggered: null,
        });
      }

      // Hard path: specialty work / "delegate …" — schedule real agents, don't let COO do the work
      const delegated = await tryHandleCooSpecialtyDelegation(ownerUserId, message.trim());
      if (delegated?.ok) {
        db()
          .prepare('INSERT INTO chat_turns (agent_id, owner_user_id, role, content) VALUES (?, ?, ?, ?)')
          .run(agentId, ownerUserId, 'user', message);
        db()
          .prepare('INSERT INTO chat_turns (agent_id, owner_user_id, role, content) VALUES (?, ?, ?, ?)')
          .run(agentId, ownerUserId, 'assistant', delegated.cooReply);
        return res.json({
          reply: delegated.cooReply,
          agent_id: agentId,
          specialty_delegation: {
            standup_id: delegated.standup_id,
            request_id: delegated.result?.requestId,
            agent_names: delegated.result?.agentNames || [],
            kanban_task_ids: delegated.result?.kanbanTaskIds || [],
            count: delegated.result?.count || 0,
          },
          workflow_triggered: null,
        });
      }
    }

    // Hard path: wrong specialist for a clear specialty ask (e.g. Social + "deep research")
    if (!agent.is_coo) {
      const referral = await tryBuildSpecialtyReferral(ownerUserId, agent, message.trim());
      if (referral) {
        db()
          .prepare('INSERT INTO chat_turns (agent_id, owner_user_id, role, content) VALUES (?, ?, ?, ?)')
          .run(agentId, ownerUserId, 'user', message);
        db()
          .prepare('INSERT INTO chat_turns (agent_id, owner_user_id, role, content) VALUES (?, ?, ?, ?)')
          .run(agentId, ownerUserId, 'assistant', referral.reply);
        return res.json({
          reply: referral.reply,
          agent_id: agentId,
          specialty_referral: {
            target_id: referral.target?.id,
            target_name: referral.target?.name,
            matched_specialty: referral.matchedSpecialty,
            chat_url: referral.chat_url,
          },
          workflow_triggered: null,
        });
      }
    }

    let workflowTrigger = null;
    if (req.authUser && (req.authUser.role === 'ceo' || req.authUser.role === 'admin')) {
      const ownerUserId = resolveAuthenticatedCeoUserId(req, req.body || {});
      try {
        workflowTrigger = await tryTriggerWorkflowFromChat(ownerUserId, message, {
          id: req.authUser.id,
          name: req.authUser.name,
          type: 'chat',
        });
      } catch (wfErr) {
        console.warn('[agent-workflow] chat trigger failed:', wfErr.message);
      }
    }

    const userId = resolveCeoDataUserIdFromRequest(req, req.body || {});
    const profileId = req.body?.profile_id || req.body?.profileId || null;
    const ensured = ensureTenantOpenClawAgent(agent, ownerUserId);
    const openclawAgentId = ensured.openclawAgentId;

    // Load recent history from DB for context (last N turns, scoped to this user)
    const ownerIds = chatOwnerIdsForRead(ownerUserId);
    const ownerPlaceholders = ownerIds.map(() => '?').join(',');
    let history = db()
      .prepare(
        `SELECT role, content FROM chat_turns
         WHERE agent_id = ? AND owner_user_id IN (${ownerPlaceholders})
         ORDER BY created_at DESC LIMIT 20`
      )
      .all(agentId, ...ownerIds)
      .reverse();

    let sessionMeta = null;
    let topicHint = null;

    // Topic-shift hint (UI handoff) — does not block; specialty-referral already handles hard redirects
    if (!agent.is_coo) {
      topicHint = detectTopicShiftHeuristic(message.trim(), agentId);
    }

    // Fat-context auto-split (TPM protection)
    if (shouldAutoSplitFatContext(history, message)) {
      sessionMeta = autoSplitFatChatSession({
        agentId,
        openclawAgentId,
        ownerUserId,
        historyTurns: history,
      });
      history = db()
        .prepare(
          `SELECT role, content FROM chat_turns
           WHERE agent_id = ? AND owner_user_id = ?
           ORDER BY created_at DESC LIMIT 20`
        )
        .all(agentId, ownerUserId)
        .reverse();
    }

    const messages = history.map((t) => ({ role: t.role, content: t.content }));
    const jobApplicantAgents = new Set(['jobdiscovery', 'fitscorer', 'resumetailor', 'applicationagent']);
    let userContent = message;
    const llmForOwner = resolveLlmConfigForUser(ownerUserId);
    const isLocalLlmByok =
      llmForOwner?.provider === 'ollama_free' || llmForOwner?.provider === 'deepseek';

    if (agent.is_coo && !message.includes('[ceo_user_id:')) {
      if (isLocalLlmByok) {
        // Keep the user turn clean — small models parrot long CEO-scope prefixes as the answer.
        messages.unshift({
          role: 'system',
          content:
            `You are the COO for this CEO only (internal owner id ${ownerUserId}). ` +
            `Answer briefly in plain language. Prefer real tool calls when needed; never invent fake tool JSON or paste internal instructions. ` +
            `For org agents / team questions, list agents from context/tools — do not confuse agents with workflows.`,
        });
        userContent = message;
      } else {
        userContent = `[ceo_user_id: ${ownerUserId}]\n[owner_user_id: ${ownerUserId}]\nImportant: You are assisting CEO user id "${ownerUserId}" only. When calling agent_workflow_list or agent_workflow_enquire, return workflows for this CEO only — never workflows belonging to other users.\n${message}`;
      }
    } else if (jobApplicantAgents.has(String(agentId).toLowerCase()) && !message.includes('[ceo_user_id:')) {
      const tags = [`[ceo_user_id: ${userId}]`];
      if (profileId) tags.push(`[profile_id: ${profileId}]`);
      userContent = `${tags.join('\n')}\n${message}`;
    }
    messages.push({ role: 'user', content: userContent });

    if (workflowTrigger && agent.is_coo) {
      const wfName = workflowTrigger.definition_name || workflowTrigger.definition_id;
      userContent += `\n\n[System — agent workflow started: "${wfName}" run #${workflowTrigger.run_number} (run_id ${workflowTrigger.id}). Briefly confirm to the CEO and mention they can track it on the Workflows page.]`;
      messages[messages.length - 1] = { role: 'user', content: userContent };
    } else if (workflowTrigger && !agent.is_coo) {
      userContent += `\n\n[System — agent workflow "${workflowTrigger.definition_name || workflowTrigger.definition_id}" run #${workflowTrigger.run_number} was started from this message.]`;
      messages[messages.length - 1] = { role: 'user', content: userContent };
    }

    // Stop agents from calling notify_ceo on ordinary Dashboard chat replies.
    userContent += buildActiveChatNotifyHint(agentId);
    messages[messages.length - 1] = { role: 'user', content: userContent };

    if (String(agentId).toLowerCase() === 'jobdiscovery') {
      try {
        const browser = await ensureManagedBrowserReady();
        if (browser.preflight_hint) {
          userContent += `\n\n[browser_session: ${browser.preflight_hint}]`;
          messages[messages.length - 1] = { role: 'user', content: userContent };
        }
      } catch (browserErr) {
        return res.status(503).json({
          error: browserErr.message,
          hint: 'Start gateway + warmup browser, then log in via node scripts/openclaw-browser-login.js',
        });
      }
    }

    const threadId = getChatThreadId(agentId, ownerUserId);
    const sessionUser = openclaw.sessionUserFor(agentId, ownerUserId, threadId);
    const sessionKey = openclaw.sessionKeyFor(openclawAgentId, sessionUser);
    registerOpenClawSessionOwner(sessionKey, ownerUserId);
    registerActiveDashboardChat(agentId, ownerUserId, message.trim());
    const isDiscovery = String(agentId).toLowerCase() === 'jobdiscovery';
    const discoveryTimeout = Number(process.env.OPENCLAW_DISCOVERY_TIMEOUT_MS || 900000);
    const toolsSince = new Date().toISOString();
    let reply;
    let usage;
    // Ollama BYOK is slow/fragile with extra tool-bootstrap instructions on small VPS hosts.
    let chatOpts = isDiscovery ? { timeoutMs: discoveryTimeout } : {};
    try {
      const llm = llmForOwner || resolveLlmConfigForUser(ownerUserId);
      if (llm?.provider === 'ollama_free' || llm?.provider === 'deepseek') {
        chatOpts = {
          ...chatOpts,
          injectLearningsInstruction: false,
          injectSessionHistoryInstruction: false,
          timeoutMs: chatOpts.timeoutMs || Number(process.env.OPENCLAW_OLLAMA_CHAT_TIMEOUT_MS || 300000),
        };
      }
    } catch (_) {
      /* keep defaults */
    }
    try {
      ({ content: reply, usage } = await openclaw.chatCompletions(
        openclawAgentId,
        messages,
        sessionUser,
        false,
        chatOpts
      ));
    } finally {
      clearActiveDashboardChat(agentId, ownerUserId);
    }
    const replyText = stripEchoedCeoScope(normalizeReplyContent(reply));
    const tool_calls = listToolCallsSince(agentId, ownerUserId, toolsSince);

    // Persist user message and assistant reply (same normalized string shape as standup chat)
    db()
      .prepare('INSERT INTO chat_turns (agent_id, owner_user_id, role, content) VALUES (?, ?, ?, ?)')
      .run(agentId, ownerUserId, 'user', message);
    db()
      .prepare('INSERT INTO chat_turns (agent_id, owner_user_id, role, content) VALUES (?, ?, ?, ?)')
      .run(agentId, ownerUserId, 'assistant', replyText);

    res.json({
      reply: replyText,
      usage,
      agent_id: agentId,
      tool_calls,
      thread_id: threadId,
      session_reset: sessionMeta || null,
      topic_hint: topicHint
        ? {
            ...topicHint,
            chat_url: topicHint.suggested_agent_id
              ? `/agents/${encodeURIComponent(topicHint.suggested_agent_id)}/chat`
              : null,
          }
        : null,
      workflow_triggered: workflowTrigger
        ? {
            run_id: workflowTrigger.id,
            run_number: workflowTrigger.run_number,
            definition_id: workflowTrigger.definition_id,
            definition_name: workflowTrigger.definition_name,
          }
        : null,
    });
  } catch (e) {
    const raw = e?.message || String(e);
    const lower = raw.toLowerCase();
    let msg = raw;
    if (lower.includes('fetch failed') || lower.includes('econnrefused') || lower.includes('econnreset')) {
      msg =
        `${raw}. OpenClaw/Ollama may be overloaded or unreachable. ` +
        `If this CEO uses Ollama BYOK, ensure the ollama container is up, model ${process.env.OLLAMA_MODEL || 'llama3.2'} is pulled, and try New chat.`;
    }
    res.status(e.status || 502).json({ error: msg });
  }
});

// Chat from another agent (internal service or authenticated CEO).
// Session callers: owner is always the session CEO (never body spoof).
// Internal service: may pass owner_user_id / ceo_user_id or embed in message text.
router.post('/:id/chat/from-agent', allowInternalOrAuth, async (req, res) => {
  try {
    const agentId = req.params.id;
    const agent = db().prepare('SELECT * FROM agents WHERE id = ?').get(agentId);
    if (!agent) return res.status(404).json({ error: 'Agent not found' });

    const fromAgentId = req.body?.from_agent_id;
    const message = typeof req.body?.message === 'string' ? req.body.message : (req.body?.content ?? '');
    if (!fromAgentId || !message.trim()) return res.status(400).json({ error: 'from_agent_id and message required' });

    const fromAgent = db().prepare('SELECT * FROM agents WHERE id = ?').get(fromAgentId);
    if (!fromAgent) return res.status(404).json({ error: 'From agent not found' });

    const userContent = `From ${fromAgent.name} (${fromAgent.role}): ${message.trim()}`;
    let ownerUserId;
    if (req.isInternalService) {
      const fromText = extractOwnerUserIdFromText(message, '');
      ownerUserId =
        String(req.body?.owner_user_id || req.body?.ceo_user_id || '').trim() ||
        String(fromText || '').trim() ||
        req.authUser?.id ||
        null;
      if (!ownerUserId) {
        return res.status(400).json({ error: 'owner_user_id required for internal from-agent chat' });
      }
    } else {
      ownerUserId = resolveChatOwnerUserId(req, {});
      assertUserAgentAccess(req.authUser, agentId);
    }
    const ensured = ensureTenantOpenClawAgent(agent, ownerUserId);
    const openclawAgentId = ensured.openclawAgentId;

    const ownerIds = chatOwnerIdsForRead(ownerUserId);
    const ownerPlaceholders = ownerIds.map(() => '?').join(',');
    const history = db()
      .prepare(
        `SELECT role, content FROM chat_turns
         WHERE agent_id = ? AND owner_user_id IN (${ownerPlaceholders})
         ORDER BY created_at DESC LIMIT 20`
      )
      .all(agentId, ...ownerIds)
      .reverse();
    const messages = history.map((t) => ({ role: t.role, content: t.content }));
    messages.push({ role: 'user', content: userContent });

    const sessionUser = openclaw.sessionUserFor(agentId, ownerUserId);
    const { content: reply, usage } = await openclaw.chatCompletions(openclawAgentId, messages, sessionUser, false);
    const replyText = normalizeReplyContent(reply);

    db()
      .prepare('INSERT INTO chat_turns (agent_id, owner_user_id, role, content) VALUES (?, ?, ?, ?)')
      .run(agentId, ownerUserId, 'user', userContent);
    db()
      .prepare('INSERT INTO chat_turns (agent_id, owner_user_id, role, content) VALUES (?, ?, ?, ?)')
      .run(agentId, ownerUserId, 'assistant', replyText);

    res.json({ reply, usage, agent_id: agentId, from_agent_id: fromAgentId });
  } catch (e) {
    res.status(e.status || 502).json({ error: e.message });
  }
});

// Activities (append-only)
router.get('/:id/activities', requireAuth, (req, res) => {
  try {
    assertUserAgentAccess(req.authUser, req.params.id);
    const rows = db().prepare('SELECT * FROM activities WHERE agent_id = ? ORDER BY created_at DESC LIMIT 100')
      .all(req.params.id);
    res.json(rows);
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
});

router.post('/:id/activities', requireAuth, (req, res) => {
  try {
    assertUserAgentAccess(req.authUser, req.params.id);
    const agentId = req.params.id;
    const agent = db().prepare('SELECT * FROM agents WHERE id = ?').get(agentId);
    if (!agent) return res.status(404).json({ error: 'Agent not found' });
    const { type, payload } = req.body;
    db().prepare('INSERT INTO activities (agent_id, type, payload) VALUES (?, ?, ?)').run(
      agentId,
      type || 'activity',
      typeof payload === 'string' ? payload : JSON.stringify(payload ?? {})
    );
    res.status(201).json({ ok: true });
  } catch (e) {
    res.status(e.status || 400).json({ error: e.message });
  }
});

export default router;
