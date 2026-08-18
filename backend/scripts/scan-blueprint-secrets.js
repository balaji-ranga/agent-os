/**
 * Scan committed company-blueprint JSON + export zips for live credentials.
 * Labels only — never prints secret values.
 *
 *   node backend/scripts/scan-blueprint-secrets.js
 *   node backend/scripts/scan-blueprint-secrets.js --strict
 */
import { readdirSync, readFileSync } from 'fs';
import { dirname, extname, join, relative } from 'path';
import { fileURLToPath } from 'url';
import { findResidualLiveSecrets } from '../src/services/company-blueprints/secret-sanitize.js';
import { listZipUtf8Entries } from '../src/services/zip-store.js';

const here = dirname(fileURLToPath(import.meta.url));
const ROOT = join(here, '../src/services/company-blueprints');
const EXTRA_PREFIXES = [
  /xsmtpsib-[A-Za-z0-9\-]{16,}/i,
  /xkeysib-[A-Za-z0-9\-]{16,}/i,
  /sk-proj-[A-Za-z0-9_\-]{20,}/,
];

function walk(dir, acc = []) {
  let entries = [];
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return acc;
  }
  for (const e of entries) {
    const p = join(dir, e.name);
    if (e.isDirectory()) walk(p, acc);
    else acc.push(p);
  }
  return acc;
}

function extraHits(text) {
  const kinds = [];
  if (EXTRA_PREFIXES[0].test(text)) kinds.push('brevo-smtp-prefix');
  if (EXTRA_PREFIXES[1].test(text)) kinds.push('brevo-api-prefix');
  if (EXTRA_PREFIXES[2].test(text) && !/sk-proj-EXAMPLE/i.test(text) && !/sk-proj-\.\.\./.test(text)) {
    kinds.push('sk-proj-prefix');
  }
  return kinds;
}

const files = walk(ROOT).filter((p) => {
  const ext = extname(p).toLowerCase();
  return ext === '.json' || ext === '.zip';
});

const failures = [];
for (const file of files) {
  const rel = relative(join(here, '../..'), file).replace(/\\/g, '/');
  const buf = readFileSync(file);
  if (extname(file).toLowerCase() === '.zip') {
    const entries = listZipUtf8Entries(buf);
    if (!entries.length) {
      failures.push({ file: rel, findings: ['zip-unreadable'] });
      continue;
    }
    for (const ent of entries) {
      const findings = [...findResidualLiveSecrets(ent.text), ...extraHits(ent.text)];
      if (findings.length) {
        failures.push({ file: `${rel}#${ent.name}`, findings: [...new Set(findings)] });
      }
    }
    continue;
  }
  const text = buf.toString('utf8');
  let parsed = text;
  try {
    parsed = JSON.parse(text);
  } catch {
    /* scan as text */
  }
  const findings = [...findResidualLiveSecrets(parsed), ...extraHits(text)];
  if (findings.length) failures.push({ file: rel, findings: [...new Set(findings)] });
}

if (failures.length) {
  console.error('BLUEPRINT_SECRET_SCAN_FAILED');
  for (const f of failures) {
    console.error(`  ${f.file}: ${f.findings.join(',')}`);
  }
  process.exit(1);
}

console.log(
  `OK blueprint secret scan files=${files.length} root=${relative(join(here, '../..'), ROOT).replace(/\\/g, '/')}`
);
