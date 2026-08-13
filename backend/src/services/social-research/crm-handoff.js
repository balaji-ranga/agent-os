/**
 * Hand Business Discovery leads to a CRM AI employee via Kanban,
 * or to the CEO inbox when no CRM employee is entitled.
 * Agent ids come from the CEO's business profile / agents table — never a hardcoded roster.
 */
import { getDb } from '../../db/schema.js';
import { getBusinessProfile } from '../company-business-profile.js';
import { notifyKanbanTaskCreated } from '../platform-notifications.js';

/**
 * Prefer an entitled CRM prefab id from company_business_profile, else any
 * granted agent whose department/role/name mentions CRM (DB lookup).
 */
export function findCrmHandoffAgentId(ownerUserId) {
  const owner = String(ownerUserId || '').trim();
  if (!owner) return null;
  const db = getDb();
  let prefabIds = [];
  try {
    const profile = getBusinessProfile(owner);
    prefabIds = Array.isArray(profile?.prefab_crm_agent_ids) ? profile.prefab_crm_agent_ids : [];
  } catch (e) {
    console.warn('[social-research] crm profile read failed: %s', e.message || e);
  }
  for (const id of prefabIds) {
    const row = db
      .prepare(
        `SELECT a.id FROM agents a
         INNER JOIN user_agents ua ON ua.agent_id = a.id AND ua.user_id = ? AND ua.enabled = 1
         WHERE a.id = ?`
      )
      .get(owner, String(id));
    if (row?.id) return row.id;
  }
  const fallback = db
    .prepare(
      `SELECT a.id FROM agents a
       INNER JOIN user_agents ua ON ua.agent_id = a.id AND ua.user_id = ? AND ua.enabled = 1
       WHERE LOWER(COALESCE(a.department,'')) LIKE '%crm%'
          OR LOWER(COALESCE(a.role,'')) LIKE '%crm%'
          OR LOWER(COALESCE(a.name,'')) LIKE '%crm%'
       ORDER BY a.name
       LIMIT 1`
    )
    .get(owner);
  return fallback?.id || null;
}

function formatLeadLines(leads) {
  return (leads || [])
    .map((l, i) => {
      const bits = [
        `${i + 1}. ${l.name || l.business_name || 'Unknown'}`,
        l.rating != null ? `rating ${l.rating}` : null,
        l.address || null,
        l.website ? `web ${l.website}` : null,
        l.instagram ? `ig ${l.instagram}` : null,
        l.linkedin ? `li ${l.linkedin}` : null,
        l.place_id ? `place_id ${l.place_id}` : null,
      ].filter(Boolean);
      return bits.join(' — ');
    })
    .join('\n');
}

export function createDiscoveryKanbanTask({
  ownerUserId,
  createdByAgentId,
  title,
  query,
  newLeads,
  skippedLeads,
} = {}) {
  const owner = String(ownerUserId || '').trim();
  if (!owner) throw Object.assign(new Error('owner_user_id required'), { status: 400 });
  const crmAgentId = findCrmHandoffAgentId(owner);
  const assignedAgentId = crmAgentId || null;
  const target = crmAgentId ? `CRM employee ${crmAgentId}` : 'CEO inbox (no CRM employee in this org)';
  const description = [
    `Business Discovery handoff for: ${String(query || '').trim() || 'locality search'}`,
    '',
    `Assign to: ${target}`,
    '',
    'Duplicate policy:',
    '- Check Knowledge table `discovered_opportunities` (fingerprint / place_id) before creating CRM records.',
    '- Also search existing CRM people/companies/leads by name + locality; skip if already present.',
    '- Do not open a second CRM lead for a row whose status is identified or handed_to_crm.',
    '',
    `New opportunities (${(newLeads || []).length}):`,
    formatLeadLines(newLeads) || '(none)',
    '',
    `Already in Knowledge — do not re-create (${(skippedLeads || []).length}):`,
    formatLeadLines(skippedLeads) || '(none)',
    '',
    `owner_user_id: ${owner}`,
    `created_by_agent: ${createdByAgentId || 'business_discover'}`,
  ].join('\n');

  const db = getDb();
  db.prepare(
    `INSERT INTO kanban_tasks (title, description, status, assigned_agent_id, created_by, due_date, owner_user_id)
     VALUES (?, ?, 'open', ?, ?, ?, ?)`
  ).run(
    String(title || 'Business Discovery leads').slice(0, 200),
    description,
    assignedAgentId,
    createdByAgentId || 'user',
    null,
    owner
  );
  const row = db.prepare('SELECT * FROM kanban_tasks ORDER BY id DESC LIMIT 1').get();
  try {
    notifyKanbanTaskCreated({ userId: owner, task: row });
  } catch (e) {
    console.warn('[social-research] kanban notify failed: %s', e.message || e);
  }
  console.info(
    '[social-research] kanban handoff task=%s assignee=%s new=%s skipped=%s',
    row?.id,
    assignedAgentId || 'ceo',
    (newLeads || []).length,
    (skippedLeads || []).length
  );
  return {
    ok: true,
    task_id: row.id,
    assigned_agent_id: assignedAgentId,
    assigned_to: assignedAgentId ? 'crm_agent' : 'ceo',
    title: row.title,
  };
}
