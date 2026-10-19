// Constraint categories/labels only: raw validation messages may contain private values.
export function formValidation(form,label=e=>e.getAttribute('aria-label')||e.name||e.id||'Field'){
 return [...form.elements].filter(e=>!e.closest('[data-adoption-private],[data-adoption-widget]')&&!/password|file|hidden/.test(e.type||'')).flatMap(e=>{
  const validity=e.validity;if(!validity||validity.valid&&e.getAttribute('aria-invalid')!=='true')return [];
  const reason=['valueMissing','typeMismatch','patternMismatch','rangeUnderflow','rangeOverflow','stepMismatch','tooLong','tooShort','badInput','customError'].find(k=>validity[k])||'host_invalid';
  return [{label:label(e).slice(0,160),reason}];
 });
}
export async function waitForHost({read,ready,active=()=>true,timeoutMs=5000,clock=Date.now}){
 const end=clock()+timeoutMs;while(clock()<end){if(!active())throw new Error('Task stopped while waiting for host');const value=read();if(ready(value))return value;await new Promise(r=>setTimeout(r,50));}throw Object.assign(new Error('Dependent control did not become ready. Inspect the host and review again.'),{code:'DEPENDENCY_NOT_READY'});
}
