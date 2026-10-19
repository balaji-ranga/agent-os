import {formValidation} from './host-observation.mjs';
// Explicit user-requested native form submission, separate from model filling.
// Only local state is retained here; values never enter the shared map.
export function createSubmitController(document,{visible,excluded,label}){
 let revision=0,targets=new Map();const savedBaselines=new WeakMap(),fieldState=e=>JSON.stringify([e.value,e.checked,e.options?[...e.options].map(o=>o.selected):null]);
 const state=form=>JSON.stringify([...form.elements].map(e=>[e,e.name,e.type,e.value,e.checked,e.disabled,e.required].slice(1)));
 const statuses=()=>[...document.querySelectorAll('[role="status"],[role="alert"]')].filter(e=>visible(e)&&!excluded(e)).map(e=>(e.textContent||'').trim().slice(0,500));
 const destination=element=>{const form=element.form,url=new URL(element.getAttribute('formaction')||form.action||document.location.href,document.location.href);return JSON.stringify({url:url.href,method:element.getAttribute('formmethod')||form.method,target:element.getAttribute('formtarget')||form.target||'_self'});};
 const safe=form=>![...form.elements].some(e=>/password|file/.test(e.type||'')||/password|secret|token|otp|cvv|credit.?card|api.?key|private.?key/i.test(`${e.name||''} ${e.autocomplete||''}`));
 const safeDestination=element=>{const details=JSON.parse(destination(element)),url=new URL(details.url);return url.origin===document.location.origin&&!url.username&&!url.password&&['_self',''].includes(details.target);};
 return {
  matchesSavedBaseline(element){return savedBaselines.has(element)&&savedBaselines.get(element)===fieldState(element);},
  snapshot(nextRevision){
   revision=nextRevision;targets=new Map();
   return [...document.querySelectorAll('button,input[type="submit"]')].filter(e=>e.type==='submit'&&e.form&&visible(e)&&!excluded(e)&&safe(e.form)&&safeDestination(e)).slice(0,10).map((e,i)=>{
    const ref=`r${revision}s${i}`,name=(e.getAttribute('aria-label')||e.textContent||e.value||'Submit form').trim().slice(0,160);
    targets.set(ref,{element:e,form:e.form,label:name,state:state(e.form),destination:destination(e),path:document.location.pathname,controls:[...e.form.elements]});return {ref,label:name};
   });
  },
  async submit({ref,expectedRevision,approved,active=()=>true,observationMs=5000}){
   const record=targets.get(ref),element=record?.element;
   if(approved!==true||expectedRevision!==revision||!element?.isConnected||!record.form.isConnected||!visible(element)||excluded(element)||element.form!==record.form||!safe(record.form)||state(record.form)!==record.state||record.controls.some((e,i)=>record.form.elements[i]!==e)||record.controls.length!==record.form.elements.length)throw new Error('Form changed; prepare and approve Save again');
   const name=(element.getAttribute('aria-label')||element.textContent||element.value||'Submit form').trim().slice(0,160);
   if(name!==record.label||element.type!=='submit'||record.path!==document.location.pathname||destination(element)!==record.destination||!safeDestination(element))throw new Error('Save control changed; inspect again');
   if(!record.form.checkValidity())throw Object.assign(new Error('Nothing was submitted. Review '+formValidation(record.form,label).map(f=>`${f.label}: ${f.reason}`).join('; ')),{code:'FIELD_VALIDATION'});
   if(!active())throw new Error('Save cancelled before dispatch');
   const reviewedValues=new Map([...record.form.elements].map(e=>[e,fieldState(e)]));
   const before=statuses();targets.delete(ref); // Consume before a potentially effectful click.
   element.click();
   for(let attempt=0;attempt<Math.max(10,Math.min(100,Math.floor(observationMs/100)));attempt++){
    if(!active())return {dispatched:true,outcomeObserved:false,businessVerified:false,reason:'Observation stopped after dispatch; do not retry blindly.'};
    const changed=statuses().filter(text=>text&&!before.includes(text));
    const error=changed.find(text=>/\b(error|failed|invalid|unable|not saved|not created)\b/i.test(text));
    if(error)return {dispatched:true,outcomeObserved:true,businessVerified:false,hostReported:'failure',message:error};
    const success=changed.find(text=>/\b(saved|created|submitted|successfully|success)\b/i.test(text)&&! /\b(not|failed|error|unable)\b/i.test(text));
    if(success){for(const [field,value]of reviewedValues)if(field.isConnected&&field.form===record.form&&fieldState(field)===value)savedBaselines.set(field,value);return {dispatched:true,outcomeObserved:true,businessVerified:false,hostReported:'success',message:success};}
    await new Promise(resolve=>setTimeout(resolve,100));
   }
   return {dispatched:true,outcomeObserved:false,businessVerified:false,reason:'No new host success state observed. Inspect the saved record before any retry.'};
  },
 };
}
