import assert from 'node:assert/strict';
import { findSceneSpawn, resolveAvatarSpawn } from '../src/utils/virtualRoomPlacement.js';
import { animationOnlyPlayback, ttsPlaybackFromSteps } from '../src/utils/virtualRoomPlayback.js';

const member = { avatar_id: 'avatar-1', handle: 'trainer', position: { x: -0.7, y: 0, z: 0 } };
assert.deepEqual(
  findSceneSpawn({ spawnPoints: [{ handle: 'trainer', position: [3, 0.2, -1] }] }, member, 0),
  { x: 3, y: 0.2, z: -1 }
);
assert.deepEqual(
  resolveAvatarSpawn({ member, hasEnvironment: true }),
  { x: 0, y: 0, z: 2.2, source: 'safe-scene-default' },
  'legacy origin layout must move in front of imported geometry'
);
assert.deepEqual(
  resolveAvatarSpawn({ member: { ...member, position: { x: 1, y: 0, z: -2, manual: true } }, hasEnvironment: true }),
  { x: 1, y: 0, z: -2, source: 'saved' },
  'manual room placement must survive reload'
);
assert.equal(
  resolveAvatarSpawn({ member, sceneJson: { spawnPoints: [{ avatarId: 'avatar-1', position: { x: 4, y: 0, z: 5 } }] }, hasEnvironment: true }).source,
  'scene',
  'scene metadata has highest priority'
);
console.log('Virtual Room placement checks passed.');

const directTts = ttsPlaybackFromSteps(
  [
    { node_type: 'agent', status: 'completed', output: { text: 'Hello and welcome.' } },
    { node_type: 'elevenlabs', status: 'completed', output: { audio: { artifactId: 'a1', url: '/audio/a1' } } },
  ],
  'avatar-1',
  ['HumanArmature|Man_Clapping', 'HumanArmature|Man_Idle']
);
assert.equal(directTts.audioUrl, '/audio/a1');
assert.equal(directTts.avatarId, 'avatar-1');
assert.equal(directTts.idle, 'HumanArmature|Man_Idle');
assert.deepEqual(directTts.animations, [], 'early speech must not guess a gesture before the planner finishes');
assert.equal(animationOnlyPlayback({ audioUrl: '/audio/a1', animations: [{ name: 'Wave' }] }, true).audioUrl, null);
assert.equal(animationOnlyPlayback({ audioUrl: '/audio/a1' }, false).audioUrl, '/audio/a1');

console.log('Virtual Room early playback checks passed.');
