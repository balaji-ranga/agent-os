/**
 * Smoke: legal acceptance on register (DB columns + public API rules).
 * Usage: node scripts/test-legal-register-accept.js
 */
import { initDb, getDb } from "../src/db/schema.js";
import { registerCeoUser, getUserById } from "../src/services/users.js";
import {
  currentTermsVersion,
  currentPrivacyVersion,
  assertTermsAcceptedAtRegister,
} from "../src/services/legal-terms.js";

initDb();

let failed = 0;
function assert(cond, msg) {
  if (!cond) {
    console.error("FAIL:", msg);
    failed += 1;
  } else {
    console.log("OK:", msg);
  }
}

try {
  assertTermsAcceptedAtRegister({}, { requireAccept: true });
  assert(false, "should reject missing accept");
} catch (e) {
  assert(e.status === 400 || /must accept/i.test(e.message), "reject missing accept: " + e.message);
}

try {
  assertTermsAcceptedAtRegister({ accept_terms: true, terms_version: "1999-01-01" }, { requireAccept: true });
  assert(false, "should reject terms version mismatch");
} catch (e) {
  assert(/mismatch/i.test(e.message), "version mismatch: " + e.message);
}

const stamp = Date.now().toString(36);
const email = `legal.accept.${stamp}@test.local`;
const user = await registerCeoUser({
  accept_terms: true,
  terms_version: currentTermsVersion(),
  privacy_version: currentPrivacyVersion(),
  email,
  password: "LegalTest1!",
  name: "Legal Accept Test",
  industry: "personal",
  mfa_policy: "off",
});
assert(!!user.terms_accepted_at, "terms_accepted_at set on returned user");
assert(user.terms_version === currentTermsVersion(), "terms_version stored");
assert(user.privacy_version === currentPrivacyVersion(), "privacy_version stored");

const row = getDb().prepare("SELECT terms_accepted_at, terms_version, privacy_version FROM platform_users WHERE id = ?").get(user.id);
assert(!!row && !!row.terms_accepted_at, "DB terms_accepted_at");
assert(row.terms_version === currentTermsVersion(), "DB terms_version");

const pub = getUserById(user.id);
assert(!!pub.terms_accepted_at && pub.terms_version === currentTermsVersion(), "userPublic exposes terms");

try {
  await registerCeoUser({
    email: `legal.noaccept.${stamp}@test.local`,
    password: "LegalTest1!",
    name: "No Accept",
    industry: "personal",
    require_terms_accept: true,
  });
  assert(false, "register without accept should throw");
} catch (e) {
  assert(/must accept/i.test(e.message), "register without accept throws: " + e.message);
}

const adminCreated = await registerCeoUser({
  email: `legal.admincreate.${stamp}@test.local`,
  password: "LegalTest1!",
  name: "Admin Create",
  industry: "personal",
  require_terms_accept: false,
});
assert(adminCreated.terms_accepted_at == null, "admin-created may skip acceptance");

if (failed) {
  console.error(`\n${failed} failure(s)`);
  process.exit(1);
}
console.log("\nAll legal-register checks passed");