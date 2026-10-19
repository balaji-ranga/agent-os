// Grounded read-only field pointing. No site vocabulary, values or selectors.
// This uses the same scoped proposal/consume path as model-authored highlights;
// it is not an LLM inference and cannot fill, navigate or submit anything.
const words=text=>String(text).toLowerCase().match(/[\p{L}\p{N}]+/gu)||[];
const noise=new Set('where is are can i find show me the a an please field fields input inputs box control controls on this page point to highlight locate at do does it go set change update fill enter and'.split(' '));
const location=/^\s*(?:please\s+)?(?:where\s+(?:is|are|can\s+i\s+find)\b|show\s+(?:me\s+)?(?:where\b|(?:the\s+)?[^.!?]+\b(?:field|input|box|control)s?\b)|(?:highlight|locate|point\s+(?:me\s+)?to)\b)/i;
export function fieldGuidance(text,snapshot,history=[]){
 if(!location.test(String(text)))return null;
 if(/\b(?:button|link|tab|menu)\b/i.test(text)&&!/\b(?:field|input|box|control)\b/i.test(text))return {message:'I can point to supported form fields here. Which input do you mean? Buttons, links and menus are not field targets.',actions:[]};
 let tokens=words(text).filter(word=>!noise.has(word));
 if(!tokens.length){
  const previous=[...history].reverse().find(turn=>turn.role==='user'&&turn.text!==text&&words(turn.text).some(word=>!noise.has(word)));
  if(previous)tokens=words(previous.text).filter(word=>!noise.has(word));
 }
 if(!tokens.length)return {message:'Which field should I point to? Tell me its name or the text shown in the input.',actions:[]};
 const ranked=snapshot.fields.map(field=>{const names=new Set(words([field.label,field.key].filter(Boolean).join(' ')));return {field,score:[...new Set(tokens)].filter(token=>names.has(token)).length};}).filter(item=>item.score>0).sort((a,b)=>b.score-a.score);
 if(!ranked.length)return /\b(?:field|input|box|control|highlight|point)\b/i.test(text)?{message:'I could not identify that field among the supported inputs currently visible on this page. Tell me the label or placeholder you see, or open the relevant form.',actions:[]}:null;
 const best=ranked.filter(item=>item.score===ranked[0].score);
 if(best.length!==1)return {message:`Which field do you mean: ${best.slice(0,6).map(item=>item.field.label).join('; ')}? Nothing has changed.`,actions:[]};
 return {message:`I will point to ${best[0].field.label}. No values will change.`,actions:[{type:'highlight',ref:best[0].field.ref}]};
}
