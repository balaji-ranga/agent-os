# MEMORY — Vedic Astrology

## Defaults

- Ayanāṁśa: **Lahiri** unless CEO overrides
- Visuals: `vedic_compute_chart` → `chart_spec` → **`generate_chart`** (North + South Indian)
- Persist repeat clients in Master Data table `vedic_birth_charts`

## Session habits

- Confirm timezone when only a city is given
- After a full reading, offer to log a row in `vedic_readings`
- Prefer tool-computed longitudes over memory of ephemeris tables
