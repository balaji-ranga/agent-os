// Presentation only. Capabilities come from the SDK's authenticated service
// response; hiding a control never substitutes for server authorization.
export function mountWorkspace(document,{onMode=()=>{}}={}){
 const byId=id=>document.getElementById(id),tabs=[...document.querySelectorAll('nav [role=tab]')];
 let mode='guide',expired=false,config={};
 function updateContext(context={}){config={...config,hostContext:context};byId('context-page').textContent=context.title||context.path||'This website';byId('context-path').textContent=(context.origin||'')+(context.path||'')||'The current loaded page';}
 function select(tab){
  if(!tab||tab.hidden||tab.disabled)return;
  for(const item of tabs){const chosen=item===tab;item.setAttribute('aria-selected',String(chosen));item.tabIndex=chosen?0:-1;byId(item.getAttribute('aria-controls')).hidden=!chosen;}
  if(tab.id==='tab-guide'){delete tab.dataset.attention;if(byId('review').childElementCount)byId('review').scrollIntoView({block:'nearest'});}
 }
 function revealConversation({showChat=true}={}){if(showChat)select(byId('tab-guide'));if(byId('panel-guide').hidden)return;const last=byId('log').lastElementChild;if(last)requestAnimationFrame(()=>last.scrollIntoView({block:'nearest'}));}
 function setMode(value){
  mode=['knowledge','goal'].includes(value)?value:'guide';
  byId('chat-mode').value=mode;byId('tab-knowledge').setAttribute('aria-pressed',String(mode==='knowledge'));
  byId('message').placeholder=mode==='knowledge'?'Ask about this page, website knowledge or your task files…':'Ask a question or describe your task…';
  byId('context-source').textContent=mode==='knowledge'?'Current page, knowledge & private task files':mode==='goal'?'Goal plan · reviewed steps':'Current page & task';onMode(mode);
  byId('knowledge-status').hidden=mode!=='knowledge';byId('status').hidden=mode==='knowledge';
 }
 for(const tab of tabs){tab.onclick=()=>select(tab);tab.onkeydown=event=>{
  const visible=tabs.filter(item=>!item.hidden&&!item.disabled),index=visible.indexOf(tab);let next;
  if(event.key==='ArrowRight')next=(index+1)%visible.length;else if(event.key==='ArrowLeft')next=(index+visible.length-1)%visible.length;else if(event.key==='Home')next=0;else if(event.key==='End')next=visible.length-1;else return;
  event.preventDefault();select(visible[next]);visible[next].focus();
 };}
 byId('chat-mode').onchange=event=>{setMode(event.target.value);revealConversation();};
 byId('tab-knowledge').onclick=()=>{setMode(mode==='knowledge'?'guide':'knowledge');select(byId('tab-guide'));byId('message').focus();};
 byId('attach-private-file').onclick=()=>{select(byId('tab-tasks'));const panel=byId('private-task');if(panel)panel.open=true;byId('transaction-file')?.focus();};
 for(const button of document.querySelectorAll('[data-open-workspace]'))button.onclick=()=>select(byId('tab-'+button.dataset.openWorkspace));
 const context=byId('context-dialog');byId('context-open').onclick=()=>{
  byId('context-files').textContent=`${byId('task-files')?.children.length||0} files in the active task. End task clears access immediately; private temporary content uses ${config.privateRetentionHours||24}-hour cleanup.`;
  byId('context-connection').textContent=byId('pair-state')?.textContent||'No connection status loaded. Pairing and workflow linking are separate permissions.';context.showModal();
 };byId('context-close').onclick=()=>context.close();
 function configure(next={}){
  config=next;const policy=next.taskPolicy||{},coach=next.capabilities?.coach===true;
  byId('tab-actions').hidden=!coach;byId('tab-tasks').hidden=![policy.attachments,policy.pairing,policy.workflow].some(value=>value===true);
  byId('tab-connections').hidden=!(policy.pairing===true||policy.workflow===true);
  byId('tab-workflows').hidden=!(coach||policy.workflow===true);
  byId('owner-recipes').hidden=!coach;byId('linked-workflows').hidden=policy.workflow!==true;
  byId('attach-private-file').hidden=policy.attachments!==true;byId('attach-private-file').disabled=expired||policy.attachments!==true;
  byId('workflow-connect').hidden=policy.workflow!==true;
  byId('workspace-expand').hidden=next.presentation?.layout!=='floating';byId('appearance-width').hidden=next.presentation?.layout==='docked';
  updateContext(next.hostContext);
  byId('access-label').textContent=coach?'Owner coaching active':'Visitor session';
  const selected=tabs.find(tab=>tab.getAttribute('aria-selected')==='true');if(selected?.hidden)select(byId('tab-guide'));
 }
 const filesObserver=new MutationObserver(()=>{const count=byId('task-files')?.children.length||0;byId('context-file-count').textContent=count?` + ${count} private file${count===1?'':'s'}`:'';});
 if(byId('task-files'))filesObserver.observe(byId('task-files'),{childList:true});
 const notice=byId('action-notice');if(notice)byId('workspace-notices').prepend(notice);
 window.addEventListener('pagehide',()=>filesObserver.disconnect(),{once:true});
 setMode('guide');configure({});
 return {select,setMode,updateContext,get mode(){return mode;},configure,reviewReady(){if(byId('panel-guide').hidden)byId('tab-guide').dataset.attention='true';},expire(){expired=true;configure({});byId('access-label').textContent='Session expired';},showChat(){select(byId('tab-guide'));},revealConversation,get config(){return config;}};
}
