import {createPhysicalEvidenceStore} from './evidence-store.js';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import { getDb } from '../../db/schema.js';
import { getActionFamilyPolicies, evaluateActionPolicy, previewActionPolicy } from '../action-policy.js';
import { PhysicalControlPlane, sqliteStore } from './control-plane.js';
let plane;
export function getPhysicalControlPlane(){
  if(process.env.FLOLAH_PHYSICAL_ENABLED!=='1')throw Object.assign(new Error('Physical AI is not enabled'),{status:404});
  if(!plane)plane=new PhysicalControlPlane(sqliteStore(getDb()),{evidenceStore:createPhysicalEvidenceStore(join(process.env.AGENT_OS_DATA_DIR||fileURLToPath(new URL('../../../data',import.meta.url)),'physical-evidence')),companyPolicy(owner,action,input,context){
    if(context){
      const request={ownerUserId:owner,toolName:'physical_invoke',body:{entityId:context.entityId,action,input},context:{workflowId:context.workflowId,agentId:context.agentId}};
      // Reuse an already evaluated tool grant; workflows consume their scoped grant here.
      // Dispatch previews prohibitions without consuming a bounded grant a second time.
      const decision=context.phase==='dispatch'?previewActionPolicy(request):context.evaluatedDecision||evaluateActionPolicy(request);
      return {ok:decision.ok||decision.needs_approval===true,requiresApproval:context.phase==='dispatch'?false:decision.needs_approval===true};
    }
    const mode=getActionFamilyPolicies(owner).find(p=>p.family==='communicate_external')?.mode||'approval_required';
    return {ok:mode!=='prohibited',requiresApproval:mode==='approval_required'};
  }});
  return plane;
}
