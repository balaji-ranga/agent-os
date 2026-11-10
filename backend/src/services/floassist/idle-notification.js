import {isIdleHeartbeatReply} from '../../../../openclaw-extensions/agent-os-content-tools/heartbeat-silence.js';

// Proactive FloAssist delivery only. Require every line to be known empty-result
// boilerplate; mixed findings, provider failures and explicit user replies must
// never be discarded merely because they contain "no conflicts".
export function isIdleFloAssistNotification(value) {
  const text=String(value||'');
  if(isIdleHeartbeatReply({text:text.replace(/\bno new (tasks?|items?|updates?|alerts?)\b/gi,'no $1')}))return true;
  if(text.length>1200)return false;
  const lines=text.replace(/[*`]/g,'').split(/[\n.!?]+/).map(s=>s.replace(/^\s*[-•]\s*/,'').replace(/[\p{Extended_Pictographic}\uFE0F]/gu,'').trim()).filter(Boolean);
  const empty=/^(?:there (?:are|were) )?no (?:new )?(?:calendar |scheduling )?(?:conflicts|overlaps)(?: (?:were )?(?:found|detected|identified))?(?: (?:across|in) (?:your|the|all(?: your)?) calendars)?$/i;
  const decoration=/^(?:(?:FloAssist\s*[·:]\s*)?Calendar Conflicts(?: Check)?|When:\s*(?:As of today|Today|Checked on \d{1,2} [A-Za-z]+ \d{4})|Next action:\s*(?:Monitor for updates|No action (?:is )?(?:needed|required)))$/i;
  return lines.some(s=>empty.test(s))&&lines.every(s=>empty.test(s)||decoration.test(s));
}
