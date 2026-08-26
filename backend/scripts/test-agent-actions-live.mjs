import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dataDir = mkdtempSync(join(tmpdir(), 'flolah-agent-actions-'));
process.env.AGENT_OS_DATA_DIR = dataDir;

try {
  const { initDb, getDb } = await import('../src/db/schema.js');
  const { liveSnapshot } = await import('../src/routes/agent-actions.js');
  initDb();
  const db = getDb();
  db.prepare("INSERT INTO platform_users (id,email,password_hash,name,role) VALUES ('live-owner','live@example.test','test','Live CEO','ceo')").run();
  db.prepare("UPDATE platform_users SET ceo_db_mode='shared' WHERE id='live-owner'").run();
  for (let i = 0; i < 14; i += 1) {
    db.prepare('INSERT INTO agents (id,name,role) VALUES (?,?,?)').run(`idle-${i}`, `Idle ${i}`, 'Researcher');
    db.prepare('INSERT INTO user_agents (user_id,agent_id,enabled) VALUES (?,?,1)').run('live-owner', `idle-${i}`);
  }
  db.prepare("INSERT INTO agents (id,name,role) VALUES ('market-watcher','Market Watcher','Market Analyst')").run();
  db.prepare("INSERT INTO user_agents (user_id,agent_id,enabled) VALUES ('live-owner','market-watcher',1)").run();
  db.prepare(`INSERT INTO agent_goal_runs (id,owner_user_id,agent_id,title,prompt,status,current_step_index,created_at,updated_at)
    VALUES ('goal-live','live-owner','market-watcher','Track MAG7','Track the portfolio','running',0,datetime('now'),datetime('now'))`).run();
  db.prepare(`INSERT INTO agent_goal_steps (id,goal_run_id,step_index,step_type,label,status,spec_json)
    VALUES ('goal-live-step','goal-live',0,'agent_tool','Fetch market data','running','{"tool_name":"market_quote"}')`).run();
  db.prepare(`INSERT INTO content_tool_logs (tool_name,source,request_payload,response_payload,status,owner_user_id,created_at)
    VALUES ('market_quote','goal-runtime','{"goal_run_id":"goal-live"}','{"ok":true}','ok','live-owner',datetime('now'))`).run();

  const live = liveSnapshot('live-owner');
  const market = live.agents.find((agent) => agent.id === 'market-watcher');
  assert.equal(market.state, 'working');
  assert.ok(market.current.some((item) => item.id === 'goal-live'));
  assert.ok(market.tools.some((tool) => tool.name === 'market_quote'));
  assert.ok(live.events.some((event) => event.kind === 'tool' && event.agent_id === 'market-watcher'));
  assert.ok(live.connectors.some((connector) => connector.name === 'market_quote' && connector.agent_id === 'market-watcher'));
  assert.equal(live.summary.working, 1);
  console.log('agent actions live telemetry tests passed');
} finally {
  try { const { getDb } = await import('../src/db/schema.js'); getDb().close(); } catch {}
  rmSync(dataDir, { recursive: true, force: true });
}
