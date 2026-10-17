// Conservative fallback after a bounded model recheck. Labels come only from
// the fresh form; values must occur literally in a unique labelled source line.
// This produces a review, never a browser effect or a website field catalog.
const label=value=>String(value).normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu,' ').trim();
export function labelledTaskReview(observed,evidence){
 const actions=[],missing=[],conflicts=[];
 for(const field of observed.fields){
  const name=label(field.label);if(!name||observed.fields.filter(f=>label(f.label)===name).length!==1){conflicts.push(field.label);continue;}
  const values=new Map();for(const source of evidence||[])for(const line of String(source.text).split(/[\r\n]+/)){const colon=line.indexOf(':');if(colon<0||label(line.slice(0,colon))!==name)continue;const value=line.slice(colon+1).trim();if(value&&value.length<=8000)values.set(value.normalize('NFKC').toLowerCase(),value);}
  if(values.size>1){conflicts.push(field.label);continue;}const value=[...values.values()][0];
  if(!value){if(field.required)missing.push(field.label);continue;}
  if(field.type==='checkbox'&&!['true','false'].includes(value)){missing.push(field.label);continue;}
  actions.push({type:'fill',ref:field.ref,value});
 }
 if(conflicts.length||missing.length)return {message:`Clarify ${[...new Set([...conflicts,...missing])].join(', ')}: the task evidence is missing, conflicting or ambiguous. Nothing was changed.`,actions:[]};
 return actions.length?{message:'Review these values extracted from uniquely labelled transaction passages. Nothing was changed.',actions}:null;
}
