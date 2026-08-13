# Social Researcher + Business Discovery

**Audience:** CEOs.  
**Primitives:** Employees, Tools, Knowledge, Tasks.

Hire these AI employees from **AgentExchange** (**Add to org**). They are **not** auto-hired on register.

## What they do

| Employee | Use when |
|----------|----------|
| **Social Researcher** | Public Instagram, X, LinkedIn, Facebook research. Example: “Analyse Nike’s Instagram and X for the last 30 days.” |
| **Business Discovery** | Local **Discover → Research → Track → Act**. Google Places to find businesses; website + Instagram + LinkedIn research; OpenSearch for “what changed”; CRM/Kanban only when you ask to Act. Example: “Research dental clinics within 5 km of Tampines.” |

They are **not** SocialAssistant (content posting). Social Researcher stays on public social analysis. Business Discovery researches local businesses and only **Acts** (CRM / Kanban) when you ask.

## How to hire

1. Open **AgentExchange** (`/agent-exchange`).
2. Find **Social Researcher** and **Business Discovery** (Flolah listings).
3. **Add to org** — pick reports-to (usually COO) and department (Research).
4. Chat with the new employee from **AI Employees**.

Flolah listings are in-app only (not public internet A2A). See [09-a2a-agent-exchange.md](./09-a2a-agent-exchange.md).

## Accurate posts vs search hits

Tool JSON has two lists. The employee must use **`posts[]`** when you ask for posts, captions, or images.

| Field | Meaning |
|-------|---------|
| **`posts[]`** | Hydrated posts: permalink, text/caption, timestamp when known, `image_url` when known |
| **`indexed_results`** | Brave search hits (page titles/snippets). **Not** a post feed |

Anonymous Instaloader and Meta Graph **cannot** read Nike’s Instagram or Facebook from a VPS IP. That is why older chats fell back to web search and then invented a summary from snippets.

## Social research sources (adapters)

The **Social Research MCP** (`mcp-social-research`) and matching content tools share one adapter layer.

| Platform | Adapter |
|----------|---------|
| Instagram | **Self-hosted Instaloader sidecar** (Docker on this VPS — not a SaaS Instaconnect). Without vault **`INSTAGRAM_SESSIONID`**, anonymous instagram.com calls from the VPS IP are **HTTP 429** (not 409), so the tool skips Instaloader and hydrates `instagram.com/p/{shortcode}/` (real CDN image). Graph cannot query arbitrary brand IG accounts. |
| X | Official **X API v2** when `X_BEARER_TOKEN` (platform) or vault **`X_API_BYOK`** is set. Otherwise hydrate `x.com/.../status/{id}` URLs (tweet text + media). Free X API often cannot read other users’ timelines. |
| Facebook | **Meta Graph** after **Connect** on **Connectors → MCPs** — **your Pages only** (`/me/accounts`). Public brands (Nike) are not in that list. Indexed search is separate. |
| LinkedIn / public web | Indexed **Brave Search** (optional Browser Session if search is empty). No LinkedIn crawler. |
| Google Business / locality | Official **Places API (New)** Nearby / Text Search |

## Keys

| Key | Who | When |
|-----|-----|------|
| `BRAVE_API_KEY` | Ops `.env` | Platform default Profile — web/social search |
| **`BRAVE_SEARCH_BYOK`** | CEO vault | Any other Profile LLM |
| `GOOGLE_PLACES_API_KEY` | Ops `.env` | Platform default Profile — Places |
| **`GOOGLE_PLACES_BYOK`** | CEO vault | Any other Profile LLM |
| **`INSTAGRAM_SESSIONID`** | CEO vault (preferred) | Instaloader captions + timestamps. Cookie from instagram.com while logged in (Application → Cookies → `sessionid`). Optional platform `INSTAGRAM_SESSIONID` is a shared fallback (ban risk — prefer per-CEO vault). |
| **`X_API_BYOK`** | CEO vault | Official X timelines when Profile is not Platform default |
| `X_BEARER_TOKEN` | Ops `.env` | Platform default Profile — official X API v2 |
| Facebook OAuth | CEO | Connectors → MCPs (`mcp-meta-graph`) for **owned** Pages only |
| `FACEBOOK_APP_ID` / `FACEBOOK_APP_SECRET` | Ops / Admin | Completes Meta app token for Instagram/Facebook oEmbed. App ID must be set even if the secret is already stored on Connectors. |

Enable **Places API (New)** on the Google Cloud key. Nearby Search uses lat/lng + radius + type; rating filters are applied after the API returns places. Indexed social search uses Brave `freshness` (past day/week/month), not a crawler.

## How to get Instagram posts reliably

1. Log into Instagram in a browser.
2. Copy the `sessionid` cookie for `.instagram.com`.
3. **Settings → API Keys** → add **`INSTAGRAM_SESSIONID`** (or Edit the seeded slot).
4. Ask Social Researcher again. `adapter` should be `instaloader` with captions and timestamps.

Without the cookie, the tool still returns **real post images** (`image_url` from Instagram’s public media redirect) plus permalinks. Captions may be search hints (`caption_source: search_hint`) — the employee should say that.

Do **not** paste your Instagram password. Rotate the cookie if Instaloader starts returning 401/429.

## How to get X posts reliably

No extra key is required for **hydrated tweets**: Brave finds `x.com/{handle}/status/{id}` URLs; the adapter fills `posts[]` with text, time, and media.

For an official user timeline (and when hydration misses):

1. Create an X developer bearer token.
2. Platform default Profile: ops `X_BEARER_TOKEN`. Other Profiles: vault **`X_API_BYOK`**.
3. Free X API tiers often **cannot** read other accounts’ tweets — the tool then keeps using hydration.

## Facebook

1. Ops/admin: Meta App ID + secret (help [31](./31-mcp-connectors-oauth.md)).
2. You: **Connectors → MCPs → Connect** Facebook.
3. Graph returns **your** Pages. Asking for Nike’s Page will stay on indexed search unless Nike is in `/me/accounts`.

## Business Discovery modes

Business Discovery maps your wording onto **Discover → Research → Track → Act** (one mode, several, or all):

| Mode | Source | You might say |
|------|--------|----------------|
| **Discover** | Google Places | “Find businesses” |
| **Research** | Website + Instagram + LinkedIn | “Tell me about them” / “Research … and rank prospects” |
| **Track** | OpenSearch (your indexed docs) | “Tell me what changes” |
| **Act** | CRM + Email + Social + Workflows | “Do something about it” / “save to CRM” |

A research ask (find up to 20, rank top 5, **do not track**) runs **Discover + Research** only. The tool:

1. Creates a durable **goal plan** (`agr-…`) with those steps.
2. Discovers via Places, researches public web/social, reuses Knowledge if it is still current (default 7 days).
3. Returns a **brief**: table (Business, Google rating/reviews, Website Good/Poor, Instagram Active/Inactive/None, Digital Presence, Opportunity stars), top-opportunity reasoning, and a next-step question — usually *“Would you like me to save these 5 prospects to CRM or research them in more depth?”*
4. Does **not** write `discovered_opportunities` or create a Kanban card unless you asked to Track or Act.

Opportunity stars are **high** when Google reputation is strong and digital/social presence is **weak**.

## Business Discovery + CRM (Act)

1. Places search around the locality.
2. Enrich website / Instagram / LinkedIn (indexed search).
3. Write Knowledge table **`discovered_opportunities`** (dedup by `place_id` / fingerprint) **when persisting**.
4. Create a **Kanban** card:
   - Assigned to a **CRM** AI employee if your org has one (Business Core Twenty/ERPNext).
   - Otherwise assigned to **you** (CEO inbox) with the lead set.
5. CRM employees must **not** recreate leads already in that table or already in CRM (name + locality).

Ask Business Discovery to show `discovered_opportunities` via Master Data if you want the history. Quote the `agr-…` id in chat to open the Goal Plan panel.

## Workflows

Register **Social Research** MCP (`mcp-social-research`) is seeded as a platform server. Workflow **MCP** / Brain nodes can call the same tools. Pass **`X-Ceo-User-Id`**. See [08-mcp-integrations.md](./08-mcp-integrations.md).

## Troubleshooting

- Places errors: set `GOOGLE_PLACES_API_KEY` or vault **GOOGLE_PLACES_BYOK**; confirm Places API (New) is enabled.
- Instagram **429** (agents sometimes say 409 / “Instaconnect”): the **Instaloader sidecar is self-hosted** on this VPS. It is not a cloud Instaconnect. Anonymous calls still go to **instagram.com**, which rate-limits datacenter IPs. The tool skips those probes (`instaloader.skipped: no_session`) and hydrates `/p/` images instead. Add **`INSTAGRAM_SESSIONID`** for captions. Ops can set `INSTALOADER_ALLOW_ANONYMOUS=1` to force a probe.
- Facebook Graph empty for a public brand: Graph only sees **your** connected Pages; Connect Facebook if you have not.
- X empty `posts`: confirm Brave returns `/status/` URLs; then hydration fills text/media. Add **X_API_BYOK** only if you need the official timeline.
- Meta oEmbed unused: `FACEBOOK_APP_ID` missing in `.env` even if App secret is stored on Connectors.
- Listings missing on AgentExchange: ops seed `node scripts/seed-social-research-agents.js` (publisher CEO from `FLOLAH_EXCHANGE_PUBLISHER_USER_ID` or the first enabled CEO).
