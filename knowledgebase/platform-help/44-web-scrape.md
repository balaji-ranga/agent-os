# Web Scrape (workflow node + MCP sidecar)

Bounded **HTTPS** crawl of a website or domain, with optional **search phrases**. Engine is a **Crawlee** sidecar (`optional-web-scrape-mcp`, Apache-2.0 — [crawlee.dev](https://crawlee.dev/)), not the backend and not Browser Session.

## When to use which tool

| Need | Use |
|------|-----|
| One page summary | Content tool `summarize_url` (HTTPS public hosts only; private/link-local blocked) |
| Open-web search | `brave_web_search` / Brave MCP |
| Logged-in Chrome / recipes | Browser Session `browse_*` |
| Domain crawl + phrases | **Web Scrape** node, or MCP `scrape_domain`, or content tools `web_scrape_url` / `web_scrape_domain` |
| Instagram captions/feed as Social Researcher | Social Research / Instaloader (help **42**) — this node is a generic crawler |

## Workflow node (`web_scrape`)

Palette: **Web Scrape**.

**Inputs:** `startUrl` (HTTPS URL or domain), `phrases` (comma list or JSON array; empty = extract within caps), optional `cookie`.

**Config:** `render` `auto` \| `http` \| `playwright`; `maxPages` (default 25, cap 200); `maxDepth` (default 2); same-origin; include/exclude URL globs; respect `robots.txt`; node timeout (default 20 minutes).

**Outputs:** `ok`, `text` (summary), `matches[]`, `pages[]`, `stats`, `result`.

Owner is always the workflow CEO. Instagram.com with an empty Cookie uses vault **`INSTAGRAM_SESSIONID`** when present (same key as Instaloader). Rate limits: **Tools → Rate limits** (`web_scrape_domain` / `web_scrape_url`).

## MCP (`mcp-web-scrape`)

Tools: `scrape_url`, `scrape_domain`. Pass **`X-Ceo-User-Id`**. Seeded as a platform MCP. Brain / MCP nodes can call the same sidecar.

## Safety

- HTTPS only; SSRF blocks private/link-local (public IPv6 allowed so CDNs such as Instagram AAAA work)
- Same-origin by default
- `robots.txt` honored unless you turn it off on the node
- Hard caps on pages/depth/time
- Cookies/session ids redacted in logs

## Ops

Compose profile **`optional-web-scrape-mcp`**. `ensure-platform-mcps.sh` starts + seeds `mcp-web-scrape`.

```bash
docker compose --profile optional-web-scrape-mcp up -d --build web-scrape-mcp
docker compose exec backend node scripts/seed-web-scrape-mcp.js
```

Env: `WEB_SCRAPE_MCP_URL=http://web-scrape-mcp:8085/mcp`

Public Instagram **post permalinks** (`/p/{shortcode}/`) often return HTML without login; profile grids (`/nasa/`) often **302 to login**. Datacenter **429**s still happen on login URLs and some crawls — this node is not a replacement for Instaloader captions/feed (help **42**).
