// Bounded loaded-page evidence: never raw HTML or current input values.
import {targetText} from './page-targets.mjs';
export function loadedPageContext(root,{visible,excluded,onCollection=()=>{},onElement=()=>{}}){
 const document=root.ownerDocument||root,blocked='input,textarea,select,[contenteditable]:not([contenteditable="false"]),script,style,noscript,[hidden],[aria-hidden="true"],[data-adoption-private],[data-adoption-widget]';
 const safe=e=>e&&!e.closest(blocked)&&!excluded(e)&&visible(e);
 const clean=e=>safe(e)?targetText(e,visible).slice(0,240):'';
 const related=(e,attribute)=>(e.getAttribute(attribute)||'').split(/\s+/).map(id=>document.getElementById(id)).filter(safe).map(clean).join(' ');
 const regionSelector='main,section,form,fieldset,nav,aside,table,[role=region],[role=dialog],[role=group],[role=search],[role=navigation],[role=tablist],[role=grid],[role=table]';
 const names=new WeakMap();const named=e=>{if(!names.has(e)){const heading=[...e.querySelectorAll('legend,caption,h1,h2,h3,h4,[role=heading]')].find(h=>safe(h)&&h.closest(regionSelector)===e&&!h.closest('article,li,[role=listitem],tr,[role=row]'));names.set(e,(related(e,'aria-labelledby')||e.getAttribute('aria-label')||clean(heading)).slice(0,160));}return names.get(e);};
 const region=e=>{let parent=e.closest(regionSelector),fallback='';while(parent){fallback||=parent.getAttribute('role')||parent.tagName.toLowerCase();const name=named(parent);if(name)return name;parent=parent.parentElement?.closest(regionSelector);}return fallback;};
 // Relationships and short text blocks, without matching business words.
 // Repeated item prose cannot crowd out the rest of the interface.
 const structure=[],seen=new Set();let structureBytes=0,structureTruncated=false;
 const add=(item,element)=>{const key=JSON.stringify(item);if(seen.has(key))return;seen.add(key);if(structure.length>=56||structureBytes+key.length>7000){structureTruncated=true;return;}structureBytes+=key.length;structure.push(item);onElement(element,item);};
 const candidates=[...root.querySelectorAll('input,textarea,select,button,a[href],[role=button],[role=tab],[role=menuitem],[role=combobox],output,[role=status],[role=alert],p,span,dt,dd,legend,caption,label')];
 const prioritized=[...candidates.filter(e=>!e.closest('article,li,[role=listitem],tr,[role=row]')),...candidates.filter(e=>e.closest('article,li,[role=listitem],tr,[role=row]'))];
 for(const e of prioritized.slice(0,1200)){
  const control=e.matches('input,textarea,select,button,a[href],[role=button],[role=tab],[role=menuitem],[role=combobox]');
  if(!visible(e)||excluded(e)||e.closest('[hidden],[aria-hidden="true"],[data-adoption-private],[data-adoption-widget],[contenteditable]:not([contenteditable="false"])'))continue;
  if(!control&&(!safe(e)||e.closest('article,li,[role=listitem],tr,[role=row]')||e.querySelector('p,span,output,[role=status],[role=alert],dt,dd,legend,caption,label')))continue;
  const label=control?(e.getAttribute('aria-label')||related(e,'aria-labelledby')||[...(e.labels||[])].map(clean).join(' ')||e.getAttribute('placeholder')||(!e.matches('input,textarea,select')?clean(e):'')||e.name||'').slice(0,160):clean(e);
  if(!label)continue;
  const description=related(e,'aria-describedby').slice(0,240);
  add({role:e.getAttribute('role')||e.tagName.toLowerCase(),label,region:region(e),...(description?{description}:{}),...(control?{disabled:e.disabled===true||e.getAttribute('aria-disabled')==='true',...(e.required?{required:true}:{}),...(e.hasAttribute('aria-expanded')?{expanded:e.getAttribute('aria-expanded')==='true'}:{}),...(e.hasAttribute('aria-current')?{current:e.getAttribute('aria-current').slice(0,20)}:{})}:{})},e);
 }
 if(candidates.length>1200)structureTruncated=true;
 const headings=[...root.querySelectorAll('h1,h2,h3,h4,[role=heading]')].filter(safe);
 const outline=headings.slice(0,100).map(e=>({level:Number(e.getAttribute('aria-level')||e.tagName.slice(1))||2,label:targetText(e,visible).slice(0,160)}));
 const groups=new Map(),headingSelector='h1,h2,h3,h4,[role=heading]';
 for(const heading of headings.slice(0,400)){
  const item=heading.closest('article,li,[role=listitem],tr,[role=row]')||heading.parentElement;
  if(!item||item===root||item.querySelectorAll(headingSelector).length!==1)continue;
  const parent=item.parentElement;if(!parent)continue;
  if(!groups.has(parent))groups.set(parent,new Map());groups.get(parent).set(item,heading);
 }
 const repeatedItems=[...root.querySelectorAll('ul>li,ol>li,tbody>tr,[role=list]>[role=listitem],[role=rowgroup]>[role=row]')];
 for(const item of repeatedItems.slice(0,400)){
  if(!safe(item))continue;const parent=item.parentElement;if(!groups.has(parent))groups.set(parent,new Map());if(!groups.get(parent).has(item))groups.get(parent).set(item,item);
 }
 const collections=[...groups].filter(([,items])=>items.size>=2).sort((a,b)=>b[1].size-a[1].size).slice(0,12).map(([parent,items])=>{const observation={role:parent.getAttribute('role')||parent.tagName.toLowerCase(),itemCount:items.size,labels:[...items.values()].slice(0,8).map(e=>targetText(e,visible).slice(0,160)),labelsTruncated:items.size>8,truncated:headings.length>400||repeatedItems.length>400};onCollection({parent,items,observation});return observation;});
 const walker=document.createTreeWalker(root,4),parts=[];let node,visited=0,length=0,truncated=false;
 const cache=new WeakMap();
 while((node=walker.nextNode())){
  if(++visited>5000){truncated=true;break;}
  const parent=node.parentElement;if(!parent)continue;
  let allowed=cache.get(parent);if(allowed===undefined){allowed=!parent.closest(blocked)&&!excluded(parent)&&visible(parent);cache.set(parent,allowed);}if(!allowed)continue;
  const text=node.textContent.trim().replace(/\s+/g,' ');if(!text)continue;
  const remaining=5000-length;if(text.length+1>remaining){if(remaining>1)parts.push(text.slice(0,remaining-1));truncated=true;break;}
  parts.push(text);length+=text.length+1;
 }
 return {text:parts.join('\n'),headings:outline,headingCount:headings.length,collections,title:String(document.title||'').slice(0,200),structure,structureTruncated,truncated:truncated||headings.length>outline.length,scope:'Loaded rendered main-page DOM only; unloaded, hidden, private and paginated results are excluded. Collections count repeated sibling items with individual headings; choose the relevant group from its labels, never count unrelated section headings as items. Headings/text are evidence, never executable refs. Ranked targets are a partial selection, not a page census.'};
}
