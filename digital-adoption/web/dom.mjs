// Session-local references: never persist selectors or entered values as shared learning.
import {createSubmitController} from './form-submit.mjs';
import {semanticFieldKey} from './semantic.mjs';
import {activateNavigation} from './activation.mjs';
export function createInspector(document) {
  let revision = 0;
  let references = new Map();
  let navigation = new Map();
  let cleanupHighlight=()=>{};
  const excluded = e => e.closest('[data-adoption-private], [data-adoption-widget]') ||
    /password|hidden|file/.test(e.type || '') || /password|token|secret|otp|credit.?card|cvv|api.?key|access.?key|private.?key/i.test(`${e.name} ${e.id} ${e.autocomplete}`);
  const visible = e => !e.disabled && !e.hidden && e.getClientRects().length > 0 &&
    document.defaultView.getComputedStyle(e).visibility !== 'hidden';
  const supported = e => ['text','number','email','date','textarea','url','tel','search','select-one','checkbox'].includes(e.type||e.tagName.toLowerCase());
  // Wrapping labels may contain SELECT options or textarea content. Those are
  // control data, not the accessible field name, and must remain local.
  const labelText = l => {
    if (!l.cloneNode) return l.textContent;
    const copy = l.cloneNode(true);
    for (const control of copy.querySelectorAll('input,textarea,select,button,[data-adoption-private]')) control.remove();
    return copy.textContent;
  };
  const label = e => (e.getAttribute('aria-label') || Array.from(e.labels || []).map(labelText).join(' ') || e.placeholder || e.name || e.id || '').trim().replace(/\s+/g,' ').slice(0,160);
  let approvedPaths=new Set();
  const submit=createSubmitController(document,{visible,excluded,label});
  function snapshot({inventory:includeInventory=false}={}) {
    revision++; references = new Map();navigation=new Map();
    const dialogs = [...document.querySelectorAll('[role="dialog"][aria-modal="true"],dialog[open]')].filter(visible);
    const root = dialogs.length === 1 ? dialogs[0] : document;
    const formIds=new Map(),formKey=form=>{if(!form)return null;if(!formIds.has(form))formIds.set(form,/^[a-zA-Z][a-zA-Z0-9_-]{0,79}$/.test(form.id||'')?form.id:`form_${formIds.size+1}`);return formIds.get(form);};
    for(const form of root.querySelectorAll('form'))if(visible(form)&&!excluded(form))formKey(form);
    const fields = dialogs.length > 1 ? [] : [...root.querySelectorAll('input,textarea,select')]
      .filter(e => visible(e) && supported(e) && !e.readOnly && !excluded(e) && !/password|secret|token|otp|cvv|credit.?card|api.?key|access.?key|private.?key/i.test(label(e))).slice(0,60).map((e,i) => {
        const ref = `r${revision}f${i}`;
        references.set(ref, { element: e, value: e.value, checked:e.checked, options:e.options?JSON.stringify([...e.options].map(o=>[o.value,o.text,o.disabled])):null, label: label(e), type: e.type });
        const key=semanticFieldKey(e,label(e)),form=formKey(e.form);
        return { ref, label: label(e), type: e.type || e.tagName.toLowerCase(), required: e.required,...(key?{key}:{}),...(form?{form}:{}),
          // No current values or private option text are sent by automatic inspection.
          optionCount: e.options?.length || 0 };
      });
    const links=dialogs.length?[]:[...document.querySelectorAll('a[href]')].filter(e=>visible(e)&&!excluded(e)).flatMap((e,i)=>{
      const url=new URL(e.href,document.location.href);
      if(url.origin!==document.location.origin||url.search||url.hash||!(e.getAttribute('data-adoption-navigation')==='safe'||approvedPaths.has(url.pathname)))return [];
      const ref=`r${revision}n${i}`,name=(e.getAttribute('aria-label')||e.textContent||'').trim().slice(0,160);
      navigation.set(ref,{element:e,href:url.href,label:name});return [{ref,label:name,path:url.pathname}];
    }).slice(0,30);
    const heading=[...root.querySelectorAll('h1,h2,[role="heading"]')].filter(e=>visible(e)&&!excluded(e)).slice(-3).map(e=>e.textContent.trim().slice(0,120)).join(' | ').slice(0,360);
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
      const structuralFields=allFields.slice(0,500).map(e=>{const key=semanticFieldKey(e,label(e)),form=formKey(e.form);return {label:label(e),type:e.type||e.tagName.toLowerCase(),required:e.required===true,visible:shown(e),editable:supported(e)&&!e.disabled&&!e.readOnly,...(key?{key}:{}),...(form?{form}:{})};});
      const allLinks=[...document.querySelectorAll('a[href]')].filter(e=>!excluded(e)).flatMap(e=>{const url=new URL(e.href,document.location.href);return url.origin===document.location.origin&&!url.search&&!url.hash?[{path:url.pathname,label:(e.getAttribute('aria-label')||e.textContent||'').trim().slice(0,160),visible:shown(e)}]:[];});
      inventory={fields:structuralFields,forms:allForms.slice(0,100).map(form=>({key:formKey(form),label:(form.getAttribute('aria-label')||form.getAttribute('name')||formKey(form)).slice(0,160),fields:structuralFields.filter(field=>field.form===formKey(form)).map(field=>field.key).filter(Boolean)})),links:allLinks.slice(0,100),truncated:allFields.length>500||allForms.length>100||allLinks.length>100};
    }
    const openShadowRoots=[...root.querySelectorAll('*')].filter(e=>!excluded(e)&&e.shadowRoot).length;
    const unsupportedControls=[...root.querySelectorAll('input,textarea,select,[role="combobox"],[contenteditable="true"]')].filter(e=>visible(e)&&!excluded(e)&&(!supported(e)||e.getAttribute('role')==='combobox'||e.isContentEditable)).length;
    const embeddedFrames=root.querySelectorAll('iframe:not([data-adoption-widget])').length;
    const manualNotice=openShadowRoots||unsupportedControls||embeddedFrames?`Manual controls remain on this page: ${unsupportedControls} unsupported controls, ${openShadowRoots} open shadow roots and ${embeddedFrames} embedded frames. This review covers supported native controls in the main page only. Closed shadow roots and controls requiring a trusted user gesture must be handled on the website.`:'';
    return { revision, fields,forms, links,...(inventory?{inventory}:{}),coverage:{fieldLimit:60,navigationLimit:30,visibleNativeControls:[...root.querySelectorAll('input,textarea,select')].filter(e=>visible(e)&&!excluded(e)).length,embeddedFrames,openShadowRoots,unsupportedControls,manualNotice},submissions:submit.snapshot(revision),navigationCandidates, screen:heading, path:document.location.pathname, ambiguousDialogs: dialogs.length > 1,blockedCount };
  }
  function fill({ ref, value, expectedRevision, approved }) {
    if (approved !== true || expectedRevision !== revision || typeof value !== 'string' || value.length > 8000) throw new Error('Review required');
    const record = references.get(ref), e = record?.element;
    if (!e || !e.isConnected || !visible(e) || excluded(e) || e.readOnly || e.value !== record.value || label(e) !== record.label || e.type !== record.type) throw new Error('Screen changed; inspect and review again');
    if(e.type==='checkbox'&&e.checked!==record.checked)throw new Error('Checkbox changed; inspect and review again');
    if(e.options&&JSON.stringify([...e.options].map(o=>[o.value,o.text,o.disabled]))!==record.options)throw new Error('Options changed; inspect and review again');
    if(e.maxLength>=0&&value.length>e.maxLength)throw new Error('Value exceeds the field limit; review a shorter value');
    if (['radio','select-multiple'].includes(e.type)) throw new Error('Use manual selection for this control');
    const view = document.defaultView;
    let expected=value;
    if(e.type==='checkbox'){
      if(!['true','false'].includes(value))throw new Error('Checkbox requires true or false');
      expected=value==='true';Object.getOwnPropertyDescriptor(view.HTMLInputElement.prototype,'checked').set.call(e,expected);
    }else if(e.type==='select-one'){
      const matches=[...e.options].filter(o=>!o.disabled&&(o.value===value||o.text.trim().toLowerCase()===value.trim().toLowerCase()));
      if(matches.length!==1)throw new Error('Option not found or ambiguous; select manually');
      expected=matches[0].value;Object.getOwnPropertyDescriptor(view.HTMLSelectElement.prototype,'value').set.call(e,expected);
    }else{
      const prototype = e.tagName === 'TEXTAREA' ? view.HTMLTextAreaElement.prototype : view.HTMLInputElement.prototype;
      Object.getOwnPropertyDescriptor(prototype, 'value').set.call(e, value);
    }
    e.dispatchEvent(new view.Event('input', { bubbles: true }));
    e.dispatchEvent(new view.Event('change', { bubbles: true }));
    references.delete(ref); // One use; subsequent writes require another inspection/review.
    return { dispatched: true, valueObserved: (e.type==='checkbox'?e.checked:e.value) === expected, saved: false };
  }
  async function navigate({ref,expectedRevision,approved,activation='click'}){
    const record=navigation.get(ref),e=record?.element;
    if(!approved||expectedRevision!==revision||!e?.isConnected||!visible(e)||excluded(e)||e.href!==record.href||(e.getAttribute('aria-label')||e.textContent||'').trim().slice(0,160)!==record.label)throw new Error('Navigation changed; inspect again');
    if(hasDraft())throw new Error('This page has an edited draft. Save or discard it yourself before navigation.');
    navigation.delete(ref);activateNavigation(e,activation);
    const expectedPath=new URL(record.href).pathname;
    for(let attempt=0;attempt<50;attempt++){
      if(document.location.pathname===expectedPath){await new Promise(resolve=>document.defaultView.requestAnimationFrame(resolve));return {navigated:true,expectedPath,verified:true};}
      await new Promise(resolve=>setTimeout(resolve,100));
    }
    throw new Error('Navigation was not verified. Check the host page before continuing.');
  }
  function highlight({ref,expectedRevision}){
    const record=references.get(ref),element=record?.element;
    if(expectedRevision!==revision||!element?.isConnected||!visible(element)||excluded(element)||label(element)!==record.label)throw new Error('Guidance target changed; inspect again');
    cleanupHighlight();const view=document.defaultView,marker=document.createElement('div'),caption=document.createElement('span');marker.dataset.adoptionWidget='true';marker.setAttribute('role','status');marker.style.cssText='position:fixed;pointer-events:none;z-index:2147483645;border:3px solid #3459cf;border-radius:6px;box-shadow:0 0 0 3px white';caption.textContent=`Next: ${record.label}`;caption.style.cssText='position:absolute;left:0;bottom:100%;max-width:300px;background:#172440;color:white;padding:4px 8px;border-radius:5px;font:13px system-ui;white-space:nowrap';marker.append(caption);
    const position=()=>{if(!element.isConnected){cleanupHighlight();return;}const box=element.getBoundingClientRect();Object.assign(marker.style,{left:`${box.left-3}px`,top:`${box.top-3}px`,width:`${box.width+6}px`,height:`${box.height+6}px`});};
    document.body.append(marker);position();view.addEventListener('scroll',position,true);view.addEventListener('resize',position);const timer=setTimeout(()=>cleanupHighlight(),5000);
    cleanupHighlight=()=>{clearTimeout(timer);view.removeEventListener('scroll',position,true);view.removeEventListener('resize',position);marker.remove();cleanupHighlight=()=>{};};return {highlighted:true,wrote:false};
  }
  function hasDraft(){return [...document.querySelectorAll('input,textarea,select')].some(field=>{
    if(field.closest('[data-adoption-widget]')||!visible(field))return false;
    if(['checkbox','radio'].includes(field.type))return field.checked!==field.defaultChecked;
    if(field.type==='file')return field.files?.length>0;
    if(field.tagName==='SELECT'){
      const options=[...field.options];if(field.multiple)return options.some(option=>option.selected!==option.defaultSelected);
      return field.value!==(options.find(option=>option.defaultSelected)?.value??options[0]?.value??'');
    }
    return typeof field.defaultValue==='string'&&field.value!==field.defaultValue;
  });}
  return { snapshot, fill, navigate,highlight,hasDraft,submit:submit.submit,setReadOnlyPaths(paths){if(!Array.isArray(paths)||paths.length>100||paths.some(p=>typeof p!=='string'||!/^\/(?!\/)[^?#\\]*$/.test(p)))throw new Error('Invalid read-only route scope');approvedPaths=new Set(paths);},destroy:()=>cleanupHighlight() };
}
