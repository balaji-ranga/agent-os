// Source-controlled starter lessons, not recordings or claims of live acceptance.
export const COPILOT_COACHING_EXAMPLES=[
  {id:'crm-opportunity',screen:'crm',title:'CRM — create an opportunity',steps:[
    'Navigate through the observed Opportunities link; wait until its list is ready.',
    'Review the observed New/Add action separately: this CRM may create immediately.',
    'Inspect the resulting record or preview. Map the requested name, numeric amount and ISO currency separately.',
    'Review and fill supported controls; reopen the same record to verify persistence. Never repeat New to recover a field failure.'
  ]},
  {id:'crm-note',screen:'crm',title:'CRM — create a follow-up note',steps:[
    'Find Notes using observed navigation, then identify its actual New/Add control, including empty-list variants.',
    'Obtain creation approval, then inspect the new preview or full record.',
    'Map title and body separately. Rich-text body is not a plain input: if the current control adapter cannot safely fill it, guide the user instead of claiming success.',
    'Verify the title and body after reopening the same note; do not create a duplicate.'
  ]},
  {id:'erp-customer',screen:'erp',title:'ERP — prepare a customer',steps:[
    'Navigate to Customer using the current authorized ERP navigation.',
    'Observe New and inspect the actual dialog or form before proposing values.',
    'Map supplied customer name and customer type; ask for missing mandatory group/territory rather than inventing them.',
    'Review fields. Save is a separate user action; verify the saved identifier and status after Save.'
  ]},
  {id:'erp-project',screen:'erp',title:'ERP — prepare a project',steps:[
    'Locate Project using observed ERP navigation and inspect its New form.',
    'Map project name, supplied dates and description to the observed fields. Resolve linked records through the UI; do not invent IDs.',
    'Ask for required missing choices and review the proposed patch.',
    'Keep Save separate. Verify the resulting project and dates from the UI.'
  ]},
  {id:'erp-task',screen:'erp',title:'ERP — prepare a task',steps:[
    'Locate Task and inspect the observed New form.',
    'Map subject, description and dates. Select the authorized project only if the user requested one.',
    'Use the appropriate visible rich-text/control handler or guide manually if unsupported.',
    'Review before saving; verify the task exists once, with the expected subject.'
  ]}
].map(x=>({...x,version:1,status:'starter_unverified',requires_coaching:true}));
