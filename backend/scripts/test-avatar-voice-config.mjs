import assert from 'node:assert/strict';
import { buildAvatarInboundGraph, buildAvatarOutboundGraph } from '../src/services/agent-workflow-templates.js';

const voiceId = 'CwhRBWXzGAHq8TQ4Fs17';
const outbound = buildAvatarOutboundGraph({ agentId: 'trainer', avatarId: 'avatar-1', voiceId });
const inbound = buildAvatarInboundGraph({ agentId: 'trainer', avatarId: 'avatar-1', voiceId });

assert.equal(outbound.nodes.find((node) => node.id === 'elevenlabs-1')?.data?.taskConfig?.voiceId, voiceId);
assert.equal(inbound.nodes.find((node) => node.id === 'elevenlabs-tts')?.data?.taskConfig?.voiceId, voiceId);
assert.equal(
  buildAvatarOutboundGraph({ agentId: 'trainer' }).nodes.find((node) => node.id === 'elevenlabs-1')?.data?.taskConfig?.voiceId,
  '21m00Tcm4TlvDq8ikWAM'
);

console.log('Avatar voice configuration checks passed.');
