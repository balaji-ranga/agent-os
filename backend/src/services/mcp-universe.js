import { createHash, createHmac, randomUUID, timingSafeEqual } from 'crypto';
import dns from 'dns/promises';
import net from 'net';
import { getDb } from '../db/schema.js';
import { opensearchBulk, opensearchRequest } from './opensearch/client.js';

export const MCP_UNIVERSE_ALIAS = 'flolah-mcp-universe-public';
const REGISTRY_URL = String(process.env.MCP_UNIVERSE_REGISTRY_URL || 'https://registry.modelcontextprotocol.io/v0.1/servers').trim();
const HUMAN_TTL = 15 * 60;

export function ensureMcpUniverseTables() {
  const db = getDb();
  db.exec(`
    CREATE TABLE IF NOT EXISTS mcp_universe_sources (id TEXT PRIMARY KEY,name TEXT NOT NULL,base_url TEXT NOT NULL,enabled INTEGER NOT NULL DEFAULT 1,cursor TEXT,last_success_at TEXT,last_error TEXT,updated_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS mcp_universe_servers (id TEXT PRIMARY KEY,identity TEXT NOT NULL UNIQUE,name TEXT NOT NULL,description TEXT DEFAULT '',publisher TEXT DEFAULT '',repository_url TEXT DEFAULT '',documentation_url TEXT DEFAULT '',endpoint_url TEXT DEFAULT '',transport TEXT DEFAULT '',auth_type TEXT DEFAULT '',license TEXT DEFAULT '',version TEXT DEFAULT '',tags_json TEXT DEFAULT '[]',capabilities_json TEXT DEFAULT '{}',source_id TEXT NOT NULL,source_record_json TEXT DEFAULT '{}',status TEXT NOT NULL DEFAULT 'approved',health_status TEXT DEFAULT 'unverified',published_at TEXT,source_updated_at TEXT,last_indexed_at TEXT,last_verified_at TEXT,stale INTEGER NOT NULL DEFAULT 0,created_at TEXT NOT NULL,updated_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS mcp_universe_submissions (id TEXT PRIMARY KEY,publisher_name TEXT NOT NULL,email TEXT NOT NULL,name TEXT NOT NULL,namespace TEXT DEFAULT '',registry_identity TEXT DEFAULT '',repository_url TEXT NOT NULL,documentation_url TEXT DEFAULT '',endpoint_url TEXT DEFAULT '',transport TEXT DEFAULT '',license TEXT DEFAULT '',ownership_evidence TEXT DEFAULT '',status TEXT NOT NULL DEFAULT 'submitted',moderation_note TEXT DEFAULT '',source_ip_hash TEXT NOT NULL,created_at TEXT NOT NULL,updated_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS mcp_universe_reports (id TEXT PRIMARY KEY,server_id TEXT NOT NULL,reason TEXT NOT NULL,details TEXT DEFAULT '',source_ip_hash TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'open',created_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS mcp_universe_sync_runs (id TEXT PRIMARY KEY,source_id TEXT NOT NULL,started_at TEXT NOT NULL,finished_at TEXT,status TEXT NOT NULL,added INTEGER DEFAULT 0,updated INTEGER DEFAULT 0,stale INTEGER DEFAULT 0,error TEXT DEFAULT '',index_name TEXT DEFAULT '',result_json TEXT DEFAULT '{}');
    CREATE INDEX IF NOT EXISTS idx_mcp_universe_public ON mcp_universe_servers(status,stale,name);
    CREATE INDEX IF NOT EXISTS idx_mcp_submissions_status ON mcp_universe_submissions(status,created_at DESC);
  `);
  const now = new Date().toISOString();
  db.prepare(`INSERT OR IGNORE INTO mcp_universe_sources(id,name,base_url,enabled,updated_at) VALUES ('official','Official MCP Registry',?,1,?)`).run(REGISTRY_URL, now);
  return db;
}

function text(v, max = 1000) { return String(v || '').replace(/[<>]/g, '').trim().slice(0, max); }
function httpsUrl(v, required = false) {
  const raw = String(v || '').trim();
  if (!raw && !required) return '';
  let u; try { u = new URL(raw); } catch { throw Object.assign(new Error('A valid URL is required'), { status: 400 }); }
  if (u.protocol !== 'https:') throw Object.assign(new Error('Only HTTPS URLs are accepted'), { status: 400 });
  u.username = ''; u.password = ''; u.hash = '';
  return u.toString();
}
function ipBlocked(ip) {
  if (net.isIPv4(ip)) {
    const n = ip.split('.').map(Number);
    return n[0] === 10 || n[0] === 127 || n[0] === 0 || n[0] >= 224 || (n[0] === 169 && n[1] === 254) || (n[0] === 172 && n[1] >= 16 && n[1] <= 31) || (n[0] === 192 && n[1] === 168) || (n[0] === 100 && n[1] >= 64 && n[1] <= 127);
  }
  if (net.isIPv6(ip)) return ip === '::1' || ip === '::' || /^f[cd]/i.test(ip) || /^fe[89ab]/i.test(ip);
  return true;
}
export async function assertSafePublicUrl(raw) {
  const normalized = httpsUrl(raw, true);
  const u = new URL(normalized);
  const addresses = await dns.lookup(u.hostname, { all: true, verbatim: true });
  if (!addresses.length || addresses.some((a) => ipBlocked(a.address))) throw Object.assign(new Error('URL resolves to a blocked network'), { status: 400 });
  return normalized;
}

function normalizeRegistryRecord(item) {
  const server = item?.server || item || {};
  const name = text(server.name || server.title || server.id, 240);
  if (!name) return null;
  const repo = server.repository?.url || server.repositoryUrl || server.repository_url || '';
  const remotes = Array.isArray(server.remotes) ? server.remotes : [];
  const packages = Array.isArray(server.packages) ? server.packages : [];
  const endpoint = remotes[0]?.url || server.endpoint || '';
  const identity = text(server.id || server.name || `${repo}:${endpoint}`, 500);
  return {
    id: createHash('sha256').update(`official:${identity}`).digest('hex').slice(0, 32), identity,
    name, description: text(server.description, 4000), publisher: text(server.publisher?.name || server.publisher || name.split('/')[0], 240),
    repository_url: /^https:\/\//i.test(repo) ? repo : '', documentation_url: /^https:\/\//i.test(server.websiteUrl || server.documentationUrl || '') ? (server.websiteUrl || server.documentationUrl) : '',
    endpoint_url: /^https:\/\//i.test(endpoint) ? endpoint : '', transport: text(remotes[0]?.type || packages[0]?.transport?.type || server.transport, 80),
    auth_type: text(remotes[0]?.headers?.length ? 'header' : server.authType, 80), license: text(server.license || packages[0]?.license, 120), version: text(server.version || item?.version, 120),
    tags: Array.isArray(server.tags) ? server.tags.map((v) => text(v, 80)).filter(Boolean).slice(0, 30) : [], capabilities: server.capabilities && typeof server.capabilities === 'object' ? server.capabilities : {},
    published_at: server.publishedAt || null, source_updated_at: server.updatedAt || item?.updatedAt || null, source_record: item,
  };
}

async function rebuildIndex(rows, runId) {
  const index = `flolah-mcp-universe-${Date.now()}`;
  await opensearchRequest('PUT', `/${index}`, { settings: { number_of_shards: 1, number_of_replicas: 0 }, mappings: { properties: { id:{type:'keyword'}, identity:{type:'keyword'}, name:{type:'text',fields:{keyword:{type:'keyword'}}}, description:{type:'text'}, publisher:{type:'text',fields:{keyword:{type:'keyword'}}}, tags:{type:'keyword'}, transport:{type:'keyword'}, auth_type:{type:'keyword'}, license:{type:'keyword'}, health_status:{type:'keyword'}, source_updated_at:{type:'date'} } } }, { timeoutMs: 60000 });
  if (rows.length) {
    const ndjson = rows.flatMap((r) => [JSON.stringify({ index: { _index: index, _id: r.id } }), JSON.stringify(publicServer(r))]).join('\n');
    await opensearchBulk(ndjson, { timeoutMs: 120000 });
  }
  const aliases = await opensearchRequest('GET', `/_alias/${MCP_UNIVERSE_ALIAS}`, null, { allowStatuses: [404] });
  const actions = aliasRemovalActions(aliases);
  actions.push({ add: { index, alias: MCP_UNIVERSE_ALIAS } });
  await opensearchRequest('POST', '/_aliases', { actions }, { timeoutMs: 60000 });
  return index;
}

export function aliasRemovalActions(response) {
  return Object.entries(response || {})
    .filter(([, value]) => value?.aliases?.[MCP_UNIVERSE_ALIAS])
    .map(([name]) => ({ remove: { index: name, alias: MCP_UNIVERSE_ALIAS } }));
}

export async function syncMcpUniverse() {
  const db = ensureMcpUniverseTables(); const runId = randomUUID(); const started = new Date().toISOString();
  db.prepare(`INSERT INTO mcp_universe_sync_runs(id,source_id,started_at,status) VALUES (?,'official',?,'running')`).run(runId, started);
  let added = 0, updated = 0; const seen = new Set();
  try {
    let cursor = ''; let pages = 0;
    do {
      const url = new URL(REGISTRY_URL); if (cursor) url.searchParams.set('cursor', cursor); url.searchParams.set('limit', String(Math.min(Number(process.env.MCP_UNIVERSE_PAGE_SIZE) || 100, 100)));
      const response = await fetch(url, { headers: { Accept: 'application/json', 'User-Agent': 'Flolah-MCP-Universe/1.0' }, signal: AbortSignal.timeout(15000) });
      if (!response.ok) throw new Error(`Official registry HTTP ${response.status}`);
      const payload = await response.json(); const items = payload.servers || payload.data || [];
      const upsert = db.prepare(`INSERT INTO mcp_universe_servers(id,identity,name,description,publisher,repository_url,documentation_url,endpoint_url,transport,auth_type,license,version,tags_json,capabilities_json,source_id,source_record_json,status,health_status,published_at,source_updated_at,last_indexed_at,stale,created_at,updated_at) VALUES (@id,@identity,@name,@description,@publisher,@repository_url,@documentation_url,@endpoint_url,@transport,@auth_type,@license,@version,@tags_json,@capabilities_json,'official',@source_record_json,'approved','unverified',@published_at,@source_updated_at,@now,0,@now,@now) ON CONFLICT(identity) DO UPDATE SET name=excluded.name,description=excluded.description,publisher=excluded.publisher,repository_url=excluded.repository_url,documentation_url=excluded.documentation_url,endpoint_url=excluded.endpoint_url,transport=excluded.transport,auth_type=excluded.auth_type,license=excluded.license,version=excluded.version,tags_json=excluded.tags_json,capabilities_json=excluded.capabilities_json,source_record_json=excluded.source_record_json,source_updated_at=excluded.source_updated_at,last_indexed_at=excluded.last_indexed_at,stale=0,updated_at=excluded.updated_at`);
      for (const item of items) { const n = normalizeRegistryRecord(item); if (!n) continue; seen.add(n.identity); const exists = db.prepare('SELECT 1 FROM mcp_universe_servers WHERE identity=?').get(n.identity); upsert.run({ ...n, tags_json: JSON.stringify(n.tags), capabilities_json: JSON.stringify(n.capabilities), source_record_json: JSON.stringify(n.source_record).slice(0, 100000), now: new Date().toISOString() }); exists ? updated++ : added++; }
      cursor = text(payload.metadata?.nextCursor || payload.nextCursor || '', 1000); pages++;
      if (pages >= Math.max(1, Math.min(Number(process.env.MCP_UNIVERSE_MAX_PAGES) || 50, 200))) cursor = '';
    } while (cursor);
    const all = db.prepare(`SELECT * FROM mcp_universe_servers WHERE source_id='official'`).all(); let stale = 0;
    for (const row of all) if (!seen.has(row.identity)) { db.prepare('UPDATE mcp_universe_servers SET stale=1,updated_at=? WHERE id=?').run(new Date().toISOString(), row.id); stale++; }
    const publicRows = db.prepare(`SELECT * FROM mcp_universe_servers WHERE status='approved' AND stale=0`).all();
    let indexName = ''; try { indexName = await rebuildIndex(publicRows, runId); } catch (e) { console.warn('[mcp-universe] OpenSearch rebuild unavailable, SQLite remains canonical:', e.message); }
    const finished = new Date().toISOString(); db.prepare(`UPDATE mcp_universe_sync_runs SET finished_at=?,status='success',added=?,updated=?,stale=?,index_name=?,result_json=? WHERE id=?`).run(finished, added, updated, stale, indexName, JSON.stringify({ total: publicRows.length }), runId);
    db.prepare(`UPDATE mcp_universe_sources SET cursor='',last_success_at=?,last_error='',updated_at=? WHERE id='official'`).run(finished, finished);
    return { ok: true, run_id: runId, added, updated, stale, total: publicRows.length, index_name: indexName || null };
  } catch (e) { const finished = new Date().toISOString(); db.prepare(`UPDATE mcp_universe_sync_runs SET finished_at=?,status='failed',error=? WHERE id=?`).run(finished, text(e.message, 2000), runId); db.prepare(`UPDATE mcp_universe_sources SET last_error=?,updated_at=? WHERE id='official'`).run(text(e.message, 2000), finished); throw e; }
}

export function publicServer(row) { return { id: row.id, name: row.name, description: row.description, publisher: row.publisher, repository_url: row.repository_url, documentation_url: row.documentation_url, endpoint_url: row.endpoint_url, transport: row.transport, auth_type: row.auth_type, license: row.license, version: row.version, tags: JSON.parse(row.tags_json || '[]'), capabilities: JSON.parse(row.capabilities_json || '{}'), source: row.source_id, provenance: 'registry', health_status: row.health_status, published_at: row.published_at, updated_at: row.source_updated_at || row.updated_at, last_indexed_at: row.last_indexed_at, last_verified_at: row.last_verified_at } }
export function searchServers({ q='', transport='', page=1, limit=20 }={}) { const db=ensureMcpUniverseTables(); const query=text(q,120); const lim=Math.max(1,Math.min(Number(limit)||20,50)); const pg=Math.max(1,Math.min(Number(page)||1,200)); const clauses=[`status='approved'`,`stale=0`], args=[]; if(query){clauses.push('(name LIKE ? OR description LIKE ? OR publisher LIKE ?)'); const like=`%${query}%`; args.push(like,like,like);} if(transport){clauses.push('transport=?');args.push(text(transport,80));} const where=clauses.join(' AND '); const total=db.prepare(`SELECT COUNT(*) n FROM mcp_universe_servers WHERE ${where}`).get(...args)?.n||0; const rows=db.prepare(`SELECT * FROM mcp_universe_servers WHERE ${where} ORDER BY name LIMIT ? OFFSET ?`).all(...args,lim,(pg-1)*lim); return {items:rows.map(publicServer),page:pg,limit:lim,total:Math.min(total,10000)}; }
export function getPublicServer(id){ const r=ensureMcpUniverseTables().prepare(`SELECT * FROM mcp_universe_servers WHERE id=? AND status='approved' AND stale=0`).get(id); return r?publicServer(r):null; }

function humanSecret(){ return String(process.env.MCP_UNIVERSE_HUMAN_SESSION_SECRET || process.env.SESSION_SECRET || '').trim(); }
export function issueHumanSession(ipHash){ const secret=humanSecret(); if(!secret) throw new Error('Human-session signing secret is not configured'); const payload=Buffer.from(JSON.stringify({i:ipHash,e:Math.floor(Date.now()/1000)+HUMAN_TTL})).toString('base64url'); return `${payload}.${createHmac('sha256',secret).update(payload).digest('base64url')}`; }
export function verifyHumanSession(token,ipHash){ try{const [p,s]=String(token||'').split('.');const expected=createHmac('sha256',humanSecret()).update(p).digest();const got=Buffer.from(s,'base64url');if(got.length!==expected.length||!timingSafeEqual(got,expected))return false;const data=JSON.parse(Buffer.from(p,'base64url'));return data.i===ipHash&&data.e>Math.floor(Date.now()/1000);}catch{return false;} }
export function ipFingerprint(ip){ return createHash('sha256').update(`${humanSecret()}:${String(ip||'')}`).digest('hex').slice(0,24); }
export async function verifyTurnstile(token,ip){ const secret=String(process.env.TURNSTILE_SECRET_KEY||'').trim(); if(process.env.NODE_ENV==='test'&&process.env.TURNSTILE_TEST_BYPASS==='1'&&token==='test-pass')return true; if(!secret||!token)return false; const form=new URLSearchParams({secret,response:String(token),remoteip:String(ip||'')}); const r=await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify',{method:'POST',body:form,signal:AbortSignal.timeout(8000)}); const data=await r.json(); const allowed=String(process.env.TURNSTILE_ALLOWED_HOSTNAMES||'flolah.cloud,www.flolah.cloud').split(',').map(v=>v.trim()).filter(Boolean); return data.success===true&&(!data.hostname||allowed.includes(data.hostname))&&(!data.action||data.action==='mcp-universe'); }

export function createSubmission(body,ipHash){ const db=ensureMcpUniverseTables(); const id=randomUUID(),now=new Date().toISOString(); const row={id,publisher_name:text(body.publisher_name,200),email:text(body.email,320).toLowerCase(),name:text(body.name,240),namespace:text(body.namespace,240),registry_identity:text(body.registry_identity,500),repository_url:httpsUrl(body.repository_url,true),documentation_url:httpsUrl(body.documentation_url),endpoint_url:httpsUrl(body.endpoint_url),transport:text(body.transport,80),license:text(body.license,120),ownership_evidence:text(body.ownership_evidence,2000),source_ip_hash:ipHash,created_at:now,updated_at:now}; if(!row.publisher_name||!/^\S+@\S+\.\S+$/.test(row.email)||!row.name)throw Object.assign(new Error('Publisher, valid email, name and repository are required'),{status:400}); db.prepare(`INSERT INTO mcp_universe_submissions(id,publisher_name,email,name,namespace,registry_identity,repository_url,documentation_url,endpoint_url,transport,license,ownership_evidence,status,source_ip_hash,created_at,updated_at) VALUES (@id,@publisher_name,@email,@name,@namespace,@registry_identity,@repository_url,@documentation_url,@endpoint_url,@transport,@license,@ownership_evidence,'submitted',@source_ip_hash,@created_at,@updated_at)`).run(row); return {id,status:'submitted'}; }
export function listSubmissions(){return ensureMcpUniverseTables().prepare('SELECT * FROM mcp_universe_submissions ORDER BY created_at DESC LIMIT 500').all();}
export function moderateSubmission(id,status,note=''){if(!['approved','rejected'].includes(status))throw Object.assign(new Error('Status must be approved or rejected'),{status:400});const db=ensureMcpUniverseTables(),now=new Date().toISOString(),sub=db.prepare('SELECT * FROM mcp_universe_submissions WHERE id=?').get(id);if(!sub)return false;db.prepare('UPDATE mcp_universe_submissions SET status=?,moderation_note=?,updated_at=? WHERE id=?').run(status,text(note,2000),now,id);if(status==='approved'){const identity=sub.registry_identity||`submission:${sub.namespace||sub.publisher_name}/${sub.name}`;const serverId=createHash('sha256').update(identity).digest('hex').slice(0,32);db.prepare(`INSERT INTO mcp_universe_servers(id,identity,name,description,publisher,repository_url,documentation_url,endpoint_url,transport,license,source_id,source_record_json,status,health_status,last_indexed_at,stale,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,'submission',?,'approved','unverified',?,0,?,?) ON CONFLICT(identity) DO UPDATE SET name=excluded.name,publisher=excluded.publisher,repository_url=excluded.repository_url,documentation_url=excluded.documentation_url,endpoint_url=excluded.endpoint_url,transport=excluded.transport,license=excluded.license,status='approved',stale=0,updated_at=excluded.updated_at`).run(serverId,identity,sub.name,'',sub.publisher_name,sub.repository_url,sub.documentation_url,sub.endpoint_url,sub.transport,sub.license,JSON.stringify({submission_id:id}),now,now,now);}return true;}
export function listSyncRuns(){return ensureMcpUniverseTables().prepare('SELECT * FROM mcp_universe_sync_runs ORDER BY started_at DESC LIMIT 100').all();}
