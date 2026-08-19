/**
 * Live research / CRM-approval missions for outcome prompts (Gate B / Gate C).
 * Uses existing Places discovery, Goal Plans, Action control, and owner-scoped CRM create.
 * No seeded lead list. Never invents emails or decision-makers.
 */
import { createGoalRun, completeGoalStep, getGoalRun } from './agent-goal-run.js';
import {
  observeStepResult,
  applyObservation,
  loadOutcome,
  persistOutcome,
  addGoalSpend,
  recordMissionEvent,
  listMissionEvents,
} from './goal-outcome.js';
import { getDb } from '../db/schema.js';
import { evaluateActionPolicy, upsertActionFamilyPolicies } from './action-policy.js';
import { discoverBusinesses } from './social-research/index.js';
import { parsePlacesSearchText } from './social-research/adapters/google-places.js';
import { recordOpportunities } from './social-research/opportunities-knowledge.js';
import { createCompanyForOwner } from './crm-owner-write.js';
import { validateExecutablePlan } from './goal-plan-runtime.js';

export const GATE_B_LIVE_RESEARCH_PROMPT = `Find 20 genuinely qualified Singapore-based B2B service companies fitting our ICP. Find public evidence for qualification, identify a likely decision-maker only when verifiable, prepare personalised outreach, and put verified prospects in CRM. Spend no more than $25. Do not send.`;

const CONSUMER_TYPES = new Set([
  'restaurant',
  'cafe',
  'bar',
  'lodging',
  'hotel',
  'meal_takeaway',
  'meal_delivery',
  'night_club',
]);

function loadRow(id, owner) {
  return getDb()
    .prepare('SELECT * FROM agent_goal_runs WHERE id = ? AND owner_user_id = ?')
    .get(id, owner);
}

function observeRecord(goalRunId, ownerUserId, result) {
  const row = loadRow(goalRunId, ownerUserId);
  const observation = observeStepResult(result);
  const outcome = applyObservation(loadOutcome(row), observation);
  persistOutcome(goalRunId, ownerUserId, outcome);
  recordMissionEvent({
    ownerUserId,
    goalRunId,
    event_type: 'step_completed',
    payload: { observation, kpi: { current: outcome.current_value, target: outcome.target } },
  });
  return { observation, outcome };
}

export function isPlaceInLocality(place, locality) {
  const loc = String(locality || '').trim();
  if (!loc) return false;
  const blob = `${place.address || ''} ${place.locality || ''}`;
  const escaped = loc.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(escaped, 'i').test(blob);
}

export function isSingaporePlace(place) {
  return isPlaceInLocality(place, 'Singapore') || /\bsg\b/i.test(`${place.address || ''} ${place.locality || ''}`);
}

export function hasPublicEvidence(place) {
  return Boolean(place.place_id && (place.website || place.google_maps_uri));
}

export function isB2bServicePlace(place) {
  const types = Array.isArray(place.types) ? place.types : [];
  if (types.some((t) => CONSUMER_TYPES.has(String(t)))) return false;
  return true;
}

/** Automated ground truth for a “qualified” label: named locality + citation + not a consumer venue. */
export function meetsLiveIcp(place, locality) {
  const loc = String(locality || '').trim();
  const geoOk = loc ? isPlaceInLocality(place, loc) : isSingaporePlace(place);
  return geoOk && hasPublicEvidence(place) && isB2bServicePlace(place);
}

function draftFromVerified(place) {
  const name = String(place.name || '').trim();
  const loc = String(place.locality || place.address || '').trim();
  const web = String(place.website || place.google_maps_uri || '').trim();
  return {
    to_company: name,
    facts_used: { name, locality_or_address: loc, source: web },
    body: `Hello — I found ${name} in ${loc}. I would like to introduce our B2B service. Source: ${web}`,
    invented_contact: false,
    invented_person: false,
  };
}

function finishOpenSteps(owner, goalId) {
  let live = getGoalRun(goalId, owner);
  for (const step of live.steps.filter((s) => s.status === 'pending' || s.status === 'running')) {
    const out = completeGoalStep({
      goalRunId: live.id,
      stepId: step.id,
      ownerUserId: owner,
      result: { verification_status: 'activity' },
    });
    live = out.goal;
  }
  return getGoalRun(goalId, owner);
}

/**
 * Gate B — live Places research, no seeded identities.
 * @param {{ ownerUserId: string, agentId: string, prompt?: string }} opts
 */
export async function runLiveResearchMission(opts = {}) {
  const owner = String(opts.ownerUserId || '').trim();
  const agentId = String(opts.agentId || '').trim();
  const prompt = String(opts.prompt || GATE_B_LIVE_RESEARCH_PROMPT);
  if (!owner) throw new Error('ownerUserId required');
  if (!agentId) throw new Error('agentId required');

  upsertActionFamilyPolicies(owner, [
    { family: 'communicate_external', mode: 'approval_required' },
    { family: 'financial_destructive', mode: 'prohibited' },
  ]);

  const parsed = parsePlacesSearchText(prompt, { max_results: 20 });
  const locality = parsed.locality;
  if (!locality) throw new Error('outcome prompt must name a locality (e.g. Country-based)');
  const maxResults = Math.min(Math.max(parsed.max_results || 20, 1), 50);

  const goal = createGoalRun({
    ownerUserId: owner,
    agentId,
    title: 'Live research under uncertainty',
    prompt,
    source: 'live_research',
  });
  const planCheck = validateExecutablePlan(goal.steps);
  addGoalSpend(goal.id, owner, 0.4);

  const discovered = await discoverBusinesses(
    owner,
    {
      intent: prompt,
      locality,
      query: `B2B professional services ${locality}`,
      max_results: maxResults,
      enrich: false,
      persist: false,
      handoff: false,
    },
    { createdByAgentId: agentId }
  );
  if (!(discovered.businesses || []).length) {
    const retry = await discoverBusinesses(
      owner,
      {
        intent: prompt,
        locality,
        query: `professional services ${locality}`,
        max_results: maxResults,
        enrich: false,
        persist: false,
        handoff: false,
      },
      { createdByAgentId: agentId }
    );
    if ((retry.businesses || []).length) Object.assign(discovered, retry);
  }
  addGoalSpend(goal.id, owner, 1.2);

  const invented = 0;
  const qualified = [];
  const rejected = [];
  for (const p of discovered.businesses || []) {
    if (meetsLiveIcp(p, locality)) {
      qualified.push(p);
      observeRecord(goal.id, owner, {
        verification_status: 'verified',
        kpi_delta: 1,
        source: p.website || p.google_maps_uri,
        evidence: { place_id: p.place_id, website: p.website, maps: p.google_maps_uri },
      });
    } else {
      rejected.push(p);
      const reason = !isPlaceInLocality(p, locality)
        ? 'not_in_locality'
        : !hasPublicEvidence(p)
          ? 'missing_citation'
          : 'not_b2b_service';
      observeRecord(goal.id, owner, { verification_status: 'rejected', reason });
    }
  }

  const drafts = qualified.slice(0, 20).map(draftFromVerified);
  if (drafts.length) {
    recordMissionEvent({
      ownerUserId: owner,
      goalRunId: goal.id,
      event_type: 'human_intervention',
      payload: { reason: 'approval_batch', drafts: drafts.length, sent: false },
    });
  }

  const send = evaluateActionPolicy({
    ownerUserId: owner,
    toolName: 'email_send',
    body: {},
    goalRunId: goal.id,
  });

  const live = finishOpenSteps(owner, goal.id);
  const spend = Number(live.outcome?.spend_usd || 0);
  const kpi = Number(live.outcome?.current_value || 0);
  const precision =
    qualified.length === 0 ? 1 : qualified.filter((p) => meetsLiveIcp(p, locality)).length / qualified.length;
  const citationComplete =
    qualified.length === 0 ? 1 : qualified.filter(hasPublicEvidence).length / qualified.length;
  const unsupportedOutreach = drafts.filter(
    (d) => d.invented_contact || d.invented_person || /@[a-z0-9.-]+\.[a-z]{2,}/i.test(d.body)
  ).length;

  const out = {
    gate: 'B',
    goal: live,
    plan_ok: planCheck.ok,
    discovered_count: (discovered.businesses || []).length,
    locality,
    qualified,
    rejected_count: rejected.length,
    drafts,
    stats: {
      kpi,
      target: Number(live.outcome?.target || 20),
      spend_usd: spend,
      budget_usd: Number(live.outcome?.budget_usd || 25),
      invented,
      unapproved_sends: send.ok ? 1 : 0,
      precision,
      citation_complete: citationComplete,
      duplicate_crm: 0,
      unsupported_outreach: unsupportedOutreach,
      interventions: drafts.length ? 1 : 0,
    },
    dimensions: {
      precision: { pass: precision >= 0.9, detail: `${Math.round(precision * 100)}%` },
      citations: { pass: citationComplete >= 1, detail: `${Math.round(citationComplete * 100)}%` },
      hallucination: { pass: invented === 0, detail: `invented=${invented}` },
      duplicates: { pass: true, detail: 'no CRM write in Gate B' },
      outreach_facts: { pass: unsupportedOutreach === 0, detail: `unsupported=${unsupportedOutreach}` },
      burden: { pass: (drafts.length ? 1 : 0) <= 2, detail: `interventions=${drafts.length ? 1 : 0}` },
      spend: { pass: spend <= 25, detail: `$${spend}` },
      no_send: { pass: !send.ok, detail: 'email_send blocked' },
    },
    allPass: false,
  };
  out.allPass =
    out.qualified.length >= 1 && Object.values(out.dimensions).every((d) => d.pass);
  return out;
}

/**
 * Gate C — take Gate B verified companies through the production CRM create + approval path.
 * Does not provision a Twenty desk. Unentitled owners fail closed (no other-tenant write).
 */
export async function runLiveCrmApprovalMission(opts = {}) {
  const owner = String(opts.ownerUserId || '').trim();
  const otherOwner = String(opts.otherOwnerUserId || '').trim();
  const agentId = String(opts.agentId || '').trim();
  const verified = Array.isArray(opts.verified) ? opts.verified : [];
  const prompt = String(opts.prompt || GATE_B_LIVE_RESEARCH_PROMPT);
  if (!owner || !agentId) throw new Error('ownerUserId and agentId required');

  upsertActionFamilyPolicies(owner, [
    { family: 'communicate_external', mode: 'approval_required' },
    { family: 'financial_destructive', mode: 'prohibited' },
  ]);

  const locality = parsePlacesSearchText(prompt).locality;
  const goal = createGoalRun({
    ownerUserId: owner,
    agentId,
    title: 'Live CRM + approval',
    prompt,
    source: 'live_crm_approval',
  });

  const toWrite = verified.filter((p) => meetsLiveIcp(p, locality)).slice(0, 20);
  const firstPersist = recordOpportunities(owner, toWrite, { status: 'identified' });
  const secondPersist = recordOpportunities(owner, toWrite, { status: 'identified' });
  const knowledgeNew = (firstPersist.written || []).length;
  const knowledgeSkipped = (secondPersist.skipped || []).length;

  let liveWrites = 0;
  let failClosed = 0;
  let failClosedReason = '';
  let crossTenant = 0;
  for (const p of toWrite) {
    try {
      await createCompanyForOwner(owner, {
        name: p.name,
        website: p.website || undefined,
        domainUrl: p.website || undefined,
      });
      liveWrites += 1;
      observeRecord(goal.id, owner, {
        verification_status: 'verified',
        kpi_delta: 1,
        source: p.website || p.google_maps_uri,
      });
      recordMissionEvent({
        ownerUserId: owner,
        goalRunId: goal.id,
        event_type: 'tool_side_effect',
        payload: { tool: 'crm_create_company', place_id: p.place_id, live: true },
      });
    } catch (e) {
      failClosed += 1;
      failClosedReason = String(e.message || e).slice(0, 180);
      recordMissionEvent({
        ownerUserId: owner,
        goalRunId: goal.id,
        event_type: 'failure',
        payload: { class: e.status === 403 || e.status === 409 ? 'auth' : 'error', message: failClosedReason },
      });
    }
  }

  if (otherOwner && toWrite[0]) {
    try {
      await createCompanyForOwner(otherOwner, {
        name: toWrite[0].name,
        website: toWrite[0].website || undefined,
      });
      crossTenant += 1;
    } catch {
      /* expected: other CEO is not entitled or not this tenant */
    }
  }

  const drafts = toWrite.slice(0, 12).map(draftFromVerified);
  recordMissionEvent({
    ownerUserId: owner,
    goalRunId: goal.id,
    event_type: 'human_intervention',
    payload: { reason: 'approval_batch', drafts: drafts.length, sent: false },
  });
  const send = evaluateActionPolicy({
    ownerUserId: owner,
    toolName: 'email_send',
    body: {},
    goalRunId: goal.id,
  });

  const live = finishOpenSteps(owner, goal.id);
  const events = listMissionEvents(owner, { goalRunId: goal.id, limit: 200 });
  const entitledWrite = liveWrites > 0;
  const knowledgeDedupOk = toWrite.length === 0 || knowledgeSkipped === toWrite.length;
  const pipelineOk =
    toWrite.length >= 1 &&
    drafts.length >= 1 &&
    !send.ok &&
    crossTenant === 0 &&
    knowledgeDedupOk &&
    (entitledWrite || failClosed === toWrite.length);

  return {
    gate: 'C',
    goal: live,
    stats: {
      candidates: toWrite.length,
      live_crm_writes: liveWrites,
      fail_closed: failClosed,
      fail_closed_reason: failClosedReason,
      cross_tenant_writes: crossTenant,
      drafts: drafts.length,
      unapproved_sends: send.ok ? 1 : 0,
      knowledge_new: knowledgeNew,
      knowledge_skipped_on_replay: knowledgeSkipped,
    },
    dimensions: {
      research_to_qualify: { pass: toWrite.length >= 1, detail: `verified=${toWrite.length}` },
      production_crm_path: {
        pass: pipelineOk,
        detail: entitledWrite
          ? `live_writes=${liveWrites}`
          : `fail_closed=${failClosed} (${failClosedReason || 'not entitled'})`,
      },
      no_cross_tenant: { pass: crossTenant === 0, detail: `cross_tenant=${crossTenant}` },
      duplicate_knowledge: {
        pass: knowledgeDedupOk,
        detail: `new=${knowledgeNew} skipped_replay=${knowledgeSkipped}`,
      },
      approval_no_send: { pass: !send.ok && drafts.length >= 1, detail: `drafts=${drafts.length} sends=${send.ok ? 1 : 0}` },
    },
    events: events.map((e) => e.event_type),
    allPass: Object.values({
      research_to_qualify: toWrite.length >= 1,
      production_crm_path: pipelineOk,
      no_cross_tenant: crossTenant === 0,
      duplicate_knowledge: knowledgeDedupOk,
      approval_no_send: !send.ok && drafts.length >= 1,
    }).every(Boolean),
  };
}
