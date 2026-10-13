import { validateSelection } from './knowledge-selection.js';
import { copilotScreenControls } from './ui-copilot-screen-specs.js';
import { isCopilotFillableField } from './ui-copilot-field-policy.js';
import {embeddedFieldAllowed,embeddedPathAllowed} from './ui-copilot-embedded-policy.js';
// Deliberately bounded UI assistance. These contracts never authorize API writes.
export const COPILOT_VERSION = 1;
export const COPILOT_FORMS = {
  broadcast_draft: {
    label:'Broadcast message draft',route:'/broadcast',permission:'broadcast',
    purpose:'Prepare message text only. Recipients, permissions and Send remain manual. Never send automatically.',
    fields:{message:{type:'string',maxLength:4000}},
  },
  scheduled_goal: {
    label:'New scheduled goal draft',route:'/scheduled-goals',permission:'scheduled-goals',
    purpose:'Prepare a NEW schedule draft only. Agent assignment, external delivery, activation and Save remain manual. Cannot modify an existing goal.',
    fields:{title:{type:'string',maxLength:200},prompt:{type:'string',maxLength:4000},cadence:{type:'string',enum:['hourly','daily','weekdays','weekly']},time_local:{type:'string',maxLength:5},weekday:{type:'integer',minimum:0,maximum:6}},
  },
  objective_draft: {
    label:'Objective brief',route:'/objectives/new',permission:'this-week',
    purpose:'Prepare objective outcome, period label and reporting currency. Currency is a draft setting, not a payment or trade. Budget, dates, authority, generated plan and saving remain manual.',
    fields:{outcome:{type:'string',maxLength:4000},period_label:{type:'string',maxLength:120},currency:{type:'string',maxLength:3,description:'Uppercase ISO currency code, such as SGD or USD.'}},
  },
  user_profile: {
    label:'Profile details',route:'/profile',permission:'profile',
    purpose:'Prepare display name, role title and display timezone only. Passwords, MFA, model credentials, retention and permissions remain user-controlled.',
    fields:{name:{type:'string',maxLength:120},role_title:{type:'string',maxLength:120},display_timezone:{type:'string',maxLength:100,description:'IANA timezone such as Asia/Singapore; empty follows browser.'}},
  },
  knowledge_table: {
    label:'Knowledge table',route:'/master-data#knowledge-tables',permission:'master-data',
    purpose:'Prepare a new table name, purpose and comma-separated column names. Existing tables and rows are not modified; user submits Create table.',
    fields:{name:{type:'string',maxLength:160},purpose:{type:'string',maxLength:2000},columns:{type:'string',maxLength:2000}},
  },
  knowledge_document: {
    label:'Knowledge document upload',route:'/master-data#knowledge-documents',permission:'master-data',
    purpose:'Prepare document title and tags only. User chooses the local file and submits upload; never read or upload a local file automatically.',
    fields:{title:{type:'string',maxLength:300},tags:{type:'string',maxLength:1000}},
  },
  knowledge_source: {
    label: 'Knowledge source', route: '/master-data#knowledge-connected', permission: 'master-data',
    purpose: 'Configure indexing using an existing company connection. External authorization is user-only.',
    fields: {
      name: { type: 'string', maxLength: 160 },
      kind: { type: 'string', enum: ['crm', 'erp', 'content', 'knowledge', 'gmail', 'outlook'] },
      collections: { type: 'array', items: ['companies', 'people', 'opportunities', 'Customer', 'Contact', 'Project', 'Sales Invoice', 'uploaded', 'generated', 'tables', 'documents', 'messages'] },
      query: { type: 'string', maxLength: 2000 },
      folder_id: { type: 'string', maxLength: 500 },
      selection: { type: 'object', description: 'Content-selection rules: mode all/any, rules [{field,operator,value}], include [field paths]. Existing Knowledge validation applies.' },
      interval_seconds: { type: 'integer', minimum: 60, maximum: 86400 },
      graph_enabled: { type: 'boolean', description: 'Connect related information; does NOT control search visibility.' }, intelligent_mapping: { type: 'boolean', description: 'Model-assisted relationship mapping.' },
      enabled: { type: 'boolean', description: 'Synchronization scheduling. false means paused/disabled sync.' }, retrieval_enabled: { type: 'boolean', description: 'Search and agent retrieval visibility. Set false when user says hidden or unavailable to search. Independent of graph_enabled and enabled.' },
    },
  },
  hire_employee: {
    label: 'Hire AI employee', route: '/workspace?copilot=hire', permission: 'ai-employees',
    purpose: 'Prepare a new employee. Template, tools, skills, reporting and permission grants require explicit review in the existing UI.',
    fields: { name: { type: 'string', maxLength: 120 }, role: { type: 'string', maxLength: 500 }, department: { type: 'string', maxLength: 120 } },
  },
};

export function copilotError(message, status = 400) { return Object.assign(new Error(message), { status }); }

export function cleanFormPatch(formId, input) {
  const form = Object.hasOwn(COPILOT_FORMS, formId) ? COPILOT_FORMS[formId] : null;
  if (!form || !input || Array.isArray(input) || typeof input !== 'object') throw copilotError('Unsupported form');
  const clean = {};
  for (const [key, value] of Object.entries(input)) {
    const field = Object.hasOwn(form.fields, key) ? form.fields[key] : null;
    if (!field) throw copilotError(`Unregistered field: ${key}`);
    if (field.type === 'string' && (typeof value !== 'string' || value.length > (field.maxLength || 2000))) throw copilotError(`Invalid ${key}`);
    if (field.enum && !field.enum.includes(value)) throw copilotError(`Invalid ${key}`);
    if(key==='display_timezone'&&value){try{new Intl.DateTimeFormat('en',{timeZone:value});}catch{throw copilotError('Invalid display timezone');}}
    if(key==='time_local'&&!/^([01]\d|2[0-3]):[0-5]\d$/.test(value))throw copilotError('Invalid schedule time');
    if(formId==='objective_draft'&&key==='currency'&&!Intl.supportedValuesOf('currency').includes(value))throw copilotError('Invalid reporting currency');
    if (field.type === 'boolean' && typeof value !== 'boolean') throw copilotError(`Invalid ${key}`);
    if (field.type === 'integer' && (!Number.isInteger(value) || value < field.minimum || value > field.maximum)) throw copilotError(`Invalid ${key}`);
    if (field.type === 'array' && (!Array.isArray(value) || value.length > 20 || value.some(v => !field.items.includes(v)))) throw copilotError(`Invalid ${key}`);
    if(key==='selection') { try {clean[key]=validateSelection(value);} catch(e){throw copilotError(e.message);} }
    else clean[key] = value;
  }
  return clean;
}

// Models sometimes call a source-defined screen fill a registered-form fill.
// Resolve only that unambiguous spelling mismatch; normal validation still
// checks field types, protected fields, values and actor permissions.
export function normalizeCopilotScreenActions(input,catalog,currentScreenId,visibleIds=[]){
  if(!Array.isArray(input?.actions))return input;
  return {...input,actions:input.actions.map(action=>{
    if(action.type!=='fill'||Object.hasOwn(catalog.forms,action.form)||action.form!==currentScreenId||!catalog.screens.some(s=>s.id===currentScreenId)||!action.values||Array.isArray(action.values)||typeof action.values!=='object')return action;
    const ids=Object.keys(action.values);
    if(!ids.length||ids.some(id=>!visibleIds.includes(id)))return action;
    return {type:'screen_fill',screen:currentScreenId,values:action.values};
  })};
}
export function validateCopilotProposal(input, catalog) {
  if (!input || typeof input.message !== 'string' || input.message.length > 6000 || !Array.isArray(input.actions) || input.actions.length > 5) throw copilotError('Invalid assistant response');
  const actions = input.actions.map(action => {
    if(action.type==='embed_navigate'){
      if(!catalog.screens.some(s=>s.id===action.screen)||!embeddedPathAllowed(action.screen,action.path))throw copilotError('Embedded destination is not available');
      return {type:'embed_navigate',screen:action.screen,path:action.path};
    }
    if(action.type==='embed_fill'){
      if(!['crm','erp'].includes(action.screen)||!catalog.screens.some(s=>s.id===action.screen))throw copilotError('Screen is not available',403);
      if(!action.values||Array.isArray(action.values)||typeof action.values!=='object'||!Object.keys(action.values).length||Object.keys(action.values).length>10)throw copilotError('Invalid embedded values');
      for(const [key,value] of Object.entries(action.values))if(!embeddedFieldAllowed(key)||typeof value!=='string'||value.length>2000)throw copilotError('Unsupported embedded field');
      return {type:'embed_fill',screen:action.screen,values:action.values};
    }
    if(action.type==='screen_fill'){
      const screen=catalog.screens.find(s=>s.id===action.screen);
      if(!screen)throw copilotError('Screen is not available',403);
      const controls=copilotScreenControls(screen.route);
      if(!action.values||Array.isArray(action.values)||typeof action.values!=='object'||!Object.keys(action.values).length||Object.keys(action.values).length>20)throw copilotError('Invalid screen values');
      const values={},labels={};
      for(const [id,value] of Object.entries(action.values)){
        const field=controls.find(c=>c.id===id);
        if(!isCopilotFillableField(field))throw copilotError('This field requires manual input');
        if(typeof value!=='string'||value.length>4000)throw copilotError('Invalid screen field value');
        values[id]=value;labels[id]=field.label;
      }
      return {type:'screen_fill',screen:screen.id,values,labels};
    }
    if(action.type==='embed_guide'){
      if(!['crm','erp'].includes(action.screen)||!catalog.screens.some(s=>s.id===action.screen))throw copilotError('Screen is not available',403);
      if(!embeddedFieldAllowed(action.field))throw copilotError('Unsupported embedded field');
      return {type:'embed_guide',screen:action.screen,field:action.field};
    }
    if(action.type==='screen_guide'){
      const screen=catalog.screens.find(s=>s.id===action.screen);
      if(!screen)throw copilotError('Screen is not available',403);
      const controls=copilotScreenControls(screen.route);
      if(!Array.isArray(action.steps)||!action.steps.length||action.steps.length>20)throw copilotError('Invalid guidance steps');
      return {type:'screen_guide',screen:screen.id,steps:action.steps.map(step=>{
        const field=controls.find(c=>c.id===step.control);
        if(!field||field.user_only||typeof step.instruction!=='string'||!step.instruction.trim()||step.instruction.length>1000)throw copilotError('Invalid guidance field');
        return {control:field.id,label:field.label,instruction:step.instruction};
      })};
    }
    if (action.type === 'guide') {
      if (!Object.hasOwn(catalog.forms, action.form)) throw copilotError('Form is not available', 403);
      if (!Array.isArray(action.steps) || !action.steps.length || action.steps.length > 20) throw copilotError('Invalid guidance steps');
      const steps = action.steps.map(step => {
        if (!Object.hasOwn(COPILOT_FORMS[action.form].fields, step.field) || typeof step.instruction !== 'string' || !step.instruction.trim() || step.instruction.length > 1000) throw copilotError('Invalid guidance field');
        return {field:step.field,instruction:step.instruction};
      });
      return {type:'guide',form:action.form,steps};
    }
    if (action.type === 'fill') {
      if (!Object.hasOwn(catalog.forms, action.form)) throw copilotError('Form is not available', 403);
      return { type: 'fill', form: action.form, values: cleanFormPatch(action.form, action.values) };
    }
    if (action.type === 'navigate') {
      const screen = catalog.screens.find(s => s.id === action.screen);
      if (!screen) throw copilotError('Screen is not available', 403);
      return { type: 'navigate', screen: screen.id, route: screen.route };
    }
    if (action.type === 'agent_chat' || action.type === 'agent_call') {
      const agent = catalog.agents.find(a => a.id === action.agent);
      if (!agent) throw copilotError('Agent is not available', 403);
      if(action.type==='agent_chat'&&typeof action.message!=='string')throw copilotError('Agent chat must include message: requested draft text, or empty string for navigation only');
      if(action.message!==undefined&&(typeof action.message!=='string'||action.message.length>2000))throw copilotError('Invalid prepared message');
      return { type: action.type, agent: agent.id, route: `/agents/${encodeURIComponent(agent.id)}/chat`, ...(typeof action.message==='string'?{message:action.message}:{}) };
    }
    if (action.type === 'watch_connector' && catalog.screens.some(s => s.id === 'connectors') && ['gmail', 'outlook', 'google-drive', 'onedrive', 'sharepoint'].includes(action.provider)) return { type: 'watch_connector', provider: action.provider };
    throw copilotError('Unsupported assistant action');
  });
  // A model may split one form into several actions. Keep one review/stepper
  // without reordering navigation or merging across different forms.
  const grouped=[];
  for(const action of actions){
    const prior=grouped.at(-1);
    if(['fill','screen_fill','embed_fill'].includes(action.type)&&prior?.type===action.type&&prior.form===action.form&&prior.screen===action.screen){
      for(const [key,value] of Object.entries(action.values)){
        if(Object.hasOwn(prior.values,key)&&JSON.stringify(prior.values[key])!==JSON.stringify(value))throw copilotError('Conflicting proposed field values');
      }
      const values={...prior.values,...action.values};
      if(Object.keys(values).length>(action.type==='embed_fill'?10:20))throw copilotError('Too many proposed fields');
      prior.values=values;
      if(action.labels)prior.labels={...prior.labels,...action.labels};
    }else grouped.push({...action,...(action.values?{values:{...action.values}}:{})});
  }
  return { message: input.message, actions:grouped };
}
