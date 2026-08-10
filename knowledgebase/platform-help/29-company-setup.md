# Company setup (first-run company OS funnel)

## Quick answers (Platform Help / CEO FAQ)

**What is Company setup?** Guided wizard at `/company-setup` that shapes your AI company: type of business, name, mission, org DNA, systems (connectors), management style, then applies AI employees / knowledge packs for Day 1.

**How do I open Company setup?** Avatar / Profile menu → **Company setup**, or go to `/company-setup`. New CEOs may be **gated** until they complete or skip setup.

**How do I update mission / DNA without re-running the full wizard?** Profile menu → **Update Company Details** (`/update-company-details`). This edits the Knowledge table `company_memory` (`item`/`detail` columns; creates table if missing) and keeps the setup `strategic_profile` in sync. Full Apply (teams/blueprints) remains under Company setup.

**What if I already skipped?** Profile → **Company setup** (or `/company-setup`) — you can start create again anytime. Skipped state does not block the product permanently.

**Is Company setup the same as Onboarding Helper?** No.
- **Company setup** (`/company-setup`) — structured funnel + blueprints for first company shape.
- **Onboarding Helper** (`/onboarding`, agent `onboardinghelper`) — freeform chat proposal with selective Review / Apply (see [27-onboarding-helper.md](./27-onboarding-helper.md)).

**What steps does the wizard include?** Welcome → company type → identity (name, headcount, country, industry) → mission → org DNA → preview team → systems → management style → review / apply → done.

**What management styles exist?**
- **AI suggests** — employees draft; you decide and act.
- **AI after approval** — work can prepare; public actions wait for CEO approval.
- **AI autonomous** — may act within budgets and tool grants (use carefully).

**What does Apply do?** Creates or extends departments and AI employees from the selected blueprint, seeds knowledge / policy style where applicable, and marks the setup gate **completed**. Re-running can add packs; it does not wipe your existing org by default.

**Admin: publish / export a company blueprint?** Platform admin **Admin → Company industry blueprints** snapshots a chosen CEO company into an industry pack (Day 0+1): knowledge tables, policies, org departments + agent map, agent definitions with tool grants and workspace MD (including **ops** / `AGENT-OS-OPS.md`), full workflow graphs, connector catalog, and scheduled goal definitions. **Secrets are always redacted** on publish, JSON inspect, and zip export: live API keys, bearer/bridge tokens, passwords, and common key patterns in workflow graphs/variables are cleared; vault `*Ref` bindings and `{{template}}` placeholders remain for re-bind on install (connectors are structure-only — reconnect OAuth). **Download zip** is format `agent-os-company-blueprint-v2` (`blueprint.json` plus `knowledge/`, `policies/`, `org/`, `agents/`, `workflows/`, `connectors/`, `goals/`; `manifest.json` includes `secrets_scrubbed`). Older dirty DB rows are scrubbed again at export time. Ops CLI: `node scripts/validate-company-blueprint-export.mjs` (set `DRY_RUN=1` to validate only).

**Optional CRM / ERP (Business Core):** On the systems step (and on Profile anytime) you may select **platform Twenty (CRM)** and/or **platform ERPNext (ERP)**. That is optional — leave as none if you do not need SoR CRM/ERP.

- Selecting **Twenty** provisions **CRM Maker A**, **CRM Maker B**, **CRM Checker** (your company only) with `crm_*` tools, and unlocks **CRM** nav when embeds are configured.
- Selecting **ERPNext** as CRM and/or ERP provisions prefab Makers/Checker (and ERP specialists) with **company-scoped** `erp_*` tools—same entitlements as your desk SSO company (Customer/masters use `flolah_company`; see [32-business-core-crm-erp.md](./32-business-core-crm-erp.md)).
- Workflows can use platform MCPs **`mcp-flolah-crm`** / **`mcp-flolah-erp`**.

**Can Platform Help help me after setup?** Yes — ask how-to questions about nav, scheduled goals, workflows, CRM/ERP, and use **COO** for day-to-day goals.

## Where

| Surface | Path | Role |
|---------|------|------|
| Company setup wizard | `/company-setup` | Full funnel; gate for first-run CEOs |
| Profile menu | avatar → **Company setup** | Full funnel | Reopen anytime |
| **Update Company Details** | avatar → **Update Company Details** (`/update-company-details`) | Mission, DNA, company name, industry → `company_memory` Knowledge table + strategic profile |
| Profile → Company setup (full) | `/company-setup` | Full funnel |
| Gate redirect | (app shell) | If gate is pending, CEO may be sent back to `/company-setup` (Profile still allowed) |

## First-time flow

1. Register and log in as CEO.
2. If the app opens Company setup first, choose **Create a company** (or skip if offered).
3. Pick a **company type** (for example content creator) or describe your business.
4. Fill **identity** (company name, headcount band, country, industry).
5. Write a **mission** / what success looks like.
6. Choose **org DNA** (startup, enterprise, cost-conscious, creative agency, etc.).
7. **Preview** the proposed AI employees and departments; adjust selection checkboxes.
8. Pick **systems** you care about (apps / connectors) — search connectors when available.
9. Choose **management style**.
10. **Review** and **Apply** to provision.
11. Land on **done** → open Home or My Org to work with the COO.

## Gate states

| Gate | Meaning |
|------|---------|
| `pending` | First-run path expects setup or skip |
| `skipped` | CEO skipped; can reopen `/company-setup` later |
| `completed` | Setup applied at least once; can re-run to extend |

## After setup tips

- **Scheduled goals** — ask the COO to schedule recurring work, or open **Management → Scheduled goals** ([28-scheduled-goals.md](./28-scheduled-goals.md)).
- **Content creator pack** — Connect Facebook under **Connectors → MCPs**, then use **Company Operate** / operate workflows for production, publish, comments, and Ops Reporter rollup (**bell**, not email). Guide: [30-content-creator-ops.md](./30-content-creator-ops.md).
- **Policies** — common guardrails apply across AI employees.
- **API Keys** — fill `Platform_BYOK` if you chose OpenAI/OpenRouter.
- **Resync** — after org changes, My Org → Resync ORG/AGENTS when needed.
- **Onboarding Helper** — for additional custom departments/agents beyond the blueprint.

## Isolation and entitlements

Company setup state and apply are CEO tenant–scoped. Requires authenticated CEO APIs (`/api/company-setup/*`).



## Demo company blueprint

The system pack **Flolah demo (Balaji Ranganathan)** (`demo_balaji_ranganathan`) is a deep snapshot of **BalajiDemoCompany** for clean redeploys: CRM/ERP Maker-Checker agents, IBKR/monthly trading workflows, specialty agents, goals, and connector stubs (no secrets).

- Pack: `backend/src/services/company-blueprints/packs/demo_balaji_ranganathan.json`
- Export zip: `backend/src/services/company-blueprints/exports/demo_balaji_ranganathan.zip`
- Re-publish: `node backend/scripts/publish-balaji-demo-blueprint.js` (owner `ceo-bala`)


## Related

- Onboarding Helper chat: [27-onboarding-helper.md](./27-onboarding-helper.md)
- Navigation: [02-navigation-and-chrome.md](./02-navigation-and-chrome.md)
- Scheduled goals: [28-scheduled-goals.md](./28-scheduled-goals.md)
- Getting started: [01-getting-started.md](./01-getting-started.md)
