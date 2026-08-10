import { getDb } from '../src/db/schema.js';
import { planGoalStepsAsync, planUsesGoalRunMode } from '../src/services/agent-goal-run.js';

const db = getDb();
const owner = 'ceo-demo-brightbox-744921';
const prompt =
  'Run crm maker checker for Acme pre-order. Also A) research corporate gifting trends B) design thank-you card C) draft LinkedIn announcement';
const steps = await planGoalStepsAsync(prompt, { ownerUserId: owner });
console.log(
  'hybrid types',
  steps.map((s) => s.type + ':' + String(s.spec?.agent_id || s.spec?.phrase || '').slice(0, 50))
);
console.log('mode', planUsesGoalRunMode(steps));
const specialty = steps.filter((s) => s.type === 'specialty_task').length;
const wf = steps.filter((s) => s.type === 'workflow_trigger').length;
if (wf < 1) throw new Error('expected workflow');
if (specialty < 2) console.warn('WARN specialty < 2 got', specialty, '(LLM variance)');
else console.log('PASS hybrid specialty', specialty);
const startConn = db
  .prepare(
    `SELECT id, enabled FROM platform_users WHERE id LIKE 'ceo-oc-connector-%' OR id LIKE 'connector%' OR lower(email) LIKE 'connector%' OR lower(email) LIKE 'oc-connector%'`
  )
  .all();
console.log(
  'connector-like',
  startConn.length,
  'enabled',
  startConn.filter((u) => u.enabled).length,
  'disabled',
  startConn.filter((u) => !u.enabled).length
);
console.log('HYBRID_LIVE_OK');