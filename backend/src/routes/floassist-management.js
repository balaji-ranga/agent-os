import {Router} from 'express';
import {attachAuthUser,requireAuth,requireCeoOrAdmin,resolveAuthenticatedCeoUserId} from '../middleware/auth.js';
import {getFloAssist} from '../services/floassist/platform.js';
import {authRateLimit} from '../middleware/auth-rate-limit.js';

export function createFloAssistManagementRouter({service=getFloAssist,auth=[attachAuthUser,requireAuth,requireCeoOrAdmin],resolveOwner=resolveAuthenticatedCeoUserId}={}){
 const router=Router();router.use(...auth);
 router.use((_req,res,next)=>{res.set('Cache-Control','no-store');next();});
 const run=fn=>async(req,res)=>{try{
  const owner=resolveOwner(req);if(!owner)return res.status(403).json({error:'An owner session is required.'});
  res.json(await fn(service(),owner,req));
 }catch(e){res.status(e.status||500).json({error:e.status?e.message:'FloAssist could not complete this action.',code:e.code});}};
 router.get('/',run((s,owner)=>{
  try{return {enrolled:true,...s.view(owner),config:s.publicConfig()};}
  catch(e){if(e.status===404)return {enrolled:false,config:s.publicConfig()};throw e;}
 }));
 router.post('/status',run((s,owner,req)=>s.setStatus(owner,req.body?.status)));
 router.get('/connections',run((s,owner)=>s.connections(owner)));
 router.put('/preferences',run((s,owner,req)=>s.save(owner,req.body||{})));
 router.post('/connections/:provider',authRateLimit('floassist_manage_connect',{ipLimit:40,windowMs:900000}),run((s,owner,req)=>s.connect(owner,req.params.provider)));
 router.get('/whatsapp',run((s,owner)=>s.qr(owner,'status')));
 router.post('/whatsapp/start',authRateLimit('floassist_manage_qr',{ipLimit:20,windowMs:900000}),run((s,owner)=>s.qr(owner,'start')));
 router.post('/whatsapp/wait',run((s,owner)=>s.qr(owner,'wait')));
 return router;
}
export default createFloAssistManagementRouter();
