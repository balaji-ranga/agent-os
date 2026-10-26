import { getDb } from '../../db/schema.js';
import { ensureActionPolicyTables } from '../action-policy.js';
import { writeOpenClawToolsList } from '../content-tools-meta.js';
import { syncAllowlistsFile } from '../openclaw-agent-tools.js';
import {seedKanbanToolsIfMissing} from '../../db/seed-content-tools-meta.js';

export const FLOASSIST_TOOLS=[
  {name:'floassist_source_read',tier:'R0',family:'read',purpose:'Read verified owner source content using deterministic provider actions. For latest email use app_id gmail or outlook; for an existing task use task_id only; for a file use app_id and source_id from discovery. Calendar requires app_id google_calendar and explicit ISO time_min/time_max. Follow next_offset using offset until null. Returns exact provenance and paginated content, or an explicit unsupported/error result. Never infer a body or deadline from metadata.'},
  {name:'floassist_tracking_list',tier:'R0',family:'read',purpose:'List all owner FloAssist Kanban tracking records, including closed tasks beyond current email filters. Body: {after_id?: number, limit?: 1-100}. Follow next_after_id until null before correlating findings or ambiguous user completion.'},
  {name:'floassist_tracking_observe',tier:'R1',family:'write_internal',purpose:'Persist a verified priority/deadline/follow-up obligation as one owner Kanban task and queue only an eligible notification. Body: {app_id: FloAssist selected app ID, account_id: stable connected account identity, source_id: thread ID when available else source item ID, obligation_key?: stable key default action, category: priority|deadlines|followups, title, evidence: concise verified facts, due_at?: ISO datetime with offset or null, source_url?: HTTPS, scheduled_goal_id?: current scheduled goal ID, run_key?: current run header key (both required for repeat alerts), existing_task_id?: existing owner Kanban task to link}. Reuse the same source identity across runs and categories. Do not vary obligation_key with wording or dates. Closed tasks suppress alerts; observations cannot reopen them. Do not send another alert after this tool queues one.'},
  {name:'floassist_tracking_update',tier:'R1',family:'write_internal',purpose:'Manage tracking on an identified owner task. Body: {task_id, action: acknowledge|snooze|track|stop|clarify|close_orphan, evidence: exact user instruction for acknowledge/snooze/track or direct-source check result for clarify, until?: future ISO timestamp with offset for snooze, source_checked?: true required for clarify}. stop suppresses tracking until track resumes; acknowledge does not stop future matching alerts. close_orphan only accepts FloAssist-created mail tasks and requires exact stored app_id/account_id/source_id/obligation_key, source_checked:true, source_outcome:deleted|fulfilled, source_evidence: direct provider result verifying deletion or fulfillment of the specific obligation. Never infer from search absence, auth failure, read/archive or merely sent replies. Linked tasks are protected. Use clarify only after checking the original source of an open task missing from scan results. Complete via kanban_user_action action complete with exact user evidence; never infer completion from missing or unread/read messages.'},
  {name:'floassist_status',tier:'R0',family:'read',purpose:'Read this owner’s FloAssist preferences, linked COO channel and policy summary. No input required.'},
  {name:'floassist_reminder_list',tier:'R0',family:'read',purpose:'List this owner’s FloAssist reminders including delivery status. No input required.'},
  {name:'floassist_reminder_create',tier:'R1',family:'write_internal',purpose:'Create a personal WhatsApp reminder. Body: {request_key: stable unique string, text, due_at: future ISO datetime with timezone offset, repeat_minutes?: integer >=60}. Retries must reuse the same request_key.'},
  {name:'floassist_reminder_cancel',tier:'R1',family:'write_internal',purpose:'Cancel this owner’s pending FloAssist reminder. Body: {id}.'},
  {name:'floassist_control',tier:'R1',family:'write_internal',purpose:'Explicit user request to pause, stop or resume FloAssist. Body: {status: paused|stopped|active}. Pause suspends proactive checks/reminders; stop also disables a FloAssist-created WhatsApp channel. Does not change policy.'},
];
export function seedFloAssistTools(agentId){
  const db=getDb();ensureActionPolicyTables();seedKanbanToolsIfMissing();
  const insert=db.prepare(`INSERT OR IGNORE INTO content_tools_meta(name,display_name,endpoint,method,purpose,model_used,enabled,is_builtin,risk_tier,action_family) VALUES (?,?,?,'POST',?,'',1,1,?,?)`);
  for(const t of FLOASSIST_TOOLS){
    insert.run(t.name,t.name.replaceAll('_',' '),'/api/tools/'+t.name.replaceAll('_','-'),t.purpose,t.tier,t.family);
    db.prepare('INSERT OR IGNORE INTO agent_tool_grants(agent_id,tool_name) VALUES (?,?)').run(agentId,t.name);
  }
  // Completion uses the existing human-identity/evidence-checked Kanban path.
  if(db.prepare('SELECT 1 FROM content_tools_meta WHERE name=?').get('kanban_user_action'))
    db.prepare('INSERT OR IGNORE INTO agent_tool_grants(agent_id,tool_name) VALUES (?,?)').run(agentId,'kanban_user_action');
  writeOpenClawToolsList();syncAllowlistsFile();
}
