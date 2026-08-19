/**
 * Generic Places free-text arg parse (nearby / business_discover).
 * Usage: node scripts/test-places-parse-text.mjs
 */
import {
  parsePlacesSearchText,
  PLACE_FIELD_MASK,
  TEXT_SEARCH_FIELD_MASK,
} from '../src/services/social-research/adapters/google-places.js';

function assert(c, m) {
  if (!c) throw new Error(m);
}

const p = parsePlacesSearchText(
  'Research dental clinics within 5 km of Tampines, Singapore. Find up to 20 businesses using Google Places.'
);
assert(/tampines/i.test(p.locality || ''), 'expected Tampines locality, got ' + p.locality);
assert(p.business_type === 'dentist', 'expected dentist, got ' + p.business_type);
assert(p.radius_km === 5, 'expected 5 km, got ' + p.radius_km);
assert(p.max_results === 20, 'expected max 20, got ' + p.max_results);

const structured = parsePlacesSearchText('ignored', {
  locality: 'Orchard',
  business_type: 'gym',
  radius_km: 2,
  max_results: 8,
});
assert(structured.locality === 'Orchard', 'structured locality wins');
assert(structured.business_type === 'gym', 'structured type wins');
assert(structured.radius_km === 2, 'structured radius wins');
assert(structured.max_results === 8, 'structured max wins');

const based = parsePlacesSearchText(
  'Find 20 genuinely qualified Singapore-based B2B service companies. Spend no more than $25.'
);
assert(based.locality === 'Singapore', 'Country-based locality, got ' + based.locality);
assert(based.max_results === 20, 'Find N qualified max, got ' + based.max_results);
assert(
  parsePlacesSearchText('Find 8 Hong Kong-based firms').locality === 'Hong Kong',
  'multi-word Country-based'
);

assert(!PLACE_FIELD_MASK.includes('nextPageToken'), 'Nearby FieldMask must not include nextPageToken');
assert(TEXT_SEARCH_FIELD_MASK.includes('nextPageToken'), 'Text Search FieldMask includes nextPageToken');

console.log('PLACES_PARSE_TEXT_OK', p);
