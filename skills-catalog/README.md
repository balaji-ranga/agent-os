# Company automation starter skills

This source-controlled catalog contains 50 distinct procedures: 30 Flolah-native skills and 20 pinned, licensed upstream skill texts. It includes the existing IBKR Portfolio & Strategy SME procedure and an owner-scoped Gmail Operations procedure.

## Visibility and entitlement

- Published platform skills are visible to every company CEO / CEO delegate in **AI employee workspace → Skills**.
- Platform drafts, including the 20 upstream imports, are visible only to admins.
- Company-created skills remain private to their owning company CEO. A company cannot publish or edit platform skills.
- Publication is not assignment, a tool grant, connection setup, dependency installation, trading activation or action approval.
- Assignment pins the reviewed active version by default. Publishing a replacement does not silently upgrade existing assignments.
- Unpublishing hides a skill from company catalogs and blocks new runtime selection. Existing work is not interrupted; managed workspace files are removed on the next employee workspace synchronization.

## Admin workflow

1. Open **Admin → Skills Onboarding** (`/admin/skills`).
2. Create a procedure, upload UTF-8 `SKILL.md`, or preview an exact public GitHub `blob/<40-character-commit>/.../SKILL.md` URL.
3. Review instructions, actual license/redistribution permission, references and required capabilities. Imports download text and license only, never execute it or install dependencies.
4. Supply canonical required tool names, connector `service.operation` actions and MCP `server::tool` identifiers. Include any unresolved external requirements.
5. Add text references in the resource editor if needed. Supported resource folders are `references/`, `assets/` and `examples/`; executable and binary resources are not supported.
6. Save the draft. Review the persisted version/checksum and record review notes, then publish it.
7. Company CEOs may opt into the skill using the existing employee workspace Skills section. Required tool, connector and MCP grants must independently exist.

A package with unresolved external requirements cannot be selected or synced as executable skill instructions. A published package may therefore be visible but not execution-ready for a particular employee. The slash-command picker reports missing prerequisites.

## Curation and licensing

`catalog.json` records category, capabilities, provenance, exact source commit and license/permission text. Original upstream `SKILL.md` and license files are preserved without pretending their native runtime integrations exist in Flolah.

The native procedures cover COO/objectives/goals, Gmail, IBKR advisory review, connectors, workflows, schedules, procurement, finance, sales, support, HR, governance and data reporting. Native catalog entries are source-reviewed and initially published. The catalog seed never replaces an admin-managed version or resurrects an unpublished skill.

Upstream imports:

- [Marketing Skills](https://github.com/coreyhaines31/marketingskills/tree/1efedbc5148b54b2f0f6c6c9fe0be62e151c7fff/skills) — 10 MIT skills: content strategy, copywriting, customer research, competitors, pricing, revenue operations, churn prevention, onboarding, emails and analytics.
- [Superpowers](https://github.com/obra/superpowers/tree/bb92a77741419a4ab5f06e711a283343f1ada0c3/skills) — 6 MIT skills: brainstorming, plans, debugging, verification, code-review response and test-driven development.
- [Anthropic Skills](https://github.com/anthropics/skills/tree/dbd4588f9e1033efb41dad4bef2f7947c8993d44/skills) — 4 individually Apache-2.0-licensed skills: skill creator, internal communications, theme factory and MCP builder.

These are a curated starter selection, not a claim that an external ranking certifies the “top 50” or that all 50 are production-ready. Upstream imports start as drafts requiring admin review and Flolah adaptation. Their referenced scripts, agents, assets and tool ecosystems are **not** installed. Instruction warnings are heuristics, not a malware scan or proof of safety. Publication requires human review of license, capability and safety boundaries.

## Build, release and verification

No new npm packages, environment secrets, OpenClaw plugins or external service purchases are required. The database schema additions are additive and applied by the existing skills registry initialization. Standard and scoped-update backend Dockerfiles include this source directory.

Run in an isolated test data directory (the test creates and cleans its own temporary fixture):

```sh
cd backend
npm run test:platform-skill-catalog
npm run test:agent-skills
npm run test:slash-commands
npm run test:work-steering
cd ../frontend
npm run test:chat
npm run build
```

The catalog test covers 50 unique source entries, draft/publication state, admin HTTP authorization, CEO isolation, pinned upgrades, license/checksum review, prerequisite gating, managed references and unpublish/reseed behavior. Windows may deny creation of a symlink fixture; that check must then also run in Linux CI before release.

Deploy backend and frontend together through the existing Docker release workflow. There is no need to restart trading bridges or change trading settings. Before release, refresh main and check shared source changes from parallel work, then run these regressions on the integrated revision.
