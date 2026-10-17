// Session-local references: never persist selectors or entered values as shared learning.
export function createInspector(document) {
  let revision = 0;
  let references = new Map();
  let navigation = new Map();
  const excluded = e => e.closest('[data-adoption-private], [data-adoption-widget]') ||
    /password|hidden|file/.test(e.type || '') || /password|token|secret|otp|credit.?card|cvv/i.test(`${e.name} ${e.id} ${e.autocomplete}`);
  const visible = e => !e.disabled && !e.hidden && e.getClientRects().length > 0 &&
    document.defaultView.getComputedStyle(e).visibility !== 'hidden';
  // Wrapping labels may contain SELECT options or textarea content. Those are
  // control data, not the accessible field name, and must remain local.
  const labelText = l => {
    if (!l.cloneNode) return l.textContent;
    const copy = l.cloneNode(true);
    for (const control of copy.querySelectorAll('input,textarea,select,button,[data-adoption-private]')) control.remove();
    return copy.textContent;
  };
  const label = e => (e.getAttribute('aria-label') || Array.from(e.labels || []).map(labelText).join(' ') || e.placeholder || e.name || '').trim().replace(/\s+/g,' ').slice(0,160);
  function snapshot() {
    revision++; references = new Map();navigation=new Map();
    const dialogs = [...document.querySelectorAll('[role="dialog"][aria-modal="true"],dialog[open]')].filter(visible);
    const root = dialogs.length === 1 ? dialogs[0] : document;
    const fields = dialogs.length > 1 ? [] : [...root.querySelectorAll('input,textarea,select')]
      .filter(e => visible(e) && !e.readOnly && !excluded(e) && !/password|secret|token|otp|cvv|credit.?card/i.test(label(e)) && !/submit|button|reset|image|radio/.test(e.type || '')).slice(0,60).map((e,i) => {
        const ref = `r${revision}f${i}`;
        references.set(ref, { element: e, value: e.value, checked:e.checked, options:e.options?JSON.stringify([...e.options].map(o=>[o.value,o.text,o.disabled])):null, label: label(e), type: e.type });
        return { ref, label: label(e), type: e.type || e.tagName.toLowerCase(), required: e.required,
          // No current values or private option text are sent by automatic inspection.
          optionCount: e.options?.length || 0 };
      });
    const links=dialogs.length?[]:[...document.querySelectorAll('a[href][data-adoption-navigation="safe"]')].filter(e=>visible(e)&&!excluded(e)).slice(0,30).flatMap((e,i)=>{
      const url=new URL(e.href,document.location.href);
      if(url.origin!==document.location.origin||url.search||url.hash)return [];
      const ref=`r${revision}n${i}`,name=(e.getAttribute('aria-label')||e.textContent||'').trim().slice(0,160);
      navigation.set(ref,{element:e,href:url.href,label:name});return [{ref,label:name,path:url.pathname}];
    });
    const heading=[...root.querySelectorAll('h1,h2,[role="heading"]')].filter(e=>visible(e)&&!excluded(e)).slice(-3).map(e=>e.textContent.trim().slice(0,120)).join(' | ').slice(0,360);
    return { revision, fields, links, screen:heading, path:document.location.pathname, ambiguousDialogs: dialogs.length > 1 };
  }
  function fill({ ref, value, expectedRevision, approved }) {
    if (approved !== true || expectedRevision !== revision || typeof value !== 'string' || value.length > 8000) throw new Error('Review required');
    const record = references.get(ref), e = record?.element;
    if (!e || !e.isConnected || !visible(e) || excluded(e) || e.readOnly || e.value !== record.value || label(e) !== record.label || e.type !== record.type) throw new Error('Screen changed; inspect and review again');
    if(e.type==='checkbox'&&e.checked!==record.checked)throw new Error('Checkbox changed; inspect and review again');
    if(e.options&&JSON.stringify([...e.options].map(o=>[o.value,o.text,o.disabled]))!==record.options)throw new Error('Options changed; inspect and review again');
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
  async function navigate({ref,expectedRevision,approved}){
    const record=navigation.get(ref),e=record?.element;
    if(!approved||expectedRevision!==revision||!e?.isConnected||!visible(e)||excluded(e)||e.href!==record.href||e.textContent.trim()!==record.label)throw new Error('Navigation changed; inspect again');
    if([...document.querySelectorAll('input,textarea,select')].some(f=>!excluded(f)&&visible(f)&&f.value!==f.defaultValue&&f.value))throw new Error('This page has an edited draft. Save or discard it yourself before navigation.');
    navigation.delete(ref);e.click();
    const expectedPath=new URL(record.href).pathname;
    for(let attempt=0;attempt<50;attempt++){
      if(document.location.pathname===expectedPath){await new Promise(resolve=>document.defaultView.requestAnimationFrame(resolve));return {navigated:true,expectedPath,verified:true};}
      await new Promise(resolve=>setTimeout(resolve,100));
    }
    throw new Error('Navigation was not verified. Check the host page before continuing.');
  }
  return { snapshot, fill, navigate };
}
