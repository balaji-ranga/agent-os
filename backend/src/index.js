import { config } from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
// Load .env from backend folder so OPENAI_API_KEY etc. are set regardless of cwd
config({ path: join(__dirname, '..', '.env') });

import express from 'express';
import cors from 'cors';
import cron from 'node-cron';
import workspaceRoutes from './routes/workspace.js';
import agentsRoutes from './routes/agents.js';
import standupsRoutes from './routes/standups.js';
import cronRoutes from './routes/cron.js';
import openclawRoutes from './routes/openclaw.js';
import toolsRoutes from './routes/tools.js';
import broadcastRoutes from './routes/broadcast.js';
import kanbanRoutes from './routes/kanban.js';
import mediaRoutes from './routes/media.js';
import jobApplicantRoutes from './routes/job-applicant.js';
import agentWorkflowRoutes from './routes/agent-workflows.js';
import agentWorkflowHookRoutes from './routes/agent-workflow-hooks.js';
import mcpIntegrationsRoutes from './routes/mcp-integrations.js';
import customScriptsRoutes from './routes/custom-scripts.js';
import externalAgentsRoutes from './routes/external-agents.js';
import workflowA2aRoutes from './routes/workflow-a2a.js';
import agentExchangeRoutes from './routes/agent-exchange.js';
import ibkrTradingRoutes from './routes/ibkr-trading.js';
import emailInboundRoutes from './routes/email-inbound.js';
import openconnectorRoutes from './routes/openconnector.js';
import { openConnectorConsoleProxy } from './services/openconnector-console-proxy.js';
import aiSnipperRoutes from './routes/ai-snipper.js';
import authRoutes from './routes/auth.js';
import adminRoutes from './routes/admin.js';
import platformNotificationsRoutes from './routes/platform-notifications.js';
import { attachAuthUser, requireAuth, requireCeoOrAdmin } from './middleware/auth.js';
import { ensureInternalTokenConfigured } from './middleware/internal-auth.js';
import { ensureMfaTables } from './services/auth/mfa.js';
import { ensureDefaultAdmin, ensureBalaCeoUser, grantStandardAgents, pruneSharedStandardAgentGrants } from './services/users.js';
import { ensureCeoDefaultMasterDataForAllCeos } from './services/ceo-default-master-data.js';
import { initDb, getDb } from './db/schema.js';
import { seedDefaultAgentsIfEmpty, seedAgentDepartmentsIfMissing } from './db/seed-default-agents.js';
import { seedContentToolsMetaIfEmpty, seedKanbanToolsIfMissing, seedWorkflowToolsIfMissing, seedLearningsToolsIfMissing, seedEmailSendToolIfMissing, seedNotifyCeoToolIfMissing, seedMasterDataToolsIfMissing, seedConnectorToolsIfMissing, seedVedicChartToolIfMissing, updateKanbanToolPurposes } from './db/seed-content-tools-meta.js';
import { seedJobApplicantToolsIfMissing } from './db/seed-job-applicant-tools.js';
import { seedIbkrTradingToolsIfMissing } from './db/seed-ibkr-trading-tools.js';
import { writeOpenClawToolsList } from './services/content-tools-meta.js';
import {
  importGrantsFromOpenClawConfig,
  grantCooDelegationToolsIfMissing,
  syncAllowlistsFile,
  syncOpenClawJsonForAgent,
  getAgentToolGrants,
} from './services/openclaw-agent-tools.js';
import { grantLearningsSummaryToAllAgents, grantEmailSendToAllAgents, grantNotifyCeoToAllAgents, grantMasterDataToolsToAllAgents, grantKanbanToolsToAllAgents } from './services/agent-feedback.js';
import feedbackRoutes from './routes/feedback.js';
import masterDataRoutes from './routes/master-data.js';
import { runScheduledStandup, runDueStandupSchedules } from './cron/standup.js';
import { processPendingDelegationTasksForAllCeos } from './services/delegation-queue.js';
import { runPipelineTick, runPipelineTickAll } from './services/job-applicant-pipeline.js';
import { getLastIntentDebug } from './services/intent-classifier.js';
import { initAgentWorkflowScheduler } from './services/agent-workflow-scheduler.js';
import { syncWorkflowScheduleRegistry } from './services/agent-workflow-store.js';
import { resumeStuckWorkflowRuns, startWorkflowTimeoutWatchdog } from './services/agent-workflow-runner.js';
import { seedWorkflowBuilderAgent } from '../scripts/seed-workflow-builder-agent.js';
import { seedPlatformHelpAgent } from '../scripts/seed-platform-help-agent.js';
import { healAgentWorkspacePaths } from './workspace/adapter.js';
import { healStuckKanbanForCompletedDelegations } from './services/kanban-workflow-stage.js';

const app = express();
const PORT = Number(process.env.PORT) || 3001;

app.use(cors({ origin: true }));
app.use(attachAuthUser);

// Admin-gated OpenConnector console + public OAuth callbacks under /openconnector/*
// Raw body so OC console POSTs are not forced through express.json().
app.use(
  '/openconnector',
  express.raw({ type: () => true, limit: '10mb' }),
  openConnectorConsoleProxy()
);

app.use(express.json({ limit: '2mb' }));
app.use(express.text({ type: 'text/*' }));

initDb();
ensureInternalTokenConfigured();
ensureMfaTables();
seedDefaultAgentsIfEmpty();
try {
  const heal = healAgentWorkspacePaths(getDb());
  if (heal.healed) console.log(`[startup] healed ${heal.healed}/${heal.scanned} agent workspace path(s)`);
} catch (e) {
  console.warn('[startup] workspace path heal:', e.message);
}
try {
  const kanbanHeal = healStuckKanbanForCompletedDelegations();
  if (kanbanHeal.healed) {
    console.log(`[startup] healed ${kanbanHeal.healed} stuck Kanban card(s) linked to finished delegations`);
  }
} catch (e) {
  console.warn('[startup] kanban stuck-card heal:', e.message);
}
try {
  const n = seedAgentDepartmentsIfMissing();
  if (n) console.log(`[startup] backfilled department on ${n} agent(s)`);
} catch (_) {}
ensureDefaultAdmin();
ensureBalaCeoUser();
try {
  const ceos = getDb().prepare(`SELECT id FROM platform_users WHERE role = 'ceo'`).all();
  for (const { id } of ceos) grantStandardAgents(id);
  try {
    const pruned = pruneSharedStandardAgentGrants();
    if (pruned.revoked) {
      console.log(
        `[startup] pruned ${pruned.revoked} non-default standard agent grant(s); lean defaults=[${pruned.leanDefaults.join(', ')}]`
      );
    }
  } catch (e) {
    console.warn('[startup] prune shared agent grants:', e.message);
  }
  const md = await ensureCeoDefaultMasterDataForAllCeos(
    ceos.map((c) => c.id),
    { refresh: true }
  );
  if (
    md.deptCreated ||
    md.deptSeeded ||
    md.guidesCreated ||
    md.guidesUpdated ||
    md.helpCreated ||
    md.helpUpdated
  ) {
    console.log(
      `[startup] CEO default master data: departments created=${md.deptCreated} seeded=${md.deptSeeded}, ` +
        `guides created=${md.guidesCreated} updated=${md.guidesUpdated}` +
        (md.guidesSkipped ? ` (readme missing=${md.guidesSkipped})` : '') +
        `, platform-help created=${md.helpCreated || 0} updated=${md.helpUpdated || 0}`
    );
  }
} catch (e) {
  console.warn('[startup] CEO default master data:', e.message);
}
seedContentToolsMetaIfEmpty();
seedKanbanToolsIfMissing();
seedWorkflowToolsIfMissing();
seedLearningsToolsIfMissing();
seedEmailSendToolIfMissing();
seedNotifyCeoToolIfMissing();
seedMasterDataToolsIfMissing();
seedVedicChartToolIfMissing();
seedConnectorToolsIfMissing();
updateKanbanToolPurposes();
seedJobApplicantToolsIfMissing();
seedIbkrTradingToolsIfMissing();
try {
  const granted = grantLearningsSummaryToAllAgents();
  if (granted) console.log(`[startup] granted learnings_summary to ${granted} agent(s)`);
} catch (e) {
  console.warn('[startup] learnings_summary grants:', e.message);
}
try {
  const emailGranted = grantEmailSendToAllAgents();
  if (emailGranted) console.log(`[startup] granted email_send to ${emailGranted} agent(s)`);
  if (emailGranted) syncAllowlistsFile();
} catch (e) {
  console.warn('[startup] email_send grants:', e.message);
}
try {
  const notifyGranted = grantNotifyCeoToAllAgents();
  if (notifyGranted) console.log(`[startup] granted notify_ceo to ${notifyGranted} agent(s)`);
  if (notifyGranted) syncAllowlistsFile();
} catch (e) {
  console.warn('[startup] notify_ceo grants:', e.message);
}
try {
  const kanbanGranted = grantKanbanToolsToAllAgents();
  if (kanbanGranted) console.log(`[startup] granted kanban tools to ${kanbanGranted} grant(s)`);
  if (kanbanGranted) syncAllowlistsFile();
} catch (e) {
  console.warn('[startup] kanban tool grants:', e.message);
}
try {
  const mdGranted = grantMasterDataToolsToAllAgents();
  if (mdGranted) console.log(`[startup] granted master_data tools to ${mdGranted} grant(s)`);
  if (mdGranted) syncAllowlistsFile();
} catch (e) {
  console.warn('[startup] master_data tool grants:', e.message);
}
writeOpenClawToolsList();
try {
  const cooGranted = grantCooDelegationToolsIfMissing();
  if (cooGranted) console.log(`[startup] granted ${cooGranted} COO delegation tool(s)`);
} catch (e) {
  console.warn('[startup] COO delegation tool grants:', e.message);
}
try {
  const imported = importGrantsFromOpenClawConfig();
  syncAllowlistsFile();
  // Persist DB grants into openclaw.json per-agent tools.allow (volume-safe across deploys).
  const agents = getDb().prepare('SELECT * FROM agents').all();
  let synced = 0;
  for (const agent of agents) {
    if (!getAgentToolGrants(agent.id).length) continue;
    syncOpenClawJsonForAgent(agent);
    synced += 1;
  }
  if (synced) console.log(`[startup] synced openclaw.json tools.allow for ${synced} agent(s)`);
  if (imported) console.log(`[startup] imported ${imported} agent tool grant(s) from openclaw.json`);
} catch (e) {
  console.warn('[startup] agent tool grants sync:', e.message);
}
try {
  seedWorkflowBuilderAgent();
} catch (e) {
  console.warn('[startup] workflow builder agent seed:', e.message);
}
try {
  seedPlatformHelpAgent();
} catch (e) {
  console.warn('[startup] platform help agent seed:', e.message);
}
import('./services/org-context.js')
  .then(async ({ syncOrgContextForCeo }) => {
    const ceos = getDb()
      .prepare(`SELECT id FROM platform_users WHERE role = 'ceo' AND enabled = 1`)
      .all();
    return Promise.all(ceos.map(({ id }) => syncOrgContextForCeo(id)));
  })
  .then((counts) => {
    const total = (counts || []).reduce((n, c) => n + (c || 0), 0);
    if (total) console.log(`[startup] synced org context to ${total} workspace(s)`);
  })
  .catch((e) => console.warn('[startup] org context sync:', e?.message || e));
import('./services/openclaw-tenant.js')
  .then(({ ensureAllTenantOpenClawAgentsForAllCeos }) => {
    const ensured = ensureAllTenantOpenClawAgentsForAllCeos();
    if (ensured) console.log(`[startup] ensured ${ensured} tenant OpenClaw agent(s)`);
  })
  .catch((e) => console.warn('[startup] tenant OpenClaw agents:', e?.message || e));
try {
  resumeStuckWorkflowRuns();
  startWorkflowTimeoutWatchdog();
} catch (e) {
  console.warn('[startup] workflow run resume:', e.message);
}

const healthHandler = (req, res) => {
  res.json({ status: 'ok', service: 'agent-os-backend', timestamp: new Date().toISOString() });
};
app.get('/health', healthHandler);

// Single /api router so all /api/* routes are registered in one place
const apiRouter = express.Router();
apiRouter.get('/health', healthHandler);
apiRouter.get('/debug/intent-last', requireAuth, requireCeoOrAdmin, (req, res) => {
  try {
    const debug = getLastIntentDebug();
    res.json(debug != null ? debug : { error: 'No intent classification run yet' });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});
apiRouter.use('/auth', authRoutes);
apiRouter.use('/admin', adminRoutes);
apiRouter.use('/platform-notifications', platformNotificationsRoutes);
apiRouter.use('/feedback', feedbackRoutes);
apiRouter.use('/master-data', masterDataRoutes);
apiRouter.use('/workspace', workspaceRoutes);
apiRouter.use('/agents', agentsRoutes);
apiRouter.use('/standups', standupsRoutes);
apiRouter.use('/cron', cronRoutes);
apiRouter.use('/openclaw', openclawRoutes);
apiRouter.use('/tools', toolsRoutes);
apiRouter.use('/broadcast', broadcastRoutes);
apiRouter.use('/kanban', kanbanRoutes);
apiRouter.use('/job-applicant', jobApplicantRoutes);
apiRouter.use('/agent-workflows/hooks', agentWorkflowHookRoutes);
apiRouter.use('/agent-workflows', agentWorkflowRoutes);
apiRouter.use('/integrations/mcp', mcpIntegrationsRoutes);
apiRouter.use('/integrations/custom-scripts', customScriptsRoutes);
apiRouter.use('/integrations/external-agents', externalAgentsRoutes);
apiRouter.use('/agent-exchange', agentExchangeRoutes);
apiRouter.use('/a2a', workflowA2aRoutes);
apiRouter.use('/integrations/email-inbound', emailInboundRoutes);
apiRouter.use('/integrations/openconnector', openconnectorRoutes);
apiRouter.use('/ibkr-trading', ibkrTradingRoutes);
apiRouter.use('/ai-snipper', aiSnipperRoutes);
apiRouter.use('/media/openclaw', mediaRoutes);
app.use('/api', apiRouter);

// Also mount at root for VITE_API_URL without /api (e.g. http://127.0.0.1:3001)
app.use('/workspace', workspaceRoutes);
app.use('/agents', agentsRoutes);
app.use('/standups', standupsRoutes);
app.use('/cron', cronRoutes);
app.use('/openclaw', openclawRoutes);
app.use('/tools', toolsRoutes);
app.use('/broadcast', broadcastRoutes);
app.use('/kanban', kanbanRoutes);
app.use('/job-applicant', jobApplicantRoutes);
app.use('/agent-workflows/hooks', agentWorkflowHookRoutes);
app.use('/agent-workflows', agentWorkflowRoutes);
app.use('/integrations/email-inbound', emailInboundRoutes);
app.use('/media/openclaw', mediaRoutes);

const standupScheduleCron = process.env.STANDUP_SCHEDULE_CRON || '* * * * *';
if (cron.validate(standupScheduleCron)) {
  cron.schedule(standupScheduleCron, async () => {
    try {
      const { count, results } = await runDueStandupSchedules();
      if (count > 0) {
        console.log(
          '[cron] Scheduled standup(s) ran:',
          results.map((r) => r.standupId || r.error).join(', ')
        );
      }
    } catch (e) {
      console.error('[cron] Standup schedule tick failed:', e.message);
    }
  });
  console.log(`Standup schedule cron: ${standupScheduleCron} (daily at each standup's scheduled_at time)`);
} else {
  console.warn('STANDUP_SCHEDULE_CRON invalid; no per-standup schedule runner.');
}

const legacyStandupCron = process.env.STANDUP_CRON_SCHEDULE || '';
if (legacyStandupCron && cron.validate(legacyStandupCron)) {
  cron.schedule(legacyStandupCron, async () => {
    try {
      const { standup, error } = await runScheduledStandup();
      if (error) console.error('[cron] Legacy standup run error:', error);
      else console.log('[cron] Legacy standup completed, id:', standup?.id);
    } catch (e) {
      console.error('[cron] Legacy standup failed:', e.message);
    }
  });
  console.log(`Legacy standup auto-collect cron: ${legacyStandupCron} (set STANDUP_CRON_SCHEDULE= to disable)`);
}

const delegationCronSchedule = process.env.DELEGATION_CRON_SCHEDULE || '* * * * *';
if (cron.validate(delegationCronSchedule)) {
  cron.schedule(delegationCronSchedule, async () => {
    try {
      await processPendingDelegationTasksForAllCeos();
    } catch (e) {
      console.error('[cron] Delegation process error:', e.message);
    }
  });
  console.log('Delegation cron scheduled (COO→agents):', delegationCronSchedule);
}

const jobPipelineCron = process.env.JOB_PIPELINE_CRON_SCHEDULE || '0 * * * *';
if (cron.validate(jobPipelineCron)) {
  cron.schedule(jobPipelineCron, async () => {
    try {
      const result = await runPipelineTickAll();
      if (result.ran) console.log('[cron] Job pipeline tick:', JSON.stringify(result.results?.length ?? 0, 'profiles'));
    } catch (e) {
      console.error('[cron] Job pipeline tick error:', e.message);
    }
  });
  console.log('Job Applicant pipeline cron scheduled:', jobPipelineCron);
}

syncWorkflowScheduleRegistry();
initAgentWorkflowScheduler();

app.use((err, req, res, next) => {
  res.status(500).json({ error: err.message || 'Internal server error' });
});

app.listen(PORT, () => {
  console.log(`Agent OS backend listening on http://127.0.0.1:${PORT} (pid ${process.pid})`);
});
