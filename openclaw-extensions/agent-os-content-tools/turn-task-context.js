// Recovery may replace the prompt with an internal continuation. Task-specific
// contracts must follow the trusted run identity, not that replacement text.
// This cache contains no grants: callers re-evaluate permissions each attempt.
const tasks=new Map();
const maxCachedChars=4*1024*1024;
let cachedChars=0;
function forget(key){const value=tasks.get(key);if(value)cachedChars-=value.prompt.length;tasks.delete(key);}
export function resolveTurnTaskPrompt({sessionKey,runId,prompt,now=Date.now()}){
 const text=String(prompt||'');
 if(!sessionKey||!runId)return text;
 for(const [key,value] of tasks)if(value.until<=now)forget(key);
 const previous=tasks.get(sessionKey);
 if(previous?.runId===runId)return previous.prompt;
 forget(sessionKey);
 // Never silently truncate the original task (instructions can be at its end).
 // Bound total retained text instead of shortening individual task contracts.
 if(text.length>maxCachedChars)return text;
 while(tasks.size&&(tasks.size>=5000||cachedChars+text.length>maxCachedChars))forget(tasks.keys().next().value);
 tasks.set(sessionKey,{runId,prompt:text,until:now+3600000});cachedChars+=text.length;
 return text;
}
