/**
 * Owner-scoped CRM company create used by content-tool routes and missions.
 * Routes Twenty vs ERPNext from the company's profile. Never trusts a body ceo_user_id.
 */
import { assertCrmEntitled } from './company-business-profile.js';
import { crmCreateCompany } from './twenty-crm.js';
import { isErpnextCrmOwner, erpCrmCreateCompany } from './erpnext-crm-facade.js';

export async function createCompanyForOwner(ownerUserId, { name, domainUrl, website, employees } = {}) {
  const owner = String(ownerUserId || '').trim();
  if (!owner) {
    const err = new Error('owner_user_id required');
    err.status = 400;
    throw err;
  }
  assertCrmEntitled(owner);
  const site = String(domainUrl || website || '').trim();
  if (isErpnextCrmOwner(owner)) {
    return erpCrmCreateCompany(owner, { name, domainUrl: site });
  }
  return crmCreateCompany(owner, { name, domainUrl: site, employees });
}
