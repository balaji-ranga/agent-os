import { validateSelection } from './knowledge-selection.js';
// Deliberately bounded UI assistance. These contracts never authorize API writes.
export const COPILOT_VERSION = 1;
export const COPILOT_FORMS = {
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
    if (field.type === 'boolean' && typeof value !== 'boolean') throw copilotError(`Invalid ${key}`);
    if (field.type === 'integer' && (!Number.isInteger(value) || value < field.minimum || value > field.maximum)) throw copilotError(`Invalid ${key}`);
    if (field.type === 'array' && (!Array.isArray(value) || value.length > 20 || value.some(v => !field.items.includes(v)))) throw copilotError(`Invalid ${key}`);
    if(key==='selection') { try {clean[key]=validateSelection(value);} catch(e){throw copilotError(e.message);} }
    else clean[key] = value;
  }
  return clean;
}

export function validateCopilotProposal(input, catalog) {
  if (!input || typeof input.message !== 'string' || input.message.length > 6000 || !Array.isArray(input.actions) || input.actions.length > 5) throw copilotError('Invalid assistant response');
  const actions = input.actions.map(action => {
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
      if(action.message!==undefined&&(typeof action.message!=='string'||action.message.length>2000))throw copilotError('Invalid prepared message');
      return { type: action.type, agent: agent.id, route: `/agents/${encodeURIComponent(agent.id)}/chat`, ...(action.message?{message:action.message}:{}) };
    }
    if (action.type === 'watch_connector' && catalog.screens.some(s => s.id === 'connectors') && ['gmail', 'outlook', 'google-drive', 'onedrive', 'sharepoint'].includes(action.provider)) return { type: 'watch_connector', provider: action.provider };
    throw copilotError('Unsupported assistant action');
  });
  return { message: input.message, actions };
}
