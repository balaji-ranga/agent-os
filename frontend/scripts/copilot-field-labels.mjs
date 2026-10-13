// Source-only labels. Never infer a field's purpose from its current value.
const attr=(node,key)=>node?.attributes?.find(a=>a.type==='JSXAttribute'&&a.name.name===key)?.value;
const literal=v=>v?.type==='StringLiteral'?v.value:v?.type==='JSXExpressionContainer'&&v.expression?.type==='StringLiteral'?v.expression.value:null;
const text=node=>(node?.children||[]).filter(n=>n.type==='JSXText').map(n=>n.value.trim()).filter(Boolean).join(' ').replace(/\s+/g,' ').slice(0,180);
export function sourceFieldLabel(node,ancestors){
  const explicit=literal(attr(node,'aria-label'));
  if(explicit)return explicit;
  for(const ancestor of [...ancestors].reverse()){
    if(ancestor.type!=='JSXElement')continue;
    const opening=ancestor.openingElement,tag=opening?.name?.name;
    if(tag==='label'&&text(ancestor))return text(ancestor);
    // Field/FormField are form wrappers, not arbitrary page headings.
    if(['Field','FormField'].includes(tag)){
      const label=literal(attr(opening,'label'));
      if(label)return label;
    }
  }
  return literal(attr(node,'placeholder'))||literal(attr(node,'name'))||'Unlabelled or dynamically labelled control';
}
