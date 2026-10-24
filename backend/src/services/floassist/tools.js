import { getDb } from '../../db/schema.js';
import { ensureActionPolicyTables } from '../action-policy.js';
import { writeOpenClawToolsList } from '../content-tools-meta.js';
import { syncAllowlistsFile } from '../openclaw-agent-tools.js';

export const FLOASSIST_TOOLS=[
  {name:'floassist_status',tier:'R0',family:'read',purpose:'Read this owner’s FloAssist preferences, linked COO channel and policy summary. No input required.'},
  {name:'floassist_reminder_list',tier:'R0',family:'read',purpose:'List this owner’s FloAssist reminders including delivery status. No input required.'},
  {name:'floassist_reminder_create',tier:'R1',family:'write_internal',purpose:'Create a personal WhatsApp reminder. Body: {request_key: stable unique string, text, due_at: future ISO datetime with timezone offset, repeat_minutes?: integer >=60}. Retries must reuse the same request_key.'},
  {name:'floassist_reminder_cancel',tier:'R1',family:'write_internal',purpose:'Cancel this owner’s pending FloAssist reminder. Body: {id}.'},
  {name:'floassist_control',tier:'R1',family:'write_internal',purpose:'Explicit user request to pause, stop or resume FloAssist. Body: {status: paused|stopped|active}. Pause suspends proactive checks/reminders; stop also disables a FloAssist-created WhatsApp channel. Does not change policy.'},
];
export function seedFloAssistTools(agentId){
  const db=getDb();ensureActionPolicyTables();
  const insert=db.prepare(`INSERT OR IGNORE INTO content_tools_meta(name,display_name,endpoint,method,purpose,model_used,enabled,is_builtin,risk_tier,action_family) VALUES (?,?,?,'POST',?,'',1,1,?,?)`);
  for(const t of FLOASSIST_TOOLS){
    insert.run(t.name,t.name.replaceAll('_',' '),'/api/tools/'+t.name.replaceAll('_','-'),t.purpose,t.tier,t.family);
    db.prepare('INSERT OR IGNORE INTO agent_tool_grants(agent_id,tool_name) VALUES (?,?)').run(agentId,t.name);
  }
  writeOpenClawToolsList();syncAllowlistsFile();
}
