/** Return provenance only after the caller has authorized the owner task. */
export function floAssistTaskSource(db, owner, taskId) {
  if (!owner || !db.prepare("SELECT 1 FROM sqlite_master WHERE name='floassist_task_tracking'").get()) return null;
  const row = db.prepare('SELECT app_id,account_id,source_id,source_url,obligation_key,origin,state FROM floassist_task_tracking WHERE owner_id=? AND task_id=?').get(owner, taskId);
  if (!row) return null;
  const provider = {google_drive:'googledrive',google_calendar:'googlecalendar',onedrive:'one_drive'}[row.app_id] || row.app_id;
  return {...row, provider, retrieval_instruction:'This is the authoritative source identity. Discover the read action with connector_search_actions for this provider, read its guide, then retrieve this exact source through the owner connection. Do not substitute email, calendar, CRM, conversation memory or a similar title. If the source cannot be read, report the exact tool error; do not invent its contents or attribution.'};
}
