import {currentFloAssistScope} from './execution-scope.js';
export function normalizeDriveReadInput(action,input,context=currentFloAssistScope(),now=Date.now()){
 if(context?.origin==='floassist:deadlines'&&context.run&&action==='googledrive.files.list'){
   const since=new Date(now-7*86400000).toISOString();
   const base=typeof input.q==='string'&&input.q.trim()?`(${input.q.trim()}) and `:'';
   input={...input,q:`${base}modifiedTime > '${since}' and trashed = false`,pageSize:Math.min(40,Math.max(1,Number(input.pageSize)||40)),orderBy:'modifiedTime desc'};
 }

 if(context?.run&&action==='googledrive.files.list'&&input.includeItemsFromAllDrives===true&&input.supportsAllDrives===undefined)return {...input,supportsAllDrives:true};
 return input;
}
export function normalizeDriveReadError(action,error){
 if(action==='googledrive.files.list'&&/supportsAllDrives parameter was not set to true/i.test(String(error?.message||''))){error.code='invalid_input';error.provider_status=400;}
 return error;
}
