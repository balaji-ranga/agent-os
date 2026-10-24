import {guidanceWords} from './guidance-intent.mjs';
export function targetText(element,visible){if(element.querySelectorAll('*').length>200)return '';const copy=element.cloneNode(true),originals=[...element.querySelectorAll('*')],clones=[...copy.querySelectorAll('*')];for(let i=0;i<originals.length;i++)if(!visible(originals[i]))clones[i]?.remove();for(const node of copy.querySelectorAll('input,textarea,select,button,[contenteditable]:not([contenteditable="false"]),script,style,[hidden],[aria-hidden="true"],[data-adoption-private],[data-adoption-widget]'))node.remove();return copy.textContent.trim().replace(/\s+/g,' ').slice(0,480);}
// Read only task-relevant rendered results, not the whole DOM or form values.
export function pageTargets(document,root,{task,visible,excluded,revision,collections=[]}){
 if(!task)return [];
 const terms=[...new Set(guidanceWords(task))];
 const text=element=>targetText(element,visible);
 const candidates=new Map();
 for(const heading of [...root.querySelectorAll('h1,h2,h3,h4,[role=heading]')].slice(0,400)){
  if(!visible(heading)||excluded(heading))continue;
  const parent=heading.parentElement;let container=heading.closest('article,li,[role=listitem],tr,[role=row]')||(parent&&parent.querySelectorAll('h1,h2,h3,h4,[role=heading]').length===1?parent:heading);
  if(container.querySelectorAll('*').length>200)container=heading;
  if(excluded(container)||!visible(container))continue;
  const title=text(heading).slice(0,160);if(title)candidates.set(container,{element:container,label:title,kind:'content',role:container.getAttribute('role')||container.tagName.toLowerCase()});
 }
 for(const element of [...root.querySelectorAll('article,[role=listitem],[role=option],tr,[role=row],[role=region],[role=group],[role=tab],[role=menuitem],[role=treeitem],section[aria-label],a[href],button,[role=button]')].slice(0,400)){
  if(!visible(element)||excluded(element)||candidates.has(element))continue;
  const title=(element.getAttribute('aria-label')||text(element)).slice(0,160);if(title)candidates.set(element,{element,label:title,kind:'content',role:element.getAttribute('role')||element.tagName.toLowerCase()});
 }
 for(const element of [...root.querySelectorAll('p,output,[role=status],[role=alert],dt,dd,legend,caption,span')].slice(0,400)){
  if(!visible(element)||excluded(element)||candidates.has(element)||element.closest('input,textarea,select,[contenteditable]:not([contenteditable="false"]),[hidden],[aria-hidden=true]')||element.querySelector('p,output,[role=status],[role=alert],dt,dd,legend,caption,span'))continue;
  const title=text(element).slice(0,160);if(title)candidates.set(element,{element,label:title,kind:'content',role:element.getAttribute('role')||element.tagName.toLowerCase(),ambient:!element.closest('article,li,[role=listitem],tr,[role=row],a,button')});
 }
 for(const group of collections){
  const {parent,items,observation}=group;if(!visible(parent)||excluded(parent))continue;
  const children=[...parent.children],members=[...items].map(([item,heading])=>({item,heading,text:text(heading)})),summary=`Loaded collection: ${observation.itemCount} items. Sample: ${observation.labels.slice(0,2).join('; ')}`;
  candidates.set(parent,{element:parent,label:summary.slice(0,160),kind:'content',role:observation.role,snippet:summary.slice(0,480),collection:group,verify:()=>parent.isConnected&&parent.children.length===children.length&&children.every((child,i)=>parent.children[i]===child)&&members.every(m=>m.item.parentElement===parent&&visible(m.item)&&!excluded(m.item)&&text(m.heading)===m.text)});
 }
 const observed=[...candidates.values()].map(item=>({...item,state:{disabled:item.element.disabled===true||item.element.getAttribute('aria-disabled')==='true',busy:!!item.element.closest('[aria-busy="true"]'),...(item.element.hasAttribute('aria-expanded')?{expanded:item.element.getAttribute('aria-expanded')==='true'}:{}),...(item.element.hasAttribute('aria-selected')?{selected:item.element.getAttribute('aria-selected')==='true'}:{})},snippet:item.snippet??text(item.element),titleWords:new Set(guidanceWords(item.label))}));
 const weights=new Map(terms.map(term=>[term,Math.log2(2+observed.length/(1+observed.filter(item=>item.titleWords.has(term)||guidanceWords(item.snippet).includes(term)).length))]));
 const ranked=observed.map(item=>{const body=new Set(guidanceWords(item.snippet));return {...item,score:terms.reduce((n,word)=>n+(item.titleWords.has(word)?3:body.has(word)?1:0)*weights.get(word),0)+(item.role==='option'?10:0)};}).filter(item=>item.score>0).sort((a,b)=>b.score-a.score).slice(0,24);
 // Reserve bounded live interactive context so the model can interpret synonyms
 // and singular/plural names even when lexical relevance misses a control.
 const controlLabels=new Set(),controls=observed.filter(item=>{const key=item.role+':'+item.label;if(!['a','button','tab','menuitem','treeitem'].includes(item.role)||controlLabels.has(key))return false;controlLabels.add(key);return true;}).slice(0,8);
 const ambient=[...observed.filter(item=>item.ambient).slice(0,3),...observed.filter(item=>item.collection).slice(0,1)];
 const reserved=[...ambient,...controls],selected=[...ranked.slice(0,24-reserved.length)];
 for(const item of [...reserved,...ranked,...observed.filter(item=>item.ambient)])if(selected.length<24&&!selected.some(s=>s.element===item.element))selected.push(item);
 return selected.map((item,i)=>({...item,ref:`r${revision}t${i}`}));
}
