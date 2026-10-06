import { Router } from 'express';
import { requireAuth, requireTenantFullAccess, resolveAuthenticatedCeoUserId } from '../middleware/auth.js';
import { createPaperExecutionTest, getPaperExecutionTest, closePaperExecutionTest } from '../services/ibkrnew-paper-execution-test.js';

const router=Router();
const owner=req=>resolveAuthenticatedCeoUserId(req,{});
const handle=(res,fn)=>{try{return res.json(fn());}catch(e){return res.status(e.status||500).json({error:e.message});}};
// Human-facing, explicit confirmation only. Not registered as an agent tool.
router.post('/',requireAuth,requireTenantFullAccess,(req,res)=>handle(res,()=>createPaperExecutionTest(owner(req),req.body||{})));
router.get('/:testId',requireAuth,requireTenantFullAccess,(req,res)=>handle(res,()=>getPaperExecutionTest(owner(req),req.params.testId)));
router.post('/:testId/close',requireAuth,requireTenantFullAccess,(req,res)=>handle(res,()=>closePaperExecutionTest(owner(req),req.params.testId,req.body||{})));
export default router;
