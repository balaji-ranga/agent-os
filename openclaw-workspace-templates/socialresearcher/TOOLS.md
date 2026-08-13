# TOOLS — Social Researcher

All tools are **owner-scoped**. Invoke by tool name with JSON. Do not use exec. Prefer these Agent OS content tools over built-in web_search / web_fetch.

Report from **`posts[]`**. **`indexed_results` / `results` are search hits, not a post feed.**

| Tool | When |
|------|------|
| **social_research_profile** | Brand across Instagram / X / LinkedIn / Facebook. `{ "brand": "Nike", "days": 30, "platforms": ["instagram","x"] }` |
| **social_research_instagram** | Instagram handle. Instaloader (vault `INSTAGRAM_SESSIONID`) or hydrated `/p/` images. |
| **social_research_x** | X handle. Official API (`X_API_BYOK` / `X_BEARER_TOKEN`) or hydrated status URLs (text + media). |
| **social_research_facebook** | Facebook. Meta Graph if connected (owned Pages only); else indexed search. |
| **social_research_search** | Indexed Brave search. Optional `site` (`linkedin.com`, `facebook.com`, `instagram.com`, `x.com`). Not a tweet/IG feed. |
| **google_places_geocode** / **google_places_nearby** | Official Places API (New) locality search. Lead CRM handoff is Business Discovery. |
| **brave_web_search** | Extra web results |
| **summarize_url** | Summarise one HTTPS page (prefer this over web_fetch) |
| **browse_session_status** / **browse_task_start** / **browse_task_status** | Only if search is empty and Client Chrome is ready |
| **learnings_summary** | Before non-trivial work |
| **notify_ceo** | `{ "title", "body", "link_url": "/agents/<your-id>/chat" }` when appropriate |
| **kanban_move_status** | Status on assigned cards |

If `posts` is empty, quote `next_step` and stop inventing captions. Do not “fill in” from websearch snippets.
