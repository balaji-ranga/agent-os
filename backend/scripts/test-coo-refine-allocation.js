/**
 * Mixed internal + leaf allocation must keep both after refine
 * (Session-keys table must not wipe internal purposes).
 *
 * Usage: node backend/scripts/test-coo-refine-allocation.js
 */
import assert from 'assert';
import { refineAllocationAgainstAgentsMd } from '../src/services/coo-specialty-delegation.js';

const fixture = `# AGENTS — Operating contract

## Other agents you can communicate with

| Agent ID | Name | Department | Role |
|----------|------|------------|------|
| **techresearcher** | TechResearcher | Research | Research (AI & tech); reports to you |
| **socialasstant** | SocialAssistant | Social | Agent |
| **financeagent** | Finance | Finance | Expense tracking and budgets |

## External / A2A agents you can delegate to (leaf members)

| Member key | Name | Department | Purpose |
|------------|------|------------|---------|
| \`a2a:ops-status-desk\` | Ops Status Desk | Operations | Ops echo / operations status desk. |

## Session keys (for sessions_send)

| Agent ID | Session key |
|----------|-------------|
| **techresearcher** | \`agent::ceo-bala:techresearcher:main\` |
| **socialasstant** | \`agent::ceo-bala:socialasstant:main\` |
`;

const mixed = refineAllocationAgainstAgentsMd(
  {
    techresearcher: 'Deep research on SpaceX',
    'a2a:ops-status-desk': 'Operations status desk check',
  },
  fixture
);

assert.ok(mixed.techresearcher, 'keeps internal techresearcher in mixed allocation');
assert.ok(mixed['a2a:ops-status-desk'], 'keeps external a2a leaf in mixed allocation');
assert.strictEqual(Object.keys(mixed).length, 2, 'keeps both intents');

const dualInternal = refineAllocationAgainstAgentsMd(
  {
    techresearcher: 'Research SpaceX',
    financeagent: 'Budget impact',
  },
  fixture
);
assert.ok(dualInternal.techresearcher, 'keeps first specific internal');
assert.ok(dualInternal.financeagent, 'keeps second specific internal (dual-internal)');

const dropVague = refineAllocationAgainstAgentsMd(
  {
    techresearcher: 'Research SpaceX',
    socialasstant: 'Post about it',
  },
  fixture
);
assert.ok(dropVague.techresearcher, 'keeps specific internal');
assert.ok(!dropVague.socialasstant, 'drops vague-purpose peer when specific exists');

const allVague = refineAllocationAgainstAgentsMd(
  { socialasstant: 'Do something' },
  fixture
);
assert.ok(allVague.socialasstant, 'fallback keeps entry when only vague purposes');

console.log('PASS: refineAllocationAgainstAgentsMd mixed internal+leaf');
