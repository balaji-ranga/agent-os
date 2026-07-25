/**
 * Unit checks for intent-classifier AGENTS.md parsing (leaf member keys + header junk).
 *
 * Usage: node backend/scripts/test-intent-agents-md-parse.js
 */
import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { parseAgentsFromAgentsMd } from '../src/services/intent-classifier.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

let failures = 0;
function check(label, ok, extra = '') {
  console.log(`${ok ? '  OK  ' : ' FAIL '} ${label}${extra ? ` — ${extra}` : ''}`);
  if (!ok) failures += 1;
}

const fixture = `# AGENTS — Operating contract (COO / BalServe)

## Other agents you can communicate with

| Agent ID | Name | Department | Role |
|----------|------|------------|------|
| **techresearcher** | TechResearcher | Research | Research (AI & tech); reports to you |

## External / A2A agents you can delegate to (leaf members)

| Member key | Name | Department | Purpose |
|------------|------|------------|---------|
| \`ext:a2a-live-ops-echo\` | Ops Echo Service | Operations | Ops echo / operations status desk. |
| \`a2a:wf-a2a-patent-prior-art-checker-6303c2\` | Patent Prior-Art Checker | Research | Patent prior-art search. |
`;

const agents = parseAgentsFromAgentsMd(fixture);
const ids = agents.map((a) => a.id);

check('parses internal agent without bold markdown', ids.includes('techresearcher'));
check('parses external leaf without backticks', ids.includes('ext:a2a-live-ops-echo'));
check('parses a2a leaf without backticks', ids.includes('a2a:wf-a2a-patent-prior-art-checker-6303c2'));
check('does not invent a "member key" header agent', !ids.includes('member key'));
check('does not invent an "agent id" header agent', !ids.includes('agent id'));
check('returns exactly 3 agents', agents.length === 3, `got ${agents.length}: ${ids.join(',')}`);

const tpl = readFileSync(
  join(__dirname, '..', '..', 'openclaw-workspace-templates', 'balserve', 'AGENTS.md'),
  'utf8'
);
const tplAgents = parseAgentsFromAgentsMd(tpl);
check('template still yields techresearcher', tplAgents.some((a) => a.id === 'techresearcher'));
check('template has no leaf-style junk ids', !tplAgents.some((a) => a.id === 'member key'));

console.log(failures === 0 ? '\nAll checks passed.' : `\n${failures} check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
