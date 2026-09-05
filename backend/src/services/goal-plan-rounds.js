// Three complete, bounded maker/checker opportunities. A rejected plan is
// never converted into an approval merely because its JSON is executable.
export function buildGoalRequirements(prompt) {
  // Text boundaries only, never domain keywords or inferred requirements.
  return String(prompt || '').split(/(?<=[.!?;])\s+|\n+/u).map(text=>text.trim()).filter(Boolean)
    .map((text,index)=>({id:`r${index+1}`,text}));
}

export function validateCoverage(verdict, prompt, steps) {
  const errors=[];
  if(typeof verdict?.approved!=='boolean'||!Array.isArray(verdict?.issues))return ['Checker must return approved and issues'];
  if(!verdict.approved)return [...new Set(verdict.issues.map(i=>typeof i==='string'?i:[i?.message,i?.correction].filter(Boolean).join(' Correction: ')).filter(Boolean))].slice(0,8).concat('Checker rejected the plan');
  if(verdict.issues.length)errors.push('Approval contains unresolved issues');
  if(!Array.isArray(verdict.coverage)||!verdict.coverage.length)return errors.concat('Checker omitted requirement coverage');
  const keys=new Set(steps.map(s=>s.key));
  const requirements=new Set(buildGoalRequirements(prompt).map(r=>r.id));
  const covered=new Set();
  for(const item of verdict.coverage){
    if(!requirements.has(item.requirement_id))errors.push('Coverage must reference a supplied original requirement_id');
    else covered.add(item.requirement_id);
    if(item.covered!==true||!Array.isArray(item.step_keys)||!item.step_keys.length||item.step_keys.some(k=>!keys.has(k)))errors.push('A requested outcome lacks an executable step');
  }
  for(const id of requirements)if(!covered.has(id))errors.push(`Original requirement ${id} has no coverage assessment`);
  if(!Array.isArray(verdict.step_checks)||verdict.step_checks.length!==steps.length){
    errors.push('Checker omitted one semantic contract assessment per step');
  }else{
    const expected=new Set(steps.map(step=>step.key));
    const assessed=new Set();
    for(const item of verdict.step_checks){
      if(!expected.has(item?.step_key)||assessed.has(item?.step_key))errors.push('Checker semantic assessments must reference each actual step exactly once');
      else assessed.add(item.step_key);
      for(const field of ['instruction_preserves_goal','operation_mode_correct','deliverable_kind_correct','no_unrequested_action']){
        if(item?.[field]!==true)errors.push(`Step ${item?.step_key||'(unknown)'} failed semantic check ${field}`);
      }
    }
  }
  return errors;
}

export async function runGoalPlanRounds({prompt,make,check,normalize,validate,onProgress=async()=>{}}) {
  let previous=null, errors=[], maker=null, checker=null;
  const rounds=[];
  for(let attempt=1;attempt<=3;attempt++){
    await onProgress({phase:'maker',detail:`Maker round ${attempt} of 3`,attempt,max_attempts:3});
    try{
      maker=await make({attempt,previous,errors});
      const steps=normalize(maker.content);
      const valid=validate(steps);
      const deterministicErrors=!steps.length||!valid.ok
        ? (valid.errors?.length?valid.errors:['Maker returned no executable steps']) : [];
      await onProgress({phase:'checker',detail:`Checker round ${attempt} of 3: validate every requested outcome`,attempt,max_attempts:3});
      // Even a schema-invalid candidate needs semantic feedback in this round:
      // otherwise three local field repairs can consume all rounds before the
      // checker ever sees omitted requirements. Invalid steps never execute.
      checker=await check({
        steps,
        attempt,
        validationErrors:deterministicErrors,
        priorCorrectionChecklist: errors,
        previousVerdict: previous?.checker_response || null,
      });
      const verdict=JSON.parse(String(checker.content).replace(/^```(?:json)?\s*/,'').replace(/\s*```$/,''));
      errors=[...deterministicErrors,...validateCoverage(verdict,prompt,steps)];
      if(!errors.length){
        await onProgress({phase:'complete',detail:`${steps.length} independently approved executable steps`,attempt,max_attempts:3,status:'completed'});
        return {steps,quality:{maker_model:maker.modelUsed,checker_model:checker.modelUsed,checker_endpoint:'secondary',checker_degraded:false,checker_approved_maker:true,maker_attempts:attempt,maker_contract_valid:true,maker_degraded_to_catalog:false,llm_maker_checker_succeeded:true,requirements:buildGoalRequirements(prompt),coverage:verdict.coverage,rounds,issues:[]}};
      }
      previous={maker_response:maker.content,steps,checker_response:verdict};
      rounds.push({attempt,phase:'checker',errors});
    }catch(error){
      errors=[String(error.message||error)];
      previous={...(previous||{}),maker_response:maker?.content,checker_response:checker?.content};
      rounds.push({attempt,phase:'error',errors});
    }
    await onProgress({phase:'maker_retry',detail:errors.join('; ').slice(0,600),attempt,max_attempts:3});
  }
  const error=new Error(`Goal planning could not establish a complete approved plan after 3 rounds: ${errors.join('; ').slice(0,800)}`);
  error.code='GOAL_PLAN_UNVERIFIED';
  error.details={rounds,last_candidate:previous?.steps||[],fallback:'stop_for_review',business_steps_executed:0};
  throw error;
}
