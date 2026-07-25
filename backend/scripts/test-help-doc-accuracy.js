/**
 * Regression: the Platform Help corpus must answer known-ambiguous questions unambiguously.
 *
 * Each case RAG-queries the CEO's Master Data help docs and asserts the retrieved chunks contain
 * the corrected wording (and, where relevant, do not contain the misleading phrasing that made
 * agents quote the wrong number).
 *
 * Usage: node backend/scripts/test-help-doc-accuracy.js [ownerUserId]
 */
import { initDb } from '../src/db/schema.js';
import * as md from '../src/services/master-data.js';

const owner = process.argv[2] || process.env.HELP_TEST_OWNER || 'ceo-bala';

const CASES = [
  {
    label: 'learnings_summary lookback is 30 days (not the 7-day rebuild cadence)',
    query: 'learnings summary how many days of feedback lookback window',
    mustInclude: ['30'],
    mustIncludeAny: ['lookback', 'Lookback'],
  },
  {
    label: 'master_data_rag summarize default is path-specific',
    query: 'master_data_rag summarize default true or false agent tool versus workflow node',
    mustIncludeAny: ['agent tool', 'Agent tool'],
  },
  {
    label: 'data retention default is 90 days',
    query: 'data persistence retention days default value profile',
    mustInclude: ['90'],
  },
  {
    label: 'Kanban dates use the platform timezone',
    query: 'Kanban dates timezone UTC platform timezone board',
    mustIncludeAny: ['platform timezone', 'PLATFORM_TIMEZONE'],
  },
  {
    label: 'Kanban activity survives an archived agent chat',
    query: 'Kanban card blank after agent chat archived activity',
    mustIncludeAny: ['archiv'],
  },
];

let failures = 0;

async function main() {
  initDb();
  console.log(`[help-accuracy] owner=${owner}`);
  for (const c of CASES) {
    // eslint-disable-next-line no-await-in-loop
    const res = await md.ragDocuments(owner, { query: c.query, topK: 6, summarize: false });
    const text = (res?.chunks || []).map((ch) => ch.content).join('\n');
    const missing = (c.mustInclude || []).filter((s) => !text.includes(s));
    const anyOk = !c.mustIncludeAny || c.mustIncludeAny.some((s) => text.includes(s));
    const ok = text.length > 0 && missing.length === 0 && anyOk;
    if (!ok) failures += 1;
    console.log(
      `${ok ? '  OK  ' : ' FAIL '} ${c.label} — hits=${res?.hit_count ?? 0}` +
        (missing.length ? ` missing=${missing.join(',')}` : '') +
        (anyOk ? '' : ` missing_any_of=${c.mustIncludeAny.join('|')}`)
    );
  }
  console.log(failures ? `[help-accuracy] ${failures} case(s) failed` : '[help-accuracy] all cases passed');
  process.exit(failures ? 1 : 0);
}

main().catch((e) => {
  console.error('[help-accuracy] error:', e?.message || e);
  process.exit(2);
});
