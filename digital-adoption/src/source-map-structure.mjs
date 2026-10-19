// Convert persisted observations to importable STRUCTURE. No values or live refs.
const safeKey=value=>typeof value==='string'&&/^[a-zA-Z][a-zA-Z0-9_-]{0,79}$/.test(value)&&!/password|secret|token|credential|otp|cvv|credit.?card|api.?key|access.?key|private.?key/i.test(value);
const types=new Set(['text','number','email','date','textarea','url','tel','search','select-one','select-multiple','radio','checkbox','combobox']);
export function observedSourceScreen(screen){
 const inventory=screen.inventory||screen,forms=[];
 for(const f of inventory.forms||[]){const id=f.key||f.id;if(safeKey(id)&&!forms.some(x=>x.id===id))forms.push({id,label:f.label||id});}
 const candidates=(inventory.fields||[]).filter(f=>safeKey(f.key)&&types.has(f.type==='select'?'select-one':f.type));
 const fields=candidates.filter(f=>candidates.filter(other=>other.key===f.key).length===1).map(f=>({key:f.key,label:f.label||f.key,type:f.type==='select'?'select-one':f.type,required:f.required===true,...(forms.some(form=>form.id===f.form)?{form:f.form}:{})}));
 const safePath=value=>typeof value==='string'&&/^\/(?!\/)[^?#\\]*$/.test(value)&&value.length<=300&&!/\/(?:\d{5,}|[a-f0-9-]{32,36})(?:\/|$)/i.test(value)&&!value.includes('..');
 return {path:screen.path,title:(screen.title||screen.path).slice(0,160),forms,fields,links:(inventory.links||[]).filter(l=>safePath(l.path)).map(({path,label})=>({path,label:label||path}))};
}

export function mergeSourceScreen(observed,hint){
 if(!observed)return structuredClone(hint);
 const result=observedSourceScreen(observed);
 if(!hint)return result;
 const merge=(left,right,key)=>[...left.map(item=>({...item,...right.find(r=>r[key]===item[key])})),...right.filter(item=>!left.some(l=>l[key]===item[key]))];
 return {...result,...hint,forms:merge(result.forms,hint.forms,'id'),fields:merge(result.fields,hint.fields,'key'),links:merge(result.links,hint.links||[],'path')};
}
