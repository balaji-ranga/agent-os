// Suggestions are draft content, never permission to execute or invent facts.
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
