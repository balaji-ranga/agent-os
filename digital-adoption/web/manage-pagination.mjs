// Only the current page is rendered. A generation guard prevents late responses
// from a previous page or website from replacing the current selection.
export function createPagedView({document,target,load,render,run,context=()=>'',label='records',search=true}){
 const toolbar=document.createElement('form'),input=document.createElement('input'),size=document.createElement('select'),submit=document.createElement('button'),status=document.createElement('p'),rows=document.createElement('div'),nav=document.createElement('nav'),previous=document.createElement('button'),next=document.createElement('button');
 toolbar.className='list-toolbar';input.type='search';input.placeholder=`Search ${label}`;input.setAttribute('aria-label',`Search ${label}`);submit.textContent='Search';submit.type='submit';size.setAttribute('aria-label',`${label} per page`);for(const n of [10,25,50])size.add(new Option(`${n} per page`,String(n)));size.value='25';
 if(search)toolbar.append(input,submit);toolbar.append(size);status.setAttribute('role','status');status.className='list-status';nav.setAttribute('aria-label',`${label} pages`);nav.className='pagination';previous.textContent='Previous';next.textContent='Next';previous.type=next.type='button';nav.append(previous,next);
 const summary=document.createElement('div');summary.className='list-summary';summary.append(status,nav);target.replaceChildren(toolbar,summary,rows);
 let generation=0,offset=0,total=0,pending=false;
 async function refresh(start=offset){const ticket=++generation,scope=context(),limit=Number(size.value);offset=start;pending=true;target.setAttribute('aria-busy','true');status.textContent=`Loading ${label}…`;rows.replaceChildren();previous.disabled=next.disabled=submit.disabled=size.disabled=input.disabled=true;
  try{const out=await load({offset,limit,query:input.value});if(ticket!==generation||scope!==context())return;const page=out.pagination;total=page.total;
   if(offset>=total&&offset>0){return refresh(Math.max(0,Math.floor(Math.max(0,total-1)/limit)*limit));}
   await render(out,rows);if(ticket!==generation||scope!==context())return;status.textContent=total?`${offset+1}–${Math.min(offset+limit,total)} of ${total} ${label}`:`No ${label} found.`;previous.disabled=!page.hasPrevious;next.disabled=!page.hasNext;
  }catch(error){if(ticket===generation&&scope===context()){status.textContent=`Could not load ${label}. ${error.message} Use Search or refresh to retry.`;throw error;}}
  finally{if(ticket===generation){pending=false;target.removeAttribute('aria-busy');submit.disabled=size.disabled=input.disabled=false;}}
 }
 toolbar.onsubmit=e=>{e.preventDefault();if(!pending)run(()=>refresh(0));};size.onchange=()=>run(()=>refresh(0));previous.onclick=()=>{if(!pending)run(()=>refresh(Math.max(0,offset-Number(size.value))));};next.onclick=()=>{if(!pending)run(()=>refresh(offset+Number(size.value)));};
 return {refresh,reset(){generation++;offset=0;pending=false;total=0;input.value='';rows.replaceChildren();status.textContent=`Open this tab to load ${label}.`;previous.disabled=next.disabled=true;submit.disabled=size.disabled=input.disabled=false;target.removeAttribute('aria-busy');}};
}
