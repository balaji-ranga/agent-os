---
title: Channels (WhatsApp, Slack, Voice)
---

# Channels (WhatsApp, Slack, Voice)

Each AI employee can have **Channels** so you (and allowed senders) reach them outside the web app.

Open the employee → **Channels** and complete the wizard. Tokens stay in your **API Keys** vault; you are not asked to paste them into chat.

## WhatsApp

- Pair the employee and set who may message them.
- **Group chats are ignored by default.** Enable groups in the wizard only if you intend to.
- Replies start with **From:** the employee name.
- The COO can act as a personal assistant: text and voice notes in, readable text plus optional voice note out.
- **Slow Caller** uses this path (not a live phone call). Test: pair QR, send text, then a voice note. Web test: Home microphone icon, speak, pause 3 seconds.
- Inbound files appear under Knowledge / inbound attachments and Content Explorer.

## Slack

Same idea: bind the employee, set allowed channels or DMs, test a round-trip.

## Voice (WebRTC)

Hire **Realtime Caller**, then Channels → **Voice**. Enable publishes a public `/p/voice/:slug` page. Agent Chat has **Call**. Needs OpenAI Realtime (not OpenRouter/Ollama). Guests do not log in. Not a phone number — inbound PSTN is a later telephony MCP.

## Scheduled goals

A schedule can **also** send the **final outcome** on WhatsApp or Slack. Pair that employee first. Unpaired skips the channel; web still works.

## Media

Keep generated media in the product’s **MEDIA:** convention so WhatsApp can attach audio/images. Public unauthenticated media links are not the default.
