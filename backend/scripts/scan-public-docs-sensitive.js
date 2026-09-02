/**
 * Fail closed before publishing public docs when source contains likely live
 * credentials, broker account identifiers, or private deployment details.
 * Prints finding labels and filenames only; never prints matched values.
 *
 * Usage: node backend/scripts/scan-public-docs-sensitive.js
 */
import { readdirSync, readFileSync } from 'fs';
import { extname, join, relative, resolve } from 'path';
import { fileURLToPath } from 'url';
import { findResidualLiveSecrets } from '../src/services/company-blueprints/secret-sanitize.js';

const repoRoot = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const docsRoot = join(repoRoot, 'docs-site');
const roots = [
  join(docsRoot, 'docs'),
  join(docsRoot, 'blog'),
  join(docsRoot, 'blog-pages'),
];
const topLevelFiles = [
  join(docsRoot, 'docusaurus.config.js'),
  join(docsRoot, 'docusaurus.blog.config.js'),
  join(docsRoot, 'sidebars.js'),
];

function walk(dir, files = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) walk(path, files);
    else if (['.md', '.mdx', '.js'].includes(extname(path).toLowerCase())) files.push(path);
  }
  return files;
}

const checks = [
  ['private-key', /-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/i],
  ['authorization-bearer', /authorization\s*:\s*bearer\s+[A-Za-z0-9._~+\/-]{12,}/i],
  ['secret-env-assignment', /(?:^|\n)\s*(?:[A-Z0-9_]*(?:TOKEN|PASSWORD|SECRET|API_KEY|PRIVATE_KEY)[A-Z0-9_]*)\s*=\s*[^\s<{][^\r\n]{7,}/i],
  ['ibkr-account-id', /(?:^|[^A-Z0-9])(?:DU|U)\d{6,}(?:[^A-Z0-9]|$)/i],
  ['private-ipv4', /(?:^|[^0-9])(?:10\.\d{1,3}\.\d{1,3}\.\d{1,3}|192\.168\.\d{1,3}\.\d{1,3}|172\.(?:1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3})(?:[^0-9]|$)/],
  ['credential-url', /https?:\/\/[^\s/:]+:[^\s/@]+@/i],
  ['root-ssh-target', /\broot@(?:[A-Za-z0-9.-]+|\d{1,3}(?:\.\d{1,3}){3})\b/i],
  ['private-server-path', /(?:^|[\s`"'])\/opt\/[A-Za-z0-9._/-]+/i],
];

const files = [...roots.flatMap((root) => walk(root)), ...topLevelFiles];
const failures = [];
for (const file of files) {
  const text = readFileSync(file, 'utf8');
  const findings = new Set(findResidualLiveSecrets(text));
  for (const [label, pattern] of checks) if (pattern.test(text)) findings.add(label);
  if (findings.size) {
    failures.push({
      file: relative(repoRoot, file).replace(/\\/g, '/'),
      findings: [...findings],
    });
  }
}

if (failures.length) {
  console.error('PUBLIC_DOCS_SENSITIVE_SCAN_FAILED');
  for (const failure of failures) console.error(`  ${failure.file}: ${failure.findings.join(',')}`);
  process.exit(1);
}

console.log(`OK public docs sensitive scan files=${files.length}`);
