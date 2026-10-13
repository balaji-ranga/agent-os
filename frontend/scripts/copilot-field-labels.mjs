// Source-only labels. Never infer a field's purpose from its current value.
const attr=(node,key)=>node?.attributes?.find(a=>a.type==='JSXAttribute'&&a.name.name===key)?.value;
const literal=v=>v?.type==='StringLiteral'?v.value:v?.type==='JSXExpressionContainer'&&v.expression?.type==='StringLiteral'?v.expression.value:null;
export const sourceLabelText=node=>(node?.children||[]).map(n=>n.type==='JSXText'?n.value.trim():n.type==='JSXElement'&&['span','strong','b','em','i','abbr'].includes(n.openingElement?.name?.name)?sourceLabelText(n):'').filter(Boolean).join(' ').replace(/\s+/g,' ').slice(0,180);
export function sourceFieldLabel(node,ancestors,linkedLabels=new Map()){
  const explicit=literal(attr(node,'aria-label'));
  if(explicit)return explicit;
  const associated=linkedLabels.get(literal(attr(node,'id')));
  if(associated)return associated;
  for(const ancestor of [...ancestors].reverse()){
    if(ancestor.type!=='JSXElement')continue;
    const opening=ancestor.openingElement,tag=opening?.name?.name;
    if(tag==='label'&&sourceLabelText(ancestor))return sourceLabelText(ancestor);
    // Field/FormField are form wrappers, not arbitrary page headings.
    if(['Field','FormField'].includes(tag)){
      const label=literal(attr(opening,'label'));
      if(label)return label;
    }
  }
  return literal(attr(node,'placeholder'))||literal(attr(node,'name'))||'Unlabelled or dynamically labelled control';
}
