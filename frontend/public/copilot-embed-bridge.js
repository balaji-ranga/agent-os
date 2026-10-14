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
  let preparedForm=null;
  let creationObservation=null;
  const isRich=el=>el.getAttribute('contenteditable')==='true'&&el.getAttribute('role')==='textbox';
  // Layout-measurement clones can have rectangles while visibility is hidden.
  // They are not observed controls and must never make an action ambiguous.
  const visible=el=>!!el.getClientRects().length&&!el.closest?.('[hidden],[inert],[aria-hidden="true"]')&&(!el.ownerDocument?.defaultView||!['hidden','collapse'].includes(el.ownerDocument.defaultView.getComputedStyle(el).visibility));
  const clear=()=>{if(highlighted){highlighted.style.outline=highlighted.dataset.flolahPriorOutline||'';delete highlighted.dataset.flolahPriorOutline;highlighted=null;}};
  const allowed={has:key=>typeof key==='string'&&key.length>0&&key.length<=100&&/^[a-z][a-z0-9 ._-]*$/.test(key)&&!/password|secret|token|credential|permission|grant|mfa|otp|payment|credit.?card|bank|budget|authority|retention|delete|purge|\bscript\b|javascript|webhook|callback|api.?key|owner|\brole\b|access|account|\bcode\b/.test(key)};
  const amountOpeners=()=>/^\/object\/opportunity\/[\w-]+$/.test(location.pathname)?[...document.querySelectorAll('[id^="fields-"][id$="-amount"]')].filter(el=>el.getClientRects().length):[];
  const settle=()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
  const activate=el=>{
    // Mouse-down lets the host close a previous inline editor before click.
    if(typeof el.dispatchEvent==='function'&&typeof MouseEvent==='function'){
      const rect=el.getBoundingClientRect?.();
      const point=rect?{clientX:rect.left+rect.width/2,clientY:rect.top+rect.height/2}:{};
      el.dispatchEvent(new MouseEvent('mouseover',{bubbles:true,cancelable:true,button:0,...point}));
      el.dispatchEvent(new MouseEvent('mousemove',{bubbles:true,cancelable:true,button:0,...point}));
      el.dispatchEvent(new MouseEvent('mousedown',{bubbles:true,cancelable:true,button:0,buttons:1,...point}));
      el.dispatchEvent(new MouseEvent('mouseup',{bubbles:true,cancelable:true,button:0,buttons:0,...point}));
    }
    el.click();
  };
  const awaitEditor=async check=>{for(let i=0;i<24&&!check();i++)await new Promise(resolve=>setTimeout(resolve,50));};
  // A compound currency editor is identified by its actual numeric input and
  // associated picker, not by any arbitrary three-letter button on the page.
  const currencyButton=()=>{
    if(amountOpeners().length!==1)return null;
    const inputs=[...document.querySelectorAll('input[placeholder="Currency"]')].filter(el=>el.getClientRects().length);
    if(inputs.length!==1)return null;
    return inputs[0].parentElement?.parentElement?.querySelector('[role="button"][aria-controls="currency-picker-dropdown-id-options"]')||null;
  };
  const currencyOptions=()=>[...document.querySelectorAll('[role="option"]')].filter(el=>el.getClientRects().length&&el.getAttribute('aria-disabled')!=='true').flatMap(element=>{
    const code=/\(([A-Z]{3})\)\s*$/.exec(String(element.textContent||''))?.[1];
    return code?[{element,value:code}]:[];
  });
  async function currencyBinding(){
    const button=currencyButton();if(!button)return null;
    const wasOpen=button.getAttribute('aria-expanded')==='true';
    if(!wasOpen){activate(button);await settle();}
    const options=currencyOptions().map(o=>({value:o.value}));
    if(!wasOpen&&button.getAttribute('aria-expanded')==='true'){activate(button);await settle();}
    if(!options.length)return null;
    return {kind:'currency',element:button,value:String(button.textContent||'').trim(),options};
  }
  const label=el=>{
    const raw=String(el.getAttribute('data-fieldname')||el.getAttribute('aria-label')||[...(el.labels||[])].map(l=>l.textContent).join(' ')||el.getAttribute('placeholder')||(isRich(el)?'rich text':'')).trim().toLowerCase().replaceAll('_',' ');
    // Twenty's opportunity numeric editor is labelled Currency; the adjacent
    // currency selector is separate. Never treat an arbitrary Currency box as amount.
    return raw==='currency'&&amountOpeners().length===1?'amount':raw;
  };
  const navigations=()=>[...document.querySelectorAll('a[href]')].filter(el=>el.tagName==='A'&&visible(el)).flatMap(el=>{
    try{const u=new URL(el.getAttribute('href'),location.href),path=u.pathname+u.search+u.hash;
      const safe=/^\/(?:objects\/[a-z][a-z0-9-]*|object\/[a-z][a-z0-9-]*\/[a-zA-Z0-9-]+)(?:\?viewId=[a-zA-Z0-9-]+)?$/.test(path)||(/^\/object\/[a-z][a-z0-9-]*\/[a-zA-Z0-9-]+#[a-f0-9-]{36}$/i.test(path))||(/^\/app(?:\/[a-z][a-z0-9-]*)?$/.test(path)&&!/(user|role|permission|setting|payment|bank|credential|token|oauth|integration)/i.test(path));
      return u.origin===location.origin&&safe?[{element:el,path,label:String(el.textContent||'').trim().slice(0,100)}]:[];
    }catch{return [];}
  });
  const newForms=()=>{const current=navigations().filter(n=>n.path===location.pathname+(location.search||''));
    const words=text=>String(text).toLowerCase().match(/[a-z]+/g)?.map(w=>w.endsWith('ies')?w.slice(0,-3)+'y':w.endsWith('s')?w.slice(0,-1):w)||[];
    const buttons=[...document.querySelectorAll('button')].filter(el=>el.tagName==='BUTTON'&&!el.disabled&&visible(el)).flatMap(element=>{
    const text=String(element.getAttribute('aria-label')||element.textContent||'').trim(),match=/^(?:Create new|Add|New) (?:an? )?([A-Za-z][A-Za-z ]*?)(?:\s*\.{3}|\s*…)?$/i.exec(text);
    const resourceMatches=current.length!==1||words(current[0].label).every(w=>words(match?.[1]||'').includes(w));
    return match&&resourceMatches&&allowed.has(match[1].toLowerCase())&&!/invoice|journal|order|stock|transaction|fiscal|company setup|\bchat\b/i.test(match[1])?[{element,label:text}]:[];
  });
    if(buttons.length||!/^\/objects\/[a-z][a-z0-9-]*$/.test(location.pathname))return buttons;
    // Compact record lists expose an Add New row instead of a labelled button.
    // Derive its resource from the observed current navigation link, not a model URL.
    if(current.length!==1||!allowed.has(current[0].label.toLowerCase())||/invoice|journal|order|stock|transaction|fiscal|company setup/i.test(current[0].label))return [];
    return [...document.querySelectorAll('span')].filter(el=>visible(el)&&String(el.textContent||'').trim()==='Add New').flatMap(element=>{
      const row=element.parentElement?.parentElement;
      return row?.querySelector('.record-table-column-drag-and-drop')&&row.querySelector('.tabler-icon-plus')?[{element,label:'Add New '+current[0].label}]:[];
    });
  };
  const sensitive=el=>/password|secret|token|credential|permission|grant|mfa|otp|payment|credit.?card|bank|budget|authority|retention|delete|purge|\bscript\b|javascript|webhook|callback|api.?key|owner|\brole\b|access|account|\bcode\b/i.test([el.getAttribute('data-fieldname'),el.getAttribute('aria-label'),el.getAttribute('placeholder'),...[...(el.labels||[])].map(l=>l.textContent)].filter(Boolean).join(' '));
  const fields=()=>[...new Set([...document.querySelectorAll('input,textarea,select'),...document.querySelectorAll('[contenteditable="true"][role="textbox"]')])].filter(el=>!el.disabled&&!el.readOnly&&!el.hidden&&el.getAttribute('aria-readonly')!=='true'&&visible(el)&&!['password','hidden','file','submit','button','checkbox','radio'].includes(el.type)&&allowed.has(label(el))&&!sensitive(el));
  const fieldValue=el=>isRich(el)?el.textContent:el.value;
  const nameOpener=()=>/^\/object\/(company|person|opportunity|task)\/[\w-]+$/.test(location.pathname)?[...document.querySelectorAll('[data-testid="top-bar-title"]')].filter(el=>el.getClientRects().length):[];
  async function openFields(requested){
    if(requested.some(k=>k==='amount'||k==='currency')&&!fields().some(el=>label(el)==='amount')){
      const candidates=amountOpeners();
      if(candidates.length===1){const target=candidates[0].firstElementChild?.firstElementChild;
        // The empty-value text can be replaced during hover. Activate the
        // stable clickable cell container, not that transient text leaf.
        if(target){
          // Let hover/mouse-down React updates commit before clicking. Otherwise
          // a placeholder can detach or the host's previous-editor effect can
          // close the new input in the same batch.
          if(typeof MouseEvent==='function'){
            for(const type of ['mouseover','mousedown','mouseup'])target.dispatchEvent(new MouseEvent(type,{bubbles:true,cancelable:true,button:0}));
            await settle();
          }
          const current=amountOpeners();
          if(current.length===1){
            const hovered=current[0].querySelector?.('.s1wuwqh8 > .s8fyxo');
            (hovered||current[0].firstElementChild?.firstElementChild)?.click();
          }
          await settle();await awaitEditor(()=>fields().some(el=>label(el)==='amount'));
        }
      }
    }
    if(requested.includes('name')&&!fields().some(el=>label(el)==='name')){
      const openers=nameOpener();
      if(openers.length===1){
        // The editable title lives inside the layout wrapper. Clicking the
        // wrapper does not dispatch through the child's React click handler.
        const target=openers[0].querySelector('[data-testid="tooltip"], .sx6ymsm, .s1gcxrdc')||openers[0];
        // Close the previous inline editor before opening the title. React can
        // otherwise process its outside-click cleanup after the new title opens.
        if(typeof target.dispatchEvent==='function'&&typeof MouseEvent==='function'){
          for(const type of ['mousedown','mouseup'])target.dispatchEvent(new MouseEvent(type,{bubbles:true,cancelable:true,button:0}));
          await settle();
        }
        const current=nameOpener();
        if(current.length===1)(current[0].querySelector('[data-testid="tooltip"], .sx6ymsm, .s1gcxrdc')||current[0]).click();
        await settle();
        // Some inline hosts consume the first click to dismiss an editor's
        // document-level click-away handler. Re-observe before one safe editor
        // opening retry; never replay a create, submit or value write.
        if(!fields().some(el=>label(el)==='name')){
          const retry=nameOpener();
          if(retry.length===1)(retry[0].querySelector('[data-testid="tooltip"], .sx6ymsm, .s1gcxrdc')||retry[0]).click();
          await settle();
        }
        await awaitEditor(()=>fields().some(el=>label(el)==='name'));
      }
    }
  }
  async function binding(key){
    await openFields([key]);
    if(key==='currency')return currencyBinding();
    const matches=fields().filter(el=>label(el)===key);
    return matches.length===1?{element:matches[0],value:fieldValue(matches[0]),...(isRich(matches[0])?{kind:'rich_text'}:{})}:null;
  }
  function validBinding(key,value,current,prior){
    const el=current?.element;
    if(!prior||!allowed.has(key)||!el?.isConnected||el.disabled||!visible(el)||current.value!==prior.value||typeof value!=='string'||value.length>2000)return false;
    if(current.kind==='currency')return prior.kind==='currency'&&current.options.some(o=>o.value===value)&&prior.options.some(o=>o.value===value);
    if(el.readOnly||sensitive(el))return false;
    if(current.kind==='rich_text')return prior.kind==='rich_text'&&typeof document.execCommand==='function';
    if(key==='amount'&&value!==''&&!/^(?:0|[1-9]\d{0,11})(?:\.\d{1,2})?$/.test(value))return false;
    if(el.maxLength>=0&&value.length>el.maxLength)return false;
    if(el.tagName==='SELECT'&&![...el.options].some(o=>o.value===value&&!o.disabled))return false;
    const probe=el.cloneNode(true);probe.value=value;return probe.checkValidity();
  }
  window.addEventListener('message',async event=>{
    if(event.origin!==parentOrigin||event.source!==window.parent||event.data?.type!=='flolah-copilot-guide'||typeof event.data.request!=='string'||event.data.request.length>100)return;
    const {command,field,request}=event.data;
    let result={ok:false};
    if(command==='prepare_open_form'){
      const matches=newForms().filter(item=>item.label===event.data.label);
      if(matches.length===1){preparedForm={snapshot:crypto.randomUUID(),element:matches[0].element,label:matches[0].label,path:location.pathname,expires:Date.now()+60000};result={ok:true,snapshot:preparedForm.snapshot,immediate_save:true};}
    }
    if(command==='open_form'){
      const p=preparedForm;preparedForm=null;
      if(p&&p.snapshot===event.data.snapshot&&p.label===event.data.label&&p.path===location.pathname&&p.expires>Date.now()&&newForms().some(f=>f.element===p.element&&f.label===p.label)){
        creationObservation={fields:new Set(fields()),panels:new Set([...document.querySelectorAll('[role="dialog"],[role="complementary"],aside')].filter(visible)),expires:Date.now()+60000};
        p.element.click();
        // Twenty opens the newly created record in a side panel. Follow its
        // observed Open control (navigation only), never click New twice.
        if(/^\/objects\//.test(p.path))for(let attempt=0;attempt<30;attempt++){
          await settle();
          const open=[...document.querySelectorAll('[role="complementary"] button,aside button')].filter(el=>el.getClientRects().length&&!el.disabled&&/^Open\s*\.\.\.\s*Ctrl/.test(String(el.textContent||'').trim()));
          if(open.length===1){open[0].click();await settle();break;}
        }
        result={ok:true,creation_requested:true};
      }else result={ok:false,reason:'review_required'};
    }
    if(command==='navigate'){
      const matches=navigations().filter(n=>n.path===event.data.path);
      if(matches.length===1){prepared=null;preparedForm=null;clear();const link=matches[0].element;const requested=new URL(event.data.path,location.href).pathname;result={ok:true,navigation_requested:true};setTimeout(async()=>{
        // SPA links may route on mouse-down and deliberately suppress click.
        // Activate only this observed link, once; never retry via a page reload.
        activate(link);
        // Record links can open a preview panel without changing the route.
        // Expand only the panel whose rendered field IDs prove it is the
        // requested record; never expand a stale, unrelated preview.
        const record=/^\/object\/[^/]+\/([a-zA-Z0-9-]+)$/.exec(requested)?.[1];
        if(record)for(let attempt=0;attempt<30&&location.pathname!==requested;attempt++){
          await settle();
          const panels=[...document.querySelectorAll('[role="complementary"],aside')].filter(panel=>visible(panel)&&[...panel.querySelectorAll('[id]')].some(el=>el.id.startsWith('label-'+record+'-')));
          const open=panels.flatMap(panel=>[...panel.querySelectorAll('button')].filter(el=>visible(el)&&!el.disabled&&/^Open\s*\.\.\.\s*Ctrl/.test(String(el.textContent||'').trim())));
          if(open.length===1){activate(open[0]);break;}
        }
      },50);}
      else result={ok:false,reason:'screen_changed'};
    }
    if(command==='fill'){
      const reason=!prepared||event.data.snapshot!==prepared.snapshot?'review_required':prepared.path!==location.pathname?'screen_changed':prepared.expires<=Date.now()?'review_expired':'fields_changed';
      result={ok:false,reason};
    }
    if(command==='prepare'){
      const entries={};for(const el of fields()){const key=label(el);if(Object.hasOwn(entries,key))entries[key]=null;else entries[key]={element:el,value:fieldValue(el),...(isRich(el)?{kind:'rich_text'}:{})};}
      // Inline editors can replace one another. Capture each requested field's
      // private baseline independently instead of requiring all to remain open.
      for(const key of (Array.isArray(event.data.fields)?event.data.fields:[]).filter(key=>allowed.has(key)))entries[key]=await binding(key);
      const snapshot=crypto.randomUUID();prepared={snapshot,entries,expires:Date.now()+60000,path:location.pathname};
      const fieldLabels=Object.fromEntries(Object.entries(entries).filter(([,entry])=>entry).map(([key,{element}])=>[key,key==='amount'?'Amount':key==='currency'?'Currency':String(element.getAttribute('placeholder')||element.getAttribute('aria-label')||key).slice(0,120)]));
      result={ok:true,snapshot,fields:Object.keys(entries).filter(k=>entries[k]),field_labels:fieldLabels,mode:'review',immediate_save:true};
    }
    if(command==='fill'&&prepared&&event.data.snapshot===prepared.snapshot&&prepared.expires>Date.now()&&prepared.path===location.pathname){
      const values=event.data.values,entries=values&&typeof values==='object'&&!Array.isArray(values)?Object.entries(values):[];
      const original=prepared;
      let valid=entries.length>0&&entries.length<=10;
      for(const [key,value] of entries){if(!valid)break;const current=await binding(key);valid=prepared===original&&original.path===location.pathname&&original.expires>Date.now()&&validBinding(key,value,current,original.entries[key]);}
      if(valid){
        const batch=prepared;prepared=null;
        const applied=[];
        for(const [key,value] of entries){
          const current=await binding(key),el=current?.element;
          if(batch.path!==location.pathname||batch.expires<=Date.now()||!validBinding(key,value,current,batch.entries[key]))break;
          if(current.kind==='currency'){
            if(current.value!==value){activate(el);await settle();const matches=currencyOptions().filter(o=>o.value===value);if(matches.length!==1)break;activate(matches[0].element);await settle();if(String(currencyButton()?.textContent||'').trim()!==value)break;}
            const numeric=fields().find(input=>label(input)==='amount');
            if(numeric){numeric.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',code:'Enter',bubbles:true,cancelable:true}));numeric.dispatchEvent(new KeyboardEvent('keyup',{key:'Enter',code:'Enter',bubbles:true,cancelable:true}));await settle();}
            applied.push(key);continue;
          }
          el.focus({preventScroll:true});
          if(current.kind==='rich_text'){
            // Use the editing transaction so controlled rich-text editors can
            // update their model. Never set innerHTML or inject stored markup.
            const selection=el.ownerDocument.getSelection(),range=el.ownerDocument.createRange();
            range.selectNodeContents(el);selection.removeAllRanges();selection.addRange(range);
            if(!el.ownerDocument.execCommand('insertText',false,value))break;
            await settle();el.blur();
            if(String(el.textContent).replace(/\r\n/g,'\n')!==value.replace(/\r\n/g,'\n'))break;
            applied.push(key);continue;
          }
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
          applied.push(key);
        }
        for(const key of applied)delete batch.entries[key];
        const remaining=Object.keys(batch.entries).filter(key=>batch.entries[key]);
        if(remaining.length){batch.snapshot=crypto.randomUUID();prepared=batch;}
        result={ok:applied.length===entries.length,reason:applied.length===entries.length?undefined:'fields_changed',applied,next_snapshot:prepared?.snapshot||null,persistence:'Verify in the application; edits may save immediately.'};
      }
    }
    if(command==='inspect'){
      const visible=fields();
      const fieldLabels=Object.fromEntries(visible.map(el=>[label(el),String(el.getAttribute('placeholder')||el.getAttribute('aria-label')||label(el)).slice(0,120)]));
      if(nameOpener().length===1)fieldLabels.name='Name';
      if(amountOpeners().length===1){fieldLabels.amount='Amount (numeric forecast value)';fieldLabels.currency='Currency (ISO currency selected in the amount editor)';}
      const createdFormReady=!!creationObservation&&creationObservation.expires>Date.now()&&visible.some(el=>{const panel=el.closest?.('[role="dialog"],[role="complementary"],aside');return panel&&!creationObservation.panels.has(panel)&&!creationObservation.fields.has(el);});
      result={ok:true,path:location.pathname+(location.search||'')+(location.hash||''),created_form_ready:createdFormReady,fields:[...new Set([...visible.map(label),...(nameOpener().length===1?['name']:[]),...(amountOpeners().length===1?['amount','currency']:[])])],field_labels:fieldLabels,navigation:navigations().map(({path,label})=>({path,label})),forms:newForms().map(f=>f.label),mode:'guided',reason:'Embedded edits may save immediately; review proposed values before applying.'};
    }
    if(command==='clear'){clear();prepared=null;preparedForm=null;result={ok:true};}
    if(command==='focus'&&allowed.has(field)){
      clear();const matches=fields().filter(el=>label(el)===field);
      if(matches.length===1){highlighted=matches[0];highlighted.dataset.flolahPriorOutline=highlighted.style.outline;highlighted.style.outline='3px solid #7654e8';highlighted.scrollIntoView({block:'center'});highlighted.focus({preventScroll:true});result={ok:true};}
    }
    window.parent.postMessage({type:'flolah-copilot-guide-result',request,...result},parentOrigin);
  });
})();
