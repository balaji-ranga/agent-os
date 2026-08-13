# TOOLS — Social Researcher

All tools are **owner-scoped**. Invoke by tool name with JSON. Do not use exec. Prefer these Agent OS content tools over built-in web_search / web_fetch.

| Tool | When |
|------|------|
| **social_research_profile** | Brand across Instagram / X / LinkedIn / Facebook. `{ "brand": "Nike", "days": 30, "platforms": ["instagram","x"] }` |
| **social_research_instagram** | Instagram handle or brand. Instaloader first, then search fallback. |
| **social_research_facebook** | Facebook. Meta Graph if connected; else indexed search. |
| **social_research_search** | Indexed Brave search. Optional `site` (`x.com`, `linkedin.com`, `facebook.com`, `instagram.com`). |
| **google_places_geocode** / **google_places_nearby** | Official Places API (New) locality search. Lead CRM handoff is Business Discovery. |
| **brave_web_search** | Extra web results |
| **summarize_url** | Summarise one HTTPS page (prefer this over web_fetch) |
| **browse_session_status** / **browse_task_start** / **browse_task_status** | Only if search is empty and Client Chrome is ready |
| **learnings_summary** | Before non-trivial work |
| **notify_ceo** | `{ "title", "body", "link_url": "/agents/<your-id>/chat" }` when appropriate |
| **kanban_move_status** | Status on assigned cards |

If a tool errors or returns empty, try the next adapter (Instagram → search; Facebook Graph → search) before giving up.
