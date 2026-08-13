/**
 * Google Places API (New) adapter — geocode + nearby + text search.
 * Official API only (no scraping).
 */
import { getGooglePlacesConfig } from '../../../config/tools.js';

const PLACE_FIELD_MASK = [
  'places.id',
  'places.displayName',
  'places.formattedAddress',
  'places.location',
  'places.rating',
  'places.userRatingCount',
  'places.websiteUri',
  'places.googleMapsUri',
  'places.nationalPhoneNumber',
  'places.types',
  'places.businessStatus',
  'nextPageToken',
].join(',');

/** Common English phrases → Places Table A types. Unknown phrases use text search. */
const TYPE_ALIASES = {
  dentist: 'dentist',
  dental: 'dentist',
  'dental clinic': 'dentist',
  'dental clinics': 'dentist',
  gym: 'gym',
  gyms: 'gym',
  fitness: 'gym',
  cafe: 'cafe',
  coffee: 'cafe',
  restaurant: 'restaurant',
  restaurants: 'restaurant',
  hotel: 'lodging',
  hotels: 'lodging',
  lodging: 'lodging',
  pharmacy: 'pharmacy',
  salon: 'hair_salon',
  'hair salon': 'hair_salon',
  spa: 'spa',
  clinic: 'doctor',
  doctor: 'doctor',
  hospital: 'hospital',
  school: 'school',
  bank: 'bank',
  supermarket: 'supermarket',
  grocery: 'supermarket',
};

function mapPlace(p) {
  if (!p) return null;
  return {
    place_id: p.id || '',
    name: p.displayName?.text || p.displayName || '',
    address: p.formattedAddress || '',
    lat: p.location?.latitude ?? null,
    lng: p.location?.longitude ?? null,
    rating: p.rating ?? null,
    user_rating_count: p.userRatingCount ?? 0,
    website: p.websiteUri || '',
    google_maps_uri: p.googleMapsUri || '',
    phone: p.nationalPhoneNumber || '',
    types: Array.isArray(p.types) ? p.types : [],
    business_status: p.businessStatus || '',
  };
}

function includedTypeFor(businessType) {
  const raw = String(businessType || '').trim().toLowerCase();
  if (!raw) return '';
  if (TYPE_ALIASES[raw]) return TYPE_ALIASES[raw];
  const compact = raw.replace(/s\b/, '');
  if (TYPE_ALIASES[compact]) return TYPE_ALIASES[compact];
  if (/^[a-z_]+$/.test(raw) && raw.length < 40) return raw;
  return '';
}

async function placesPost(apiKey, path, body, fieldMask) {
  const res = await fetch(`https://places.googleapis.com/v1${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      'X-Goog-Api-Key': apiKey,
      'X-Goog-FieldMask': fieldMask,
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(30000),
  });
  const text = await res.text();
  let data;
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    throw new Error('Places API returned non-JSON');
  }
  if (!res.ok || data.error) {
    const msg = data.error?.message || text.slice(0, 400);
    const err = new Error(`Places API HTTP ${res.status}: ${msg}`);
    err.status = res.status >= 400 && res.status < 500 ? 400 : 502;
    throw err;
  }
  return data;
}

export function requirePlacesKey(ownerUserId) {
  const cfg = getGooglePlacesConfig(ownerUserId);
  if (cfg.error || !cfg.apiKey) {
    const err = new Error(cfg.error || 'Google Places not configured');
    err.status = cfg.error_code === 'google_places_platform_key_missing' ? 503 : 400;
    err.code = cfg.error_code;
    err.google_places_byok_key_name = cfg.google_places_byok_key_name;
    throw err;
  }
  return cfg;
}

export async function geocodeLocality(ownerUserId, { locality } = {}) {
  const place = String(locality || '').trim();
  if (!place) {
    const err = new Error('locality is required');
    err.status = 400;
    throw err;
  }
  const cfg = requirePlacesKey(ownerUserId);
  const data = await placesPost(
    cfg.apiKey,
    '/places:searchText',
    { textQuery: place, maxResultCount: 1 },
    'places.id,places.displayName,places.formattedAddress,places.location'
  );
  const first = (data.places || [])[0];
  if (!first?.location) {
    const err = new Error(`Could not geocode locality: ${place}`);
    err.status = 404;
    throw err;
  }
  console.info('[social-research] geocode locality_len=%s', place.length);
  return {
    ok: true,
    locality: place,
    formatted_address: first.formattedAddress || '',
    lat: first.location.latitude,
    lng: first.location.longitude,
    place_id: first.id || '',
    key_source: cfg.source,
    using_byok: Boolean(cfg.using_byok),
  };
}

function applyMinRating(places, minRating) {
  const min = Number(minRating);
  if (!Number.isFinite(min) || min <= 0) return places;
  return places.filter((p) => p.rating != null && Number(p.rating) >= min);
}

export async function nearbySearch(ownerUserId, opts = {}) {
  const cfg = requirePlacesKey(ownerUserId);
  let lat = Number(opts.lat);
  let lng = Number(opts.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    const geo = await geocodeLocality(ownerUserId, { locality: opts.locality });
    lat = geo.lat;
    lng = geo.lng;
  }
  const radius = Math.min(Math.max(Number(opts.radius_meters) || 3000, 50), 50000);
  const maxResults = Math.min(Math.max(Number(opts.max_results) || 20, 1), 60);
  const includedType = includedTypeFor(opts.included_type || opts.business_type);
  const rank =
    String(opts.rank_preference || 'POPULARITY').toUpperCase() === 'DISTANCE' ? 'DISTANCE' : 'POPULARITY';

  const body = {
    maxResultCount: Math.min(maxResults, 20),
    rankPreference: rank,
    locationRestriction: {
      circle: { center: { latitude: lat, longitude: lng }, radius },
    },
  };
  if (includedType) body.includedTypes = [includedType];

  const data = await placesPost(cfg.apiKey, '/places:searchNearby', body, PLACE_FIELD_MASK);
  let places = (data.places || []).map(mapPlace).filter(Boolean);
  places = applyMinRating(places, opts.min_rating);
  places = places.slice(0, maxResults);
  console.info(
    '[social-research] nearby type=%s n=%s radius=%s',
    includedType || 'any',
    places.length,
    radius
  );
  return {
    ok: true,
    lat,
    lng,
    radius_meters: radius,
    included_type: includedType || null,
    count: places.length,
    places,
    key_source: cfg.source,
    using_byok: Boolean(cfg.using_byok),
  };
}

export async function textSearchPlaces(ownerUserId, opts = {}) {
  const cfg = requirePlacesKey(ownerUserId);
  const query = String(opts.query || opts.text_query || '').trim();
  if (!query) {
    const err = new Error('query is required');
    err.status = 400;
    throw err;
  }
  let lat = Number(opts.lat);
  let lng = Number(opts.lng);
  if ((!Number.isFinite(lat) || !Number.isFinite(lng)) && opts.locality) {
    const geo = await geocodeLocality(ownerUserId, { locality: opts.locality });
    lat = geo.lat;
    lng = geo.lng;
  }
  const radius = Math.min(Math.max(Number(opts.radius_meters) || 3000, 50), 50000);
  const maxResults = Math.min(Math.max(Number(opts.max_results) || 20, 1), 60);
  const includedType = includedTypeFor(opts.included_type || opts.business_type);

  const collected = [];
  let pageToken = '';
  for (let page = 0; page < 3 && collected.length < maxResults; page += 1) {
    const body = {
      textQuery: query,
      maxResultCount: Math.min(20, maxResults - collected.length),
      pageSize: Math.min(20, maxResults - collected.length),
    };
    if (Number.isFinite(lat) && Number.isFinite(lng)) {
      body.locationBias = {
        circle: { center: { latitude: lat, longitude: lng }, radius },
      };
    }
    if (includedType) body.includedType = includedType;
    if (pageToken) body.pageToken = pageToken;
    const data = await placesPost(cfg.apiKey, '/places:searchText', body, PLACE_FIELD_MASK);
    const batch = (data.places || []).map(mapPlace).filter(Boolean);
    collected.push(...batch);
    pageToken = String(data.nextPageToken || '').trim();
    if (!pageToken || !batch.length) break;
  }
  let places = applyMinRating(collected, opts.min_rating).slice(0, maxResults);
  console.info('[social-research] text_search n=%s q_len=%s', places.length, query.length);
  return {
    ok: true,
    query,
    lat: Number.isFinite(lat) ? lat : null,
    lng: Number.isFinite(lng) ? lng : null,
    radius_meters: radius,
    included_type: includedType || null,
    count: places.length,
    places,
    key_source: cfg.source,
    using_byok: Boolean(cfg.using_byok),
  };
}
