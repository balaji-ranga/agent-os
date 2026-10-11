// Read-only readiness check. Run from the backend container using its existing runtime.
import { listUsers } from '/opt/agent-os/backend/src/services/users.js';
import { getBusinessProfile } from '/opt/agent-os/backend/src/services/company-business-profile.js';
const result=listUsers();
const users=Array.isArray(result)?result:(result.users||[]);
for(const user of users.filter(u=>/test|demo|e2e/i.test(`${u.name||''} ${u.email||''}`))) {
  const profile=getBusinessProfile(user.id);
  console.log(JSON.stringify({id:user.id,name:user.name,crm:profile.crm_provider,erp:profile.erp_provider,crm_bound:!!profile.twenty?.workspace_id,erp_bound:!!profile.erpnext?.company_id}));
}
