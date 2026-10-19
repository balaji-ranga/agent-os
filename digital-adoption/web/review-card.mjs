// Current values are browser-local review metadata. They never enter a model
// request, shared map, recipe, analytics event or saved proposal.
export function appendProposedAction(document,container,proposal,action,{prepend=false}={}){
 const card=document.createElement('article');card.dataset.proposedValue='true';
 const title=document.createElement('h3');title.textContent=action.type==='navigate'?`Open ${action.label} (${action.path||''})`:action.type==='highlight'?`Show ${action.label}`:`${action.label}: ${action.displayValue||action.value}`;card.append(title);
 const current=proposal.localReview?.find(field=>field.ref===action.ref);
 if(action.type==='fill'&&current){const comparison=document.createElement('div');comparison.className='field-comparison';for(const [label,text]of [['Current · browser-local',current.changed?'Changed since inspection; prepare a fresh review':current.display||'Not set'],['Proposed',action.displayValue||action.value||'Clear this field']]){const column=document.createElement('div'),heading=document.createElement('small'),value=document.createElement('p');heading.textContent=label;value.textContent=text;column.append(heading,value);comparison.append(column);}card.append(comparison);if(current.matches){const note=document.createElement('small');note.textContent='Already matches on this page. Verification will not dispatch a duplicate change.';card.append(note);}}
 if(prepend)container.prepend(card);else container.append(card);return card;
}
