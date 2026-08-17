---
title: Profile and AI model
---

# Profile and AI model

Path: avatar → **Edit profile** (`/profile`).

## What to set

- Display name, email, mobile, password
- **Country** and **region** (same lists as Register)
- **Appearance** — Day / Night (also the sun/moon in the top bar). Advanced themes **Aurora Glass** and **Vivid Board** are under Profile → Appearance (saved in this browser).
- **Display timezone** — Kanban, Digest, and workspace times use this
- **Data persistence** — how long chats, standup history, and workflow runs are kept (for example 30–365 days). A nightly job deletes older items; **Purge aged data now** does it immediately.

## How AI employees get a model

| Choice | What you do |
|--------|-------------|
| **Platform default** | Nothing — Flolah uses the platform language model |
| **OpenAI / OpenRouter** | Pick provider + chat model here (or at Register). Put the secret in **API Keys** as **`Platform_BYOK`**. Do not paste keys on the Profile form. |
| **Local / free options** | When offered (for example Ollama). No paid LLM key. Archive titles for **New chat** may be heuristic so the UI does not wait on a slow local model. |

Saving Profile syncs provider and model for **your** AI employees.

Optional: **Tools → Model** on the Tools page overrides the model for specific tools only. Keys still come from Profile / API Keys. **Tools → Rate limits** caps daily/monthly API **calls** for tools that use vendor keys.

## MFA and security

Manage authenticator or email MFA on Profile when your organisation allows it. See [Sign in and MFA](../start/sign-in-and-mfa.md).
