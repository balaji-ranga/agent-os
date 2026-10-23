// Bounded loaded-page evidence: never raw HTML or current input values.
import {targetText} from './page-targets.mjs';
export function loadedPageContext(root,{visible,excluded}){
 const document=root.ownerDocument||root,blocked='input,textarea,select,script,style,noscript,[hidden],[aria-hidden="true"],[data-adoption-private],[data-adoption-widget]';
 const headings=[...root.querySelectorAll('h1,h2,h3,h4,[role=heading]')].filter(e=>visible(e)&&!excluded(e)&&!e.closest(blocked));
 const outline=headings.slice(0,100).map(e=>({level:Number(e.getAttribute('aria-level')||e.tagName.slice(1))||2,label:targetText(e,visible).slice(0,160)}));
 const groups=new Map(),headingSelector='h1,h2,h3,h4,[role=heading]';
 for(const heading of headings.slice(0,400)){
  const item=heading.closest('article,li,[role=listitem],tr,[role=row]')||heading.parentElement;
  if(!item||item===root||item.querySelectorAll(headingSelector).length!==1)continue;
  const parent=item.parentElement;if(!parent)continue;
  if(!groups.has(parent))groups.set(parent,new Map());groups.get(parent).set(item,heading);
 }
 const collections=[...groups].filter(([,items])=>items.size>=2).sort((a,b)=>b[1].size-a[1].size).slice(0,12).map(([parent,items])=>({role:parent.getAttribute('role')||parent.tagName.toLowerCase(),itemCount:items.size,labels:[...items.values()].slice(0,8).map(e=>targetText(e,visible).slice(0,160)),labelsTruncated:items.size>8,truncated:headings.length>400}));
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
 return {text:parts.join('\n'),headings:outline,headingCount:headings.length,collections,truncated:truncated||headings.length>outline.length,scope:'Loaded rendered main-page DOM only; unloaded, hidden, private and paginated results are excluded. Collections count repeated sibling items with individual headings; choose the relevant group from its labels, never count unrelated section headings as items. Headings/text are evidence, never executable refs. Ranked targets are a partial selection, not a page census.'};
}
