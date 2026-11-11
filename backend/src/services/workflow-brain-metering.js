import {AsyncLocalStorage} from 'node:async_hooks';
import {randomUUID} from 'node:crypto';
import {getDb} from '../db/schema.js';
import {ensureModelRoutingTables} from './model-routing-registry.js';
import {estimateTokens,normalizeProviderUsage,recordTokenUsage} from './token-usage.js';

const scope = new AsyncLocalStorage();
export function withBrainMetering(context, operation) { return scope.run(context, operation); }

/** One durable request event per HTTP attempt, including failed tool-loop rounds.
 * Link token_usage.trace_id to model_route_events.id; never persist prompts or keys. */
export async function fetchBrainModel(url, init) {
  const context=scope.getStore();
  if (!context?.ownerId) throw new Error('Workflow Brain request requires an owner for usage attribution.');
  const body=JSON.parse(init.body);
  ensureModelRoutingTables();
  const db=getDb(),id=randomUUID(),started=Date.now();
  db.prepare(`INSERT INTO model_route_events
    (id,route_alias,outcome,model_used,endpoint_host,source,owner_user_id)
    VALUES (?,?,?,?,?,?,?)`).run(id,'workflow-brain-direct','started',String(body.model||''),new URL(url).host,'workflow_brain',context.ownerId);
  let response,data;
  try {
    response=await fetch(url,init);
    data=await response.clone().json().catch(()=>null);
    return response;
  } finally {
    const usage=normalizeProviderUsage(data?.usage);
    const estimated=!usage;
    // Failed responses may still be billed. Retain an explicit estimate when
    // the provider supplies no usage; never present it as measured consumption.
    const inputTokens=usage?.input_tokens ?? estimateTokens(JSON.stringify({system:body.system,messages:body.messages,tools:body.tools}));
    const outputTokens=usage?.output_tokens ?? estimateTokens(JSON.stringify(data?.choices?.[0]?.message || data?.content || ''));
    db.prepare('UPDATE model_route_events SET outcome=?,latency_ms=?,error_message=? WHERE id=?')
      .run(response?.ok?'success':'error',Date.now()-started,response?.ok?null:response?`HTTP ${response.status}`:'transport_failure',id);
    if (!recordTokenUsage(context.ownerId,{memberKey:context.memberKey,agentId:context.agentId,
      source:'workflow_brain',modelId:body.model,inputTokens,outputTokens,estimated,
      runId:context.runId,sessionId:context.nodeId,traceId:id})) {
      throw new Error(`Workflow Brain usage recording failed for request ${id}; do not retry the model operation automatically.`);
    }
  }
}
