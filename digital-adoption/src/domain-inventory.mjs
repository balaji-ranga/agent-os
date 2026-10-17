const secret=/password|secret|token|credential|otp|cvv|credit.?card|api.?key|access.?key|private.?key/i;
const key=value=>typeof value==='string'&&/^[a-zA-Z][a-zA-Z0-9_-]{0,79}$/.test(value)&&!secret.test(value);
const path=value=>typeof value==='string'&&/^\/(?!\/)[^?#\\]*$/.test(value)&&value.length<=300;
const deny=()=>{throw new Error('Invalid structural inventory');};
// Structural hints are never executable references. Current visible controls
// remain a separate, freshly validated snapshot for reviews and recipe checks.
export function validateInventory(input){
 if(input===undefined)return null;
 if(!input||!Array.isArray(input.fields)||input.fields.length>500||!Array.isArray(input.forms)||input.forms.length>100||!Array.isArray(input.links)||input.links.length>100)deny();
 const fields=input.fields.map(field=>{
  if(!field||Object.keys(field).some(k=>!['key','label','type','required','form','visible','editable'].includes(k))||typeof field.label!=='string'||field.label.length>160||secret.test(field.label)||! /^[a-z-]{1,30}$/.test(field.type)||['password','hidden','file'].includes(field.type)||field.key!==undefined&&!key(field.key)||field.form!==undefined&&!key(field.form))deny();
  return {label:field.label,type:field.type,required:field.required===true,visible:field.visible===true,editable:field.editable===true,...(field.key?{key:field.key}:{}),...(field.form?{form:field.form}:{})};
 });
 const ids=new Set(),forms=input.forms.map(form=>{if(!form||!key(form.key)||ids.has(form.key)||typeof form.label!=='string'||form.label.length>160||!Array.isArray(form.fields)||form.fields.length>500||form.fields.some(k=>!fields.some(field=>field.key===k&&field.form===form.key)))deny();ids.add(form.key);return {key:form.key,label:form.label,fields:[...new Set(form.fields)]};});
 const links=input.links.map(link=>{if(!link||!path(link.path)||typeof link.label!=='string'||link.label.length>160||Object.keys(link).some(k=>!['label','path','visible'].includes(k)))deny();return {path:link.path,label:link.label,visible:link.visible===true};});
 return {fields,forms,links,truncated:input.truncated===true,limits:{fields:500,forms:100,links:100},coverage:'DOM structure only; hidden or disabled controls require a fresh visible review; private controls and unloaded states are excluded'};
}
