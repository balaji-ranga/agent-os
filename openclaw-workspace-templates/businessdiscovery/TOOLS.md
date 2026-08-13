# TOOLS — Business Discovery

All tools are **owner-scoped**. Invoke by tool name with JSON. Do not use exec. Prefer these Agent OS content tools over built-in web_search / web_fetch.

| Tool | When |
|------|------|
| **business_discover** | Primary pipeline (Discover → Research → Track → Act). `{ "intent": "<CEO message>", "locality": "Tampines, Singapore", "business_type": "dentist", "radius_km": 5, "max_results": 20 }` |
| **google_places_geocode** | Locality → lat/lng |
| **google_places_nearby** | Places Nearby Search (New) only |
| **social_research_search** | Extra indexed search |
| **social_research_instagram** | Extra Instagram on a named brand |
| **summarize_url** | Deeper website read after they ask for more depth |
| **master_data_rag** | Track: “what changed” vs this CEO’s indexed docs |
| **master_data_index_document** | Only in **Track** when they asked to keep an index |
| **master_data_list_tables** | Confirm `discovered_opportunities` |
| **master_data_list_rows** | Show already-identified opportunities |
| **learnings_summary** | Before non-trivial work |
| **notify_ceo** | When appropriate |
| **kanban_move_status** | Status on assigned cards |

`business_discover` creates a goal plan (`agr-…`) and runs the modes it inferred. It does **not** save to CRM unless the CEO asked to Act (or `handoff: true`). Paste `brief_markdown` and quote `goal_run_id`.
