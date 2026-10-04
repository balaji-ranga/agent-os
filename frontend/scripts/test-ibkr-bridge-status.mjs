import assert from 'node:assert/strict';
import { selectActiveBridge } from '../src/utils/selectActiveBridge.js';

const online = { bridge_id: 'active', effective_status: 'online', last_seen_at: '2026-10-04T06:34:00Z' };
const newerOffline = { bridge_id: 'newer-offline', effective_status: 'offline', last_seen_at: '2026-10-04T06:35:00Z' };
const olderOffline = { bridge_id: 'older-offline', effective_status: 'offline', last_seen_at: '2026-10-03T14:47:00Z' };

assert.equal(selectActiveBridge([newerOffline, online, olderOffline])?.bridge_id, 'active');
assert.equal(selectActiveBridge([olderOffline, newerOffline])?.bridge_id, 'newer-offline');
assert.equal(selectActiveBridge([{ ...online, revoked_at: '2026-10-04T06:36:00Z' }, newerOffline])?.bridge_id, 'newer-offline');
assert.equal(selectActiveBridge([]), null);

console.log('IBKRNew active bridge status tests passed');
