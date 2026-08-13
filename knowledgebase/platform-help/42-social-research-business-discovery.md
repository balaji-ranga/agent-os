# Social Researcher + Business Discovery

**Audience:** CEOs.  
**Primitives:** Employees, Tools, Knowledge, Tasks.

Hire these AI employees from **AgentExchange** (**Add to org**). They are **not** auto-hired on register.

## What they do

| Employee | Use when |
|----------|----------|
| **Social Researcher** | Public Instagram, X, LinkedIn, Facebook research. Example: “Analyse Nike’s Instagram and X for the last 30 days.” |
| **Business Discovery** | Locality + business type leads via **Google Places API (New)**, then website/Instagram/LinkedIn enrichment. Example: “Find dental clinics within 3 km of Tampines with rating above 4.2 and identify potential leads.” |

They are **not** SocialAssistant (content posting). Research and discovery only.

## How to hire

1. Open **AgentExchange** (`/agent-exchange`).
2. Find **Social Researcher** and **Business Discovery** (Flolah listings).
3. **Add to org** — pick reports-to (usually COO) and department (Research).
4. Chat with the new employee from **AI Employees**.

Flolah listings are in-app only (not public internet A2A). See [09-a2a-agent-exchange.md](./09-a2a-agent-exchange.md).

## Social research sources (adapters)

The **Social Research MCP** (`mcp-social-research`) and matching content tools share one adapter layer. Swap Instaloader or Places without changing the employee, workflows, or UI.

| Platform | Adapter |
|----------|---------|
| LinkedIn, X, public web | Indexed **Brave Search** (optional Browser Session if search is empty) |
| Instagram | Public **Instaloader** first; if blocked/empty, Brave/browser search. No Instagram login. |
| Facebook | **Meta Graph** when you **Connect** Facebook on **Connectors → MCPs**; otherwise indexed search |
| Google Business / locality | Official **Places API (New)** Nearby / Text Search |

## Keys

| Key | Who | When |
|-----|-----|------|
| `BRAVE_API_KEY` | Ops `.env` | Platform default Profile — web/social search |
| **`BRAVE_SEARCH_BYOK`** | CEO vault | Any other Profile LLM |
| `GOOGLE_PLACES_API_KEY` | Ops `.env` | Platform default Profile — Places |
| **`GOOGLE_PLACES_BYOK`** | CEO vault | Any other Profile LLM |
| Facebook OAuth | CEO | Connectors → MCPs (`mcp-meta-graph`) for Graph-backed Facebook research |

Enable **Places API (New)** on the Google Cloud key. Nearby Search uses lat/lng + radius + type; rating filters are applied after the API returns places.

## Business Discovery + CRM

1. Places search around the locality.
2. Enrich website / Instagram / LinkedIn (indexed search).
3. Write Knowledge table **`discovered_opportunities`** (dedup by `place_id` / fingerprint).
4. Create a **Kanban** card:
   - Assigned to a **CRM** AI employee if your org has one (Business Core Twenty/ERPNext).
   - Otherwise assigned to **you** (CEO inbox) with the lead set.
5. CRM employees must **not** recreate leads already in that table or already in CRM (name + locality).

Ask Business Discovery to show `discovered_opportunities` via Master Data if you want the history.

## Workflows

Register **Social Research** MCP (`mcp-social-research`) is seeded as a platform server. Workflow **MCP** / Brain nodes can call the same tools. Pass **`X-Ceo-User-Id`**. See [08-mcp-integrations.md](./08-mcp-integrations.md).

## Troubleshooting

- Places errors: set `GOOGLE_PLACES_API_KEY` or vault **GOOGLE_PLACES_BYOK**; confirm Places API (New) is enabled.
- Instagram empty: Instaloader is often rate-limited; the employee should still summarise indexed search hits.
- Facebook Graph empty for a public brand: Graph only sees **your** connected Pages; public brands use indexed search.
- Listings missing on AgentExchange: ops seed `node scripts/seed-social-research-agents.js` (publisher CEO from `FLOLAH_EXCHANGE_PUBLISHER_USER_ID` or the first enabled CEO).
