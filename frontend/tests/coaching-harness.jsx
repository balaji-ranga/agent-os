// Test-only deterministic UI. Backend isolation/version checks have their own HTTP harness.
import React,{useState} from 'react';
import {createRoot} from 'react-dom/client';
import {api} from '../src/api.js';
import CopilotCoaching from '../src/components/CopilotCoaching.jsx';
import {COPILOT_COACHING_EXAMPLES} from '../../backend/src/services/ui-copilot-coaching-examples.js';
import '../src/index.css';
import '../src/components/PlatformHelpCopilot.css';
let recipes=[];
api.copilotCoaching=async()=>({recipes:structuredClone(recipes),next_offset:null,examples:COPILOT_COACHING_EXAMPLES});
api.copilotCoachingMap=async()=>({nodes:[],edges:[],truncated:false});
api.copilotCoachingCreate=async title=>{const r={id:crypto.randomUUID(),version:1,status:'draft',title,steps:[]};recipes.push(r);return structuredClone(r);};
api.copilotCoachingUpdate=async(id,b)=>{const r=recipes.find(x=>x.id===id);if(r.version!==b.version)throw Error('Version conflict');r.version++;r.status=b.status||'draft';if(b.step)r.steps.push(b.step);if(b.remove_last)r.steps.pop();return structuredClone(r);};
const catalog={screens:[{id:'connectors',route:'/connectors'},{id:'master-data',route:'/master-data'},{id:'crm',route:'/crm'},{id:'erp',route:'/erp'}]};
function Test(){const [path,setPath]=useState('/connectors');return <main style={{maxWidth:760,margin:'2rem auto',padding:'1rem'}}><h1>Coaching UI local acceptance</h1><p>Synthetic metadata only. No provider calls or business records.</p><button onClick={()=>setPath('/connectors')}>Show Connectors</button><button onClick={()=>setPath('/master-data')}>Show Knowledge</button><p>Current screen: {path}</p><input aria-label="Private test field" data-copilot-control="fixture.name" defaultValue="MUST NOT BE RECORDED"/><div className="copilot-panel" style={{position:'static',width:'100%',maxHeight:'none'}}><CopilotCoaching catalog={catalog} path={path}/></div></main>;}
createRoot(document.getElementById('root')).render(<Test/>);
