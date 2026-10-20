// Grounded read-only location using fresh fields and task-scoped rendered targets.
import {guidanceWords,locating,contentLookup,contextualReference,barePointing} from '../web/guidance-intent.mjs';
export function fieldGuidance(text,snapshot,history=[]){
 if(!locating(text)||contentLookup(text))return null;
 if(contextualReference(text)&&(!barePointing(text)||snapshot.recentActivity?.prepared?.length||snapshot.recentActivity?.applied?.length||snapshot.recentActivity?.unavailableApplied||snapshot.recentActivity?.unavailablePrepared))return null;
 // Content lookup stays with maker/checker; literal field location retains its read-only fast path.
 if(/\b(?:button|link|tab|menu)\b/i.test(text)&&!/\b(?:field|input|box|control|card|result)\b/i.test(text))return snapshot.targets?.length||snapshot.links?.length?null:{message:'I cannot identify that control in the current observation. Open the relevant screen or tell me its visible label.',actions:[]};
 let tokens=guidanceWords(text);
 if(!tokens.length){const previous=[...history].reverse().find(turn=>turn.role==='user'&&turn.text!==text&&guidanceWords(turn.text).length);if(previous)tokens=guidanceWords(previous.text);}
 if(!tokens.length)return {message:'Which field or result should I point to? Tell me its name or the text you see.',actions:[]};
 const candidates=snapshot.fields;
 const ranked=candidates.map(item=>{const title=new Set(guidanceWords([item.label,item.key].filter(Boolean).join(' '))),body=new Set(guidanceWords(item.text||''));return {item,score:[...new Set(tokens)].reduce((n,token)=>n+(title.has(token)?3:body.has(token)?1:0),0)};}).filter(item=>item.score>0).sort((a,b)=>b.score-a.score);
 if(!ranked.length&&/^\s*where\s+can\s+i\s+find\b/i.test(text))return null;
 if(!ranked.length)return /\b(?:field|input|box|control|highlight|point)\b/i.test(text)?{message:'I could not identify that field among the supported inputs currently visible on this page. Tell me its label or open the relevant form.',actions:[]}:null;
 const best=ranked.filter(item=>item.score===ranked[0].score);
 if(best.length!==1)return {message:`Which field or result do you mean: ${best.slice(0,6).map(item=>item.item.label).join('; ')}? Nothing has changed.`,actions:[]};
 return {message:`I will point to ${best[0].item.label}. No values will change.`,actions:[{type:'highlight',ref:best[0].item.ref}]};
}
