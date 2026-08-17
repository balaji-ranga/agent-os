/**
 * Hireable role templates from openclaw-workspace-templates/hireable-roles.json.
 * Generic Hire picker — Slow Caller / Realtime Caller and any future role packs listed there.
 */
import { existsSync, readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const REPO_TEMPLATES = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'openclaw-workspace-templates');
const CATALOG_PATH = join(REPO_TEMPLATES, 'hireable-roles.json');

/** Default content tools for Slow Caller / Realtime Caller (existing catalog only). */
export const CALLER_EMPLOYEE_TOOLS = Object.freeze([
  'learnings_summary',
  'speech_stt',
  'speech_tts',
  'list_inbound_attachments',
  'master_data_list_tables',
  'master_data_list_rows',
  'master_data_list_documents',
  'master_data_rag',
  'master_data_insert_row',
  'kanban_create_task',
  'kanban_move_status',
  'kanban_get_task',
  'kanban_reassign_to_coo',
  'email_send',
  'notify_ceo',
  'ceo_profile',
  'crm_status',
  'crm_list_people',
  'crm_list_companies',
  'crm_list_opportunities',
  'crm_list_leads',
  'crm_list_notes',
  'crm_list_tasks',
  'crm_create_lead',
  'crm_create_person',
  'crm_create_company',
  'crm_create_opportunity',
  'agent_goal_create',
  'agent_goal_status',
  'agent_goal_list',
  'agent_goal_complete_step',
  'summarize_url',
]);

function readJson(path) {
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch (e) {
    console.warn('[hireable-roles] parse failed %s: %s', path, e?.message || e);
    return null;
  }
}

export function listHireableRoleTemplates() {
  const catalog = readJson(CATALOG_PATH);
  const roles = Array.isArray(catalog?.roles) ? catalog.roles : [];
  return roles
    .map((r) => {
      const id = String(r.id || '').trim().toLowerCase();
      if (!id) return null;
      const folder = join(REPO_TEMPLATES, id);
      if (!existsSync(join(folder, 'SOUL.md'))) return null;
      const source = readJson(join(folder, '.template-source.json')) || {};
      const tools = Array.isArray(source.tools) && source.tools.length
        ? source.tools
        : [...CALLER_EMPLOYEE_TOOLS];
      return {
        id,
        name: r.name || id,
        role: r.role || r.name || id,
        department: r.department || 'Support',
        description: r.description || '',
        tools,
        template_base_id: id,
        workspace_template: `openclaw-workspace-templates/${id}/`,
      };
    })
    .filter(Boolean);
}

export function getHireableRoleTemplate(templateId) {
  const id = String(templateId || '').trim().toLowerCase();
  if (!id) return null;
  return listHireableRoleTemplates().find((r) => r.id === id) || null;
}
