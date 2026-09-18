import assert from 'node:assert/strict';
import { buildAvatarInboundGraph, buildAvatarOutboundGraph } from '../src/services/agent-workflow-templates.js';
import { buildDefaultAnimationPlan } from '../src/services/avatar-animation-catalog.js';

const voiceId = 'CwhRBWXzGAHq8TQ4Fs17';
const animationCatalog = ['HumanArmature|Man_Clapping', 'HumanArmature|Man_Idle'];
const outbound = buildAvatarOutboundGraph({
  agentId: 'trainer',
  avatarId: 'avatar-1',
  voiceId,
  animationCatalog,
  animationPlannerKeyRef: 'openAI_key',
});
const inbound = buildAvatarInboundGraph({
  agentId: 'trainer',
  avatarId: 'avatar-1',
  voiceId,
  animationCatalog,
  animationPlannerKeyRef: 'openAI_key',
});

assert.equal(outbound.nodes.find((node) => node.id === 'elevenlabs-1')?.data?.taskConfig?.voiceId, voiceId);
assert.equal(inbound.nodes.find((node) => node.id === 'elevenlabs-tts')?.data?.taskConfig?.voiceId, voiceId);
assert.equal(outbound.nodes.find((node) => node.id === 'brain-1')?.data?.taskConfig?.modelSource, 'openai');
assert.equal(outbound.nodes.find((node) => node.id === 'brain-1')?.data?.taskConfig?.apiKeyRef, 'openAI_key');
assert.equal(
  outbound.nodes.find((node) => node.id === 'brain-1')?.data?.taskConfig?.apiEndpoint,
  'https://api.openai.com/v1',
  'avatar OpenAI BYOK must not inherit the platform LiteLLM endpoint'
);
assert.equal(outbound.nodes.find((node) => node.id === 'brain-1')?.data?.taskConfig?.thinkingMode, 'off');
assert.equal(inbound.nodes.find((node) => node.id === 'brain-1')?.data?.taskConfig?.modelSource, 'openai');
assert.equal(
  inbound.nodes.find((node) => node.id === 'brain-1')?.data?.taskConfig?.apiEndpoint,
  'https://api.openai.com/v1'
);
assert.equal(
  buildAvatarOutboundGraph({ agentId: 'trainer' }).nodes.find((node) => node.id === 'elevenlabs-1')?.data?.taskConfig?.voiceId,
  '21m00Tcm4TlvDq8ikWAM'
);
assert.equal(
  buildAvatarOutboundGraph({ agentId: 'trainer' }).nodes.some((node) => node.id === 'brain-1'),
  false,
  'without an OpenAI BYOK key the workflow must use deterministic animation, never Ollama'
);

const safeCatalog = [
  'HumanArmature|Man_Clapping',
  'HumanArmature|Man_Death',
  'HumanArmature|Man_Idle',
  'HumanArmature|Man_Run',
  'HumanArmature|Man_Standing',
];
assert.deepEqual(
  buildDefaultAnimationPlan(safeCatalog, 'Hello, great to see you.').clips,
  [],
  'neutral greetings must not fall back to clapping'
);
assert.equal(
  buildDefaultAnimationPlan(safeCatalog, 'Congratulations on the achievement!').clips[0]?.name,
  'HumanArmature|Man_Clapping'
);
assert.equal(
  buildDefaultAnimationPlan(safeCatalog, 'Ready when you are.').clips[0]?.name,
  'HumanArmature|Man_Standing'
);

console.log('Avatar voice configuration checks passed.');
