// One response/action contract for every screen and every bounded repair pass.
// This describes capabilities, never authorizes a write or widens validation.
import {copilotError} from './ui-copilot-contract.js';

export const COPILOT_RESPONSE_POLICY=`
Return a JSON INSTANCE with exactly message (a friendly string) and actions (an
array of zero to five supported action objects), not a JSON schema or instructions.
The response_contract metadata describes the action namespaces; do not return that
metadata as your answer. Screen IDs, registered form IDs and source control IDs
are DIFFERENT namespaces. Never put a form ID in an action's screen property.
Use fill only for an exact registered form key and its registered field names.
A registered form covers ONLY its own fields, not every setting on that screen.
If the requested setting is a currently visible native field outside that form,
use screen_fill with its exact source control ID and allowed dropdown value.
If that setting is on ANOTHER authorized screen, return only navigate to its
catalog screen ID first. The browser continues the ORIGINAL request after
inspecting that screen. Never put off-screen source fields into a narrower
registered adapter, or invent current dropdown options before inspection.
Do not claim a visible eligible setting is unsupported just because it is absent
from a registered form. Do not invent aliases, fields or dropdown values.
Prepare a partial PATCH: leave all unrelated existing fields unchanged. Required
fields on a screen are not requests to collect name, email or other existing data.
Ask only for genuinely missing information needed for the requested change.
Guided mode permits the SAME reviewed patches; the browser sequences approvals.
Preparing fields is NOT saving. Never save, submit, change access, enter secrets
or claim completion. All permissions, protected-field and live-DOM checks remain
mandatory. If a setting is protected or unavailable, explain the manual step with
actions: [] instead of inventing an action or requesting unrelated information.
Source-map recipes describe a reusable journey, NOT a mandatory list of actions.
Skip navigation when the requested screen and fields are already observed open.
Prepare the current requested patch rather than replaying completed recipe steps.
Copy explicitly quoted user values exactly. Phrases such as "for review only",
"do not save" and "leave other fields unchanged" are constraints, not field data.
`;

export function reconcileCopilotCurrentNavigation(proposal,screen,visible=[]){
  if(!screen)return proposal;
  const currentPatch=proposal.actions.some(a=>a.type==='screen_fill'&&a.screen===screen.id&&Object.keys(a.values).every(id=>visible.includes(id)));
  if(!currentPatch||!proposal.actions.every(a=>['screen_fill','screen_guide','navigate'].includes(a.type)&&a.screen===screen.id))return proposal;
  return {...proposal,actions:proposal.actions.filter(a=>a.type!=='navigate')};
}

export function parseCopilotResponse(content){
  if(typeof content!=='string'||content.length>64000)throw copilotError('Invalid assistant response');
  const text=content.trim();
  // Accept only a single whole-response JSON fence; never extract executable
  // instructions or a convenient object from surrounding prose/trailing data.
  const fenced=/^```(?:json)?\s*\n([\s\S]*?)\n```$/i.exec(text);
  return JSON.parse(fenced?fenced[1]:text);
}

export function copilotResponseContract(catalog,currentScreen,currentSpec){
  const fields=(currentSpec?.modules||[]).flatMap(m=>m.fields).filter(f=>f.autofill_allowed);
  return {response_contract:{
    output:{message:'string, up to 6000 characters',actions:'array, zero to five action instances'},
    screen_ids:catalog.screens.map(s=>s.id),
    registered_forms:Object.fromEntries(Object.entries(catalog.forms).map(([id,form])=>[id,{route:form.route,fields:Object.keys(form.fields)}])),
    action_shapes:{
      navigate:{type:'navigate',screen:'one exact screen_ids entry'},
      fill:{type:'fill',form:'one exact registered_forms key',values:'partial object of that form\'s registered fields with their declared types'},
      screen_fill:{type:'screen_fill',screen:currentScreen?.id||null,values:'partial object: exact native_fields IDs -> string values; dropdowns require exact allowed_options values'},
      guide:{type:'guide',form:'one exact registered_forms key',steps:[{field:'registered field name',instruction:'plain-language guidance'}]},
      screen_guide:{type:'screen_guide',screen:currentScreen?.id||null,steps:[{control:'exact current_screen field ID, never a user_only field',instruction:'plain-language guidance'}]},
      embed_fill:{type:'embed_fill',screen:'current crm or erp screen only',values:'currently observed embedded field IDs -> string values'},
      embed_guide:{type:'embed_guide',screen:'current crm or erp screen only',field:'currently observed embedded field ID'},
      embed_navigate:{type:'embed_navigate',screen:'current crm or erp screen only',path:'exact observed available_embedded_navigation path'},
      embed_open_form:{type:'embed_open_form',screen:'current crm or erp screen only',label:'exact observed available_embedded_forms label'},
      agent_chat:{type:'agent_chat',agent:'exact entitled catalog agent ID',message:'requested unsent draft text, or empty string for navigation'},
      agent_call:{type:'agent_call',agent:'exact entitled catalog agent ID'},
      watch_connector:{type:'watch_connector',provider:'gmail|outlook|google-drive|onedrive|sharepoint; requires authorized Connectors access'},
    },
    native_fields:fields.map(({id,label,type,allowed_options,...schema})=>({id,label,type,...schema,value_type:'string',...(type==='select'?{allowed_options}: {})})),
    note:'Schema guidance only; current user intent, registered validators, observed metadata, actor permissions and explicit UI review remain authoritative.',
  }};
}

const pathOf=route=>String(route||'').split(/[?#]/)[0];
export function targetsCurrentNativeControls(actions,catalog,screen){
  if(!screen||!Array.isArray(actions)||!actions.length)return false;
  return actions.every(a=>{
    if(!a||typeof a!=='object')return false;
    if(a.type==='screen_fill')return a.screen===screen.id;
    if(a.type!=='fill')return false;
    if(a.form===screen.id&&!Object.hasOwn(catalog.forms,a.form))return true;
    // A partial registered adapter on the SAME screen is not a capability
    // boundary. Repair its unregistered fields against the observed controls.
    const form=Object.hasOwn(catalog.forms,a.form)?catalog.forms[a.form]:null;
    return !!form&&pathOf(form.route)===pathOf(screen.route)&&a.values&&typeof a.values==='object'&&!Array.isArray(a.values)&&Object.keys(a.values).some(k=>!Object.hasOwn(form.fields,k));
  });
}

export function copilotValidationCategory(error){
  if(error instanceof SyntaxError)return 'invalid_json';
  const text=String(error?.message||'');
  if(text.startsWith('Unregistered field:'))return 'unregistered_form_field';
  if(text==='Screen is not available')return 'unavailable_screen_id';
  if(text==='Form is not available')return 'unavailable_form_id';
  if(/manual input/.test(text))return 'protected_field';
  if(/permitted option/.test(text))return 'invalid_live_option';
  if(/currently (?:visible|available|observed)/.test(text))return 'unobserved_target';
  if(/Invalid assistant|Unsupported assistant action/.test(text))return 'invalid_response_shape';
  return 'contract_validation';
}
