/**
 * Unit checks: blueprint publish must strip live OpenAI / Brevo / SMTP credentials.
 * Run: node backend/scripts/test-blueprint-secret-sanitize.js
 */
import assert from 'assert';
import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import {
  sanitizeBlueprintSecrets,
  cloneAndSanitizeBlueprint,
  findResidualLiveSecrets,
  looksLikeLiveSecret,
} from '../src/services/company-blueprints/secret-sanitize.js';

const FAKE_OPENAI = 'sk-proj-EXAMPLEKEYNOTREAL000000000000';
const FAKE_BREVO_SMTP = 'xsmtpsib-EXAMPLE-NOT-A-REAL-KEY';
const FAKE_BREVO_API = 'xkeysib-EXAMPLE-NOT-A-REAL-KEY';
const FAKE_DEEPSEEK = 'sk-' + 'f'.repeat(32);

assert.equal(looksLikeLiveSecret(FAKE_OPENAI), true);
assert.equal(looksLikeLiveSecret(FAKE_BREVO_SMTP), true);
assert.equal(looksLikeLiveSecret(FAKE_BREVO_API), true);
assert.equal(looksLikeLiveSecret(FAKE_DEEPSEEK), true);
assert.equal(looksLikeLiveSecret('{{var.smtp_pass}}'), false);
assert.equal(looksLikeLiveSecret(''), false);

const dirty = {
  nodes: [
    {
      data: {
        taskConfig: {
          useEnvSmtp: true,
          smtpUser: 'account@smtp-brevo.com',
          smtpPass: FAKE_BREVO_SMTP,
          apiKey: FAKE_OPENAI,
          apiKeyRef: 'openAI_key',
        },
      },
    },
  ],
  note: `inline ${FAKE_BREVO_API} and ${FAKE_DEEPSEEK}`,
};

const { value: clean, stats } = cloneAndSanitizeBlueprint(dirty);
assert.ok(stats.cleared >= 3, `expected clears, got ${stats.cleared}`);
assert.equal(clean.nodes[0].data.taskConfig.smtpPass, '');
assert.equal(clean.nodes[0].data.taskConfig.smtpUser, '');
assert.equal(clean.nodes[0].data.taskConfig.apiKey, '');
assert.equal(clean.nodes[0].data.taskConfig.apiKeyRef, 'openAI_key');
assert.doesNotMatch(JSON.stringify(clean), /xsmtpsib-/);
assert.doesNotMatch(JSON.stringify(clean), /xkeysib-/);
assert.doesNotMatch(JSON.stringify(clean), /sk-proj-/);
const residual = findResidualLiveSecrets(clean);
assert.deepEqual(residual, [], residual.join(','));

const here = dirname(fileURLToPath(import.meta.url));
const packPath = join(here, '../src/services/company-blueprints/packs/demo_balaji_ranganathan.json');
const pack = JSON.parse(readFileSync(packPath, 'utf8'));
const packResidual = findResidualLiveSecrets(pack);
assert.deepEqual(packResidual, [], `demo pack residual: ${packResidual.join(',')}`);
const packTxt = JSON.stringify(pack);
assert.doesNotMatch(packTxt, /xsmtpsib-/i);
assert.doesNotMatch(packTxt, /sk-proj-/);
assert.doesNotMatch(packTxt, /@smtp-brevo\.com/);

sanitizeBlueprintSecrets(pack);
assert.deepEqual(findResidualLiveSecrets(pack), []);

console.log('OK blueprint secret sanitize unit checks');
