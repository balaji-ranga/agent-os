// Runs in the SDK closure, not the widget iframe. No credentials reach the panel.
export function createTaskClient({
  request,
  service,
  inspect,
  onEvent,
  execute,
  hostIdentity
}) {
  let socket,
    instanceId,
    taskId,
    timer,
    connecting,
    closed = false,
    generation = 0;
  const seen = new Map();
  const notify = value => onEvent(value);
  const send = value => {
    if (socket?.readyState !== 1) throw new Error('Paired connection is offline');
    socket.send(JSON.stringify(value));
  };
  const connect = () => connecting ||= (async () => {
    if (closed) throw new Error('Session ended');
    const ticket = await request('/v1/live/ticket', {});
    instanceId = ticket.instanceId;
    const url = new URL('v1/live', service);
    url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
    socket = new WebSocket(url);
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Live connection timed out')), 7000);
      socket.onopen = () => socket.send(JSON.stringify({
        type: 'authenticate',
        ticket: ticket.ticket
      }));
      socket.onerror = () => {
        clearTimeout(timeout);
        reject(new Error('Live connection unavailable'));
      };
      socket.onmessage = async event => {
        const message = JSON.parse(event.data);
        if (message.type === 'connected') {
          clearTimeout(timeout);
          resolve();
          return;
        }
        if (message.type === 'task-ended') {
          if (taskId !== message.taskId) return;
          generation++;
          seen.clear();
          if (taskId === message.taskId) taskId = null;
          notify(message);
          return;
        }
        if (message.type === 'task-shared') {
          taskId = message.taskId;
          notify(message);
          return;
        }
        if (message.type !== 'command') return;
        const previous = seen.get(message.commandId);
        if (previous) {
          if (previous.done) send(previous.done);
          return;
        }
        if (Date.now() >= message.expiresAt) return;
        const commandGeneration = generation;
        taskId=message.taskId;
        notify({type:'workflow-started',taskId,action:message.action});
        seen.set(message.commandId, {});
        send({
          type: 'ack',
          commandId: message.commandId
        });
        let result;
        try {
          if (hostIdentity) await hostIdentity();
          const snapshot = inspect();
          const proposal = await request('/v1/tasks/command-plan', {
            instanceId,
            commandId: message.commandId,
            snapshot
          });
          if (message.action === 'prepare') {
            taskId = message.taskId;
            notify({
              type: 'workflow-proposal',
              proposal,
              snapshot
            });
            result = {
              prepared: true,
              proposalId: proposal.id
            };
          } else if (['fill', 'navigate', 'submit'].includes(message.action)) {
            if (!proposal.actions?.length) throw new Error('No supported action was prepared');
            const observations = [];
            for (let effectIndex = 0; effectIndex < proposal.actions.length; effectIndex++) {
              if (hostIdentity) await hostIdentity();
              const grant = await request('/v1/tasks/effect', {
                instanceId,
                commandId: message.commandId,
                proposalId: proposal.id,
                revision: proposal.revision,
                effectIndex
              });
              observations.push(...(await execute(grant)));
            }
            if (observations.some(r => r.valueObserved === false || r.hostReported === 'failure')) throw new Error('Host rejected changes');
            result = {
              observations,
              savedVerified: false
            };
          } else result = proposal;
          const done = {
            type: 'result',
            commandId: message.commandId,
            ok: true,
            result
          };
          if (commandGeneration === generation) {
            notify({type:'workflow-result',action:message.action,ok:true});
            seen.set(message.commandId, {
              done
            });
            send(done);
          }
        } catch {
          if(commandGeneration===generation)notify({type:'workflow-result',action:message.action,ok:false});
          const done = {
            type: 'result',
            commandId: message.commandId,
            ok: false,
            code: ['fill', 'navigate', 'submit'].includes(message.action) ? 'OUTCOME_UNKNOWN' : 'EXECUTION_FAILED'
          };
          if (commandGeneration === generation) seen.set(message.commandId, {
            done
          });
          try {
            send(done);
          } catch {}
        }
      };
    });
    socket.onclose = () => {
      clearInterval(timer);
      generation++;
      seen.clear();
      taskId = null;
      notify({
        type: 'task-ended',
        reason: 'Connection closed. Unfinished workflow steps fail; reconnect does not replay them.'
      });
    };
    timer = setInterval(() => {
      try {
        send({
          type: 'heartbeat'
        });
      } catch {}
    }, ticket.heartbeatMs);
    return instanceId;
  })().catch(error => {
    connecting = null;
    throw error;
  });
  return {
    get taskId() {
      return taskId;
    },
    async call(type, input = {}) {
      await connect();
      if (type === 'task-start') {
        const t = await request('/v1/tasks/start', {
          instanceId
        });
        taskId = t.taskId;
        return t;
      }
      const pair = type.startsWith('pair-'),
        action = type.replace(/^(task|pair)-/, '');
      const result = await request(`/v1/${pair ? 'pair' : 'tasks'}/${action}`, {
        ...input,
        instanceId,
        ...(!pair && taskId ? {
          taskId
        } : {})
      });
      if (type === 'task-end') {
        taskId = null;
        notify({
          type: 'task-ended'
        });
      }
      return result;
    },
    async plan(input) {
      if (!taskId) return null;
      return this.call('task-plan', input);
    },
    close() {
      closed = true;
      generation++;
      clearInterval(timer);
      socket?.close();
      taskId = null;
      seen.clear();
    }
  };
}
