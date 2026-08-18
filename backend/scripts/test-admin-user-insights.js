/**
 * Admin User Insights smoke: fixture CEOs + employee, then assert today/week/inactive KPIs.
 * Cleans up rows it created. Does not require a running HTTP server.
 *
 *   node backend/scripts/test-admin-user-insights.js
 */
import { config } from 'dotenv';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { randomBytes } from 'crypto';

const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: join(__dirname, '..', '.env') });

import { initDb, getDb } from '../src/db/schema.js';
import { hashPassword } from '../src/services/auth/password.js';
import {
  getAdminUserInsights,
  INSIGHTS_EXCLUDE_NAME_PREFIXES,
} from '../src/services/admin-user-insights.js';

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

function utcSql(msOffset = 0) {
  return new Date(Date.now() + msOffset).toISOString().slice(0, 19).replace('T', ' ');
}

initDb();
const db = getDb();
const stamp = Date.now();
const pwd = hashPassword(randomBytes(16).toString('hex'));
const ids = {
  today: `ceo-ins-today-${stamp}`,
  inactive: `ceo-ins-idle-${stamp}`,
  employee: `usr-ins-emp-${stamp}`,
  testNoise: `ceo-ins-sr-${stamp}`,
};

const ins = db.prepare(
  `INSERT INTO platform_users
    (id, email, password_hash, name, role, enabled, created_at, last_login_at, industry, business_name)
   VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?, ?)`
);

ins.run(
  ids.today,
  `ins-today-${stamp}@example.invalid`,
  pwd,
  `Insights Fixture Today ${stamp}`,
  'ceo',
  utcSql(),
  utcSql(),
  'saas',
  'Insights Co'
);

ins.run(
  ids.inactive,
  `ins-idle-${stamp}@example.invalid`,
  pwd,
  `Insights Fixture Idle ${stamp}`,
  'ceo',
  utcSql(-20 * 24 * 60 * 60 * 1000),
  utcSql(-10 * 24 * 60 * 60 * 1000),
  'saas',
  'Idle Co'
);

db.prepare(
  `INSERT INTO platform_users
    (id, email, password_hash, name, role, enabled, owner_user_id, created_at, last_login_at)
   VALUES (?, ?, ?, ?, 'org_user', 1, ?, ?, ?)`
).run(
  ids.employee,
  `ins-emp-${stamp}@example.invalid`,
  pwd,
  `Insights Fixture Employee ${stamp}`,
  ids.today,
  utcSql(),
  utcSql()
);

ins.run(
  ids.testNoise,
  `ins-sr-${stamp}@example.invalid`,
  pwd,
  `SR Import ${stamp} leftover`,
  'ceo',
  utcSql(),
  utcSql(),
  'saas',
  'Noise'
);

let passed = 0;
try {
  const data = getAdminUserInsights();
  assert(data.timezone === 'UTC', 'timezone UTC');
  passed += 1;
  assert(data.inactive_after_days === 7, 'inactive window 7d');
  passed += 1;
  assert(data.kpis.registered_today >= 2, 'today includes CEO + employee fixtures');
  passed += 1;
  assert(data.kpis.registered_this_week >= 2, 'week includes fixtures');
  passed += 1;
  assert(data.kpis.inactive_7d >= 1, 'idle CEO counted');
  passed += 1;
  assert(data.companies.registered_today >= 1, 'company registered today');
  passed += 1;
  assert(data.employees.invited_today >= 1, 'employee invited today');
  passed += 1;
  assert(
    !data.newest.some((u) => u.id === ids.testNoise),
    'SR Import prefix excluded from newest'
  );
  passed += 1;
  assert(
    data.inactive.some((u) => u.id === ids.inactive),
    'idle CEO listed'
  );
  passed += 1;
  assert(
    INSIGHTS_EXCLUDE_NAME_PREFIXES.includes('SR Import') &&
      INSIGHTS_EXCLUDE_NAME_PREFIXES.includes('Connector Test'),
    'exclude prefixes listed'
  );
  passed += 1;
  console.log(
    JSON.stringify(
      {
        ok: true,
        passed,
        kpis: data.kpis,
        companies_today: data.companies.registered_today,
        employees_today: data.employees.invited_today,
      },
      null,
      2
    )
  );
} finally {
  const del = db.prepare('DELETE FROM platform_users WHERE id = ?');
  for (const id of Object.values(ids)) del.run(id);
}
