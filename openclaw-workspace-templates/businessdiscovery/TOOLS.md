# TOOLS — Business Discovery

All tools are **owner-scoped**. Invoke by tool name with JSON. Do not use exec. Prefer these Agent OS content tools over built-in web_search / web_fetch.

| Tool | When |
|------|------|
| **business_discover** | Primary. `{ "locality": "Tampines", "business_type": "dentist", "radius_km": 3, "min_rating": 4.2, "max_results": 20 }` |
| **google_places_geocode** | Locality → lat/lng |
| **google_places_nearby** | Places Nearby Search (New) only |
| **social_research_search** | Extra indexed search |
| **social_research_instagram** | Extra Instagram on a named brand |
| **social_research_profile** | Deep brand analysis (usually Social Researcher’s job) |
| **master_data_list_tables** | Confirm `discovered_opportunities` exists |
| **master_data_list_rows** | Show already-identified opportunities |
| **learnings_summary** | Before non-trivial work |
| **notify_ceo** | When appropriate |
| **kanban_move_status** | Status on assigned cards |

`business_discover` already creates the CRM/CEO Kanban handoff and writes Knowledge. Do not duplicate that card unless the CEO asks.
