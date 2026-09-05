import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const root = mkdtempSync(join(tmpdir(), 'flolah-pagination-'));
process.env.AGENT_OS_DATA_DIR = root;
process.env.NODE_ENV = 'test';

const source = (relative) => readFileSync(new URL(`../${relative}`, import.meta.url), 'utf8');
const contracts = [
  ['Admin Users', 'src/routes/admin.js', /listUsers\(\{ limit, offset, q:/],
  ['Knowledge RAG Documents', 'src/routes/master-data.js', /md\.listDocuments\(owner, \{ limit, offset \}\)/],
  ['Inbound Attachments', 'src/routes/inbound-attachments.js', /has_more: page\.has_more/],
  ['Platform Help Documents', 'src/routes/admin-platform-docs.js', /excludeProtected: false, limit, offset/],
  ['Human Messages', 'src/services/human-communications.js', /has_more_older: hasOlder/],
  ['Agent Chat Sessions', 'src/routes/agents.js', /sessions: \(page\.sessions \|\| \[\]\)/],
  ['Agent Voice-call Sessions', 'src/services/agent-voice-sessions.js', /has_more: off \+ sessions\.length < total/],
  ['Agent Activities', 'src/routes/agents.js', /has_more: offset \+ activities\.length < total/],
  ['Workflow Definitions', 'src/routes/agent-workflows.js', /listDefinitionsPaginated/],
  ['Human Conversations', 'src/services/human-communications.js', /has_more: off \+ conversations\.length < total/],
  ['Platform Feedback', 'src/services/platform-feedback.js', /has_more: offset \+ items\.length < total/],
  ['Promotion Campaigns', 'src/services/promotions.js', /has_more:off\+campaigns\.length<total/],
  ['Media Artifacts', 'src/services/ceo-media-artifacts.js', /has_more: off \+ artifacts\.length < total/],
  ['Notification Feed', 'src/services/platform-notifications.js', /has_more: off \+ notifications\.length < total/],
];
for (const [name, file, pattern] of contracts) assert.match(source(file), pattern, `${name} must expose a server continuation contract`);

const { initDb, getDb } = await import('../src/db/schema.js');
initDb();
const db = getDb();
const users = await import('../src/services/users.js');
for (let i = 0; i < 25; i += 1) db.prepare('INSERT INTO platform_users(id,email,password_hash,name,role,enabled) VALUES(?,?,?,?,?,1)').run(`page-user-${i}`, `page-${i}@example.test`, 'x', `Page User ${String(i).padStart(2, '0')}`, 'ceo');
const userPage = users.listUsers({ limit: 10, offset: 10, q: 'Page User' });
assert.equal(userPage.users.length, 10);
assert.equal(userPage.total, 25);
assert.equal(userPage.has_more, true);

const promotions = await import('../src/services/promotions.js');
for (let i = 0; i < 23; i += 1) promotions.saveCampaign({ name: `Campaign ${i}`, advertiser: 'Flolah', disclosure: 'Test', delivery: 'popup', audience: 'all', frequency: 'once', blocks: [{ type: 'heading', text: `Campaign ${i}` }] }, 'test');
const campaignPage = promotions.listCampaigns({ limit: 10, offset: 20 });
assert.equal(campaignPage.campaigns.length, 3);
assert.equal(campaignPage.total, 23);
assert.equal(campaignPage.has_more, false);

const comms = await import('../src/services/human-communications.js');
db.prepare('INSERT INTO platform_users(id,email,password_hash,name,role,enabled,owner_user_id) VALUES(?,?,?,?,?,1,?)').run('page-employee', 'employee@example.test', 'x', 'Employee', 'org_user', 'page-user-0');
const conversation = comms.getOrCreateDirectConversation('page-user-0', 'page-user-0', 'page-employee');
for (let i = 0; i < 205; i += 1) comms.sendHumanMessage('page-user-0', 'page-user-0', conversation.id, `Message ${i}`);
const latest = comms.listHumanMessages('page-user-0', 'page-user-0', conversation.id, { limit: 100 });
assert.equal(latest.messages.length, 100);
assert.equal(latest.messages.at(-1).body, 'Message 204');
assert.equal(latest.has_more_older, true);
const older = comms.listHumanMessages('page-user-0', 'page-user-0', conversation.id, { before: latest.messages[0].id, limit: 100 });
assert.equal(older.messages.length, 100);
assert.equal(older.has_more_older, true);

const frontendChecks = [
  ['table paging', '../../frontend/src/pages/Admin.jsx', /offset: page \* USERS_PAGE_SIZE/],
  ['document paging', '../../frontend/src/pages/MasterData.jsx', /offset: page \* DOC_PAGE_SIZE/],
  ['reverse chat scroll', '../../frontend/src/pages/HumanChat.jsx', /before, limit: 100/],
  ['chat history scroll', '../../frontend/src/pages/AgentChat.jsx', /historySentinelRef/],
  ['workflow scroll', '../../frontend/src/pages/AgentWorkflows.jsx', /definitionsSentinelRef/],
  ['feedback scroll', '../../frontend/src/pages/AdminPlatformFeedback.jsx', /sentinelRef/],
  ['campaign scroll', '../../frontend/src/pages/AdminPromotions.jsx', /sentinelRef/],
  ['notification scroll', '../../frontend/src/components/NotificationBell.jsx', /notificationSentinelRef/],
];
for (const [name, relative, pattern] of frontendChecks) assert.match(readFileSync(new URL(relative, import.meta.url), 'utf8'), pattern, `${name} UI continuation missing`);

db.close();
rmSync(root, { recursive: true, force: true });
console.log(`growth pagination contracts: PASS (${contracts.length} collections)`);
