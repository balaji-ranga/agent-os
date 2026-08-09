import { config } from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
// Load .env from backend folder so OPENAI_API_KEY etc. are set regardless of cwd
config({ path: join(__dirname, '..', '.env') });

import express from 'express';
import cors from 'cors';
import workspaceRoutes from './routes/workspace.js';
import inboundAttachmentsRoutes from './routes/inbound-attachments.js';
import contentExplorerRoutes from './routes/content-explorer.js';
import onboardingHelperRoutes from './routes/onboarding-helper.js';
import companySetupRoutes from './routes/company-setup.js';
import companyOperateRoutes from './routes/company-operate.js';
import videoToursRoutes from './routes/video-tours.js';
import agentsRoutes from './routes/agents.js';
import standupsRoutes from './routes/standups.js';
import cronRoutes from './routes/cron.js';
import openclawRoutes from './routes/openclaw.js';
import toolsRoutes from './routes/tools.js';
import broadcastRoutes from './routes/broadcast.js';
import kanbanRoutes from './routes/kanban.js';
import scheduledGoalsRoutes from './routes/scheduled-goals.js';
import mediaRoutes from './routes/media.js';
import mediaArtifactsRoutes from './routes/media-artifacts.js';
import avatarsRoutes from './routes/avatars.js';
import vrScenesRoutes from './routes/vr-scenes.js';
import vrRoomsRoutes from './routes/vr-rooms.js';
import publicVrRoutes from './routes/public-vr.js';
import speechRoutes from './routes/speech.js';
import agentChannelsRoutes from './routes/agent-channels.js';
import jobApplicantRoutes from './routes/job-applicant.js';
import agentWorkflowRoutes from './routes/agent-workflows.js';
import agentWorkflowHookRoutes from './routes/agent-workflow-hooks.js';
import agentWorkflowDesktopRoutes from './routes/agent-workflow-desktop.js';
import mcpIntegrationsRoutes, { mcpOauthCallbackHandler } from './routes/mcp-integrations.js';
import customScriptsRoutes from './routes/custom-scripts.js';
import externalAgentsRoutes from './routes/external-agents.js';
import workflowA2aRoutes from './routes/workflow-a2a.js';
import a2aCallbackInboxRoutes from './routes/a2a-callback-inbox.js';
import agentExchangeRoutes from './routes/agent-exchange.js';
import ibkrTradingRoutes from './routes/ibkr-trading.js';
import marketDataRoutes from './routes/market-data.js';
import emailInboundRoutes from './routes/email-inbound.js';
import openconnectorRoutes from './routes/openconnector.js';
import ibkrBridgePackageRoutes from './routes/ibkr-bridge-package.js';
import {
  browserWorkerCeoRoutes,
  browserWorkerV1Routes,
} from './routes/browser-worker.js';
import { openConnectorConsoleProxy } from './services/openconnector-console-proxy.js';
import opensearchConsoleRoutes from './routes/opensearch-console.js';
import adminPlatformDocsRoutes from './routes/admin-platform-docs.js';
import adminToolOnboardingRoutes from './routes/admin-tool-onboarding.js';
import adminTlsCertsRoutes from './routes/admin-tls-certs.js';
import {
  openSearchConsoleProxy,
  waitForOpenSearch,
  ensurePlatformHelpInOpenSearch,
} from './services/opensearch/index.js';
import { migrateSqliteDocsForAllOwners } from './services/opensearch/migrate-sqlite-docs.js';
import aiSnipperRoutes from './routes/ai-snipper.js';
import efficiencyRoutes from './routes/efficiency.js';
import orgMembersRoutes from './routes/org-members.js';
import authRoutes from './routes/auth.js';
import adminRoutes from './routes/admin.js';
import platformNotificationsRoutes from './routes/platform-notifications.js';
import userApiKeysRoutes from './routes/user-api-keys.js';
import homeRoutes from './routes/home.js';
import { attachAuthUser, requireAuth, requireCeoOrAdmin } from './middleware/auth.js';
import { ensureInternalTokenConfigured } from './middleware/internal-auth.js';
import { ensureToolsApiKeyConfigured } from './config/tools.js';
import { attachRedactedRequestUrl } from './utils/redact-secrets.js';
import { log, platformApiAccessLogger, getPlatformLogLevel, refreshPlatformLogLevel } from './utils/logger.js';
import { ensureMfaTables } from './services/auth/mfa.js';
import { ensurePlatformFeedbackTables } from './services/platform-feedback.js';
import { ensurePasswordResetTables } from './services/password-reset.js';
import { ensurePlatformSettingsTable } from './services/platform-llm-settings.js';
import { ensureDefaultAdmin, ensureBalaCeoUser, grantStandardAgents, pruneSharedStandardAgentGrants } from './services/users.js';
import { ensureCeoDefaultMasterDataForAllCeos } from './services/ceo-default-master-data.js';
import { initDb, getDb } from './db/schema.js';
import { seedDefaultAgentsIfEmpty, seedAgentDepartmentsIfMissing } from './db/seed-default-agents.js';
import { seedContentToolsMetaIfEmpty, seedKanbanToolsIfMissing, seedWorkflowToolsIfMissing, seedLearningsToolsIfMissing, seedEmailSendToolIfMissing, seedSpeechToolsIfMissing, seedVisionToolsIfMissing, seedNotifyCeoToolIfMissing, seedOnboardingProposalToolsIfMissing, seedCeoProfileToolIfMissing, seedStatusCheckerToolIfMissing, seedThisWeekDigestToolIfMissing, seedMasterDataToolsIfMissing, seedConnectorToolsIfMissing, seedVedicChartToolIfMissing, updateKanbanToolPurposes, seedPlatformFeedbackToolsIfMissing, grantPlatformFeedbackTools, seedScheduledGoalToolsIfMissing, seedCrmToolsIfMissing, seedErpToolsIfMissing } from './db/seed-content-tools-meta.js';
import businessCoreRoutes from './routes/business-core.js';
import companyWorkspaceRoutes from './routes/company-workspace.js';
import uiPrefsRoutes from './routes/ui-prefs.js';
import workspaceBoardsRoutes from './routes/workspace-boards.js';
import thisWeekDigestRoutes from './routes/this-week-digest.js';
import { ensureCompanyBusinessProfileSchema } from './services/company-business-profile.js';
import { seedJobApplicantToolsIfMissing } from './db/seed-job-applicant-tools.js';
import { seedIbkrTradingToolsIfMissing } from './db/seed-ibkr-trading-tools.js';
import { seedBrowserSessionToolsIfMissing, grantBrowserSessionToolsToAllAgents } from './db/seed-browser-session-tools.js';
import { seedBraveSearchToolIfMissing, grantBraveSearchToolToDefaultAgents } from './db/seed-brave-search-tool.js';
import { seedMarketDataToolsIfMissing } from './db/seed-market-data-tools.js';
import { writeOpenClawToolsList } from './services/content-tools-meta.js';
import {
  importGrantsFromOpenClawConfig,
  grantCooDelegationToolsIfMissing,
  syncAllowlistsFile,
  syncOpenClawJsonForAgent,
  getAgentToolGrants,
  revokeUnauthorizedWorkflowToolGrants,
} from './services/openclaw-agent-tools.js';
import { grantLearningsSummaryToAllAgents, grantEmailSendToAllAgents, grantNotifyCeoToAllAgents, grantCeoProfileToAllAgents, grantAnalyzeImageToAllAgents, grantMasterDataToolsToAllAgents, grantKanbanToolsToAllAgents } from './services/agent-feedback.js';
import feedbackRoutes from './routes/feedback.js';
import masterDataRoutes from './routes/master-data.js';
import ceoGuardrailsRoutes from './routes/ceo-guardrails.js';
import browserSessionRoutes from './routes/browser-session.js';
import { runScheduledStandup, runDueStandupSchedules } from './cron/standup.js';
import { processPendingDelegationTasksForAllCeos } from './services/delegation-queue.js';
import { runPipelineTickAll } from './services/job-applicant-pipeline.js';
import { getLastIntentDebug } from './services/intent-classifier.js';
import { initAgentWorkflowScheduler } from './services/agent-workflow-scheduler.js';
import { syncWorkflowScheduleRegistry } from './services/agent-workflow-store.js';
import { resumeStuckWorkflowRuns, startWorkflowTimeoutWatchdog } from './services/agent-workflow-runner.js';
import { registerPlatformCron } from './services/platform-cron-registry.js';
import { seedWorkflowBuilderAgent } from '../scripts/seed-workflow-builder-agent.js';
import { seedPlatformHelpAgent } from '../scripts/seed-platform-help-agent.js';
import { seedOnboardingHelperAgent } from '../scripts/seed-onboarding-helper-agent.js';
import { healAgentWorkspacePaths } from './workspace/adapter.js';
import { healStuckKanbanForCompletedDelegations } from './services/kanban-workflow-stage.js';
import { requeueStuckStatusOnlyKanbanCards, rependInfraFailedStatusOnlyRetries } from './services/delegation-status-only-retry.js';
import { seedPlatformStandardWorkspaceTemplate } from './services/platform-agent-workspace-templates.js';
import { startOpenClawInboundMediaSync } from './services/openclaw-inbound-media-sync.js';

const app = express();
const PORT = Number(process.env.PORT) || 3001;
refreshPlatformLogLevel();

app.use(cors({ origin: true }));
app.use(attachRedactedRequestUrl);
app.use(attachAuthUser);
app.use(platformApiAccessLogger);

// Admin-gated OpenConnector console + public OAuth callbacks under /openconnector/*
// Raw body so OC console POSTs are not forced through express.json().
app.use(
  '/openconnector',
  express.raw({ type: () => true, limit: '10mb' }),
  openConnectorConsoleProxy()
);

// Admin-gated OpenSearch Dashboards reverse proxy under /opensearch/*
app.use(
  '/opensearch',
  express.raw({ type: () => true, limit: '10mb' }),
  openSearchConsoleProxy()
);

app.use(express.json({ limit: '100mb' }));
app.use(express.text({ type: 'text/*', limit: '10mb' }));

initDb();
ensureInternalTokenConfigured();
ensureToolsApiKeyConfigured();
ensureMfaTables();
ensurePlatformFeedbackTables();
ensurePasswordResetTables();
ensurePlatformSettingsTable();
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
  if (kanbanHeal.reopened_status_only) {
    console.log(`[startup] reopened ${kanbanHeal.reopened_status_only} status-only completed Kanban card(s)`);
  }
} catch (e) {
  console.warn('[startup] kanban stuck-card heal:', e.message);
}
// Defer until OpenClaw is likely up after a joint backend+openclaw redeploy.
{
  const delayMs = Number(process.env.STATUS_ONLY_REQUEUE_STARTUP_DELAY_MS);
  const waitMs = Number.isFinite(delayMs) && delayMs >= 0 ? delayMs : 60000;
  setTimeout(() => {
    try {
      const retry = requeueStuckStatusOnlyKanbanCards({ limit: 40 });
      if (retry.requeued) {
        console.log(
          `[startup] requeued ${retry.requeued} status-only Kanban card(s) for agent retry (after ${waitMs}ms)`
        );
      }
      const recovered = rependInfraFailedStatusOnlyRetries({ limit: 40 });
      if (recovered.repended) {
        console.log(`[startup] re-pended ${recovered.repended} infra-failed status-only retry task(s)`);
      }
    } catch (e) {
      console.warn('[startup] status-only requeue:', e.message);
    }
  }, waitMs).unref?.();
}
try {
  const n = seedAgentDepartmentsIfMissing();
  if (n) console.log(`[startup] backfilled department on ${n} agent(s)`);
} catch (_) {}
ensureDefaultAdmin();
ensureBalaCeoUser();
try {
  seedPlatformStandardWorkspaceTemplate();
} catch (e) {
  console.warn('[startup] platform workspace templates:', e.message);
}
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
  if (md.deptCreated || md.deptSeeded) {
    console.log(
      `[startup] CEO default master data: departments created=${md.deptCreated} seeded=${md.deptSeeded}`
    );
  }
} catch (e) {
  console.warn('[startup] CEO default master data:', e.message);
}

// OpenSearch: wait, seed platform help, migrate legacy SQLite docs
try {
  const osReady = await waitForOpenSearch({ attempts: 30, delayMs: 2000 });
  if (osReady?.ok) {
    try {
      const help = await ensurePlatformHelpInOpenSearch();
      console.info(
        `[startup] platform help OpenSearch: created=${help.created} updated=${help.updated} skipped=${help.skipped}`
      );
    } catch (e) {
      console.warn('[startup] platform help OpenSearch seed:', e.message);
    }
    try {
      const ceoIds = getDb()
        .prepare(`SELECT id FROM platform_users WHERE role = 'ceo'`)
        .all()
        .map((c) => c.id);
      const mig = await migrateSqliteDocsForAllOwners(ceoIds);
      if (mig.migrated || mig.failed) {
        console.info(
          `[startup] OpenSearch SQLite doc migrate: migrated=${mig.migrated} skipped=${mig.skipped} failed=${mig.failed}`
        );
      }
    } catch (e) {
      console.warn('[startup] OpenSearch SQLite doc migrate:', e.message);
    }
  } else {
    console.warn(
      '[startup] OpenSearch not ready — document RAG unavailable until cluster is up (%s)',
      osReady?.error || osReady?.status
    );
  }
} catch (e) {
  console.warn('[startup] OpenSearch init:', e.message);
}
seedContentToolsMetaIfEmpty();
seedKanbanToolsIfMissing();
seedWorkflowToolsIfMissing();
seedLearningsToolsIfMissing();
seedEmailSendToolIfMissing();
seedSpeechToolsIfMissing();
seedVisionToolsIfMissing();
seedPlatformFeedbackToolsIfMissing();
seedNotifyCeoToolIfMissing();
seedOnboardingProposalToolsIfMissing();
seedCeoProfileToolIfMissing();
seedStatusCheckerToolIfMissing();
seedThisWeekDigestToolIfMissing();
seedScheduledGoalToolsIfMissing();
seedCrmToolsIfMissing();
seedErpToolsIfMissing();
seedMasterDataToolsIfMissing();
try {
  ensureCompanyBusinessProfileSchema();
} catch (e) {
  console.warn('[startup] company business profile schema:', e.message);
}

seedVedicChartToolIfMissing();
seedConnectorToolsIfMissing();
updateKanbanToolPurposes();
seedJobApplicantToolsIfMissing();
seedIbkrTradingToolsIfMissing();
seedMarketDataToolsIfMissing();
seedBrowserSessionToolsIfMissing();
try {
  const browserGranted = grantBrowserSessionToolsToAllAgents();
  if (browserGranted) {
    console.log(
      '[startup] granted browse_* tools to default agents only (%s grant(s); custom agents: Workspace → Tool access)',
      browserGranted
    );
  }
} catch (e) {
  console.warn('[startup] browse tool grants:', e.message);
}
seedBraveSearchToolIfMissing();
try {
  const braveGranted = grantBraveSearchToolToDefaultAgents();
  if (braveGranted) {
    console.log(
      '[startup] granted brave_web_search to default agents only (%s grant(s); custom agents: Workspace → Tool access)',
      braveGranted
    );
    syncAllowlistsFile();
  }
} catch (e) {
  console.warn('[startup] brave_web_search grants:', e.message);
}
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
  const profileGranted = grantCeoProfileToAllAgents();
  if (profileGranted) console.log(`[startup] granted ceo_profile to ${profileGranted} agent(s)`);
  if (profileGranted) syncAllowlistsFile();
} catch (e) {
  console.warn('[startup] ceo_profile grants:', e.message);
}
try {
  const visionGranted = grantAnalyzeImageToAllAgents();
  if (visionGranted) console.log(`[startup] granted analyze_image to ${visionGranted} agent(s)`);
  if (visionGranted) syncAllowlistsFile();
} catch (e) {
  console.warn('[startup] analyze_image grants:', e.message);
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
  const revokedWf = revokeUnauthorizedWorkflowToolGrants();
  if (revokedWf) {
    console.log(
      `[startup] revoked ${revokedWf} unauthorized agent_workflow_* grant(s) from non-COO/non-WorkflowBuilder agents`
    );
  }
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
try {
  seedOnboardingHelperAgent();
} catch (e) {
  console.warn('[startup] onboarding helper agent seed:', e.message);
}
try {
  // After platform-help (and COO) agents exist so enquire/submit grants stick.
  const feedbackGranted = grantPlatformFeedbackTools();
  if (feedbackGranted) {
    console.log(`[startup] granted platform_feedback tools (${feedbackGranted} grant(s))`);
    syncAllowlistsFile();
  }
} catch (e) {
  console.warn('[startup] platform_feedback tool grants:', e.message);
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
  .then(async () => {
    const { syncEnabledAgentChannelsToOpenClaw } = await import('./services/ceo-agent-channels.js');
    const ch = syncEnabledAgentChannelsToOpenClaw();
    if (ch.synced) {
      console.log(`[startup] re-applied ${ch.synced} agent channel(s) to openclaw.json`);
    }
    // OpenClaw entrypoint may rewrite config just after backend boot — re-sync once more.
    setTimeout(() => {
      try {
        const again = syncEnabledAgentChannelsToOpenClaw();
        if (again.synced) {
          console.log(`[startup] re-applied ${again.synced} agent channel(s) to openclaw.json (delayed)`);
        }
      } catch (e) {
        console.warn('[startup] delayed agent channel sync:', e?.message || e);
      }
    }, 15000);
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
apiRouter.use('/user-api-keys', userApiKeysRoutes);
apiRouter.use('/home', homeRoutes);
apiRouter.use('/feedback', feedbackRoutes);
apiRouter.use('/master-data', masterDataRoutes);
apiRouter.use('/admin/platform-documents', adminPlatformDocsRoutes);
apiRouter.use('/admin/tool-onboarding', adminToolOnboardingRoutes);
apiRouter.use('/admin/tls-certs', adminTlsCertsRoutes);
apiRouter.use('/ceo-guardrails', ceoGuardrailsRoutes);
apiRouter.use('/onboarding/helper', onboardingHelperRoutes);
apiRouter.use('/company-setup', companySetupRoutes);
apiRouter.use('/company-operate', companyOperateRoutes);
apiRouter.use('/business-core', businessCoreRoutes);
apiRouter.use('/company-workspace', companyWorkspaceRoutes);
apiRouter.use('/ui-prefs', uiPrefsRoutes);
apiRouter.use('/workspace-boards', workspaceBoardsRoutes);
apiRouter.use('/this-week-digest', thisWeekDigestRoutes);
apiRouter.use('/video-tours', videoToursRoutes);
apiRouter.use('/workspace', workspaceRoutes);
apiRouter.use('/workspace', inboundAttachmentsRoutes);
apiRouter.use('/workspace', contentExplorerRoutes);
apiRouter.use('/agents', agentsRoutes);
apiRouter.use('/standups', standupsRoutes);
apiRouter.use('/cron', cronRoutes);
apiRouter.use('/openclaw', openclawRoutes);
apiRouter.use('/tools', toolsRoutes);
apiRouter.use('/broadcast', broadcastRoutes);
apiRouter.use('/kanban', kanbanRoutes);
apiRouter.use('/scheduled-goals', scheduledGoalsRoutes);
apiRouter.use('/job-applicant', jobApplicantRoutes);
apiRouter.use('/agent-workflows/hooks', agentWorkflowHookRoutes);
apiRouter.use('/agent-workflows/desktop/v1', agentWorkflowDesktopRoutes);
apiRouter.use('/agent-workflows', agentWorkflowRoutes);
// Public MCP OAuth callback (provider redirect; no session cookie).
apiRouter.get('/integrations/mcp/oauth/callback', mcpOauthCallbackHandler);
apiRouter.use('/integrations/mcp', mcpIntegrationsRoutes);
apiRouter.use('/integrations/custom-scripts', customScriptsRoutes);
apiRouter.use('/integrations/external-agents', externalAgentsRoutes);
apiRouter.use('/agent-exchange', agentExchangeRoutes);
apiRouter.use('/a2a-callback-inbox', a2aCallbackInboxRoutes);
apiRouter.use('/a2a', workflowA2aRoutes);
apiRouter.use('/integrations/email-inbound', emailInboundRoutes);
apiRouter.use('/integrations/openconnector', openconnectorRoutes);
apiRouter.use('/integrations/ibkr-bridge', ibkrBridgePackageRoutes);
apiRouter.use('/integrations/browser-worker', browserWorkerCeoRoutes);
// Worker laptop client (bearer bwk_ token + IP whitelist; no CEO session cookie).
apiRouter.use('/browser-worker/v1', browserWorkerV1Routes);
apiRouter.use('/integrations/opensearch', opensearchConsoleRoutes);
apiRouter.use('/ibkr-trading', ibkrTradingRoutes);
apiRouter.use('/market-data', marketDataRoutes);
apiRouter.use('/ai-snipper', aiSnipperRoutes);
apiRouter.use('/efficiency', efficiencyRoutes);
apiRouter.use('/org-members', orgMembersRoutes);
apiRouter.use('/media/openclaw', mediaRoutes);
apiRouter.use('/media/artifacts', mediaArtifactsRoutes);
apiRouter.use('/avatars', avatarsRoutes);
apiRouter.use('/vr-scenes', vrScenesRoutes);
apiRouter.use('/vr-rooms', vrRoomsRoutes);
apiRouter.use('/public/vr', publicVrRoutes);
apiRouter.use('/speech', speechRoutes);
apiRouter.use('/agent-channels', agentChannelsRoutes);
apiRouter.use('/browser-session', browserSessionRoutes);
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
app.use('/agent-workflows/desktop/v1', agentWorkflowDesktopRoutes);
app.use('/agent-workflows', agentWorkflowRoutes);
app.use('/integrations/email-inbound', emailInboundRoutes);
app.use('/media/openclaw', mediaRoutes);

const standupScheduleCron = process.env.STANDUP_SCHEDULE_CRON || '* * * * *';
registerPlatformCron({
  id: 'standup_schedule',
  name: 'Standup schedule dispatcher',
  description: 'Runs each user-created standup when its scheduled_at hour:minute matches (once per day).',
  schedule: standupScheduleCron,
  envVar: 'STANDUP_SCHEDULE_CRON',
  handler: async () => {
    const { count, results } = await runDueStandupSchedules();
    if (count > 0) {
      console.log(
        '[cron] Scheduled standup(s) ran:',
        results.map((r) => r.standupId || r.error).join(', ')
      );
    }
    return { count, results };
  },
});

const legacyStandupCron = process.env.STANDUP_CRON_SCHEDULE || '';
if (legacyStandupCron) {
  registerPlatformCron({
    id: 'legacy_standup_collect',
    name: 'Legacy standup auto-collect',
    description: 'Creates a standup per enabled CEO and runs COO collection (legacy; empty env = off).',
    schedule: legacyStandupCron,
    envVar: 'STANDUP_CRON_SCHEDULE',
    handler: async () => {
      const { standup, error } = await runScheduledStandup();
      if (error) console.error('[cron] Legacy standup run error:', error);
      else console.log('[cron] Legacy standup completed, id:', standup?.id);
      return { standup_id: standup?.id || null, error: error || null };
    },
  });
}

const delegationCronSchedule = process.env.DELEGATION_CRON_SCHEDULE || '* * * * *';
registerPlatformCron({
  id: 'delegation_queue',
  name: 'Delegation queue',
  description: 'Processes pending COO → agent delegation tasks for every enabled CEO.',
  schedule: delegationCronSchedule,
  envVar: 'DELEGATION_CRON_SCHEDULE',
  handler: async () => {
    await processPendingDelegationTasksForAllCeos();
    return { ok: true };
  },
});

const jobPipelineCron = process.env.JOB_PIPELINE_CRON_SCHEDULE || '0 * * * *';
registerPlatformCron({
  id: 'job_pipeline',
  name: 'Job Applicant pipeline',
  description: 'Ticks across active job profiles and runs discovery when each profile schedule is due.',
  schedule: jobPipelineCron,
  envVar: 'JOB_PIPELINE_CRON_SCHEDULE',
  handler: async () => {
    const result = await runPipelineTickAll();
    if (result.ran) console.log('[cron] Job pipeline tick:', result.profiles_checked, 'profiles');
    return result;
  },
});

const cooStatusCron = process.env.COO_STATUS_CHECKER_CRON || '0 9 * * *';
registerPlatformCron({
  id: 'coo_status_checker',
  name: 'COO status checker',
  description:
    'Daily Kanban/A2A digest per CEO → standup chat + HTML email (email only on this batch path).',
  schedule: cooStatusCron,
  envVar: 'COO_STATUS_CHECKER_CRON',
  handler: async () => {
    const { runCooStatusCheckerForAllCeos } = await import('./services/coo-status-checker.js');
    const out = await runCooStatusCheckerForAllCeos();
    console.log('[cron] COO status checker:', out.count, 'CEO(s)');
    return out;
  },
});

const dataRetentionCron = process.env.DATA_RETENTION_CRON || '15 3 * * *';
registerPlatformCron({
  id: 'data_retention',
  name: 'Data retention purge',
  description: 'Permanently deletes aged chats, standup conversations and workflow runs per CEO retention days.',
  schedule: dataRetentionCron,
  envVar: 'DATA_RETENTION_CRON',
  handler: async () => {
    const { purgeRetentionForAllCeos } = await import('./services/data-retention.js');
    const out = purgeRetentionForAllCeos();
    console.log('[cron] Data retention purge:', out.count, 'CEO(s)');
    return out;
  },
});

const kanbanOrphanCron = process.env.KANBAN_ORPHAN_WATCHER_CRON || '*/5 * * * *';
registerPlatformCron({
  id: 'kanban_orphan_watcher',
  name: 'Kanban orphan watcher',
  description:
    'Every 5 min: re-pend specialty delegations stuck in processing, requeue status-only cards, and reinitiate orphan Kanban tasks with the assigned agent.',
  schedule: kanbanOrphanCron,
  envVar: 'KANBAN_ORPHAN_WATCHER_CRON',
  handler: async () => {
    const { runKanbanOrphanWatcherForAllCeos } = await import('./services/kanban-orphan-watcher.js');
    const out = await runKanbanOrphanWatcherForAllCeos();
    const reinitiated = (out.results || []).reduce(
      (n, r) => n + (r.orphans?.reinitiated || 0) + (r.stale_processing?.recovered || 0),
      0
    );
    if (reinitiated) {
      console.log(`[cron] Kanban orphan watcher: ${reinitiated} recovery action(s) across ${out.count} CEO(s)`);
    }
    return out;
  },
});

const workflowSchedulerCron = process.env.AGENT_WORKFLOW_SCHEDULER_CRON || '* * * * *';
registerPlatformCron({
  id: 'agent_workflow_scheduler',
  name: 'Agent workflow scheduler',
  description: 'Master tick: starts custom workflows whose own schedule_cron is due.',
  schedule: workflowSchedulerCron,
  envVar: 'AGENT_WORKFLOW_SCHEDULER_CRON',
  handler: async () => {
    const { tickScheduledWorkflows } = await import('./services/agent-workflow-scheduler.js');
    await tickScheduledWorkflows();
    return { ok: true };
  },
});

const scheduledGoalsCron = process.env.SCHEDULED_GOALS_CRON || '* * * * *';
registerPlatformCron({
  id: 'scheduled_goals',
  name: 'Scheduled goals',
  description:
    'CEO scheduled prompts: fires active goals at time_local to the target AI employee. Paused/deleted goals never fire (DB status only; survives restarts).',
  schedule: scheduledGoalsCron,
  envVar: 'SCHEDULED_GOALS_CRON',
  handler: async () => {
    const { tickScheduledGoals } = await import('./services/scheduled-goals.js');
    const out = await tickScheduledGoals();
    return out;
  },
});

// Keep registry sync/logging here; master tick is owned by platform-cron-registry (Admin pause/resume).
syncWorkflowScheduleRegistry();
initAgentWorkflowScheduler({ scheduleMaster: false });

app.use((err, req, res, next) => {
  // Never log req.body / headers — may contain API keys, passwords, auth tokens.
  log.error(
    '[api] unhandled',
    req.method,
    req.logUrl || sanitizeSafeUrl(req),
    err?.message || err
  );
  res.status(500).json({ error: err.message || 'Internal server error' });
});

function sanitizeSafeUrl(req) {
  try {
    return req.logUrl || req.path || '/';
  } catch {
    return '/';
  }
}

app.listen(PORT, () => {
  log.info(`Agent OS backend listening on http://127.0.0.1:${PORT} (pid ${process.pid}) PLATFORM_LOG_LEVEL=${getPlatformLogLevel()}`);
  // Always print listen line even when level=off so ops can confirm process is up.
  if (getPlatformLogLevel() === 'off') {
    console.log(`Agent OS backend listening on http://127.0.0.1:${PORT} (pid ${process.pid}) PLATFORM_LOG_LEVEL=off`);
  }
  try {
    startOpenClawInboundMediaSync({ intervalMs: 4000 });
  } catch (e) {
    console.warn('[startup] openclaw inbound media sync:', e?.message || e);
  }
});
