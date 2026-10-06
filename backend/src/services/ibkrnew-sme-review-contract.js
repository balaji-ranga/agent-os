export const IBKRNEW_SME_REVIEW_TOOLS = Object.freeze([
  'ibkrnew_paper_strategy_status',
  'ibkrnew_paper_instrument_readiness',
  'ibkrnew_paper_decision_history',
]);

// A narrow per-turn evidence source contract, not new permissions or a trading
// policy. Legacy portfolio requests and explicitly requested changes keep their
// normal tool selection. Only an existing Paper goal/strategy review is scoped.
export function ibkrNewSmeReviewContract(agent, prompt, grantedTools = []) {
  if (agent?.template_base_id !== 'ibkr-portfolio-strategy-sme') return null;
  const text = String(prompt || '');
  if (!/\b(?:ibkrnew|paper|strategy|strategies|goal)\b/i.test(text) || !/\b(?:review|check|status|readiness|ready|active|blocked|blockers|prerequisites?|interpret)\b/i.test(text)) return null;
  const affirmative = text.replace(/\b(?:do not|don't|never|without|no changes?)\b[^.!?\n]*/gi, '');
  if (/\b(?:draft|publish|modify|reset|pause|resume|restart|deploy|configure|activate|propose|design|change|fix)\b/i.test(affirmative)) return null;
  const missing = IBKRNEW_SME_REVIEW_TOOLS.filter(name => !grantedTools.includes(name));
  return {
    tools: IBKRNEW_SME_REVIEW_TOOLS.filter(name => grantedTools.includes(name)),
    missing,
    instruction: `[IBKRNEW PAPER REVIEW — CURRENT TURN]\nThis is an existing Paper strategy review, not a legacy portfolio/preflight request. ${missing.length ? `Missing required granted tools: ${missing.join(', ')}. Report that exact capability gap; do not substitute legacy results.` : `Invoke all three read-only evidence tools: ${IBKRNEW_SME_REVIEW_TOOLS.join(', ')}. Start with strategy status, then instrument readiness and decision history. All are granted in this turn.`}\nUse only this fresh IBKRNew evidence for the conclusion, not earlier chat assertions or legacy preflight/account-snapshot/draft results. Enabled strategy outside the market session is NOT disabled trading. State exact goal and cycle IDs, six-agent enablement, provider/profile gate counts, quote capacity and actual recent veto reasons. Distinguish conditional profile passes from executable trade readiness and account exposure from goal-attributed profit. If evidence is missing, say so; never claim no profile gaps without the readiness result. This review must not create drafts, change settings, refresh, reserve or submit/cancel orders.`,
  };
}
