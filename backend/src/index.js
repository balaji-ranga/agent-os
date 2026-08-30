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
import agentGoalRunsRoutes from './routes/agent-goal-runs.js';
import agentActionsRoutes from './routes/agent-actions.js';
import companyReviewsRoutes from './routes/company-reviews.js';
import companyExecutionsRoutes from './routes/company-executions.js';
import companyCapabilitiesRoutes from './routes/company-capabilities.js';
import mediaRoutes from './routes/media.js';
import mediaArtifactsRoutes from './routes/media-artifacts.js';
import avatarsRoutes from './routes/avatars.js';
import vrScenesRoutes from './routes/vr-scenes.js';
import vrRoomsRoutes from './routes/vr-rooms.js';
import publicVrRoutes from './routes/public-vr.js';
import publicVoiceRoutes from './routes/public-voice.js';
import voiceSessionRoutes from './routes/voice-session.js';
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
import settingsIpWhitelistRoutes from './routes/settings-ip-whitelists.js';
import settingsExternalTokensRoutes from './routes/settings-external-tokens.js';
import {
  browserWorkerCeoRoutes,
  browserWorkerV1Routes,
} from './routes/browser-worker.js';
import { openConnectorConsoleProxy } from './services/openconnector-console-proxy.js';
import opensearchConsoleRoutes from './routes/opensearch-console.js';
import adminPlatformDocsRoutes from './routes/admin-platform-docs.js';
import adminToolOnboardingRoutes from './routes/admin-tool-onboarding.js';
import adminTlsCertsRoutes from './routes/admin-tls-certs.js';
import adminPrivilegedSessionRoutes from './routes/admin-privileged-session.js';
import adminOpenclawRecoveryRoutes from './routes/admin-openclaw-recovery.js';
import adminPromotionsRoutes from './routes/admin-promotions.js';
import adminMcpUniverseRoutes from './routes/admin-mcp-universe.js';
import promotionsRoutes from './routes/promotions.js';
import mcpUniversePublicRoutes from './routes/mcp-universe-public.js';
import publicPromotionTrackingRoutes from './routes/public-promotion-tracking.js';
import {
  openSearchConsoleProxy,
  waitForOpenSearch,
  ensurePlatformHelpInOpenSearch,
} from './services/opensearch/index.js';
import { migrateSqliteDocsForAllOwners } from './services/opensearch/migrate-sqlite-docs.js';
import aiSnipperRoutes from './routes/ai-snipper.js';
import efficiencyRoutes from './routes/efficiency.js';
import orgMembersRoutes from './routes/org-members.js';
import orgPeopleRoutes from './routes/org-people.js';
import humanCommunicationsRoutes from './routes/human-communications.js';
import publicHumanCallRoutes from './routes/public-human-call.js';
import { ensureHumanCommunicationsSchema } from './services/human-communications.js';
import authRoutes from './routes/auth.js';
import adminRoutes from './routes/admin.js';
import platformNotificationsRoutes from './routes/platform-notifications.js';
import userApiKeysRoutes from './routes/user-api-keys.js';
import homeRoutes from './routes/home.js';
import { attachAuthUser, requireAuth, requireCeoOrAdmin, enforceOrgUserApiPermissions } from './middleware/auth.js';
import { ensureInternalTokenConfigured } from './middleware/internal-auth.js';
import { ensureToolsApiKeyConfigured } from './config/tools.js';
import { attachRedactedRequestUrl } from './utils/redact-secrets.js';
import { log, platformApiAccessLogger, getPlatformLogLevel, refreshPlatformLogLevel } from './utils/logger.js';
import { ensureMfaTables } from './services/auth/mfa.js';
import { ensurePrivilegedSessionTable } from './services/admin-privileged-session.js';
import { ensurePlatformFeedbackTables } from './services/platform-feedback.js';
import { ensurePasswordResetTables } from './services/password-reset.js';
import { ensurePlatformSettingsTable } from './services/platform-llm-settings.js';
import { ensureDefaultAdmin, ensureBalaCeoUser, grantStandardAgents, pruneSharedStandardAgentGrants } from './services/users.js';
import { ensureCeoDefaultMasterDataForAllCeos } from './services/ceo-default-master-data.js';
import { initDb, getDb } from './db/schema.js';
import { ensureExternalTokenTables } from './services/external-tokens.js';
import { seedDefaultAgentsIfEmpty, seedAgentDepartmentsIfMissing } from './db/seed-default-agents.js';
import { seedContentToolsMetaIfEmpty, seedKanbanToolsIfMissing, seedWorkflowToolsIfMissing, seedLearningsToolsIfMissing, seedEmailSendToolIfMissing, seedSpeechToolsIfMissing, seedVisionToolsIfMissing, seedNotifyCeoToolIfMissing, seedVoiceInviteToolIfMissing, seedOnboardingProposalToolsIfMissing, seedCeoProfileToolIfMissing, seedStatusCheckerToolIfMissing, seedThisWeekDigestToolIfMissing, seedOperationalEffectivenessToolIfMissing, seedLlmopsSummaryToolIfMissing, seedMasterDataToolsIfMissing, seedConnectorToolsIfMissing, seedVedicChartToolIfMissing, seedVideoStoryboardToolsIfMissing, updateKanbanToolPurposes, seedPlatformFeedbackToolsIfMissing, grantPlatformFeedbackTools, seedScheduledGoalToolsIfMissing, seedCrmToolsIfMissing, seedErpToolsIfMissing } from './db/seed-content-tools-meta.js';
import businessCoreRoutes from './routes/business-core.js';
import companyWorkspaceRoutes from './routes/company-workspace.js';
import uiPrefsRoutes from './routes/ui-prefs.js';
import workspaceBoardsRoutes from './routes/workspace-boards.js';
import thisWeekDigestRoutes from './routes/this-week-digest.js';
import operationalEffectivenessRoutes from './routes/operational-effectiveness.js';
import { ensureCompanyBusinessProfileSchema } from './services/company-business-profile.js';
import { seedJobApplicantToolsIfMissing } from './db/seed-job-applicant-tools.js';
import { seedIbkrTradingToolsIfMissing } from './db/seed-ibkr-trading-tools.js';
import { seedBrowserSessionToolsIfMissing, grantBrowserSessionToolsToAllAgents } from './db/seed-browser-session-tools.js';
import { seedBraveSearchToolIfMissing, grantBraveSearchToolToDefaultAgents } from './db/seed-brave-search-tool.js';
import { seedSocialResearchToolsIfMissing, grantSocialResearchToolsToAgents } from './db/seed-social-research-tools.js';
import { seedWebScrapeToolsIfMissing } from './db/seed-web-scrape-tools.js';
import { seedMarketDataToolsIfMissing } from './db/seed-market-data-tools.js';
import { writeOpenClawToolsList } from './services/content-tools-meta.js';
import {
  importGrantsFromOpenClawConfig,
  grantCooDelegationToolsIfMissing,
  grantOrchestratorGoalToolsIfMissing,
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
import { getOpenClawSessionCleanupAdminDetails } from './services/openclaw-session-cleanup.js';
import { seedWorkflowBuilderAgent } from '../scripts/seed-workflow-builder-agent.js';
import { seedPlatformHelpAgent } from '../scripts/seed-platform-help-agent.js';
import { seedOnboardingHelperAgent } from '../scripts/seed-onboarding-helper-agent.js';
import { seedSocialResearchExchangeAgents } from '../scripts/seed-social-research-agents.js';
import { healAgentWorkspacePaths } from './workspace/adapter.js';
import { healStuckKanbanForCompletedDelegations } from './services/kanban-workflow-stage.js';
import { requeueStuckStatusOnlyKanbanCards, rependInfraFailedStatusOnlyRetries } from './services/delegation-status-only-retry.js';
import { seedPlatformStandardWorkspaceTemplate } from './services/platform-agent-workspace-templates.js';
import { startOpenClawInboundMediaSync } from './services/openclaw-inbound-media-sync.js';
import { ensureAllToolServiceCredentials } from './services/tool-scoped-token.js';
import { syncMcpUniverse } from './services/mcp-universe.js';
import { dispatchDueWhatsappPromotions } from './services/promotions.js';

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

// Multipart STT must be read as raw bytes before the global JSON parser.
// Otherwise req.body is {} and /api/speech/stt returns "No audio file in multipart body".
app.use(
  '/api/speech/stt',
  express.raw({
    type: (req) => String(req.headers['content-type'] || '').toLowerCase().includes('multipart/form-data'),
    limit: '40mb',
  })
);

app.use(express.json({ limit: '100mb' }));
app.use(express.text({ type: 'text/*', limit: '10mb' }));

initDb();
ensureHumanCommunicationsSchema();
try {
  ensureExternalTokenTables();
} catch (e) {
  console.warn('[startup] external token tables:', e.message || e);
}
ensureInternalTokenConfigured();
ensureToolsApiKeyConfigured();
ensureMfaTables();
ensurePrivilegedSessionTable();
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
try {
  const credentialCount = ensureAllToolServiceCredentials();
  console.log(`[startup] ensured ${credentialCount} owner/agent tool credential binding(s)`);
} catch (e) {
  console.warn('[startup] tool credential provisioning:', e.message || e);
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
seedVoiceInviteToolIfMissing();
seedOnboardingProposalToolsIfMissing();
seedCeoProfileToolIfMissing();
seedStatusCheckerToolIfMissing();
seedThisWeekDigestToolIfMissing();
seedOperationalEffectivenessToolIfMissing();
seedLlmopsSummaryToolIfMissing();
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
seedVideoStoryboardToolsIfMissing();
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
seedSocialResearchToolsIfMissing();
seedWebScrapeToolsIfMissing();
try {
  const socialGranted = grantSocialResearchToolsToAgents();
  if (socialGranted) {
    console.log('[startup] granted social research tools (%s grant(s))', socialGranted);
    syncAllowlistsFile();
  }
} catch (e) {
  console.warn('[startup] social research tool grants:', e.message);
}
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
  const orchestratorGranted = grantOrchestratorGoalToolsIfMissing();
  if (orchestratorGranted) console.log(`[startup] granted ${orchestratorGranted} orchestrator goal tool(s)`);
} catch (e) {
  console.warn('[startup] orchestrator tool grants:', e.message);
}
try {
  const imported = importGrantsFromOpenClawConfig();
  const revokedWf = revokeUnauthorizedWorkflowToolGrants();
  if (revokedWf) {
    console.log(
      `[startup] revoked ${revokedWf} unauthorized role-restricted tool grant(s)`
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
  seedSocialResearchExchangeAgents()
    .then((r) => {
      if (r?.ok) {
        console.log(
          '[startup] social research Exchange listings owner=%s n=%s',
          r.owner,
          r.published?.length || 0
        );
      } else if (r?.skipped) {
        console.log('[startup] social research Exchange seed skipped: %s', r.reason);
      }
    })
    .catch((e) => console.warn('[startup] social research Exchange seed:', e.message));
} catch (e) {
  console.warn('[startup] social research Exchange seed:', e.message);
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
apiRouter.use(enforceOrgUserApiPermissions);
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
apiRouter.use('/admin/privileged-session', adminPrivilegedSessionRoutes);
apiRouter.use('/admin/openclaw-recovery', adminOpenclawRecoveryRoutes);
apiRouter.use('/admin/promotions', adminPromotionsRoutes);
apiRouter.use('/admin/mcp-universe', adminMcpUniverseRoutes);
apiRouter.use('/promotions', promotionsRoutes);
apiRouter.use('/public/mcp-universe', mcpUniversePublicRoutes);
apiRouter.use('/public/promotions', publicPromotionTrackingRoutes);
apiRouter.use('/public/human-call', publicHumanCallRoutes);
apiRouter.use('/ceo-guardrails', ceoGuardrailsRoutes);
apiRouter.use('/onboarding/helper', onboardingHelperRoutes);
apiRouter.use('/company-setup', companySetupRoutes);
apiRouter.use('/company-operate', companyOperateRoutes);
apiRouter.use('/business-core', businessCoreRoutes);
apiRouter.use('/company-workspace', companyWorkspaceRoutes);
apiRouter.use('/human-communications', humanCommunicationsRoutes);
apiRouter.use('/ui-prefs', uiPrefsRoutes);
apiRouter.use('/workspace-boards', workspaceBoardsRoutes);
apiRouter.use('/this-week-digest', thisWeekDigestRoutes);
apiRouter.use('/operational-effectiveness', operationalEffectivenessRoutes);
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
apiRouter.use('/agent-goal-runs', agentGoalRunsRoutes);
apiRouter.use('/agent-actions', agentActionsRoutes);
apiRouter.use('/company-reviews', companyReviewsRoutes);
apiRouter.use('/company-executions', companyExecutionsRoutes);
apiRouter.use('/company-capabilities', companyCapabilitiesRoutes);
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
apiRouter.use('/settings/ip-whitelists', settingsIpWhitelistRoutes);
apiRouter.use('/settings/external-tokens', settingsExternalTokensRoutes);
apiRouter.use('/integrations/browser-worker', browserWorkerCeoRoutes);
// Worker laptop client (bearer bwk_ token + IP whitelist; no CEO session cookie).
apiRouter.use('/browser-worker/v1', browserWorkerV1Routes);
apiRouter.use('/integrations/opensearch', opensearchConsoleRoutes);
apiRouter.use('/ibkr-trading', ibkrTradingRoutes);
apiRouter.use('/market-data', marketDataRoutes);
apiRouter.use('/ai-snipper', aiSnipperRoutes);
apiRouter.use('/efficiency', efficiencyRoutes);
apiRouter.use('/org-people', orgPeopleRoutes);
apiRouter.use('/org-members', orgMembersRoutes);
apiRouter.use('/media/openclaw', mediaRoutes);
apiRouter.use('/media/artifacts', mediaArtifactsRoutes);
apiRouter.use('/avatars', avatarsRoutes);
apiRouter.use('/vr-scenes', vrScenesRoutes);
apiRouter.use('/vr-rooms', vrRoomsRoutes);
apiRouter.use('/public/vr', publicVrRoutes);
apiRouter.use('/public/voice', publicVoiceRoutes);
apiRouter.use('/voice', voiceSessionRoutes);
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

const mcpUniverseCron = process.env.MCP_UNIVERSE_SYNC_CRON || '20 2 * * *';
registerPlatformCron({
  id: 'mcp_universe_sync',
  name: 'MCP Universe registry sync',
  description: 'Imports authoritative MCP Registry metadata into the canonical database and atomically rebuilds the private OpenSearch public-search alias.',
  schedule: mcpUniverseCron,
  envVar: 'MCP_UNIVERSE_SYNC_CRON',
  handler: syncMcpUniverse,
});
registerPlatformCron({
  id: 'promotion_whatsapp_dispatch',
  name: 'Promotion WhatsApp dispatcher',
  description: 'Delivers due, disclosed promotions only to explicitly opted-in CEOs with an owner-scoped paired WhatsApp channel.',
  schedule: process.env.PROMOTION_WHATSAPP_CRON || '*/5 * * * *',
  envVar: 'PROMOTION_WHATSAPP_CRON',
  handler: dispatchDueWhatsappPromotions,
});

const openClawSessionCleanupCron = process.env.OPENCLAW_SESSION_CLEANUP_CRON || '30 2 * * *';
registerPlatformCron({
  id: 'openclaw_session_cleanup',
  name: 'OpenClaw execution session cleanup',
  description:
    'Safely removes aged terminal execution sessions and their indexed transcripts. Unknown, conversational, unindexed, active, recent, cross-owner and mismatched-agent sessions are never selected. Starts in dry-run mode.',
  schedule: openClawSessionCleanupCron,
  envVar: 'OPENCLAW_SESSION_CLEANUP_CRON',
  handler: async () => {
    const { runOpenClawSessionCleanup } = await import('./services/openclaw-session-cleanup.js');
    return runOpenClawSessionCleanup();
  },
  details: getOpenClawSessionCleanupAdminDetails,
});

const kanbanOrphanCron = process.env.KANBAN_ORPHAN_WATCHER_CRON || '*/5 * * * *';
registerPlatformCron({
  id: 'kanban_orphan_watcher',
  name: 'Kanban orphan watcher',
  description:
    'Every 5 min: re-pend specialty + workflow-agent delegations stuck in processing, reinitiate orphan Kanban cards, and accurately renudge stuck workflow run steps (hard rule: 24h in_progress; soft: dead/stale agent delegation).',
  schedule: kanbanOrphanCron,
  envVar: 'KANBAN_ORPHAN_WATCHER_CRON',
  handler: async () => {
    const { runKanbanOrphanWatcherForAllCeos } = await import('./services/kanban-orphan-watcher.js');
    const out = await runKanbanOrphanWatcherForAllCeos();
    const reinitiated = (out.results || []).reduce((n, r) => {
      const wf =
        (r.workflow_orphan?.stale_workflow_processing?.recovered || 0) +
        (r.workflow_orphan?.stuck_steps?.retried || 0);
      return n + (r.orphans?.reinitiated || 0) + (r.stale_processing?.recovered || 0) + wf;
    }, 0);
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
    'CEO scheduled prompts: fires each due active goal independently in parallel (own AgentSystem session per fire). One hung goal never blocks siblings or the next minute tick. Paused/deleted goals never fire.',
  schedule: scheduledGoalsCron,
  envVar: 'SCHEDULED_GOALS_CRON',
  handler: async () => {
    const { tickScheduledGoals } = await import('./services/scheduled-goals.js');
    const out = await tickScheduledGoals();
    return out;
  },
});

const companyReviewPreparationCron = process.env.COMPANY_REVIEW_PREPARATION_CRON || '15 3 * * *';
registerPlatformCron({
  id: 'company_review_preparation',
  name: 'Company review preparation',
  description:
    'Prepares owner-scoped weekly and monthly CEO/COO review snapshots from goal, step, retry, Kanban, tool, approval, and policy evidence. Existing in-session or completed review snapshots are never overwritten.',
  schedule: companyReviewPreparationCron,
  envVar: 'COMPANY_REVIEW_PREPARATION_CRON',
  handler: async () => {
    const { prepareDueCompanyReviews } = await import('./services/company-reviews.js');
    return prepareDueCompanyReviews();
  },
});

// Explicit "off"/"0"/empty-with-disable flag: set CRM_TLS_WORKSPACE_CERT_CRON=off to disable.
// Unset uses hourly default. (Compose may inject empty string — treat blank as default.)
const crmTlsCronEnv = String(process.env.CRM_TLS_WORKSPACE_CERT_CRON ?? '').trim();
const crmTlsWorkspaceCertCron = ['off', '0', 'false', 'disabled', 'none'].includes(
  crmTlsCronEnv.toLowerCase()
)
  ? ''
  : crmTlsCronEnv || '40 * * * *';
registerPlatformCron({
  id: 'crm_tls_workspace_certs',
  name: 'CRM workspace TLS SANs',
  description:
    'Compares ACTIVE Twenty workspace hosts to the LE fullchain. If any {sub}.crm.* is missing (and DNS resolves), runs vps-ensure-crm-workspace-dns-cert (brief nginx stop for TLS-ALPN). No-op when cert already covers all hosts. Also triggered after new workspace provision (debounced). Admin → Crons pause/resume/run. CRM_TLS_WORKSPACE_CERT_CRON=off disables; CRM_TLS_WORKSPACE_CERT_AUTO=0 skips auto from provision.',
  schedule: crmTlsWorkspaceCertCron,
  envVar: 'CRM_TLS_WORKSPACE_CERT_CRON',
  handler: async () => {
    const { syncCrmWorkspaceTlsSans } = await import('./services/tls-cert-admin.js');
    const out = await syncCrmWorkspaceTlsSans({ source: 'platform_cron' });
    if (out?.started) {
      console.info('[cron] CRM workspace TLS SANs: expand job=%s missing=%s', out.job_id, (out.missing || []).join(','));
    } else if (out?.skipped && out.skipped !== 'all_sans_present') {
      console.info('[cron] CRM workspace TLS SANs: skipped=%s', out.skipped);
    }
    return out;
  },
});

// Event watchers (Admin → Crons: pause kill-switch + Run now / safety schedule)
const goalPlanNudgeCron = process.env.GOAL_PLAN_COMPLETION_NUDGE_CRON || '*/10 * * * *';
registerPlatformCron({
  id: 'goal_plan_completion_nudge',
  kind: 'event',
  eventWhen: 'on goal plan completed/failed',
  name: 'Goal plan completion chat nudge',
  description:
    'Event: when a durable goal plan reaches completed/failed, post one COO chat ladder + CEO bell (idempotent). Pause disables. Run now / schedule backfills missing coo_completion_nudge_at. Env GOAL_PLAN_COO_COMPLETION_NUDGE=0 hard-off.',
  schedule: goalPlanNudgeCron,
  envVar: 'GOAL_PLAN_COMPLETION_NUDGE_CRON',
  handler: async () => {
    const { runGoalPlanCompletionNudgeSweep } = await import('./services/platform-event-watchers.js');
    return runGoalPlanCompletionNudgeSweep();
  },
});

const workflowTerminalWatchCron = process.env.WORKFLOW_TERMINAL_WATCH_CRON || '*/5 * * * *';
registerPlatformCron({
  id: 'workflow_terminal_watch',
  kind: 'event',
  eventWhen: 'on agent-workflow run terminal',
  name: 'Workflow terminal watch',
  description:
    'Event: workflow terminal → CEO bell, optional COO wake (WORKFLOW_COO_WAKE_ON_TERMINAL), goal-plan advance. Pause suppresses notify/wake (goal advance still runs). Run now / schedule re-advances stuck steps after terminal WF.',
  schedule: workflowTerminalWatchCron,
  envVar: 'WORKFLOW_TERMINAL_WATCH_CRON',
  handler: async () => {
    const { runWorkflowTerminalGoalAdvanceSweep } = await import('./services/platform-event-watchers.js');
    return runWorkflowTerminalGoalAdvanceSweep();
  },
});

const workflowTimeoutCron = process.env.WORKFLOW_TIMEOUT_WATCHDOG_CRON || '*/1 * * * *';
registerPlatformCron({
  id: 'workflow_timeout_watchdog',
  kind: 'event',
  eventWhen: 'reap timed-out in_progress workflow steps',
  name: 'Workflow timeout watchdog',
  description:
    'Safety net for node timeouts (also in-process ~30s). Pause disables reaper. Run now reaps overdue steps.',
  schedule: workflowTimeoutCron,
  envVar: 'WORKFLOW_TIMEOUT_WATCHDOG_CRON',
  handler: async () => {
    const { runWorkflowTimeoutReapOnce } = await import('./services/platform-event-watchers.js');
    return runWorkflowTimeoutReapOnce();
  },
});

const toolApiRateLimitResetCron = process.env.TOOL_API_RATE_LIMIT_RESET_CRON || '5 0 * * *';
registerPlatformCron({
  id: 'tool_api_rate_limit_reset',
  name: 'Tool API rate-limit reset',
  description:
    'Daily: audit then zero per-user tool API call actuals when the calendar day or month rolls (PLATFORM_TIMEZONE). Validator also lazy-resets on the next call. Pause disables the timer; next tool invoke still rolls over.',
  schedule: toolApiRateLimitResetCron,
  envVar: 'TOOL_API_RATE_LIMIT_RESET_CRON',
  handler: async () => {
    const { applyDueToolRateLimitResets } = await import('./services/tool-api-rate-limits.js');
    return applyDueToolRateLimitResets({ resetBy: 'cron' });
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
  const status = Number(err?.status);
  res.status(Number.isInteger(status) && status >= 400 && status < 600 ? status : 500).json({ error: err.message || 'Internal server error' });
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
  // Recover CRM workspace TLS SANs after backend recreate (in-memory debounce is lost).
  setTimeout(() => {
    import('./services/tls-cert-admin.js')
      .then(({ syncCrmWorkspaceTlsSans }) => syncCrmWorkspaceTlsSans({ source: 'backend_boot' }))
      .then((out) => {
        if (out?.started) {
          console.info(
            '[startup] CRM TLS SAN expand job=%s missing=%s',
            out.job_id,
            (out.missing || []).join(',')
          );
        } else if (out?.skipped && out.skipped !== 'all_sans_present') {
          console.info('[startup] CRM TLS SAN sync skipped=%s', out.skipped);
        }
      })
      .catch((e) => console.warn('[startup] CRM TLS SAN sync', e?.message || e));
  }, 15000).unref?.();
});
