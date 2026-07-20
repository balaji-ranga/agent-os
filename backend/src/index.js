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
import ibkrTradingRoutes from './routes/ibkr-trading.js';
import emailInboundRoutes from './routes/email-inbound.js';
import openconnectorRoutes from './routes/openconnector.js';
import aiSnipperRoutes from './routes/ai-snipper.js';
import authRoutes from './routes/auth.js';
import adminRoutes from './routes/admin.js';
import platformNotificationsRoutes from './routes/platform-notifications.js';
import { attachAuthUser, requireAuth, requireCeoOrAdmin } from './middleware/auth.js';
import { ensureInternalTokenConfigured } from './middleware/internal-auth.js';
import { ensureMfaTables } from './services/auth/mfa.js';
import { ensureDefaultAdmin, ensureBalaCeoUser, grantStandardAgents } from './services/users.js';
import { initDb, getDb } from './db/schema.js';
import { seedDefaultAgentsIfEmpty, seedAgentDepartmentsIfMissing } from './db/seed-default-agents.js';
import { seedContentToolsMetaIfEmpty, seedKanbanToolsIfMissing, seedWorkflowToolsIfMissing, seedLearningsToolsIfMissing, updateKanbanToolPurposes } from './db/seed-content-tools-meta.js';
import { seedJobApplicantToolsIfMissing } from './db/seed-job-applicant-tools.js';
import { seedIbkrTradingToolsIfMissing } from './db/seed-ibkr-trading-tools.js';
import { writeOpenClawToolsList } from './services/content-tools-meta.js';
import { importGrantsFromOpenClawConfig, syncAllowlistsFile } from './services/openclaw-agent-tools.js';
import { grantLearningsSummaryToAllAgents } from './services/agent-feedback.js';
import feedbackRoutes from './routes/feedback.js';
import masterDataRoutes from './routes/master-data.js';
import { runScheduledStandup } from './cron/standup.js';
import { processPendingDelegationTasks } from './services/delegation-queue.js';
import { runPipelineTick, runPipelineTickAll } from './services/job-applicant-pipeline.js';
import { getLastIntentDebug } from './services/intent-classifier.js';
import { initAgentWorkflowScheduler } from './services/agent-workflow-scheduler.js';
import { syncWorkflowScheduleRegistry } from './services/agent-workflow-store.js';
import { resumeStuckWorkflowRuns, startWorkflowTimeoutWatchdog } from './services/agent-workflow-runner.js';
import { seedWorkflowBuilderAgent } from '../scripts/seed-workflow-builder-agent.js';

const app = express();
const PORT = Number(process.env.PORT) || 3001;

app.use(cors({ origin: true }));
app.use(express.json());
app.use(express.text({ type: 'text/*' }));
app.use(attachAuthUser);

initDb();
ensureInternalTokenConfigured();
ensureMfaTables();
seedDefaultAgentsIfEmpty();
try {
  const n = seedAgentDepartmentsIfMissing();
  if (n) console.log(`[startup] backfilled department on ${n} agent(s)`);
} catch (_) {}
ensureDefaultAdmin();
ensureBalaCeoUser();
try {
  const ceos = getDb().prepare(`SELECT id FROM platform_users WHERE role = 'ceo'`).all();
  for (const { id } of ceos) grantStandardAgents(id);
} catch (_) {}
seedContentToolsMetaIfEmpty();
seedKanbanToolsIfMissing();
seedWorkflowToolsIfMissing();
seedLearningsToolsIfMissing();
updateKanbanToolPurposes();
seedJobApplicantToolsIfMissing();
seedIbkrTradingToolsIfMissing();
try {
  const granted = grantLearningsSummaryToAllAgents();
  if (granted) console.log(`[startup] granted learnings_summary to ${granted} agent(s)`);
} catch (e) {
  console.warn('[startup] learnings_summary grants:', e.message);
}
writeOpenClawToolsList();
try {
  const imported = importGrantsFromOpenClawConfig();
  syncAllowlistsFile();
  // Persist DB grants into openclaw.json per-agent tools.allow (volume-safe across deploys).
  const { syncOpenClawJsonForAgent, getAgentToolGrants } = await import('./services/openclaw-agent-tools.js');
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

const standupSchedule = process.env.STANDUP_CRON_SCHEDULE || '0 9 * * *';
if (cron.validate(standupSchedule)) {
  cron.schedule(standupSchedule, async () => {
    try {
      const { standup, error } = await runScheduledStandup();
      if (error) console.error('[cron] Standup run error:', error);
      else console.log('[cron] Standup completed, id:', standup?.id);
    } catch (e) {
      console.error('[cron] Standup failed:', e.message);
    }
  });
  console.log(`Standup cron scheduled: ${standupSchedule}`);
} else {
  console.warn('STANDUP_CRON_SCHEDULE invalid or not set; no automatic standup.');
}

const delegationCronSchedule = process.env.DELEGATION_CRON_SCHEDULE || '* * * * *';
if (cron.validate(delegationCronSchedule)) {
  cron.schedule(delegationCronSchedule, async () => {
    try {
      await processPendingDelegationTasks();
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
