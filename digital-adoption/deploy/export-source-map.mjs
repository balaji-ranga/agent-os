// Optional build adapter. Reads a supplied source inventory; the runtime has no
// dependency on a host repository. Review the output for its intended audience.
import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
const [inputPath,origin,outputPath]=process.argv.slice(2);
if(!inputPath||!outputPath||new URL(origin).origin!==origin)throw new Error('Usage: export-source-map.mjs INVENTORY_JSON EXACT_ORIGIN OUTPUT_JSON');
const input=JSON.parse(readFileSync(inputPath,'utf8')),modules=new Map(input.modules.map(m=>[m.source,m]));
const identifier=value=>'source_'+createHash('sha256').update(String(value)).digest('hex').slice(0,24);
const label=(value,fallback)=>typeof value==='string'&&value.trim()?value.trim().slice(0,160):fallback;
const types=new Set(['text','number','email','date','textarea','url','tel','search','select-one','checkbox']);
const screens=input.routes.map(route=>{
 const parts=route.modules.map(id=>modules.get(id)).filter(Boolean),forms=parts.flatMap(m=>m.forms||[]).map(f=>({id:identifier(f.id),label:label(f.label,'Unnamed source form')}));
 const fields=parts.flatMap(m=>m.controls||[]).filter(f=>!f.readonly&&types.has(f.type==='select'?'select-one':f.type)).map(f=>({key:identifier(f.id),label:label(f.label,'Unlabelled source field'),type:f.type==='select'?'select-one':f.type,required:f.required===true,...(f.form_id&&forms.some(form=>form.id===identifier(f.form_id))?{form:identifier(f.form_id)}:{})}));
 return {path:route.path,title:label(parts.flatMap(m=>m.headings||[])[0],route.path),forms:[...new Map(forms.map(f=>[f.id,f])).values()],fields:[...new Map(fields.map(f=>[f.key,f])).values()]};
});
const result={schema:1,origin,screens};writeFileSync(outputPath,JSON.stringify(result,null,2));
console.log(JSON.stringify({screens:screens.length,forms:screens.reduce((n,s)=>n+s.forms.length,0),fields:screens.reduce((n,s)=>n+s.fields.length,0),reviewRequired:true,evidence:'source_metadata_only',note:'Review route/audience scope before importing. Hashed source keys are hints, never live refs; teaching drafts need current-screen mapping and validation.'}));
