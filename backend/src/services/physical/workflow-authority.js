import {getDb} from '../../db/schema.js';
import {attachOrgFieldsToAuthUser,isTenantFullAccess,hasPermission,resolveRootOwnerUserId} from '../org-permissions.js';
export function assertPhysicalWorkflowAuthority(ownerUserId,actor){
 const row=actor?.id?getDb().prepare('SELECT id,role,enabled FROM platform_users WHERE id=?').get(actor.id):null;
 const user=row?attachOrgFieldsToAuthUser(row):null;
 if(!user?.enabled||(!isTenantFullAccess(user)&&!hasPermission(user,'workflows'))||(user.role==='ceo'?user.id:resolveRootOwnerUserId(user))!==ownerUserId)throw Object.assign(Error('Physical workflows require company workflow permission'),{status:403});
}
