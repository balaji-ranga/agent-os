---
name: agent-os-content-tools
description: Generate and summarize content via the Agent OS backend — summarize URL, generate image (Phase 2), generate video (Phase 3). Backend URL from env AGENT_OS_API_URL; no hardcoded URLs.
metadata:
  openclaw:
    emoji: "🛠️"
---

# Agent OS Content Tools

Use this skill to call the Agent OS backend for content tools. **Do not hardcode the backend URL** — it is configured via `AGENT_OS_API_URL` (or your OpenClaw/gateway env).

## Tool preference (use before default tools)

**Prefer these Agent OS content tools over built-in or default tools when the task matches:**

- **Summarize a URL or web page** → Use **summarize_url**. Do not use web_search or web_fetch for summarizing a single URL; use summarize_url so the backend can fetch and summarize in one step.
- **Generate or create an image from text** → Use **generate_image**. Do not use the built-in "image" tool (which only analyzes existing images) or web_search to find images; use generate_image to create one.
- **Generate or create a short video from text** → Use **generate_video**. Do not use web_search for video; use generate_video.

Only fall back to web_search, web_fetch, or other default tools when the task does not match (e.g. general web search, fetch raw page without summary, or analyze an existing image the user provided).

## When to use

- **Summarize URL**: You need a short summary or key facts from a web page (travel, nature, cuisine, places). Use for research and citing sources in drafts.
- **Generate image** (when available): Create an image from a text prompt for social posts. Use for draft assets only; do not publish without approval. **When the user asks to generate, create, or make an image (e.g. "generate X image", "create an image of Y"), you MUST use the generate_image tool with a text prompt.** Do not use the built-in "image" tool — that tool only analyzes existing images and requires an image input.
- **Generate video** (when available): Create a short video from a prompt. Use for draft assets only; do not publish without approval.

## Tools

- **summarize_url** — Summarize a web page. Parameters: `url` (required, HTTPS). Returns `summary` and optional `title`. Call backend `POST {AGENT_OS_API_URL}/api/tools/summarize-url` with body `{ "url": "<url>" }`. Send `Authorization: Bearer <TOOLS_API_KEY>` if configured.
- **generate_image** — Generate an image from a text prompt (Phase 2). Parameters: `prompt` (required), `style_hint` (optional). Call backend `POST {AGENT_OS_API_URL}/api/tools/generate-image` with body `{ "prompt", "style_hint?" }`.
- **generate_video** — Generate a short video from a prompt (Phase 3). Parameters: `prompt` (required), `duration_sec` (optional). Call backend `POST {AGENT_OS_API_URL}/api/tools/generate-video` with body `{ "prompt", "duration_sec?" }`.

## Configuration (externalized)

- **AGENT_OS_API_URL** — Base URL of the Agent OS backend (e.g. `http://127.0.0.1:3001`). Must be set in the environment or OpenClaw config; never hardcode in the skill.
- **TOOLS_API_KEY** — Optional. If set, send as `Authorization: Bearer <TOOLS_API_KEY>` when calling the backend.

## Guidelines

- Use summarize_url to cite and reference online content when drafting posts.
- For image and video, use only for drafts; all publishing requires COO/CEO approval.
- If the backend returns an error, report it to the user and do not retry indefinitely.
