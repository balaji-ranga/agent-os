import { Router } from 'express';
import { requireAuth, requireRole, requireTenantFullAccess, resolveAuthenticatedCeoUserId } from '../middleware/auth.js';
import { getEfficiencyPolicy, saveEfficiencyPolicy, getEfficiencyPreferences, saveEfficiencyPreferences,
  efficiencyReport, listEfficiencyEvaluations, approveEfficiencyEvaluation, localEfficiencyModel } from '../services/efficiency-control-plane.js';
import { efficiencyPool } from '../services/efficiency-capacity.js';
import { startEfficiencyEvaluation } from '../services/efficiency-evaluations.js';
import { evaluateEfficiencyModel, evaluateEfficiencyBaseline } from '../config/llm.js';

const handle = fn => async (req,res) => { try { await fn(req,res); } catch(e) { res.status(e.status||400).json({error:e.message}); } };
export const adminEfficiencyControls = Router();
adminEfficiencyControls.use(requireAuth, requireRole('admin'));
adminEfficiencyControls.get('/', handle((req,res) => res.json({ policy:getEfficiencyPolicy(),
  models:['ollama-efficiency','ollama-reasoning'].map(id=>({id,model:localEfficiencyModel(id).model})),
  capacity:efficiencyPool.snapshot(), report:efficiencyReport(), evaluations:listEfficiencyEvaluations() })));
adminEfficiencyControls.put('/policy', handle((req,res) => res.json({policy:saveEfficiencyPolicy(req.body||{})})));
adminEfficiencyControls.post('/evaluations', handle((req,res) => {
  if (req.body?.compare_hosted !== undefined && typeof req.body.compare_hosted !== 'boolean') throw Object.assign(new Error('compare_hosted must be boolean'),{status:400});
  const {job}=startEfficiencyEvaluation(req.body?.model_id, req.authUser.id, evaluateEfficiencyModel,{compareHosted:req.body?.compare_hosted===true,callBaseline:evaluateEfficiencyBaseline});
  res.status(202).json(job);
}));
adminEfficiencyControls.post('/evaluations/:id/approve', handle((req,res) => res.json(approveEfficiencyEvaluation(req.params.id))));

export const companyEfficiencyControls = Router();
companyEfficiencyControls.use(requireAuth, requireTenantFullAccess);
companyEfficiencyControls.get('/', handle((req,res) => {
  const owner=resolveAuthenticatedCeoUserId(req, req.query||{});
  res.json({preferences:getEfficiencyPreferences(owner), capacity:efficiencyPool.snapshot(owner),
    report:efficiencyReport(owner,{days:req.query.days,sessionId:req.query.session_id,traceId:req.query.trace_id}),
    // Evaluations contain only synthetic prompts/results, not tenant activity.
    evaluations:listEfficiencyEvaluations().filter(e=>e.approved).map(({id,model_id,model,passed_count,total_count,average_latency_ms,scope,created_at})=>({id,model_id,model,passed_count,total_count,average_latency_ms,scope,created_at}))});
}));
companyEfficiencyControls.put('/preferences', handle((req,res) => {
  if (Object.keys(req.body||{}).some(key=>!['fallback_mode','model_id','ceo_user_id','ceoUserId'].includes(key))) throw Object.assign(new Error('Company preferences cannot modify platform policy'),{status:400});
  const owner=resolveAuthenticatedCeoUserId(req,req.body||{});
  const {fallback_mode,model_id}=req.body||{};
  res.json({preferences:saveEfficiencyPreferences(owner,{...(fallback_mode!==undefined?{fallback_mode}:{}),...(model_id!==undefined?{model_id}:{})})});
}));
