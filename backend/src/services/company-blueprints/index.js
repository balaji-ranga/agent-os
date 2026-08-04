/**
 * Company blueprint registry (Phase C).
 */
import contentCreatorBlueprint from './content-creator.js';
import { thinBlueprints, COMPANY_TYPE_CARDS } from './thin-packs.js';

const BY_ID = {
  content_creator: contentCreatorBlueprint,
  content_studio: contentCreatorBlueprint,
  youtube_creator: contentCreatorBlueprint,
  social_media: contentCreatorBlueprint,
  marketing_agency: contentCreatorBlueprint,
  ...thinBlueprints,
};

/** Resolve type card id → blueprint key (supports maps_to). */
export function resolveCompanyTypeId(raw) {
  const id = String(raw || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '_');
  if (!id) return 'general_ops';
  const card = COMPANY_TYPE_CARDS.find((c) => c.id === id);
  if (card?.maps_to) return card.maps_to;
  if (BY_ID[id]) return id;
  for (const [key, bp] of Object.entries(BY_ID)) {
    if ((bp.aliases || []).includes(id)) return bp.id || key;
  }
  return 'general_ops';
}

export function getBlueprint(companyType) {
  const key = resolveCompanyTypeId(companyType);
  return BY_ID[key] || thinBlueprints.general_ops;
}

export function listCompanyTypeCards() {
  return COMPANY_TYPE_CARDS.map((c) => ({
    ...c,
    description: getBlueprint(c.maps_to || c.id).description || '',
  }));
}

export function inferCompanyTypeFromText(text) {
  const t = String(text || '').toLowerCase();
  if (/content|video|studio|youtube|instagram|tiktok|facebook|social|creator|shorts|publish|media/.test(t)) {
    return 'content_creator';
  }
  if (/trad(e|ing)|ibkr|stock|portfolio|equity|crypto|invest/.test(t)) return 'trading_ops';
  if (/hiring|recruit|talent|job|applicant|hr|resume|cv/.test(t)) return 'talent';
  if (/saas|software|startup|product/.test(t)) return 'saas';
  if (/blank|empty|minimal|diy/.test(t)) return 'blank';
  return 'general_ops';
}

export function policyTextForStyle(blueprint, managementStyle) {
  const style = String(managementStyle || 'after_approval').trim();
  const templates = blueprint?.policy_templates || thinBlueprints.general_ops.policy_templates;
  return templates[style] || templates.after_approval || '';
}

export { COMPANY_TYPE_CARDS };

/** Deep flagship or named industry packs (not general_ops / blank / mapped thin). */
export function hasDedicatedCompanyTemplate(companyType) {
  const key = resolveCompanyTypeId(companyType);
  const bp = getBlueprint(key);
  if (bp?.depth === 'deep') return true;
  if (['content_creator', 'saas', 'talent', 'trading_ops'].includes(bp?.id || key)) return true;
  return false;
}

