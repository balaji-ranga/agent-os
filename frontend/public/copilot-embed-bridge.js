/* Embedded CRM guidance bridge. No cookies, tokens, records or network APIs are
 * read. The parent origin and exact parent window are checked on every message.
 * Field filling uses an expiring, local snapshot and explicit parent review.
 * It never clicks, submits forms or invokes provider APIs. CRM can auto-save. */
(()=>{
  'use strict';
  const parentOrigin='https://login.flolah.cloud';
  if(window.parent===window)return;
  let highlighted=null;
  let prepared=null;
  const clear=()=>{if(highlighted){highlighted.style.outline=highlighted.dataset.flolahPriorOutline||'';delete highlighted.dataset.flolahPriorOutline;highlighted=null;}};
  const allowed=new Set(['name','domain name','first name','last name','email','phone','description','subject','customer name','item name']);
  const label=el=>String(el.getAttribute('aria-label')||el.getAttribute('placeholder')||[...(el.labels||[])].map(l=>l.textContent).join(' ')||'').trim().toLowerCase();
  const fields=()=>[...document.querySelectorAll('input,textarea,select')].filter(el=>!el.disabled&&!el.hidden&&el.getClientRects().length&&!['password','hidden','file','submit','button'].includes(el.type)&&allowed.has(label(el)));
  window.addEventListener('message',event=>{
    if(event.origin!==parentOrigin||event.source!==window.parent||event.data?.type!=='flolah-copilot-guide'||typeof event.data.request!=='string'||event.data.request.length>100)return;
    const {command,field,request}=event.data;
    let result={ok:false};
    if(command==='prepare'){
      const entries={};for(const el of fields()){const key=label(el);if(Object.hasOwn(entries,key))entries[key]=null;else entries[key]={element:el,value:el.value};}
      const snapshot=crypto.randomUUID();prepared={snapshot,entries,expires:Date.now()+60000,path:location.pathname};
      result={ok:true,snapshot,fields:Object.keys(entries).filter(k=>entries[k]),mode:'review',immediate_save:true};
    }
    if(command==='fill'&&prepared&&event.data.snapshot===prepared.snapshot&&prepared.expires>Date.now()&&prepared.path===location.pathname){
      const values=event.data.values,entries=values&&typeof values==='object'&&!Array.isArray(values)?Object.entries(values):[];
      const valid=entries.length>0&&entries.length<=10&&entries.every(([key,value])=>{
        const current=prepared.entries[key],el=current?.element;
        if(!allowed.has(key)||!el?.isConnected||el.disabled||el.readOnly||!el.getClientRects().length||el.value!==current.value||typeof value!=='string'||value.length>2000)return false;
        if(el.maxLength>=0&&value.length>el.maxLength)return false;
        if(el.tagName==='SELECT'&&![...el.options].some(o=>o.value===value&&!o.disabled))return false;
        const probe=el.cloneNode(true);probe.value=value;return probe.checkValidity();
      });
      if(valid){
        const batch=prepared;prepared=null;
        for(const [key,value] of entries){const el=batch.entries[key].element;
          const proto=el.tagName==='TEXTAREA'?HTMLTextAreaElement.prototype:el.tagName==='SELECT'?HTMLSelectElement.prototype:HTMLInputElement.prototype;
          Object.getOwnPropertyDescriptor(proto,'value').set.call(el,value);
          el.dispatchEvent(new Event('input',{bubbles:true}));el.dispatchEvent(new Event('change',{bubbles:true}));el.blur();
        }
        for(const [key] of entries)delete batch.entries[key];
        const remaining=Object.keys(batch.entries).filter(key=>batch.entries[key]);
        if(remaining.length){batch.snapshot=crypto.randomUUID();prepared=batch;}
        result={ok:true,applied:entries.map(([key])=>key),next_snapshot:prepared?.snapshot||null,persistence:'Verify in the application; edits may save immediately.'};
      }
    }
    if(command==='inspect')result={ok:true,fields:[...new Set(fields().map(label))],mode:'guided',reason:'Embedded edits may save immediately; review proposed values before applying.'};
    if(command==='clear'){clear();prepared=null;result={ok:true};}
    if(command==='focus'&&allowed.has(field)){
      clear();const matches=fields().filter(el=>label(el)===field);
      if(matches.length===1){highlighted=matches[0];highlighted.dataset.flolahPriorOutline=highlighted.style.outline;highlighted.style.outline='3px solid #7654e8';highlighted.scrollIntoView({block:'center'});highlighted.focus({preventScroll:true});result={ok:true};}
    }
    window.parent.postMessage({type:'flolah-copilot-guide-result',request,...result},parentOrigin);
  });
})();
