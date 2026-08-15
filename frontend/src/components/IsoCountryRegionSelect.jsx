import { useMemo } from 'react';
import {
  listIsoCountries,
  listIsoRegions,
  parseIsoLocation,
  unmatchedLocationHint,
  getIsoRegion,
} from '../utils/isoCountryRegion.js';

const DEFAULT_SELECT = {
  width: '100%',
  padding: '0.55rem 0.7rem',
  borderRadius: 8,
  border: '1px solid var(--border)',
  background: 'var(--surface)',
  color: 'var(--text)',
  font: 'inherit',
};

/**
 * ISO 3166-1 country + ISO 3166-2 region dropdowns.
 * onChange({ country, region }) — country is alpha-2, region is 3166-2 or ''.
 */
export default function IsoCountryRegionSelect({
  country = '',
  region = '',
  onChange,
  disabled = false,
  required = false,
  countryLabel = 'Country',
  regionLabel = 'Region',
  emptyCountryLabel = 'Select country',
  emptyRegionLabel = 'Select region (optional)',
  selectStyle,
  labelStyle,
  stacked = true,
}) {
  const parsed = useMemo(() => parseIsoLocation(country, region), [country, region]);
  const countries = useMemo(() => listIsoCountries(), []);
  const regions = useMemo(() => listIsoRegions(parsed.country), [parsed.country]);
  const extraRegion = useMemo(() => {
    if (!parsed.region) return null;
    if (regions.some((r) => r.code === parsed.region)) return null;
    return getIsoRegion(parsed.region);
  }, [parsed.region, regions]);
  const hint = unmatchedLocationHint(country, region);
  const sel = { ...DEFAULT_SELECT, ...selectStyle };
  const lab = { display: 'block', marginBottom: 4, fontSize: '0.85rem', color: 'var(--muted)', ...labelStyle };

  const emit = (nextCountry, nextRegion) => {
    if (typeof onChange !== 'function') return;
    const cc = String(nextCountry || '').trim().toUpperCase();
    let rg = String(nextRegion || '').trim().toUpperCase();
    if (rg && !rg.startsWith(`${cc}-`)) rg = '';
    onChange({ country: cc, region: rg });
  };

  return (
    <div style={{ display: stacked ? 'flex' : 'grid', flexDirection: stacked ? 'column' : undefined, gap: stacked ? 0 : '0.65rem', gridTemplateColumns: stacked ? undefined : '1fr 1fr' }}>
      <label style={{ display: 'block', marginBottom: stacked ? '0.85rem' : 0 }}>
        <span style={lab}>{countryLabel}</span>
        <select
          value={parsed.country}
          disabled={disabled}
          required={required}
          aria-label={countryLabel}
          onChange={(e) => emit(e.target.value, parsed.region)}
          style={sel}
        >
          <option value="">{emptyCountryLabel}</option>
          {countries.map((c) => (
            <option key={c.alpha2} value={c.alpha2}>
              {c.label}
            </option>
          ))}
        </select>
        {hint ? (
          <span style={{ display: 'block', marginTop: 4, fontSize: '0.8rem', color: 'var(--muted)' }}>
            Previous value “{hint}” is not an ISO code — pick a country from the list.
          </span>
        ) : null}
      </label>
      {parsed.country && (regions.length > 0 || extraRegion) ? (
        <label style={{ display: 'block', marginBottom: stacked ? '0.85rem' : 0 }}>
          <span style={lab}>{regionLabel}</span>
          <select
            value={parsed.region}
            disabled={disabled}
            aria-label={regionLabel}
            onChange={(e) => emit(parsed.country, e.target.value)}
            style={sel}
          >
            <option value="">{emptyRegionLabel}</option>
            {extraRegion ? (
              <option value={extraRegion.code}>{extraRegion.label}</option>
            ) : null}
            {regions.map((r) => (
              <option key={r.code} value={r.code}>
                {r.label}
              </option>
            ))}
          </select>
        </label>
      ) : parsed.country ? (
        <p style={{ margin: stacked ? '0 0 0.85rem' : 0, fontSize: '0.8rem', color: 'var(--muted)' }}>
          No ISO 3166-2 regions for this country.
        </p>
      ) : null}
    </div>
  );
}
