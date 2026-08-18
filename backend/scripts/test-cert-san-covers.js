/**
 * Unit: CRM workspace host vs Let's Encrypt SAN matching.
 *
 *   node backend/scripts/test-cert-san-covers.js
 */
import { certSanCoversHost } from '../src/services/tls-cert-admin.js';

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

const apex = 'crm.flolah.cloud';
const rajan = 'frajangupta5fea87dd.crm.flolah.cloud';
const bala = 'wise-mustard-elephant.crm.flolah.cloud';
const liveSans = [
  'crm.flolah.cloud',
  'erp.crm.flolah.cloud',
  'wise-mustard-elephant.crm.flolah.cloud',
  'login.flolah.cloud',
];

assert(certSanCoversHost(liveSans, bala) === true, 'exact SAN covers Balaji workspace');
assert(certSanCoversHost(liveSans, rajan) === false, 'apex crm.* must NOT cover Rajan workspace');
assert(certSanCoversHost(liveSans, apex) === true, 'apex matches itself');
assert(
  certSanCoversHost(['*.crm.flolah.cloud'], rajan) === true,
  'wildcard *.crm covers one workspace label'
);
assert(
  certSanCoversHost(['*.flolah.cloud'], rajan) === false,
  'wildcard *.flolah.cloud does not cover two extra labels'
);
assert(certSanCoversHost([], rajan) === false, 'empty SAN list');

console.log('PASS: cert SAN covers host');
