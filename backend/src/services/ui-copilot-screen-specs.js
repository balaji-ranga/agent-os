import { readFileSync } from 'node:fs';
const inventory=JSON.parse(readFileSync(new URL('../generated/copilot-screen-inventory.json',import.meta.url),'utf8'));
const modules=new Map(inventory.modules.map(m=>[m.source,m]));
export function copilotScreenSpec(route){
 const record=inventory.routes.find(r=>r.path===route);
 if(!record)return {mode:'guided',guidance:'Use the existing screen controls; no autofill adapter is registered.'};
 return {mode:'guided',guidance:'This source-controlled screen inventory describes available controls, not permission to change them. Only separately registered forms support autofill. Secret entry, uploads and security-sensitive actions remain user-controlled. Dynamic options must be selected from the current authorized screen.',modules:record.modules.map(id=>modules.get(id)).filter(Boolean).map(m=>({name:m.source.split('/').pop().replace(/\.jsx$/,''),fields:m.controls.map(({label,type,user_only,required})=>({label,type,required,...(user_only?{user_only:true}:{})}))}))};
}
