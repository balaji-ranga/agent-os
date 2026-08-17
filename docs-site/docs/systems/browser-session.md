---
title: Browser Session
---

# Browser Session

Path: **Browser Session**.

Use this when an employee must use a **real browser** (log into a site, click through a flow, capture a page) rather than a simple HTTP call.

## Modes (typical)

- **Managed browser** on the platform (Playwright)
- **Your Chrome** via a client relay (pair from the Browser Session screen)
- **Windows local worker** (Connectors package) — headed browser with a persistent profile on your PC, for multi-user or social logins

Recipes are saved click-paths you can re-run; free-text tasks are for one-off work. Grant `browse_*` tools on employees that should drive the browser (COO, Workflow Builder, and Platform Help often have them).

## Safety

- Confirm the session shows **Online** before you rely on it.
- Package tokens and IP allowlists live under **Settings → Tokens** and **IP Whitelists**.
- Do not store passwords in chat; use the headed browser profile or the site’s own login.

Video studio **Flow** scenes may ask you to sign into a desktop Chrome session first — see [Content and media](./content-and-media.md).
