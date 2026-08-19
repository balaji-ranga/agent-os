---
title: Security and tokens
---

# Security and tokens

## Isolation

Your chats, knowledge, Kanban, schedules, workflows, API Keys, and connectors belong to **you**. Other CEOs cannot see them.

## IP allowlists

**Settings → IP Whitelists** is the central firewall for:

- AgentExchange public invoke
- Workflow **Download for Windows**
- Browser Session worker
- Optional trading bridge webhooks

Federated screens write the same list. Default for new A2A listings is **deny all** until you open access.

## Tokens

**Settings → Tokens management** lists external package tokens (desktop runner, browser worker, optional bridges). Only **masked prefixes** are shown. Revoke a token if a laptop is lost.

## Secrets

- Never put API keys in chat or workflow static fields when a vault name will do
- OAuth client secrets are shown **once**
- Generated media in the app requires login by default
- Content tool `summarize_url` will not fetch your internal network or cloud metadata URLs

If chat returns a gateway error, retry, start **New chat**, or wait for support. Do not share session tokens.
