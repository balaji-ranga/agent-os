#!/usr/bin/env node
/**
 * Smoke: CEO guardrails — save policy, sync POLICY.md, Brain prepend.
 * Cleans up test policy text afterward (restores prior).
 * Usage: node scripts/test-ceo-guardrails.js
 */
import { initDb, getDb } from '../src/db/schema.js';
import { getBalaCeoAuthId } from '../src/services/job-applicant-ceo.js';
import {
  getCeoGuardrails,
  upsertCeoGuardrails,
  prependCeoGuardrailsToSystemPrompt,
  getActiveCeoGuardrailText,
  formatCeoPolicyMd,
} from '../src/services/ceo-guardrails.js';
import { syncOrgContextForCeo, buildOrgContextForCeo } from '../src/services/org-context.js';
import { tenantWorkspacePath } from '../src/services/openclaw-tenant.js';
import { readWorkspaceFile } from '../src/workspace/adapter.js';
import { existsSync } from 'fs';

initDb();
const owner = getBalaCeoAuthId();
const prior = getCeoGuardrails(owner);

const marker = `CEO_GUARDRAILS_SMOKE_${Date.now()}`;
const policyText = `Never reveal trade secrets.\nSmoke marker: ${marker}`;

try {
  const saved = upsertCeoGuardrails(owner, { policyText, enabled: true });
  if (!saved.enabled || !saved.policy_text.includes(marker)) {
    throw new Error('upsert failed');
  }
  if (getActiveCeoGuardrailText(owner) !== policyText) {
    throw new Error('active text mismatch');
  }

  const md = formatCeoPolicyMd(owner, 'Test CEO');
  if (!md.includes(marker) || !md.includes('CEO common guardrails')) {
    throw new Error('formatCeoPolicyMd missing content');
  }

  const prepended = prependCeoGuardrailsToSystemPrompt('You are a helpful assistant.', owner);
  if (!prepended.includes('CEO common guardrails') || !prepended.includes(marker)) {
    throw new Error('Brain prepend missing policy');
  }
  const twice = prependCeoGuardrailsToSystemPrompt(prepended, owner);
  if ((twice.match(/CEO common guardrails \(prerequisite\)/g) || []).length !== 1) {
    throw new Error('prepend not idempotent');
  }

  const disabled = upsertCeoGuardrails(owner, { policyText, enabled: false });
  if (disabled.enabled) throw new Error('expected disabled');
  if (getActiveCeoGuardrailText(owner)) throw new Error('disabled should yield empty active text');
  const noPrepend = prependCeoGuardrailsToSystemPrompt('base', owner);
  if (noPrepend.includes(marker)) throw new Error('disabled policy still prepended');

  upsertCeoGuardrails(owner, { policyText, enabled: true });
  const synced = await syncOrgContextForCeo(owner);
  if (!synced) throw new Error('sync returned 0 workspaces');

  const ctx = buildOrgContextForCeo(owner);
  const cooId = ctx.coo_id || 'balserve';
  const ws = tenantWorkspacePath(owner, cooId);
  if (!existsSync(ws)) throw new Error(`workspace missing: ${ws}`);
  const policyFile = await readWorkspaceFile('policy', { workspaceRoot: ws });
  if (!(policyFile.text || '').includes(marker)) {
    throw new Error(`POLICY.md missing marker at ${ws}`);
  }
  const orgFile = await readWorkspaceFile('org', { workspaceRoot: ws });
  if (!(orgFile.text || '').includes('POLICY.md')) {
    throw new Error('ORG.md missing POLICY.md pointer');
  }

  // Table exists
  const tbl = getDb().prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='ceo_guardrails'`).get();
  if (!tbl) throw new Error('ceo_guardrails table missing');

  console.log('CEO_GUARDRAILS_OK', {
    owner,
    workspaces_synced: synced,
    policy_bytes: policyText.length,
    workspace: ws,
  });
} finally {
  // Restore prior policy (or clear smoke)
  if (prior && !prior.is_default) {
    upsertCeoGuardrails(owner, {
      policyText: prior.policy_text || '',
      enabled: prior.enabled !== false,
    });
  } else {
    upsertCeoGuardrails(owner, { policyText: '', enabled: true });
  }
  try {
    await syncOrgContextForCeo(owner);
  } catch (_) {}
}
