/**
 * Full CEO/user offboarding: schedules, workflows, standups, grants, tenant DB/files, OpenClaw tenants.
 */
import { existsSync, rmSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { getDb } from '../db/schema.js';
import { closeCeoDb } from '../db/ceo-db.js';
import { usesTenantCeoDb } from '../db/ceo-db-config.js';
import { getBalaCeoAuthId, getDefaultCeoUserId } from './job-applicant-ceo.js';
import { setUserEnabled, getUserById } from './users.js';
import { revokeAllSessions } from './auth/session.js';
import { removeWorkflowSchedulesForOwner } from './agent-workflow-store.js';
import { deleteDefinitionWithCleanup } from './agent-workflow-run-manager.js';
import { deleteAgentCascade } from './agent-delete.js';
import { getOpenClawDir, getOpenClawConfigPath } from '../config/openclaw-paths.js';
import { writeOpenClawConfigSafe } from './openclaw-config-safe.js';
import { deleteAllMediaForOwner } from './ceo-media-artifacts.js';
import { deleteAllAvatarsForOwner } from './ceo-avatars.js';

function sanitizeIdPart(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-zA-Z0-9_.-]+/g, '_')
    .replace(/^_+|_+$/g, '') || 'unknown';
}

/** Names that must never be hard-deleted (case-insensitive exact match). */
export const PROTECTED_OFFBOARD_NAMES = [
  'Balaji Ranganathan',
  'Admin',
  'Platform Admin',
  'Aru',
  'Senthil Loganathan',
];

function dataDir() {
  return process.env.AGENT_OS_DATA_DIR || join(process.cwd(), 'data');
}

function masterDataDirFor(ownerUserId) {
  return join(dataDir(), 'master-data', sanitizeIdPart(ownerUserId));
}

function tenantOpenClawDir(ceoUserId) {
  return join(getOpenClawDir(), 'tenants', sanitizeIdPart(ceoUserId));
}

/**
 * @param {{ id: string, name?: string, role?: string, email?: string }} user
 */
export function isProtectedFromOffboard(user) {
  if (!user?.id) return true;
  const id = String(user.id);
  if (id === 'default' || id === getDefaultCeoUserId() || id === getBalaCeoAuthId()) return true;
  if (String(user.role || '').toLowerCase() === 'admin') return true;
  const name = String(user.name || '').trim().toLowerCase();
  return PROTECTED_OFFBOARD_NAMES.some((n) => n.toLowerCase() === name);
}

function tryRun(db, sql, params = []) {
  try {
    return db.prepare(sql).run(...params).changes || 0;
  } catch (e) {
    return 0;
  }
}

function tryAll(db, sql, params = []) {
  try {
    return db.prepare(sql).all(...params);
  } catch {
    return [];
  }
}

function scrubOpenClawTenantAgents(ceoUserId) {
  const prefix = `t-${sanitizeIdPart(ceoUserId)}--`;
  const path = getOpenClawConfigPath();
  if (!existsSync(path)) return { removed: 0 };
  let config;
  try {
    config = JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return { removed: 0, error: 'openclaw.json parse failed' };
  }
  const list = Array.isArray(config?.agents?.list) ? config.agents.list : [];
  const next = list.filter((a) => {
    const id = String(a?.id || '').toLowerCase();
    return !id.startsWith(prefix);
  });
  const removed = list.length - next.length;
  if (removed > 0) {
    config.agents = config.agents || {};
    config.agents.list = next;
    writeOpenClawConfigSafe(config);
  }
  return { removed };
}

function deleteOwnedCustomAgents(db, ownerUserId) {
  const agents = tryAll(db, `SELECT id FROM agents WHERE owner_user_id = ? AND agent_type = 'custom'`, [
    ownerUserId,
  ]);
  let deleted = 0;
  for (const a of agents) {
    try {
      // Shared cascade: clears every FK referrer (kanban assignments included) in
      // one transaction. Cleaning only grants left `DELETE FROM agents` to fail.
      deleteAgentCascade(db, a.id, { deletedBy: `offboard:${ownerUserId}`, allowCoo: true });
      deleted += 1;
    } catch (e) {
      console.warn('[offboard] agent delete failed', a.id, e?.message || e);
    }
  }
  return deleted;
}

function purgeOwnerScopedRows(db, ownerUserId) {
  const counts = {};

  // Workflows: delete definitions with full run cleanup
  const defs = tryAll(db, `SELECT id FROM agent_workflow_definitions WHERE owner_user_id = ?`, [ownerUserId]);
  let workflows = 0;
  for (const d of defs) {
    try {
      deleteDefinitionWithCleanup(d.id, ownerUserId, { id: 'system', name: 'offboard' });
      workflows += 1;
    } catch (e) {
      console.warn('[offboard] workflow delete failed', d.id, e?.message || e);
    }
  }
  counts.workflows = workflows;
  counts.workflow_schedules = removeWorkflowSchedulesForOwner(ownerUserId);
  counts.workflow_chat_turns = tryRun(db, `DELETE FROM agent_workflow_chat_turns WHERE owner_user_id = ?`, [
    ownerUserId,
  ]);
  counts.workflow_schedule_ticks = tryRun(
    db,
    `DELETE FROM agent_workflow_schedule_ticks WHERE definition_id NOT IN (SELECT id FROM agent_workflow_definitions)`
  );
  counts.workflow_a2a = tryRun(db, `DELETE FROM workflow_a2a_publications WHERE owner_user_id = ?`, [ownerUserId]);
  counts.workflow_file_pollers = tryRun(db, `DELETE FROM workflow_file_pollers WHERE owner_user_id = ?`, [
    ownerUserId,
  ]);

  // Standups + messages + delegations + kanban
  const standupIds = tryAll(db, `SELECT id FROM standups WHERE owner_user_id = ?`, [ownerUserId]).map((r) => r.id);
  let standupMsgs = 0;
  for (const sid of standupIds) {
    standupMsgs += tryRun(db, `DELETE FROM standup_messages WHERE standup_id = ?`, [sid]);
  }
  counts.standup_messages = standupMsgs;
  counts.delegations = tryRun(db, `DELETE FROM agent_delegation_tasks WHERE owner_user_id = ?`, [ownerUserId]);
  // Also by standup_id for legacy rows without owner
  for (const sid of standupIds) {
    counts.delegations += tryRun(db, `DELETE FROM agent_delegation_tasks WHERE standup_id = ?`, [sid]);
  }
  const kanbanIds = tryAll(db, `SELECT id FROM kanban_tasks WHERE owner_user_id = ?`, [ownerUserId]).map((r) => r.id);
  let kanbanMsgs = 0;
  for (const kid of kanbanIds) {
    kanbanMsgs += tryRun(db, `DELETE FROM kanban_task_messages WHERE task_id = ?`, [kid]);
    kanbanMsgs += tryRun(db, `DELETE FROM kanban_messages WHERE task_id = ?`, [kid]);
  }
  counts.kanban_messages = kanbanMsgs;
  counts.kanban_tasks = tryRun(db, `DELETE FROM kanban_tasks WHERE owner_user_id = ?`, [ownerUserId]);
  for (const sid of standupIds) {
    counts.kanban_tasks += tryRun(db, `DELETE FROM kanban_tasks WHERE standup_id = ?`, [sid]);
  }
  counts.scheduled_goal_runs = tryRun(db, `DELETE FROM scheduled_goal_runs WHERE owner_user_id = ?`, [ownerUserId]);
  counts.scheduled_goals = tryRun(db, `DELETE FROM scheduled_goals WHERE owner_user_id = ?`, [ownerUserId]);
  counts.standups = tryRun(db, `DELETE FROM standups WHERE owner_user_id = ?`, [ownerUserId]);

  // Chat / tools / feedback / notifications
  counts.chat_turns = tryRun(db, `DELETE FROM chat_turns WHERE owner_user_id = ?`, [ownerUserId]);
  counts.content_tool_logs = tryRun(db, `DELETE FROM content_tool_logs WHERE owner_user_id = ?`, [ownerUserId]);
  counts.agent_response_feedback = tryRun(db, `DELETE FROM agent_response_feedback WHERE owner_user_id = ?`, [
    ownerUserId,
  ]);
  counts.notifications = tryRun(db, `DELETE FROM platform_user_notifications WHERE user_id = ?`, [ownerUserId]);
  counts.feed_dismissals = tryRun(db, `DELETE FROM user_feed_dismissals WHERE user_id = ?`, [ownerUserId]);

  // Integrations / scripts / MCP
  counts.mcp_servers = tryRun(db, `DELETE FROM mcp_servers WHERE owner_user_id = ?`, [ownerUserId]);
  counts.org_member_invocations = tryRun(
    db,
    `DELETE FROM org_member_invocations WHERE owner_user_id = ?`,
    [ownerUserId]
  );
  counts.org_agent_members = tryRun(db, `DELETE FROM org_agent_members WHERE owner_user_id = ?`, [ownerUserId]);
  counts.external_agents = tryRun(db, `DELETE FROM external_agents WHERE owner_user_id = ?`, [ownerUserId]);
  counts.custom_scripts = tryRun(db, `DELETE FROM custom_scripts WHERE owner_user_id = ?`, [ownerUserId]);
  counts.ibkr_reservations = tryRun(db, `DELETE FROM ibkr_trade_reservations WHERE owner_user_id = ?`, [
    ownerUserId,
  ]);
  counts.ibkr_order_events = tryRun(db, `DELETE FROM ibkr_order_events WHERE owner_user_id = ?`, [ownerUserId]);
  counts.ibkr_positions = tryRun(db, `DELETE FROM ibkr_positions_cache WHERE owner_user_id = ?`, [ownerUserId]);
  counts.ibkr_account_snapshot_cache = tryRun(
    db,
    `DELETE FROM ibkr_account_snapshot_cache WHERE owner_user_id = ?`,
    [ownerUserId]
  );

  // Shared-DB master data / job tables (when not using tenant file)
  counts.md_chunks = tryRun(db, `DELETE FROM master_data_doc_chunks WHERE owner_user_id = ?`, [ownerUserId]);
  counts.md_docs = tryRun(db, `DELETE FROM master_data_documents WHERE owner_user_id = ?`, [ownerUserId]);
  counts.md_rows = tryRun(db, `DELETE FROM master_data_rows WHERE owner_user_id = ?`, [ownerUserId]);
  counts.md_tables = tryRun(db, `DELETE FROM master_data_tables WHERE owner_user_id = ?`, [ownerUserId]);
  counts.job_apps = tryRun(db, `DELETE FROM job_applications WHERE ceo_user_id = ?`, [ownerUserId]);
  counts.job_profiles = tryRun(db, `DELETE FROM job_search_profiles WHERE ceo_user_id = ?`, [ownerUserId]);
  counts.job_workflow_runs = tryRun(db, `DELETE FROM job_workflow_runs WHERE ceo_user_id = ?`, [ownerUserId]);
  counts.job_pipeline = tryRun(db, `DELETE FROM job_pipeline_state WHERE ceo_user_id = ?`, [ownerUserId]);
  counts.job_ceo_settings = tryRun(db, `DELETE FROM job_search_ceo_settings WHERE ceo_user_id = ?`, [ownerUserId]);

  // OpenConnector binding
  counts.openconnector = tryRun(db, `DELETE FROM openconnector_user_links WHERE user_id = ?`, [ownerUserId]);

  // Extra owner-scoped tables that previously blocked platform_users DELETE (FK / leftovers)
  counts.mfa_challenges = tryRun(db, `DELETE FROM mfa_challenges WHERE user_id = ?`, [ownerUserId]);
  counts.password_reset_tokens = tryRun(db, `DELETE FROM password_reset_tokens WHERE user_id = ?`, [ownerUserId]);
  counts.ceo_agent_channels = tryRun(db, `DELETE FROM ceo_agent_channels WHERE owner_user_id = ?`, [ownerUserId]);
  counts.ceo_media_artifacts = tryRun(db, `DELETE FROM ceo_media_artifacts WHERE owner_user_id = ?`, [ownerUserId]);
  counts.ceo_avatars = tryRun(db, `DELETE FROM ceo_avatars WHERE owner_user_id = ?`, [ownerUserId]);
  counts.ceo_vr_scenes = tryRun(db, `DELETE FROM ceo_vr_scenes WHERE owner_user_id = ?`, [ownerUserId]);
  counts.ceo_vr_rooms = tryRun(db, `DELETE FROM ceo_vr_rooms WHERE owner_user_id = ?`, [ownerUserId]);
  counts.platform_feedback = tryRun(db, `DELETE FROM platform_feedback WHERE owner_user_id = ? OR initiator_user_id = ?`, [
    ownerUserId,
    ownerUserId,
  ]);
  counts.token_usage = tryRun(db, `DELETE FROM token_usage WHERE owner_user_id = ?`, [ownerUserId]);
  counts.agent_monthly_budgets = tryRun(db, `DELETE FROM agent_monthly_budgets WHERE owner_user_id = ?`, [ownerUserId]);
  counts.browser_tasks = tryRun(db, `DELETE FROM browser_tasks WHERE owner_user_id = ?`, [ownerUserId]);
  counts.browser_recipes = tryRun(db, `DELETE FROM browser_recipes WHERE owner_user_id = ?`, [ownerUserId]);
  counts.published_scenes = tryRun(db, `DELETE FROM published_scenes WHERE owner_user_id = ?`, [ownerUserId]);

  counts.custom_agents = deleteOwnedCustomAgents(db, ownerUserId);
  counts.user_agents = tryRun(db, `DELETE FROM user_agents WHERE user_id = ?`, [ownerUserId]);
  counts.sessions = tryRun(db, `DELETE FROM platform_sessions WHERE user_id = ?`, [ownerUserId]);
  counts.mfa_tokens = tryRun(db, `DELETE FROM mfa_tokens WHERE user_id = ?`, [ownerUserId]);
  counts.mfa_backup = tryRun(db, `DELETE FROM mfa_backup_codes WHERE user_id = ?`, [ownerUserId]);

  return counts;
}

/**
 * Hard-offboard a platform user (CEO). Protected users are refused.
 * @param {string} userId
 * @param {{ confirmEmail?: string, actor?: { id: string, name?: string }, dryRun?: boolean }} [opts]
 */
export function offboardUser(userId, opts = {}) {
  const db = getDb();
  const row = db.prepare(`SELECT * FROM platform_users WHERE id = ?`).get(String(userId));
  if (!row) {
    const err = new Error('User not found');
    err.status = 404;
    throw err;
  }
  if (isProtectedFromOffboard(row)) {
    const err = new Error(
      `Refusing to offboard protected user "${row.name}" (${row.id}). Protected: ${PROTECTED_OFFBOARD_NAMES.join(', ')} and all admins.`
    );
    err.status = 400;
    throw err;
  }
  if (opts.confirmEmail) {
    const want = String(opts.confirmEmail || '').trim().toLowerCase();
    const have = String(row.email || '').trim().toLowerCase();
    if (!want || want !== have) {
      const err = new Error('confirm_email must match the user email exactly');
      err.status = 400;
      throw err;
    }
  }

  if (opts.dryRun) {
    return {
      ok: true,
      dry_run: true,
      user: { id: row.id, name: row.name, email: row.email, role: row.role },
      would_delete: true,
    };
  }

  const summary = {
    user: { id: row.id, name: row.name, email: row.email, role: row.role },
    steps: {},
  };

  // 1) Disable + clear schedule registry + sessions
  try {
    setUserEnabled(row.id, false);
    summary.steps.disabled = true;
  } catch (e) {
    summary.steps.disabled_error = e?.message || String(e);
  }
  try {
    revokeAllSessions(row.id);
    summary.steps.sessions_revoked = true;
  } catch (_) {
    /* ignore */
  }

  // 2) Shared DB owner-scoped purge (standups, workflows, etc.)
  summary.steps.db = purgeOwnerScopedRows(db, row.id);

  // 3b) Media artifacts + 3D avatars
  try {
    deleteAllMediaForOwner(row.id);
    summary.steps.media_removed = true;
  } catch (e) {
    summary.steps.media_error = e?.message || String(e);
  }
  try {
    deleteAllAvatarsForOwner(row.id);
    summary.steps.avatars_removed = true;
  } catch (e) {
    summary.steps.avatars_error = e?.message || String(e);
  }

  // 3) Tenant filesystem + ceo.db
  if (usesTenantCeoDb(row.id)) {
    try {
      closeCeoDb(row.id);
    } catch (_) {}
    const safe = String(row.id).replace(/[^a-zA-Z0-9_.-]/g, '_');
    const dataRoot = process.env.AGENT_OS_DATA_DIR || join(process.cwd(), 'data');
    const tenantDir = join(dataRoot, 'tenants', safe);
    try {
      if (existsSync(tenantDir)) {
        rmSync(tenantDir, { recursive: true, force: true });
        summary.steps.tenant_db_dir_removed = tenantDir;
      }
    } catch (e) {
      summary.steps.tenant_db_error = e?.message || String(e);
    }
  }

  // 4) Master-data files
  const mdDir = masterDataDirFor(row.id);
  try {
    if (existsSync(mdDir)) {
      rmSync(mdDir, { recursive: true, force: true });
      summary.steps.master_data_dir_removed = mdDir;
    }
  } catch (e) {
    summary.steps.master_data_error = e?.message || String(e);
  }

  // 5) OpenClaw tenant workspaces + config scrub
  const ocDir = tenantOpenClawDir(row.id);
  try {
    if (existsSync(ocDir)) {
      rmSync(ocDir, { recursive: true, force: true });
      summary.steps.openclaw_tenant_removed = ocDir;
    }
  } catch (e) {
    summary.steps.openclaw_tenant_error = e?.message || String(e);
  }
  summary.steps.openclaw_agents = scrubOpenClawTenantAgents(row.id);

  // 6) Delete platform_users row last — must succeed or surface a real error
  let deleted = 0;
  let deleteError = null;
  try {
    deleted = db.prepare(`DELETE FROM platform_users WHERE id = ?`).run(row.id).changes || 0;
  } catch (e) {
    deleteError = e?.message || String(e);
    console.warn('[offboard] platform_users DELETE failed', { id: row.id, error: deleteError });
  }
  summary.steps.platform_user_deleted = deleted;
  if (deleteError) summary.steps.platform_user_delete_error = deleteError;

  if (!deleted) {
    // Soft-fallback: leave disabled + session-revoked so Admin is not stuck, but report failure clearly.
    const err = new Error(
      deleteError
        ? `Offboard cleaned data but could not delete the user account (DB constraint): ${deleteError}`
        : 'Offboard cleaned data but the user account row was not deleted (still present). Check FK leftovers.'
    );
    err.status = 500;
    err.offboard_summary = summary;
    throw err;
  }

  return { ok: true, ...summary };
}

/**
 * Offboard every non-protected platform user.
 * @param {{ dryRun?: boolean, actor?: object }} [opts]
 */
export function offboardAllExceptProtected(opts = {}) {
  const users = getDb()
    .prepare(`SELECT id, email, name, role, enabled FROM platform_users ORDER BY created_at`)
    .all();
  const kept = [];
  const removed = [];
  const errors = [];
  for (const u of users) {
    if (isProtectedFromOffboard(u)) {
      kept.push({ id: u.id, name: u.name, email: u.email, role: u.role });
      continue;
    }
    try {
      if (opts.dryRun) {
        removed.push({ id: u.id, name: u.name, email: u.email, dry_run: true });
      } else {
        const result = offboardUser(u.id, { actor: opts.actor });
        removed.push({ id: u.id, name: u.name, email: u.email, result });
      }
    } catch (e) {
      errors.push({ id: u.id, name: u.name, email: u.email, error: e?.message || String(e) });
    }
  }
  return { ok: errors.length === 0, kept, removed, errors };
}
