/**
 * Phase 1 video studio smoke test for Balaji Ranganathan (or WORKFLOW_SEED_OWNER_ID).
 * Installs pack from golden sources, saves characters, exports two storyboards:
 *  1) Ant and the Grasshopper
 *  2) Clever Thenaliraman tale
 *
 * Usage (local):
 *   node backend/scripts/test-video-content-phase1.js
 *   WORKFLOW_SEED_OWNER_ID=ceo-bala node backend/scripts/test-video-content-phase1.js
 */
import { config } from 'dotenv';
import { dirname, join, resolve as pathResolve } from 'path';
import { fileURLToPath } from 'url';
import { existsSync } from 'fs';

const __dirname = dirname(fileURLToPath(import.meta.url));

function resolveBalajiOwner(getDb) {
  const only = String(process.env.WORKFLOW_SEED_OWNER_ID || '').trim();
  if (only) {
    const row = getDb().prepare(`SELECT id, name, email FROM platform_users WHERE id = ?`).get(only);
    if (!row) throw new Error(`owner not found: ${only}`);
    return row;
  }
  const row =
    getDb()
      .prepare(
        `SELECT id, name, email FROM platform_users
         WHERE role = 'ceo' AND enabled = 1 AND (
           id = 'ceo-bala'
           OR lower(name) LIKE '%balaji%ranganathan%'
           OR lower(name) = 'balaji ranganathan'
           OR lower(email) LIKE '%balaji.x.ranga%'
         )
         ORDER BY CASE WHEN id = 'ceo-bala' THEN 0 ELSE 1 END
         LIMIT 1`
      )
      .get() ||
    getDb()
      .prepare(
        `SELECT id, name, email FROM platform_users WHERE role = 'ceo' AND enabled = 1 AND lower(name) LIKE '%balaji%' LIMIT 1`
      )
      .get();
  if (!row) throw new Error('Balaji Ranganathan CEO not found — set WORKFLOW_SEED_OWNER_ID');
  return row;
}

const ANT_GRASSHOPPER = {
  title: 'The Ant and the Grasshopper',
  duration_sec: 56,
  logline: 'A hardworking ant prepares for winter while a carefree grasshopper learns why foresight matters.',
  tone: 'warm fable, clear morals, kid-friendly',
  characters: [
    {
      id: 'ant',
      name: 'Ant',
      role: 'Diligent worker',
      ref_media: '',
    },
    {
      id: 'grasshopper',
      name: 'Grasshopper',
      role: 'Carefree musician',
      ref_media: '',
    },
  ],
  scenes: [
    {
      index: 1,
      duration_sec: 8,
      characters: ['ant', 'grasshopper'],
      description: 'Sunny meadow; ant hauls a grain; grasshopper dances with a tiny violin.',
      continuity_notes: 'Establish both characters side by side',
      veo_prompt:
        'Cinematic short: tiny anthropomorphic ant carrying a golden grain across a sunlit meadow; nearby a cheerful grasshopper plays a miniature violin; soft morning light, shallow depth of field, storybook realism',
      negative_prompt: 'text overlay, shaky cam, horror, violence',
    },
    {
      index: 2,
      duration_sec: 8,
      characters: ['grasshopper'],
      description: 'Grasshopper laughs and invites the ant to play instead of work.',
      continuity_notes: 'Same meadow lighting',
      veo_prompt:
        'Close-up of playful grasshopper gesturing invitingly toward off-screen friend, meadow bokeh, warm colors, gentle breeze on grass',
      negative_prompt: 'text, logos, dark mood',
    },
    {
      index: 3,
      duration_sec: 8,
      characters: ['ant'],
      description: 'Ant politely declines and continues stacking food in a tidy burrow entrance.',
      continuity_notes: 'Ant consistent size and red-brown shell',
      veo_prompt:
        'Anthropomorphic ant carefully stacking grains at a burrow entrance, focused expression, golden hour light, detailed natural textures',
      negative_prompt: 'chaos, destruction, text',
    },
    {
      index: 4,
      duration_sec: 8,
      characters: ['grasshopper'],
      description: 'Autumn arrives; leaves fall; grasshopper still plays, thinner and colder.',
      continuity_notes: 'Season shift to autumn',
      veo_prompt:
        'Autumn meadow, falling orange leaves, grasshopper playing violin alone looking colder, cinematic seasonal transition',
      negative_prompt: 'snow yet, text',
    },
    {
      index: 5,
      duration_sec: 8,
      characters: ['grasshopper', 'ant'],
      description: 'First frost; grasshopper knocks at the ant’s warm burrow.',
      continuity_notes: 'Winter cold vs warm burrow glow',
      veo_prompt:
        'Frosty night, grasshopper shivering at a glowing burrow door; warm light spills out; ant appears in doorway with compassionate look',
      negative_prompt: 'gore, cruelty, text',
    },
    {
      index: 6,
      duration_sec: 8,
      characters: ['ant', 'grasshopper'],
      description: 'Ant shares a meal; grasshopper learns to help store food for next year.',
      continuity_notes: 'Hopeful ending',
      veo_prompt:
        'Cozy burrow interior, ant and grasshopper sharing a small feast, then both carrying grains together into shelves; heartwarming storybook ending',
      negative_prompt: 'sad ending, text overlay',
    },
    {
      index: 7,
      duration_sec: 8,
      characters: ['ant', 'grasshopper'],
      description: 'Spring montage: both working and playing in balance.',
      continuity_notes: 'Moral beat',
      veo_prompt:
        'Spring meadow montage: ant and grasshopper working side by side then briefly dancing; balanced life moral, bright hopeful tones',
      negative_prompt: 'text, watermark',
    },
  ],
};

const THENALIRAMAN = {
  title: 'Thenaliraman and the Clever Pot of Wisdom',
  duration_sec: 56,
  logline:
    'Witty court jester Thenaliraman outsmarts a boastful scholar who claims his pot holds all the world’s wisdom — with a single clever question.',
  tone: 'South Indian folk humor, clever, respectful, family-friendly',
  characters: [
    {
      id: 'thenali',
      name: 'Thenaliraman',
      role: 'Witty court jester',
      ref_media: '',
    },
    {
      id: 'scholar',
      name: 'Boastful Scholar',
      role: 'Proud visiting pandit',
      ref_media: '',
    },
    {
      id: 'king',
      name: 'King Krishnadevaraya',
      role: 'Amused ruler',
      ref_media: '',
    },
  ],
  scenes: [
    {
      index: 1,
      duration_sec: 8,
      characters: ['king', 'scholar'],
      description: 'Royal court; scholar presents a sealed ornate pot claiming it holds all wisdom.',
      continuity_notes: 'Vijayanagara-inspired court, warm lamps',
      veo_prompt:
        'Historical South Indian royal court, proud scholar holding an ornate sealed clay pot high, king on throne watching, cinematic warm torchlight, respectful costume detail',
      negative_prompt: 'cartoon slapstick injury, text, modern objects',
    },
    {
      index: 2,
      duration_sec: 8,
      characters: ['scholar'],
      description: 'Scholar boasts no question can stump the pot’s wisdom.',
      continuity_notes: 'Same pot design throughout',
      veo_prompt:
        'Medium shot of boastful scholar gesturing at sealed ornate pot, courtiers listening, rich silk textures, gentle camera push-in',
      negative_prompt: 'mockery faces, text',
    },
    {
      index: 3,
      duration_sec: 8,
      characters: ['thenali', 'king'],
      description: 'Thenaliraman bows to the king and asks permission to test the claim.',
      continuity_notes: 'Thenali in classic jester attire with witty smile',
      veo_prompt:
        'Clever Thenaliraman bowing to the king with a mischievous kind smile, court background soft bokeh, cinematic storytelling frame',
      negative_prompt: 'cruel expression, text',
    },
    {
      index: 4,
      duration_sec: 8,
      characters: ['thenali', 'scholar'],
      description: 'Thenali asks: if the pot holds ALL wisdom, how did any wisdom remain outside for the scholar to speak?',
      continuity_notes: 'Focus on faces and pot',
      veo_prompt:
        'Thenaliraman pointing gently at the sealed pot while posing a riddle to the scholar, court audience leaning in, witty tension, warm lantern light',
      negative_prompt: 'violence, humiliation closeups, text',
    },
    {
      index: 5,
      duration_sec: 8,
      characters: ['scholar'],
      description: 'Scholar freezes, realizing the paradox; pot still sealed.',
      continuity_notes: 'Comic beat without cruelty',
      veo_prompt:
        'Boastful scholar frozen mid-thought staring at sealed pot, soft comic timing, respectful humor, cinematic still energy',
      negative_prompt: 'mean laughter, text',
    },
    {
      index: 6,
      duration_sec: 8,
      characters: ['king', 'thenali', 'scholar'],
      description: 'King laughs kindly; scholar smiles and learns humility; Thenali winks.',
      continuity_notes: 'Warm resolution',
      veo_prompt:
        'King laughing kindly on throne, scholar smiling humbly, Thenaliraman giving a friendly wink, harmonious court ending, golden light',
      negative_prompt: 'punishment, text overlay',
    },
    {
      index: 7,
      duration_sec: 8,
      characters: ['thenali'],
      description: 'Closing: Thenali walks out under temple-like arches with the moral — wit beats empty boasts.',
      continuity_notes: 'Epigraph feeling without on-screen text',
      veo_prompt:
        'Thenaliraman walking under carved South Indian arches at dusk, thoughtful smile, moral of clever wisdom, cinematic farewell shot',
      negative_prompt: 'readable text, logos',
    },
  ],
};

function isDirectRun() {
  try {
    const entry = process.argv[1] ? pathResolve(process.argv[1]) : '';
    return entry && entry === fileURLToPath(import.meta.url);
  } catch {
    return false;
  }
}

if (isDirectRun()) {
  config({ path: join(__dirname, '..', '.env') });
  config({ path: join(__dirname, '../../deploy/.env') });
  const { initDb, getDb } = await import('../src/db/schema.js');
  const { seedVideoStoryboardToolsIfMissing } = await import('../src/db/seed-content-tools-meta.js');
  const { installVideoContentForOwner } = await import('../src/services/prefab-video-agents.js');
  const { exportVideoStoryboard, saveVideoCharacters } = await import(
    '../src/services/video-storyboard-export.js'
  );
  const { listRows, findTableByName } = await import('../src/services/master-data.js');

  initDb();
  seedVideoStoryboardToolsIfMissing();

  const ceo = resolveBalajiOwner(getDb);
  console.log('[test-video-p1] owner', ceo.id, ceo.name, ceo.email);

  const install = await installVideoContentForOwner(ceo.id, { includeStubWorkflows: false });
  if (!install.ok && !install.agents?.length) {
    console.error('[test-video-p1] install failed', install);
    process.exit(1);
  }

  const agentsGranted = getDb()
    .prepare(
      `SELECT a.id, a.name FROM agents a
       INNER JOIN user_agents ua ON ua.agent_id = a.id
       WHERE ua.user_id = ? AND a.id LIKE 'video-%'`
    )
    .all(ceo.id);
  console.log('[test-video-p1] granted video agents', agentsGranted);

  const wf = getDb()
    .prepare(
      `SELECT id, name, chat_trigger_phrase, status, published_graph_json, draft_graph_json FROM agent_workflow_definitions
       WHERE owner_user_id = ? AND id LIKE 'video-reasoning%'`
    )
    .all(ceo.id);
  console.log(
    '[test-video-p1] workflows',
    wf.map(({ published_graph_json, draft_graph_json, ...rest }) => rest)
  );
  const published = wf.find((w) => w.status === 'published') || wf[0];
  const graphJson = published?.published_graph_json || published?.draft_graph_json;
  if (graphJson) {
    const g = typeof graphJson === 'string' ? JSON.parse(graphJson) : graphJson;
    const gate = (g.nodes || []).find((n) => n.id === 'ceo-gate' || n.type === 'ceo_approval');
    const bound = (gate?.data?.inputBindings || []).some((b) => b.sourceNodeId === 'prompt-1');
    if (!bound) {
      throw new Error('seeded video-reasoning ceo-gate missing prompt-1 summary binding');
    }
  }

  const chars = saveVideoCharacters(ceo.id, [
    ...ANT_GRASSHOPPER.characters.map((c) => ({
      character_id: c.id,
      name: c.name,
      role: c.role,
      ref_media: c.ref_media,
      notes: 'phase1-test ant-grasshopper',
    })),
    ...THENALIRAMAN.characters.map((c) => ({
      character_id: c.id,
      name: c.name,
      role: c.role,
      ref_media: c.ref_media,
      notes: 'phase1-test thenaliraman',
    })),
  ]);
  console.log('[test-video-p1] characters', chars);

  const ant = await exportVideoStoryboard(ceo.id, {
    storyboard: ANT_GRASSHOPPER,
    storyboard_id: 'test-ant-grasshopper',
    formats: ['html', 'pdf', 'image'],
    persist: true,
  });
  const thenali = await exportVideoStoryboard(ceo.id, {
    storyboard: THENALIRAMAN,
    storyboard_id: 'test-thenaliraman',
    formats: ['html', 'pdf', 'image'],
    persist: true,
  });

  function assertMedia(label, exp) {
    for (const key of ['html', 'pdf', 'image']) {
      const m = exp.exports?.[key];
      if (!m?.local_path || !existsSync(m.local_path)) {
        throw new Error(`${label} missing file for ${key}: ${m?.local_path}`);
      }
    }
  }
  assertMedia('ant', ant);
  assertMedia('thenali', thenali);

  const table = findTableByName(ceo.id, 'video_storyboards');
  const rows = listRows(ceo.id, table.id, { limit: 50 });
  const ids = (rows.rows || []).map((r) => r.data?.storyboard_id);
  if (!ids.includes('test-ant-grasshopper') || !ids.includes('test-thenaliraman')) {
    throw new Error('storyboard rows missing in Master Data: ' + JSON.stringify(ids));
  }

  // Entitlement: another fake owner must not see Balaji's table by name on wrong owner
  const cross = findTableByName('ceo-not-entitled-fake', 'video_storyboards');
  if (cross) {
    throw new Error('cross-tenant video_storyboards leak');
  }

  console.log(
    JSON.stringify(
      {
        ok: true,
        owner: ceo.id,
        agents: install.agents,
        workflows: install.workflows?.results,
        ant: {
          storyboard_id: ant.storyboard_id,
          media_lines: ant.media_lines,
        },
        thenaliraman: {
          storyboard_id: thenali.storyboard_id,
          media_lines: thenali.media_lines,
        },
      },
      null,
      2
    )
  );
}
