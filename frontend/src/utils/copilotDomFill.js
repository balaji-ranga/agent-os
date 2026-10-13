// DOM driver: no selectors or executable code from the model. Control identities
// are attached by the build to source-defined fields. Review is required by UI.
export function captureDomFields(root,ids){
  const result={};
  for(const id of ids){
    const matches=[...root.querySelectorAll('[data-copilot-control]')].filter(e=>e.getAttribute('data-copilot-control')===id&&e.getClientRects().length&&!e.disabled&&!e.readOnly&&!e.hidden);
    if(matches.length!==1)throw new Error('Open the requested form. A field is unavailable or ambiguous.');
    const element=matches[0];
    if(!['text','email','url','tel','number','textarea','select-one'].includes(element.type))throw new Error('This control requires manual input.');
    result[id]={element,value:element.value};
  }
  return result;
}

export function applyDomFields(snapshot,values){
  // Preflight the whole batch before changing any field.
  for(const [id,value] of Object.entries(values)){
    const entry=snapshot[id],el=entry?.element;
    if(!el?.isConnected||el.disabled||el.readOnly||!el.getClientRects().length||el.value!==entry.value)throw new Error('The form changed. Ask again; no fields were overwritten.');
    if(typeof value!=='string'||value.length>4000)throw new Error('Invalid field value.');
    if(el.maxLength>=0&&value.length>el.maxLength)throw new Error('Value exceeds the field limit.');
    if(el.tagName==='SELECT'&&![...el.options].some(o=>o.value===value&&!o.disabled))throw new Error('Choose a current permitted option.');
    // Detached native control checks HTML type, pattern and numeric constraints.
    const probe=el.cloneNode(true);probe.value=value;
    if(!probe.checkValidity())throw new Error('Value does not satisfy this field’s validation rules.');
  }
  for(const [id,value] of Object.entries(values)){
    const el=snapshot[id].element,view=el.ownerDocument.defaultView;
    const proto=el.tagName==='TEXTAREA'?view.HTMLTextAreaElement.prototype:el.tagName==='SELECT'?view.HTMLSelectElement.prototype:view.HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto,'value').set.call(el,value);
    el.dispatchEvent(new view.Event('input',{bubbles:true}));
    el.dispatchEvent(new view.Event('change',{bubbles:true}));
  }
}

export function visibleCopilotControls(root){
  return [...new Set([...root.querySelectorAll('[data-copilot-control]')].filter(e=>e.getClientRects().length&&!e.disabled&&!e.hidden).map(e=>e.getAttribute('data-copilot-control')))].slice(0,150);
}
