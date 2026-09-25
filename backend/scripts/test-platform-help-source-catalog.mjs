import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  PLATFORM_HELP_DOCUMENTS,
  resolvePublicDocsDir,
} from '../src/services/ceo-default-master-data.js';
import { listPublicGuideSources } from '../src/services/opensearch/platform-docs.js';

const publicDir = resolvePublicDocsDir();
assert(publicDir, 'public docs source must resolve');

const sources = listPublicGuideSources();
assert(sources.length >= 40, `expected the complete public guide, got ${sources.length} documents`);
assert.equal(new Set(sources.map((item) => item.filename)).size, sources.length, 'public guide filenames must be unique');
assert(
  sources.some((item) => item.filename === 'public-guide-systems--social-publishing.md'),
  'social publishing public guide must be indexed'
);
assert(
  PLATFORM_HELP_DOCUMENTS.some((item) => item.filename === '55-social-publishing-facebook-linkedin.md'),
  'curated social publishing help must be catalogued'
);

const dockerfile = readFileSync(
  fileURLToPath(new URL('../../deploy/docker/backend.Dockerfile', import.meta.url)),
  'utf8'
);
assert(dockerfile.includes('COPY docs-site/docs ./docs-site/docs'), 'backend image must contain public docs source');

console.log(`PASS Platform Help sources curated=${PLATFORM_HELP_DOCUMENTS.length} public=${sources.length}`);
