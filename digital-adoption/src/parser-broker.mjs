// A single combined ceiling and alternating queues prevent one class of file
// from starving the other. Private leases/results never enter durable jobs.
export function createParserBroker(shared, privateTasks, {
  maxWorkers = 2
} = {}) {
  let privateTurn = true;
  const owners = new Map();
  const target = claim => claim?.private ? privateTasks : shared;
  return {
    claim(workerId) {
      shared.recover();
      privateTasks.maintain();
      const sharedCounts = shared.metrics()?.counts || {},
        privateCount = privateTasks.metrics().activePrivateJobs || 0;
      if ((sharedCounts.extracting || 0) + (sharedCounts.indexing || 0) + privateCount >= maxWorkers) return null;
      for (const [id, row] of owners) if (row.until <= Date.now()) owners.delete(id);
      if (owners.has(workerId) || owners.size >= maxWorkers) return null;
      const order = privateTurn ? [privateTasks, shared] : [shared, privateTasks];
      let claim;
      for (const queue of order) {
        claim = queue.claim(workerId);
        if (claim) break;
      }
      if (claim) {
        privateTurn = !privateTurn;
        owners.set(workerId, {
          attemptId: claim.attemptId,
          until: Date.now() + claim.leaseMs
        });
      }
      return claim;
    },
    input(claim) {
      return target(claim).input(claim);
    },
    heartbeat(claim) {
      const out = claim.private ? privateTasks.heartbeatClaim(claim) : shared.heartbeat(claim);
      owners.set(claim.workerId, {
        attemptId: claim.attemptId,
        until: out.leaseUntil
      });
      if (out.leaseUntil <= Date.now() && owners.get(claim.workerId)?.attemptId === claim.attemptId) owners.delete(claim.workerId);
      return out;
    },
    async complete(claim, result) {
      const out = await target(claim).complete(claim, result);
      if (out.status === 'ready' && owners.get(claim.workerId)?.attemptId === claim.attemptId) owners.delete(claim.workerId);
      return out;
    },
    fail(claim) {
      try {
        return target(claim).fail(claim);
      } finally {
        if (owners.get(claim.workerId)?.attemptId === claim.attemptId) owners.delete(claim.workerId);
      }
    },
    metrics() {
      return {
        ...shared.metrics(),
        private: privateTasks.metrics(),
        combinedWorkers: maxWorkers
      };
    }
  };
}
