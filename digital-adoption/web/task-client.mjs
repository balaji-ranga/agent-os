import {outcomeOf,outcomeMeets} from './task-controller.mjs';
import {newlyAvailableFields} from './dependent-controls.mjs';
// Runs in the SDK closure, not the widget iframe. No credentials reach the panel.
export function createTaskClient({
  request,
  service,
  inspect,
  inspectPeer=inspect,
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
    reconnectTimer,
    reconnectAttempts = 0,
    closed = false,
    generation = 0;
  const seen = new Map();
  const notify = value => onEvent(value);
  const recover = () => {
    if(closed || !resumeStore?.read() || reconnectTimer || reconnectAttempts>=3)return;
    reconnectTimer=setTimeout(async()=>{
      reconnectTimer=null;reconnectAttempts++;
      try { await connect(); const status=await api.call('pair-status');notify({type:'pairing-restored',status}); }
      catch(error){notify({type:'pairing-offline',reason:`Connection recovery stopped: ${error.message}. Use Refresh paired sessions to try again. No action was replayed.`});
        if(!['SESSION_ENDED','SESSION_ACCESS_DENIED','PAIRING_ALREADY_ONLINE'].includes(error.code))recover();}
    },[1000,3000,8000][reconnectAttempts]);
  };
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
      for(const [commandId,entry]of seen)if(!entry.done)notify({type:'workflow-result',commandId,action:entry.action,workflow:entry.workflow,ok:false,code:['fill','navigate','submit'].includes(entry.action)?'OUTCOME_UNKNOWN':'RECIPIENT_OFFLINE'});
      seen.clear();
      taskId = null;
      notify({type:'task-ended',reason:'Connection closed. Unfinished workflow steps fail; reconnect does not replay them.'});
      notify({type:'pairing-offline',reason:'Connection offline. Saved group retained; reconnect before sending. Unfinished actions are not replayed.'});
      recover();
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
          reconnectAttempts=0;
          notify({type:'connection-restored',paired:ticket.paired});
          resolve();
          return;
        }
        if(message.type==='pairing-policy-updated'){notify({type:message.type,expiresAt:message.expiresAt,idleMs:message.idleMs});return;}
        if(message.type==='pairing-revoked'){if(typeof message.resumeProof==='string')resumeStore?.write(message.resumeProof);notify({type:'pairing-offline',reason:'The website owner revoked or expired this group. Create a new pairing or workflow link; no failed action was replayed.'});return;}
        if (message.type === 'task-ended') {
          if (taskId !== message.taskId) return;
          generation++;
          seen.clear();
          if (taskId === message.taskId) taskId = null;
          notify(message);
          return;
        }
        if(message.type==='peer-result'){notify(message);return;}
        if(message.type==='peer-request'){
          taskId=message.taskId;notify(message);
          if(message.mode==='inspect'){try{if(hostIdentity)await hostIdentity();await request('/v1/tasks/peer-answer',{instanceId,requestId:message.requestId,snapshot:inspectPeer(message.instruction)});}catch(error){notify({type:'peer-error',requestId:message.requestId,message:error.message});}}
          return;
        }
        if (message.type === 'task-shared') {
          taskId = message.taskId;
          notify(message);
          return;
        }
        if(message.type==='command-outcome'){const cached=seen.get(message.commandId);if(cached)notify({type:'workflow-result',commandId:message.commandId,action:message.action,workflow:message.workflow,ok:message.ok,code:message.code,outcome:message.outcome,result:message.ok?{...cached.done?.result,outcome:message.outcome}:undefined});return;}
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
        seen.set(message.commandId, {action:message.action,workflow:message.workflow});
        let lastProgressAt=0,lastProgressStage,waitReported=false;
        const progress=state=>{if(commandGeneration!==generation)return;const firstWait=state.stage==='waiting_host'&&!waitReported;if(firstWait)waitReported=true;if(!firstWait&&(Date.now()-lastProgressAt<500||lastProgressStage===state.stage))return;lastProgressAt=Date.now();lastProgressStage=state.stage;try{send({type:'progress',commandId:message.commandId,stage:state.stage});}catch{}};
        send({
          type: 'ack',
          commandId: message.commandId
        });
        let result;
        try {
          if (hostIdentity) await hostIdentity();
          let snapshot = inspect(message.instruction);
          let proposal = await request('/v1/tasks/command-plan', {
            instanceId,
            commandId: message.commandId,
            snapshot
          });
          if (message.action === 'prepare') {
            taskId = message.taskId;
            notify({
              type: 'workflow-proposal',
              commandId: message.commandId,
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
            for(let stage=0;stage<3;stage++){
            for (let effectIndex = 0; effectIndex < proposal.actions.length; effectIndex++) {
              if (hostIdentity) await hostIdentity();
              const grant = await request('/v1/tasks/effect', {
                instanceId,
                commandId: message.commandId,
                proposalId: proposal.id,
                revision: proposal.revision,
                effectIndex
              });
              observations.push(...(await execute(grant,{task:message.instruction,onProgress:progress,active:()=>!closed&&commandGeneration===generation})));
            }
              if(message.action!=='fill')break;
              const next=inspect(message.instruction),dependent=newlyAvailableFields(snapshot,next,message.instruction);
              if(!dependent.length)break;
              if(stage===2)throw Object.assign(new Error('Dependency stage limit reached; review remaining controls.'),{code:'DEPENDENCY_LIMIT',outcome:'rejected'});
              proposal=await request('/v1/tasks/command-plan',{instanceId,commandId:message.commandId,snapshot:next,continuation:true});snapshot=next;
              if(!proposal.actions?.length)throw Object.assign(new Error('New dependent controls need clarification.'),{code:'DEPENDENCY_CLARIFICATION',outcome:'rejected'});
            }
            if (observations.some(r => r.valueObserved === false || r.hostReported === 'failure')) throw new Error('Host rejected changes');
            result = {
              observations,
              savedVerified: observations.some(o=>o.businessVerified===true),outcome:observations.map(outcomeOf).reduce((a,b)=>outcomeMeets(a,b)?b:a)
            };
            if(!outcomeMeets(result.outcome,message.requiredOutcome||'effect_observed'))throw Object.assign(new Error('The required outcome was not verified.'),{code:'REQUIRED_OUTCOME_NOT_MET',outcome:result.outcome});
          } else result = proposal;
          const done = {
            type: 'result',
            commandId: message.commandId,
            ok: true,
            result
          };
          if (commandGeneration === generation) {
            notify({type:'workflow-observation',commandId:message.commandId});
            seen.set(message.commandId, {
              done,action:message.action,workflow:message.workflow
            });
            send(done);
          }
        } catch (error) {
          if(commandGeneration===generation)notify({type:'workflow-observation',commandId:message.commandId,reason:error.message});
          const done = {
            type: 'result',
            commandId: message.commandId,
            ok: false,
            code: error.outcome==='unknown'?'OUTCOME_UNKNOWN':error.code||'EXECUTION_FAILED'
          };
          if (commandGeneration === generation) seen.set(message.commandId, {
            done,action:message.action,workflow:message.workflow
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
  const api = {
    adoptTask(id){if(typeof id==='string'&&id){taskId=id;notify({type:'task-active',taskId});}},
    get instanceId(){return instanceId;},
    get taskScope(){return taskId&&instanceId?{taskId,instanceId}:null;},
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
      const requestedTaskId=taskId;
      const result = await request(`/v1/${pair ? 'pair' : 'tasks'}/${action}`, {
        ...input,
        instanceId,
        ...(!pair && taskId ? {
          taskId
        } : {})
      }).catch(error=>{if(error.code==='TASK_ENDED'&&taskId===requestedTaskId){taskId=null;generation++;seen.clear();notify({type:'task-ended',reason:'The previous private task expired. Pairing is separate; explicitly resend to start fresh. Old files remain inaccessible.'});}if(['TASK_ACCESS_DENIED','SESSION_ENDED','SESSION_ACCESS_DENIED'].includes(error.code)){clearTimeout(reconnectTimer);reconnectTimer=null;reconnectAttempts=3;socket?.close();connecting=null;instanceId=null;notify({type:'pairing-offline',reason:'Connection authorization ended. Reconnect to the saved group; this action was not retried.'});}throw error;});
      if((type==='task-relay'&&result.shared||type==='task-peer-request')&&result.taskId){taskId=result.taskId;notify({type:'task-active',taskId});}
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
      clearTimeout(reconnectTimer);
      socket?.close();
      taskId = null;
      seen.clear();
    }
  };
  return api;
}
