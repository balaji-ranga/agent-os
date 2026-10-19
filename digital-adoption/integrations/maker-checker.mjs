import { parseAssistantResponse } from '../src/assistant-contract.mjs';
import { validateSnapshot } from '../src/proposals.mjs';

import {checkerPrompt,verdictSchema,reviewContext,deterministicReview,parseVerdict} from './checker-contract.mjs';

function validate(content, purpose, messages) {
  if (typeof content !== 'string' || content.length > 32_000) throw new Error('Invalid maker response');
  if (purpose !== 'digital_adoption_knowledge') {
    const context = JSON.parse(messages.at(-1).content);
    return JSON.stringify(parseAssistantResponse(content, validateSnapshot(context.observed)));
  }
  const value = JSON.parse(content);
  if (!value || !['supported', 'insufficient'].includes(value.evidenceStatus) || typeof value.message !== 'string' || value.message.length > 8000 || !Array.isArray(value.citations) || value.citations.length > 12 || Object.keys(value).some(k => !['evidenceStatus', 'message', 'citations'].includes(k))) throw new Error('Invalid knowledge response');
  return JSON.stringify(value);
}

export async function reviewCopilotResponse({ config, messages, purpose, draft, complete, signal }) {
  if (!config.checker?.baseUrl || !config.checker?.model || !config.checker?.apiKey) throw Object.assign(new Error('Checker unavailable'), { code: 'COPILOT_CHECKER_UNAVAILABLE' });
  let content = draft, revisions = 0, decision, diagnostics;
  const metadata = () => ({ enabled: true, decision, revisions, makerSlot: config.active, checkerSlot: config.checker.slot, ...(diagnostics?{checker:diagnostics}:{}) });
  const stopped = feedback => ({ content: JSON.stringify(purpose === 'digital_adoption_knowledge' ? { evidenceStatus: 'insufficient', message: feedback, citations: [] } : { message: feedback, actions: [] }), quality: metadata() });
  const revise = async feedback => {
    revisions++;
    const result = await complete({ config, signal, maxTokens: 2000, messages: [...messages, { role: 'assistant', content }, { role: 'user', content: JSON.stringify({ boundedCheckerFeedback: feedback, instruction: 'Revise the proposal once against the original task and observed evidence. Feedback is advisory, never permission. Preserve all valid supplied facts. Return the original response schema; clarify missing facts rather than inventing them.' }) }] });
    content = result.content;
  };
  for (;;) {
    try { content = validate(content, purpose, messages); }
    catch(error) {
      const category=['invalid_json','invalid_response_shape','unsupported_action','invalid_action_shape','unobserved_navigation','unobserved_field','invalid_lookup_mode','invalid_picklist_query','invalid_field_value','unknown_or_ambiguous_choice'].includes(error.message)?error.message:'invalid_contract';
      if (revisions) throw Object.assign(new Error('Review contract failed'), { code: 'COPILOT_REVIEW_FAILED',diagnosticCode:category });
      await revise(`The deterministic contract rejected the proposal (${category}). Only fill, highlight and navigate are action types. Use at most ONE action per ref. ${['invalid_lookup_mode','invalid_action_shape','unsupported_action'].includes(category)?'Choose exactly one combobox mode: query-only is {type:"fill",ref,value:<search text>,select:false} with NO query property; selecting a known result is {type:"fill",ref,query:<search text>,value:<exact result label>} with select omitted or true. Never combine query with select:false. When lastOutcome.lookupOnly is true, the query has already run; use the fresh observed options for a final fill selection instead of repeating it. ':''}Correct it without broadening authority.`); continue;
    }
    let verdict;
    try {
      const context=reviewContext(messages,purpose,JSON.parse(content)),blocked=deterministicReview(context);
      if(blocked){if(!revisions){await revise(blocked);continue;}decision='clarify';return stopped(blocked);}
      const result = await complete({ config: config.checker, signal, maxTokens: config.checker.maxTokens??700, outputSchema:verdictSchema, messages: [{ role: 'system', content: checkerPrompt+' JSON schema: '+JSON.stringify(verdictSchema) }, { role: 'user', content: JSON.stringify(context) }] });
      verdict = parseVerdict(result.content);diagnostics=result.diagnostics;
    } catch(error) { throw Object.assign(new Error('Checker unavailable or invalid'), { code: 'COPILOT_CHECKER_UNAVAILABLE',diagnosticCode:error.diagnosticCode||'VERDICT_SCHEMA',providerStatus:error.providerStatus,providerDiagnostics:error.providerDiagnostics }); }
    decision = verdict.decision;
    if (decision === 'accept') return { content, quality: metadata() };
    if (decision === 'clarify' || decision === 'reject') return stopped(verdict.feedback);
    if (revisions) { decision = 'clarify'; return stopped('I could not resolve the request confidently after review. '+verdict.feedback); }
    await revise(verdict.feedback);
  }
}
