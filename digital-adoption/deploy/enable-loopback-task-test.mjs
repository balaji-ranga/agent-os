// Operator-only test setup. Never exposes a laptop or approves another origin.
import {openRepository} from '../src/repository.mjs';
import {SessionAuthority} from '../src/session-authority.mjs';
import {createControlPlane} from '../src/control-plane.mjs';
const [id,release]=process.argv.slice(2);
if(!/^[A-Za-z0-9_-]{1,80}$/.test(id||'')||!/^[A-Za-z0-9_-]{1,80}$/.test(release||''))throw new Error('Registration and release required');
const repository=openRepository('/data/adoption.sqlite'),site=repository.map('websites').get(id);
if(!site||site.origin!=='http://127.0.0.1:4194'||site.status!=='approved'||!site.verified)throw new Error('Only the already-approved loopback fixture is permitted');
const authority=new SessionAuthority({repository,development:true}),control=createControlPlane(repository,authority);
control.configure({id:`deployment-${release}`,organizationId:site.organizationId,role:'platform_admin'},id,{taskPolicy:{attachments:true,pairing:true,workflow:true}});
repository.close();console.log('Enabled private task UAT for the existing loopback registration only. No installation or origin was added.');
