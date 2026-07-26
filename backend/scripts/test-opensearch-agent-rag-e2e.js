#!/usr/bin/env node
/**
 * VPS E2E: authenticated UI-equivalent uploads, OpenSearch index isolation,
 * and COO/Platform Help master_data_rag calls through /api/tools/invoke.
 */
import 'dotenv/config';
import { getToolsApiKey } from '../src/config/tools.js';
import * as openclaw from '../src/gateway/openclaw.js';
import {
  getDocument,
  metaIndexName,
  searchIndexName,
  searchDocuments,
} from '../src/services/opensearch/index.js';

const BASE = String(process.env.AGENT_OS_API_URL || 'http://127.0.0.1:3001').replace(/\/$/, '');
const stamp = `${Date.now().toString(36)}-${Math.random().toString(16).slice(2, 8)}`;
const password = `OsRag!${stamp}`;
const uniqueMaster = `MASTERDATA_${stamp}`;
const uniqueChat = `CHATATTACH_${stamp}`;
const created = [];
let passed = 0;
let failed = 0;

function check(condition, label, evidence = '') {
  if (condition) {
    passed += 1;
    console.log(`PASS ${label}${evidence ? `: ${evidence}` : ''}`);
  } else {
    failed += 1;
    console.error(`FAIL ${label}${evidence ? `: ${evidence}` : ''}`);
  }
}

async function api(method, path, body, token) {
  const response = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body == null ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(120000),
  });
  const data = await response.json().catch(() => ({}));
  return { status: response.status, data };
}

async function register(label) {
  const result = await api('POST', '/api/auth/register', {
    email: `os-rag-${label}-${stamp}@example.com`,
    password,
    name: `OS RAG ${label} ${stamp}`,
    db_mode: 'tenant',
    mfa_policy: 'off',
  });
  check(result.status === 201, `register CEO ${label}`, `status=${result.status}`);
  return {
    token: result.data.session?.token || result.data.token,
    userId: result.data.user?.id || result.data.session?.user?.id,
  };
}

async function invokeRag(owner, baseAgentId, query) {
  const openclawAgentId = `t-${owner}--${baseAgentId}`;
  const sessionUser = openclaw.sessionUserFor(openclawAgentId, owner);
  const sessionKey = openclaw.sessionKeyFor(openclawAgentId, sessionUser);
  const response = await fetch(`${BASE}/api/tools/invoke`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${getToolsApiKey()}`,
      'x-openclaw-agent-id': openclawAgentId,
      'x-ceo-user-id': owner,
      'x-openclaw-session-key': sessionKey,
    },
    body: JSON.stringify({
      tool_name: 'master_data_rag',
      caller_agent_id: openclawAgentId,
      query,
      top_k: 5,
      summarize: false,
    }),
    signal: AbortSignal.timeout(120000),
  });
  return { status: response.status, data: await response.json().catch(() => ({})), openclawAgentId };
}

const userA = await register('a');
const userB = await register('b');
check(Boolean(userA.token && userA.userId), 'CEO A session issued', `user=${userA.userId}`);
check(Boolean(userB.token && userB.userId), 'CEO B session issued', `user=${userB.userId}`);

const unauth = await api('GET', '/api/master-data/documents');
check(unauth.status === 401, 'documents API rejects unauthenticated caller', `status=${unauth.status}`);

// Same payload shape used by MasterData.jsx.
const masterUpload = await api(
  'POST',
  '/api/master-data/documents',
  {
    title: `VPS entitlement policy ${stamp}`,
    filename: `masterdata-${stamp}.txt`,
    mimeType: 'text/plain',
    contentBase64: Buffer.from(
      `${uniqueMaster} CEO A confidential entitlement policy. Approval window is exactly 47 days.`,
      'utf8'
    ).toString('base64'),
    tags: ['vps-e2e', 'masterdata-ui'],
  },
  userA.token
);
const masterDoc = masterUpload.data.document;
if (masterDoc?.id) created.push(masterDoc.id);
check(masterUpload.status === 201 && Boolean(masterDoc?.id), 'Master Data UI-equivalent upload', `doc=${masterDoc?.id}`);
check(masterDoc?.owner_user_id === userA.userId, 'uploaded document owner is CEO A');

const listA = await api('GET', '/api/master-data/documents', null, userA.token);
check(
  listA.status === 200 && (listA.data.documents || []).some((d) => d.id === masterDoc?.id),
  'CEO A Master Data list contains uploaded document'
);

const ragA = await api(
  'POST',
  '/api/master-data/rag',
  { query: `${uniqueMaster} approval window`, topK: 5, summarize: false },
  userA.token
);
check(
  ragA.status === 200 && JSON.stringify(ragA.data).includes(uniqueMaster),
  'CEO A Master Data RAG returns unique content',
  `hits=${ragA.data.hit_count || 0}`
);

const listB = await api('GET', '/api/master-data/documents', null, userB.token);
check(
  listB.status === 200 && !(listB.data.documents || []).some((d) => d.id === masterDoc?.id),
  'CEO B cannot list CEO A document'
);
const getB = await api('GET', `/api/master-data/documents/${encodeURIComponent(masterDoc?.id || '')}`, null, userB.token);
check(getB.status === 404, 'CEO B cannot get CEO A document', `status=${getB.status}`);
const ragB = await api(
  'POST',
  '/api/master-data/rag',
  { query: uniqueMaster, topK: 5, summarize: false },
  userB.token
);
check(
  ragB.status === 200 && !JSON.stringify(ragB.data.chunks || []).includes(uniqueMaster),
  'CEO B RAG cannot retrieve CEO A content',
  `hits=${ragB.data.hit_count || 0}`
);

const expectedMetaA = metaIndexName(userA.userId);
const expectedSearchA = searchIndexName(userA.userId);
const indexedMeta = await getDocument(userA.userId, masterDoc.id);
const indexedSearch = await searchDocuments(userA.userId, { query: uniqueMaster, topK: 5 });
check(indexedMeta?.id === masterDoc.id, 'document exists in CEO A metadata index', expectedMetaA);
check(
  (indexedSearch.chunks || []).some((hit) => hit.document_id === masterDoc.id),
  'document chunks exist in CEO A search index',
  expectedSearchA
);
check(
  metaIndexName(userB.userId) !== expectedMetaA && searchIndexName(userB.userId) !== expectedSearchA,
  'CEO A and CEO B resolve to different OpenSearch indices',
  `A=${expectedMetaA}/${expectedSearchA} B=${metaIndexName(userB.userId)}/${searchIndexName(userB.userId)}`
);

const cooInvoke = await invokeRag(userA.userId, 'balserve', `${uniqueMaster} approval window`);
check(cooInvoke.status === 200, 'COO master_data_rag invoke authorized', `status=${cooInvoke.status}`);
check(
  JSON.stringify(cooInvoke.data.chunks || []).includes(uniqueMaster),
  'COO reads CEO A OpenSearch document',
  cooInvoke.openclawAgentId
);

const platformHelpInvoke = await invokeRag(
  userA.userId,
  'platformhelp',
  'Master Data document RAG OpenSearch index'
);
if (platformHelpInvoke.status !== 200) {
  console.error('Platform Help invoke error:', JSON.stringify(platformHelpInvoke.data));
}
check(
  platformHelpInvoke.status === 200,
  'Platform Help master_data_rag invoke authorized',
  `status=${platformHelpInvoke.status}`
);
check(
  platformHelpInvoke.data.owner_user_id === '__platform__',
  'Platform Help selects shared platform OpenSearch index',
  `owner=${platformHelpInvoke.data.owner_user_id}`
);
check(
  (platformHelpInvoke.data.hit_count || 0) > 0,
  'Platform Help retrieves platform document chunks',
  `hits=${platformHelpInvoke.data.hit_count || 0}`
);
check(
  !JSON.stringify(platformHelpInvoke.data.chunks || []).includes(uniqueMaster),
  'Platform Help does not leak CEO A user document'
);

const crossAgent = await invokeRag(userB.userId, 'balserve', uniqueMaster);
check(crossAgent.status === 200, 'CEO B COO tool invoke authorized for CEO B', `status=${crossAgent.status}`);
check(
  !JSON.stringify(crossAgent.data.chunks || []).includes(uniqueMaster),
  'CEO B COO cannot retrieve CEO A OpenSearch document'
);

// Exact upload payload produced by frontend/src/utils/chatAttachments.js.
const chatUpload = await api(
  'POST',
  '/api/master-data/documents',
  {
    title: `Chat attach — agent-ui-${stamp}.txt`,
    filename: `agent-ui-${stamp}.txt`,
    mimeType: 'text/plain',
    contentBase64: Buffer.from(
      `${uniqueChat} Agent UI attachment fact: project lighthouse budget is 913 units.`,
      'utf8'
    ).toString('base64'),
  },
  userA.token
);
const chatDoc = chatUpload.data.document;
if (chatDoc?.id) created.push(chatDoc.id);
check(chatUpload.status === 201 && Boolean(chatDoc?.id), 'agent UI attachment upload API', `doc=${chatDoc?.id}`);
const chatMeta = await getDocument(userA.userId, chatDoc.id);
const chatSearch = await searchDocuments(userA.userId, { query: uniqueChat, topK: 5 });
check(chatMeta?.id === chatDoc.id, 'agent UI attachment stored in CEO A metadata index', expectedMetaA);
check(
  (chatSearch.chunks || []).some((hit) => hit.document_id === chatDoc.id),
  'agent UI attachment stored in CEO A RAG index',
  expectedSearchA
);
const chatTool = await invokeRag(userA.userId, 'balserve', `${uniqueChat} lighthouse budget`);
check(
  chatTool.status === 200 && JSON.stringify(chatTool.data).includes(uniqueChat),
  'COO master_data_rag retrieves agent UI attachment'
);

for (const documentId of created) {
  const cleanup = await api(
    'DELETE',
    `/api/master-data/documents/${encodeURIComponent(documentId)}`,
    null,
    userA.token
  );
  check(cleanup.status === 200, 'cleanup test document', `doc=${documentId}`);
}

console.log(`RESULT passed=${passed} failed=${failed}`);
process.exit(failed ? 1 : 0);
