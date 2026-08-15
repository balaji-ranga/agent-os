/**
 * ISO 3166-1 (country) + ISO 3166-2 (subdivision) helpers.
 * Canonical storage: country = alpha-2 (SG), region = 3166-2 (US-CA) or empty.
 * Keep in sync with backend/src/lib/iso-country-region.js
 */
import { iso31661, iso31662 } from 'iso-3166';

const GLOBAL_TOKENS = new Set(['global', 'worldwide', 'international', 'n/a', 'na', 'none', '-']);

const COUNTRY_ALIASES = {
  usa: 'US',
  us: 'US',
  america: 'US',
  'united states': 'US',
  'united states of america': 'US',
  uk: 'GB',
  'u.k.': 'GB',
  'u.k': 'GB',
  britain: 'GB',
  'great britain': 'GB',
  'united kingdom': 'GB',
  england: 'GB',
  scotland: 'GB',
  wales: 'GB',
  uae: 'AE',
  'united arab emirates': 'AE',
  korea: 'KR',
  'south korea': 'KR',
  'republic of korea': 'KR',
  'north korea': 'KP',
  vietnam: 'VN',
  'viet nam': 'VN',
  russia: 'RU',
  'russian federation': 'RU',
  taiwan: 'TW',
  roc: 'TW',
  czechia: 'CZ',
  'czech republic': 'CZ',
  turkey: 'TR',
  turkiye: 'TR',
  türkiye: 'TR',
  palestine: 'PS',
  iran: 'IR',
  syria: 'SY',
  venezuela: 'VE',
  bolivia: 'BO',
  tanzania: 'TZ',
  moldova: 'MD',
  laos: 'LA',
  brunei: 'BN',
  'hong kong': 'HK',
  'hong kong sar': 'HK',
  macau: 'MO',
  macao: 'MO',
  holland: 'NL',
  netherlands: 'NL',
  'the netherlands': 'NL',
  burma: 'MM',
  myanmar: 'MM',
  'ivory coast': 'CI',
  "cote d'ivoire": 'CI',
  swaziland: 'SZ',
  eswatini: 'SZ',
  'east timor': 'TL',
  'timor-leste': 'TL',
  vatican: 'VA',
  'vatican city': 'VA',
};

let _countries = null;
let _countryByAlpha2 = null;
let _countryByAlpha3 = null;
let _countryByName = null;
let _subByCode = null;
let _subsByParent = null;

function foldName(s) {
  return String(s || '')
    .trim()
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[().,'’]/g, '')
    .replace(/\b(the|of|and|republic|kingdom|state|states|federation|province|islamic|democratic|people s|peoples)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function ensureIndexes() {
  if (_countries) return;
  _countries = iso31661
    .filter((c) => c.state === 'assigned' && c.alpha2)
    .slice()
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((c) => ({
      alpha2: c.alpha2,
      alpha3: c.alpha3,
      name: c.name,
      label: `${c.name} (${c.alpha2})`,
    }));
  _countryByAlpha2 = new Map();
  _countryByAlpha3 = new Map();
  _countryByName = new Map();
  for (const c of _countries) {
    _countryByAlpha2.set(c.alpha2, c);
    if (c.alpha3) _countryByAlpha3.set(c.alpha3, c);
    _countryByName.set(foldName(c.name), c.alpha2);
  }
  _subByCode = new Map();
  _subsByParent = new Map();
  for (const s of iso31662) {
    if (!s?.code) continue;
    _subByCode.set(String(s.code).toUpperCase(), s);
    const parent = String(s.parent || '').toUpperCase();
    if (!parent) continue;
    if (!_subsByParent.has(parent)) _subsByParent.set(parent, []);
    _subsByParent.get(parent).push({
      code: s.code,
      name: s.name,
      parent: s.parent,
      label: `${s.name} (${s.code})`,
    });
  }
  for (const list of _subsByParent.values()) {
    list.sort((a, b) => a.name.localeCompare(b.name));
  }
}

export function isGlobalLocationToken(raw) {
  return GLOBAL_TOKENS.has(String(raw || '').trim().toLowerCase());
}

export function listIsoCountries() {
  ensureIndexes();
  return _countries;
}

export function listIsoRegions(countryAlpha2) {
  ensureIndexes();
  const cc = String(countryAlpha2 || '').trim().toUpperCase();
  if (!cc) return [];
  return _subsByParent.get(cc) || [];
}

export function getIsoCountry(alpha2) {
  ensureIndexes();
  return _countryByAlpha2.get(String(alpha2 || '').trim().toUpperCase()) || null;
}

export function getIsoRegion(code) {
  ensureIndexes();
  const row = _subByCode.get(String(code || '').trim().toUpperCase());
  if (!row) return null;
  return { code: row.code, name: row.name, parent: row.parent, label: `${row.name} (${row.code})` };
}

export function parseCountryCode(raw) {
  ensureIndexes();
  const s = String(raw || '').trim();
  if (!s || isGlobalLocationToken(s)) return '';
  if (/^[A-Za-z]{2}$/.test(s)) {
    const hit = _countryByAlpha2.get(s.toUpperCase());
    if (hit) return hit.alpha2;
  }
  if (/^[A-Za-z]{3}$/.test(s)) {
    const hit = _countryByAlpha3.get(s.toUpperCase());
    if (hit) return hit.alpha2;
  }
  const alias = COUNTRY_ALIASES[s.toLowerCase()] || COUNTRY_ALIASES[foldName(s)];
  if (alias && _countryByAlpha2.has(alias)) return alias;
  const byName = _countryByName.get(foldName(s));
  return byName || '';
}

function parseSubdivision(raw, expectedCountry = '') {
  ensureIndexes();
  const s = String(raw || '').trim();
  if (!s || isGlobalLocationToken(s)) return null;
  const upper = s.toUpperCase();
  const expected = String(expectedCountry || '').trim().toUpperCase();
  if (/^[A-Z]{2}-[A-Z0-9]{1,3}$/.test(upper)) {
    const row = _subByCode.get(upper);
    if (!row) return null;
    const country = String(row.code).slice(0, 2);
    if (expected && country !== expected) return null;
    return { country, code: row.code };
  }
  if (expected && /^[A-Z0-9]{1,3}$/.test(upper)) {
    const compound = `${expected}-${upper}`;
    const row = _subByCode.get(compound);
    if (row) return { country: expected, code: row.code };
  }
  if (expected) {
    const folded = foldName(s);
    const list = _subsByParent.get(expected) || [];
    const hit = list.find((r) => foldName(r.name) === folded);
    if (hit) return { country: expected, code: hit.code };
  }
  return null;
}

export function parseIsoLocation(countryRaw, regionRaw) {
  const cIn = String(countryRaw || '').trim();
  const rIn = String(regionRaw || '').trim();
  if ((!cIn && !rIn) || (isGlobalLocationToken(cIn) && (!rIn || isGlobalLocationToken(rIn)))) {
    return { country: '', region: '' };
  }
  if (!cIn && isGlobalLocationToken(rIn)) return { country: '', region: '' };

  let country = parseCountryCode(isGlobalLocationToken(cIn) ? '' : cIn);
  let region = '';

  if (!country && rIn && !isGlobalLocationToken(rIn)) {
    const asSub = parseSubdivision(rIn);
    if (asSub) {
      country = asSub.country;
      region = asSub.code;
    } else {
      country = parseCountryCode(rIn);
    }
  }

  if (country && rIn && !isGlobalLocationToken(rIn)) {
    const asSub = parseSubdivision(rIn, country);
    if (asSub && asSub.country === country) region = asSub.code;
  }

  return { country: country || '', region: region || '' };
}

export function formatIsoLocationLabel(country, region) {
  const c = getIsoCountry(country);
  const r = getIsoRegion(region);
  if (c && r) return `${c.name} / ${r.name} (${r.code})`;
  if (c) return `${c.name} (${c.alpha2})`;
  if (r) return r.label;
  return '';
}

export function unmatchedLocationHint(countryRaw, regionRaw) {
  const parsed = parseIsoLocation(countryRaw, regionRaw);
  if (parsed.country) return '';
  const raw = [countryRaw, regionRaw].map((s) => String(s || '').trim()).filter(Boolean).join(' / ');
  if (!raw || isGlobalLocationToken(raw)) return '';
  return raw;
}
