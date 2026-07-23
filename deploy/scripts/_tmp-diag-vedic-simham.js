#!/usr/bin/env node
/**
 * Diagnose vedic "simham" broken reply: logs, session, model, soul, content_tool_logs
 */
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const mode = process.argv[2] || 'all';

function sh(cmd) {
  try {
    return execSync(cmd, { encoding: 'utf8', maxBuffer: 20 * 1024 * 1024 });
  } catch (e) {
    return (e.stdout || '') + (e.stderr || '') + `\n[exit ${e.status}]`;
  }
}

function mask(s) {
  if (!s) return s;
  return String(s).replace(/(sk-[a-zA-Z0-9_-]{8})[a-zA-Z0-9_-]+/g, '$1…');
}

function section(title) {
  console.log('\n' + '='.repeat(72));
  console.log(title);
  console.log('='.repeat(72));
}

function openclawConfig() {
  section('3. openclaw.json model + providers');
  const cfgPath = '/root/.openclaw/openclaw.json';
  const c = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
  console.log('defaults.model =', JSON.stringify(c.agents?.defaults?.model, null, 2));
  const list = c.agents?.list || [];
  const matches = list.filter((a) => /vedic|t-ceo-bala/i.test(String(a.id || '')));
  console.log('matching agents:', matches.length);
  for (const a of matches) {
    console.log(JSON.stringify({ id: a.id, model: a.model, workspace: a.workspace }, null, 2));
  }
  const providers = c.models?.providers || {};
  console.log('provider keys:', Object.keys(providers).join(', '));
  for (const [k, p] of Object.entries(providers)) {
    const models = (p.models || []).slice(0, 8).map((m) =>
      typeof m === 'string' ? m : { id: m.id, api: m.api }
    );
    console.log(
      JSON.stringify(
        { provider: k, baseUrl: p.baseUrl || null, api: p.api || null, models },
        null,
        2
      )
    );
  }
}

function soulAgents() {
  section('5. SOUL/AGENTS/TOOLS for vedic (ceo-bala)');
  const roots = [
    '/root/.openclaw/tenants/ceo-bala/workspace-vedic-astrology',
    '/root/.openclaw/agents/t-ceo-bala--vedic-astrology',
    '/opt/agent-os/openclaw-workspace-templates/vedic-astrology',
  ];
  for (const root of roots) {
    console.log('\n--- root:', root, 'exists=', fs.existsSync(root));
    if (!fs.existsSync(root)) continue;
    for (const f of ['SOUL.md', 'AGENTS.md', 'TOOLS.md']) {
      const p = path.join(root, f);
      if (!fs.existsSync(p)) {
        console.log(f, 'MISSING');
        continue;
      }
      const text = fs.readFileSync(p, 'utf8');
      console.log(`\n### ${f} (${text.length} bytes)`);
      const lines = text.split('\n');
      const hits = [];
      lines.forEach((line, i) => {
        if (/notify_ceo|master_data_rag|teamwork|request-handler|simham/i.test(line)) {
          hits.push(`${i + 1}: ${line}`);
        }
      });
      console.log('keyword hits:', hits.length ? hits.join('\n') : '(none)');
      // also print first 40 lines for SOUL
      if (f === 'SOUL.md') {
        console.log('--- head ---');
        console.log(lines.slice(0, 40).join('\n'));
      }
    }
  }
}

function findSessions() {
  section('2. session jsonl / agents dirs for vedic');
  const findOut = sh(
    'find /root/.openclaw -type f \\( -name "*.jsonl" -o -name "sessions.json" -o -name "*.json" \\) 2>/dev/null | grep -iE "vedic|ceo-bala" | head -80'
  );
  console.log(findOut);

  const candidates = sh(
    'find /root/.openclaw -type d -iname "*vedic*" 2>/dev/null; find /root/.openclaw -type d -iname "*ceo-bala*" 2>/dev/null | head -40'
  );
  console.log('dirs:\n' + candidates);

  // Grep teamwork / master_data_rag / notify_ceo / simham in recent jsonl
  section('2b. pollute scan: teamwork / master_data_rag / notify_ceo / simham in jsonl');
  const grepOut = sh(
    'grep -RIl -iE "teamwork|master_data_rag|notify_ceo|simham|request-handler|how is simham" /root/.openclaw --include="*.jsonl" 2>/dev/null | head -40'
  );
  console.log('files matching:\n' + (grepOut || '(none)'));

  const files = (grepOut || '')
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean);
  for (const f of files.slice(0, 15)) {
    console.log('\n--- excerpts from', f);
    const ex = sh(
      `grep -inE "teamwork|master_data_rag|notify_ceo|simham|request-handler|tool|error|gpt-4o|deepseek|ollama" ${JSON.stringify(f)} 2>/dev/null | tail -80`
    );
    console.log(mask(ex).slice(0, 8000));
  }

  // Also list newest jsonl under vedic agent
  section('2c. newest session files under vedic agent');
  const newest = sh(
    'find /root/.openclaw -type f -name "*.jsonl" 2>/dev/null | xargs ls -lt 2>/dev/null | head -30'
  );
  console.log(newest);
}

function dbChatTurns() {
  section('2d. chat_turns / content_tool_logs from agent-os.db');
  // Prefer better-sqlite3 from backend
  let Database;
  try {
    Database = require('/opt/agent-os/backend/node_modules/better-sqlite3');
  } catch {
    try {
      Database = require('/app/node_modules/better-sqlite3');
    } catch (e) {
      console.log('better-sqlite3 unavailable:', e.message);
      return;
    }
  }
  const dbPath = process.env.AGENT_OS_DB || '/data/agent-os/agent-os.db';
  // On host the volume may be elsewhere — try common paths
  const paths = [
    dbPath,
    '/var/lib/docker/volumes/agent-os_agent_os_data/_data/agent-os.db',
    '/opt/agent-os/data/agent-os.db',
  ];
  // This script may run in backend container
  let dbFile = paths.find((p) => fs.existsSync(p));
  if (!dbFile) {
    console.log('DB not found on these paths:', paths);
    console.log('listing /data:', sh('ls -la /data 2>/dev/null; ls -la /data/agent-os 2>/dev/null'));
    return;
  }
  console.log('dbFile', dbFile);
  const db = new Database(dbFile, { readonly: true });

  const tables = db
    .prepare(`SELECT name FROM sqlite_master WHERE type='table' ORDER BY 1`)
    .all()
    .map((r) => r.name);
  console.log(
    'relevant tables:',
    tables.filter((t) => /chat|turn|tool|session|content/i.test(t)).join(', ')
  );

  function tryQuery(label, sql, params = []) {
    console.log('\n---', label);
    try {
      const rows = db.prepare(sql).all(...params);
      console.log(JSON.stringify(rows, null, 2).slice(0, 20000));
    } catch (e) {
      console.log('err:', e.message);
    }
  }

  // Discover chat_turns schema
  if (tables.includes('chat_turns')) {
    tryQuery('chat_turns schema', `PRAGMA table_info(chat_turns)`);
    tryQuery(
      'recent vedic/ceo-bala chat_turns',
      `SELECT * FROM chat_turns
       WHERE lower(coalesce(agent_id,'')) LIKE '%vedic%'
          OR lower(coalesce(agent_name,'')) LIKE '%vedic%'
          OR lower(coalesce(session_key,'')) LIKE '%vedic%'
          OR lower(coalesce(ceo_id,'')) LIKE '%bala%'
       ORDER BY rowid DESC LIMIT 30`
    );
  }

  // Broader search for teamwork pollution
  for (const t of tables.filter((n) => /chat|message|turn|session/i.test(n))) {
    const cols = db.prepare(`PRAGMA table_info(${t})`).all().map((c) => c.name);
    const textCols = cols.filter((c) =>
      /content|text|body|message|prompt|response|role/i.test(c)
    );
    if (!textCols.length) continue;
    const where = textCols
      .map((c) => `lower(coalesce(${c},'')) LIKE '%teamwork%' OR lower(coalesce(${c},'')) LIKE '%simham%' OR lower(coalesce(${c},'')) LIKE '%master_data_rag%' OR lower(coalesce(${c},'')) LIKE '%request-handler%'`)
      .join(' OR ');
    tryQuery(
      `pollute scan table=${t}`,
      `SELECT * FROM ${t} WHERE ${where} ORDER BY rowid DESC LIMIT 15`
    );
  }

  section('6. content_tool_logs for vedic');
  if (tables.includes('content_tool_logs')) {
    tryQuery('content_tool_logs schema', `PRAGMA table_info(content_tool_logs)`);
    tryQuery(
      'recent content_tool_logs vedic / last 6h',
      `SELECT * FROM content_tool_logs
       WHERE lower(coalesce(agent_id,'')) LIKE '%vedic%'
          OR lower(coalesce(tool_name,'')) LIKE '%vedic%'
          OR lower(coalesce(owner_id,'')) LIKE '%bala%'
          OR lower(coalesce(ceo_id,'')) LIKE '%bala%'
       ORDER BY rowid DESC LIMIT 40`
    );
    tryQuery(
      'content_tool_logs teamwork / master_data_rag / notify_ceo recent',
      `SELECT * FROM content_tool_logs
       WHERE lower(coalesce(tool_name,'')) IN ('master_data_rag','notify_ceo')
          OR lower(coalesce(request_json,'')) LIKE '%teamwork%'
          OR lower(coalesce(args_json,'')) LIKE '%teamwork%'
          OR lower(coalesce(input,'')) LIKE '%teamwork%'
       ORDER BY rowid DESC LIMIT 30`
    );
  } else {
    console.log('no content_tool_logs table; candidates:', tables.filter((t) => /tool/i.test(t)));
    for (const t of tables.filter((t) => /tool/i.test(t))) {
      tryQuery(`schema ${t}`, `PRAGMA table_info(${t})`);
      tryQuery(`recent ${t}`, `SELECT * FROM ${t} ORDER BY rowid DESC LIMIT 20`);
    }
  }
}

function dockerLogs() {
  section('1. openclaw docker logs last 2h (vedic / tools / errors)');
  const out = sh(
    `docker logs agent-os-openclaw-1 --since 2h 2>&1 | grep -iE 'vedic|t-ceo-bala--vedic|simham|teamwork|master_data_rag|notify_ceo|request-handler|gpt-4o|deepseek|ollama|tool|400|429|fallback|openai-responses|error|Invalid' | tail -200`
  );
  console.log(mask(out).slice(0, 30000));

  section('1b. broader last 2h lines mentioning agent id');
  const out2 = sh(
    `docker logs agent-os-openclaw-1 --since 2h 2>&1 | grep -F 't-ceo-bala--vedic-astrology' | tail -100`
  );
  console.log(mask(out2).slice(0, 20000));

  section('1c. last 3h model/url/provider errors');
  const out3 = sh(
    `docker logs agent-os-openclaw-1 --since 3h 2>&1 | grep -iE 'api\\.openai|api\\.deepseek|model\\.primary|ProviderAuth|status.?40|rate.?limit|fallback|ollama' | tail -120`
  );
  console.log(mask(out3).slice(0, 20000));
}

(function main() {
  if (mode === 'config' || mode === 'all') openclawConfig();
  if (mode === 'soul' || mode === 'all') soulAgents();
  if (mode === 'sessions' || mode === 'all') findSessions();
  if (mode === 'logs' || mode === 'all') dockerLogs();
  if (mode === 'db' || mode === 'all') {
    // Prefer running DB queries inside backend container — if we're on host, docker exec
    if (fs.existsSync('/data/agent-os/agent-os.db') || fs.existsSync('/opt/agent-os/backend/node_modules/better-sqlite3')) {
      dbChatTurns();
    } else {
      section('2d/6. DB via backend container');
      // Copy this script path assumption: /tmp/_tmp-diag-vedic-simham.js
      console.log(
        sh(
          'docker cp /tmp/_tmp-diag-vedic-simham.js agent-os-backend-1:/tmp/_tmp-diag-vedic-simham.js && docker exec -w /opt/agent-os/backend agent-os-backend-1 node /tmp/_tmp-diag-vedic-simham.js db-only'
        )
      );
    }
  }
  if (mode === 'db-only') dbChatTurns();
})();
