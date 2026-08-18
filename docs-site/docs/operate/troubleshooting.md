---
title: Troubleshooting
---

# Troubleshooting

Short fixes for CEOs. If a step says “wait or contact support”, there is nothing you should change on a server.

## Cannot register or sign in

- Confirm you are on [login.flolah.cloud](https://login.flolah.cloud)
- Check email/password; use **Forgot password?**
- Complete MFA (scan QR or type the security key, then the 6-digit code)
- Accept Terms and Privacy on register

## Chat not responding

1. Confirm you are logged in and chatting with the intended employee.
2. Click **New chat** and send a short message.
3. If tools never run, open **Workspace → Tools access**.
4. If the assistant says there was **no response from the runtime**, wait a minute and retry. Persistent failures are an operator issue.

## Agent gave wrong how-to

Ask **Platform Help** with the screen name (“scheduled goals”, “Company setup”, “Twenty lead to order”). Product help is not listed under your Knowledge documents.

CRM/ERP employees also read that help. Start a **new chat** after a product update if answers look stale.

## Workspace empty but Kanban has cards

Hard-refresh **Workspace** (`/work`). Confirm the same CEO account. Open tasks are the same owner-scoped list as Kanban.

## Lists look incomplete

Many screens **page** results. Use Next/Prev or scroll; search on Content Explorer applies to the **current page**.

## WhatsApp media failed / inbound file missing

Wait a few seconds for the file to appear in Content Explorer / inbound attachments. Confirm the sender is allowed (DMs vs groups). Groups are off by default.

**Read ticks but no reply:** the message arrived. Profile OpenAI/OpenRouter `Platform_BYOK` is often invalid — AgentSystem will not answer on a 401 key. On **Profile**, set provider to **Platform default**, or paste a working key under **API Keys**.

## Lists look incomplete

## CRM / ERP desk will not load

Confirm Profile has Twenty or ERPNext selected. If the embed host is not found, contact support (company subdomain DNS).

## Rate limit or budget blocked

Check **Tools → Rate limits**, **Efficiency View** token budgets, and department caps. Reset usage only if you intend to clear the month-to-date counter.

## Still stuck

In the app: **Platform Help** or the **COO**. On the web: this guide’s [first 15 minutes](../start/first-15-minutes.md). Include the screen name and what you clicked — not passwords or API keys.
