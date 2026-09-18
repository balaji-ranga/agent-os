import assert from 'node:assert/strict';
import { findSceneSpawn, resolveAvatarSpawn } from '../src/utils/virtualRoomPlacement.js';

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

