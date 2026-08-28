#!/usr/bin/env node
/**
 * VPS E2E: prove observable ReAct and Agentic RAG behaviour with real agents.
 *
 * The test intentionally verifies actions and observations, not hidden chain-of-thought.
 * It creates two owner-scoped documents, uses isolated OpenClaw sessions, and cleans up.
 */
import { initDb, getDb } from '../src/db/schema.js';
import * as openclaw from '../src/gateway/openclaw.js';
import { ensureTenantOpenClawAgent } from '../src/services/openclaw-tenant.js';
import { registerOpenClawSessionOwner } from '../src/services/tool-owner-scope.js';
import { clearOpenClawSessionForUser } from '../src/services/agent-chat-scope.js';
import { uploadDocument, deleteDocument } from '../src/services/master-data.js';

initDb();
const db = getDb();
const stamp = `reasoning-patterns-${Date.now()}`;
const owner =
  db.prepare(`SELECT id, name FROM platform_users WHERE name = ?`).get('Balaji Ranganathan') ||
  db.prepare(`SELECT id, name FROM platform_users WHERE id = 'ceo-bala'`).get();
if (!owner) throw new Error('Test CEO not found');

const agent =
  db.prepare(`SELECT * FROM agents WHERE id = 'applicationagent'`).get() ||
  db.prepare(`SELECT * FROM agents WHERE id = 'platformhelp'`).get() ||
  db.prepare(`SELECT * FROM agents WHERE is_coo = 1 LIMIT 1`).get();
if (!agent) throw new Error('No RAG-capable agent found');

const grants = new Set(
  db.prepare(`SELECT tool_name FROM agent_tool_grants WHERE agent_id = ?`).all(agent.id).map((r) => r.tool_name)
);
if (!grants.has('master_data_rag')) throw new Error(`${agent.id} lacks master_data_rag`);

const runtime = ensureTenantOpenClawAgent(agent, owner.id);
const createdDocs = [];
const sessions = [];
let failures = 0;

function check(condition, label, evidence = '') {
  if (condition) console.log(`PASS ${label}${evidence ? ` :: ${evidence}` : ''}`);
  else {
    failures += 1;
    console.error(`FAIL ${label}${evidence ? ` :: ${evidence}` : ''}`);
  }
}

function compact(value, max = 340) {
  return String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
}

function logsAfter(id) {
  return db.prepare(
    `SELECT id, tool_name, status, request_payload, response_payload, created_at
       FROM content_tool_logs
      WHERE owner_user_id = ? AND id > ?
      ORDER BY id ASC`
  ).all(owner.id, id);
}

async function agentTurn(label, prompt) {
  const thread = `${stamp}-${label}`;
  const sessionUser = openclaw.sessionUserFor(agent.id, owner.id, thread);
  const sessionKey = openclaw.sessionKeyFor(runtime.openclawAgentId, sessionUser);
  registerOpenClawSessionOwner(sessionKey, owner.id);
  sessions.push(thread);
  const before = db.prepare(`SELECT COALESCE(MAX(id), 0) AS id FROM content_tool_logs`).get().id;
  const beforeAction = db.prepare(`SELECT COALESCE(MAX(rowid), 0) AS id FROM tool_execution_actions`).get().id;
  const result = await openclaw.chatCompletions(
    runtime.openclawAgentId,
    [{ role: 'user', content: prompt }],
    sessionUser,
    false,
    { timeoutMs: 600000, retries: 1, injectSessionHistoryInstruction: false }
  );
  const actions = db.prepare(
    `SELECT rowid, tool_name, observation_status AS status, reason_code, request_payload, response_summary
       FROM tool_execution_actions WHERE rowid > ? AND owner_user_id = ? ORDER BY rowid`
  ).all(beforeAction, owner.id);
  return { reply: String(result.content || ''), logs: logsAfter(before), actions };
}

try {
  const aster = await uploadDocument(owner.id, {
    title: `Project Aster Launch Brief ${stamp}`,
    filename: `aster-launch-${stamp}.txt`,
    mimeType: 'text/plain',
    tags: ['reasoning-pattern-test', stamp],
    contentText:
      `Project Aster launch brief ${stamp}. The approved first launch region is Singapore. ` +
      `Research ownership code is RES-42. Do not infer the support target from this brief.`,
  });
  const support = await uploadDocument(owner.id, {
    title: `Project Aster Support Standard ${stamp}`,
    filename: `aster-support-${stamp}.txt`,
    mimeType: 'text/plain',
    tags: ['reasoning-pattern-test', stamp],
    contentText:
      `Project Aster support standard ${stamp}. Severity-one incidents require acknowledgement ` +
      `within exactly 17 minutes. Do not infer the launch region from this standard.`,
  });
  createdDocs.push(aster.id, support.id);
  console.log(`TEST owner=${owner.id} agent=${agent.id} runtime=${runtime.openclawAgentId}`);

  const react = await agentTurn(
    'react',
    `Prepare a launch-readiness note for Project Aster ${stamp}. Find the approved launch region ` +
      `and the severity-one acknowledgement target from the company knowledge available to you. ` +
      `Use observations to correct or continue your search until both facts are supported. ` +
      `Return both facts and cite the source titles. Do not guess.`
  );
  console.log('\nREACT ACTION/OBSERVATION TRAIL');
  react.actions.forEach((l, i) =>
    console.log(`${i + 1}. ${l.tool_name} [${l.status}/${l.reason_code}] request=${compact(l.request_payload, 220)} observation=${compact(l.response_summary, 260)}`)
  );
  console.log(`REACT FINAL :: ${compact(react.reply, 900)}`);
  check(react.actions.length >= 2, 'ReAct performed multiple actions', `count=${react.actions.length}`);
  check(
    react.actions.some((l) => l.tool_name === 'master_data_rag' && l.status === 'success'),
    'ReAct selected or recovered to document RAG'
  );
  check(/Singapore/i.test(react.reply) && /17\s*minutes?/i.test(react.reply), 'ReAct final answer integrated both observations');
  check(/Launch Brief/i.test(react.reply) && /Support Standard/i.test(react.reply), 'ReAct cited both sources');

  const rag = await agentTurn(
    'agentic-rag',
    `Independently verify two Project Aster ${stamp} claims from the company knowledge: ` +
      `(1) launch geography and (2) severity-one response commitment. Decide which available ` +
      `data source is appropriate. Retrieve evidence for each claim independently; if a retrieval ` +
      `does not contain the needed evidence, refine and retrieve again. Synthesize only grounded ` +
      `facts with source titles. Do not ask me which document or retrieval tool to use.`
  );
  const ragCalls = rag.actions.filter((l) => l.tool_name === 'master_data_rag');
  console.log('\nAGENTIC RAG ACTION/OBSERVATION TRAIL');
  rag.actions.forEach((l, i) =>
    console.log(`${i + 1}. ${l.tool_name} [${l.status}/${l.reason_code}] request=${compact(l.request_payload, 240)} observation=${compact(l.response_summary, 280)}`)
  );
  console.log(`AGENTIC RAG FINAL :: ${compact(rag.reply, 900)}`);
  check(ragCalls.length >= 2, 'Agentic RAG repeated retrieval', `rag_calls=${ragCalls.length}`);
  check(
    new Set(ragCalls.map((l) => compact(l.request_payload, 1000))).size >= 2,
    'Agentic RAG refined/varied retrieval queries'
  );
  check(ragCalls.every((l) => l.status === 'success'), 'Agentic RAG retrieval observations succeeded');
  check(/Singapore/i.test(rag.reply) && /17\s*minutes?/i.test(rag.reply), 'Agentic RAG grounded synthesis is correct');
  check(/Launch Brief/i.test(rag.reply) && /Support Standard/i.test(rag.reply), 'Agentic RAG cites selected sources');
} finally {
  for (const id of createdDocs) {
    try { await deleteDocument(owner.id, id, { force: true }); } catch (e) { console.warn(`cleanup document ${id}: ${e.message}`); }
  }
  for (const thread of sessions) {
    clearOpenClawSessionForUser(agent.id, runtime.openclawAgentId, owner.id, thread);
  }
  console.log(`CLEANUP documents=${createdDocs.length} sessions=${sessions.length}`);
}

if (failures) {
  console.error(`FAILED ${failures} assertion(s)`);
  process.exit(1);
}
console.log('PASS ReAct + Agentic RAG agent patterns');
