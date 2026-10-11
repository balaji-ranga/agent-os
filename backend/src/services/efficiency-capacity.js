/** Per-backend-process pool. Multiple replicas need a distributed lease implementation. */
import { getEfficiencyPolicy } from './efficiency-control-plane.js';
export function createEfficiencyPool({getLimits = () => null} = {}) {
  const active = new Map();
  const waiting = [];
  function drain() {
    while (waiting.length && active.size < (getLimits() || waiting[0].policy).max_concurrency) waiting.shift().grant();
  }
  return {
    snapshot(owner = null) {
      return { active: [...active.values()].filter(x => !owner || x.owner === owner).length,
        queued: waiting.filter(x => !owner || x.owner === owner).length,
        scope: 'backend_process' };
    },
    acquire(owner, id, policy) {
      return new Promise((resolve, reject) => {
        const started = Date.now();
        policy = getLimits() || policy;
        let timer;
        const entry = { owner, policy, grant() {
          clearTimeout(timer); active.set(id, {owner});
          let released = false;
          resolve({ queueMs: Date.now()-started, release() {
            if (released) return; released = true; active.delete(id); drain();
          }});
        }};
        if (!waiting.length && active.size < policy.max_concurrency) return entry.grant();
        if (waiting.length >= policy.max_queue) return reject(new Error('local_capacity_exhausted'));
        waiting.push(entry);
        timer = setTimeout(() => {
          const index = waiting.indexOf(entry);
          if (index !== -1) waiting.splice(index, 1);
          reject(new Error('local_queue_timeout')); drain();
        }, policy.queue_timeout_ms);
      });
    },
  };
}
export const efficiencyPool = createEfficiencyPool({getLimits:getEfficiencyPolicy});
