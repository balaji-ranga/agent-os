/* Embedded CRM guidance bridge. No cookies, tokens, records or network APIs are
 * read. The parent origin and exact parent window are checked on every message.
 * Field filling uses an expiring, local snapshot and explicit parent review.
 * Only reviewed recipes may open an existing inline field editor. It never
 * submits forms or invokes provider APIs. CRM can auto-save. */
(()=>{
  'use strict';
  const parentOrigin='https://login.flolah.cloud';
  if(window.parent===window)return;
  let highlighted=null;
  let prepared=null;
  const clear=()=>{if(highlighted){highlighted.style.outline=highlighted.dataset.flolahPriorOutline||'';delete highlighted.dataset.flolahPriorOutline;highlighted=null;}};
  const allowed={has:key=>typeof key==='string'&&key.length>0&&key.length<=100&&/^[a-z][a-z0-9 ._-]*$/.test(key)&&!/password|secret|token|credential|permission|grant|mfa|otp|payment|credit.?card|bank|budget|authority|retention|delete|purge|\bscript\b|javascript|webhook|callback|api.?key|owner|\brole\b|access|account|\bcode\b/.test(key)};
  const amountOpeners=()=>/^\/object\/opportunity\/[\w-]+$/.test(location.pathname)?[...document.querySelectorAll('[id^="fields-"][id$="-amount"]')].filter(el=>el.getClientRects().length):[];
  const label=el=>{
    const raw=String(el.getAttribute('data-fieldname')||el.getAttribute('aria-label')||[...(el.labels||[])].map(l=>l.textContent).join(' ')||el.getAttribute('placeholder')||'').trim().toLowerCase().replaceAll('_',' ');
    // Twenty's opportunity numeric editor is labelled Currency; the adjacent
    // currency selector is separate. Never treat an arbitrary Currency box as amount.
    return raw==='currency'&&amountOpeners().length===1?'amount':raw;
  };
  const navigations=()=>[...document.querySelectorAll('a[href]')].filter(el=>el.tagName==='A'&&el.getClientRects().length).flatMap(el=>{
    try{const u=new URL(el.getAttribute('href'),location.href),path=u.pathname+u.search;
      const safe=/^\/objects\/[a-z][a-z0-9-]*(?:\?viewId=[a-zA-Z0-9-]+)?$/.test(path)||(/^\/app\/[a-z][a-z0-9-]*$/.test(path)&&!/(user|role|permission|setting|payment|bank|credential|token|oauth|integration)/i.test(path));
      return u.origin===location.origin&&safe?[{element:el,path,label:String(el.textContent||'').trim().slice(0,100)}]:[];
    }catch{return [];}
  });
  const fields=()=>[...document.querySelectorAll('input,textarea,select')].filter(el=>!el.disabled&&!el.readOnly&&!el.hidden&&el.getClientRects().length&&!['password','hidden','file','submit','button','checkbox','radio'].includes(el.type)&&allowed.has(label(el)));
  const nameOpener=()=>/^\/object\/(company|person|opportunity|task)\/[\w-]+$/.test(location.pathname)?[...document.querySelectorAll('[data-testid="top-bar-title"]')].filter(el=>el.getClientRects().length):[];
  async function openFields(requested){
    if(requested.includes('amount')&&!fields().some(el=>label(el)==='amount')){
      const candidates=amountOpeners();
      if(candidates.length===1){const target=candidates[0].firstElementChild?.firstElementChild;
        if(target){target.click();target.dispatchEvent(new MouseEvent('dblclick',{bubbles:true,cancelable:true}));await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));}
      }
    }
    if(requested.includes('name')&&!fields().some(el=>label(el)==='name')){
      const openers=nameOpener();
      if(openers.length===1){
        // The editable title lives inside the layout wrapper. Clicking the
        // wrapper does not dispatch through the child's React click handler.
        const target=openers[0].querySelector('[data-testid="tooltip"]')||openers[0];
        target.click();await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
      }
    }
  }
  window.addEventListener('message',async event=>{
    if(event.origin!==parentOrigin||event.source!==window.parent||event.data?.type!=='flolah-copilot-guide'||typeof event.data.request!=='string'||event.data.request.length>100)return;
    const {command,field,request}=event.data;
    let result={ok:false};
    if(command==='navigate'){
      const matches=navigations().filter(n=>n.path===event.data.path);
      if(matches.length===1){prepared=null;clear();matches[0].element.click();result={ok:true};}
      else result={ok:false,reason:'screen_changed'};
    }
    if(command==='fill'){
      const reason=!prepared||event.data.snapshot!==prepared.snapshot?'review_required':prepared.path!==location.pathname?'screen_changed':prepared.expires<=Date.now()?'review_expired':'fields_changed';
      result={ok:false,reason};
    }
    if(command==='prepare'){
      await openFields(Array.isArray(event.data.fields)?event.data.fields.filter(key=>allowed.has(key)):[]);
      const entries={};for(const el of fields()){const key=label(el);if(Object.hasOwn(entries,key))entries[key]=null;else entries[key]={element:el,value:el.value};}
      const snapshot=crypto.randomUUID();prepared={snapshot,entries,expires:Date.now()+60000,path:location.pathname};
      const fieldLabels=Object.fromEntries(Object.entries(entries).filter(([,entry])=>entry).map(([key,{element}])=>[key,String(element.getAttribute('placeholder')||element.getAttribute('aria-label')||key).slice(0,120)]));
      result={ok:true,snapshot,fields:Object.keys(entries).filter(k=>entries[k]),field_labels:fieldLabels,mode:'review',immediate_save:true};
    }
    if(command==='fill'&&prepared&&event.data.snapshot===prepared.snapshot&&prepared.expires>Date.now()&&prepared.path===location.pathname){
      const values=event.data.values,entries=values&&typeof values==='object'&&!Array.isArray(values)?Object.entries(values):[];
      const original=prepared;
      await openFields(entries.map(([key])=>key));
      if(prepared!==original||original.path!==location.pathname)return;
      for(const [key] of entries){
        const prior=prepared.entries[key];
        if(prior&&!prior.element.isConnected){const matches=fields().filter(el=>label(el)===key);if(matches.length===1)prior.element=matches[0];}
      }
      const valid=entries.length>0&&entries.length<=10&&entries.every(([key,value])=>{
        const current=prepared.entries[key],el=current?.element;
        if(!allowed.has(key)||!el?.isConnected||el.disabled||el.readOnly||!el.getClientRects().length||el.value!==current.value||typeof value!=='string'||value.length>2000)return false;
        if(key==='amount'&&value!==''&&!/^(?:0|[1-9]\d{0,11})(?:\.\d{1,2})?$/.test(value))return false;
        if(el.maxLength>=0&&value.length>el.maxLength)return false;
        if(el.tagName==='SELECT'&&![...el.options].some(o=>o.value===value&&!o.disabled))return false;
        const probe=el.cloneNode(true);probe.value=value;return probe.checkValidity();
      });
      if(valid){
        const batch=prepared;prepared=null;
        for(const [key,value] of entries){const el=batch.entries[key].element;
          el.focus({preventScroll:true});
          const proto=el.tagName==='TEXTAREA'?HTMLTextAreaElement.prototype:el.tagName==='SELECT'?HTMLSelectElement.prototype:HTMLInputElement.prototype;
          Object.getOwnPropertyDescriptor(proto,'value').set.call(el,value);
          el.dispatchEvent(new Event('input',{bubbles:true}));el.dispatchEvent(new Event('change',{bubbles:true}));
          // React-controlled inline editors commit their updated state on blur.
          // Let the input render before blurring, and ensure it owns focus first.
          await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
          // Twenty's record-title editor commits on Enter/click-outside, not
          // blur. Scope this recipe strictly to the reviewed title input.
          if((key==='name'&&nameOpener().length===1&&el.closest('[data-testid="top-bar-title"]'))||(key==='amount'&&amountOpeners().length===1)){
            el.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',code:'Enter',bubbles:true,cancelable:true}));
            el.dispatchEvent(new KeyboardEvent('keyup',{key:'Enter',code:'Enter',bubbles:true,cancelable:true}));
          }
          el.blur();
        }
        for(const [key] of entries)delete batch.entries[key];
        const remaining=Object.keys(batch.entries).filter(key=>batch.entries[key]);
        if(remaining.length){batch.snapshot=crypto.randomUUID();prepared=batch;}
        result={ok:true,applied:entries.map(([key])=>key),next_snapshot:prepared?.snapshot||null,persistence:'Verify in the application; edits may save immediately.'};
      }
    }
    if(command==='inspect'){
      const visible=fields();
      const fieldLabels=Object.fromEntries(visible.map(el=>[label(el),String(el.getAttribute('placeholder')||el.getAttribute('aria-label')||label(el)).slice(0,120)]));
      if(nameOpener().length===1)fieldLabels.name='Name';
      if(amountOpeners().length===1)fieldLabels.amount='Opportunity amount (existing currency unchanged)';
      result={ok:true,fields:[...new Set([...visible.map(label),...(nameOpener().length===1?['name']:[]),...(amountOpeners().length===1?['amount']:[])])],field_labels:fieldLabels,navigation:navigations().map(({path,label})=>({path,label})),mode:'guided',reason:'Embedded edits may save immediately; review proposed values before applying.'};
    }
    if(command==='clear'){clear();prepared=null;result={ok:true};}
    if(command==='focus'&&allowed.has(field)){
      clear();const matches=fields().filter(el=>label(el)===field);
      if(matches.length===1){highlighted=matches[0];highlighted.dataset.flolahPriorOutline=highlighted.style.outline;highlighted.style.outline='3px solid #7654e8';highlighted.scrollIntoView({block:'center'});highlighted.focus({preventScroll:true});result={ok:true};}
    }
    window.parent.postMessage({type:'flolah-copilot-guide-result',request,...result},parentOrigin);
  });
})();
