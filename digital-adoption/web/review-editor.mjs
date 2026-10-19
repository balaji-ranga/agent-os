export function addReviewEditor(document,container,getProposal,{revise,onRevised,onError,onEditing=()=>{}}){
 const initial=getProposal();if(!initial.actions?.length||initial.actions.some(a=>a.type!=='fill'))return;
 const edit=document.createElement('button');edit.type='button';edit.textContent='Edit values';container.append(edit);
 edit.onclick=()=>{
  if(container.querySelector('[data-review-editor]'))return;
  const proposal=getProposal(),form=document.createElement('form');form.dataset.reviewEditor='true';form.setAttribute('aria-label','Edit proposed field values');
  const controls=proposal.actions.map(action=>{
   const field=proposal.fields?.find(f=>f.ref===action.ref),row=document.createElement('label');row.textContent=action.label;
   const choice=['select-one','radio','select-multiple'].includes(field?.type)&&field.choices?.length;
   const input=document.createElement(choice?'select':field?.type==='textarea'?'textarea':'input');
   input.setAttribute('aria-label',`Proposed ${action.label}`);
   if(choice){input.multiple=field.type==='select-multiple';let selected;try{selected=JSON.parse(action.value);}catch{selected=[action.value];}for(const value of field.choices){const option=document.createElement('option');option.value=value;option.textContent=value;option.selected=input.multiple?Array.isArray(selected)&&selected.includes(value):value===action.value;input.append(option);}}
   else if(field?.type==='checkbox'){input.type='checkbox';input.checked=action.value==='true';}
   else {if(input.tagName==='INPUT')input.type=['email','url','tel','date','number'].includes(field?.type)?field.type:'text';input.value=action.value;input.maxLength=8000;}
   row.append(input);form.append(row);return {action,input,field};
  });
  const submit=document.createElement('button');submit.textContent='Review edited values';const cancel=document.createElement('button');cancel.type='button';cancel.textContent='Discard edits';cancel.onclick=()=>{form.remove();edit.hidden=false;onEditing(false);};form.append(submit,cancel);container.append(form);edit.hidden=true;onEditing(true);controls[0]?.input.focus();
  form.onsubmit=async event=>{event.preventDefault();submit.disabled=true;cancel.disabled=true;try{
   const edits=controls.map(({action,input,field})=>({ref:action.ref,value:field?.type==='checkbox'?String(input.checked):input.multiple?JSON.stringify([...input.selectedOptions].map(o=>o.value)):input.value}));
   const replacement=await revise(proposal.id,edits);onRevised(replacement);form.remove();edit.hidden=false;onEditing(false);
  }catch(error){onError(error);}finally{submit.disabled=false;cancel.disabled=false;}};
 };
}
