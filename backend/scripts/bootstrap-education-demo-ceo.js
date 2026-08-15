/**
 * Provision the Education-industry demo CEO using existing CEO services
 * (Company setup, Business Core, Knowledge, hire, scheduled goals, WhatsApp channel, speech).
 * No education-specific tools. Secrets are copied from a source CEO vault or backend env — never logged.
 *
 * Run inside the backend container:
 *   docker compose exec -T -w /opt/agent-os/backend backend node scripts/bootstrap-education-demo-ceo.js
 *
 * Env:
 *   EDU_DEMO_EMAIL, EDU_DEMO_PASS, EDU_DEMO_NAME, EDU_DEMO_COMPANY
 *   SOURCE_OWNER_USER_ID (default ceo-bala) — vault copy for Platform_BYOK / BRAVE_SEARCH_BYOK / elevenlabs-key
 *   SKIP_COMPANY_APPLY=1, SKIP_SMOKE=1, SKIP_WHATSAPP=1
 */
import { config } from 'dotenv';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import crypto from 'crypto';

const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: join(__dirname, '..', '.env') });
config({ path: join(__dirname, '../../deploy/.env') });

import { initDb } from '../src/db/schema.js';
import { registerCeoUser, getUserById, listAgentsForUser } from '../src/services/users.js';
import { getDb } from '../src/db/schema.js';
import { saveFunnelDraft, applyCompanySetup } from '../src/services/company-setup.js';
import { updateUserLlmSettings } from '../src/services/user-llm-settings.js';
import {
  PLATFORM_BYOK_KEY_NAME,
  BRAVE_SEARCH_BYOK_KEY_NAME,
  ELEVENLABS_BYOK_KEY_NAME,
  listUserApiKeys,
  getUserApiKeyRow,
  createUserApiKey,
  updateUserApiKey,
  tryResolveUserApiKey,
  ensureByokVaultSlots,
} from '../src/services/user-api-keys.js';
import { createTable, listTables, insertRow } from '../src/services/master-data.js';
import { createFullAgent } from '../src/services/create-full-agent.js';
import { createScheduledGoal, listScheduledGoals } from '../src/services/scheduled-goals.js';
import {
  listAgentChannels,
  createAgentChannel,
  applyAgentChannel,
} from '../src/services/ceo-agent-channels.js';
import * as workspace from '../src/workspace/adapter.js';
import { tenantWorkspacePath } from '../src/services/openclaw-tenant.js';
import { executeSpeechTtsTool, executeSpeechSttTool } from '../src/services/speech-content-tools.js';
import { getBusinessProfile } from '../src/services/company-business-profile.js';

initDb();

const EMAIL = String(process.env.EDU_DEMO_EMAIL || 'meridian.college@flolah.cloud').trim().toLowerCase();
const NAME = process.env.EDU_DEMO_NAME || 'Meridian College CEO';
const COMPANY = process.env.EDU_DEMO_COMPANY || 'Meridian College';
const SOURCE_OWNER = process.env.SOURCE_OWNER_USER_ID || 'ceo-bala';
const PA_MEMORY_MARKER = '## WhatsApp PA (text + voice)';
const COPY_KEYS = [PLATFORM_BYOK_KEY_NAME, BRAVE_SEARCH_BYOK_KEY_NAME, ELEVENLABS_BYOK_KEY_NAME];

function hint(secret) {
  const s = String(secret || '');
  if (s.length < 8) return 'len=' + s.length;
  return 'len=' + s.length + ' …' + s.slice(-4);
}

function setVaultSecret(ownerId, keyName, secret) {
  const row = getUserApiKeyRow(ownerId, keyName);
  if (!row) {
    createUserApiKey(ownerId, { keyName, apiKey: secret });
    return 'created';
  }
  updateUserApiKey(ownerId, row.id, { apiKey: secret });
  return 'updated';
}

function openaiKeyFromEnv() {
  const secondary = String(process.env.OPENAI_SECONDARY_API_KEY || '').trim();
  const secondaryBase = String(process.env.OPENAI_SECONDARY_BASE_URL || '').trim();
  const primary = String(process.env.OPENAI_API_KEY || process.env.OPENAI_PRIMARY_API_KEY || '').trim();
  const secondaryLooksOpenAi =
    !!secondary &&
    (/openai\.com/i.test(secondaryBase) || /^sk-(proj-)?/.test(secondary) || secondary.length >= 40);
  if (secondaryLooksOpenAi) return { value: secondary, from: 'OPENAI_SECONDARY_API_KEY' };
  if (primary) {
    return {
      value: primary,
      from: process.env.OPENAI_API_KEY ? 'OPENAI_API_KEY' : 'OPENAI_PRIMARY_API_KEY',
    };
  }
  return null;
}

function seedByokFromSource(destId) {
  ensureByokVaultSlots(destId, 'openai');
  const copied = [];
  const skipped = [];
  for (const name of COPY_KEYS) {
    const fromVault = tryResolveUserApiKey(SOURCE_OWNER, name);
    let secret = fromVault?.value || '';
    let from = fromVault ? `vault:${SOURCE_OWNER}` : '';
    if (!secret && name === PLATFORM_BYOK_KEY_NAME) {
      const envKey = openaiKeyFromEnv();
      if (envKey) {
        secret = envKey.value;
        from = envKey.from;
      }
    }
    if (!secret && name === BRAVE_SEARCH_BYOK_KEY_NAME) {
      const brave = String(process.env.BRAVE_API_KEY || '').trim();
      if (brave) {
        secret = brave;
        from = 'BRAVE_API_KEY';
      }
    }
    if (!secret) {
      skipped.push(name);
      continue;
    }
    const action = setVaultSecret(destId, name, secret);
    copied.push({ name, action, from, hint: hint(secret) });
    console.info('[edu-demo] vault seeded', { name, action, from, hint: hint(secret) });
  }
  return { copied, skipped };
}

async function ensureCeo() {
  const db = getDb();
  const existing = db.prepare('SELECT id FROM platform_users WHERE lower(email) = lower(?)').get(EMAIL);
  if (existing) {
    return { user: getUserById(existing.id), created: false, password: null };
  }
  const password = process.env.EDU_DEMO_PASS || `Meridian-${crypto.randomBytes(5).toString('hex')}!A1`;
  const user = await registerCeoUser({
    accept_terms: true,
    email: EMAIL,
    password,
    name: NAME,
    country: 'SG',
    region: 'SG-01',
    industry: 'education',
    business_name: COMPANY,
    ceo_db_mode: 'tenant',
    mfa_policy: 'off',
    llm_provider: 'platform_decided',
  });
  return { user, created: true, password };
}

function ensureKnowledgeTable(ownerId, name, description, columns, seedRows = []) {
  const tables = listTables(ownerId) || [];
  let table = tables.find((t) => String(t.name || '').toLowerCase() === name.toLowerCase());
  if (!table) {
    table = createTable(ownerId, { name, description, columns });
    console.info('[edu-demo] knowledge table created', { name, id: table.id });
  } else {
    console.info('[edu-demo] knowledge table exists', { name, id: table.id });
  }
  if (Number(table.row_count || 0) === 0 && seedRows.length) {
    for (const row of seedRows) insertRow(ownerId, table.id, row);
    console.info('[edu-demo] knowledge rows seeded', { name, n: seedRows.length });
  }
  return table;
}

async function ensureAdvisor(ownerId) {
  const agents = listAgentsForUser(ownerId) || [];
  const found = agents.find((a) => {
    const id = String(a.id || '').toLowerCase();
    const n = String(a.name || '').toLowerCase();
    return id.includes('businessadvisor') || n.includes('business advisor');
  });
  if (found) {
    console.info('[edu-demo] Business Advisor exists', { id: found.id });
    return found;
  }
  const agent = await createFullAgent({
    ownerUserId: ownerId,
    name: 'Business Advisor',
    role: 'Weekly strategy briefs that replace a paid business-consultant retainer',
    department: 'Executive',
    reportingTo: 'balserve',
    hourly_rate_usd: 25,
    tools: [
      'learnings_summary',
      'master_data_list_tables',
      'master_data_list_rows',
      'master_data_insert_row',
      'master_data_update_row',
      'master_data_rag',
      'master_data_list_documents',
      'summarize_url',
      'brave_web_search',
      'notify_ceo',
    ],
  });
  console.info('[edu-demo] Business Advisor hired', { id: agent.id });
  return agent;
}

async function ensureCooPaMemory(ownerId) {
  const root = tenantWorkspacePath(ownerId, 'balserve');
  let current = '';
  try {
    const read = await workspace.readWorkspaceFile('memory', { workspaceRoot: root });
    current = read?.text || '';
  } catch {
    current = '';
  }
  if (current.includes(PA_MEMORY_MARKER)) {
    console.info('[edu-demo] COO MEMORY already has WhatsApp PA rules');
    return { updated: false };
  }
  const block = `

${PA_MEMORY_MARKER}

This CEO uses you as a personal assistant on WhatsApp.

- Listen: text as chat; voice notes → list_inbound_attachments → speech_stt, then treat the transcript as the request.
- Capture thoughts: if they say remember / capture / later, insert a row in Knowledge table thought_inbox (captured_at, thought, status=open, follow_up).
- Respond on WhatsApp always in both modes: full readable text body, then speech_tts on a short spoken line, paste MEDIA: / paste_exactly alone so WhatsApp attaches a voice note (OGG/Opus or MP3, never WAV-only, never /api/media HTTPS).
- Evening scheduled goal: prompt open thought_inbox rows the same dual way.
`;
  await workspace.writeWorkspaceFile('memory', `${current.trimEnd()}\n${block}`, { workspaceRoot: root });
  console.info('[edu-demo] COO MEMORY WhatsApp PA rules written');
  return { updated: true };
}

async function ensureScheduledGoals(ownerId) {
  const existing = listScheduledGoals(ownerId) || [];
  const titles = new Set(existing.map((g) => String(g.title || '')));
  const specs = [
    {
      title: 'Meridian morning briefing',
      cadence: 'weekdays',
      time_local: '08:00',
      prompt:
        'Weekday morning personal-assistant briefing for the Meridian College CEO. Summarize open Kanban, unpaid tuition invoices if ERP tools allow, and open thought_inbox rows. Reply for WhatsApp in text plus a short spoken line (speech_tts + MEDIA attach).',
    },
    {
      title: 'Meridian evening thought prompt',
      cadence: 'daily',
      time_local: '20:00',
      prompt:
        'Prompt the CEO on open rows in Knowledge table thought_inbox (status open). For each thought, ask whether to act, defer, or close. WhatsApp dual-mode: full text plus speech_tts MEDIA voice note. After prompting, update status to prompted when appropriate.',
    },
    {
      title: 'Meridian weekly consultant brief',
      cadence: 'weekly',
      weekday: 1,
      time_local: '09:00',
      prompt:
        'Weekly business-consultant style brief: admissions pipeline (CRM), fee collections (ERP readonly), consultant_contacts Knowledge table, and this_week_digest Time Saved / Est. Value. Delegate specialty research to Business Advisor if needed. WhatsApp dual-mode text plus TTS.',
    },
  ];
  const created = [];
  for (const spec of specs) {
    if (titles.has(spec.title)) {
      console.info('[edu-demo] scheduled goal exists', { title: spec.title });
      continue;
    }
    const row = await createScheduledGoal(ownerId, {
      ...spec,
      agent_id: 'balserve',
      timezone: 'Asia/Singapore',
      source: 'coo_tool',
      approve_plan: true,
      skip_plan_review: true,
      plan: {
        steps: [{ type: 'agent_continue', title: spec.title, prompt: spec.prompt }],
        amended_manually: true,
      },
    });
    created.push({ id: row?.id, title: spec.title, status: row?.status });
    console.info('[edu-demo] scheduled goal created', { id: row?.id, title: spec.title, status: row?.status });
  }
  return created;
}

function ensureWhatsAppDraft(ownerId) {
  const list = listAgentChannels(ownerId, { agentId: 'balserve' }) || [];
  const wa = list.find((c) => String(c.channel || '').toLowerCase() === 'whatsapp');
  if (wa) {
    console.info('[edu-demo] WhatsApp channel exists', { id: wa.id, status: wa.status });
    return wa;
  }
  const channel = createAgentChannel(ownerId, {
    agentId: 'balserve',
    channel: 'whatsapp',
    config: { dmPolicy: 'pairing', groupPolicy: 'disabled' },
  });
  console.info('[edu-demo] WhatsApp channel drafted', { id: channel.id, status: channel.status });
  return channel;
}

async function smokeSpeech(ownerId) {
  const tts = await executeSpeechTtsTool(
    {
      text: 'Good morning. This is your Meridian College assistant. I heard you and I will follow up.',
      format: 'ogg',
    },
    ownerId
  );
  const media = tts?.paste_exactly || tts?.media_uri || '';
  console.info('[edu-demo] speech_tts', {
    ok: !!tts?.ok,
    has_media: Boolean(media),
    format: tts?.format || null,
    delivery_format: tts?.delivery_format || null,
  });
  let sttText = '';
  try {
    const artifactId = tts?.audio?.artifactId || tts?.audio?.id || tts?.id;
    const stt = await executeSpeechSttTool(
      artifactId ? { artifact_id: artifactId } : { media_uri: media, path: media },
      ownerId
    );
    sttText = String(stt?.text || '').slice(0, 160);
    console.info('[edu-demo] speech_stt roundtrip', { chars: sttText.length, preview: sttText.slice(0, 80) });
  } catch (e) {
    console.warn('[edu-demo] speech_stt (non-fatal)', e?.message || e);
  }
  return { tts_ok: Boolean(media), stt_ok: sttText.length > 0, stt_preview: sttText.slice(0, 80) };
}

async function smokeCrmErp(ownerId) {
  const out = { crm: null, erp: null };
  try {
    const { crmCreateLead } = await import('../src/services/twenty-crm.js');
    out.crm = await crmCreateLead(ownerId, {
      name: 'Demo prospect — Aisha Rahman',
      title: 'Admissions inquiry — Diploma in Business',
    });
    console.info('[edu-demo] CRM lead', {
      mode: out.crm?.mode,
      error: out.crm?.error || null,
    });
  } catch (e) {
    out.crm = { error: e?.message || String(e) };
    console.warn('[edu-demo] CRM lead (non-fatal)', e?.message || e);
  }
  try {
    const { erpCreateCustomer, erpCreateItem, erpCreateSalesInvoice } = await import('../src/services/erpnext-erp.js');
    const customer = await erpCreateCustomer(ownerId, {
      customer_name: 'Parent of Aisha Rahman',
      customer_type: 'Individual',
    });
    const item = await erpCreateItem(ownerId, {
      item_code: 'TUITION-DIP-BIZ',
      item_name: 'Diploma in Business — term tuition',
      item_group: 'Products',
      stock_uom: 'Nos',
      is_stock_item: 0,
    });
    const customerName = customer?.name || customer?.data?.name;
    const itemName = item?.name || item?.data?.name || 'TUITION-DIP-BIZ';
    const invoice = await erpCreateSalesInvoice(ownerId, {
      customer: customerName,
      items: [{ item_code: itemName, qty: 1, rate: 2500 }],
    });
    out.erp = {
      customer: customerName,
      item: itemName,
      invoice: invoice?.name || invoice?.data?.name,
      docstatus: invoice?.docstatus ?? invoice?.data?.docstatus,
    };
    console.info('[edu-demo] ERP tuition draft', out.erp);
  } catch (e) {
    out.erp = { error: e?.message || String(e) };
    console.warn('[edu-demo] ERP smoke (non-fatal)', e?.message || e);
  }
  return out;
}

async function main() {
  console.info('[edu-demo] start', { email: EMAIL, company: COMPANY, source: SOURCE_OWNER });
  const { user, created, password } = await ensureCeo();
  const ownerId = user.id;
  console.info('[edu-demo] ceo', { id: ownerId, email: user.email, created });

  const vault = seedByokFromSource(ownerId);
  const keys = listUserApiKeys(ownerId);
  const byok = keys.find((k) => k.key_name === PLATFORM_BYOK_KEY_NAME);
  if (!byok || byok.is_unset) {
    throw new Error('Platform_BYOK is still unset — cannot switch this CEO to OpenAI BYOK');
  }
  updateUserLlmSettings(ownerId, { llm_provider: 'openai', llm_model: 'gpt-4o-mini' });
  console.info('[edu-demo] profile BYOK openai/gpt-4o-mini');

  let companyResult = null;
  if (process.env.SKIP_COMPANY_APPLY === '1') {
    console.info('[edu-demo] SKIP_COMPANY_APPLY=1');
  } else {
    saveFunnelDraft(ownerId, {
      company_name: COMPANY,
      company_type: 'education',
      funnel_step: 'review',
      management_style: 'after_approval',
      crm_provider: 'twenty',
      erp_provider: 'erpnext',
      org_dna: 'execution',
      country: 'SG',
      region: 'SG-01',
      industry: 'education',
      mission:
        'Run a well-governed college: admissions, tuition collections, and a CEO personal assistant that captures thoughts and briefs the owner — under human approval.',
      describe_company:
        'Private college. Admissions pipeline, tuition billing, faculty coordination, and executive assistant work on WhatsApp.',
    });
    companyResult = await applyCompanySetup(ownerId, { confirm_override: true });
    console.info('[edu-demo] company apply', {
      status: companyResult?.status || companyResult?.strategy?.status || null,
      agents: companyResult?.applied?.agents_created?.length ?? null,
    });
  }

  ensureKnowledgeTable(
    ownerId,
    'thought_inbox',
    'CEO thoughts captured from WhatsApp or chat for later prompting',
    ['captured_at', 'thought', 'status', 'follow_up'],
    [
      {
        captured_at: new Date().toISOString().slice(0, 10),
        thought: 'Review hostel fee for next term',
        status: 'open',
        follow_up: 'evening prompt',
      },
    ]
  );
  ensureKnowledgeTable(
    ownerId,
    'consultant_contacts',
    'Human business consultants the CEO used to pay monthly — AI Advisor now drafts the brief',
    ['name', 'specialty', 'retainer_note', 'last_brief'],
    [
      {
        name: 'Demo strategy consultant',
        specialty: 'Admissions growth and fee mix',
        retainer_note: 'Previously monthly retainer; replace with weekly AI brief',
        last_brief: '',
      },
    ]
  );
  ensureKnowledgeTable(
    ownerId,
    'program_catalog',
    'Reference list of programs (not ERP books)',
    ['program_name', 'fee_note', 'intake'],
    [{ program_name: 'Diploma in Business', fee_note: '2500 per term', intake: 'Aug 2026' }]
  );

  await ensureAdvisor(ownerId);
  await ensureCooPaMemory(ownerId);
  const goals = await ensureScheduledGoals(ownerId);

  let whatsapp = null;
  if (process.env.SKIP_WHATSAPP !== '1') {
    whatsapp = ensureWhatsAppDraft(ownerId);
    try {
      if (whatsapp?.id && String(whatsapp.status || '') === 'draft') {
        const applied = applyAgentChannel(ownerId, whatsapp.id);
        whatsapp = applied?.channel || whatsapp;
        console.info('[edu-demo] WhatsApp apply', { id: whatsapp.id, status: whatsapp.status });
      }
    } catch (e) {
      console.warn('[edu-demo] WhatsApp apply (scan QR in Channels UI)', e?.message || e);
    }
  }

  const profile = getBusinessProfile(ownerId);
  const smokes = { speech: null, books: null };
  if (process.env.SKIP_SMOKE !== '1') {
    try {
      smokes.speech = await smokeSpeech(ownerId);
    } catch (e) {
      smokes.speech = { error: e?.message || String(e) };
      console.warn('[edu-demo] speech smoke failed', e?.message || e);
    }
    smokes.books = await smokeCrmErp(ownerId);
  }

  const out = {
    ok: true,
    ceo: { id: ownerId, email: user.email, created, password: created ? password : null },
    llm: 'openai/gpt-4o-mini',
    vault: {
      copied: vault.copied.map((k) => ({ name: k.name, action: k.action, from: k.from, hint: k.hint })),
      skipped: vault.skipped,
    },
    business_core: {
      crm: profile?.crm_provider,
      erp: profile?.erp_provider,
      twenty: profile?.twenty?.workspace_id || null,
      erpnext: profile?.erpnext?.company_id || null,
    },
    scheduled_goals: goals,
    whatsapp: whatsapp ? { id: whatsapp.id, status: whatsapp.status } : null,
    smokes,
    next: [
      'Log in as this CEO (password printed only when newly created).',
      'Channels → COO WhatsApp → scan QR on the demo phone (groups off).',
      'Send a text and a voice note; expect text + TTS voice reply.',
    ],
  };
  console.log(JSON.stringify(out, null, 2));
}

main().catch((e) => {
  console.error('[edu-demo] failed', e?.stack || e?.message || e);
  process.exit(1);
});
