import { randomUUID, createHash } from 'node:crypto';
export function copilotBridgeError(code){return ['RECIPIENT_OFFLINE','RECIPIENT_BUSY','GROUP_ACCESS_DENIED','VISITOR_CAPABILITY_DISABLED','OWNERSHIP_CHANGED','FANOUT_LIMIT','LINK_DENIED','TASK_ENDED','TASK_SHARING_REQUIRED','POLICY_REVOKED'].includes(code)?`COPILOT_${code}`:'COPILOT_BRIDGE_UNAVAILABLE';}
export const COPILOT_ACTIONS = Object.freeze([['inspect', 'Inspect the current supported form and navigation', 'R0', 'read'], ['summarize', 'Summarize private task passages', 'R0', 'read'], ['prepare', 'Prepare current fields for visitor review', 'R0', 'read'], ['navigate', 'Navigate through a freshly observed safe link', 'R1', 'write_internal'], ['fill', 'Fill supported fields; host autosave can cause external effects', 'R2', 'communicate_external'], ['submit', 'Submit only an owner-bound native control', 'R3', 'financial_destructive'], ['status', 'Read a dispatched command status', 'R0', 'read'], ['cancel', 'Cancel an active private task', 'R1', 'write_internal']].map(([action, description, risk_tier, action_family]) => ({
  id: `digital_adoption.${action}`,
  action_id: `digital_adoption.${action}`,
  app_id: 'digital_adoption',
  app_name: 'Digital Adoption Copilot',
  description,
  risk_tier,
  action_family,
  input_schema: {
    type: 'object',
    properties: {
      groupId: {
        type: 'string'
      },
      websiteIds: {
        type: 'array',
        items: {
          type: 'string'
        }
      },
      instanceIds: {
        type: 'array',
        items: {
          type: 'string'
        }
      },
      taskId: {
        type: 'string'
      },
      instruction: {
        type: 'string'
      },
      operationId: {
        type: 'string'
      },
      fanoutLimit: {
        type: 'integer'
      },
      executionMs: {
        type: 'integer'
      }
    },
    required: ['groupId', 'websiteIds']
  },
  example_input: {
    groupId: '',
    websiteIds: [],
    instruction: ''
  }
})));
const fail = (code, status = 403, extra = {}) => {
  throw Object.assign(new Error(code), {
    code,
    status,
    ...extra
  });
};

// One execution boundary for direct API, tools and the actual workflow runner.
// The runner receives content-free results and task handles, never passages.
export function createCopilotConnector({
  bridge,
  entitled,
  grant,
  policy,
  preview,
  approvalActive = () => true,
  clock = Date.now,
  sleep = ms => new Promise(r => setTimeout(r, ms))
}) {
  const passes = new Map(),
    inflight = new Map();
  const authorized = async (user, context) => {
    if (!user || !(await entitled(user, context))) fail('COPILOT_WORKFLOW_ENTITLEMENT_REQUIRED');
  };
  return {
    async link(user, input) {
      await authorized(user, {});
      return bridge('/link', {
        userId: user,
        code: input.code,
        groupId: input.groupId
      });
    },
    async discover(user) {
      await authorized(user, {});
      return bridge('/discover', {
        userId: user
      });
    },
    async execute(user, actionId, input = {}, context = {}) {
      await authorized(user, context);
      const action = COPILOT_ACTIONS.find(a => a.id === actionId);
      if (!action) fail('COPILOT_ACTION_UNKNOWN', 400);
      await grant(context.source, actionId);
      if (actionId === 'digital_adoption.status') return {
        ok: true,
        action_id: actionId,
        data: await bridge('/status', {
          userId: user,
          commandId: input.commandId
        }),
        transport: 'copilot'
      };
      const operationId = context.runId ? `${context.runId}:${context.nodeId}:${context.iteration || 0}` : input.operationId;
      if (!operationId || typeof operationId !== 'string' || operationId.length > 180) fail('COPILOT_OPERATION_ID_REQUIRED', 400);
      const key = user + ':' + operationId,
        inputHash = createHash('sha256').update(JSON.stringify({
          actionId,
          input: {
            ...input,
            approval_token: undefined
          }
        })).digest('hex');
      if (inflight.has(key)) {
        const previous = inflight.get(key);
        if (previous.inputHash !== inputHash) fail('COPILOT_OPERATION_CONFLICT', 409);
        return previous.promise;
      }
      let dispatched = false;
      const run = (async () => {
        const payload = {
          ...input,
          userId: user,
          action: actionId.split('.')[1],
          operationId,
          workflowRunId: context.runId,
          workflow:{id:context.workflowId,runId:context.runId,nodeId:context.nodeId},
          workflowOwnerId: context.ownerUserId || user
        };
        delete payload.approval_token;
        const snapshot = await bridge('/preflight', payload);
        // Hash binds exact inputs and live connection snapshot without putting
        // private prompt/value text into policy audit or approval storage.
        const policyBody = {
          groupId: input.groupId,
          websiteIds: input.websiteIds,
          recipients: snapshot.recipients.map(r => r.instanceId),
          payloadHash: snapshot.fingerprint,
          workflowId: context.workflowId,
          approval_token: input.approval_token
        };
        const policyContext = {
          ...context,
          ...(snapshot.effectFamily ? {
            effectFamily: snapshot.effectFamily
          } : {})
        };
        const decision = await policy(user, actionId, policyBody, policyContext);
        if (!decision.ok) fail(decision.mode === 'approval_required' ? 'COPILOT_AWAITING_APPROVAL' : 'COPILOT_POLICY_BLOCKED', 403, {
          policy: decision,
          approvalContext: {
            ...policyBody,
            approval_token: undefined
          }
        });
        const policyReference = randomUUID();
        passes.set(policyReference, {
          user,
          actionId,
          body: policyBody,
          context: policyContext,
          decision,
          fingerprint: snapshot.fingerprint,
          expiresAt: clock() + Math.min(120000, input.executionMs || 60000)
        });
        dispatched = true;
        let out;
        try {
          out = await bridge('/dispatch', {
            ...payload,
            snapshot,
            policyReference
          });
        } catch {
          fail('COPILOT_OUTCOME_UNKNOWN', 409);
        }
        const deadline = clock() + Math.min(120000, input.executionMs || 60000) + 6000;
        while (!['succeeded', 'failed', 'cancelled', 'expired'].includes(out.status)) {
          if (clock() >= deadline) fail('COPILOT_OUTCOME_UNKNOWN', 409, {
            result: out
          });
          await sleep(200);
          out = await bridge('/status', {
            userId: user,
            commandId: out.commandId
          });
        }
        if (out.status !== 'succeeded') fail('COPILOT_RECIPIENT_FAILED', 409, {
          result: out
        });
        return {
          ok: true,
          action_id: actionId,
          data: out,
          text: 'All captured copilots completed the requested step. Business save verification is reported separately.'+(out.recipients||[]).filter(r=>r.inspection).map(r=>{const s=r.inspection;return `\n\n${s.origin||r.websiteId}${s.path}: ${s.forms.length} forms, ${s.fields.length} supported fields, ${s.navigation.length} approved navigation links.\nFields: ${s.fields.map(f=>`${f.label} (${f.type}${f.required?', required':''})`).join('; ')}\nNavigation: ${s.navigation.map(n=>`${n.label}: ${n.path}`).join('; ')||'No approved links observed.'}\nField values excluded.`;}).join(''),
          transport: 'copilot'
        };
      })();
      inflight.set(key, {
        inputHash,
        promise: run
      });
      try {
        return await run;
      } finally {
        if (!dispatched) inflight.delete(key);else setTimeout(() => inflight.delete(key), 3600000).unref?.();
      }
    },
    async effect(input) {
      const pass = passes.get(input.policyReference);
      if (!pass || pass.user !== input.userId || pass.fingerprint !== input.fingerprint || pass.expiresAt <= clock()) return false;
      await authorized(pass.user, pass.context);
      const now = await preview(pass.user, pass.actionId, pass.body, pass.context, pass.decision);
      return now.ok && now.mode === pass.decision.mode && now.action_family === pass.decision.action_family && approvalActive(pass.decision);
    },
    async finish(user, runId) {
      await bridge('/finish-run', {
        userId: user,
        workflowRunId: runId
      });
      for (const [id, p] of passes) if (p.context.runId === runId) passes.delete(id);
    }
  };
}
