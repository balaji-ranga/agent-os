// Explicitly test-only entry, never imported by the production application.
import React from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter, Routes, Route, Link } from 'react-router-dom';
import { AuthProvider } from '../src/context/AuthContext.jsx';
import { api } from '../src/api.js';
import PlatformHelpCopilot from '../src/components/PlatformHelpCopilot.jsx';
import KnowledgeSources from '../src/components/KnowledgeSources.jsx';
import AddAgentForm from '../src/components/AddAgentForm.jsx';
import Broadcast from '../src/pages/Broadcast.jsx';
import '../src/index.css';
let session=null,seq=0;
const forms={knowledge_source:{label:'Knowledge source',route:'/master-data#knowledge-connected',purpose:'Prepare existing connected content'},hire_employee:{label:'Hire AI employee',route:'/workspace?copilot=hire',purpose:'Prepare employee fields; save separately'}};
api.authMe=async()=>({user:{id:'copilot-fixture',role:'ceo',name:'Local test user'},agents:[]});
api.copilotCatalog=async()=>({forms,agents:[],screens:[{id:'connectors',route:'/connectors'},{id:'broadcast',label:'Broadcast',route:'/broadcast'}]});
api.copilotSession=async()=>({session});
api.copilotCreate=async body=>(session={id:'fixture',version:1,status:'active',mode:'hybrid',origin:body.origin,drafts:{}});
api.copilotUpdate=async(id,body)=>{
  if(body.version!==session.version)throw new Error('Stale session');
  const {draft,version,...rest}=body;session={...session,...rest,version:version+1,drafts:draft?{...session.drafts,[draft.form]:draft.values}:session.drafts};return session;
};
api.copilotPropose=async(id,body)=>{
  if(body.message==='test recoverable error')throw new Error('Synthetic retryable error. No fields changed.');
  if(body.screen==='broadcast'){
    const control=body.visible_control_ids.find(id=>id.startsWith('pages/Broadcast.jsx:'));
    session={...session,version:session.version+1,proposal:{message:'Review this unsent draft.',actions:[{type:'screen_fill',screen:'broadcast',values:{[control]:'Synthetic unsent browser-driver test'},labels:{[control]:'Message'}}]}};return session;
  }
  const action=body.message.includes('employee')?{type:'fill',form:'hire_employee',values:{name:'Demo researcher',role:'Research analyst',department:'Research'}}:{type:'fill',form:'knowledge_source',values:{name:'Copilot local fixture',kind:'content',collections:['generated'],interval_seconds:600,enabled:false}};
  session={...session,version:session.version+1,proposal:{message:'Review the fields. Save only using the real form.',actions:session.mode==='guided'?[{type:'guide',form:action.form,steps:[{field:'name',instruction:'Enter a descriptive name on the form.'}]}]:[action]}};return session;
};
api.knowledgeSources=async()=>({sources:[]});
const recording={id:'fixture-recipe',title:'Local replay fixture',version:1,status:'published',steps:[{screen:'connectors',path:'/connectors',action:'verify',instruction:'Inspect the connectors screen without saving.',success:'Connectors page is open.',fields:[]}]};
api.copilotCoaching=async()=>({recipes:[recording],examples:[],next_offset:null});
api.copilotCoachingGet=async()=>structuredClone(recording);
api.copilotCoachingMap=async()=>({nodes:[],edges:[],truncated:false});
api.knowledgeSelectionSchema=async()=>({fields:[],operators:[]});
api.knowledgeRelationshipPage=async()=>({items:[],next:null});
api.masterDataTables=async()=>({tables:[]});
api.knowledgeSourceSave=async()=>{document.getElementById('save-count').textContent=String(++seq);return {id:'synthetic-source'};};
api.agentHireTemplates=async()=>({templates:[]});
api.orgDepartments=async()=>({departments:[]});
api.openconnectorApps=async()=>({apps:[]});
api.agentsList=async()=>[];
api.broadcastSend=async()=>{throw new Error('Sending is forbidden in this harness');};
localStorage.setItem('agent-os-auth-token','local-synthetic-harness-only');
function Harness(){return <><div className="page"><h1>Copilot local UI harness</h1><p>Deterministic UI test. No production or provider requests.</p><p>Saved objects: <strong id="save-count">0</strong></p><Link to="/master-data">Knowledge</Link> · <Link to="/workspace?copilot=hire">Hire</Link> · <Link to="/connectors">Connectors</Link> · <Link to="/broadcast">Broadcast</Link><Routes><Route path="/master-data" element={<KnowledgeSources/>}/><Route path="/workspace" element={<AddAgentForm/>}/><Route path="/broadcast" element={<Broadcast/>}/><Route path="*" element={<p>Open Knowledge or Hire to test the registered form.</p>}/></Routes></div><PlatformHelpCopilot/></>;}
createRoot(document.getElementById('root')).render(<AuthProvider><MemoryRouter initialEntries={['/master-data']}><Harness/></MemoryRouter></AuthProvider>);
