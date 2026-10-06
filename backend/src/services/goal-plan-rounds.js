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

/**
 * Parse a model's structured response without turning a transport formatting
 * problem into an opaque maker/checker crash. Providers may wrap JSON in a
 * fence or append a short explanation; balanced extraction handles both while
 * still failing closed when a string/object is genuinely truncated.
 */
export function parseStructuredPlanResponse(raw) {
  const text = String(raw || '').trim();
  if (!text) return { value: null, error: 'empty response' };
  const candidates = [];
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1]?.trim();
  if (fenced) candidates.push(fenced);
  candidates.push(text);
  const start = text.indexOf('{');
  if (start >= 0) {
    let depth = 0;
    let quoted = false;
    let escaped = false;
    for (let i = start; i < text.length; i += 1) {
      const ch = text[i];
      if (quoted) {
        if (escaped) escaped = false;
        else if (ch === '\\') escaped = true;
        else if (ch === '"') quoted = false;
        continue;
      }
      if (ch === '"') { quoted = true; continue; }
      if (ch === '{') depth += 1;
      else if (ch === '}') {
        depth -= 1;
        if (depth === 0) {
          candidates.push(text.slice(start, i + 1));
          break;
        }
      }
    }
  }
  let lastError = 'invalid JSON object';
  for (const candidate of candidates) {
    try {
      const value = JSON.parse(candidate);
      if (value && typeof value === 'object') return { value, error: null };
      lastError = 'structured response must be a JSON object or array';
    } catch (error) {
      lastError = error?.message || lastError;
    }
  }
  return { value: null, error: lastError };
}

export async function runGoalPlanRounds({prompt,make,check,normalize,validate,onProgress=async()=>{},checkerIssueFilter=null,repair=null}) {
  let previous=null, errors=[], maker=null, checker=null, checkerRecommended=null;
  const rounds=[];
  for(let attempt=1;attempt<=3;attempt++){
    await onProgress({phase:'maker',detail:`Maker round ${attempt} of 3`,attempt,max_attempts:3});
    try{
      maker=await make({attempt,previous,errors});
      const makerParsed = parseStructuredPlanResponse(maker.content);
      const steps=makerParsed.value ? normalize(JSON.stringify(makerParsed.value)) : [];
      const valid=validate(steps);
      const deterministicErrors=!steps.length||!valid.ok
        ? (valid.errors?.length?valid.errors:['Maker returned no executable steps']) : [];
      if (!makerParsed.value) deterministicErrors.unshift(`Maker returned invalid structured JSON: ${makerParsed.error}`);
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
        makerRationale: makerParsed.value?.repair_rationale || null,
      });
      const checkerParsed = parseStructuredPlanResponse(checker.content);
      const verdict = checkerParsed.value;
      const checkerErrors = checkerParsed.value
        ? validateCoverage(verdict,prompt,steps)
        : [`Checker returned invalid structured JSON: ${checkerParsed.error}`];
      errors=[...deterministicErrors,...(typeof checkerIssueFilter === 'function'
        ? checkerIssueFilter({ errors: checkerErrors, verdict, steps })
        : checkerErrors)];
      if(!errors.length){
        await onProgress({phase:'complete',detail:`${steps.length} independently approved executable steps`,attempt,max_attempts:3,status:'completed'});
        return {steps,quality:{maker_model:maker.modelUsed,checker_model:checker.modelUsed,checker_endpoint:'secondary',checker_degraded:false,checker_approved_maker:true,maker_attempts:attempt,maker_contract_valid:true,maker_degraded_to_catalog:false,llm_maker_checker_succeeded:true,requirements:buildGoalRequirements(prompt),coverage:verdict.coverage,rounds,issues:[]}};
      }
      let nextSteps=steps;
      // Repair deterministic dependency-contract omissions before asking the
      // model to rewrite the whole plan. A checker can correctly identify
      // that a downstream input is required while the maker keeps returning
      // the same otherwise-valid plan without declaring that output. Repairing
      // only the missing produces entry is bounded and preserves all maker
      // assignments, instructions, and tool choices.
      if (typeof repair === 'function') {
        const repaired = repair({ steps, errors, verdict });
        if (Array.isArray(repaired) && repaired.length) nextSteps = repaired;
      }
      if(verdict?.approved===false&&Array.isArray(verdict.revised_steps)&&verdict.revised_steps.length){
        const revised=normalize(JSON.stringify(verdict.revised_steps));
        const revisedValidation=validate(revised);
        if(revised.length&&revisedValidation.ok){
          checkerRecommended=revised;
          nextSteps=revised;
        }else if(revisedValidation.errors?.length){
          errors.push(...revisedValidation.errors.map(item=>`Checker correction invalid: ${item}`));
        }
      }
      previous={maker_response:maker.content,steps:nextSteps,checker_response:verdict,maker_rationale:makerParsed.value?.repair_rationale || null};
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
  error.details={rounds,last_candidate:checkerRecommended||previous?.steps||[],checker_recommended_steps:checkerRecommended||[],fallback:'stop_for_review',business_steps_executed:0};
  throw error;
}
