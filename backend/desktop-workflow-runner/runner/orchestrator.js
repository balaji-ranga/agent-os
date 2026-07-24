import { evaluateCondition } from './conditions.js';
import { resolveNodeInputs } from './templates.js';
import { executeLocalApi, executeLocalFilesystem, shouldRunApiLocally } from './local-executors.js';

const LOCAL_CONTROL = new Set(['trigger', 'if', 'while', 'parallel', 'merge', 'end']);
const LOCAL_IO = new Set(['filesystem']);
const UNSUPPORTED = new Set(['agent', 'ceo_approval', 'sse_listen', 'mcp_listen', 'sub_workflow']);

function getOutgoing(graph, fromId, branchHandle = null) {
  let edges = (graph.edges || []).filter((e) => e.source === fromId);
  if (branchHandle != null) {
    edges = edges.filter((e) => (e.sourceHandle || 'default') === branchHandle);
  }
  return edges;
}

function getNode(graph, id) {
  return (graph.nodes || []).find((n) => n.id === id) || null;
}

/**
 * Local graph walk. Reports local steps; asks Flolah to execute remote nodes.
 */
export async function runDesktopOrchestration({ params, client, log, input, packageRoot }) {
  const graph = params.workflow?.graph;
  if (!graph?.nodes?.length) throw new Error('No workflow graph in params');

  const start = await client.startRun(input);
  const runId = start.run?.id;
  if (!runId) throw new Error('Flolah did not return a run id');
  let context = start.context || {};
  const triggerId = start.trigger_node_id;
  log.info(`Run started`, { runId, triggerId });

  const queue = getOutgoing(graph, triggerId).map((e) => ({ nodeId: e.target, branch: null }));
  const visitedGuard = new Map();

  try {
    while (queue.length) {
      const { nodeId } = queue.shift();
      const node = getNode(graph, nodeId);
      if (!node) {
        log.warn(`Missing node ${nodeId}`);
        continue;
      }

      const guardKey = `${nodeId}:${context.while_loops?.[nodeId] || 0}`;
      const seen = visitedGuard.get(guardKey) || 0;
      if (seen > 200) throw new Error(`Possible infinite loop at node ${nodeId}`);
      visitedGuard.set(guardKey, seen + 1);

      if (UNSUPPORTED.has(node.type)) {
        throw new Error(`Node type "${node.type}" is not supported in desktop packages`);
      }

      if (node.type === 'end') {
        await client.reportStep(runId, {
          node_id: nodeId,
          status: 'completed',
          outputs: { text: 'end', ended: true },
        });
        log.info(`Reached end node ${nodeId}`);
        continue;
      }

      if (node.type === 'if') {
        const cond = node.data?.taskConfig || node.data?.condition || {};
        const pass = evaluateCondition(cond, context);
        const branch = pass ? 'true' : 'false';
        const outputs = { result: pass, text: branch, branch };
        context.node_outputs = { ...(context.node_outputs || {}), [nodeId]: outputs };
        await client.reportStep(runId, {
          node_id: nodeId,
          status: 'completed',
          outputs,
          input: { condition: cond },
          context_patch: { node_outputs: { [nodeId]: outputs } },
        });
        for (const e of getOutgoing(graph, nodeId, branch)) {
          queue.push({ nodeId: e.target });
        }
        continue;
      }

      if (node.type === 'while') {
        const cond = node.data?.taskConfig || node.data?.condition || {};
        const maxIter = Number(cond.maxIterations) || 10;
        context.while_loops = context.while_loops || {};
        const prev = context.while_loops[nodeId] || 0;
        const pass = evaluateCondition(cond, context) && prev < maxIter;
        if (pass) {
          context.while_loops[nodeId] = prev + 1;
          const outputs = { iterations: context.while_loops[nodeId], text: 'loop', branch: 'loop' };
          context.node_outputs = { ...(context.node_outputs || {}), [nodeId]: outputs };
          await client.reportStep(runId, {
            node_id: nodeId,
            status: 'completed',
            outputs,
            iteration: context.while_loops[nodeId],
            context_patch: {
              node_outputs: { [nodeId]: outputs },
              while_loops: { [nodeId]: context.while_loops[nodeId] },
            },
          });
          for (const e of getOutgoing(graph, nodeId, 'loop')) queue.push({ nodeId: e.target });
        } else {
          const outputs = { iterations: prev, text: 'exit', branch: 'exit' };
          context.node_outputs = { ...(context.node_outputs || {}), [nodeId]: outputs };
          await client.reportStep(runId, {
            node_id: nodeId,
            status: 'completed',
            outputs,
            iteration: prev + 1,
            context_patch: { node_outputs: { [nodeId]: outputs } },
          });
          for (const e of getOutgoing(graph, nodeId, 'exit')) queue.push({ nodeId: e.target });
        }
        continue;
      }

      if (node.type === 'parallel') {
        const outputs = { parallel: true, text: 'parallel' };
        context.node_outputs = { ...(context.node_outputs || {}), [nodeId]: outputs };
        await client.reportStep(runId, { node_id: nodeId, status: 'completed', outputs });
        const children = getOutgoing(graph, nodeId);
        // Sequential for predictability in v1 (still fan-out edges)
        for (const e of children) queue.push({ nodeId: e.target });
        continue;
      }

      if (node.type === 'merge') {
        const outputs = { merged: true, text: 'merged' };
        context.node_outputs = { ...(context.node_outputs || {}), [nodeId]: outputs };
        await client.reportStep(runId, { node_id: nodeId, status: 'completed', outputs });
        for (const e of getOutgoing(graph, nodeId)) queue.push({ nodeId: e.target });
        continue;
      }

      if (node.type === 'filesystem' || (node.type === 'api' && shouldRunApiLocally(node, graph, context, params))) {
        log.info(`Local execute ${node.type}`, { nodeId });
        let outputs;
        if (node.type === 'api') {
          outputs = await executeLocalApi(node, graph, context, params);
        } else {
          outputs = executeLocalFilesystem(node, graph, context, packageRoot);
        }
        context.node_outputs = { ...(context.node_outputs || {}), [nodeId]: outputs };
        const { summary } = resolveNodeInputs(node, graph, context);
        await client.reportStep(runId, {
          node_id: nodeId,
          status: 'completed',
          outputs,
          input: { inputs: summary },
          context_patch: { node_outputs: { [nodeId]: outputs } },
        });
        for (const e of getOutgoing(graph, nodeId)) queue.push({ nodeId: e.target });
        continue;
      }

      // Remote node on Flolah
      log.info(`Remote execute ${node.type}`, { nodeId });
      const remote = await client.executeNode(runId, nodeId, {
        node_outputs: context.node_outputs,
        while_loops: context.while_loops,
      });
      if (remote.context) context = remote.context;
      else if (remote.outputs) {
        context.node_outputs = { ...(context.node_outputs || {}), [nodeId]: remote.outputs };
      }
      for (const e of getOutgoing(graph, nodeId)) queue.push({ nodeId: e.target });
    }

    const done = await client.complete(runId, 'completed');
    log.info(`Run completed`, { runId, status: done.run?.status });
    return { runId, status: 'completed', run: done.run };
  } catch (err) {
    log.error(`Run failed: ${err.message}`, { runId });
    try {
      await client.complete(runId, 'failed', err.message);
    } catch (e2) {
      log.warn(`Could not mark run failed on Flolah: ${e2.message}`);
    }
    throw err;
  }
}

export { LOCAL_CONTROL, LOCAL_IO, UNSUPPORTED };
