import { beginEfficiencyCall, updateEfficiencyCall, getEfficiencyPreferences } from './efficiency-control-plane.js';
import { efficiencyPool } from './efficiency-capacity.js';

export function validateEfficiencyOutput(result, options) {
  const text = String(result?.content || '').trim();
  if (!text || result?.finishReason === 'length') throw new Error('local_output_incomplete');
  if (['json','json_object'].includes(options.responseFormat)) {
    let parsed;
    const jsonText = text.replace(/^```(?:json)?\s*/,'').replace(/\s*```$/,'');
    try { parsed = JSON.parse(jsonText); }
    catch { throw new Error('local_output_invalid_json'); }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('local_output_invalid_json');
    result.content = jsonText;
  }
  // Callers may supply domain-specific contract checks; this never substitutes for risk/authorization checks.
  if (options.validateResponse) {
    try { if (options.validateResponse(result.content) !== true) throw new Error('contract'); }
    catch { throw new Error('local_output_contract_failed'); }
  }
}

export async function executeEfficiency(options, plan, execute, fallbackConfig, pool = efficiencyPool) {
  const started = Date.now();
  const id = beginEfficiencyCall({ ...options, model: plan.endpoint.model });
  let lease;
  let reason = null;
  const finish = (out, fallback = false) => {
    updateEfficiencyCall(id, { status: 'success', actual_model: out.actualModel || out.modelUsed,
      endpoint_host: out.endpointHost || null, local: out.localModel ? 1 : 0,
      latency_ms: Date.now()-started, input_tokens: out.usage?.input_tokens || out.usage?.prompt_tokens || 0,
      output_tokens: out.usage?.output_tokens || out.usage?.completion_tokens || 0 });
    return { ...out, efficiency: { callId: id, requestedModel: plan.endpoint.model,
      actualModel: out.actualModel || out.modelUsed, fallback, fallbackReason: reason,
      queueMs: lease?.queueMs || 0, latencyMs: Date.now()-started } };
  };
  try {
    lease = await pool.acquire(options.ownerUserId, id, plan.policy);
    updateEfficiencyCall(id, { status: 'processing', queue_ms: lease.queueMs });
    const out = await execute({ ...options, requestSignal: AbortSignal.timeout(Math.min(plan.policy.local_timeout_ms, options.timeoutMs || plan.policy.local_timeout_ms)),
      _config: { cfg: { primary: plan.endpoint, secondary: null, provider: 'ollama_free', using_byok: false },
        effectiveModel: plan.endpoint.model, efficiencyMode: true, utilityTransport: true, routeAlias: null } });
    validateEfficiencyOutput(out, options);
    return finish(out);
  } catch (error) {
    reason = ['local_capacity_exhausted','local_queue_timeout','local_output_incomplete','local_output_invalid_json','local_output_contract_failed'].includes(error.message)
      ? error.message : error.name === 'TimeoutError' ? 'local_inference_timeout' : 'local_model_unavailable';
    updateEfficiencyCall(id, { status: plan.allowCloud ? 'fallback' : 'failed', fallback_reason: reason, latency_ms: Date.now()-started });
  } finally { lease?.release(); }
  // Revoking cloud permission while local inference runs must take effect before escalation.
  if (!plan.allowCloud || !getEfficiencyPreferences(options.ownerUserId).effective_cloud_fallback) {
    updateEfficiencyCall(id, {status:'failed'});
    throw new Error(`Efficiency local-only request failed: ${reason}`);
  }
  try {
    const cfg = fallbackConfig();
    const out = await execute({ ...options, _config: { cfg, effectiveModel: cfg.primary.model,
      efficiencyMode: true, utilityTransport: true, routeAlias: null } });
    validateEfficiencyOutput(out, options);
    return finish(out, true);
  } catch {
    updateEfficiencyCall(id, { status: 'failed', fallback_reason: reason, latency_ms: Date.now()-started });
    throw new Error(`Efficiency fallback failed after ${reason}`);
  }
}
