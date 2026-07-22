/**
 * Vedic (sidereal) chart *computation* (ephemeris + houses + dashā).
 * Visual SVGs are produced by the generic generate_chart tool from a chart_spec JSON.
 */
import {
  Body,
  MakeTime,
  GeoVector,
  Ecliptic,
} from 'astronomy-engine';
import { CHART_SPEC_VERSION } from './chart-spec.js';

const SIGN_NAMES = [
  'Aries',
  'Taurus',
  'Gemini',
  'Cancer',
  'Leo',
  'Virgo',
  'Libra',
  'Scorpio',
  'Sagittarius',
  'Capricorn',
  'Aquarius',
  'Pisces',
];

const SIGN_SA = [
  'Meṣa',
  'Vṛṣabha',
  'Mithuna',
  'Karka',
  'Siṁha',
  'Kanyā',
  'Tulā',
  'Vṛścika',
  'Dhanu',
  'Makara',
  'Kumbha',
  'Mīna',
];

const NAKSHATRAS = [
  'Aśvinī',
  'Bharaṇī',
  'Kṛttikā',
  'Rohiṇī',
  'Mṛgaśīrṣa',
  'Ārdrā',
  'Punarvasu',
  'Puṣya',
  'Aśleṣā',
  'Maghā',
  'Pūrva Phalgunī',
  'Uttara Phalgunī',
  'Hasta',
  'Citrā',
  'Svātī',
  'Viśākhā',
  'Anurādhā',
  'Jyeṣṭhā',
  'Mūla',
  'Pūrva Āṣāḍhā',
  'Uttara Āṣāḍhā',
  'Śravaṇa',
  'Dhaniṣṭhā',
  'Śatabhiṣaj',
  'Pūrva Bhādrapadā',
  'Uttara Bhādrapadā',
  'Revatī',
];

const PLANET_BODIES = [
  { key: 'Sun', body: Body.Sun, abbr: 'Su' },
  { key: 'Moon', body: Body.Moon, abbr: 'Mo' },
  { key: 'Mercury', body: Body.Mercury, abbr: 'Me' },
  { key: 'Venus', body: Body.Venus, abbr: 'Ve' },
  { key: 'Mars', body: Body.Mars, abbr: 'Ma' },
  { key: 'Jupiter', body: Body.Jupiter, abbr: 'Ju' },
  { key: 'Saturn', body: Body.Saturn, abbr: 'Sa' },
];

const DASHA_LORDS = ['Ketu', 'Venus', 'Sun', 'Moon', 'Mars', 'Rahu', 'Jupiter', 'Saturn', 'Mercury'];
const DASHA_YEARS = [7, 20, 6, 10, 7, 18, 16, 19, 17];

function norm360(x) {
  let v = x % 360;
  if (v < 0) v += 360;
  return v;
}

/** Lahiri ayanāṁśa approximation (degrees) for a JS Date. */
export function lahiriAyanamsaDegrees(date) {
  const year = date.getUTCFullYear() + (date.getUTCMonth() + date.getUTCDate() / 30) / 12;
  return 23.85 + (50.29 / 3600) * (year - 2000);
}

function tropicalEclipticLongitude(body, time) {
  const vec = GeoVector(body, time, true);
  const ecl = Ecliptic(vec);
  return norm360(ecl.elon);
}

function moonNodeMeanLongitude(time) {
  const T = time.tt / 36525;
  const Omega =
    125.0445479 -
    1934.1362891 * T +
    0.0020754 * T * T +
    T * T * T / 467441 -
    T * T * T * T / 60616000;
  return norm360(Omega);
}

function longitudeMeta(lon) {
  const signIndex = Math.floor(lon / 30) % 12;
  const degInSign = lon - signIndex * 30;
  const nakIndex = Math.floor(lon / (360 / 27)) % 27;
  const pada = Math.floor((lon % (360 / 27)) / (360 / 108)) + 1;
  return {
    longitude: Number(lon.toFixed(4)),
    sign_index: signIndex,
    sign: SIGN_NAMES[signIndex],
    sign_sa: SIGN_SA[signIndex],
    degree_in_sign: Number(degInSign.toFixed(4)),
    nakshatra: NAKSHATRAS[nakIndex],
    pada,
  };
}

function houseFromLagna(planetLon, lagnaLon) {
  const diff = norm360(planetLon - lagnaLon);
  return Math.floor(diff / 30) + 1;
}

function navamsaSignIndex(lon) {
  const sign = Math.floor(lon / 30) % 12;
  const part = Math.floor((lon % 30) / (30 / 9));
  const elementBase = [0, 3, 6, 9];
  const elem = sign % 4;
  return (elementBase[elem] + part) % 12;
}

function vimshottariFromMoon(moonLon, birthDate) {
  const span = 360 / 27;
  const nak = Math.floor(moonLon / span) % 27;
  const lordIndex = nak % 9;
  const fracInto = (moonLon % span) / span;
  const yearsTotal = DASHA_YEARS[lordIndex];
  const yearsRemaining = yearsTotal * (1 - fracInto);
  const start = new Date(birthDate.getTime());
  const periods = [];
  let cursor = new Date(start);
  let idx = lordIndex;
  const firstMs = yearsRemaining * 365.25 * 24 * 3600 * 1000;
  for (let i = 0; i < 9; i++) {
    const years = i === 0 ? yearsRemaining : DASHA_YEARS[idx];
    const ms = years * 365.25 * 24 * 3600 * 1000;
    const end = new Date(cursor.getTime() + (i === 0 ? firstMs : ms));
    periods.push({
      lord: DASHA_LORDS[idx],
      years: Number(years.toFixed(3)),
      start: cursor.toISOString().slice(0, 10),
      end: end.toISOString().slice(0, 10),
    });
    cursor = end;
    idx = (idx + 1) % 9;
  }
  const now = new Date();
  const current = periods.find((p) => now >= new Date(p.start) && now < new Date(p.end)) || periods[0];
  return { balance_lord_at_birth: DASHA_LORDS[lordIndex], periods, current };
}

function planetMarks(planets) {
  return planets.map((p) => ({
    abbr: p.abbr,
    name: p.name,
    sign_index: p.sign_index,
    house: p.house,
  }));
}

/**
 * Build a generate_chart chart_spec from computed D-1 / D-9 data.
 */
export function buildVedicChartSpec({ lagna, planets, navamsa, subtitle, style = 'both' }) {
  const charts = [];
  const s = String(style || 'both').toLowerCase();
  const marks = planetMarks(planets);
  const lagnaIdx = lagna.sign_index;

  if (s === 'north' || s === 'both') {
    charts.push({
      type: 'vedic_north_indian',
      id: 'd1_north',
      title: 'Rāśi (D-1) — North Indian',
      subtitle,
      footer: 'Lahiri sidereal · whole-sign houses',
      lagna_sign_index: lagnaIdx,
      planets: marks,
    });
  }
  if (s === 'south' || s === 'both') {
    charts.push({
      type: 'vedic_south_indian',
      id: 'd1_south',
      title: 'Rāśi (D-1) — South Indian',
      subtitle,
      footer: 'Lahiri sidereal · whole-sign houses',
      lagna_sign_index: lagnaIdx,
      planets: marks,
    });
  }
  if (navamsa) {
    const nMarks = planetMarks(navamsa.planets);
    const nLagna = navamsa.lagna.sign_index;
    if (s === 'north' || s === 'both') {
      charts.push({
        type: 'vedic_north_indian',
        id: 'd9_north',
        title: 'Navāṁśa (D-9) — North Indian',
        subtitle,
        footer: 'Lahiri sidereal · whole-sign houses',
        lagna_sign_index: nLagna,
        planets: nMarks,
      });
    }
    if (s === 'south' || s === 'both') {
      charts.push({
        type: 'vedic_south_indian',
        id: 'd9_south',
        title: 'Navāṁśa (D-9) — South Indian',
        subtitle,
        footer: 'Lahiri sidereal · whole-sign houses',
        lagna_sign_index: nLagna,
        planets: nMarks,
      });
    }
  }

  return { schema_version: CHART_SPEC_VERSION, charts };
}

/**
 * @param {object} input
 * @param {{ mediaDir?: string }} [_opts] - mediaDir ignored (use generate_chart for visuals)
 */
export function computeVedicChart(input = {}, _opts = {}) {
  const birthDate = String(input.birth_date || input.birthDate || '').trim();
  const birthTime = String(input.birth_time || input.birthTime || '12:00').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(birthDate)) {
    throw new Error('birth_date is required as YYYY-MM-DD');
  }
  const lat = Number(input.latitude ?? input.lat);
  const lon = Number(input.longitude ?? input.lon ?? input.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
    throw new Error('latitude and longitude are required');
  }
  const tz = Number(input.timezone_offset_hours ?? input.timezoneOffsetHours ?? 0);
  if (!Number.isFinite(tz)) throw new Error('timezone_offset_hours must be a number (e.g. 5.5 for IST)');

  const [yy, mm, dd] = birthDate.split('-').map(Number);
  const [hh, mi = 0, ss = 0] = birthTime.split(':').map(Number);
  const utcMs = Date.UTC(yy, mm - 1, dd, hh, mi, ss) - tz * 3600 * 1000;
  const date = new Date(utcMs);
  const time = MakeTime(date);
  const ayan = lahiriAyanamsaDegrees(date);

  const lagnaTrop = computeAscendantTropical(date, lat, lon);
  const lagnaLon = norm360(lagnaTrop - ayan);
  const lagna = { ...longitudeMeta(lagnaLon), tropical: Number(lagnaTrop.toFixed(4)) };

  const planets = [];
  for (const { key, body, abbr } of PLANET_BODIES) {
    const trop = tropicalEclipticLongitude(body, time);
    const sid = norm360(trop - ayan);
    const meta = longitudeMeta(sid);
    planets.push({
      name: key,
      abbr,
      ...meta,
      house: houseFromLagna(sid, lagnaLon),
      tropical: Number(trop.toFixed(4)),
    });
  }
  const rahuTrop = moonNodeMeanLongitude(time);
  const rahuSid = norm360(rahuTrop - ayan);
  const ketuSid = norm360(rahuSid + 180);
  planets.push({
    name: 'Rahu',
    abbr: 'Ra',
    ...longitudeMeta(rahuSid),
    house: houseFromLagna(rahuSid, lagnaLon),
    tropical: Number(rahuTrop.toFixed(4)),
  });
  planets.push({
    name: 'Ketu',
    abbr: 'Ke',
    ...longitudeMeta(ketuSid),
    house: houseFromLagna(ketuSid, lagnaLon),
    tropical: Number(norm360(rahuTrop + 180).toFixed(4)),
  });

  const place = String(input.place_name || input.placeName || '').trim();
  const subtitle = [
    place || `${lat.toFixed(2)}, ${lon.toFixed(2)}`,
    `${birthDate} ${birthTime} (UTC${tz >= 0 ? '+' : ''}${tz})`,
    `Lagna ${lagna.sign}`,
  ].join(' · ');

  const includeNavamsa = input.include_navamsa !== false && input.includeNavamsa !== false;
  let navamsa = null;
  if (includeNavamsa) {
    const nPlanets = planets.map((p) => {
      const nSign = navamsaSignIndex(p.longitude);
      const nLon = nSign * 30 + (p.longitude % (30 / 9)) * 9;
      return {
        ...p,
        sign_index: nSign,
        sign: SIGN_NAMES[nSign],
        sign_sa: SIGN_SA[nSign],
        house: houseFromLagna(nLon, navamsaSignIndex(lagnaLon) * 30),
      };
    });
    const nLagnaSign = navamsaSignIndex(lagnaLon);
    navamsa = {
      lagna: { ...lagna, sign_index: nLagnaSign, sign: SIGN_NAMES[nLagnaSign], sign_sa: SIGN_SA[nLagnaSign] },
      planets: nPlanets,
    };
  }

  const includeDasha = input.include_dasha !== false && input.includeDasha !== false;
  const moon = planets.find((p) => p.name === 'Moon');
  const dasha = includeDasha && moon ? vimshottariFromMoon(moon.longitude, date) : null;

  const style = String(input.chart_style || input.chartStyle || 'both').toLowerCase();
  const chart_spec = buildVedicChartSpec({
    lagna,
    planets,
    navamsa,
    subtitle,
    style,
  });

  return {
    ok: true,
    ayanamsa: 'lahiri',
    ayanamsa_degrees: Number(ayan.toFixed(4)),
    birth: {
      date: birthDate,
      time: birthTime,
      timezone_offset_hours: tz,
      latitude: lat,
      longitude: lon,
      place_name: place || null,
    },
    lagna,
    planets,
    navamsa: navamsa
      ? {
          lagna: navamsa.lagna,
          planets: navamsa.planets.map(({ name, abbr, sign, sign_sa, house, nakshatra }) => ({
            name,
            abbr,
            sign,
            sign_sa,
            house,
            nakshatra,
          })),
        }
      : null,
    dasha,
    /** Ready-to-pass JSON for generate_chart (visuals). */
    chart_spec,
    next_step:
      'Call generate_chart with { "spec": <chart_spec> }. Paste returned visuals_markdown at the TOP of your reply, then interpret.',
    notes:
      'Sidereal positions use tropical ephemeris minus Lahiri ayanāṁśa. Houses are whole-sign from Lagna. Visuals come from generate_chart + chart_spec — do not invent SVG URLs.',
  };
}

/** Approximate tropical ascendant (degrees). */
function computeAscendantTropical(date, latDeg, lonDeg) {
  const jd = date.getTime() / 86400000 + 2440587.5;
  const T = (jd - 2451545.0) / 36525;
  const eps = (23.439291 - 0.0130042 * T) * (Math.PI / 180);
  let theta =
    280.46061837 +
    360.98564736629 * (jd - 2451545.0) +
    0.000387933 * T * T;
  theta = norm360(theta + lonDeg);
  const ramc = (theta * Math.PI) / 180;
  const lat = (latDeg * Math.PI) / 180;
  const y = -Math.cos(ramc);
  const x = Math.sin(ramc) * Math.cos(eps) + Math.tan(lat) * Math.sin(eps);
  let asc = (Math.atan2(y, x) * 180) / Math.PI;
  return norm360(asc);
}

// Re-export render helpers for any legacy imports
export {
  renderNorthIndianSvg,
  renderSouthIndianSvg,
  persistSvg,
  generateChartsFromSpec,
} from './chart-spec.js';
