import {isTenantFullAccess} from '../services/org-permissions.js';
import { requireAuth,requirePermission,resolveAuthenticatedCeoUserId } from '../middleware/auth.js';
import { getPhysicalControlPlane } from '../services/physical/runtime.js';
import { packageCatalog,packageDirectory } from '../services/physical/packages.js';
import { join } from 'node:path';
import { physicalApiRouter } from './physical-api.js';
export function physicalRouter({plane=getPhysicalControlPlane(),auth=[requireAuth,requirePermission('physical-ai')],owner=resolveAuthenticatedCeoUserId}={}) { const router=physicalApiRouter({plane,auth,owner,isAdmin:req=>req.authUser?.role==='admin'||isTenantFullAccess(req.authUser)});router.get('/packages',(req,res)=>res.json(packageCatalog()));router.get('/packages/:file',(req,res)=>{const pkg=packageCatalog().packages.find(p=>p.file===req.params.file);if(!pkg)return res.status(404).json({error:'Package not available'});res.download(join(packageDirectory(),pkg.file),pkg.file);});return router; }
