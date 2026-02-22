# Agent OS — Knowledge base

Documentation lives here so Cursor and humans can find it. **Root README.md** stays at `agent-os/README.md` and is the main entry point.

## Index (for Cursor / future reference)

| File | Purpose |
|------|---------|
| **TESTING.md** | Restart steps, full API test, frontend manual tests, smoke test, standup→COO→TechResearcher test, standup UI checklist. |
| **GITHUB-SETUP.md** | One-time: create agent-os repo on GitHub and push (Options A/B, security check). |
| **IMPLEMENTATION_PLAN.md** | Product/roadmap: vision, architecture, phases (1–5), skills, TTS, token monitoring, references. |
| **AGENT_REVIEW_AND_SKILLS.md** | Agent review (COO, TechResearcher, SocialAssistant); secure skill recommendations and where skills live. |
| **CONFIGURE-CLAUDE-OPUS.md** | How to set Claude Opus (or other Anthropic models) in `~/.openclaw/openclaw.json` and API key. |

## Not in knowledgebase (stay at repo root or other paths)

- **README.md** — at `agent-os/README.md` (main project doc).
- **openclaw-workspace-templates/** — SOUL.md, MEMORY.md, AGENTS.md used by scripts; do not move.
- **openclaw-skills/** — SKILL.md and README per skill; install scripts reference these paths.
- **.cursor/agents/** — Cursor subagent instructions (code-review, remote-host-config, etc.).
