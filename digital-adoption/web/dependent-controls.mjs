// Structural evidence only. Current values never cross the panel/service boundary.
export function requestedField(instruction,label,labels=[]){
 const normalize=value=>String(value||'').normalize('NFKC').toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu,' ').trim(),name=normalize(label);
 if(!name)return false;let text=` ${normalize(instruction)} `;
 // A short label inside a longer observed field name does not request both
 // controls (for example Contact versus Contact email). An additional standalone
 // occurrence still counts, so real dependent-control instructions are retained.
 for(const longer of [...new Set(labels.map(normalize))].sort((a,b)=>b.length-a.length))if(longer!==name&&` ${longer} `.includes(` ${name} `))text=text.replaceAll(` ${longer} `,' ');
 return text.includes(` ${name} `);
}
export function newlyAvailableFields(before,after,instruction=''){
 const labels=[...before.fields,...after.fields].map(f=>f.label);
 const choices=field=>JSON.stringify(field.choices&&[...new Set(field.choices)].sort());
 return after.fields.filter(field=>{
  if(!requestedField(instruction,field.label,labels))return false;
  const matches=before.fields.filter(old=>old.key===field.key&&old.label===field.label&&old.form===field.form&&old.type===field.type);
  return matches.length===0||matches.length===1&&choices(matches[0])!==choices(field);
 });
}
