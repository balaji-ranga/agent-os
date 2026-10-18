// Runs in the SDK closure, not the widget iframe. No credentials reach the panel.
export function createTaskClient({
  request,
  service,
  inspect,
  onEvent,
  execute,
  hostIdentity,
  resumeStore
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
    let ticket;
    try{ticket=await request('/v1/live/ticket',{resumeProof:resumeStore?.read()||undefined});}
    catch(error){if(error.code!=='PAIRING_RESUME_DENIED')throw error;resumeStore?.clear();notify({type:'pairing-offline',reason:'Saved pairing expired or was revoked. Pair again to authorize this panel.'});ticket=await request('/v1/live/ticket',{});}
    instanceId = ticket.instanceId;
    const url = new URL('v1/live', service);
    url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
    socket = new WebSocket(url);
    const connection = socket;
    let rejectHandshake;
    connection.onclose = () => {
      rejectHandshake?.(new Error('Live connection closed before authentication'));
      if (socket !== connection) return;
      clearInterval(timer);
      socket=null;connecting=null;instanceId=null;
      generation++;
      seen.clear();
      taskId = null;
      notify({type:'task-ended',reason:'Connection closed. Unfinished workflow steps fail; reconnect does not replay them.'});
      notify({type:'pairing-offline',reason:'Connection offline. Saved group retained; reconnect before sending. Unfinished actions are not replayed.'});
    };
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => { rejectHandshake=null; connection.close(); reject(new Error('Live connection timed out')); }, 7000);
      rejectHandshake = error => {clearTimeout(timeout);rejectHandshake=null;reject(error);};
      socket.onopen = () => socket.send(JSON.stringify({
        type: 'authenticate',
        ticket: ticket.ticket
      }));
      socket.onerror = () => {
        rejectHandshake?.(new Error('Live connection unavailable'));
        connection.close();
      };
      socket.onmessage = async event => {
        const message = JSON.parse(event.data);
        if (message.type === 'connected') {
          clearTimeout(timeout);
          rejectHandshake=null;
          resumeStore?.write(ticket.resumeProof);
          notify({type:'connection-restored',paired:ticket.paired});
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
        notify({type:'workflow-started',taskId,action:message.action,instruction:message.instruction,workflow:message.workflow,commandId:message.commandId});
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
            notify({type:'workflow-result',action:message.action,ok:true,result,commandId:message.commandId,workflow:message.workflow});
            seen.set(message.commandId, {
              done
            });
            send(done);
          }
        } catch {
          if(commandGeneration===generation)notify({type:'workflow-result',action:message.action,ok:false,commandId:message.commandId,workflow:message.workflow});
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
      }).catch(error=>{if(['TASK_ACCESS_DENIED','SESSION_ENDED','SESSION_ACCESS_DENIED'].includes(error.code)){socket?.close();connecting=null;instanceId=null;notify({type:'pairing-offline',reason:'Connection authorization ended. Reconnect to the saved group; this action was not retried.'});}throw error;});
      if (type === 'task-end') {
        taskId = null;
        notify({
          type: 'task-ended'
        });
      }
      if(['pair-invite','pair-confirm','pair-link'].includes(type))resumeStore?.persist(true);
      return result;
    },
    async plan(input) {
      if (!taskId) return null;
      return this.call('task-plan', input);
    },
    async resume(){if(resumeStore?.read()){await connect();return this.call('pair-status');}return null;},
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
