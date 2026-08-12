/**
 * UI-path E2E for video_content Phase 1 (S0–S3) as Balaji Ranganathan.
 * Uses the same HTTP APIs the Agent Chat UI calls (login session + POST /agents/:id/chat).
 *
 * Usage (VPS):
 *   docker compose exec -T -w /opt/agent-os/backend -e BASE_URL=http://127.0.0.1:3001 \
 *     backend node scripts/e2e-video-content-ui-phase1.mjs
 *
 * Local against VPS:
 *   BASE_URL=https://login.flolah.cloud node backend/scripts/e2e-video-content-ui-phase1.mjs
 *   (needs ADMIN or internal mint — prefer run inside backend container)
 */
import { config } from 'dotenv';
import { dirname, join, resolve as pathResolve } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

function isDirectRun() {
  try {
    const entry = process.argv[1] ? pathResolve(process.argv[1]) : '';
    return entry && entry === fileURLToPath(import.meta.url);
  } catch {
    return false;
  }
}

const BOUNCE_RE =
  /story\s*teller|storyteller|talk to (the )?story|ask (the )?story|use (the )?story agent|switch to .{0,40}story|open .{0,40}story agent|chat with .{0,40}(story|scene|prompt)/i;

const USER_MSG =
  process.env.VIDEO_E2E_MESSAGE ||
  'Hi — looking for a Thenaliraman story for kids. It should look real cinematic and not animated. About 60 seconds. Please orchestrate the storyboard end to end.';

async function main() {
  config({ path: join(__dirname, '..', '.env') });
  config({ path: join(__dirname, '../../deploy/.env') });

  const { initDb, getDb } = await import('../src/db/schema.js');
  const { createSession } = await import('../src/services/auth/session.js');
  initDb();
  const db = getDb();

  const ceo =
    db
      .prepare(
        `SELECT id, email, name FROM platform_users WHERE id = 'ceo-bala' OR (
           role = 'ceo' AND enabled = 1 AND (
             lower(name) LIKE '%balaji%ranganathan%' OR lower(email) LIKE '%balaji.x.ranga%'
           )
         ) ORDER BY CASE WHEN id = 'ceo-bala' THEN 0 ELSE 1 END LIMIT 1`
      )
      .get() || null;
  if (!ceo) throw new Error('Balaji CEO not found');

  const orch = db
    .prepare(
      `SELECT a.id, a.name FROM agents a
       INNER JOIN user_agents ua ON ua.agent_id = a.id
       WHERE ua.user_id = ? AND COALESCE(ua.enabled,1)=1
         AND (a.id = 'video-orch-ceobala' OR lower(a.name) = 'content orchestrator')
       LIMIT 1`
    )
    .get(ceo.id);
  if (!orch) throw new Error('Content Orchestrator not granted to Balaji — run seed-video-content-workflows.js first');

  const wfBefore = db
    .prepare(
      `SELECT id, status, updated_at, definition_id FROM agent_workflow_runs
       WHERE owner_user_id = ? AND definition_id LIKE 'video-reasoning%'
       ORDER BY updated_at DESC LIMIT 5`
    )
    .all(ceo.id);

  const { token } = createSession(ceo.id, { userAgent: 'e2e-video-content-ui-phase1' });
  const base = String(process.env.BASE_URL || 'http://127.0.0.1:3001').replace(/\/$/, '');
  const chatUrl = `${base}/api/agents/${encodeURIComponent(orch.id)}/chat`;

  console.log(
    JSON.stringify(
      {
        step: 's0_s1_entitlements',
        ceo: { id: ceo.id, name: ceo.name, email: ceo.email },
        orchestrator: orch,
        workflow_published: !!db
          .prepare(
            `SELECT id FROM agent_workflow_definitions WHERE owner_user_id = ? AND id LIKE 'video-reasoning%' AND status = 'published'`
          )
          .get(ceo.id),
        prior_runs: wfBefore.length,
      },
      null,
      2
    )
  );

  const ac = new AbortController();
  const timeoutMs = Number(process.env.VIDEO_E2E_TIMEOUT_MS || 300000);
  const t = setTimeout(() => ac.abort(), timeoutMs);

  console.log('[e2e] POST chat (UI path)', chatUrl);
  let chatJson;
  try {
    const res = await fetch(chatUrl, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        message: USER_MSG,
        user_id: ceo.id,
        tz: 'Asia/Singapore',
      }),
      signal: ac.signal,
    });
    const text = await res.text();
    try {
      chatJson = JSON.parse(text);
    } catch {
      throw new Error(`chat non-JSON ${res.status}: ${text.slice(0, 500)}`);
    }
    if (!res.ok) {
      throw new Error(`chat HTTP ${res.status}: ${JSON.stringify(chatJson).slice(0, 800)}`);
    }
  } finally {
    clearTimeout(t);
  }

  const reply = String(chatJson?.reply || chatJson?.message || chatJson?.content || '');
  const bounced = BOUNCE_RE.test(reply);
  const mentionsWorkflow =
    /storyboard|run video|workflow|scene\s*\d|veo|cinematic|thenali/i.test(reply) ||
    !!chatJson?.workflow_triggered;

  // Allow agent async: poll workflow runs + storyboards briefly
  const deadline = Date.now() + Number(process.env.VIDEO_E2E_POLL_MS || 120000);
  let latestRun = null;
  let storyboardRows = [];
  while (Date.now() < deadline) {
    latestRun =
      db
        .prepare(
          `SELECT id, definition_id, status, updated_at FROM agent_workflow_runs
           WHERE owner_user_id = ? AND definition_id LIKE 'video-reasoning%'
           ORDER BY updated_at DESC LIMIT 1`
        )
        .get(ceo.id) || null;
    try {
      const table = db
        .prepare(
          `SELECT id FROM master_data_tables WHERE owner_user_id = ? AND name = 'video_storyboards' LIMIT 1`
        )
        .get(ceo.id);
      if (table) {
        storyboardRows = db
          .prepare(
            `SELECT id, row_json, created_at FROM master_data_rows
             WHERE owner_user_id = ? AND table_id = ? ORDER BY id DESC LIMIT 5`
          )
          .all(ceo.id, table.id)
          .map((r) => {
            let data = {};
            try {
              data = JSON.parse(r.row_json || '{}');
            } catch {
              /* ignore */
            }
            return { id: r.id, created_at: r.created_at, ...data };
          });
      }
    } catch {
      /* ignore */
    }
    const newRun =
      latestRun &&
      (!wfBefore[0] ||
        String(latestRun.updated_at) > String(wfBefore[0].updated_at) ||
        String(latestRun.id) !== String(wfBefore[0].id));
    if (newRun && /completed|success|running|waiting|pending|failed/i.test(String(latestRun.status || ''))) {
      break;
    }
    if (chatJson?.workflow_triggered || /MEDIA:|storyboard_id|scene 1/i.test(reply)) break;
    await new Promise((r) => setTimeout(r, 5000));
  }

  const out = {
    ok: !bounced,
    phase: 'S0-S3 UI path',
    ceo: ceo.id,
    agent: orch.id,
    bounced,
    reply_preview: reply.slice(0, 1200),
    workflow_triggered_field: chatJson?.workflow_triggered || null,
    tool_calls: chatJson?.tool_calls || chatJson?.tools || null,
    latest_workflow_run: latestRun,
    storyboard_rows: storyboardRows.slice(0, 3),
    checks: {
      s0_s1_orchestrator_granted: true,
      s1_no_bounce_to_storyteller: !bounced,
      s1_reply_on_topic: mentionsWorkflow || reply.length > 40,
      s2_s3_workflow_or_export_signal:
        !!latestRun ||
        storyboardRows.length > 0 ||
        /MEDIA:|\.pdf|\.html|\.svg|storyboard/i.test(reply) ||
        !!chatJson?.workflow_triggered,
    },
  };

  const failed = Object.entries(out.checks).filter(([, v]) => !v);
  console.log(JSON.stringify(out, null, 2));
  if (failed.length || bounced) {
    console.error('[e2e] FAIL', failed.map(([k]) => k));
    process.exit(1);
  }
  console.log('[e2e] PASS Phase 1 UI path for Balaji — Orchestrator did not bounce; pipeline engaged');
}

if (isDirectRun()) {
  main().catch((e) => {
    console.error('[e2e] error', e?.message || e);
    process.exit(1);
  });
}
