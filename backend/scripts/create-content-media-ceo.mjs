/**
 * Create (or reuse) Content Media Day-1 test CEO.
 */
import { getDb } from '../src/db/schema.js';
import { registerCeoUser, getUserById } from '../src/services/users.js';
import { createSession } from '../src/services/auth/session.js';

const email = process.env.CM_EMAIL || 'content.media.d1@example.com';
const password = process.env.CM_PASS || 'ContentMedia-D1-Test2026!';
const name = process.env.CM_NAME || 'Content Media CEO';

const db = getDb();
const existing = db
  .prepare('SELECT id, email, name, enabled FROM platform_users WHERE lower(email) = lower(?)')
  .get(email);

let user;
let created = false;
if (existing) {
  user = getUserById(existing.id);
} else {
  user = await registerCeoUser({
    accept_terms: true,
    email,
    password,
    name,
    region: 'global',
    mobile: '',
    industry: 'personal',
    business_name: '',
    ceo_db_mode: 'tenant',
  });
  created = true;
}

const uid = user.id;
const u = getUserById(uid);
createSession(uid);

console.log(JSON.stringify({
  ok: true,
  created,
  user: { id: u.id, email: u.email, name: u.name, role: u.role, enabled: u.enabled },
  password,
  login: 'https://login.flolah.cloud/login',
  paths: { company_setup: '/company-setup', company_operate: '/company-operate' },
  note: 'In company setup choose Content Creator (Social media). Then Company Operate for Day0/Day1. Use loop editor on Proposed model.',
}, null, 2));
