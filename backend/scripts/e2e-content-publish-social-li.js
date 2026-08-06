/**
 * E2E: content-publish-social LinkedIn branch until OpenConnector fails
 * (before LinkedIn OAuth / action certified for this CEO).
 *
 *   WORKFLOW_SEED_OWNER_ID=ceo-content-api-phase01-... node scripts/e2e-content-publish-social-li.js
 *
 * LinkedIn Developer products required for a successful retest later:
 *   - Share on LinkedIn  (scope w_member_social)
 *   - Sign In with LinkedIn using OpenID Connect  (openid profile email)
 * Scopes used by Agent OS MCP LinkedIn OAuth defaults: openid profile email w_member_social
 */
import { config } from 'dotenv';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { setTimeout as sleep } from 'timers/promises';

const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: join(__dirname, '..', '.env') });
config({ path: join(__dirname, '../../deploy/.env') });

import { initDb, getDb } from '../src/db/schema.js';
import { createSession } from '../src/services/auth/session.js';
import { startAgentWorkflowRun } from '../src/services/agent-workflow-runner.js';
import * as store from '../src/services/agent-workflow-store.js';
import {
  getOpenConnectorEnvConfig,
  getOpenConnectorLinkPublic,
  getConnectorConnectionsForUser,
  listConnectorActions,
  searchConnectorApps,
} from '../src/services/openconnector.js';

initDb();

const OWNER =
  process.env.WORKFLOW_SEED_OWNER_ID ||
  process.env.CM_API_OWNER ||
  'ceo-content-api-phase01-057515';
const WORKFLOW_ID = process.env.CONTENT_PUBLISH_WORKFLOW_ID || 'content-publish-social';
const fingerprint = `LI-E2E-${Date.now().toString(36)}`;
const body = `Agent OS content-publish-social LinkedIn pre-connector e2e (${fingerprint}). Do not post if this reaches LinkedIn.`;

function summarizeStep(s) {
  return {
    node_id: s.node_id,
    type: s.node_type,
    label: s.node_label || s.label,
    status: s.status,
    error: s.error_message || null,
  };
}

async function waitRun(runId, { maxMs = 120000 } = {}) {
  const started = Date.now();
  while (Date.now() - started < maxMs) {
    const run = store.getRun(runId, OWNER);
    if (!run) throw new Error(`run ${runId} not found`);
    if (['completed', 'failed', 'cancelled', 'error'].includes(String(run.status))) {
      return run;
    }
    await sleep(1500);
  }
  return store.getRun(runId, OWNER);
}

async function probeConnectors() {
  const env = getOpenConnectorEnvConfig();
  const link = getOpenConnectorLinkPublic(OWNER);
  let connections = null;
  let linkedinApps = null;
  let linkedinActions = [];
  let actionProbeError = null;
  try {
    connections = await getConnectorConnectionsForUser(OWNER);
  } catch (e) {
    connections = { error: e.message };
  }
  try {
    linkedinApps = await searchConnectorApps(OWNER, 'linkedin');
  } catch (e) {
    linkedinApps = { error: e.message };
  }
  try {
    const listed = await listConnectorActions(OWNER, 'linkedin', 'share');
    linkedinActions = (listed?.actions || listed || []).slice(0, 12).map((a) => ({
      id: a.id,
      description: (a.description || '').slice(0, 120),
    }));
  } catch (e) {
    actionProbeError = e.message;
  }
  return {
    env: {
      url: env.url,
      mcp_url: env.mcp_url,
      public_origin: env.public_origin,
      has_admin: env.has_admin_token,
    },
    link,
    connections: {
      linked: connections?.linked,
      connection_name: connections?.connection_name,
      count: Array.isArray(connections?.connections) ? connections.connections.length : null,
      apps: (connections?.connections || []).map((c) => ({
        app_id: c.app_id,
        app_name: c.app_name,
        account_name: c.account_name,
      })),
      suggested: (connections?.suggested || []).slice(0, 8).map((s) => s.id || s.name),
      error: connections?.error,
    },
    linkedinApps,
    linkedinActions,
    actionProbeError,
    products_for_linkedin_app: [
      'Share on LinkedIn (w_member_social)',
      'Sign In with LinkedIn using OpenID Connect (openid profile email)',
    ],
  };
}

async function main() {
  const user = getDb().prepare('SELECT id, email, enabled FROM platform_users WHERE id = ?').get(OWNER);
  if (!user?.enabled) {
    console.error(JSON.stringify({ ok: false, error: 'CEO missing or disabled', OWNER }, null, 2));
    process.exit(1);
  }
  createSession(OWNER);

  const probe = await probeConnectors();
  console.info('[e2e-li] connector probe', JSON.stringify(probe, null, 2));

  const pinHint =
    probe.linkedinActions.find((a) => /share|ugc|post|create/i.test(`${a.id} ${a.description}`))
      ?.id || process.env.CONTENT_LINKEDIN_OC_ACTION_ID || 'linkedin.create_share';
  console.info('[e2e-li] suggested_action_pin', pinHint);

  console.info('[e2e-li] starting workflow', {
    WORKFLOW_ID,
    OWNER,
    platform: 'linkedin',
    fingerprint,
  });

  let run;
  try {
    run = await startAgentWorkflowRun(WORKFLOW_ID, OWNER, {
      trigger: 'manual',
      input: {
        platform: 'linkedin',
        body,
        fingerprint,
      },
      actor: { id: 'e2e-content-publish-li', name: 'LI pre-connector e2e', type: 'system' },
    });
  } catch (e) {
    console.log(
      JSON.stringify(
        {
          ok: false,
          phase: 'start_run',
          error: e.message,
          code: e.code,
          details: e.details,
          probe,
        },
        null,
        2
      )
    );
    process.exit(2);
  }

  const runId = run.id;
  console.info('[e2e-li] run started', { runId, status: run.status });
  const final = await waitRun(runId);
  const steps = (final.steps || []).map(summarizeStep);
  const connectorStep =
    steps.find((s) => s.node_id === 'connector-li') ||
    steps.find((s) => s.type === 'connector') ||
    null;
  const failed = String(final.status) === 'failed' || steps.some((s) => s.status === 'failed');

  const report = {
    ok: true,
    expected_fail_at_connector_without_linkedin: true,
    owner: OWNER,
    workflow_id: WORKFLOW_ID,
    fingerprint,
    run: {
      id: runId,
      status: final.status,
      error_message: final.error_message || final.error || null,
      progress_pct: final.progress_pct,
    },
    steps,
    connector_step: connectorStep,
    reached_connector:
      (!!connectorStep && connectorStep.status === 'failed') ||
      /OpenConnector|runtime token|connector action/i.test(String(final.error_message || '')),
    pin_action_used_in_seed: process.env.CONTENT_LINKEDIN_OC_ACTION_ID || 'linkedin.create_share',
    catalog_action_hint: pinHint,
    retest_after: [
      'Connectors → OpenConnector: connect LinkedIn (Share on LinkedIn + OpenID Connect products on the LinkedIn developer app)',
      'Scopes: openid profile email w_member_social',
      `Confirm catalog action id (search share) and set CONTENT_LINKEDIN_OC_ACTION_ID if not ${pinHint}`,
      'Re-seed or edit content-publish-social connector node actionId',
      'Re-run this script',
    ],
    probe_summary: {
      oc_linked: probe.link?.linked,
      connections: probe.connections?.apps,
      action_probe_error: probe.actionProbeError,
      linkedin_actions: probe.linkedinActions,
    },
  };

  // Exit 0 when we deliberately fail at connector (pre-config). Exit 3 if unexpected success or fail-early.
  if (failed && report.reached_connector) {
    report.verdict = 'FAIL_AT_CONNECTOR_AS_EXPECTED';
    console.log(JSON.stringify(report, null, 2));
    process.exit(0);
  }
  if (failed && !report.reached_connector) {
    report.verdict = 'FAILED_BEFORE_CONNECTOR';
    console.log(JSON.stringify(report, null, 2));
    process.exit(3);
  }
  report.verdict = 'COMPLETED_OR_NOT_FAILED — unexpected for pre-connector LI e2e';
  console.log(JSON.stringify(report, null, 2));
  process.exit(4);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});