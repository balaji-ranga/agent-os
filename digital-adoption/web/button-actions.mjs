// Session-local button identities. Highlight refs never confer click authority.
import {targetText} from './page-targets.mjs';
export function createButtonActions(document,{visible,excluded,observe,onActivate=()=>{}}){
 let revision=0,records=new Map();
 const name=e=>(e.getAttribute('aria-label')||targetText(e,visible)).trim().replace(/\s+/g,' ').slice(0,160);
 const context=e=>{const item=e.closest('article,li,[role=listitem],tr,[role=row]'),heading=item?.querySelector('h1,h2,h3,h4,[role=heading]');return heading&&visible(heading)&&!excluded(heading)?targetText(heading,visible).slice(0,160):'';};
 const eligible=e=>e.matches('button,[role=button]')&&!e.matches('a[href],input')&&!(e.form&&e.type==='submit')&&!e.closest('a[href]')&&visible(e)&&!excluded(e)&&e.getAttribute('aria-disabled')!=='true'&&!e.closest('[inert],[aria-busy=true]');
 const state=e=>JSON.stringify([name(e),context(e),[...e.attributes].filter(a=>!['style','class'].includes(a.name)).map(a=>[a.name,a.value]),e.type,e.form?.id||'',document.location.pathname]);
 return {
  snapshot(nextRevision){revision=nextRevision;records=new Map();return [...document.querySelectorAll('button,[role=button]')].filter(eligible).slice(0,24).flatMap(e=>{const label=name(e);if(!label)return [];const ref=`r${revision}a${records.size}`;records.set(ref,{element:e,label,state:state(e)});return [{ref,label,...(context(e)?{context:context(e)}:{})}];});},
  async activate({ref,expectedRevision,approved,active=()=>true,observationMs=5000}){
   const record=records.get(ref),e=record?.element;
   if(!approved||revision!==expectedRevision||!e?.isConnected||!eligible(e)||state(e)!==record.state)throw new Error('Button changed; inspect and review its activation again');
   if(!active())throw new Error('Button activation cancelled before dispatch');
   const before=observe();records.delete(ref);onActivate(e);e.click();
   // A click is not success. Observe bounded public UI state, never field values.
   let changed,last,stable=0;
   const limit=Math.min(10000,Math.max(1000,observationMs));
   for(let elapsed=0;elapsed<limit;elapsed+=100){
    if(!active())return {activated:true,dispatched:true,reason:'Observation stopped after activation; inspect the host before another action.'};
    const current=observe();if(current!==before){changed=true;stable=current===last?stable+1:0;if(stable>=2)return {activated:true,uiChanged:true,businessVerified:false};}last=current;
    await new Promise(resolve=>setTimeout(resolve,100));
   }
   return {activated:true,dispatched:true,uiChanged:false,businessVerified:false,reason:changed?'The website did not settle after activation. Inspect its current state; no retry was made.':'No public UI change was observed after activation. Inspect the website; no retry was made.'};
  }
 };
}
