# TOOLS — Vedic Astrology

All tools are owner-scoped to the entitled CEO. Never spoof another user's id.

## vedic_compute_chart (required)

Compute sidereal Jyotish data **and** render North/South Indian SVG charts.

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

- Returns planet/house tables, **`chart_spec`**, **`chart_urls`**, and **`visuals_markdown`**.
- **Paste `visuals_markdown` at the top of your reply** so charts render inline.
- Do **not** call `generate_image`. Do **not** invent SVG URLs.

## generate_chart (optional custom diagrams)

Only if you need a custom diagram beyond the auto-rendered `vedic_compute_chart` output. Pass `{ "spec": <chart_spec> }` (`schema_version: "1.0"`). Types: `vedic_north_indian` | `vedic_south_indian` | `labeled_grid`.

## Master Data

- **master_data_list_tables** / **master_data_list_rows** — find `vedic_birth_charts`, `vedic_readings`
- **master_data_insert_row** / **update_row** — save client birth data and reading notes
- **master_data_list_documents** / **master_data_rag** — search uploaded/attached docs  
  When the user message includes `[chat_attachments]` with `document_id=…`, call **master_data_rag** before answering from those files.

## Collaboration

- **kanban_create_task** / **kanban_move_status** / **kanban_reassign_to_coo**
- **learnings_summary** — `{ "topic": "vedic astrology", "days": 90 }`
- **email_send** / **notify_ceo** / **summarize_url** / **browser** as needed

## Do not

- Call **`generate_image`** (not granted; empty prompts error)
- Use `intent_classify_and_delegate` or workflow mutate tools
- Invent birth time/place
