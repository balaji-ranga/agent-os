import {createPointerOverlay} from './pointer-overlay.mjs';
import {pageTargets,targetText} from './page-targets.mjs';
import {loadedPageContext} from './page-context.mjs';
import {waitForHost} from './host-observation.mjs';
import {requestedField} from './dependent-controls.mjs';
import {choiceText,requestsChoice} from './choice-intent.mjs';
// Session-local references: never persist selectors or entered values as shared learning.
import {createSubmitController} from './form-submit.mjs';
import {semanticFieldKey} from './semantic.mjs';
import {activateNavigation} from './activation.mjs';
export function createInspector(document) {
  let revision = 0;
  let references = new Map();
  let navigation = new Map();
  const pointer=createPointerOverlay(document);const cleanupHighlight=()=>pointer.clear();
  let preparedFields=[],appliedFields=[];
  const identity=record=>({element:record.element,label:record.label,type:record.type,rowIdentity:record.rowIdentity,form:record.element.form,path:document.location.pathname});
  const current=record=>record.path===document.location.pathname&&record.element.isConnected&&record.form===record.element.form&&!excluded(record.element)&&visible(record.element)&&record.label===label(record.element)&&record.type===controlType(record.element)&&record.rowIdentity===rowIdentity(record.element);
  function rememberReview(actions,expectedRevision){if(expectedRevision!==revision)return;const records=actions.filter(a=>a.type==='fill').map(a=>references.get(a.ref)).filter(Boolean);if(records.length)preparedFields=records.slice(0,10).map(identity);}
  function recentActivity(fields){const resolve=records=>records.flatMap(record=>{if(!current(record))return [];const field=fields.find(f=>references.get(f.ref)?.element===record.element);return field?[field.ref]:[];});const prepared=resolve(preparedFields),applied=resolve(appliedFields);return {prepared,applied,unavailablePrepared:preparedFields.length-prepared.length,unavailableApplied:appliedFields.length-applied.length};}
  const excluded = e => e.closest('[data-adoption-private], [data-adoption-widget]') ||
    /password|hidden|file/.test(e.type || '') || /password|token|secret|otp|credit.?card|cvv|api.?key|access.?key|private.?key/i.test(`${e.name} ${e.id} ${e.autocomplete}`);
  const rendered = e => !e.hidden && e.getClientRects().length>0 && document.defaultView.getComputedStyle(e).visibility!=='hidden';
  const visible = e => !e.disabled && !e.hidden && e.getClientRects().length > 0 &&
    document.defaultView.getComputedStyle(e).visibility !== 'hidden';
  const controlType=e=>e.getAttribute('role')==='combobox'&&e.getAttribute('aria-controls')?'combobox':e.type||e.tagName.toLowerCase();
  const constraints=e=>JSON.stringify(['min','max','step','pattern','required','maxlength','minlength','multiple'].map(name=>e.getAttribute(name)));
  const supported = e => ['text','number','email','date','textarea','url','tel','search','select-one','select-multiple','radio','checkbox'].includes(e.type||e.tagName.toLowerCase());
  // Wrapping labels may contain SELECT options or textarea content. Those are
  // control data, not the accessible field name, and must remain local.
  const labelText = l => {
    if (!l.cloneNode) return l.textContent;
    const copy = l.cloneNode(true);
    for (const control of copy.querySelectorAll('input,textarea,select,button,[data-adoption-private]')) control.remove();
    return copy.textContent;
  };
  const label = e => (e.getAttribute('aria-label') || Array.from(e.labels || []).map(labelText).join(' ') || e.placeholder || e.name || e.id || '').trim().replace(/\s+/g,' ').slice(0,160);
  const rowIdentity=e=>{const row=e.closest('tr,[role=row]');if(!row)return null;const copy=row.cloneNode(true);for(const control of copy.querySelectorAll('input,textarea,select,button,[data-adoption-private]'))control.remove();return JSON.stringify([row.id,row.getAttribute('data-row-key'),row.getAttribute('data-key'),copy.textContent.trim().replace(/\s+/g,' ').slice(0,1000)]);};
  let approvedPaths=new Set();
  const submit=createSubmitController(document,{visible,excluded,label,onActivate:e=>pointer.show(e,{label:label(e)||e.textContent.trim(),mode:'activate'})});
  function snapshot({inventory:includeInventory=false,task=''}={}) {
    pointer.clearGuidance();
    revision++; references = new Map();navigation=new Map();
    const dialogs = [...document.querySelectorAll('[role="dialog"][aria-modal="true"],dialog[open]')].filter(visible);
    const root = dialogs.length === 1 ? dialogs[0] : document;
    const formIds=new Map(),formKey=form=>{if(!form)return null;if(!formIds.has(form))formIds.set(form,/^[a-zA-Z][a-zA-Z0-9_-]{0,79}$/.test(form.id||'')?form.id:`form_${formIds.size+1}`);return formIds.get(form);};
    for(const form of root.querySelectorAll('form'))if(visible(form)&&!excluded(form))formKey(form);
    const radioNames=new Set();let choiceBudget=60;const onlyChoice=[...root.querySelectorAll('select')].filter(e=>visible(e)&&!excluded(e)).length===1;
    const fields = dialogs.length > 1 ? [] : [...root.querySelectorAll('input,textarea,select')]
      .filter(e=>{if(!visible(e)||excluded(e))return false;if(e.type!=='radio')return true;const key=(formKey(e.form)||'')+':'+e.name;if(radioNames.has(key))return false;radioNames.add(key);return true;}).filter(e => supported(e) && !e.readOnly && !/password|secret|token|otp|cvv|credit.?card|api.?key|access.?key|private.?key/i.test(label(e))).slice(0,60).map((e,i) => {
        const ref = `r${revision}f${i}`;
        references.set(ref, { element: e, rowIdentity:rowIdentity(e), value: e.value, checked:e.checked, constraints:constraints(e), options:e.options?JSON.stringify([...e.options].map(o=>[o.value,o.text,o.disabled,o.selected])):null, label: label(e), type: controlType(e),radio:e.type==='radio'?[...root.querySelectorAll('input[type=radio]')].filter(r=>r.name===e.name&&r.form===e.form):null,radioState:e.type==='radio'?JSON.stringify([...root.querySelectorAll('input[type=radio]')].filter(r=>r.name===e.name&&r.form===e.form).map(r=>[r.value,r.checked,r.disabled,label(r)])):null });
        const key=semanticFieldKey(e,label(e)),form=formKey(e.form);
        const descriptor={ ref, label: e.type==='radio'?(e.closest('fieldset')?.querySelector('legend')?.textContent.trim()||e.name):label(e), type: controlType(e), required: e.required,...(key?{key}:{}),...(form?{form}:{}),
          // No current values or private option text are sent by automatic inspection.
          optionCount: e.options?.length || 0 };
          const rules=Object.fromEntries(['min','max','step','maxlength','minlength','pattern'].flatMap(key=>{const value=e.getAttribute(key);return typeof value==='string'&&value.length<=160?[[key,value]]:[];}));if(Object.keys(rules).length)descriptor.constraints=rules;
          // Choice labels are task-scoped evidence, never automatic inspection data.
          if(choiceBudget&&requestsChoice(task,descriptor,onlyChoice)&&(e.options||e.type==='radio')){const group=references.get(ref).radio,available=(e.options?[...e.options].filter(o=>!o.disabled).map(o=>o.text.trim()):group.filter(o=>visible(o)&&!excluded(o)).map(label)).filter(value=>value&&value.length<=160).slice(0,1000),text=choiceText(task);available.sort((a,b)=>Number(text.includes(choiceText(b)))-Number(text.includes(choiceText(a))));descriptor.choices=available.slice(0,Math.min(20,choiceBudget));choiceBudget-=descriptor.choices.length;if(available.length>descriptor.choices.length)descriptor.choicesTruncated=true;const defaults=e.options?[...e.options].filter(o=>o.defaultSelected&&!o.disabled):[];if(defaults.length===1&&descriptor.choices.includes(defaults[0].text.trim()))descriptor.defaultChoice=defaults[0].text.trim();}
          return descriptor;
      });
    const links=dialogs.length?[]:[...document.querySelectorAll('a[href]')].filter(e=>visible(e)&&!excluded(e)).flatMap((e,i)=>{
      const url=new URL(e.href,document.location.href);
      if(url.origin!==document.location.origin||url.search||url.hash||!(e.getAttribute('data-adoption-navigation')==='safe'||approvedPaths.has(url.pathname)))return [];
      const ref=`r${revision}n${i}`,name=(e.getAttribute('aria-label')||e.textContent||'').trim().slice(0,160);
      navigation.set(ref,{element:e,href:url.href,label:name});return [{ref,label:name,path:url.pathname}];
    }).slice(0,30);
    const targets=dialogs.length>1?[]:pageTargets(document,root,{task,visible:rendered,excluded,revision});for(const target of targets)references.set(target.ref,{element:target.element,label:target.label,targetText:target.snippet,kind:target.kind});
    for(const field of fields.filter(f=>f.type==='combobox')){const control=references.get(field.ref).element,ids=(control.getAttribute('aria-controls')||'').split(/\s+/),containers=ids.map(id=>document.getElementById(id)).filter(Boolean);const options=targets.filter(t=>t.role==='option'&&containers.some(container=>container.contains(t.element)));if(options.length)field.optionRefs=options.map(t=>t.ref);}
    const heading=[...root.querySelectorAll('h1,h2,[role="heading"]')].filter(e=>visible(e)&&!excluded(e)).slice(-3).map(e=>targetText(e,rendered).slice(0,120)).join(' | ').slice(0,360);
    const blockedCount=Math.min(1000,[...document.querySelectorAll('button,[role="button"],a[href]')].filter(e=>{
      if(!visible(e)||excluded(e))return false;
      if(e.tagName==='A'){const url=new URL(e.href,document.location.href);if(url.origin===document.location.origin&&!url.search&&!url.hash&&(e.getAttribute('data-adoption-navigation')==='safe'||approvedPaths.has(url.pathname)))return false;}
      return true;
    }).length);
    const forms=[...formIds].map(([form,key])=>({key,label:(form.getAttribute?.('aria-label')||form.getAttribute?.('name')||key).slice(0,160),fields:fields.filter(f=>f.form===key).map(f=>f.key).filter(Boolean)}));
    const navigationCandidates=[...new Set([...document.querySelectorAll('a[href]')].filter(e=>visible(e)&&!excluded(e)).flatMap(e=>{const url=new URL(e.href,document.location.href);return url.origin===document.location.origin&&!url.search&&!url.hash?[url.pathname]:[];}))].slice(0,100);
    let inventory;
    if(includeInventory){
      const shown=e=>!e.hidden&&e.getClientRects().length>0&&document.defaultView.getComputedStyle(e).visibility!=='hidden';
      const allForms=[...document.querySelectorAll('form')].filter(e=>!excluded(e));for(const form of allForms)formKey(form);
      const allFields=[...document.querySelectorAll('input,textarea,select')].filter(e=>!excluded(e)&&!/submit|button|reset|image/.test(e.type||'')&&!/password|secret|token|credential|otp|cvv|credit.?card|api.?key|access.?key|private.?key/i.test(label(e)));
      const structuralFields=allFields.slice(0,500).map(e=>{const key=semanticFieldKey(e,label(e)),form=formKey(e.form);return {label:label(e),type:controlType(e),required:e.required===true,visible:shown(e),editable:supported(e)&&!e.disabled&&!e.readOnly,...(key?{key}:{}),...(form?{form}:{})};});
      const allLinks=[...document.querySelectorAll('a[href]')].filter(e=>!excluded(e)).flatMap(e=>{const url=new URL(e.href,document.location.href);return url.origin===document.location.origin&&!url.search&&!url.hash?[{path:url.pathname,label:(e.getAttribute('aria-label')||e.textContent||'').trim().slice(0,160),visible:shown(e)}]:[];});
      inventory={fields:structuralFields,forms:allForms.slice(0,100).map(form=>({key:formKey(form),label:(form.getAttribute('aria-label')||form.getAttribute('name')||formKey(form)).slice(0,160),fields:structuralFields.filter(field=>field.form===formKey(form)).map(field=>field.key).filter(Boolean)})),links:allLinks.slice(0,100),truncated:allFields.length>500||allForms.length>100||allLinks.length>100};
    }
    const openShadowRoots=[...root.querySelectorAll('*')].filter(e=>!excluded(e)&&e.shadowRoot).length;
    const unsupportedControls=[...root.querySelectorAll('input,textarea,select,[role="combobox"],[contenteditable="true"]')].filter(e=>visible(e)&&!excluded(e)&&(!supported(e)||e.isContentEditable)).length;
    const embeddedFrames=root.querySelectorAll('iframe:not([data-adoption-widget])').length;
    const manualNotice=openShadowRoots||unsupportedControls||embeddedFrames?`Manual controls remain on this page: ${unsupportedControls} unsupported controls, ${openShadowRoots} open shadow roots and ${embeddedFrames} embedded frames. This review covers supported native controls in the main page only. Closed shadow roots and controls requiring a trusted user gesture must be handled on the website.`:'';
    return { revision, fields,forms, links,...(task?{pageContext:loadedPageContext(root,{visible:rendered,excluded})}:{}),...(task?{recentActivity:recentActivity(fields)}:{}),...(targets.length?{targets:targets.map(({ref,label,kind,role,state,snippet})=>({ref,label,kind,role,state,text:snippet})),domScope:'Task-relevant rendered content only; up to 24 targets from bounded loaded DOM traversal. Unloaded, hidden and private-marked content is excluded.'}:{}),...(inventory?{inventory}:{}),coverage:{fieldLimit:60,navigationLimit:30,visibleNativeControls:[...root.querySelectorAll('input,textarea,select')].filter(e=>visible(e)&&!excluded(e)).length,embeddedFrames,openShadowRoots,unsupportedControls,manualNotice},submissions:submit.snapshot(revision),navigationCandidates, screen:heading, path:document.location.pathname, ambiguousDialogs: dialogs.length > 1,blockedCount };
  }
  function fill(args){
    const record=references.get(args.ref),out=applyFill(args),remember=result=>{if(record&&result.dispatched===true&&result.valueObserved===true){const item=identity(record);appliedFields=appliedFields.filter(r=>r.element!==item.element);appliedFields.push(item);appliedFields=appliedFields.slice(-10);}return result;};
    return out?.then?out.then(remember):remember(out);
  }
  function applyFill({ ref, value, query, select=true, expectedRevision, approved,active=()=>true }) {
    if (approved !== true || expectedRevision !== revision || typeof value !== 'string' || value.length > 8000) throw new Error('Review required');
    const record = references.get(ref), e = record?.element;
    if (!e || !e.isConnected || !visible(e) || excluded(e) || e.readOnly || e.value !== record.value || label(e) !== record.label || controlType(e) !== record.type) throw new Error('Screen changed; inspect and review again');
    if(record.rowIdentity!==rowIdentity(e))throw new Error('Table row identity changed; inspect and review the intended row again');
    if(e.type==='checkbox'&&e.checked!==record.checked)throw new Error('Checkbox changed; inspect and review again');
    if(e.options&&JSON.stringify([...e.options].map(o=>[o.value,o.text,o.disabled,o.selected]))!==record.options)throw new Error('Options changed; inspect and review again');
    if(e.minLength>0&&value&&value.length<e.minLength)throw new Error('Value is shorter than the field minimum; review it before filling');
    if(e.maxLength>=0&&value.length>e.maxLength)throw new Error('Value exceeds the field limit; review a shorter value');
    if(constraints(e)!==record.constraints)throw new Error('Field constraints changed; inspect and review again');
    // Validate without changing the host or dispatching application events.
    // Empty required drafts remain editable; the separate Save checks completeness.
    if(!['checkbox','radio','select-one','select-multiple','combobox'].includes(record.type)&&e.cloneNode){
      const probe=e.cloneNode(false);probe.value=value;const validity=probe.validity;
      if(probe.value!==value||validity&&['badInput','typeMismatch','patternMismatch','rangeUnderflow','rangeOverflow','stepMismatch','tooLong'].some(key=>validity[key]))throw new Error('Value violates the current field constraints; review it before filling');
    }

    if(typeof select!=='boolean'||select===false&&(record.type!=='combobox'||query!==undefined))throw new Error('Invalid lookup mode; review again');
    if(query!==undefined&&(record.type!=='combobox'||typeof query!=='string'||!query.trim()||query.length>160))throw new Error('Invalid picklist query; review again');
    const view = document.defaultView;
    let expected=value;
    if(e.type==='checkbox'){
      if(!['true','false'].includes(value))throw new Error('Checkbox requires true or false');
      expected=value==='true';if(e.checked===expected){references.delete(ref);return {dispatched:false,noOp:true,valueObserved:true,saved:false};}references.delete(ref);pointer.show(e,{label:record.label,mode:'activate'});e.click();return {dispatched:true,valueObserved:e.checked===expected,saved:false};
    }else if(record.radio){
      if(JSON.stringify(record.radio.map(r=>[r.value,r.checked,r.disabled,label(r)]))!==record.radioState)throw new Error('Radio group changed; inspect again');
      const choices=record.radio.filter(r=>r.isConnected&&visible(r)&&!excluded(r)&&(r.value===value||label(r).toLowerCase()===value.trim().toLowerCase()));
      if(choices.length!==1)throw new Error('Radio option not found or ambiguous; inspect again');
      const noOp=choices[0].checked;references.delete(ref);if(!noOp){pointer.show(choices[0],{label:label(choices[0]),mode:'activate'});choices[0].click();}return {dispatched:!noOp,noOp,valueObserved:choices[0].checked,saved:false};
    }else if(e.type==='select-multiple'){
      let values;try{values=JSON.parse(value);}catch{values=value.split(',').map(s=>s.trim());}
      if(!Array.isArray(values)||values.some(v=>typeof v!=='string'))throw new Error('Choose a list of option labels');
      const chosen=values.map(v=>[...e.options].filter(o=>!o.disabled&&(o.value===v||o.text.trim().toLowerCase()===v.toLowerCase())));
      if(chosen.some(c=>c.length!==1)||new Set(chosen.map(c=>c[0])).size!==chosen.length)throw new Error('Options not found or ambiguous; inspect again');
      if([...e.selectedOptions].length===chosen.length&&chosen.every(c=>c[0].selected)){references.delete(ref);return {dispatched:false,noOp:true,valueObserved:true,saved:false};}
      references.delete(ref);pointer.show(e,{label:record.label,mode:'apply'});for(const option of e.options)option.selected=chosen.some(c=>c[0]===option);
      e.dispatchEvent(new view.Event('input',{bubbles:true}));e.dispatchEvent(new view.Event('change',{bubbles:true}));references.delete(ref);
      return {dispatched:true,valueObserved:[...e.selectedOptions].length===chosen.length&&chosen.every(c=>c[0].selected),saved:false};
    }else if(e.type==='select-one'){
      const matches=[...e.options].filter(o=>!o.disabled&&(o.value===value||o.text.trim().toLowerCase()===value.trim().toLowerCase()));
      if(matches.length!==1)throw new Error('Option not found or ambiguous; select manually');
      expected=matches[0].value;if(e.value===expected){references.delete(ref);return {dispatched:false,noOp:true,valueObserved:true,saved:false};}references.delete(ref);pointer.show(e,{label:record.label,mode:'apply'});Object.getOwnPropertyDescriptor(view.HTMLSelectElement.prototype,'value').set.call(e,expected);
    }else{
      if(e.value===value&&record.type!=='combobox'){references.delete(ref);return {dispatched:false,noOp:true,valueObserved:true,saved:false};}
      if(record.type==='combobox'){e.focus();if(!e.isConnected||!visible(e)||excluded(e))throw new Error('Picklist changed; inspect again');}
      references.delete(ref);pointer.show(e,{label:record.label,mode:'apply'});const prototype = e.tagName === 'TEXTAREA' ? view.HTMLTextAreaElement.prototype : view.HTMLInputElement.prototype;
      Object.getOwnPropertyDescriptor(prototype, 'value').set.call(e, record.type==='combobox'?(query??value):value);
    }
    e.dispatchEvent(new view.Event('input', { bubbles: true }));
    e.dispatchEvent(new view.Event('change', { bubbles: true }));
    if(record.type==='combobox'){
      references.delete(ref);
      const listId=e.getAttribute('aria-controls');
      if(select===false){return (async()=>{let signature='',settledAt=Date.now();const until=Date.now()+5000;while(Date.now()<until){if(!active())throw new Error('Task stopped during lookup');if(!e.isConnected||excluded(e)||e.value!==value)throw new Error('Picklist changed; inspect again');const list=document.getElementById(listId),next=list?.textContent||'',busy=list?.getAttribute('aria-busy')==='true';if(next!==signature||busy){signature=next;settledAt=Date.now();}if(!busy&&Date.now()-settledAt>=400)return {dispatched:true,valueObserved:e.value===value,observeAgain:true,selected:false,saved:false};await new Promise(resolve=>setTimeout(resolve,50));}throw new Error('Lookup did not settle. Inspect the loaded results before continuing.');})();}
      return (async()=>{
        const end=Date.now()+5000;let readyOption,readyAt=0;
        while(Date.now()<end){
          if(!active())throw new Error('Task stopped; no picklist option was selected');
          if(!e.isConnected||excluded(e)||e.value!==(query??value)||e.getAttribute('aria-controls')!==listId)throw new Error('Picklist changed; inspect again');
          const list=document.getElementById(listId),matches=list?[...list.querySelectorAll('[role=option]')].filter(o=>visible(o)&&!excluded(o)&&o.getAttribute('aria-disabled')!=='true'&&o.textContent.trim().toLowerCase()===value.trim().toLowerCase()):[];
          if(matches.length>1)throw new Error('Picklist option is ambiguous');
          const candidate=matches.length===1&&list.getAttribute('aria-busy')!=='true'?matches[0]:null;
          if(candidate!==readyOption){readyOption=candidate;readyAt=Date.now();}
          if(candidate&&Date.now()-readyAt>=100){
            if(!active())throw new Error('Task stopped; no picklist option was selected');
            pointer.show(candidate,{label:value,mode:'activate'});candidate.click(); // Exactly one selection, never repeat a host effect.
            for(let i=0;i<10;i++){
              if(!active())throw new Error('Task stopped after picklist selection. Inspect the website before continuing.');
              if(e.isConnected&&e.value.trim().toLowerCase()===value.trim().toLowerCase()&&(!candidate.isConnected||e.getAttribute('aria-expanded')==='false'||candidate.getAttribute('aria-selected')==='true'))return {dispatched:true,valueObserved:true,saved:false};
              await new Promise(resolve=>setTimeout(resolve,50));
            }
            return {dispatched:true,valueObserved:false,saved:false};
          }
          await new Promise(resolve=>setTimeout(resolve,50));
        }
        throw new Error('Picklist option did not load. No option was selected.');
      })();
    }
    references.delete(ref); // One use; subsequent writes require another inspection/review.
    return { dispatched: true, valueObserved: (e.type==='checkbox'?e.checked:e.value) === expected, saved: false };
  }
  async function navigate({ref,expectedRevision,approved,activation='click'}){
    const record=navigation.get(ref),e=record?.element;
    if(!approved||expectedRevision!==revision||!e?.isConnected||!visible(e)||excluded(e)||e.href!==record.href||(e.getAttribute('aria-label')||e.textContent||'').trim().slice(0,160)!==record.label)throw new Error('Navigation changed; inspect again');
    if(hasDraft())throw new Error('This page has an edited draft. Save or discard it yourself before navigation.');
    navigation.delete(ref);pointer.show(e,{label:record.label,mode:'activate'});activateNavigation(e,activation);
    const expectedPath=new URL(record.href).pathname;
    for(let attempt=0;attempt<50;attempt++){
      if(document.location.pathname===expectedPath){await new Promise(resolve=>document.defaultView.requestAnimationFrame(resolve));return {navigated:true,expectedPath,verified:true};}
      await new Promise(resolve=>setTimeout(resolve,100));
    }
    throw new Error('Navigation was not verified. Check the host page before continuing.');
  }
  function highlight({ref,expectedRevision}){
    const record=references.get(ref)||navigation.get(ref),element=record?.element;
    const matches=()=>!!element?.isConnected&&!excluded(element)&&(record.kind?rendered(element)&&targetText(element,rendered)===record.targetText:record.href?visible(element)&&element.href===record.href&&(element.getAttribute('aria-label')||element.textContent||'').trim().slice(0,160)===record.label:visible(element)&&label(element)===record.label);
    if(expectedRevision!==revision||!matches())throw new Error('Guidance target changed; inspect again');
    cleanupHighlight();element.scrollIntoView?.({block:'center',inline:'nearest',behavior:'instant'});pointer.show(element,{label:record.label,mode:'guide',valid:matches});return {highlighted:true,wrote:false};
  }
  function hasDraft(){return [...document.querySelectorAll('input,textarea,select')].some(field=>{
    if(field.closest('[data-adoption-widget]')||!visible(field)||submit.matchesSavedBaseline(field))return false;
    if(['checkbox','radio'].includes(field.type))return field.checked!==field.defaultChecked;
    if(field.type==='file')return field.files?.length>0;
    if(field.tagName==='SELECT'){
      const options=[...field.options];if(field.multiple)return options.some(option=>option.selected!==option.defaultSelected);
      return field.value!==(options.find(option=>option.defaultSelected)?.value??options[0]?.value??'');
    }
    return typeof field.defaultValue==='string'&&field.value!==field.defaultValue;
  });}
  function reviewValues(actions,expectedRevision){
    if(expectedRevision!==revision)return [];
    return actions.filter(action=>action.type==='fill').flatMap(action=>{
      const record=references.get(action.ref),e=record?.element;if(!e?.isConnected||!visible(e)||excluded(e))return [];
      const changed=e.value!==record.value||e.type==='checkbox'&&e.checked!==record.checked||label(e)!==record.label||record.rowIdentity!==rowIdentity(e)||e.options&&JSON.stringify([...e.options].map(o=>[o.value,o.text,o.disabled,o.selected]))!==record.options||record.radio&&JSON.stringify(record.radio.map(r=>[r.value,r.checked,r.disabled,label(r)]))!==record.radioState;
      let display=e.type==='checkbox'?(e.checked?'Selected':'Cleared'):e.options?[...e.selectedOptions].map(option=>option.text.trim()).join(', '):record.radio?record.radio.filter(option=>option.checked).map(label).join(', '):String(e.value||'');
      let matches=false;if(!changed){if(e.type==='checkbox')matches=String(e.checked)===action.value;else if(e.type==='select-multiple'){try{matches=JSON.stringify([...e.selectedOptions].map(option=>option.text.trim()).sort())===JSON.stringify(JSON.parse(action.value).sort());}catch{}}else matches=display.trim()===String(action.value).trim();}
      return [{ref:action.ref,display:changed?'':display.slice(0,300),changed,matches}];
    });
  }
  function shareContext({includeValues=false}={}){
    const observed=snapshot({inventory:true}),values=includeValues?observed.fields.flatMap(field=>{const record=references.get(field.ref),e=record?.element;if(!e||!visible(e)||excluded(e)||/^(?:cc-|one-time-code|current-password|new-password)/i.test(e.autocomplete||''))return [];const value=e.type==='checkbox'?String(e.checked):e.options?[...e.selectedOptions].map(o=>o.text.trim()).join(', '):record.radio?record.radio.filter(r=>r.checked).map(label).join(', '):String(e.value||'');if(value.length>1000)throw new Error('A current form value exceeds the private sharing limit. Share a smaller task context.');return value?[{ref:field.ref,value}]:[];}):[];
    return {sourceSnapshot:observed,values};
  }
  return { shareContext,snapshot, fill, navigate,highlight,rememberReview,recentSummary(){const records=appliedFields.length?appliedFields:preparedFields;return {phase:appliedFields.length?'applied':'prepared',path:records[0]?.path,labels:records.map(r=>r.label)};},beginChanges(){preparedFields=[];appliedFields=[];},discardReview(){preparedFields=[];},clearRecent(){preparedFields=[];appliedFields=[];},clearGuidance:cleanupHighlight,reviewValues,hasDraft,settle({active=()=>true,task=''}={}){const controls=[...document.querySelectorAll('input,select,textarea')].filter(e=>!excluded(e)&&e.getClientRects().length),labels=controls.map(label),waiting=controls.filter(e=>e.disabled&&requestedField(task,label(e),labels));return waitForHost({read:()=>({busy:[...document.querySelectorAll('[aria-busy=true]')].filter(e=>!excluded(e)&&e.getClientRects().length).length,ready:!waiting.length||waiting.some(e=>e.isConnected&&!e.disabled)}),ready:state=>!state.busy&&state.ready,active});},submit:submit.submit,setReadOnlyPaths(paths){if(!Array.isArray(paths)||paths.length>100||paths.some(p=>typeof p!=='string'||!/^\/(?!\/)[^?#\\]*$/.test(p)))throw new Error('Invalid read-only route scope');approvedPaths=new Set(paths);},destroy:()=>{preparedFields=[];appliedFields=[];cleanupHighlight();} };
}
