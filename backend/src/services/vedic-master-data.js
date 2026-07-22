/**
 * Seed Vedic Astrology Master Data tables for a CEO.
 */
import { createTable, findTableByName, listRows, insertRow } from './master-data.js';

const BIRTH_COLUMNS = [
  { name: 'name', type: 'text' },
  { name: 'birth_date', type: 'text' },
  { name: 'birth_time', type: 'text' },
  { name: 'timezone_offset_hours', type: 'number' },
  { name: 'place_name', type: 'text' },
  { name: 'latitude', type: 'number' },
  { name: 'longitude', type: 'number' },
  { name: 'ayanamsa', type: 'text' },
  { name: 'notes', type: 'text' },
];

const READING_COLUMNS = [
  { name: 'client_name', type: 'text' },
  { name: 'birth_chart_ref', type: 'text' },
  { name: 'reading_date', type: 'text' },
  { name: 'summary', type: 'text' },
  { name: 'chart_urls', type: 'text' },
  { name: 'notes', type: 'text' },
];

export function ensureVedicMasterData(ownerUserId) {
  let birth = findTableByName(ownerUserId, 'vedic_birth_charts');
  let birthCreated = false;
  if (!birth) {
    birth = createTable(ownerUserId, {
      name: 'vedic_birth_charts',
      description:
        'Vedic Astrology birth data (name, DOB, TOB, timezone offset hours, place, lat/lon, ayanamsa, notes). Used by vedic-astrology agent.',
      columns: BIRTH_COLUMNS,
    });
    birthCreated = true;
  }

  let readings = findTableByName(ownerUserId, 'vedic_readings');
  let readingsCreated = false;
  if (!readings) {
    readings = createTable(ownerUserId, {
      name: 'vedic_readings',
      description: 'Log of Vedic chart readings / session summaries for the CEO.',
      columns: READING_COLUMNS,
    });
    readingsCreated = true;
  }

  // Seed one example row only when the birth table is brand new and empty
  if (birthCreated) {
    const { rows } = listRows(ownerUserId, birth.id, { limit: 1 });
    if (!(rows || []).length) {
      insertRow(ownerUserId, birth.id, {
        name: 'Example — Chennai',
        birth_date: '1990-05-15',
        birth_time: '14:30',
        timezone_offset_hours: 5.5,
        place_name: 'Chennai',
        latitude: 13.0827,
        longitude: 80.2707,
        ayanamsa: 'lahiri',
        notes: 'Sample row — replace with real client data',
      });
    }
  }

  return {
    birth_table_id: birth.id,
    readings_table_id: readings.id,
    birth_created: birthCreated,
    readings_created: readingsCreated,
  };
}
