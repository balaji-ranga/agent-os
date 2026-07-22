# TOOLS — Vedic Astrology

All tools are owner-scoped to the entitled CEO. Never spoof another user's id.

## vedic_compute_chart (ephemeris / positions)

Compute sidereal Jyotish **data** and a ready **`chart_spec`** for the generic chart renderer.

```json
{
  "birth_date": "1990-05-15",
  "birth_time": "14:30",
  "timezone_offset_hours": 5.5,
  "latitude": 13.0827,
  "longitude": 80.2707,
  "place_name": "Chennai",
  "ayanamsa": "lahiri",
  "chart_style": "both",
  "include_navamsa": true,
  "include_dasha": true
}
```

- Returns planet/house tables plus **`chart_spec`** (`schema_version: "1.0"`).
- Does **not** return image URLs — call **`generate_chart`** next.

## generate_chart (visuals — generic JSON → SVG)

Pass the `chart_spec` from `vedic_compute_chart`, or build JSON yourself:

```json
{
  "spec": {
    "schema_version": "1.0",
    "charts": [
      {
        "type": "vedic_north_indian",
        "id": "d1_north",
        "title": "Rāśi (D-1) — North Indian",
        "lagna_sign_index": 11,
        "planets": [{ "abbr": "Su", "sign_index": 0, "house": 2 }]
      },
      {
        "type": "vedic_south_indian",
        "id": "d1_south",
        "title": "Rāśi (D-1) — South Indian",
        "lagna_sign_index": 11,
        "planets": [{ "abbr": "Su", "sign_index": 0, "house": 2 }]
      }
    ]
  }
}
```

- Types: `vedic_north_indian` | `vedic_south_indian` | `labeled_grid`
- Returns **`visuals_markdown`** / **`chart_urls`**. **Paste at the top of your reply.**
- `{ "return_schema": true }` returns the full JSON schema + example (no render).
- Prefer this over `generate_image` for kundli diagrams.

## Master Data

- **master_data_list_tables** / **master_data_list_rows** — find `vedic_birth_charts`, `vedic_readings`
- **master_data_insert_row** / **update_row** — save client birth data and reading notes
- **master_data_list_documents** / **master_data_rag** — search uploaded/attached docs  
  When the user message includes `[chat_attachments]` with `document_id=…`, call **master_data_rag** with a query about those attachments before answering.

## Collaboration

- **kanban_create_task** / **kanban_move_status** / **kanban_reassign_to_coo**
- **learnings_summary** — `{ "topic": "vedic astrology", "days": 90 }`
- **email_send** — deliver a reading when asked
- **notify_ceo** — only when CEO asked to be reached, or a true blocker
- **summarize_url** — HTTPS pages the CEO shares
- **browser** — last resort for live public tables; prefer `vedic_compute_chart` + `generate_chart`

## Do not

- Use `intent_classify_and_delegate` or workflow mutate tools
- Invent birth time/place
- Present decorative `generate_image` art as an accurate kundli
