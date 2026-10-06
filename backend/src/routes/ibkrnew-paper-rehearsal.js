import {Router} from 'express';
import {requireAuth,requireTenantFullAccess,resolveAuthenticatedCeoUserId} from '../middleware/auth.js';
import {getDb} from '../db/schema.js';
import {ensureIbkrNewDefaults,getIbkrNewExecutionMode,publishConfig} from '../services/ibkrnew-event-trader.js';
import {buildPaperRehearsalPreview} from '../services/ibkrnew-paper-rehearsal-config.js';
const router=Router();
const owner=req=>resolveAuthenticatedCeoUserId(req,{});
const handle=(res,fn)=>{try{return res.json(fn());}catch(e){return res.status(e.status||500).json({error:e.message});}};
router.get('/',requireAuth,requireTenantFullAccess,(req,res)=>handle(res,()=>buildPaperRehearsalPreview(ensureIbkrNewDefaults(owner(req)))));
router.post('/publish',requireAuth,requireTenantFullAccess,(req,res)=>handle(res,()=>{
  const user=owner(req);
  if(req.body?.environment!=='paper' || req.body?.confirm_paper_risk_loosening!==true)throw Object.assign(new Error('Explicit Paper rehearsal publication confirmation required'),{status:409});
  if(getIbkrNewExecutionMode(user).requested_mode!=='paper')throw Object.assign(new Error('Select Paper before publishing its rehearsal preset; this action never switches mode'),{status:409});
  return getDb().transaction(()=>{
    const configs=ensureIbkrNewDefaults(user), preview=buildPaperRehearsalPreview(configs);
    if(Object.entries(preview.expected_versions).some(([k,v])=>req.body?.expected_versions?.[k]!==v))throw Object.assign(new Error('Configuration changed since preview; review a fresh preview before publication'),{status:409});
    const versions=Object.fromEntries(Object.entries(preview.documents).map(([kind,doc])=>[kind,publishConfig(user,kind,doc,{confirmRiskLoosening:true}).version]));
    return {environment:'paper',status:'published',versions,settings:preview.settings,live_settings_unchanged:true,budgets_and_loss_limits_unchanged:true,goal_unchanged:true,note:preview.note};
  })();
}));
export default router;
