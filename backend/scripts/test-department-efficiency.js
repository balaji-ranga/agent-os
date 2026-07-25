/**
 * Smoke: department efficiency rollup returns departments with token totals.
 * Usage: node backend/scripts/test-department-efficiency.js [ownerUserId]
 */
import { initDb } from '../src/db/schema.js';
import { getDepartmentEfficiency } from '../src/services/department-efficiency.js';

const OWNER = process.argv[2] || process.env.TEST_OWNER || 'ceo-bala';

initDb();

let failures = 0;
function check(label, ok, extra = '') {
  console.log(`${ok ? '  OK  ' : ' FAIL '} ${label}${extra ? ` — ${extra}` : ''}`);
  if (!ok) failures += 1;
}

const out = getDepartmentEfficiency(OWNER);
check('returns period YYYY-MM', /^\d{4}-\d{2}$/.test(out.period), out.period);
check('returns departments array', Array.isArray(out.departments));
check('has at least one department', out.departments.length > 0, `n=${out.departments.length}`);
check('totals.departments matches list', out.totals.departments === out.departments.length);

const withMembers = out.departments.filter((d) => d.member_count > 0);
if (withMembers.length) {
  const d = withMembers[0];
  const sum = d.members.reduce((s, m) => s + (m.tokens_used || 0), 0);
  check(
    `member token sum matches department (${d.name})`,
    sum === d.tokens_used,
    `sum=${sum} dept=${d.tokens_used}`
  );
} else {
  console.log('  skip member-sum check (no assigned members)');
}

console.log(
  `\nSample: ${out.departments
    .slice(0, 5)
    .map(
      (d) =>
        `${d.name}: ${d.tokens_used}/${d.monthly_token_budget ?? '∞'} (${d.member_count} members, ${d.state})`
    )
    .join(' | ')}`
);

console.log(failures === 0 ? '\nAll checks passed.' : `\n${failures} check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
