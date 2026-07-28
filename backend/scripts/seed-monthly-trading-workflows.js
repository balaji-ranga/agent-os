/**
 * Seed all Monthly Positive Return trading workflows (W1, W2, W3, W5).
 * Usage: node scripts/seed-monthly-trading-workflows.js
 */
import { config } from 'dotenv';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: join(__dirname, '..', '.env') });

import { getBalaCeoAuthId } from '../src/services/job-applicant-ceo.js';
import { seedMonthlyTradingW1, WORKFLOW_ID as W1 } from './seed-monthly-trading-w1-workflow.js';
import { seedMonthlyTradingW2, WORKFLOW_ID as W2 } from './seed-monthly-trading-w2-workflow.js';
import { seedMonthlyTradingW3, WORKFLOW_ID as W3 } from './seed-monthly-trading-w3-workflow.js';
import { seedMonthlyTradingW5, WORKFLOW_ID as W5 } from './seed-monthly-trading-w5-workflow.js';

export async function seedAllMonthlyTradingWorkflows(ownerUserId, { publish = true } = {}) {
  const w1 = await seedMonthlyTradingW1(ownerUserId, { publish });
  const w2 = await seedMonthlyTradingW2(ownerUserId, { publish });
  const w3 = await seedMonthlyTradingW3(ownerUserId, { publish });
  const w5 = await seedMonthlyTradingW5(ownerUserId, { publish });
  return {
    ids: [W1, W2, W3, W5],
    results: { w1, w2, w3, w5 },
  };
}

async function main() {
  const owner = getBalaCeoAuthId();
  console.log('Seeding monthly trading workflows for', owner);
  const { ids, results } = await seedAllMonthlyTradingWorkflows(owner, { publish: true });
  for (const id of ids) {
    const key = id.includes('w1')
      ? 'w1'
      : id.includes('w2')
        ? 'w2'
        : id.includes('w3')
          ? 'w3'
          : 'w5';
    const def = results[key]?.def;
    console.log('-', id, def?.status || 'unknown');
  }
  console.log('Done. Chat phrase (W1): run monthly trading review');
}

const isCli =
  process.argv[1] &&
  (process.argv[1].includes('seed-monthly-trading-workflows') ||
    import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/')));
if (isCli) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}