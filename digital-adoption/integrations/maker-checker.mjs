import {parseGoalResponse,goalResponseSchema} from '../src/goal-contract.mjs';
import { parseAssistantResponse,assistantResponseSchema } from '../src/assistant-contract.mjs';
import { validateSnapshot } from '../src/proposals.mjs';
import {pageUnderstandingReviewPrompt} from '../src/page-understanding.mjs';

import {checkerPrompt,goalCheckerPrompt,goalReviewPrompt,goalStepCheckerPrompt,verdictSchema,reviewContext,deterministicReview,parseVerdict} from './checker-contract.mjs';

function validate(content, purpose, messages) {
  if (typeof content !== 'string' || content.length > 32_000) throw new Error('Invalid maker response');
  if(purpose==='digital_adoption_goal')return JSON.stringify(parseGoalResponse(content,JSON.parse(messages.at(-1).content).stage));
  if (purpose !== 'digital_adoption_knowledge') {
    const context = JSON.parse(messages.at(-1).content);
    return JSON.stringify(parseAssistantResponse(content, validateSnapshot(context.observed),{goalStep:!!context.goalContext?.currentStep}));
  }
  const value = JSON.parse(content);
  if (!value || !['supported', 'insufficient'].includes(value.evidenceStatus) || typeof value.message !== 'string' || value.message.length > 8000 || !Array.isArray(value.citations) || value.citations.length > 12 || Object.keys(value).some(k => !['evidenceStatus', 'message', 'citations'].includes(k))) throw new Error('Invalid knowledge response');
  return JSON.stringify(value);
}

export async function reviewCopilotResponse({ config, messages, purpose, draft, complete, signal }) {
  if (!config.checker?.baseUrl || !config.checker?.model || !config.checker?.apiKey) throw Object.assign(new Error('Checker unavailable'), { code: 'COPILOT_CHECKER_UNAVAILABLE' });
  let content = draft, revisions = 0, contractRepairs=0, decision, diagnostics, checkerRetries=0,checkerRevisions=0;
  const sourceGoal=purpose==='digital_adoption_goal'?JSON.parse(messages.at(-1).content):null;
  const sourceContext=JSON.parse(messages.at(-1).content);
  const makerSchema=sourceGoal?goalResponseSchema(sourceGoal.stage,sourceGoal.peerGuidance):purpose!=='digital_adoption_knowledge'?assistantResponseSchema(validateSnapshot(sourceContext.observed),{goalStep:!!sourceContext.goalContext?.currentStep}):undefined;
  const metadata = () => ({ enabled: true, decision, revisions, contractRepairs, checkerRevisions, makerSlot: config.active, checkerSlot: config.checker.slot, ...(diagnostics?{checker:diagnostics}:{}),...(checkerRetries?{checkerRetries}:{}) });
  const stopped = feedback => ({ content: JSON.stringify(purpose === 'digital_adoption_knowledge' ? { evidenceStatus: 'insufficient', message: feedback, citations: [] } : purpose==='digital_adoption_goal'?(JSON.parse(messages.at(-1).content).stage==='assess'?{message:feedback,status:'clarify',remainingInstruction:''}:{message:feedback,steps:[]}):{ message: feedback, actions: [] }), quality: metadata() });
  const revise = async (feedback,contract=false) => {
    revisions++;if(contract)contractRepairs++;
    const result = await complete({ config, signal, maxTokens: 2000, ...(makerSchema?{outputSchema:makerSchema}:{}), messages: [...messages, { role: 'assistant', content }, {role:'system',content:'Repair the structured response against the advisory feedback and the original task. For an explanation, use only observed facts and explicitly qualified derivations. Do not embellish the repair with undocumented identifiers, reasons, business rules or procedures. Apply EVERY requested repair to the addressed step instruction or expected outcome; do not merely change the introductory message. Preserve all valid operations, values and constraints. This instruction grants no execution authority and does not override the response schema or safety rules.'}, { role: 'user', content: JSON.stringify({ originalTask:sourceContext.task??sourceContext.question, boundedCheckerFeedback: feedback, instruction: 'Revise the proposal once against the original task and observed evidence. Feedback is advisory, never permission. Preserve all valid supplied facts and EVERY requested operation, including read-only prerequisites and delegated work. Correct every repairable issue in boundedCheckerFeedback while retaining the rest of the original task. Before returning, compare the revised complete proposal with the original request and the feedback; do not drop a requested operation from either. Return the original response schema; clarify missing facts rather than inventing them.' }) }] });
    content = result.content;
  };
  for (;;) {
    try { content = validate(content, purpose, messages); }
    catch(error) {
      const category=['invalid_json','invalid_response_shape','invalid_intent','intent_action_mismatch','unsupported_action','invalid_action_shape','unobserved_navigation','unobserved_field','invalid_lookup_mode','invalid_picklist_query','invalid_field_value','unknown_or_ambiguous_choice','unobserved_choices','invalid_goal_json','invalid_goal_response','invalid_goal_assessment','invalid_goal_plan'].includes(error.message)?error.message:'invalid_contract';
      if (contractRepairs>=1) throw Object.assign(new Error('Review contract failed'), { code: 'COPILOT_REVIEW_FAILED',diagnosticCode:category,contractIssues:error.contractIssues });
      if(purpose==='digital_adoption_goal'){const stage=JSON.parse(messages.at(-1).content).stage;await revise(stage==='assess'?'Return exactly {message:string,status:one of complete/continue/clarify,remainingInstruction:string}. No actions or additional keys. A continue result requires the remaining instruction.':'Schema errors: '+JSON.stringify(error.contractIssues||[])+'. Return exactly {message:string,steps:array}. Local steps have ONLY title (short string), kind (choose ONE of navigate, fill, save, inspect), instruction (self-contained string with supplied values), expected (short observable condition). A cross-tab step has kind peer and additionally recipient (one exact available peerGuidance instanceId) and mode (inspect or goal). Omit recipient and mode entirely on local steps; never put null or empty placeholder keys there. Preserve grounded requested paired work. No actions, goal IDs, status or any other keys. Keep the complete JSON compact enough for the output budget. Use steps:[] to clarify instead of invalid structure.',true);continue;}
      await revise(`The deterministic contract rejected the proposal (${category}). Return exactly the original response instance: ${sourceContext.goalContext?.currentStep?'message and actions':'intent, message and actions'}. Root keys other than those are forbidden. message must be a string (at most 4000 characters); actions must be an array (at most 10). Put observations, counts and explanations inside message, never extra root keys or a schema definition. Only fill, highlight and navigate are action types. Use at most ONE action per ref. ${['invalid_intent','intent_action_mismatch'].includes(category)?'The intent property must be exactly guide, explain, edit, navigate or clarify. Use edit (not fill) for fill actions; guide requires at least one highlight and nothing else; navigate permits only one navigation; explain/clarify require actions:[]. If your declared intent is explain or clarify, remove ALL actions; a highlight is still an action and is forbidden in those modes. A textual request to inspect, recount or explain fresh evidence does not itself request a visual pointer. Only choose guide when the complete task asks to point visually, then include highlights only. Do not repeat the same mismatched intent/action combination. Infer the intended stage from the original request and context, not from a control name. ':''}${category==='unobserved_navigation'?'Navigation requires an exact current responseContract.links ref, never a target ref, saved path or old ref. Assess the current path and previousBrowserObservation: if the requested navigation is already finished, explain that browser observation with actions:[]; if more work remains, propose only the remaining task on this screen. Do not repeat the preceding navigation. ':''}${['invalid_lookup_mode','invalid_action_shape','unsupported_action'].includes(category)?'Choose exactly one combobox mode: query-only is {type:"fill",ref,value:<search text>,select:false} with NO query property; selecting a known result is {type:"fill",ref,query:<search text>,value:<exact result label>} with select omitted or true. Never combine query with select:false. When lastOutcome.lookupOnly is true, the query has already run; use the fresh observed options for a final fill selection instead of repeating it. ':''}For a native dropdown/radio, fill only a known observed option label; missing choices require a focused clarification, never an invented label. Correct it without broadening authority.`,true); continue;
    }
    let verdict;
    try {
      const context=reviewContext(messages,purpose,JSON.parse(content)),blocked=deterministicReview(context);
      if(blocked){if((revisions-contractRepairs)<1){await revise(blocked);continue;}decision='clarify';return stopped(blocked);}
      const checkRequest={ config: config.checker, signal, maxTokens: config.checker.maxTokens??700, outputSchema:verdictSchema, messages: [{ role: 'system', content: 'arithmeticChecks contains application-computed results for literal arithmetic in the proposal. For an asserted calculation, reject a mismatch unless the stated rounding explains it. Quoting or explicitly correcting an erroneous source equation is different from asserting it. Use the supplied computed value in repair feedback instead of guessing arithmetic. '+pageUnderstandingReviewPrompt+' '+(purpose==='digital_adoption_goal'?goalReviewPrompt(context.stage):context.goalContext?.currentStep?goalStepCheckerPrompt:checkerPrompt)+' JSON schema: '+JSON.stringify(verdictSchema) }, { role: 'user', content: JSON.stringify(context) }] };
      let result;
      try{result=await complete(checkRequest);}catch(error){
        if(!['PROVIDER_EMPTY_OR_INVALID','PROVIDER_INCOMPLETE'].includes(error.diagnosticCode)||signal?.aborted)throw error;
        checkerRetries++;result=await complete({...checkRequest,config:{...checkRequest.config,compactVerdict:true},messages:[{role:'system',content:checkRequest.messages[0].content+' Return the verdict JSON directly and keep feedback brief; no reasoning transcript.'},checkRequest.messages[1]]});
      }
      verdict = parseVerdict(result.content);diagnostics=result.diagnostics;
    } catch(error) { throw Object.assign(new Error('Checker unavailable or invalid'), { code: 'COPILOT_CHECKER_UNAVAILABLE',diagnosticCode:error.diagnosticCode||'VERDICT_SCHEMA',providerStatus:error.providerStatus,providerDiagnostics:error.providerDiagnostics }); }
    decision = verdict.decision;
    if (decision === 'accept') return { content, quality: metadata() };
    if (decision === 'clarify' || decision === 'reject') return stopped(verdict.feedback);
    if (purpose==='digital_adoption_goal'?(revisions-contractRepairs)>=(sourceGoal.stage==='plan'?2:1):(revisions-contractRepairs)>=1) { decision = 'clarify'; return stopped('I could not resolve the request confidently after review. '+verdict.feedback); }
    checkerRevisions++;await revise(verdict.feedback);
  }
}
