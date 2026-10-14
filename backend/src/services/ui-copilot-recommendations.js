// Suggestions are draft content, never permission to execute or invent facts.
// An explicit new task starts a context boundary; replies and referential
// corrections keep their task context. This never discards saved drafts/history.
export function startsIndependentCopilotTask(message){
  return /^(?:please\s+)?(?:create|open|navigate|go\s+to|configure|set\s+up|prepare)\b/i.test(message.trim())&&!/\b(?:it|this|that|same|previous|above|earlier|again|continue)\b/i.test(message);
}

export const COPILOT_RECOMMENDATION_POLICY = `
Act as a helpful form-preparation copilot, not a blank questionnaire. Map every
relevant fact already supplied in the latest request, selected reply, conversation
and reviewed draft into the authorized form. Preserve explicit values and corrections.
For a requested setup, propose a partial fill even when another required choice is
missing. Ask only for the missing choice; do not restart the interview.
You may recommend a concise title, summary or descriptive prompt derived from the
user's intent. Clearly identify recommended values and explain their derivation in
the message so the user can correct them during review. Distinguish user-provided,
derived and recommended values. Do not present recommendations as retrieved facts.
Use human-readable labels in your message; internal identifiers belong only in action fields.
The current screen is location context, not the user's requested destination.
First match the user's intended task to the authorized catalog form and its purpose.
Use that registered form even when it is on another screen. Do not substitute a
similarly named control on the current screen. Use current-screen DOM fields only
when they implement the requested task and no registered form is a better match.
If the task belongs to an authorized screen but its form is not currently visible,
return a navigate action to that screen first, or an embed_navigate to an observed
link inside it. The browser executes navigation and returns fresh metadata for the
same request. Do not invent a draft form ID and do not replace navigation with a
promise or a question asking the user to navigate. Opening is not filling or saving.
Explicitly supplied amounts and currencies are known input, NOT guesses. Carry
them forward unchanged through navigation and the separate creation review.
Never guess account IDs, recipients, amounts, currencies, dates/times, credentials,
permissions or existing business facts. Resolve agents only from the entitled catalog;
ask if the requested role is ambiguous. Only propose schema-valid, available fields.
Infer descriptive fields from the requested purpose, and map explicitly supplied
frequency, source and assignee to the corresponding authorized fields. Ask for
missing required operational choices without discarding known values. A fill proposal opens its
registered form for review; the user need not navigate there first.
User approval applies only to the reviewed changes, not inferred follow-on actions.
`;

// Form-agnostic coverage checks complement schema validation. They never fill
// values themselves or authorize a save. Ambiguous/negated choices stay with
// the user rather than becoming a guessed default.
export function copilotIntentOmissions(proposal,catalog,message){
  const omissions=[];
  const creating=/\bcreate\s+(?:a\s+|an\s+)?(?:new\s+)?/i.test(message)&&!(/\b(?:do not|don't|never)\s+create\b/i.test(message));
  for(const action of proposal.actions||[]){
    if(action.type!=='fill')continue;
    const fields=catalog.forms[action.form]?.fields||{};
    for(const [key,field] of Object.entries(fields)){
      if(creating&&field.required_for_creation&&!(String(action.values[key]??'').trim()))omissions.push(`${action.form}.${key}: required draft content is missing; derive from the user's intent or ask if genuinely unknown`);
      if(!Array.isArray(field.enum)||/\b(?:not|don't|never|instead|rather|or)\b/i.test(message))continue;
      const found=field.enum.filter(value=>typeof value==='string'&&new RegExp(`\\b${value.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')}\\b`,'i').test(message));
      if(found.length===1&&action.values[key]!==found[0])omissions.push(`${action.form}.${key}: retain explicitly supplied choice ${found[0]}`);
    }
  }
  return omissions;
}

export function retainExplicitCopilotChoices(proposal,catalog,message){
  if(/\b(?:not|don't|never|instead|rather|or)\b/i.test(message))return proposal;
  return {...proposal,actions:proposal.actions.map(action=>{
    if(action.type!=='fill')return action;
    const values={...action.values};
    for(const [key,field] of Object.entries(catalog.forms[action.form]?.fields||{})){
      if(values[key]!==undefined||!Array.isArray(field.enum))continue;
      const supplied=field.enum.filter(value=>typeof value==='string'&&new RegExp(`\\b${value.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')}\\b`,'i').test(message));
      if(supplied.length===1)values[key]=supplied[0];
    }
    return {...action,values};
  })};
}

// A narrowly phrased single-field request must not become an edit to a nearby
// control with a similar caption. This is label-driven, not provider-specific.
// Ambiguous and negated requests remain with the model/user; no value is invented.
export function explicitCopilotFieldTarget(message,labels){
  if(!/\bonly\b/i.test(message))return null;
  const mentions=Object.entries(labels).filter(([,caption])=>{
    if(!caption)return false;
    const escaped=caption.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
    const matches=[...message.matchAll(new RegExp(`\\b(?:by|set|clear|fill|field)\\s+(?:the\\s+)?${escaped}(?:\\s+(?:field|filter|to|with))?\\b`,'gi'))];
    return matches.some(match=>! /\b(?:not|never|don't|instead|rather)\s+$/i.test(message.slice(0,match.index)));
  });
  return mentions.length===1?mentions[0][0]:null;
}

// Prevent a valid but unrelated visible New control from satisfying a request
// for a different observed resource. Resource names come from DOM metadata.
const resourceWords=text=>String(text).toLowerCase().match(/[a-z]+/g)?.map(w=>w.endsWith('ies')?w.slice(0,-3)+'y':w.endsWith('s')&&!w.endsWith('ss')?w.slice(0,-1):w)||[];
export function matchingCopilotDestinations(message,navigation){
  const requested=new Set(resourceWords(message));
  return navigation.filter(n=>{const words=resourceWords(n.label);return words.length&&words.every(w=>requested.has(w));});
}
export function matchingCopilotForms(message,forms){
  return matchingCopilotDestinations(message,forms.map(label=>({label:label.replace(/^(?:Create new|Add|New) /,''),original:label}))).map(f=>f.original);
}
export function explicitCopilotIntermediate(message,navigation){
  const matches=navigation.filter(n=>{
    if(!/^\/(?:objects|app)\/[a-z][a-z0-9-]*(?:\?viewId=[a-zA-Z0-9-]+)?$/.test(n.path))return false;
    const label=String(n.label).replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
    const match=new RegExp(`\\b(?:open|go to|navigate to)\\s+((?:[a-z]+\\s+){0,4})${label}\\b`,'i').exec(message);
    if(match&&/\b(?:not|never|don't|avoid|and|then|instead)\b/i.test(match[1]))return false;
    return match&&!/\b(?:not|never|don't|avoid)\s*$/i.test(message.slice(0,match.index));
  });
  return matches.length===1?matches[0]:null;
}
export function prioritizeCopilotNavigation(message,navigation,limit=60){
  const text=String(message).toLowerCase(),requested=new Set(resourceWords(message));
  const score=n=>{
    const id=/\/object\/[^/]+\/([^?]+)/.exec(n.path)?.[1];
    if(id&&text.includes(id.toLowerCase()))return 100;
    const words=resourceWords(n.label).filter(w=>w.length>1);
    return words.length&&words.every(w=>requested.has(w))?50:0;
  };
  return navigation.map((n,index)=>({n,index,score:score(n)})).sort((a,b)=>b.score-a.score||a.index-b.index).slice(0,limit).map(x=>x.n);
}
export function copilotCreationMismatch(message,label,navigation){
  const words=resourceWords;
  const requested=new Set(words(message)),created=words(label.replace(/^(?:Create new|Add|New) /,''));
  const targets=navigation.map(n=>words(n.label)).filter(parts=>parts.length&&parts.every(w=>requested.has(w)));
  return targets.length>0&&!targets.some(parts=>parts.every(w=>created.includes(w)));
}
