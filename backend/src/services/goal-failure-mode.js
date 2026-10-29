// This is an execution preference, never an authorization or input override.
export function promptRequestsPartialGoal(prompt = '') {
 const text=String(prompt).toLowerCase();
 if (/(?<!do not )(?<!don't )(?<!never )\b(?:stop|halt|abort)\b.{0,50}\b(?:on|after|if)\b.{0,30}\b(?:any|a|one|first)\b.{0,20}\b(?:step\s+)?fail(?:s|ure)?\b/.test(text) || /\b(?:do not|don't|never)\s+(?:continue|proceed)\b.{0,70}\bfail/.test(text)) return false;
 return /\b(?:allow|enable|use)\s+(?:a\s+)?partial\s+(?:goal|success)\b/.test(text)
  || /\bpartial[ _]goal\s*[:=]\s*(?:true|enabled|yes)\b/.test(text)
  || /\b(?:continue|proceed|carry on)\b[^.!?\n]{0,100}\b(?:even if|despite|regardless|irrespective)\b[^.!?\n]{0,80}\bfail(?:s|ed|ure|ures)?\b/.test(text)
  || /\b(?:continue|proceed)\b[^.!?\n]{0,60}\b(?:after|on)\s+(?:a|any|one|individual)\s+step\s+fail(?:s|ure)?\b/.test(text)
  || /\b(?:do not|don't)\s+(?:halt|stop|abort)\b[^.!?\n]{0,80}\b(?:step\s+)?fail(?:s|ure)?\b/.test(text);
}
export function resolvePartialGoal(value, prompt = '', context = {}) {
 if (value !== undefined && typeof value !== 'boolean') throw Object.assign(new Error('partial_goal must be a boolean'),{status:400});
 if (value !== undefined) return value;
 if (typeof context?.partial_goal === 'boolean') return context.partial_goal;
 return promptRequestsPartialGoal(prompt);
}
export function partialGoalEnabled(goal) {
 let context=goal?.context;
 if (!context) {try {context=JSON.parse(goal?.context_json||'{}');} catch {context={};}}
 return resolvePartialGoal(undefined,goal?.prompt,context);
}
