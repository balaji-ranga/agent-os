import assert from 'node:assert/strict';
import { isUsableAvatarMediaUrl, parseMediaIntents } from '../src/services/agent-workflow-model3d.js';

assert.equal(isUsableAvatarMediaUrl('<image_url_here>'), false);
assert.equal(isUsableAvatarMediaUrl('https://example.com/image-placeholder.png'), false);
assert.equal(isUsableAvatarMediaUrl('/api/media/artifacts/mda_123/download'), true);
assert.equal(isUsableAvatarMediaUrl('MEDIA:/root/.openclaw/media/generated/biryani.png'), true);

const biryani = parseMediaIntents('Please create a biryani image and show it beside the avatar.');
assert.equal(biryani.images.length, 1);
assert.match(biryani.images[0], /biryani/i);

console.log('Avatar media fallback checks passed.');
