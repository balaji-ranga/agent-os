import {guidanceWords} from './guidance-intent.mjs';
export function targetText(element,visible){if(element.querySelectorAll('*').length>200)return '';const copy=element.cloneNode(true),originals=[...element.querySelectorAll('*')],clones=[...copy.querySelectorAll('*')];for(let i=0;i<originals.length;i++)if(!visible(originals[i]))clones[i]?.remove();for(const node of copy.querySelectorAll('input,textarea,select,button,script,style,[hidden],[aria-hidden="true"],[data-adoption-private],[data-adoption-widget]'))node.remove();return copy.textContent.trim().replace(/\s+/g,' ').slice(0,480);}
// Read only task-relevant rendered results, not the whole DOM or form values.
export function pageTargets(document,root,{task,visible,excluded,revision}){
 if(!task)return [];
 const terms=[...new Set(guidanceWords(task))];if(!terms.length)return [];
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
 const observed=[...candidates.values()].map(item=>({...item,state:{disabled:item.element.disabled===true||item.element.getAttribute('aria-disabled')==='true',busy:!!item.element.closest('[aria-busy="true"]'),...(item.element.hasAttribute('aria-expanded')?{expanded:item.element.getAttribute('aria-expanded')==='true'}:{}),...(item.element.hasAttribute('aria-selected')?{selected:item.element.getAttribute('aria-selected')==='true'}:{})},snippet:text(item.element),titleWords:new Set(guidanceWords(item.label))}));
 const weights=new Map(terms.map(term=>[term,Math.log2(2+observed.length/(1+observed.filter(item=>item.titleWords.has(term)||guidanceWords(item.snippet).includes(term)).length))]));
 const ranked=observed.map(item=>{const body=new Set(guidanceWords(item.snippet));return {...item,score:terms.reduce((n,word)=>n+(item.titleWords.has(word)?3:body.has(word)?1:0)*weights.get(word),0)+(item.role==='option'?10:0)};}).filter(item=>item.score>0).sort((a,b)=>b.score-a.score).slice(0,24);
 // Reserve bounded live interactive context so the model can interpret synonyms
 // and singular/plural names even when lexical relevance misses a control.
 const controls=observed.filter(item=>['a','button','tab','menuitem','treeitem'].includes(item.role)&&!ranked.some(match=>match.element===item.element)).slice(0,8);
 const selected=[...ranked.slice(0,24-controls.length),...controls];
 return selected.map((item,i)=>({...item,ref:`r${revision}t${i}`}));
}
