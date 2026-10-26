import {currentFloAssistScope} from './execution-scope.js';
export function normalizeDriveReadInput(action,input,context=currentFloAssistScope()){
 if(context?.run&&action==='googledrive.files.list'&&input.includeItemsFromAllDrives===true&&input.supportsAllDrives===undefined)return {...input,supportsAllDrives:true};
 return input;
}
export function normalizeDriveReadError(action,error){
 if(action==='googledrive.files.list'&&/supportsAllDrives parameter was not set to true/i.test(String(error?.message||''))){error.code='invalid_input';error.provider_status=400;}
 return error;
}
