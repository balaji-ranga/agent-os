/** @deprecated Prefer JSON packs via registry. */
import { getBlueprint, listCompanyTypeCards } from './registry.js';
export const thinBlueprints = {
  general_ops: getBlueprint('general_ops'),
  talent: getBlueprint('talent'),
  trading_ops: getBlueprint('trading_ops'),
  saas: getBlueprint('saas'),
  blank: getBlueprint('blank'),
};
export const COMPANY_TYPE_CARDS = listCompanyTypeCards();