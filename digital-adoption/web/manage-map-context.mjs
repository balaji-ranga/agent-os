export function mapContextEditor(document,{path,call,selectedWebsite,run,onUpdated,download}){
 const details=document.createElement('details'),summary=document.createElement('summary');summary.textContent='Edit page, form & field descriptions';details.append(summary);
 let loaded=false;
 details.ontoggle=()=>{if(!details.open||loaded)return;loaded=true;run(async()=>{
  const website=selectedWebsite();let state;try{state=await call('source-map-screen',{id:website,path});}catch(error){loaded=false;throw error;}const form=document.createElement('form'),intro=document.createElement('p'),entityLabel=document.createElement('label'),select=document.createElement('select'),textLabel=document.createElement('label'),textarea=document.createElement('textarea'),consentLabel=document.createElement('label'),consent=document.createElement('input'),save=document.createElement('button'),exportButton=document.createElement('button');
  intro.textContent=state.policy+' These descriptions reach the LLM when relevant, but do not authorize actions. Explain purpose, meanings, allowed values and dependencies.';
  const entities=[{kind:'page',id:'',label:`Page: ${path}`,value:state.screen},...state.screen.forms.map(value=>({kind:'form',id:value.id,label:`Form: ${value.label}`,value})),...state.screen.fields.map(value=>({kind:'field',id:value.key,label:`Field: ${value.label} (${value.key})`,value}))];
  for(const [index,entity]of entities.entries()){const option=document.createElement('option');option.value=String(index);option.textContent=entity.label;select.append(option);}
  select.setAttribute('aria-label','Describe');entityLabel.append('Describe',select);textarea.rows=5;textarea.maxLength=1500;textLabel.append('Description for copilot guidance',textarea);const choose=()=>{textarea.value=entities[Number(select.value)].value.description||'';consent.checked=false;};select.onchange=choose;choose();
  consent.type='checkbox';consent.required=true;consent.style.width='auto';consentLabel.append(consent,' I reviewed this shared guidance for the selected website and content scope.');
  save.type='submit';save.textContent='Save description';exportButton.type='button';exportButton.textContent='Download this page JSON';exportButton.onclick=()=>run(async()=>download((await call('source-map-export',{id:website,path})).manifest,'website-map-page.json'));
  form.append(intro,entityLabel,textLabel,consentLabel,save,exportButton);details.append(form);
  form.onsubmit=event=>{event.preventDefault();if(!consent.checked||save.disabled)return;const selected=entities[Number(select.value)];const promise=(async()=>{save.disabled=true;try{await call('source-map-context',{id:website,path,revision:state.revision,target:{kind:selected.kind,...(selected.id?{id:selected.id}:{})},description:textarea.value,reviewed:true});await onUpdated();}finally{save.disabled=false;}})();run(()=>promise);};
 });};
 return details;
}
