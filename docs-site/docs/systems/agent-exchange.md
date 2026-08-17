---
title: AgentExchange
---

# AgentExchange

Path: **AgentExchange**.

Browse **AI employees** (Flolah / Public) and **workflow** listings (Public / Private / Secured).

## Publish a workflow as a service

From a **published** workflow: **Publish as A2A**.

| Setting | Meaning |
|---------|---------|
| **Visibility** | **Public** (listed) or **Private** (not listed for other CEOs; only your COO / reports-to after **Add to org**) |
| **Invoke** | **Sync** (wait for result) or **Async** (immediate task id; poll or webhook callback) |
| **Access** | New listings default to **Deny all** until you open **Allow all** or an **IP allowlist** under **⋯ → Security** |
| **Auth** | Public (no token) or **Secured** (OAuth client id + secret; secret shown once) |

**Test agent** on a card fills sample input. **Owners** can test past IP/OAuth/private gates; other callers still hit policy.

Flolah **employee** listings are for other CEOs to **Add to org** (imported copy). They are not open internet APIs.

## IP allowlists

A2A IP policy uses the same store as **Settings → IP Whitelists**. See [Security and tokens](../operate/security-tokens.md).
