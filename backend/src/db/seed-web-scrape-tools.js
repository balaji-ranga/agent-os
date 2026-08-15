/**
 * Seed generic web-scrape content tools (Crawlee sidecar).
 */
import { getDb } from './schema.js';

export const WEB_SCRAPE_TOOLS = [
  {
    name: 'web_scrape_url',
    display_name: 'Web scrape URL',
    endpoint: '/api/tools/web-scrape-url',
    method: 'POST',
    purpose:
      'API tool: fetch one HTTPS page (Crawlee sidecar) and return title + main text + optional phrase hits. Pass url (required), optional phrases[], render auto|http|playwright, cookie. Owner-scoped. Do not use exec. Logged-in Browser Session recipes still use browse_*.',
    model_used: 'Crawlee (HTTP / Playwright)',
  },
  {
    name: 'web_scrape_domain',
    display_name: 'Web scrape domain',
    endpoint: '/api/tools/web-scrape-domain',
    method: 'POST',
    purpose:
      'API tool: crawl a website/domain (same-origin, robots.txt, capped pages) and score pages by search phrases. Pass startUrl or domain, optional phrases[], maxPages (default 25, cap 200), maxDepth (default 2), render auto|http|playwright. Owner-scoped. Do not use exec.',
    model_used: 'Crawlee (HTTP / Playwright)',
  },
];

export const WEB_SCRAPE_TOOL_NAMES = WEB_SCRAPE_TOOLS.map((t) => t.name);

export function seedWebScrapeToolsIfMissing() {
  const db = getDb();
  const insert = db.prepare(
    `INSERT OR IGNORE INTO content_tools_meta (name, display_name, endpoint, method, purpose, model_used, enabled, is_builtin)
     VALUES (?, ?, ?, ?, ?, ?, 1, 1)`
  );
  const update = db.prepare(
    'UPDATE content_tools_meta SET purpose = ?, display_name = ?, endpoint = ?, method = ?, model_used = ? WHERE name = ?'
  );
  for (const t of WEB_SCRAPE_TOOLS) {
    insert.run(t.name, t.display_name, t.endpoint, t.method, t.purpose, t.model_used);
    update.run(t.purpose, t.display_name, t.endpoint, t.method, t.model_used, t.name);
  }
  console.info('[startup] web scrape tools seeded (%s)', WEB_SCRAPE_TOOLS.length);
}
