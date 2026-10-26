const START='<!-- FLOASSIST_RUNTIME_START -->',END='<!-- FLOASSIST_RUNTIME_END -->';
export function withFloAssistRuntimeGuidance(markdown,db,owner,agent){
  const start=markdown.indexOf(START),end=markdown.indexOf(END);
  const clean=start>=0&&end>=start?markdown.slice(0,start)+markdown.slice(end+END.length):markdown;
  if(!db.prepare("SELECT 1 FROM sqlite_master WHERE name='floassist_profiles'").get())return clean;
  const p=db.prepare('SELECT agent_id,status FROM floassist_profiles WHERE owner_id=?').get(owner);
  if(!p||p.agent_id!==agent||p.status!=='active')return clean;
  return `${START}
## Mandatory FloAssist connected-source routing
For email content, file content, a task's original source, or Calendar events, prefer floassist_source_read. For the latest saved Gmail draft pass app_id gmail and kind draft; this uses one bounded hydrated draft read. For latest mail pass only app_id gmail/outlook; for a task pass only task_id; for a file copy its source_id from discovery. The server obtains real IDs and executes the bounded read sequence. Calendar reads require explicit time_min/time_max. Follow next_offset until null before claiming a full review. Unsupported media is not a failed connection and cannot supply a deadline. Use generic discovery only for operations the source reader does not support.
For this owner's WhatsApp personal-assistant requests, use floassist_status for selected apps and timezone. When an operation is not supported by floassist_source_read, first call connector_search_actions scoped to the selected app and requested operation, then connector_get_action_guide, then connector_execute_action with the exact returned action ID and schema. Never invent action names, try spelling variants, or treat an invalid action as a permission denial. Generic email/productivity tools and CRM notes are separate data sources, not substitutes for these connected apps. Do not delegate a simple connected-source read.
For task questions, read kanban_get_task.floassist_source or the exact floassist_tracking_list record. Its app_id/source_id are authoritative. A Drive file is not email or a calendar event. Retrieve the exact source before describing its contents; the authenticated owner may request their source content. Privacy guidance forbids retaining raw bodies in memory, not authorized reads. Bound large reads and report actual missing scope/content/errors, not a generic system constraint.
A thread listing or snippet is not a full email-body read. Obtain a real thread ID from the owner's current listing, then retrieve that thread's content before claiming to have read it. Never substitute a task ID, Drive file ID, placeholder or guessed value. File metadata and media files do not establish a dated obligation. A failed tool result is a failed read; never report it as successful.
After an invalid action, use its returned discovery suggestions or call discovery again, then read the guide. Do not repeat a failed guessed action. After one corrected attempt fails, report the precise unresolved blocker. Existing grants, owner isolation and action policies remain mandatory.
${END}\n${clean.trimStart()}`;
}
