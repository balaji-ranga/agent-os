import { inferFlightSearchStartUrl } from '../src/services/browser-tasks.js';

function assert(condition, message) {
  if (!condition) throw new Error(message);
  console.log('ok:', message);
}

const chennaiToSingapore = inferFlightSearchStartUrl(
  'Find a one-way direct flight from chennai to singapore on 2026-08-30 via Cheapflights'
);
assert(
  chennaiToSingapore ===
    'https://www.cheapflights.com/flight-search/MAA-SIN/2026-08-30?sort=price_a&fs=stops=~0',
  'city pair wins over one-way and preserves direct filter'
);

const sinToMaa = inferFlightSearchStartUrl(
  'Find Cheapflights direct SIN to MAA flights on 2026-08-30'
);
assert(
  sinToMaa ===
    'https://www.cheapflights.com/flight-search/SIN-MAA/2026-08-30?sort=price_a&fs=stops=~0',
  'IATA pair SIN to MAA still works'
);

console.log('flight URL inference tests PASSED');
