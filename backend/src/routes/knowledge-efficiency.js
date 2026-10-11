import {Router} from 'express';
import {requireAuth,requireTenantFullAccess,resolveAuthenticatedCeoUserId} from '../middleware/auth.js';
import {knowledgeEfficiencyReport} from '../services/knowledge-efficiency.js';

export function knowledgeEfficiencyRouter(report=knowledgeEfficiencyReport){
  const router=Router();
  router.get('/',requireAuth,requireTenantFullAccess,async(req,res)=>{
    try{
      // No caller-supplied owner selectors. Admin uses authenticated company user-view context.
      if(!req.authUser?.id)return res.status(403).json({error:'Authenticated company required'});
      const owner=resolveAuthenticatedCeoUserId(req,{});
      const {days,source,agent,page,section}=req.query;
      res.json(await report(owner,{days,source,agent,page,section}));
    }catch(e){res.status(e.status||500).json({error:e.status?e.message:'Knowledge metrics unavailable'});}
  });
  return router;
}
