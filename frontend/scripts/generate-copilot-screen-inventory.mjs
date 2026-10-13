// Source inventory, not DOM scraping or an authorization mechanism.
// Every input-bearing module is catalogued. Only reviewed React adapters may autofill.
import { readdirSync, readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { sourceFieldLabel } from './copilot-field-labels.mjs';
const require=createRequire(import.meta.url),{parse}=require('@babel/parser');
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..'),src=join(root,'src');
const files=[];
function scan(dir){for(const item of readdirSync(dir,{withFileTypes:true})){const p=join(dir,item.name);if(item.isDirectory())scan(p);else if(/\.[jt]sx$/.test(p))files.push(p);}}
scan(join(src,'pages'));scan(join(src,'components'));
const trees=new Map(),modules=new Map();
const walk=(node,fn,anc=[])=>{if(!node||typeof node!=='object')return; if(node.type)fn(node,anc);for(const [k,v] of Object.entries(node)){if(['loc','start','end','comments','tokens'].includes(k))continue;if(Array.isArray(v))v.forEach(n=>walk(n,fn,[...anc,node]));else if(v&&typeof v==='object')walk(v,fn,[...anc,node]);}};
const attr=(node,key)=>node.attributes?.find(a=>a.type==='JSXAttribute'&&a.name.name===key)?.value;
const literal=v=>v?.type==='StringLiteral'?v.value:v?.type==='JSXExpressionContainer'&&['StringLiteral','NumericLiteral','BooleanLiteral'].includes(v.expression?.type)?v.expression.value:null;
const labelText=node=>(node?.children||[]).filter(n=>n.type==='JSXText').map(n=>n.value.trim()).filter(Boolean).join(' ').replace(/\s+/g,' ').slice(0,180);
const resolveImport=(file,name)=>{if(!name.startsWith('.'))return null;const base=resolve(dirname(file),name);return [base,base+'.jsx',base+'.tsx',join(base,'index.jsx')].find(p=>existsSync(p)&&/\.[jt]sx$/.test(p));};
for(const file of [...files,join(src,'App.jsx')]){
 const code=readFileSync(file,'utf8'),tree=parse(code,{sourceType:'module',plugins:['jsx','typescript']});trees.set(file,tree);
 const imports=new Map();for(const n of tree.program.body)if(n.type==='ImportDeclaration'){const target=resolveImport(file,n.source.value);if(target)for(const s of n.specifiers)imports.set(s.local.name,target);}
 const controls=[];let formCount=0;
 walk(tree,(n,anc)=>{if(n.type!=='JSXOpeningElement')return;const tag=n.name?.name;if(tag==='form')formCount++;if(!['input','select','textarea'].includes(tag))return;
  const type=literal(attr(n,'type'))||(tag==='input'?'text':tag);
  const label=sourceFieldLabel(n,anc);
  const protectedField=type==='password'||type==='file'||/password|secret|api.?key|token|credential|payment|credit.?card|permission|grant|mfa|otp|authorization/i.test(String(label));
  controls.push({id:`${relative(src,file).replaceAll('\\','/')}:${n.loc.start.line}:${n.loc.start.column}`,label:String(label),type,required:!!n.attributes.find(a=>a.name?.name==='required'),...(literal(attr(n,'min'))!==null?{min:literal(attr(n,'min'))}:{}),...(literal(attr(n,'max'))!==null?{max:literal(attr(n,'max'))}:{}),mode:'guided',...(protectedField?{user_only:true}:{}),...(tag==='select'?{options:'Use the live authorized options shown on this screen.'}:{})});
 });
 modules.set(file,{source:relative(src,file).replaceAll('\\','/'),form_count:formCount,controls,imports});
}
const routes=[];
walk(trees.get(join(src,'App.jsx')),(n,anc)=>{if(n.type!=='JSXOpeningElement'||n.name.name!=='Route')return;const path=literal(attr(n,'path')),element=attr(n,'element');if(!path||path==='*'||!element)return;
 const entry=[];walk(element,x=>{if(x.type==='JSXOpeningElement'){const target=modules.get(join(src,'App.jsx')).imports.get(x.name.name);if(target)entry.push(target);}});
 const found=new Set(),seen=new Set();function visit(file){if(seen.has(file)||!modules.has(file))return;seen.add(file);const m=modules.get(file);if(m.controls.length&&!/PlatformHelpCopilot|PrivilegedSessionGate/.test(m.source))found.add(m.source);for(const next of m.imports.values())visit(next);}
 entry.forEach(visit);if(found.size)routes.push({path,modules:[...found].sort()});
});
const output={version:1,description:'Source-derived form guidance inventory. Not an autofill allowlist. Reviewed form adapters are separately registered and enforced.',modules:[...modules.values()].filter(m=>m.controls.length&&!m.source.endsWith('App.jsx')).map(({imports,...m})=>m).sort((a,b)=>a.source.localeCompare(b.source)),routes:routes.sort((a,b)=>a.path.localeCompare(b.path))};
const json=JSON.stringify(output,null,2)+'\n';
const targets=[join(src,'generated/copilot-screen-inventory.json'),resolve(root,'../backend/src/generated/copilot-screen-inventory.json')];
for(const target of targets){if(process.argv.includes('--check')){if(!existsSync(target)&&target.includes(`${join('backend','src')}`))continue;if(readFileSync(target,'utf8').replaceAll('\r\n','\n')!==json)throw new Error(`Copilot inventory drift: regenerate ${target}`);}else{mkdirSync(dirname(target),{recursive:true});writeFileSync(target,json);}}
console.log(`COPILOT_INVENTORY_OK: ${output.modules.length} input-bearing modules; ${routes.length} routes. Unreviewed controls remain guided-only.`);
