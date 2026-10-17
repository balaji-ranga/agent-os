// Explicit local-only development preview. It cannot be bound to a LAN address.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { SessionAuthority } from './session-authority.mjs';
import { createAdoptionServer } from './server.mjs';
import { createPrivateTasks } from './private-tasks.mjs';
import { createDocumentExtractor } from './document-extractor.mjs';
import { startLocalParsers } from './local-parser.mjs';
import { createPlatformPlanner } from './platform-model.mjs';
import { createKnowledgeAnswer } from './knowledge-answer.mjs';
const root = resolve(process.env.ADOPTION_PREVIEW_ROOT || '.local/private-preview');
await mkdir(root, {
  recursive: true
});
const authority = new SessionAuthority({
    development: true
  }),
  origin = 'http://127.0.0.1:4194',
  serviceUrl = 'http://127.0.0.1:4193/';
let planner, answer;
if (process.env.ADOPTION_PREVIEW_MODEL_CONFIG) {
  const model = JSON.parse(await readFile(process.env.ADOPTION_PREVIEW_MODEL_CONFIG, 'utf8'));
  planner = createPlatformPlanner(model);
  answer = createKnowledgeAnswer(model);
} else planner = async ({
  text,
  snapshot,
  privateGuidance
}) => {
  const evidence = [text, ...(privateGuidance?.evidence || []).map(e => e.text)].join('\n');
  const actions = snapshot.fields.flatMap(field => {
    const label = field.label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'),
      match = new RegExp(`(?:^|[\\n;])\\s*${label}\\s*:\\s*([^\\n;]+)`, 'i').exec(evidence);
    return match ? [{
      type: 'fill',
      ref: field.ref,
      value: match[1].trim()
    }] : [];
  });
  return {
    message: 'Local deterministic preview. Production uses the configured platform LLM.',
    actions
  };
};
const websites = new Map(['preview-a', 'preview-b'].map(id => [id, {
  id,
  origin,
  environment: 'development',
  organizationId: 'synthetic-preview-owner',
  verified: true,
  status: 'approved',
  taskPolicy: {
    attachments: true,
    pairing: true,
    workflow: false
  }
}]));
const privateTasks = await createPrivateTasks({
  root: resolve(root, 'objects'),
  website: id => websites.get(id),
  activeScope: s => authority.activeScope(s),
  planner,
  answer
});
const parsers = startLocalParsers({
  claim: id => privateTasks.claim(id),
  input: c => privateTasks.input(c),
  complete: (c, r) => privateTasks.complete(c, r),
  heartbeat: c => privateTasks.heartbeatClaim(c),
  fail: c => privateTasks.fail(c)
}, createDocumentExtractor({
  python: process.env.ADOPTION_PYTHON || 'python'
}));
const registrations = [...websites.keys()].map(embeddingId => ({
  embeddingId,
  ...authority.registerApproved({
    embeddingId,
    origins: [origin],
    expiresAt: Date.now() + 6 * 3600000
  })
}));
await writeFile(resolve(root, 'public.json'), JSON.stringify({
  serviceUrl,
  embeddings: registrations
}), {
  mode: 0o600
});
const server = createAdoptionServer({
  authority,
  privateTasks,
  taskWebsite: id => websites.get(id),
  planner
});
server.listen(4193, '127.0.0.1', () => console.log('Private-task test service on loopback 4193. Start local-vps-demo.mjs with ADOPTION_DEMO_CONFIG pointing to private-preview/public.json. Deterministic planner unless explicitly configured.'));
process.on('SIGINT', async () => {
  parsers.stop();
  await privateTasks.close();
  server.closeAllConnections();
  server.close(() => process.exit(0));
});
process.on('SIGTERM', async () => {
  parsers.stop();
  await privateTasks.close();
  server.closeAllConnections();
  server.close(() => process.exit(0));
});
