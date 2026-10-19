export function outcomeOf(result){
 if(result?.hostReported==='failure'||result?.valueObserved===false)return 'rejected';
 if(result?.businessVerified===true)return 'business_verified';
 if(result?.hostReported==='success')return 'host_reported_saved';
 if(result?.valueObserved===true||result?.navigated&&result?.verified)return 'local_state_verified';
 if(result?.highlighted)return 'prepared';
 return 'unknown';
}
export function outcomeMeets(actual,required='effect_observed'){
 const levels={prepared:0,local_state_verified:1,host_reported_saved:2,business_verified:3};
 if(required==='effect_observed')return Object.hasOwn(levels,actual);
 return Object.hasOwn(levels,required)&&Object.hasOwn(levels,actual)&&levels[actual]>=levels[required];
}
export function executionFailure(error,{dispatched=false,results=[]}={}){
 const message=error?.message||'Execution failed';
 const known=/changed|review|required|constraint|invalid|missing|ambiguous|not found|did not load|cancel|stopped|policy|denied/i.test(message);
 const reason=error?.code||(/constraint|invalid|missing/i.test(message)?'FIELD_VALIDATION':/changed/i.test(message)?'SCREEN_CHANGED':/ambiguous|not found|did not load/i.test(message)?'CONTROL_UNAVAILABLE':/cancel|stopped/i.test(message)?'CANCELLED':'EXECUTION_FAILED');
 return Object.assign(error instanceof Error?error:new Error(message),{code:reason,outcome:error?.outcome||(dispatched&&!known?'unknown':'rejected'),results});
}
// One dispatcher for chat, recipe and server-command effects. It never retries writes.
export function createTaskController({inspector,request,onState=()=>{},storage,clock=Date.now,deadlineMs=55_000}={}){
 if(!Number.isSafeInteger(deadlineMs)||deadlineMs<1000||deadlineMs>120000)throw new Error('Invalid task deadline');
 let busy=false,generation=0,progressSink;
 const emit=(stage,detail={})=>{const state={stage,at:clock(),...detail};onState(state);progressSink?.(state);};
 return {
  get busy(){return busy;},
  stop(){generation++;emit('cancelled');},
  async execute(proposal,{active=()=>true,beforeAction=async()=>{},requiredOutcome='effect_observed',verifyOutcome,settle,onProgress}={}){
   if(busy)throw Object.assign(new Error('A task is already running. Stop it or wait for its result.'),{code:'TASK_BUSY'});
   busy=true;progressSink=onProgress;const start=clock(),token=generation,results=[];let dispatched=false;
   const check=()=>{if(!active()||token!==generation)throw new Error('Task stopped; remaining actions cancelled');if(clock()-start>=deadlineMs)throw new Error('Task deadline reached. Inspect the host before retrying.');};
   try{
    for(const [index,action]of proposal.actions.entries()){
     dispatched=false;check();emit('observing',{index,total:proposal.actions.length});await beforeAction(action);check();
     emit('authorizing',{index});
     if(action.type==='submit'&&proposal.outcomeProfile?.mode==='signed_readback'&&!verifyOutcome)throw Object.assign(new Error('This website requires saved-record verification. Its host receipt integration is unavailable; no Save was dispatched.'),{code:'HOST_VERIFICATION_REQUIRED'});
     const marker=action.actionId&&`flolah-action-v1:${action.actionId}`;
     if(marker){if(!storage)throw new Error('Browser action storage unavailable. No action was dispatched.');if(storage.getItem(marker))throw Object.assign(new Error('This action was already dispatched. Inspect the host; no retry was attempted.'),{code:'ACTION_ATTEMPT_DENIED'});
      await request('/v1/actions/dispatch',{actionId:action.actionId,fence:action.fence});check();storage.setItem(marker,String(action.grantExpiresAt));}
     emit('applying',{index});
     // Adapter checks still run immediately before the effect. A crash here is unknown.
     dispatched=true;
     const args={ref:action.ref,value:action.value,query:action.query,select:action.select,expectedRevision:proposal.revision,activation:action.activation,observationMs:proposal.outcomeProfile?.observationMs,approved:true,active:()=>active()&&token===generation};
     if(action.type==='submit')emit('waiting_host',{index});
     let result=await (action.type==='fill'?inspector.fill(args):action.type==='submit'?inspector.submit(args):action.type==='navigate'?inspector.navigate(args):action.type==='highlight'?inspector.highlight(args):Promise.reject(new Error('Unsupported action')));
     emit('verifying',{index});
     if(action.type==='submit'&&verifyOutcome&&result.hostReported==='success'){let proof;try{proof=await verifyOutcome(action);}catch(error){throw Object.assign(new Error('The host reported success, but saved-record verification failed. Inspect the record before retrying.'),{code:'OUTCOME_UNKNOWN',outcome:'unknown'});}check();if(proof?.verified===true)result={...result,businessVerified:true};}
     const outcome=outcomeOf(result);result={...result,outcome};results.push(result);
     if(marker)await request('/v1/actions/observe',{actionId:action.actionId,fence:action.fence,outcome:outcome==='business_verified'?'host_reported_saved':outcome}).catch(()=>{});
     if(['rejected','unknown'].includes(outcome))throw Object.assign(new Error(result.reason||result.message||'The host did not verify the requested change.'),{outcome,code:outcome==='unknown'?'OUTCOME_UNKNOWN':'HOST_REJECTED'});
     dispatched=false;check();
    }
    if(settle&&proposal.actions.every(a=>a.type==='fill')){emit('waiting_host');await settle();check();}
    const outcome=results.length?results.map(r=>r.outcome).reduce((a,b)=>outcomeMeets(a,b)?b:a):'prepared';
    if(!outcomeMeets(outcome,requiredOutcome))throw Object.assign(new Error(`Required ${requiredOutcome}; observed ${outcome}. Inspect the host before another write.`),{code:'REQUIRED_OUTCOME_NOT_MET',outcome});
    emit(outcome==='host_reported_saved'?'completed_unverified':'completed',{outcome});return {results,outcome,saved:outcome==='business_verified'};
   }catch(error){const failure=executionFailure(error,{dispatched,results});emit(failure.outcome==='unknown'?'outcome_unknown':'blocked',{reason:failure.code,applied:results.filter(r=>r.outcome==='local_state_verified').length});throw failure;}
   finally{busy=false;progressSink=undefined;}
  },
 };
}
