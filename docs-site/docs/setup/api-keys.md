---
title: API keys
---

# API keys

Path: **Settings → API Keys**.

This is your **named secret vault**. Keys are shown once at save time; the list only shows the name and a hint. Never paste production secrets into chat.

## Typical uses

- **`Platform_BYOK`** — your OpenAI or OpenRouter key for employee chat (when Profile is not platform default)
- Workflow Brain / API / MCP authentication by **key name**
- Optional slots for search, image/video, speech, maps, or social — only fill what you use

When Profile is **not** platform default, Flolah may seed **empty** slots so you know which names to fill. Empty slots are not active keys.

## Add a key

1. Open **API Keys**.
2. Choose a stable **name** (letters, digits, `.` `_` `-`).
3. Paste the secret.
4. Optional extra encryption phrase if the product offers it.
5. **Add**.

To rotate: edit the row and paste a new secret; leave the secret blank to keep the existing one.

## Connectors vs this vault

**Connectors** can store an OAuth connection or an API key **on that connection**. That is separate from this vault. Optional “use my own app id/secret” for a connector is also separate.

If you delete a vault key that workflows still reference, Flolah lists those dependencies and asks you to confirm.

Related: [Connectors and MCP](../systems/connectors-and-mcp.md), [Tools rate limits](../operate/budgets.md).
