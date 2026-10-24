import { Router } from 'express';
import { authRateLimit } from '../middleware/auth-rate-limit.js';
import { getFloAssist } from '../services/floassist/platform.js';

export function createFloAssistRouter(service=getFloAssist, rateLimit=authRateLimit){
  const router=Router();
  router.use((_req,res,next)=>{res.set('Cache-Control','no-store');res.set('Referrer-Policy','no-referrer');next();});
  const run=fn=>async(req,res)=>{try{res.json(await fn(req,service()));}catch(e){res.status(e.status||500).json({error:e.status?e.message:'Setup could not be completed. Please retry.',code:e.code||'setup_failed'});}};
  const token=req=>String(req.headers['x-floassist-session']||'');
  router.get('/config',run((_req,s)=>s.publicConfig()));
  router.post('/start',rateLimit('floassist_start',{ipLimit:20,accountLimit:5,windowMs:900000}),run((req,s)=>s.start(req.body||{})));
  router.post('/verify',rateLimit('floassist_verify',{ipLimit:40,windowMs:900000}),run((req,s)=>s.verify(token(req),req.body?.code,req.body?.mfa_code)));
  router.use((req,res,next)=>{try{req.floassist=service().session(token(req));next();}catch(e){res.status(e.status||401).json({error:e.message,code:e.code});}});
  const owner=req=>req.floassist.owner_id;
  router.get('/me',run((req,s)=>s.view(owner(req))));
  router.put('/preferences',run((req,s)=>s.save(owner(req),req.body||{})));
  router.put('/policy',run((req,s)=>s.setPolicy(owner(req),req.body||{})));
  router.get('/connections',run((req,s)=>s.connections(owner(req))));
  router.post('/connections/:provider',rateLimit('floassist_connect',{ipLimit:40,windowMs:900000}),run((req,s)=>s.connect(owner(req),req.params.provider)));
  router.get('/whatsapp',run((req,s)=>s.qr(owner(req),'status')));
  router.post('/whatsapp/start',rateLimit('floassist_qr',{ipLimit:20,windowMs:900000}),run((req,s)=>s.qr(owner(req),'start')));
  router.post('/whatsapp/wait',run((req,s)=>s.qr(owner(req),'wait')));
  router.post('/activate',run((req,s)=>s.activate(owner(req))));
  router.post('/status',run((req,s)=>s.setStatus(owner(req),req.body?.status)));
  router.post('/logout',run((req,s)=>{s.logout(token(req));return {ok:true};}));
  return router;
}
export default createFloAssistRouter();
