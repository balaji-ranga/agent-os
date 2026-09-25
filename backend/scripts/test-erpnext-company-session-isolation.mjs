import assert from 'node:assert/strict';
import {
  ERPNEXT_CRM_LANDING_PATH,
  ERPNEXT_ERP_LANDING_PATH,
} from '../src/services/business-embed.js';
import {
  normalizeErpDeskRedirectPath,
  planCompanyPermissionReconciliation,
} from '../src/services/erpnext-sso.js';

assert.equal(ERPNEXT_CRM_LANDING_PATH, '/app/opportunity/view/list');
assert.equal(ERPNEXT_ERP_LANDING_PATH, '/app/sales-invoice/view/list');

const alreadyScoped = planCompanyPermissionReconciliation([
  { name: 'up-northstar', for_value: 'Northstar', is_default: 1, apply_to_all_doctypes: 1 },
], 'Northstar');
assert.equal(alreadyScoped.target.name, 'up-northstar');
assert.deepEqual(alreadyScoped.update, {});
assert.deepEqual(alreadyScoped.stale, []);

const staleDefault = planCompanyPermissionReconciliation([
  { name: 'up-old', for_value: 'Old Demo Co', is_default: 1, apply_to_all_doctypes: 1 },
  { name: 'up-northstar', for_value: 'Northstar', is_default: 0, apply_to_all_doctypes: 0 },
], 'Northstar');
assert.equal(staleDefault.target.name, 'up-northstar');
assert.deepEqual(staleDefault.update, { is_default: 1, apply_to_all_doctypes: 1 });
assert.deepEqual(staleDefault.stale.map((row) => row.name), ['up-old']);

const renamed = planCompanyPermissionReconciliation([
  { name: 'up-existing', for_value: 'Previous Name', is_default: 0, apply_to_all_doctypes: 0 },
], 'Northstar');
assert.deepEqual(renamed.update, {
  for_value: 'Northstar',
  is_default: 1,
  apply_to_all_doctypes: 1,
});

assert.equal(normalizeErpDeskRedirectPath('app/opportunity/view/list'), '/app/opportunity/view/list');
assert.equal(normalizeErpDeskRedirectPath('/app/opportunity/view/list'), '/app/opportunity/view/list');
assert.doesNotMatch(normalizeErpDeskRedirectPath('/app/opportunity/view/list'), /[?&]company=/);

console.log(JSON.stringify({ ok: true, cases: 4 }));
